/**
 * FaceFitCheck — the premium "fit your face to frame" pre-flight screen.
 *
 * Runs after camera/mic permission and BEFORE the Tavus conversation joins. It
 * tracks the candidate's face on-device (MediaPipe), guides them into the frame
 * for the most accurate downstream analysis, and only enables "Start" once the
 * face is correctly framed and held steady (auto-start vs manual is
 * configurable). It never hard-blocks: if CV can't run it drops to a guide-only
 * oval + manual confirm.
 *
 * This is a framing AID only — nothing here is uploaded and it does not feed or
 * alter the Rekognition / Hume / Deepgram / Tavus pipeline. On start it simply
 * hands off to the existing flow via `onReady`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ScanFace, Users, Move, Eye, Sun, Maximize2, Minimize2, ArrowRight, Check,
  CheckCircle2, Camera, CameraOff, RefreshCw, ShieldCheck, Loader2, Glasses,
  Image as ImageIcon, type LucideIcon,
} from 'lucide-react'
import { FaceScannerOverlay, type ScannerVisualState } from './FaceScannerOverlay'
import { useFaceLandmarker } from './useFaceLandmarker'
import { evaluateFraming, hintText, type FramingChecks, type HintId, type Landmark } from './framing'
import {
  FRAMING, HOLD_MS, AUTO_START, AUTO_START_COUNTDOWN_MS, HANDOFF_RELEASE_MS, MIRROR,
  STUCK_HINT_AFTER_MS,
} from './config'

interface Props {
  /** Called once the candidate is framed + has started — hands off to Tavus. */
  onReady: () => void
  /** Brand accent (hex). Defaults to the Mimic primary violet. */
  accentColor?: string
  candidateName?: string
  /** Override the configured auto-start behaviour for this mount. */
  autoStart?: boolean
}

type CameraState = 'requesting' | 'ready' | 'denied' | 'error'

/* ── Dark-surface state palette ──────────────────────────────────────────────
   The stage is brand-black, so the accent used for INK is the light violet
   (brand-gold token) rather than the deep primary, which would disappear. Mint
   marks the positive/locked state; the caller's accent fills solid controls. */
const INK_ACCENT = '#8AA6F0'   // brand-gold — violet that reads on near-black
const LOCK = '#7FD4AE'         // mint — framed, held, locked in (always dark ink on top)

const HINT_ICON: Record<HintId, LucideIcon> = {
  no_face: ScanFace,
  multiple: Users,
  move_closer: Maximize2,
  move_back: Minimize2,
  center: Move,
  frontal: Eye,
  lighting: Sun,
  hold: CheckCircle2,
}

const TIPS: Array<{ text: string; Icon: LucideIcon }> = [
  { text: 'Face the camera with your whole face visible', Icon: ScanFace },
  { text: 'Use even, front-facing light — avoid strong backlight', Icon: Sun },
  { text: 'Remove hats, sunglasses, or masks', Icon: Glasses },
  { text: 'A plain, quiet background works best', Icon: ImageIcon },
]

const EMPTY_CHECKS: FramingChecks = {
  present: false, single: false, centered: false, distanceOk: false, frontal: false, lightingOk: false,
}

export function FaceFitCheck({ onReady, accentColor = '#8AA6F0', candidateName, autoStart = AUTO_START }: Props) {
  const reduce = useReducedMotion() ?? false
  const accent = accentColor

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Guards against StrictMode's mount→cleanup→remount opening two streams.
  const genRef = useRef(0)

  const [camera, setCamera] = useState<CameraState>('requesting')

  // Lock-in machine (kept in refs; detection runs ~18fps, we publish to React ~7fps).
  const facesRef = useRef<Landmark[][]>([])
  const visRef = useRef<ScannerVisualState>({ phase: 'searching', progress: 0 })
  const goodSinceRef = useRef<number | null>(null)
  const lockedRef = useRef(false)
  const proceededRef = useRef(false)
  const lastPublishRef = useRef(0)
  const countdownRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // React-visible UI state
  const [hint, setHint] = useState<HintId>('no_face')
  const [checks, setChecks] = useState<FramingChecks>(EMPTY_CHECKS)
  const [uiPhase, setUiPhase] = useState<ScannerVisualState['phase']>('searching')
  const [locked, setLocked] = useState(false)
  const [starting, setStarting] = useState(false) // handoff in progress (camera released)
  const [stuck, setStuck] = useState(false)

  const dense = useMemo(
    () => !reduce && typeof window !== 'undefined' &&
      window.matchMedia?.('(pointer: fine)').matches && window.innerWidth > 900,
    [reduce],
  )

  // ── Camera stream lifecycle ─────────────────────────────────────────────
  /** When the live stream was actually released — the handoff buffer counts
   *  from HERE, not from when proceed() runs (elapse-aware, no double wait). */
  const releasedAtRef = useRef<number | null>(null)
  const stopStream = useCallback(() => {
    genRef.current++ // invalidate any in-flight getUserMedia
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      releasedAtRef.current = performance.now()
    }
    streamRef.current = null
  }, [])

  const requestCamera = useCallback(async () => {
    const gen = ++genRef.current
    setCamera('requesting')
    try {
      // Request mic too, so both permissions are granted before Tavus joins.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
      if (gen !== genRef.current) {
        stream.getTracks().forEach((t) => t.stop()) // superseded (StrictMode/remount)
        return
      }
      streamRef.current = stream
      const v = videoRef.current
      if (v) {
        v.srcObject = stream
        await v.play().catch(() => {})
      }
      setCamera('ready')
    } catch (e) {
      if (gen !== genRef.current) return
      const name = e instanceof DOMException ? e.name : ''
      setCamera(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error')
    }
  }, [])

  useEffect(() => {
    requestCamera()
    return () => {
      stopStream()
      if (countdownRef.current) clearTimeout(countdownRef.current)
    }
  }, [requestCamera, stopStream])

  // ── Handoff to the existing Tavus start ─────────────────────────────────
  // Release our camera/mic FIRST, then wait a beat before mounting the Tavus
  // call — otherwise the call races us for the (often exclusive) camera and
  // joins with video off. See HANDOFF_RELEASE_MS.
  const proceed = useCallback(() => {
    if (proceededRef.current) return
    proceededRef.current = true
    if (countdownRef.current) clearTimeout(countdownRef.current)
    setStarting(true)
    stopStream()
    // Elapse-aware release buffer: on the auto-start path the camera was freed
    // back at lock (the countdown already covered the buffer) → hand off with
    // no extra wait. Only a manual start that just released still waits.
    const since = releasedAtRef.current === null ? 0 : performance.now() - releasedAtRef.current
    const remaining = Math.max(0, HANDOFF_RELEASE_MS - since)
    if (remaining === 0) onReady()
    else countdownRef.current = setTimeout(onReady, remaining)
  }, [onReady, stopStream])

  const onLock = useCallback(() => {
    visRef.current = { phase: 'success', progress: 1 }
    setUiPhase('success')
    setLocked(true)
    if (autoStart) {
      // Free the camera now; the countdown doubles as the release buffer so the
      // device is idle well before the Tavus call grabs it.
      stopStream()
      setStarting(true)
      countdownRef.current = setTimeout(proceed, AUTO_START_COUNTDOWN_MS)
    }
  }, [autoStart, proceed, stopStream])

  // ── Per-detection callback (from the throttled MediaPipe loop) ──────────
  const onResult = useCallback(
    (r: ReturnType<typeof evaluateFraming>, faces: Landmark[][]) => {
      facesRef.current = faces
      const now = performance.now()

      if (lockedRef.current) {
        visRef.current = { phase: 'success', progress: 1 }
        return
      }

      let progress = 0
      let phase: ScannerVisualState['phase']
      if (r.allGood) {
        if (goodSinceRef.current === null) goodSinceRef.current = now
        progress = Math.min(1, (now - goodSinceRef.current) / HOLD_MS)
        phase = 'holding'
        if (progress >= 1) {
          lockedRef.current = true
          onLock()
        }
      } else {
        goodSinceRef.current = null
        phase = r.checks.present ? 'adjusting' : 'searching'
      }
      if (!lockedRef.current) visRef.current = { phase, progress }

      // Publish to React at ~7fps to keep the DOM light on mobile.
      if (now - lastPublishRef.current > 140) {
        lastPublishRef.current = now
        setHint(r.hint)
        setChecks(r.checks)
        if (!lockedRef.current) {
          setUiPhase(phase)
        }
      }
    },
    [onLock],
  )

  const { status: modelStatus, mesh } = useFaceLandmarker({
    videoRef,
    // Stop detecting once locked (camera is released at that point).
    enabled: camera === 'ready' && !locked,
    onResult,
  })

  const fallback = modelStatus === 'unsupported' || modelStatus === 'error'
  const tracking = camera === 'ready' && modelStatus === 'ready' && !fallback

  // "Having trouble?" escape hatch after a while with no lock.
  useEffect(() => {
    if (!tracking || locked) return
    const t = setTimeout(() => setStuck(true), STUCK_HINT_AFTER_MS)
    return () => clearTimeout(t)
  }, [tracking, locked])

  const HintIcon = HINT_ICON[hint]
  const good = uiPhase === 'holding' || uiPhase === 'success'

  const checklist: Array<{ ok: boolean; label: string; Icon: typeof ScanFace }> = [
    { ok: checks.single, label: 'Just you', Icon: Users },
    { ok: checks.centered, label: 'Centered', Icon: Move },
    { ok: checks.distanceOk, label: 'Distance', Icon: Maximize2 },
    { ok: checks.frontal, label: 'Facing', Icon: Eye },
    ...(FRAMING.lightingEnabled ? [{ ok: checks.lightingOk, label: 'Lighting', Icon: Sun }] : []),
  ]

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-y-auto bg-brand-black px-4 py-8 font-sans text-white">
      {/* Ambient glow backdrop */}
      {!reduce && (
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: `radial-gradient(70% 55% at 50% 38%, ${accent}33 0%, transparent 70%)` }}
        />
      )}

      <div className="relative z-10 w-full max-w-md">
        {/* Eyebrow + heading */}
        <div className="mb-6 text-center">
          <span
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em]"
            style={{ borderColor: `${INK_ACCENT}59`, color: INK_ACCENT, background: `${INK_ACCENT}1f` }}
          >
            <ScanFace size={13} strokeWidth={2} aria-hidden="true" /> Pre-flight framing check
          </span>
          <h1 className="mt-4 font-display text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">
            {locked ? 'Perfect — you’re all set' : 'Let’s frame your face'}
          </h1>
          <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-brand-gray">
            {locked
              ? candidateName
                ? `Thanks, ${candidateName}. Starting your interview…`
                : 'Starting your interview…'
              : 'Fit your face inside the frame and hold steady. Good positioning and even lighting help the AI capture your responses accurately.'}
          </p>
        </div>

        {/* ── Camera stage ── */}
        <div
          className="relative mx-auto aspect-[4/5] w-full overflow-hidden rounded-3xl border-2 bg-brand-card shadow-xl"
          style={{ borderColor: good ? `${LOCK}b3` : '#2A3446', transition: 'border-color .4s ease' }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
            style={{ transform: MIRROR ? 'scaleX(-1)' : undefined }}
          />

          {/* Live scanner overlay (also renders reticle-only in fallback) */}
          {camera === 'ready' && (
            <FaceScannerOverlay
              videoRef={videoRef}
              facesRef={facesRef}
              stateRef={visRef}
              mesh={fallback ? null : mesh}
              accent={LOCK}
              mirror={MIRROR}
              reducedMotion={reduce}
              dense={!!dense}
            />
          )}

          {/* Loading model */}
          {camera === 'ready' && modelStatus === 'loading' && (
            <div className="absolute inset-x-0 top-3 flex justify-center">
              <span className="flex items-center gap-2 rounded-md border border-brand-border bg-brand-black/80 px-3 py-1.5 text-xs font-medium text-brand-gold-light backdrop-blur">
                <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Starting face tracking…
              </span>
            </div>
          )}

          {/* Requesting / denied / error camera states */}
          {camera !== 'ready' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              {camera === 'requesting' && (
                <>
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border border-brand-border bg-white/5 text-brand-gray">
                    <Camera size={24} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <p className="text-sm text-brand-gray">Requesting camera access…</p>
                </>
              )}
              {(camera === 'denied' || camera === 'error') && (
                <>
                  <span className="flex h-14 w-14 items-center justify-center rounded-full border border-brand-border bg-white/5" style={{ color: INK_ACCENT }}>
                    <CameraOff size={24} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {camera === 'denied' ? 'Camera access is blocked' : 'We couldn’t start your camera'}
                    </p>
                    <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-brand-gray">
                      {camera === 'denied'
                        ? 'Allow camera and microphone for this site in your browser settings, then try again.'
                        : 'Close any other app using the camera, then try again.'}
                    </p>
                  </div>
                  <button
                    onClick={requestCamera}
                    className="mt-1 inline-flex h-10 items-center gap-1.5 rounded-md px-5 text-sm font-semibold text-white transition-transform duration-150 hover:-translate-y-px"
                    style={{ background: accent }}
                  >
                    <RefreshCw size={14} aria-hidden="true" /> Try camera again
                  </button>
                </>
              )}
            </div>
          )}

          {/* Success check badge */}
          <AnimatePresence>
            {locked && (
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-x-0 bottom-3 flex justify-center"
              >
                <span
                  className="flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-bold shadow-lg"
                  style={{ background: LOCK, color: '#0E1420' }}
                >
                  <Check size={15} strokeWidth={3} aria-hidden="true" /> Locked in
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Single dynamic hint chip ── */}
        {tracking && !locked && (
          <div className="mt-4 flex h-11 items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.div
                key={hint}
                role="status"
                aria-live="polite"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-semibold"
                style={{
                  borderColor: good ? `${LOCK}66` : `${INK_ACCENT}4d`,
                  background: good ? `${LOCK}1f` : `${INK_ACCENT}1a`,
                  color: good ? LOCK : INK_ACCENT,
                }}
              >
                <HintIcon size={16} strokeWidth={2} aria-hidden="true" /> {hintText(hint)}
              </motion.div>
            </AnimatePresence>
          </div>
        )}

        {/* ── Live condition checklist ── */}
        {tracking && !locked && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {checklist.map(({ ok, label, Icon }) => (
              <span
                key={label}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors duration-150"
                style={{
                  borderColor: ok ? `${LOCK}59` : '#2A3446',
                  background: ok ? `${LOCK}1a` : 'rgba(255,255,255,0.03)',
                  color: ok ? LOCK : '#93A0B4',
                }}
              >
                {ok
                  ? <Check size={12} strokeWidth={3} aria-hidden="true" />
                  : <Icon size={12} strokeWidth={2} aria-hidden="true" />}
                {label}
              </span>
            ))}
          </div>
        )}

        {/* ── Footer: start / countdown / fallback ── */}
        <div className="mt-6">
          {/* Handoff in progress (camera released, freeing the device for Tavus) */}
          {starting && (
            <p className="flex items-center justify-center gap-2 text-sm font-semibold text-white" role="status" aria-live="polite">
              <Loader2 size={15} className="animate-spin" style={{ color: LOCK }} aria-hidden="true" /> Starting your interview…
            </p>
          )}

          {/* Manual start once locked (auto-start hands off on its own) */}
          {locked && !autoStart && !starting && (
            <button
              onClick={proceed}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md text-base font-semibold text-neutral-900 shadow-mint-sm transition-transform duration-150 hover:-translate-y-px active:translate-y-0"
              style={{ background: LOCK }}
            >
              Start interview <ArrowRight size={18} strokeWidth={2.25} aria-hidden="true" />
            </button>
          )}

          {/* Guide-only fallback: manual confirm (CV unavailable/slow) */}
          {camera === 'ready' && fallback && !locked && !starting && (
            <div className="text-center">
              <p className="mx-auto mb-3 max-w-xs text-xs leading-relaxed text-brand-gray">
                Live face tracking isn’t available on this device — center your face in the oval and continue.
              </p>
              <button
                onClick={proceed}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md text-base font-semibold text-white shadow-primary-sm transition-transform duration-150 hover:-translate-y-px active:translate-y-0"
                style={{ background: accent }}
              >
                <CheckCircle2 size={18} strokeWidth={2} aria-hidden="true" /> I’m ready, start
              </button>
            </div>
          )}

          {/* Escape hatch if tracking never locks */}
          {tracking && !locked && stuck && !starting && (
            <div className="text-center">
              <button
                onClick={proceed}
                className="rounded-md px-3 py-1.5 text-xs font-semibold text-brand-gray underline decoration-brand-border underline-offset-4 transition-colors duration-150 hover:text-white hover:decoration-brand-gold"
              >
                Having trouble? Start the interview anyway
              </button>
            </div>
          )}
        </div>

        {/* ── Privacy line ── */}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] leading-relaxed text-brand-gray">
          <ShieldCheck size={13} strokeWidth={1.75} className="flex-shrink-0" aria-hidden="true" />
          Face positioning runs privately on your device — nothing is uploaded.
        </p>

        {/* ── Tips ── */}
        {!locked && (
          <div className="mx-auto mt-6 max-w-sm rounded-2xl border border-brand-border bg-brand-card/60 p-4">
            <p className="mb-3 text-center text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: INK_ACCENT }}>
              For the most reliable results
            </p>
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {TIPS.map(({ text, Icon }) => (
                <li key={text} className="flex items-start gap-2 text-xs leading-snug text-brand-gray">
                  <Icon size={14} strokeWidth={1.75} className="mt-px flex-shrink-0" style={{ color: INK_ACCENT }} aria-hidden="true" />
                  {text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

export default FaceFitCheck

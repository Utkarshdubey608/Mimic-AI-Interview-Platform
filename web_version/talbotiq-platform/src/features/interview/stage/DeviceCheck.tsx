import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight, Camera, Check, Mic, MonitorCheck, RefreshCw, TriangleAlert, VideoOff, X,
} from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { cn, Button, Checkbox, InlineNotice } from '@/components/ui'
import { PreflightCard, type PreflightStep } from './Preflight'
import { FaceFitCheck } from '@/features/avatar-screening/facefit/FaceFitCheck'
import {
  canProceed, evaluateCapabilities, readBrowserEnv, stagesFor,
  STAGE_LABEL, type Capability, type CheckStage,
} from '../deviceRequirements'
import type { BrandingConfig, TrackType } from '@shared/types'

/**
 * MIMIC — the pre-flight device check.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 * A static checklist. It asked the candidate to confirm they had "a stable
 * connection", "a quiet space" and were "ready to focus", and then let them
 * start. Nothing was measured. For the voice track that was close to
 * negligent: a candidate whose microphone was muted at the OS level, or set to
 * the wrong input, found out by talking to an interviewer that could not hear
 * them, and only realised once the silence became obvious.
 *
 * ── Why it is a sequence, not one card ───────────────────────────────────
 * One device per screen. A single card listing browser, microphone, camera,
 * framing and consent together makes the candidate work out which of five
 * things is blocking them, and buries the one that is. A sequence asks one
 * question at a time, each with its own success state, and the order matches
 * how failures actually cascade: a browser that cannot reach devices at all
 * makes the microphone question moot.
 *
 * Only what the format needs is asked. A written interview asks for nothing,
 * and a voice interview is never asked for a camera. See deviceRequirements.ts
 * for the table and the reasoning behind each entry.
 */

type Perm = 'idle' | 'asking' | 'granted' | 'denied' | 'failed'

export function DeviceCheck({
  track, steps, onBegin, busy, candidateName,
}: {
  /** Accepted for symmetry with the other pre-flight screens; this one names no tenant. */
  branding?: BrandingConfig
  track: TrackType
  steps: PreflightStep[]
  onBegin: () => void
  busy?: boolean
  candidateName?: string
}) {
  const reduce = useReducedMotion() ?? false
  const stages = stagesFor(track)
  const [caps] = useState<Capability[]>(() => evaluateCapabilities(track, readBrowserEnv()))
  const [at, setAt] = useState(0)
  /* How many browser probes have been REVEALED so far.

     The probes themselves are synchronous: reading window.isSecureContext or
     navigator.mediaDevices takes microseconds, so the honest result exists
     before the screen paints. Revealing all five at once, already ticked, reads
     as a hardcoded list rather than as a check, and a candidate whose browser
     genuinely fails one gets no sense that anything was tested.

     So they are revealed one at a time, each visibly being checked before it
     resolves. The delay is presentation, not measurement, which is why it is
     short and why reduced motion skips it entirely. */
  const [probed, setProbed] = useState(0)
  const [micPerm, setMicPerm] = useState<Perm>('idle')
  const [camPerm, setCamPerm] = useState<Perm>('idle')
  const [level, setLevel] = useState(0)
  const [peak, setPeak] = useState(0)
  const [framed, setFramed] = useState(false)
  const [consent, setConsent] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const camStreamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)

  const stage: CheckStage = stages[at] ?? 'browser'
  const capsOk = canProceed(caps)

  /* ── Release everything, always ─────────────────────────────────────────
     A camera light left on after a check is the most alarming thing this
     product could do to a candidate. Streams, the analyser loop and the
     AudioContext are released on unmount and between retries.

     They are also released when the framing stage begins, because FaceFitCheck
     opens its own capture: holding two live captures of the same camera is how
     a browser starts refusing the second one. */
  const stopMic = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    micStreamRef.current = null
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
  }, [])

  const stopCam = useCallback(() => {
    camStreamRef.current?.getTracks().forEach((t) => t.stop())
    camStreamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  useEffect(() => () => { stopMic(); stopCam() }, [stopMic, stopCam])

  // Reveal the browser probes in sequence. Under reduced motion the sequence is
  // skipped and every result appears at once: someone who asked for less motion
  // has not asked to be kept waiting for an animation.
  useEffect(() => {
    if (stage !== 'browser' || caps.length === 0) return
    if (reduce) { setProbed(caps.length); return }
    if (probed >= caps.length) return
    const id = setTimeout(() => setProbed((n) => n + 1), probed === 0 ? 280 : 200)
    return () => clearTimeout(id)
  }, [stage, caps.length, probed, reduce])

  useEffect(() => {
    if (stage === 'face') { stopMic(); stopCam() }
  }, [stage, stopMic, stopCam])

  /* ── Microphone ───────────────────────────────────────────────────────── */
  const askMic = useCallback(async () => {
    setMicPerm('asking')
    stopMic()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream
      setMicPerm('granted')

      const Ctx = window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.75
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)

      const tick = () => {
        analyser.getByteTimeDomainData(buf)
        // RMS around the 128 midpoint. A peak meter sits near zero for a quiet
        // talker and tells them their microphone is broken when it is not.
        let sum = 0
        for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d }
        const scaled = Math.min(1, Math.sqrt(sum / buf.length) * 4)
        setLevel(scaled)
        setPeak((prev) => Math.max(prev, scaled))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (e) {
      const err = e as DOMException
      setMicPerm(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'failed')
    }
  }, [stopMic])

  /* ── Camera ───────────────────────────────────────────────────────────── */
  const askCam = useCallback(async () => {
    setCamPerm('asking')
    stopCam()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      camStreamRef.current = stream
      setCamPerm('granted')
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        void videoRef.current.play().catch(() => {})
      }
    } catch (e) {
      const err = e as DOMException
      setCamPerm(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'failed')
    }
  }, [stopCam])

  // A microphone counts as proven once it has registered sound. A low bar on
  // purpose: it exists to catch a dead input, not to judge a speaking voice.
  const micProven = peak > 0.06

  const probing = stage === 'browser' && probed < caps.length
  const canAdvance =
    stage === 'browser' ? capsOk && !probing
    : stage === 'microphone' ? micPerm === 'granted' && micProven
    : stage === 'camera' ? camPerm === 'granted'
    : stage === 'face' ? framed
    : stage === 'consent' ? consent
    : true

  const last = at >= stages.length - 1
  const advance = () => { if (last) onBegin(); else setAt((i) => i + 1) }

  /* ── Framing owns the whole card ────────────────────────────────────────
     FaceFitCheck draws its own full-bleed camera surface with a scanner
     overlay, so it is rendered outside PreflightCard rather than squeezed into
     it. It is ADVISORY: "Skip this step" is always available, because the
     manual is explicit that framing help must never block a candidate, and
     someone whose face the model cannot find must still be able to interview. */
  if (stage === 'face') {
    return (
      <div className="w-full">
        <FaceFitCheck onReady={() => { setFramed(true); advance() }} candidateName={candidateName} />
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => { setFramed(true); advance() }}
            className="rounded-sm text-sm text-ink-muted underline underline-offset-2 transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Skip this step
          </button>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-ink-muted">
            Framing runs on your device only. Nothing from it is uploaded, and it is not part
            of how you are assessed.
          </p>
        </div>
      </div>
    )
  }

  return (
    <PreflightCard
      step="systemcheck"
      steps={steps}
      title={TITLES[stage]}
      description={DESCRIPTIONS[stage]}
      footer={
        <>
          <Button
            size="lg"
            block
            onClick={advance}
            disabled={!canAdvance}
            loading={last ? busy : false}
            iconRight={!busy ? <ArrowRight size={18} /> : undefined}
          >
            {last ? (busy ? 'Starting…' : 'Start the interview') : 'Continue'}
          </Button>
          {!canAdvance && (
            <p className="mt-2.5 text-center text-xs text-ink-muted">
              {probing ? 'Checking your browser' : BLOCKED[stage]}
            </p>
          )}
        </>
      }
    >
      {/* The check's own rail. Deliberately separate from the pre-flight step
          meter above it: these are steps WITHIN the ready check, and folding the
          two together would misstate how much of the interview setup is left. */}
      {stages.length > 1 && (
        <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1.5" aria-label="Setup checks">
          {stages.map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span
                aria-current={i === at ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 text-2xs font-semibold',
                  i === at ? 'text-ink' : i < at ? 'text-ink-muted' : 'text-ink-faint',
                )}
              >
                <span
                  className={cn(
                    'grid h-4 w-4 place-items-center rounded-sm border font-mono text-[9px] nums',
                    i === at ? 'border-ink bg-ink text-ink-inverse'
                      : i < at ? 'border-ink bg-surface text-ink'
                      : 'border-rule bg-surface text-ink-faint',
                  )}
                  aria-hidden="true"
                >
                  {i < at ? <Check size={10} strokeWidth={3} /> : i + 1}
                </span>
                {STAGE_LABEL[s]}
                {i < at && <span className="sr-only"> done</span>}
              </span>
              {i < stages.length - 1 && <span className="h-px w-4 bg-rule" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      )}

      {/* ── Browser ─────────────────────────────────────────────────────── */}
      {stage === 'browser' && (
        caps.length === 0 ? (
          <InlineNotice tone="neutral" icon={<MonitorCheck size={15} strokeWidth={2} />}>
            This is a written interview, so it needs nothing from your camera or microphone.
          </InlineNotice>
        ) : (
          <ul className="space-y-2.5" aria-live="polite" aria-busy={probing}>
            {caps.map((c, i) => {
              const done = i < probed
              const checking = i === probed
              return (
                <li
                  key={c.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3.5 transition-colors duration-base',
                    done ? 'border-rule bg-surface-sunk' : 'border-rule bg-surface',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-5 w-5 flex-shrink-0 place-items-center rounded-sm transition-colors duration-base',
                      !done
                        ? 'bg-surface-hover text-ink-faint'
                        : c.ok ? 'bg-ok-bg text-ok'
                        : c.required ? 'bg-risk-bg text-risk'
                        : 'bg-warn-bg text-warn',
                    )}
                    aria-hidden="true"
                  >
                    {!done ? (
                      checking
                        ? <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
                        : <span className="h-1 w-1 rounded-full bg-current" />
                    ) : (
                      // The mark grows in, so "checking" becoming "checked" is a
                      // legible transition rather than a swap the eye misses.
                      <motion.span
                        initial={reduce ? false : { scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      >
                        {c.ok ? <Check size={12} strokeWidth={3} />
                          : c.required ? <X size={12} strokeWidth={3} />
                          : <TriangleAlert size={11} strokeWidth={3} />}
                      </motion.span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className={cn('text-sm font-medium transition-colors duration-base', done ? 'text-ink' : 'text-ink-muted')}>
                      {c.label}
                      <span className="sr-only">
                        : {!done ? 'checking' : c.ok ? 'working' : c.required ? 'not available' : 'not available, optional'}
                      </span>
                    </span>
                    {done && !c.ok && (
                      <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{c.remedy}</span>
                    )}
                  </span>

                  {checking && (
                    <span className="flex-shrink-0 text-xs text-ink-muted" aria-hidden="true">Checking</span>
                  )}
                </li>
              )
            })}
          </ul>
        )
      )}

      {/* ── Microphone ──────────────────────────────────────────────────── */}
      {stage === 'microphone' && (
        <div>
          <div className="flex items-baseline justify-between">
            <p className="section-label">Input level</p>
            {micPerm === 'granted' && (
              <span className={cn('text-xs font-semibold', micProven ? 'text-ok' : 'text-ink-muted')} aria-live="polite">
                {micProven ? 'Working' : 'Waiting for sound'}
              </span>
            )}
          </div>

          <div
            className="mt-2 flex h-10 items-center gap-1 rounded-lg border border-rule bg-surface-sunk px-3"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
            aria-label="Microphone input level"
          >
            {Array.from({ length: 28 }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-4 flex-1 rounded-[1px] transition-colors duration-75',
                  micPerm === 'granted' && level * 28 > i ? (i > 24 ? 'bg-warn' : 'bg-ok') : 'bg-rule',
                )}
                aria-hidden="true"
              />
            ))}
          </div>

          {micPerm !== 'granted' ? (
            <div className="mt-4">
              <Button
                variant={micPerm === 'denied' || micPerm === 'failed' ? 'secondary' : 'primary'}
                size="lg" block
                loading={micPerm === 'asking'}
                onClick={() => void askMic()}
                icon={micPerm === 'denied' || micPerm === 'failed' ? <RefreshCw size={17} /> : <Mic size={17} />}
              >
                {micPerm === 'denied' || micPerm === 'failed' ? 'Try again' : 'Allow microphone'}
              </Button>
              {micPerm === 'denied' && (
                <InlineNotice tone="warn" title="Access was blocked" className="mt-3">
                  Open the microphone icon in your browser address bar, allow access for this
                  page, then choose Try again.
                </InlineNotice>
              )}
              {micPerm === 'failed' && (
                <InlineNotice tone="warn" title="We could not reach your microphone" className="mt-3">
                  Another application may be using it. Close any other call or recording app,
                  then choose Try again.
                </InlineNotice>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-ink-muted">
              Say a few words. The bar moves when your microphone hears you, and nothing is
              recorded during this check.
            </p>
          )}
        </div>
      )}

      {/* ── Camera ──────────────────────────────────────────────────────── */}
      {stage === 'camera' && (
        <div>
          <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-rule bg-brand-void">
            <video ref={videoRef} className="h-full w-full scale-x-[-1] object-cover" playsInline muted autoPlay />
            {camPerm !== 'granted' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-brand-gray">
                <VideoOff size={22} strokeWidth={1.75} aria-hidden="true" />
                <span className="text-xs">Your preview appears here</span>
              </div>
            )}
          </div>

          {camPerm !== 'granted' ? (
            <div className="mt-4">
              <Button
                variant={camPerm === 'denied' || camPerm === 'failed' ? 'secondary' : 'primary'}
                size="lg" block
                loading={camPerm === 'asking'}
                onClick={() => void askCam()}
                icon={camPerm === 'denied' || camPerm === 'failed' ? <RefreshCw size={17} /> : <Camera size={17} />}
              >
                {camPerm === 'denied' || camPerm === 'failed' ? 'Try again' : 'Allow camera'}
              </Button>
              {camPerm === 'denied' && (
                <InlineNotice tone="warn" title="Access was blocked" className="mt-3">
                  Open the camera icon in your browser address bar, allow access for this page,
                  then choose Try again.
                </InlineNotice>
              )}
              {camPerm === 'failed' && (
                <InlineNotice tone="warn" title="We could not reach your camera" className="mt-3">
                  Another application may be using it. Close any other video app, then choose
                  Try again.
                </InlineNotice>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-ink-muted">
              Sit facing your main light source, with your head and shoulders in frame.
            </p>
          )}
        </div>
      )}

      {/* ── Consent ─────────────────────────────────────────────────────── */}
      {stage === 'consent' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-rule bg-surface-sunk p-4">
            <Checkbox
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              label={
                <span className="font-medium text-ink">
                  I understand my responses are recorded and analysed by AI, and reviewed by a
                  human recruiter.
                </span>
              }
            />
          </div>
          <p className="text-xs leading-relaxed text-ink-muted">
            Your camera and microphone are used only while the interview is running, and access
            stops the moment it ends.
          </p>
        </div>
      )}
    </PreflightCard>
  )
}

/* ── Copy, per stage ──────────────────────────────────────────────────────
   Kept together so the sequence reads as one piece of writing rather than
   being discovered a screen at a time. */

const TITLES: Record<CheckStage, string> = {
  browser: 'Check your browser',
  microphone: 'Check your microphone',
  camera: 'Check your camera',
  face: 'Check your framing',
  consent: 'Before you begin',
}

const DESCRIPTIONS: Record<CheckStage, string> = {
  browser: 'A quick look at whether this browser can run your interview.',
  microphone: 'We will ask for your microphone, then show you that it is working.',
  camera: 'We will ask for your camera, so you can see how you will appear.',
  face: 'Position yourself in the outline so you are centred and well lit.',
  consent: 'One thing to confirm, then you are ready to start.',
}

const BLOCKED: Record<CheckStage, string> = {
  browser: 'This browser cannot run your interview. See the details above.',
  microphone: 'Allow your microphone and say a few words to continue.',
  camera: 'Allow your camera to continue.',
  face: 'Position yourself in the outline, or skip this step.',
  consent: 'Confirm you understand how your responses are used.',
}

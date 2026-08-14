import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'

import { DEFAULT_CONFIG, SESSION_KEY, type IntroConfig, type IntroTier } from './constants'
import type { IntroBridge } from './contract'
import { StaticHero } from './StaticHero'
import { detectTier, supportsWebgl } from './tier'
import { getCachedFaces } from './lib/replicaFaceCache'
import type { FaceAtlas } from './lib/faceAtlas'

// Lazy so the heavy three.js/postprocessing bundle never loads for fallback
// users (reduced-motion, no-WebGL, already-played).
const IntroCanvas = lazy(() => import('./IntroCanvas').then((m) => ({ default: m.IntroCanvas })))

export type MimicIntroProps = Partial<IntroConfig> & {
  enabled?: boolean
  /** Optional pre-rendered film for the fallback path (public/intro/*.webm). */
  videoSrc?: string
}

type Decision = 'pending' | 'cinematic' | 'static' | 'off'
type Phase = 'run' | 'fading' | 'gone'

const FADE_MS = 750

function sessionPlayed(): boolean {
  try {
    return Boolean(window.sessionStorage.getItem(SESSION_KEY))
  } catch {
    return false
  }
}
function markPlayed(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    /* storage unavailable — replaying next visit is acceptable */
  }
}
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * The MIMIC AI cinematic opening — a play-once, skippable, non-blocking splash
 * mounted above the app. Reads the REAL replica faces only from the IndexedDB
 * cache (populated once by IntroFaceSync) — zero Tavus/network calls on mount.
 * Picks a path on first load: the full WebGL film (capable devices), a premium
 * static hero (reduced-motion / no-WebGL / low tier), or nothing (already
 * played this session).
 *
 * Dev query params: `?intro=1` force replay · `?introPreview=1` park the hero
 * shot · `?introT=<seconds>` scrub · `?introTier=high|med|low` force a tier.
 */
export default function MimicIntro(props: MimicIntroProps) {
  const { enabled = true, videoSrc, ...overrides } = props
  const config = useMemo<IntroConfig>(
    () => ({ ...DEFAULT_CONFIG, ...overrides }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const [decision, setDecision] = useState<Decision>('pending')
  const [tier, setTier] = useState<IntroTier>('high')
  const [mode, setMode] = useState<'play' | 'preview'>('play')
  const [atlas, setAtlas] = useState<FaceAtlas | null>(null)
  const [atlasResolved, setAtlasResolved] = useState(false)
  const [ready, setReady] = useState(false)
  const [beat, setBeat] = useState<string | null>(null)
  const [skipVisible, setSkipVisible] = useState(false)
  const [phase, setPhase] = useState<Phase>('run')

  const skipFnRef = useRef<(() => void) | null>(null)
  const doneRef = useRef(false)

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    markPlayed()
    setPhase('fading')
    window.setTimeout(() => setPhase('gone'), FADE_MS)
  }, [])

  const bridge = useRef<IntroBridge>({
    flashEl: null,
    onBeat: (b) => setBeat(b),
    onDone: () => finish(),
    registerSkip: (fn) => {
      skipFnRef.current = fn
    },
  }).current

  // Decide the path exactly once, after mount.
  useEffect(() => {
    if (!enabled) {
      setDecision('off')
      return
    }
    // NEVER compete with a live interview: /take/:id (candidate) and /interview
    // (recruiter room) run a real-time WebRTC call — a WebGL film playing over
    // the join steals exactly the GPU/CPU the video needs and reads as "lag".
    const path = window.location.pathname
    if (path.startsWith('/take/') || path.startsWith('/interview')) {
      setDecision('off')
      return
    }
    const params = new URLSearchParams(window.location.search)
    const force = params.get('intro') === '1'
    const scrub = params.has('introT')
    const preview = params.get('introPreview') === '1'

    if (!force && !scrub && !preview && sessionPlayed()) {
      setDecision('off')
      return
    }
    if (prefersReducedMotion() || !supportsWebgl()) {
      setDecision('static')
      return
    }
    const forced = params.get('introTier')
    const t =
      forced === 'high' || forced === 'med' || forced === 'low'
        ? forced
        : config.tierOverride ?? detectTier()
    if (t === 'low') {
      setDecision('static')
      return
    }
    setTier(t)
    setMode(preview ? 'preview' : 'play')
    setDecision('cinematic')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Build the real-face atlas from the IndexedDB cache before the film mounts.
  useEffect(() => {
    if (decision !== 'cinematic') return
    let alive = true
    let built: FaceAtlas | null = null
    ;(async () => {
      try {
        const faces = await getCachedFaces()
        // Dynamic import keeps three.js (pulled in by the atlas builder) out of
        // the main bundle — only the cinematic path ever loads it.
        const { buildFaceAtlas } = await import('./lib/faceAtlas')
        built = await buildFaceAtlas(faces)
      } catch {
        built = null
      }
      if (!alive) {
        built?.texture.dispose()
        return
      }
      setAtlas(built)
      setAtlasResolved(true)
    })()
    return () => {
      alive = false
      built?.texture.dispose()
    }
  }, [decision])

  // Reveal skip shortly after the film starts.
  useEffect(() => {
    if (decision !== 'cinematic') return
    const id = window.setTimeout(() => setSkipVisible(true), 900)
    return () => window.clearTimeout(id)
  }, [decision])

  const triggerSkip = useCallback(() => {
    if (decision === 'cinematic') skipFnRef.current?.()
    else finish()
    setSkipVisible(false)
  }, [decision, finish])

  const active = decision !== 'off' && decision !== 'pending' && phase !== 'gone'

  // Scroll-lock + Esc/Enter to skip while the splash is on screen.
  useEffect(() => {
    if (!active || phase === 'fading') return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') triggerSkip()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [active, phase, triggerSkip])

  if (!active) return null

  const taglineVisible = decision === 'cinematic' && (beat === 'tagline' || beat === 'settle')

  return (
    <motion.div
      key="mimic-intro"
      initial={{ opacity: 1 }}
      animate={{ opacity: phase === 'fading' ? 0 : 1 }}
      transition={{ duration: FADE_MS / 1000, ease: 'easeInOut' }}
      className="fixed inset-0 flex items-center justify-center overflow-hidden bg-black"
      style={{ zIndex: 2147483000 }}
    >
      {decision === 'static' && <StaticHero config={config} onDone={finish} videoSrc={videoSrc} />}

      {decision === 'cinematic' && (
        <>
          {atlasResolved && (
            <Suspense fallback={null}>
              <IntroCanvas
                bridge={bridge}
                tier={tier}
                mode={mode}
                config={config}
                atlas={atlas}
                onReady={() => setReady(true)}
              />
            </Suspense>
          )}

          {/* First-frame cover — no blank/garbage frame before the GL is up. */}
          {!ready && <div aria-hidden className="absolute inset-0 bg-black" />}

          {/* Tagline reveal, beneath the 3D wordmark. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-[15%] flex justify-center px-6">
            <motion.p
              initial={{ opacity: 0, y: 16, filter: 'blur(10px)' }}
              animate={
                taglineVisible
                  ? { opacity: 1, y: 0, filter: 'blur(0px)' }
                  : { opacity: 0, y: 16, filter: 'blur(10px)' }
              }
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              className="text-center"
              style={{
                fontFamily: 'DM Sans, Inter, system-ui, sans-serif',
                color: '#d7dbe2',
                fontSize: 'clamp(0.8rem, 2.4vw, 1.25rem)',
                letterSpacing: '0.32em',
                textTransform: 'uppercase',
                textShadow: '0 2px 24px rgba(0,0,0,0.6)',
              }}
            >
              {config.tagline}
            </motion.p>
          </div>

          <div
            ref={(el) => {
              bridge.flashEl = el
            }}
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-white opacity-0"
          />

          <button
            type="button"
            onClick={triggerSkip}
            className="absolute bottom-6 right-6 rounded-full border border-white/15 bg-black/40 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.28em] text-white/70 backdrop-blur transition-opacity duration-500 hover:text-white"
            style={{ opacity: skipVisible ? 1 : 0, pointerEvents: skipVisible ? 'auto' : 'none' }}
          >
            Skip ⏎
          </button>
        </>
      )}
    </motion.div>
  )
}

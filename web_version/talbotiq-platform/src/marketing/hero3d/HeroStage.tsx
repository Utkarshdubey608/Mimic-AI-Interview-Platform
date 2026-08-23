/**
 * The hero scene's arming shell.
 *
 * Same contract as Field.tsx, for the same reasons: the panel's finished CSS
 * design is ALWAYS present, and the WebGL scene cross-fades in on top of it only
 * when every one of these holds:
 *
 *   · the visitor has not asked for reduced motion;
 *   · WebGL exists and the device is not a software renderer or low-core;
 *   · the viewport is wide enough to be a laptop rather than a phone;
 *   · the ink, AI and accent tokens resolve to real colours;
 *   · the scene chunk loads and a GL context is granted.
 *
 * Any failure leaves the existing composition showing. That is not a degraded
 * mode — it is the hero as it shipped this morning, with one layer missing.
 *
 * Two things this does that Field.tsx does not:
 *
 * ARMS AFTER FIRST PAINT. The scene is requested on an idle callback, never
 * during the critical path. The home page's LCP is already the worst number on
 * the site (5.1s on a throttled phone, measured), and it is worst precisely
 * because nothing paints until the SPA boots. Putting a shader in front of that
 * would be indefensible, so the shader waits until after the reader can read.
 *
 * NOT ON PHONES. `med` exists as a tier but the gate below requires a wide
 * viewport, so phones keep the static composition. A 3D scene is not worth a
 * second of LCP on the device where LCP is already worst.
 *
 * This module is imported statically by MimicSite, so it must stay free of
 * three, R3F and gsap — a single value import of any of them lands the whole
 * renderer in the marketing entry chunk. That trap is documented in Field.tsx
 * and it has been measured: 306 kB in the wrong place.
 */
import { useEffect, useRef, useState } from 'react'

import { parseColor } from '../field/tokens'
import type { HeroTier } from './constants'
// Type-only, in its own statement, and it must stay that way.
import type { HeroCanvasProps } from './HeroCanvas'

type Loaded = { HeroCanvas: (p: HeroCanvasProps) => JSX.Element }

/** Below this width the scene never arms. A phone keeps the static hero. */
const MIN_WIDTH = 1024

export function HeroStage({ hostRef, onBeat }: {
  /** The `.hero-room` panel. The canvas fills it; pointer events bind to it. */
  hostRef: React.RefObject<HTMLElement | null>
  onBeat?: (beat: string) => void
}) {
  const [mod, setMod] = useState<Loaded | null>(null)
  const [tier, setTier] = useState<HeroTier>('high')
  const [colors, setColors] = useState<HeroCanvasProps['colors'] | null>(null)
  const [lit, setLit] = useState(false)
  /** Runs only while the hero is on screen and the tab is in front. */
  const [running, setRunning] = useState(true)
  const armed = useRef(false)

  /* ── Gate ──────────────────────────────────────────────────────────────
     Reduced motion is watched live, not read once: someone toggling the OS
     setting mid-session should see the scene stop, not on the next reload. */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    let cancelled = false
    let idle = 0

    const disarm = () => { setMod(null); setLit(false); armed.current = false }

    const arm = () => {
      if (armed.current || cancelled) return
      if (mq.matches) return
      if (window.innerWidth < MIN_WIDTH) return
      armed.current = true

      void (async () => {
        try {
          const { supportsWebgl, detectTier } = await import('@/features/intro/tier')
          if (cancelled || mq.matches) return
          if (!supportsWebgl()) return
          const t = detectTier()
          if (t === 'low') return
          setTier(t === 'high' ? 'high' : 'med')

          /* Read the palette off the panel itself, so the shader is fed the
             stylesheet's own values and cannot drift from the brand. Same rule
             Field.tsx follows; a colour hardcoded in a shader is a second
             source of truth for the accent. */
          const host = hostRef.current
          if (!host) return
          const cs = getComputedStyle(host)
          const ink = parseColor(cs.getPropertyValue('--mm-ink'))
          const ai = parseColor(cs.getPropertyValue('--mm-ai'))
          const accent = parseColor(cs.getPropertyValue('--mm-on-ink-accent'))
          if (!ink || !ai || !accent) return

          const [three, canvasMod] = await Promise.all([
            import('three'),
            import('./HeroCanvas'),
          ])
          if (cancelled || mq.matches) return
          setColors({
            ink: new three.Color(...ink),
            ai: new three.Color(...ai),
            accent: new three.Color(...accent),
          })
          setMod({ HeroCanvas: canvasMod.HeroCanvas as Loaded['HeroCanvas'] })
        } catch (err) {
          /* Static composition stands. In production nothing is reported — the
             fallback is the design, not an error state. In development it is
             reported, because a silently swallowed import error here looks
             exactly like a device that failed the tier check, and telling those
             two apart by eye is impossible. */
          if (import.meta.env.DEV) console.warn('[hero3d] scene did not arm:', err)
        }
      })()
    }

    const sync = () => {
      if (mq.matches) { disarm(); return }
      /* After first paint, never during it. requestIdleCallback where it
         exists; a timeout well clear of LCP where it does not (Safari). */
      const ric = (window as unknown as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
      }).requestIdleCallback
      if (ric) idle = ric(arm, { timeout: 2500 })
      else idle = window.setTimeout(arm, 1200)
    }

    sync()
    mq.addEventListener('change', sync)
    return () => {
      cancelled = true
      mq.removeEventListener('change', sync)
      const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
      if (idle) { if (cic) cic(idle); else window.clearTimeout(idle) }
    }
  }, [hostRef])

  /* ── Run only when visible ─────────────────────────────────────────────
     An off-screen shader is a laptop fan spinning for nobody — the same rule
     Field.tsx and DemoVideo apply. The canvas stays mounted (remounting would
     replay the opening sequence at the reader) and its frameloop is parked. */
  useEffect(() => {
    if (!mod) return
    const host = hostRef.current
    if (!host) return

    let onScreen = true
    let tabVisible = document.visibilityState !== 'hidden'
    const apply = () => setRunning(onScreen && tabVisible)

    const io = new IntersectionObserver((es) => {
      onScreen = es.some((e) => e.isIntersecting)
      apply()
    }, { rootMargin: '80px' })
    io.observe(host)

    const onVis = () => { tabVisible = document.visibilityState !== 'hidden'; apply() }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [mod, hostRef])

  if (!mod || !colors) return null
  const { HeroCanvas } = mod

  return (
    <div className={`hero-gl${lit ? ' is-lit' : ''}`} aria-hidden="true">
      <HeroCanvas
        tier={tier}
        hostRef={hostRef}
        colors={colors}
        frameloop={running ? 'always' : 'never'}
        onFirstFrame={() => setLit(true)}
        onBeat={onBeat}
      />
    </div>
  )
}

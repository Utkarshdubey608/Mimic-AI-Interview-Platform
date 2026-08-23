/**
 * The problem section's field layer.
 *
 * Same enhancement contract as Field.tsx and InkTrail: the section's own ground
 * is always there, and this cross-fades in on top only when reduced motion is
 * off, the device tier is not low, the tokens resolve and the WebGL2 program
 * compiles.
 *
 * What it adds over the other two is that it is DRIVEN BY READING POSITION. The
 * lattice resolves from scattered to ranked as the section crosses the viewport,
 * using `sectionProgress` — the same pure helper the scroll engine uses, which
 * `npm test` already covers. So the field is not on a timer: it orders itself
 * while the reader travels through the argument, and holds once they are looking
 * at it. Nothing loops.
 *
 * The loop runs only while the section is on screen and the tab is in front,
 * which for a section this far down the page is most of the time it is mounted.
 */
import { useEffect, useRef, useState } from 'react'

import { parseColor } from '../field/tokens'
import { clamp01, sectionProgress } from '../scroll/progress'
import { readGate, watchGate } from './gate'
import type { LatticeField } from './latticeField'

export function LatticeStage({ hostRef }: {
  /** The section. Progress and pointer are both measured against it. */
  hostRef: React.RefObject<HTMLElement | null>
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [enhance, setEnhance] = useState(false)
  const [lit, setLit] = useState(false)
  const litRef = useRef(false)

  /* ── Gate ───────────────────────────────────────────────────────────────
     Stricter than the ink's: this one also requires a wide viewport. The
     lattice is six slices of a procedural field over a tall section, which is
     the most expensive thing on this page, and a phone is where the page's LCP
     is already worst. It is worth least exactly where it costs most. */
  useEffect(() => {
    let cancelled = false
    let idle = 0

    const sync = () => {
      const g = readGate()
      if (!g.allowed || !g.wide) { setEnhance(false); litRef.current = false; setLit(false); return }
      const ric = (window as unknown as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
      }).requestIdleCallback
      const arm = () => {
        if (cancelled) return
        const g2 = readGate()
        if (!g2.allowed || !g2.wide) return
        void import('@/features/intro/tier')
          .then(({ detectTier }) => {
            if (cancelled || !readGate().allowed) return
            setEnhance(detectTier() !== 'low')
          })
          .catch(() => { /* section stands as-is */ })
      }
      if (ric) idle = ric(arm, { timeout: 2500 })
      else idle = window.setTimeout(arm, 1200)
    }

    sync()
    const stop = watchGate(sync)
    return () => {
      cancelled = true
      stop()
      const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
      if (idle) { if (cic) cic(idle); else window.clearTimeout(idle) }
    }
  }, [])

  /* ── The loop ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!enhance) return
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return

    const cs = getComputedStyle(host)
    const cool = parseColor(cs.getPropertyValue('--mm-on-ink-accent'))
    const ai = parseColor(cs.getPropertyValue('--mm-ai'))
    if (!cool || !ai) return

    let field: LatticeField | null = null
    let raf = 0
    let disposed = false
    let ro: ResizeObserver | null = null
    let io: IntersectionObserver | null = null
    let onScreen = false
    let tabVisible = document.visibilityState !== 'hidden'

    let last = 0
    let fade = 0
    let px = 0.5, py = 0.5
    let grav = 0, targetGrav = 0
    /* Eased, so a fast scroll does not snap the lattice into rank. */
    let resolve = 0

    const frame = (now: number) => {
      if (disposed || !field) return
      const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60
      last = now

      const rect = host.getBoundingClientRect()
      /* 0 as the section enters, 1 as it leaves. Remapped so the lattice is
         fully ranked by the time the cards are centred, rather than still
         resolving as the reader scrolls past them. */
      const raw = sectionProgress({ top: rect.top, height: rect.height }, window.innerHeight)
      const target = clamp01(raw * 1.9)
      resolve += (target - resolve) * (1 - Math.exp(-dt * 3))
      grav += (targetGrav - grav) * (1 - Math.exp(-dt * 4))
      fade += (1 - fade) * (1 - Math.exp(-dt * 2))

      field.render(dt, resolve, px, py, grav, fade)
      if (!litRef.current) { litRef.current = true; setLit(true) }
      raf = requestAnimationFrame(frame)
    }

    const tick = () => {
      const run = onScreen && tabVisible && !disposed && !!field
      if (run && !raf) { last = 0; raf = requestAnimationFrame(frame) }
      else if (!run && raf) { cancelAnimationFrame(raf); raf = 0 }
    }

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect()
      px = (e.clientX - r.left) / Math.max(r.width, 1)
      py = 1 - (e.clientY - r.top) / Math.max(r.height, 1)
      targetGrav = 1
    }
    const onLeave = () => { targetGrav = 0 }
    const onVisibility = () => { tabVisible = document.visibilityState !== 'hidden'; tick() }

    void import('./latticeField')
      .then(({ createLatticeField }) => {
        if (disposed) return
        field = createLatticeField(canvas, { cool, ai })
        if (!field) return

        io = new IntersectionObserver((es) => {
          onScreen = es.some((en) => en.isIntersecting)
          tick()
        }, { rootMargin: '140px' })
        io.observe(host)

        if (typeof ResizeObserver === 'function') {
          ro = new ResizeObserver(() => field?.resize())
          ro.observe(host)
        }
        host.addEventListener('pointermove', onMove, { passive: true })
        host.addEventListener('pointerleave', onLeave)
        document.addEventListener('visibilitychange', onVisibility)
        tick()
      })
      .catch(() => { /* section stands as-is */ })

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      io?.disconnect()
      ro?.disconnect()
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
      field?.dispose()
      field = null
      litRef.current = false
      setLit(false)
    }
  }, [enhance, hostRef])

  if (!enhance) return null

  return (
    <canvas
      ref={canvasRef}
      className={`mm-lattice${lit ? ' is-lit' : ''}`}
      aria-hidden="true"
      tabIndex={-1}
      role="presentation"
    />
  )
}

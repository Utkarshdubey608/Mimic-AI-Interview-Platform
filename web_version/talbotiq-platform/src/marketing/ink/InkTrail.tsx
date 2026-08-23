/**
 * The ink trail layer.
 *
 * Same contract as Field.tsx, and for the same reasons: the panel's finished
 * design is always there, and this is an enhancement that cross-fades in on top
 * only when the visitor has not asked for reduced motion, the device is not a
 * software renderer or a low-core machine, the pointer is a real pointer, the
 * colour token resolves, and the WebGL2 program actually compiles. Any failure
 * leaves the hero exactly as it is without this file.
 *
 * Three deliberate differences from Field.tsx:
 *
 * IT ONLY RUNS UNDER A POINTER. `(hover: hover) and (pointer: fine)` — a
 * cursor trail on a touch screen is a trail with nothing to follow, and the
 * loop is idle the whole time the pointer is elsewhere on the page, so it costs
 * nothing to leave mounted.
 *
 * IT ARMS AFTER FIRST PAINT, on an idle callback, because the home page's LCP is
 * the worst number on the site and nothing decorative belongs in front of it.
 *
 * IT STOPS ITSELF. Once the pointer leaves and the dye has decayed, the render
 * loop parks until the pointer returns. An animation frame that draws an empty
 * field is a fan spinning for nobody.
 */
import { useEffect, useRef, useState } from 'react'

import { parseColor } from '../field/tokens'
import { readGate, watchGate } from './gate'
import type { InkFluid } from './inkFluid'

export function InkTrail({ hostRef }: {
  /**
   * Optional. By default the ink takes its own parent as the host, because the
   * canvas is always rendered as a direct child of the section it belongs to —
   * which means mounting it anywhere is `<InkTrail />` with no ref to thread
   * through, and one less thing for a future call site to get wrong. Pass a ref
   * only when the intended host is not the immediate parent.
   */
  hostRef?: React.RefObject<HTMLElement | null>
} = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [enhance, setEnhance] = useState(false)
  const [lit, setLit] = useState(false)
  const litRef = useRef(false)

  /* ── Gate ───────────────────────────────────────────────────────────────
     Shared with the lattice field. The CSS hides this layer under reduced
     motion, reduced transparency and more-contrast; the gate makes sure it is
     never built in the first place, because a display:none canvas still holds a
     GL context and still runs its loop. */
  useEffect(() => {
    let cancelled = false
    let idle = 0

    const sync = () => {
      const g = readGate()
      if (!g.allowed || !g.finePointer) { setEnhance(false); litRef.current = false; setLit(false); return }
      const ric = (window as unknown as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
      }).requestIdleCallback
      const arm = () => {
        if (cancelled) return
        const g2 = readGate()
        if (!g2.allowed || !g2.finePointer) return
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
    const canvas = canvasRef.current
    if (!canvas) return
    const host = hostRef?.current ?? canvas.parentElement
    if (!host) return

    /* The cyan comes from the stylesheet, so this cannot drift from the palette. */
    const color = parseColor(getComputedStyle(host).getPropertyValue('--mm-ai'))
    if (!color) return

    let fluid: InkFluid | null = null
    let raf = 0
    let disposed = false
    let ro: ResizeObserver | null = null
    let io: IntersectionObserver | null = null

    let onScreen = false
    let tabVisible = document.visibilityState !== 'hidden'

    /* Pointer state. `force` is what the visitor is doing; `fade` is the layer
       coming up for the first time. Kept separate so re-entering the panel does
       not replay the fade-in. */
    let cx = 0.5, cy = 0.5
    let force = 0, targetForce = 0
    let fade = 0
    let last = 0
    /* Energy: how much ink is plausibly still in the field. The loop parks when
       the pointer is away AND this has run down, so an idle hero draws nothing. */
    let energy = 0

    const frame = (now: number) => {
      if (disposed || !fluid) return
      const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60
      last = now

      /* Ease force and fade rather than stepping them: the approach is the
         cross-fade, and it is one multiply. */
      force += (targetForce - force) * (1 - Math.exp(-dt * 5))
      fade += (1 - fade) * (1 - Math.exp(-dt * 2.2))
      energy = Math.max(force, energy - dt * 0.55)

      fluid.render(dt, cx, cy, force, fade)
      if (!litRef.current) { litRef.current = true; setLit(true) }

      if (targetForce <= 0.001 && energy <= 0.001) {
        /* Park. The next pointermove restarts it. */
        raf = 0
        last = 0
        return
      }
      raf = requestAnimationFrame(frame)
    }

    const kick = () => {
      if (disposed || raf || !fluid) return
      if (!onScreen || !tabVisible) return
      last = 0
      raf = requestAnimationFrame(frame)
    }

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect()
      cx = (e.clientX - r.left) / Math.max(r.width, 1)
      cy = 1 - (e.clientY - r.top) / Math.max(r.height, 1)
      targetForce = 1
      energy = 1
      kick()
    }
    const onLeave = () => { targetForce = 0 }

    const onVisibility = () => {
      tabVisible = document.visibilityState !== 'hidden'
      if (!tabVisible && raf) { cancelAnimationFrame(raf); raf = 0; last = 0 }
      else kick()
    }

    void import('./inkFluid')
      .then(({ createInkFluid }) => {
        if (disposed) return
        fluid = createInkFluid(canvas, { color })
        if (!fluid) return   // no WebGL2 / no float target; hero stands as-is

        io = new IntersectionObserver((es) => {
          onScreen = es.some((en) => en.isIntersecting)
          if (!onScreen && raf) { cancelAnimationFrame(raf); raf = 0; last = 0 }
          else kick()
        }, { rootMargin: '80px' })
        io.observe(host)

        if (typeof ResizeObserver === 'function') {
          ro = new ResizeObserver(() => fluid?.resize())
          ro.observe(host)
        }

        host.addEventListener('pointermove', onMove, { passive: true })
        host.addEventListener('pointerleave', onLeave)
        document.addEventListener('visibilitychange', onVisibility)
      })
      .catch(() => { /* chunk failed; hero stands as-is */ })

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      io?.disconnect()
      ro?.disconnect()
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
      fluid?.dispose()
      fluid = null
      litRef.current = false
      setLit(false)
    }
  }, [enhance, hostRef])

  if (!enhance) return null

  return (
    <canvas
      ref={canvasRef}
      className={`mm-ink${lit ? ' is-lit' : ''}`}
      aria-hidden="true"
      tabIndex={-1}
      role="presentation"
    />
  )
}

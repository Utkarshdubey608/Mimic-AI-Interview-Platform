import { useEffect, useRef, useState } from 'react'
import { parseColor } from './field/tokens'
// `import type`, in its own statement, and it must stay that way: a value import
// from this module — even one unused at runtime — pulls the whole WebGL program
// into this chunk and cancels the dynamic import below. A type-only import is
// erased entirely, so the edge does not exist in the built graph.
import type { AmbientField } from './field/ambient'

/**
 * The ambient layer on an ink field.
 *
 * Renders a plain <div> that ALWAYS carries the finished CSS design (see
 * `.mm-field` in mimicSite.css — layered gradients in the same tokens). The
 * WebGL canvas is an enhancement that cross-fades in on top of it when, and
 * only when, every one of these is true:
 *
 *   · the visitor has not asked for reduced motion;
 *   · the device is not a software renderer or a low-core machine
 *     (detectTier, reused from the intro film rather than reimplemented);
 *   · the ink and light tokens resolve to real colours;
 *   · the ambient chunk loads and a GL context is granted.
 *
 * Any failure leaves the CSS field showing, which is why there is no error
 * state and nothing is reported: the fallback is not a degraded mode, it is the
 * design with one layer missing.
 *
 * While mounted the loop runs only when the field is on screen AND the tab is
 * visible. An off-screen shader is a laptop fan spinning for nobody — the same
 * rule DemoVideo applies to its footage.
 *
 * aria-hidden, and never focusable: this is lighting. It carries no information
 * that the section's own heading and copy do not already give in text.
 */
export function Field({ seed = 0, amp, className = '' }: {
  /**
   * Offsets this field's clock. Two fields on one page with the same seed rake
   * in lockstep, which reads as a single mechanism driving both rather than as
   * light falling on two different surfaces. Passed explicitly rather than
   * randomised so a given section looks the same on every load.
   */
  seed?: number
  /** Peak lift above the ink ground. Defaults to the shader's own cap. */
  amp?: number
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Gate the <canvas> out of the DOM entirely until the enhancement is actually
  // going to run, so reduced-motion and low-tier visitors get no extra element.
  const [enhance, setEnhance] = useState(false)
  const [lit, setLit] = useState(false)   // first frame drawn; drives the fade-in
  // Mirrors `lit` for the render loop to read. The loop's closure captures state
  // by value, so testing `lit` there would call setLit on every single frame
  // forever — React bails out of the re-render, but the scheduling is not free.
  const litRef = useRef(false)

  // ── Gate ────────────────────────────────────────────────────────────────
  // Reduced motion is watched live rather than read once: someone toggling the
  // OS setting mid-session should see the field stop, not on the next reload.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    let cancelled = false

    const sync = () => {
      if (mq.matches) { setEnhance(false); litRef.current = false; setLit(false); return }
      // Deferred import, so `tier` is not in the marketing entry graph either.
      void import('@/features/intro/tier')
        .then(({ detectTier }) => {
          if (cancelled || mq.matches) return
          setEnhance(detectTier() !== 'low')
        })
        .catch(() => { /* CSS field stands */ })
    }

    sync()
    mq.addEventListener('change', sync)
    return () => { cancelled = true; mq.removeEventListener('change', sync) }
  }, [])

  // ── The loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enhance) return
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return

    // Read the ramp off the element itself, so the shader is fed the
    // stylesheet's own values and cannot drift from the palette. `--mm-ink` is
    // the ground; `--mm-field-light` is the lit end.
    //
    // That token exists ONLY for this. Reading `--mm-on-ink-accent` here instead
    // seemed tidier — one accent, used everywhere — but the accent is sized for
    // single elements, and pouring it across a whole surface turned every ink
    // band the colour of the accent. The same value must drive the CSS lamps in
    // mimicSite.css, or the canvas cross-fades to a different colour than the
    // fallback it is replacing.
    const cs = getComputedStyle(host)
    const ink = parseColor(cs.getPropertyValue('--mm-ink'))
    const light = parseColor(cs.getPropertyValue('--mm-field-light'))
    if (!ink || !light) return

    let field: AmbientField | null = null
    let raf = 0
    let ro: ResizeObserver | null = null
    let io: IntersectionObserver | null = null
    let disposed = false

    // Visible AND on-screen are tracked separately because they change for
    // different reasons; the loop runs on the AND of the two.
    let onScreen = false
    let tabVisible = document.visibilityState !== 'hidden'

    // The clock accumulates only while running, so pausing and resuming does not
    // teleport the light across the field — it picks up where it stopped.
    let elapsed = 0
    let last = 0

    const frame = (now: number) => {
      if (disposed || !field) return
      // A first frame after a pause has no meaningful delta; clamp it so a
      // backgrounded tab cannot resume with a multi-second jump.
      const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 0
      last = now
      elapsed += dt
      field.render(elapsed)
      if (!litRef.current) { litRef.current = true; setLit(true) }
      raf = requestAnimationFrame(frame)
    }

    const tick = () => {
      const shouldRun = onScreen && tabVisible && !disposed && !!field
      if (shouldRun && !raf) {
        last = 0
        raf = requestAnimationFrame(frame)
      } else if (!shouldRun && raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }

    const onVisibility = () => { tabVisible = document.visibilityState !== 'hidden'; tick() }

    void import('./field/ambient')
      .then(({ createAmbientField }) => {
        if (disposed) return
        field = createAmbientField(canvas, {
          ink, light, amp, seed,
          /* An opaque canvas with a dead context paints WHITE over this section's
             dark ground — see the note in ambient.ts. Take it down and let the CSS
             field show, which is what this layer has always been an enhancement
             on top of. */
          onLost: () => { setEnhance(false) },
        })
        if (!field) return   // no context; CSS field stands

        // rootMargin so the first frame is already drawn by the time the field
        // scrolls in, rather than the reader watching it fade up.
        io = new IntersectionObserver((es) => {
          onScreen = es.some((e) => e.isIntersecting)
          tick()
        }, { rootMargin: '120px' })
        io.observe(host)

        if (typeof ResizeObserver === 'function') {
          // Coalesced by the browser to one callback per frame, and resize() only
          // touches the drawing buffer when the size actually changed — so a
          // window drag does not reallocate on every event.
          ro = new ResizeObserver(() => field?.resize())
          ro.observe(host)
        }
        document.addEventListener('visibilitychange', onVisibility)
        tick()
      })
      .catch(() => { /* chunk failed; CSS field stands */ })

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      io?.disconnect()
      ro?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      field?.dispose()
      field = null
      // So a remount fades in again rather than snapping to a lit canvas that
      // has not drawn anything yet.
      litRef.current = false
      setLit(false)
    }
  }, [enhance, amp, seed])

  return (
    <div ref={hostRef} className={`mm-field ${className}`.trim()} aria-hidden="true">
      {enhance && (
        <canvas
          ref={canvasRef}
          className={`mm-field-gl${lit ? ' is-lit' : ''}`}
          // Not focusable and not in the accessibility tree. The wrapper is
          // already aria-hidden; this is belt and braces for the canvas element,
          // which some engines expose as an interactive region.
          tabIndex={-1}
          role="presentation"
        />
      )}
    </div>
  )
}

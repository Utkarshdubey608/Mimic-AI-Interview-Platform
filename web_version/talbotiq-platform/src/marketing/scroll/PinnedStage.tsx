import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { canPinStage, clamp01, stepProgress } from './progress'
import { scrollToY } from './ScrollProvider'

/**
 * A section that pins to the viewport and converts scroll distance into a step
 * index. Owns no visual opinion — pinning and step arithmetic only.
 *
 * Pinning is CSS `position: sticky`, not a GSAP pin. Sticky does not clone or
 * reposition the subtree, so the DOM order the screen reader walks is the DOM
 * order that was authored. GSAP still drives the site's scroll feel; this just
 * does not need it to hold an element still.
 *
 * Scroll position is the single source of truth for the current step. A control
 * inside the stage does not set the step directly — it calls `goToStep`, which
 * scrolls, and the scroll handler derives the step from where the page ended
 * up. One source, so a click and a scroll can never disagree.
 *
 * Not pinned when the visitor asked for reduced motion, below 1081px, or when
 * the content is taller than the viewport it would be pinned to. A pinned
 * section on a 390px viewport traps the reader between the top and bottom of a
 * screen they cannot scroll past quickly, and a pinned section that does not fit
 * is cut in half by the sticky box — both worse failures than losing the effect.
 * In every case the stage renders as ordinary flow and the controls behave
 * exactly as they did before.
 */
export function PinnedStage({
  steps, onStep, id, className = '', labelledBy, vhPerStep = 30, backdrop, children,
}: {
  steps: number
  onStep: (i: number) => void
  id?: string
  className?: string
  labelledBy?: string
  /**
   * Decoration rendered behind the stage — the ambient field, in practice.
   *
   * A named slot rather than something the caller buries in `children`, because
   * where this lands matters twice over: `contentHeight` below measures the
   * inner box's children to decide whether the stage may pin at all, and an
   * `inset:0` layer measures as tall as whatever it is anchored to. Rendered
   * here it is first in the box and skipped by that measurement (out-of-flow
   * children are explicitly excluded), so it cannot report the stage as too tall
   * to pin.
   */
  backdrop?: ReactNode
  /**
   * Scroll distance each step costs, in viewport heights.
   *
   * A full 100vh per step means five steps hold the reader for five screens
   * before the page continues — the section stops being a device for reading
   * the story and becomes a toll gate. At 30 the whole sequence passes in
   * roughly two screens: the steps still advance as you scroll, but nobody is
   * detained. The controls remain clickable throughout, so the section can also
   * simply be skipped.
   */
  vhPerStep?: number
  children: (api: { step: number; pinned: boolean; goToStep: (i: number) => void }) => ReactNode
}) {
  const hostRef = useRef<HTMLElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [pinned, setPinned] = useState(false)
  const [step, setStep] = useState(0)
  const stepRef = useRef(0)

  // Held in a ref so an inline arrow from the caller does not re-run the effect
  // on every render and tear the scroll listener down mid-scroll.
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const wide = window.matchMedia('(min-width: 1081px)')

    let frame = 0
    let attached = false

    const read = () => {
      frame = 0
      const host = hostRef.current
      if (!host) return
      const r = host.getBoundingClientRect()
      // Progress across the scrollable overhang: 0 when the stage's top reaches
      // the top of the viewport, 1 when its bottom reaches the bottom.
      const travel = r.height - window.innerHeight
      const p = travel > 0 ? clamp01(-r.top / travel) : 0
      const next = stepProgress(p, steps).step
      if (next !== stepRef.current) {
        stepRef.current = next
        setStep(next)
        onStepRef.current(next)
      }
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read) }

    // Native scroll, not the engine's tick: Lenis scrolls the window for real,
    // so this fires either way and the stage keeps working if the engine chunk
    // never loads.
    const attach = () => {
      if (attached) return
      attached = true
      window.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', onScroll, { passive: true })
      read()
    }
    const detach = () => {
      if (!attached) return
      attached = false
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) { cancelAnimationFrame(frame); frame = 0 }
    }

    // How much room the stage's content needs.
    //
    // Measured on the inner box's CHILDREN, never on the inner box itself: once
    // pinned it is 100vh, so measuring it would answer its own question — pin,
    // become 100vh, no longer fit, unpin, shrink, fit, pin, forever. The
    // children keep their natural height in both states. The inner box is a
    // flex row, so the tallest child is what the stage has to afford.
    const contentHeight = () => {
      const inner = innerRef.current
      if (!inner) return 0
      let h = 0
      for (const el of Array.from(inner.children)) {
        // Out-of-flow children are not content the stage has to afford room for,
        // and an `inset:0` layer measures as tall as its container — which would
        // make the fit test answer its own question. Skipped explicitly so a
        // future decorative layer dropped in here cannot silently unpin the
        // section.
        if (getComputedStyle(el).position === 'absolute') continue
        h = Math.max(h, (el as HTMLElement).offsetHeight)
      }
      return h
    }

    const sync = () => {
      const canPin = canPinStage({
        reduced: reduced.matches,
        wide: wide.matches,
        contentH: contentHeight(),
        viewportH: window.innerHeight,
      })
      setPinned(canPin)
      if (canPin) attach()
      else {
        detach()
        // Leaving pinned mode must not strand the panel on step 3 of 5 — the
        // static list shows every step, so the detail returns to the first.
        stepRef.current = 0
        setStep(0)
        onStepRef.current(0)
      }
    }
    // Whether the content fits is not something a media query can report: a
    // window dragged shorter, a browser zoom, a larger default font size or a
    // font swapping in all change the answer without changing a breakpoint. So
    // the fit is re-checked on resize and whenever the content itself resizes,
    // both coalesced into a frame so a drag does not measure on every event.
    let fitFrame = 0
    const recheck = () => {
      if (fitFrame) return
      fitFrame = requestAnimationFrame(() => { fitFrame = 0; sync() })
    }

    sync()
    reduced.addEventListener('change', sync)
    wide.addEventListener('change', sync)
    window.addEventListener('resize', recheck, { passive: true })

    // The inner box is observed alongside its children so a child React swaps
    // out is still covered; re-measuring is cheap and idempotent.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(recheck) : null
    const inner = innerRef.current
    if (ro && inner) {
      ro.observe(inner)
      for (const el of Array.from(inner.children)) ro.observe(el)
    }

    return () => {
      reduced.removeEventListener('change', sync)
      wide.removeEventListener('change', sync)
      window.removeEventListener('resize', recheck)
      ro?.disconnect()
      if (fitFrame) cancelAnimationFrame(fitFrame)
      detach()
    }
  }, [steps, vhPerStep])

  const goToStep = useCallback((i: number) => {
    const host = hostRef.current
    if (!pinned || !host) { stepRef.current = i; setStep(i); onStepRef.current(i); return }
    const travel = host.offsetHeight - window.innerHeight
    if (travel <= 0) return
    // Land mid-step rather than on its boundary, so a click does not settle on
    // the knife edge between two steps where a pixel of scroll flips it back.
    scrollToY(host.offsetTop + ((i + 0.5) / steps) * travel)
  }, [pinned, steps, vhPerStep])

  return (
    <section
      ref={hostRef}
      id={id}
      aria-labelledby={labelledBy}
      className={`${className}${pinned ? ' mm-stage' : ''}`.trim()}
      style={pinned ? { height: `calc(${steps * vhPerStep}vh + 100vh)` } : undefined}
    >
      <div ref={innerRef} className={pinned ? 'mm-stage-sticky' : undefined}>
        {/* Inside the sticky box, not the host section. When pinned the host is
            several viewports tall, so a layer stretched over the host would be
            that tall too — expensive, and the light would slide up the screen as
            the reader scrolls instead of holding still behind the stage. In the
            sticky box it is exactly the 100vh the reader is looking at. When the
            stage is not pinned the box is static and the layer resolves against
            the section, which is then an ordinary height. */}
        {backdrop}
        {children({ step, pinned, goToStep })}
      </div>
    </section>
  )
}

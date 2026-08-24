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
 * Not pinned when the visitor asked for reduced motion, below `minWidth`, or
 * when the content is taller than the viewport it would be pinned to. A pinned
 * section that does not fit is cut in half by the sticky box, which is a worse
 * failure than losing the effect. Width is a coarse floor a caller sets for its
 * own layout — a stage with a one-column phone form passes 0 and lets the fit
 * test decide alone.
 * In every case the stage renders as ordinary flow and the controls behave
 * exactly as they did before.
 */
export function PinnedStage({
  steps, onStep, id, className = '', labelledBy, vhPerStep = 30, minWidth = 1081,
  backdrop, onProgress, children,
}: {
  steps: number
  onStep: (i: number) => void
  id?: string
  className?: string
  labelledBy?: string
  /**
   * Narrowest viewport this stage may pin on, in px.
   *
   * A coarse floor, not the real decision — that is `canPinStage`, which measures
   * whether the content actually fits. This exists for stages whose LAYOUT has a
   * minimum width: the process stage puts its steps beside its copy and has no
   * one-column form, so below the desktop breakpoint it should stay an ordinary
   * section however much vertical room a phone happens to have.
   *
   * A stage with a phone layout passes 0 and lets the fit test answer alone. The
   * formats deck does: its panel becomes one column under 1081px, and whether a
   * phone gets the deck is then a question about height, which is the question
   * the fit test was written to answer.
   */
  minWidth?: number
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
  /**
   * Raw 0‥1 progress across the stage, on every scroll frame while pinned, and
   * 0 once it stops pinning.
   *
   * For a stage whose content moves continuously rather than stepping. Write to
   * the DOM directly from here — this fires at frame rate, so setting React
   * state in it would re-render the whole stage sixty times a second.
   */
  onProgress?: (p: number) => void
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
  // Same reason as onStep: held in a ref so an inline arrow from the caller does
  // not re-run the effect on every render and tear the listener down mid-scroll.
  const onProgressRef = useRef(onProgress)
  onProgressRef.current = onProgress

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const wide = window.matchMedia(`(min-width: ${minWidth}px)`)

    let frame = 0
    let attached = false

    const read = () => {
      frame = 0
      const host = hostRef.current
      if (!host) return
      const r = host.getBoundingClientRect()
      // Progress across the scrollable overhang: 0 when the stage's top reaches
      // the top of the viewport, 1 when its bottom reaches the bottom.
      //
      // MEASURED FROM THE STICKY BOX, not from `window.innerHeight`. The host is
      // sized `calc(N*svh + 100svh)` and the box inside it is `100svh`, so the
      // overhang is exactly N*svh — and measuring the box is how this arithmetic
      // learns that without having to agree with a unit it cannot see. It used to
      // read `innerHeight`, which on a phone is the CURRENT visible height while
      // the height authored in CSS is a fixed one: as a URL bar collapses the
      // denominator moved while the numerator did not, and the deck slid sideways
      // under a stationary finger — 0.11 of a panel mid-deck, 0.20 near the end.
      // On a desktop the two are the same number and nothing changes.
      const travel = r.height - stageHeight()
      const p = travel > 0 ? clamp01(-r.top / travel) : 0
      /* Raw progress, for a stage that moves CONTINUOUSLY with the scroll rather
         than stepping — a horizontal track, say.
         Handed over as a CALLBACK, not as a CSS custom property on this host.
         The custom-property version was measured and it was the wrong tool: a
         custom property set here invalidates computed style for every descendant
         that inherits it, on every scroll frame, and custom properties are not
         compositor-animatable — so a transform depending on one is recomputed on
         the main thread each frame. Scrolling this section ran at 61 frames per
         1400ms against 85 for the stage next door. A callback lets the consumer
         write `transform` straight onto the one element that moves. */
      onProgressRef.current?.(p)
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
    /* The pinned box's own height, which is `100svh` in CSS. Falls back to the
       visual viewport before the box exists — there is nothing else to ask, and
       the only consumer of the fallback is a frame in which travel is 0 anyway. */
    const stageHeight = () => {
      const inner = innerRef.current
      const h = inner ? inner.getBoundingClientRect().height : 0
      return h > 0 ? h : window.innerHeight
    }

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
        onProgressRef.current?.(0)
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
  }, [steps, vhPerStep, minWidth])

  const goToStep = useCallback((i: number) => {
    const host = hostRef.current
    if (!pinned || !host) { stepRef.current = i; setStep(i); onStepRef.current(i); return }
    // Same measurement as `read()` above, for the same reason: a click and a
    // scroll must agree about where step i lives, and they only do if both derive
    // travel from the box that is actually holding the stage still.
    const inner = innerRef.current
    const stageH = inner && inner.getBoundingClientRect().height > 0
      ? inner.getBoundingClientRect().height
      : window.innerHeight
    const travel = host.offsetHeight - stageH
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
      /* `svh`, matching `.mm-stage-sticky`. See the note there: `vh` is the tall
         viewport a phone only has once its URL bar has gone, so a stage sized in
         it is taller than the screen while the bar is present, and `dvh` changes
         mid-scroll. `svh` is invariant for the whole scroll. On a desktop all
         three are the same number. */
      style={pinned ? { height: `calc(${steps * vhPerStep}svh + 100svh)` } : undefined}
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

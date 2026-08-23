/**
 * Six interview formats, one at a time, travelling sideways as the reader
 * scrolls.
 *
 * REBUILT FROM SCRATCH. The version this replaces was deleted rather than
 * patched, because it had three faults that presented as three different bugs:
 *
 * 1. It called itself `showcase`, and `.mimic-site .showcase` was already taken
 *    — it is the white bordered card around the workspace screenshots further
 *    down the same page. The section silently inherited `background:#fff`, a
 *    border, a border-radius, a shadow and `overflow:hidden`. A dark section
 *    rendering white, a rounded corner cutting across the join, and this
 *    section's content appearing over the next one were all that one collision.
 *    Every class here is namespaced `mm-formats`/`fmt-`, checked against the
 *    stylesheet first.
 *
 * 2. It laid the six panels out as one 6816px-wide track and translated the
 *    track. With `will-change:transform` that became a single enormous
 *    compositor layer, and a promoted layer inside a `position:sticky` ancestor
 *    can have its clip computed against the wrong ancestor — so it kept painting
 *    after the sticky box had gone, over the section below, and ghosted its own
 *    previous position. Here the panels stack into ONE grid cell and each gets
 *    its own transform. Nothing is ever wider than the deck, and there is no
 *    `will-change` anywhere.
 *
 * 3. Whether the deck was stacked was decided by CSS (a media query) and whether
 *    anything drove it was decided by JavaScript (PinnedStage's fit test), and
 *    the two could disagree. When they did, six panels stacked in one cell with
 *    nothing moving them — six panels painted on top of each other. Now the
 *    stacked panels are `visibility:hidden` in CSS with only the current one
 *    shown, so the undriven state is one readable panel; and the film is capped
 *    in `vh` so the fit test passes wherever the media query matches.
 *
 * WHAT IT IS UNPINNED. Below 1081px, under reduced motion, or on a short
 * viewport, this is a plain vertical list of six formats — the same content, in
 * order, with no transforms and nothing hidden. Not a degraded effect: a list.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { DemoVideo } from '../DemoVideo'
import { Field } from '../Field'
import { deckHead, PinnedStage } from '../scroll'
import { MODES, noFilmReason } from './modes'

/**
 * The panel is translated and faded, and NOT scaled. Scaling it was a round of
 * verification: a scale pulls the box in toward its own centre, which for an
 * off-stage panel is off-stage — so its near edge came back INSIDE the deck and a
 * 3%-wide sliver of a panel nobody should be able to see sat against the deck's
 * edge. The recede lives on the two blocks inside the panel, where shrinking
 * pulls content away from the deck's edge instead of into it.
 *
 * Once a panel is entirely clipped it stops being painted at all. Being a
 * discrete state rather than the tail of an opacity ramp, a hidden panel cannot
 * leave a half-painted trail behind it — which is what the ghosting was.
 */
/**
 * How far a panel travels per step, as a multiple of the deck's width.
 *
 * More than one, which means there is a GAP between consecutive panels rather
 * than one butting straight onto the next. That gap is not decoration. These
 * panels are two columns — copy left, film right — on a shared ground with no
 * frame of their own, so at exactly 1.00 the outgoing panel's film ended up
 * touching the incoming panel's copy in the middle of the deck, and the two read
 * as one panel with a broken layout rather than as two panels passing. Fourteen
 * percent of the deck is enough dark ground between them to separate them.
 */
const SPREAD = 1.14
/**
 * Opacity is `1 - edge ** FADE_POW`, where `edge` is 0 centre stage and 1 at the
 * moment the panel is entirely clipped away. Expressing the fade against the CLIP
 * rather than against distance is what makes it exact: the curve provably reaches
 * zero at the same instant the panel has no visible area left.
 *
 * That mattered, and it goes on mattering. Faded against distance instead, the
 * opacity was still 0.21 when `edge` was a thousandth short of 1 — and a
 * thousandth of a deck width is a 1px strip of the NEXT panel, at a fifth
 * opacity, hard against the deck's edge. A hairline that reads as a rendering
 * fault, and the artifact the verification harness caught here.
 *
 * It is also what makes the tilt below safe. A `rotateY` under perspective
 * magnifies the half of the film that swings toward the viewer, so the film's
 * near edge reaches about 11px OUTSIDE its own box — which for a panel on its way
 * out is 11px past the deck's clip. That sliver only exists where `edge` is near
 * 1, where this curve has already taken the whole panel to zero.
 *
 * The exponent keeps the curve nearly flat where the panels are actually being
 * read (0.98 a fifth of the way out, 0.76 at the halfway point of a transition) so
 * the movement carries the transition. A linear fade would sit both panels at half
 * in the middle, which is a cross-dissolve, not a pass.
 */
const FADE_POW = 2.5
/** Scale the panel's contents lose per deck width off centre. */
const RECEDE = 0.05
/**
 * Degrees the film turns as its panel travels, under an inline perspective.
 *
 * The one piece of real depth in the section. The film is the only object with
 * enough surface to read as a plane rather than as text that happens to be
 * moving, so it is the only thing that turns: on its way out it angles away from
 * the reader, on its way in it comes square. Six degrees — enough to see the
 * near edge lift, not enough to distort the interface inside it, which is
 * evidence and has to stay readable.
 *
 * Deliberately NOT on the panel. A rotation on the panel would move the panel's
 * own edges, and the panel's edges are what the deck clips against.
 */
const TILT = 6
/**
 * Rem of extra displacement the copy's own lines take, on top of the panel's.
 *
 * This is the difference between a panel that slides and a panel that ASSEMBLES.
 * Each line in the copy carries its own multiplier (STAGE below), so the heading
 * arrives first and settles, then the tag, then the sentence, then the meta, and
 * the button last — and on the way out they leave in the same order. The panel
 * still moves as one object; the reading order inside it is what staggers.
 */
const LEAD = 2.6
/**
 * Per-line multipliers, in the copy's DOM order: counter, heading, tag,
 * description, meta, button.
 *
 * A SMALLER number means the line sits closer to its resting place, so it arrives
 * sooner. The heading is lowest because it is the thing being announced and every
 * other line is subordinate to it; the button is highest because it is the last
 * thing anyone needs. Read down the column and the numbers are the reading order.
 */
const STAGE = [0.9, 0.3, 0.55, 0.75, 1, 1.2]
/**
 * How hard the reader's scroll speed shows in the panel.
 *
 * Fast motion with perfectly crisp edges reads as a slideshow advancing, not as
 * something moving fast — the eye expects speed to smear. Real motion blur is not
 * available at a price worth paying, and `filter:blur` on a 1200px panel every
 * frame is not it, so this is the standard approximation: the contents stretch
 * along the direction of travel and thin across it, in proportion to how fast the
 * panel is actually moving. At a slow read it is not there at all; on a flick it
 * is what makes the flick feel like one.
 *
 * `RUSH_GAIN` converts panels-per-second into a 0‥1 amount, saturating at about
 * half a panel per second — roughly the speed of a deliberate wheel scroll.
 */
const RUSH_GAIN = 2.2
const RUSH_STRETCH = 0.05
const RUSH_THIN = 0.022
/** Below this, in panels per second, the smear has finished relaxing. */
const RUSH_REST = 0.005

export function FormatShowcase() {
  const slides = useRef<(HTMLElement | null)[]>([])
  const copies = useRef<(HTMLElement | null)[]>([])
  /* The copy's own lines, captured when the block's ref lands rather than queried
     per frame. `children` is a live collection, so this stays correct if React
     ever swaps a line out. */
  const copyKids = useRef<HTMLElement[][]>([])
  const films = useRef<(HTMLElement | null)[]>([])
  const seamRef = useRef<HTMLDivElement | null>(null)
  /** Scroll state carried between frames: position, previous position, eased
      velocity in panels per second, the last frame's timestamp, and the pending
      relaxation frame. */
  const motion = useRef({ p: 0, pp: 0, v: 0, t: 0, raf: 0, dir: 0 })
  /** PinnedStage's `goToStep`, parked here by the deck so the settle can reach
      it. It only exists inside the render prop, and the motion loop is out here. */
  const snapTo = useRef<((i: number) => void) | null>(null)
  /** True only while PinnedStage is actually pinned and driving this deck. */
  const driving = useRef(false)
  const [cur, setCur] = useState(0)
  const curRef = useRef(0)

  /**
   * One transform per on-stage panel, per scroll frame, written straight to the
   * element.
   *
   * Not a CSS custom property on an ancestor: a custom property set on every
   * frame invalidates computed style for the whole inheriting subtree and is not
   * compositor-animatable, so the transform depending on it is recomputed on the
   * main thread. PinnedStage's own comment records the measurement — 61 frames
   * per 1400ms against 85 for the stage next door.
   */
  /**
   * Every moving style in the section, written for one moment.
   *
   * Called straight from the scroll callback so the panels move in the SAME frame
   * the scroll was read — scheduling a rAF from inside PinnedStage's rAF would
   * have painted one frame late, and a scroll-linked transform that lags by 16ms
   * stops feeling attached to the wheel. The relaxation loop below calls it too,
   * which is the only reason it takes `rush` as an argument rather than reading
   * it: the loop needs to keep painting after the scrolling has stopped.
   */
  const paint = useCallback((p: number, rush: number) => {
    const n = MODES.length
    const head = deckHead(p, n)

    /* The stretch is along the direction of travel, so it is signed by nothing —
       a smear looks the same whichever way the thing is going. Computed once, not
       per panel. */
    const sx = 1 + rush * RUSH_STRETCH
    const sy = 1 - rush * RUSH_THIN

    for (let i = 0; i < n; i++) {
      const el = slides.current[i]
      if (!el) continue
      const off = i - head          // in steps; 0 is centre stage
      // Fraction of the way to being entirely clipped: 0 centre stage, 1 gone.
      const edge = Math.abs(off) * SPREAD

      if (edge >= 1) {
        if (el.style.visibility !== 'hidden') el.style.visibility = 'hidden'
        continue
      }
      // Explicitly `visible`, never the empty string: clearing the inline value
      // falls back to the stylesheet, which hides every panel but the current
      // one — so "unhiding" that way hid it instead.
      if (el.style.visibility !== 'visible') el.style.visibility = 'visible'
      el.style.opacity = String(1 - edge ** FADE_POW)
      // Translate and nothing else. The panel's edges are what the deck clips
      // against, so anything that moves them — a scale, a rotation — puts a
      // sliver of an off-stage panel against the deck's edge.
      el.style.transform = `translate3d(${off * SPREAD * 100}%,0,0)`

      const recede = 1 - edge * RECEDE

      /* TRANSLATION ONLY on the copy. The lines used to carry the recede and the
         smear as a scale too, and a near-1 fractional scale on text is the one
         thing here that cannot be done safely: it promotes every line to its own
         layer and re-rasterises the glyphs at a non-integer size every frame. On
         the reporter's machine the effect was that the white heading, and the
         white label in the rail, occupied their space and painted NOTHING, while
         the grey text around them rendered fine.
         A composited layer TRANSLATED by a fractional offset is just an offset —
         no re-raster, no risk. The scale now lives only on the film, which is a
         video: rasterising that at a fractional size is what video does anyway.
         Crisper type, and the staging is carried by the displacement, which was
         the part that was doing the work. */
      const kids = copyKids.current[i]
      if (kids) {
        for (let k = 0; k < kids.length; k++) {
          const m = STAGE[k] ?? 1
          kids[k].style.transform = `translate3d(${off * LEAD * m}rem,0,0)`
        }
      }

      const film = films.current[i]
      if (film) {
        // `perspective()` first, so the rotation and the scale after it are the
        // ones it applies to. The film trails the copy, turns as it goes, and
        // recedes — one write.
        film.style.transform =
          `translate3d(${off * -LEAD * 0.8}rem,0,0) perspective(1200px) `
          + `rotateY(${off * TILT}deg) scale3d(${recede * sx},${recede * sy},1)`
      }
    }

    /* The seam: a single hairline living in the GAP between two panels, so the
       gap reads as a frame line on a film strip rather than as a hole. Placed by
       the same arithmetic as the panels — the gap after panel k starts where
       panel k ends — and lit only while it is actually between two of them, which
       is the middle of a transition and nowhere else. */
    const seam = seamRef.current
    if (seam) {
      const k = Math.floor(head)
      const frac = head - k
      seam.style.transform = `translate3d(${((k - head) * SPREAD + 1 + (SPREAD - 1) / 2) * 100}%,0,0)`
      seam.style.opacity = String(Math.sin(Math.PI * frac) * 0.5)
    }

    const next = Math.round(head)
    if (next !== curRef.current) { curRef.current = next; setCur(next) }
  }, [])

  /**
   * One step of the motion: measure how fast the deck is travelling, paint, and
   * keep painting until the speed has decayed to nothing.
   *
   * The loop exists for the smear alone. Without it, the last scroll frame leaves
   * the stretch frozen into the panel at whatever value it had when the reader
   * stopped — a panel sitting still, permanently smeared. The velocity is eased
   * rather than taken raw so that a wheel's stutter does not show, and its target
   * is `(p - previous p) / dt`, which is zero on its own the moment the scroll
   * stops: the same expression handles the drive and the relaxation.
   */
  const step = useCallback(() => {
    const s = motion.current
    s.raf = 0
    const now = performance.now()
    const dt = s.t ? Math.min((now - s.t) / 1000, 1 / 15) : 1 / 60
    s.t = now
    const rate = (s.p - s.pp) / dt
    /* Held separately from the velocity, because the velocity is what decays to
       zero and the direction is what has to survive that: by the time the settle
       runs there is no motion left to read a direction from. */
    if (Math.abs(rate) > 0.02) s.dir = Math.sign(rate)
    s.pp = s.p
    s.v += (rate - s.v) * (1 - Math.exp(-dt * 14))

    /* Snapped to exactly zero BEFORE the last paint, not after it. Stopping the
       loop and zeroing afterwards left the final frame holding whatever the
       velocity happened to be under the threshold — a panel sitting perfectly
       still with a 1.0005 scale baked into it, permanently, which is how the
       fractional-scale problem above became permanent rather than transient. */
    const moving = Math.abs(s.v) > RUSH_REST
    if (!moving) { s.v = 0; s.t = 0 }
    paint(s.p, moving ? Math.min(1, Math.abs(s.v) * RUSH_GAIN) : 0)

    if (moving) { s.raf = requestAnimationFrame(step); return }

    /* ── Settle onto a panel ────────────────────────────────────────────────
       The deck has come to rest. If it stopped between two panels, finish the
       journey — and finish it in the direction the reader was already going.

       This is what makes one scroll advance one panel, and it is the half of that
       problem that is actually solvable. Lengthening the travel cannot solve the
       other half: a trackpad flick carries an arbitrary distance, and the single
       gesture that started this crossed all six panels.

       FORWARD, not nearest. Nearest was the first version and it was wrong in a
       way worth recording: a reader who nudges the wheel one notch has moved a
       third of the way into a transition, and rounding to nearest hauls them back
       where they started. The page fighting the reader is worse than the page not
       snapping at all. Projecting along the direction of travel instead is both
       what makes a single notch advance exactly one panel, and the rule every
       good carousel uses — the target is chosen from where the gesture was GOING,
       not from where it happened to stop.

       Through `goToStep`, so the scroll engine eases it and the arrival stays
       interruptible: a reader who grabs the page mid-settle simply takes over.
       The epsilon is what stops it chasing its own sub-pixel error, and the 0.12
       is the dead zone that keeps an accidental one-pixel twitch from advancing
       anything. */
    const snap = snapTo.current
    if (!snap) return
    const head = deckHead(s.p, MODES.length)
    const floor = Math.floor(head)
    const frac = head - floor
    const dir = s.dir
    const target = dir > 0
      ? (frac > 0.12 ? floor + 1 : floor)
      : dir < 0
        ? (frac < 0.88 ? floor : floor + 1)
        : Math.round(head)
    const clamped = Math.min(MODES.length - 1, Math.max(0, target))
    if (Math.abs(head - clamped) > 0.02) snap(clamped)
  }, [paint])

  /**
   * Stop the motion dead.
   *
   * A relaxation frame is already queued whenever the reader stops mid-scroll, and
   * it outlives the pin: unpinning clears the inline styles, then the queued frame
   * runs and paints them all back on. `driving` alone does not cover it — that
   * gate is on the scroll callback, not on the loop.
   */
  const stop = useCallback(() => {
    const s = motion.current
    if (s.raf) cancelAnimationFrame(s.raf)
    s.raf = 0; s.v = 0; s.t = 0; s.pp = s.p
  }, [])

  const onProgress = useCallback((p: number) => {
    if (!driving.current) return
    const s = motion.current
    s.p = p
    // Any pending relaxation frame is stale the moment a real scroll arrives, and
    // running both in one frame would halve the measured dt and under-read the
    // speed.
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = 0 }
    step()
  }, [step])

  /**
   * PinnedStage's own step mapping, used ONLY when this deck is not driving.
   *
   * Unpinned, `goToStep` cannot scroll to anything, so it sets the step directly
   * and reports it here — that is what makes the rail work in the one case where
   * the deck is stacked but the stage never pinned. While driving, the index
   * comes from `deckHead` instead, because PinnedStage divides the travel
   * into six equal bands and this divides it into five transitions; they differ
   * by one for half of the scroll, and the rail has to name the panel actually
   * on stage.
   */
  const onStep = useCallback((i: number) => {
    if (driving.current) return
    curRef.current = i
    setCur(i)
  }, [])

  return (
    <>
      {/* The heading is its own section, OUTSIDE the stage. PinnedStage refuses
          to pin content taller than the viewport and measures the tallest child
          of its sticky box — with the heading in there, heading plus panel plus
          rail exceeded an 800px laptop, the stage correctly declined to pin, and
          nobody ever saw the deck. */}
      <section className="section on-dark formats-head" aria-labelledby="fmt-h">
        <div className="wrap">
          <div className="sec-head">
            <h2 className="h2" id="fmt-h">Six ways to meet a candidate.</h2>
            <p className="lede">
              Pick the one that fits the role — a written paper for knowledge, a voice call for
              reasoning out loud, a live call when you want to be in the room. Five of the six
              score against the same rubric, so their results compare directly.
            </p>
          </div>
        </div>
      </section>

      <PinnedStage
        steps={MODES.length}
        onStep={onStep}
        onProgress={onProgress}
        /* One wheel notch carries 80px through the scroll engine. At the default
           30 a step cost 175px and the whole section was 1049px, so one flick
           crossed three panels and one trackpad swipe crossed all six.

           48 puts a step at ~280px, which makes a single notch about 29% of a
           transition — over the settle's dead zone, so one notch advances exactly
           one panel and no more. It is a compromise on purpose: long enough that a
           flick does not cross the whole section, short enough that the section is
           not a toll gate between the reader and the rest of the page. The rail is
           there for anyone who would rather jump. */
        vhPerStep={48}
        id="platform"
        className="mm-formats on-dark"
        labelledBy="fmt-h"
        backdrop={<Field seed={5} />}
      >
        {({ pinned, goToStep }) => (
          <FormatDeck
            pinned={pinned}
            cur={cur}
            goToStep={goToStep}
            slides={slides}
            copies={copies}
            copyKids={copyKids}
            films={films}
            seamRef={seamRef}
            driving={driving}
            snapTo={snapTo}
            stop={stop}
            resetCur={onStep}
          />
        )}
      </PinnedStage>
    </>
  )
}

/**
 * A real component rather than markup inside the render prop, because the deck
 * needs effects keyed on `pinned` — arming exactly one film, taking the
 * off-stage panels out of the tab order, and handing the inline styles back to
 * the stylesheet when the stage stops driving.
 */
function FormatDeck({ pinned, cur, goToStep, slides, copies, copyKids, films, seamRef, driving, snapTo, stop, resetCur }: {
  pinned: boolean
  cur: number
  goToStep: (i: number) => void
  slides: React.MutableRefObject<(HTMLElement | null)[]>
  copies: React.MutableRefObject<(HTMLElement | null)[]>
  copyKids: React.MutableRefObject<HTMLElement[][]>
  films: React.MutableRefObject<(HTMLElement | null)[]>
  seamRef: React.MutableRefObject<HTMLDivElement | null>
  driving: React.MutableRefObject<boolean>
  snapTo: React.MutableRefObject<((i: number) => void) | null>
  stop: () => void
  resetCur: (i: number) => void
}) {
  /* Which panel is settled on, and so worth holding a video for. Debounced:
     travelling through all six loads none of them on the way. */
  const [settled, setSettled] = useState(0)

  /* The live panel index, for the wheel handler. Held in a ref rather than closed
     over, so the listener is bound once per pin instead of once per step — a
     re-bind would reset the gesture state below and let a flick's own inertia
     advance a second panel. */
  const liveCur = useRef(cur)
  liveCur.current = cur
  /** When the last wheel event arrived, and when the next gesture may act. */
  const gesture = useRef({ at: 0, until: 0 })

  /* The driving flag, and the clean-up that has to happen the moment it goes
     false. The inline styles the driver writes are stronger than the stylesheet,
     so leaving them behind would strand five panels at `visibility:hidden` in a
     mode where all six are supposed to be readable. */
  useEffect(() => {
    driving.current = pinned
    if (pinned) {
      /* Effects run child-first, so this one sets the flag AFTER PinnedStage has
         already taken its first reading and been turned away by it. One frame
         later that does not matter — the panel the stylesheet shows is panel 0,
         centred, which is the right picture at progress 0. It matters when the
         page loads already scrolled into the section, where progress is not 0 and
         nothing would correct the picture until the reader moved. Nudging the
         listener PinnedStage already has is the whole fix; every other scroll
         listener on this site reads position and is safe to run again. */
      window.dispatchEvent(new Event('scroll'))
      return
    }
    stop()
    resetCur(0)
    for (const el of slides.current) {
      if (!el) continue
      el.style.removeProperty('visibility')
      el.style.removeProperty('opacity')
      el.style.removeProperty('transform')
    }
    for (const el of copies.current) el?.style.removeProperty('transform')
    for (const kids of copyKids.current) for (const el of kids) el.style.removeProperty('transform')
    for (const el of films.current) el?.style.removeProperty('transform')
    const seam = seamRef.current
    if (seam) { seam.style.removeProperty('transform'); seam.style.removeProperty('opacity') }
  }, [pinned, driving, stop, slides, copies, copyKids, films, seamRef, resetCur])

  /* Hand PinnedStage's `goToStep` out to the motion loop, which lives above this
     component and so never sees the render prop. Assigned on every render because
     the callback's identity changes with `pinned`, and a stale one would scroll
     against arithmetic that no longer applies. */
  snapTo.current = pinned ? goToStep : null

  /* Unmount, in whatever state the pin was in. The effect above only runs its
     clean-up when `pinned` goes false; navigating away while pinned skips it. */
  useEffect(() => stop, [stop])

  /**
   * ONE GESTURE, ONE PANEL.
   *
   * The settle can only decide where a scroll LANDS; it cannot decide how far a
   * scroll goes. A trackpad flick or a spin of the wheel carries an arbitrary
   * distance, and no amount of lengthening the travel changes that — at the
   * lengths that would, the section becomes a corridor. So while the deck is
   * actually held on screen, it takes the gesture: each flick advances exactly
   * one panel and the rest of that flick's momentum is discarded.
   *
   * Taking it from the scroll engine is possible because of where the engine
   * listens. Lenis binds its wheel handler on `window` WITHOUT capture, so it
   * runs in the bubble phase; a wheel event targets the element under the cursor,
   * so the capture phase at window runs first. `preventDefault` alone would not be
   * enough — Lenis calls that itself and then scrolls programmatically — but
   * stopping propagation in the capture phase means its handler never runs at all.
   *
   * WHAT KEEPS THIS FROM BEING A TRAP, which is the failure mode this pattern is
   * rightly disliked for:
   *
   *  · At the last panel, scrolling down is not intercepted. At the first,
   *    scrolling up is not. The reader leaves in the direction they were already
   *    going, with the gesture they already made, on the first try.
   *  · It only applies while the section is genuinely stuck to the viewport.
   *    `pinned` is true for as long as the section merely FITS — PinnedStage
   *    decides it from the viewport and the content, never from the scroll
   *    position — so without the rect test below this would have been swallowing
   *    wheel events over the entire page.
   *  · Keyboard scrolling is deliberately left alone. Intercepting keys risks
   *    trapping the one group who cannot flick past a mistake, and the settle
   *    already lands a keyboard reader squarely on a panel.
   *  · The rail underneath jumps straight to any panel, so nobody has to travel
   *    through five to reach the sixth.
   *
   * The cost is real and worth stating: from the middle of the deck it now takes
   * one flick per panel to reach the end of the section. That is what was asked
   * for, and it is what the rail is there to shortcut.
   */
  useEffect(() => {
    if (!pinned) return
    const host = slides.current.find(Boolean)?.closest('.mm-formats') as HTMLElement | null
    if (!host) return
    const last = MODES.length - 1

    /* Stuck to the viewport, not merely present. */
    const stuck = () => {
      const r = host.getBoundingClientRect()
      return r.top <= 0 && r.bottom >= window.innerHeight
    }

    const onWheel = (e: WheelEvent) => {
      if (!stuck()) return
      const dir = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0
      if (!dir) return

      const at = liveCur.current
      // The way out, in the direction they are already going.
      if ((dir > 0 && at >= last) || (dir < 0 && at <= 0)) return

      e.preventDefault()
      e.stopPropagation()

      /* A flick is one gesture however many events it fires. Inertia arrives as a
         stream roughly a frame apart, so a gap counts as the start of a new one —
         which is the whole mechanism: the first event of a flick advances a panel
         and every event after it is swallowed. */
      const now = performance.now()
      const fresh = now - gesture.current.at > 140
      gesture.current.at = now
      if (!fresh || now < gesture.current.until) return
      gesture.current.until = now + 420
      goToStep(at + dir)
    }

    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', onWheel, { capture: true })
  }, [pinned, goToStep, slides])

  /* Off-stage panels are inert while the deck is driving: not focusable, not in
     the accessibility tree, not clickable. Without it, Tab walked into the five
     panels nobody can see — three controls each, fifteen invisible stops. Set as
     a DOM property rather than an attribute because React 18 does not recognise
     `inert` as a boolean prop and would render it as the string "true". */
  useEffect(() => {
    for (let i = 0; i < slides.current.length; i++) {
      const el = slides.current[i] as (HTMLElement & { inert?: boolean }) | null
      if (el) el.inert = pinned && i !== cur
    }
  }, [pinned, cur, slides])

  /* Which film to arm, by visibility rather than by index.
     By index would be wrong in list mode, where there is no index — every panel
     would arm as the reader scrolled past it. Geometry covers both modes: in the
     deck the off-stage panels are translated clear of the viewport, so they do
     not intersect; in the list only the panel being read does. */
  useEffect(() => {
    const els = slides.current.filter(Boolean) as HTMLElement[]
    if (!els.length || typeof IntersectionObserver === 'undefined') return
    let timer = 0
    const io = new IntersectionObserver((entries) => {
      // At or above the threshold, not merely intersecting. A panel LEAVING also
      // fires a callback, and it is still partly intersecting when it does — so
      // `isIntersecting` alone armed the film the reader was scrolling away from.
      let best: IntersectionObserverEntry | null = null
      for (const e of entries) {
        if (e.intersectionRatio < 0.6) continue
        if (!best || e.intersectionRatio > best.intersectionRatio) best = e
      }
      if (!best) return
      const idx = els.indexOf(best.target as HTMLElement)
      if (idx < 0) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setSettled(idx), 400)
    }, { threshold: 0.6 })
    for (const el of els) io.observe(el)
    return () => { io.disconnect(); window.clearTimeout(timer) }
  }, [slides])

  return (
    <div className="wrap fmt-in">
      <div className="fmt-deck">
        {/* The frame line between two panels. Inside the deck so the deck's paint
            containment clips it, and out of flow so it costs the fit test
            nothing. */}
        <div className="fmt-seam" ref={seamRef} aria-hidden="true" />
        {MODES.map((m, i) => (
          <article
            key={m.href}
            ref={(el) => { slides.current[i] = el }}
            className="fmt-slide"
            data-live={i === cur || undefined}
            aria-label={m.name}
          >
            <div
              className="fmt-copy"
              ref={(el) => {
                copies.current[i] = el
                copyKids.current[i] = el ? (Array.from(el.children) as HTMLElement[]) : []
              }}
            >
              <span className="fmt-n">
                {String(i + 1).padStart(2, '0')}<i>/</i>{String(MODES.length).padStart(2, '0')}
              </span>
              <h3>{m.name}</h3>
              <span className="tag">{m.tag}</span>
              <p>{m.desc}</p>
              <p className="meta">{m.meta.map((x) => <span key={x}>{x}</span>)}</p>
              <Link className="btn btn-light" to={m.href}>How it works</Link>
            </div>

            <div className="fmt-stage" ref={(el) => { films.current[i] = el }}>
              {m.video ? (
                <DemoVideo
                  src={m.video.src}
                  poster={m.video.poster}
                  still={m.video.poster}
                  caption={m.video.caption}
                  alt={m.video.alt}
                  disclosure={m.video.disclosure}
                  contentAspect={m.video.contentAspect}
                  /* Held unless this is the panel being read. DemoVideo's arm
                     observer uses a 600px margin — right for a page you scroll
                     down, wrong here, where every neighbour sits permanently
                     inside it and all four films armed at once. */
                  hold={i !== settled}
                />
              ) : (
                <div className="fmt-nofilm">
                  <span className="lbl">No recording</span>
                  <p>{noFilmReason(m.href)}</p>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      {/* The rail is rendered in both modes and hidden by CSS in the one where it
          is redundant. Rendered conditionally on `pinned` it changed the sticky
          box's height at the moment the stage pinned, which re-ran the fit test
          against a taller box than the one it had just approved. */}
      <div className="fmt-nav" role="group" aria-label="Interview formats">
        {MODES.map((m, i) => (
          <button
            key={m.href}
            type="button"
            aria-current={i === cur ? 'true' : undefined}
            data-on={i === cur || undefined}
            onClick={() => goToStep(i)}
          >
            <span>{m.name}</span>
          </button>
        ))}
      </div>

      {/* Deck mode makes the off-stage panels inert, which removes them from the
          accessibility tree as well as the tab order — correct for a panel nobody
          can see, but it would leave a screen reader with one format out of six
          under a heading that promises six. The names are listed here too. Hidden
          with `display:none` in list mode, where all six panels are already read
          in order and this would only repeat them. */}
      <p className="fmt-sr">
        All six formats: {MODES.map((m) => m.name).join(', ')}. Use the format buttons in
        this section to bring each one on stage, or the Platform menu to read about any of them.
      </p>
    </div>
  )
}

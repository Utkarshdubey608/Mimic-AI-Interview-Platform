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
 * That mattered. Faded against distance instead, the opacity was still 0.21 when
 * `edge` was a thousandth short of 1 — and a thousandth of a deck width is a 1px
 * strip of the NEXT panel, at a fifth opacity, hard against the deck's edge. A
 * hairline that reads as a rendering fault, and the artifact the verification
 * harness caught here.
 *
 * The exponent keeps the curve nearly flat where the panels are actually being
 * read (0.98 a fifth of the way out, 0.76 at the halfway point of a transition) so
 * the movement carries the transition. A linear fade would sit both panels at half
 * in the middle, which is a cross-dissolve, not a pass.
 */
const FADE_POW = 2.5
const RECEDE = 0.05   // scale lost per deck width, on the panel's contents
/**
 * Percent of its own width the copy leads by, and the film trails by.
 *
 * Two rates, not one. One rate for everything is a slide deck; the light text
 * arriving ahead of the heavy film is depth, and it is the whole difference
 * between this and a carousel.
 */
const LAG = 12

export function FormatShowcase() {
  const slides = useRef<(HTMLElement | null)[]>([])
  const copies = useRef<(HTMLElement | null)[]>([])
  const films = useRef<(HTMLElement | null)[]>([])
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
  const onProgress = useCallback((p: number) => {
    if (!driving.current) return
    const n = MODES.length
    const head = deckHead(p, n)

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
      el.style.transform = `translate3d(${off * SPREAD * 100}%,0,0)`

      const scale = `scale(${1 - edge * RECEDE})`
      const copy = copies.current[i]
      if (copy) copy.style.transform = `translate3d(${off * LAG}%,0,0) ${scale}`
      const film = films.current[i]
      if (film) film.style.transform = `translate3d(${off * -LAG}%,0,0) ${scale}`
    }

    const next = Math.round(head)
    if (next !== curRef.current) { curRef.current = next; setCur(next) }
  }, [])

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
            films={films}
            driving={driving}
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
function FormatDeck({ pinned, cur, goToStep, slides, copies, films, driving, resetCur }: {
  pinned: boolean
  cur: number
  goToStep: (i: number) => void
  slides: React.MutableRefObject<(HTMLElement | null)[]>
  copies: React.MutableRefObject<(HTMLElement | null)[]>
  films: React.MutableRefObject<(HTMLElement | null)[]>
  driving: React.MutableRefObject<boolean>
  resetCur: (i: number) => void
}) {
  /* Which panel is settled on, and so worth holding a video for. Debounced:
     travelling through all six loads none of them on the way. */
  const [settled, setSettled] = useState(0)

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
    resetCur(0)
    for (const el of slides.current) {
      if (!el) continue
      el.style.removeProperty('visibility')
      el.style.removeProperty('opacity')
      el.style.removeProperty('transform')
    }
    for (const el of copies.current) el?.style.removeProperty('transform')
    for (const el of films.current) el?.style.removeProperty('transform')
  }, [pinned, driving, slides, copies, films, resetCur])

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
        {MODES.map((m, i) => (
          <article
            key={m.href}
            ref={(el) => { slides.current[i] = el }}
            className="fmt-slide"
            data-live={i === cur || undefined}
            aria-label={m.name}
          >
            <div className="fmt-copy" ref={(el) => { copies.current[i] = el }}>
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

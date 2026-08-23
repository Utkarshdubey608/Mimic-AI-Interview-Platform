/**
 * Six formats, one at a time.
 *
 * The format cards were a static grid: six things competing for one glance, each
 * reduced to three lines because that is all a card of that size holds. As a
 * stage they get the whole width in turn — the copy on the left, the format
 * actually running on the right — and the reader advances by scrolling, which is
 * what they were going to do anyway.
 *
 * WHEN IT IS NOT PINNED IT IS A LIST. `PinnedStage` only pins above 1081px and
 * never under reduced motion, and it hands `pinned` down. Unpinned, every panel
 * renders in flow as an ordinary stack — so a phone and a reduced-motion visitor
 * get all six formats as readable blocks rather than panel one and no way to
 * reach the rest. That is the whole fallback, and it is the same content.
 *
 * THE TRANSITION IS SCROLL-LINKED, NOT STEPPED. The six panels sit side by side
 * on one track and the track translates continuously with the raw scroll
 * progress PinnedStage reports. So the movement is always mid-flight while you
 * are scrolling and it stops exactly where you stop — the difference between a
 * horizontal scroll section and a slideshow that snaps. A stepped version was
 * built first and it read as the latter.
 *
 * THE TRANSFORM IS WRITTEN STRAIGHT ONTO THE TRACK. It went through a CSS custom
 * property first, set on the stage host each frame, and that was measurably
 * wrong: a custom property invalidates computed style for every descendant that
 * inherits it, and it cannot be animated on the compositor, so the track's
 * transform was recomputed on the main thread on every scroll frame. Scrolling
 * this section ran at 61 frames per 1400ms with a 263ms stall, against 85 frames
 * and a 19.5ms worst case for the stage next door. One direct style write on one
 * element instead.
 *
 * EVERY PLAYER IS MOUNTED, AND NONE OF THEM CHURNS. Mounting only the live
 * panel's `DemoVideo` meant every step change unmounted one player and mounted
 * another, each remount starting a fresh fetch of a multi-megabyte file — which
 * is where those stalls came from. All of them mount once now and DemoVideo's
 * own two observers do the work they already did on the platform pages: one arms
 * the source when it enters the viewport, the other plays and pauses. A panel
 * translated off-screen has a rect outside the viewport, so it neither loads nor
 * plays. Nothing needed adding to get that; the conditional needed removing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { DemoVideo } from '../DemoVideo'
import { Field } from '../Field'
import { InkTrail } from '../ink/InkTrail'
import { PinnedStage } from '../scroll'
import { MODES, noFilmReason } from './modes'

export function ModeShowcase() {
  const railRef = useRef<HTMLDivElement | null>(null)
  const [step, setStep] = useState(0)

  /* Which panel is worth loading a video for: the one actually on screen, held
     still long enough to mean it.
     Derived from VISIBILITY rather than from the step, because the step only
     exists while the stage is pinned — so a gate built on it left every video on
     a phone to arm as it scrolled past, four sources and four decoders on the
     device that can least afford them. An observer answers the same question in
     both layouts: staged, the translated panels are genuinely off-viewport, so
     the visible one IS the live one; stacked, it is whatever the reader has
     scrolled to.
     Debounced at 450ms, deliberately longer than it feels like it needs: a
     reader travelling through all six should load NOTHING on the way, and only
     the one they stop on. At 220ms a slow, deliberate scroll still tripped
     intermediate panels into loading. */
  const [settled, setSettled] = useState(0)
  const panelRefs = useRef<(HTMLElement | null)[]>([])
  useEffect(() => {
    const els = panelRefs.current.filter(Boolean) as HTMLElement[]
    if (!els.length || typeof IntersectionObserver === 'undefined') return
    let timer = 0
    /* ONE threshold, and no ratio bookkeeping.
       The first version watched five thresholds on six panels and recomputed a
       ratio map on every entry. During the horizontal travel the panels cross
       those thresholds continuously, so it fired dozens of times a frame and the
       section degraded run over run — 84 frames, then 60, then 44 — while the
       stage next door held flat at 85 in the same runs. Majority-visible is the
       only question being asked, so ask it once. */
    const io = new IntersectionObserver((entries) => {
      const hit = entries.find((e) => e.isIntersecting)
      if (!hit) return
      const idx = els.indexOf(hit.target as HTMLElement)
      if (idx < 0) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setSettled(idx), 450)
    }, { threshold: 0.6 })
    for (const el of els) io.observe(el)
    return () => { io.disconnect(); window.clearTimeout(timer) }
  }, [])

  /* One style write per frame, on the one element that moves. The track is
     `n * 100%` wide and each panel is `100% / n` of it, so travelling the full
     set is (n - 1) panels = (n - 1) * 100 / n percent of the track's own width. */
  const onProgress = useCallback((p: number) => {
    const el = railRef.current
    if (!el) return
    const n = MODES.length
    el.style.transform = `translate3d(${(-p * (n - 1) * 100) / n}%, 0, 0)`
  }, [])

  return (
    <>
    {/* Outside the stage on purpose. PinnedStage pins only if its content fits
        the viewport (canPinStage: contentH + 24 <= viewportH), and it measures
        the tallest child of its inner box. With the heading inside, a panel plus
        a jump nav plus this put the stage over 800px and it refused to pin —
        correctly, but it meant nobody ever saw the staged version. */}
    <section className="section showcase-head on-dark" aria-hidden="true">
      <div className="wrap">
        <div className="sec-head">
          <span className="eyebrow on-dark">Interview formats</span>
          <h2 className="h2">Six ways to meet a candidate.</h2>
          <p className="lede">
            Pick the format that fits the role. Every one of them reads the candidate’s resume
            first, and five of the six score against the same rubric — so results compare
            directly across formats.
          </p>
        </div>
      </div>
    </section>

    <PinnedStage
      steps={MODES.length}
      onStep={setStep}
      id="platform"
      className="showcase on-dark"
      labelledBy="tr-h"
      backdrop={<><Field seed={5} /><InkTrail /></>}
      onProgress={onProgress}
    >
      {({ pinned, goToStep }) => (
        <div className="wrap showcase-in">
          {/* The visible heading is the band above; this is the accessible name
              for the region, since the one it used to point at moved out. */}
          <h2 id="tr-h" className="showcase-sr">Six ways to meet a candidate</h2>

          <div
            ref={railRef}
            className={`showcase-rail${pinned ? ' is-staged' : ''}`}
            /* --n sizes the track and the panels in CSS; the transform itself is
               written by onProgress above. */
            style={{ '--n': MODES.length } as React.CSSProperties}
          >
            {MODES.map((m, i) => {
              /* Every panel is real content and none is hidden: side by side on a
                 moving track, two of them are legitimately on screen mid-transit,
                 and a screen reader should have all six either way. */
              return (
                <article
                  key={m.href}
                  ref={(el) => { panelRefs.current[i] = el }}
                  className="showcase-panel"
                  data-live={i === step || undefined}
                >
                  <div className="showcase-copy">
                    <span className="showcase-n">
                      {String(i + 1).padStart(2, '0')}<i>/</i>{String(MODES.length).padStart(2, '0')}
                    </span>
                    <h3>{m.name}</h3>
                    <span className="tag">{m.tag}</span>
                    <p>{m.desc}</p>
                    <p className="meta">{m.meta.map((x) => <span key={x}>{x}</span>)}</p>
                    <Link className="btn btn-light" to={m.href}>How it works</Link>
                  </div>

                  <div className="showcase-stage">
                    {m.video ? (
                      /* Always mounted, and held unless this is the settled
                         panel. Mounting was never the cost; ARMING was — the
                         arm observer's 600px margin catches every neighbour in a
                         horizontal track, so all four files fetched at once. */
                      <DemoVideo
                        src={m.video.src}
                        poster={m.video.poster}
                        still={m.video.poster}
                        caption={m.video.caption}
                        alt={m.video.alt}
                        disclosure={m.video.disclosure}
                        contentAspect={m.video.contentAspect}
                        hold={i !== settled}
                      />
                    ) : (
                      /* No footage. Says why, rather than showing an empty
                         player under a caption promising something. */
                      <div className="showcase-nofilm">
                        <span className="lbl">No recording</span>
                        <p>{noFilmReason(m.href)}</p>
                      </div>
                    )}
                  </div>
                </article>
              )
            })}
          </div>

          {/* Staged only: the reader can jump rather than scroll through six. */}
          {pinned && (
            <div className="showcase-nav">
              {MODES.map((m, i) => (
                <button
                  key={m.href}
                  type="button"
                  data-on={i === step || undefined}
                  aria-current={i === step ? 'true' : undefined}
                  onClick={() => goToStep(i)}
                >
                  <span>{m.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </PinnedStage>
    </>
  )
}

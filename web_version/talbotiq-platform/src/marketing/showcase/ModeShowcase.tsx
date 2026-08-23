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
 * on one track and the track translates continuously with `--stage-p`, the raw
 * scroll progress PinnedStage publishes. So the movement is always mid-flight
 * while you are scrolling and it stops exactly where you stop — which is the
 * difference between a horizontal scroll section and a slideshow that snaps
 * between states. A stepped version was built first and it read as the latter.
 *
 * ONE VIDEO AT A TIME. Only the panel at the current step mounts its
 * `DemoVideo`; the others render nothing in that slot. Six players side by side
 * would arm six `<video>` elements — several megabytes for five things nobody is
 * looking at. Unpinned, each player self-arms on visibility, which is what it
 * already does on the platform pages.
 */
import { Link } from 'react-router-dom'

import { DemoVideo } from '../DemoVideo'
import { Field } from '../Field'
import { InkTrail } from '../ink/InkTrail'
import { PinnedStage } from '../scroll'
import { MODES, noFilmReason } from './modes'

export function ModeShowcase() {
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
      onStep={() => { /* the render prop already hands us `step` */ }}
      id="platform"
      className="showcase on-dark"
      labelledBy="tr-h"
      backdrop={<><Field seed={5} /><InkTrail /></>}
    >
      {({ step, pinned, goToStep }) => (
        <div className="wrap showcase-in">
          {/* The visible heading is the band above; this is the accessible name
              for the region, since the one it used to point at moved out. */}
          <h2 id="tr-h" className="showcase-sr">Six ways to meet a candidate</h2>

          <div
            className={`showcase-rail${pinned ? ' is-staged' : ''}`}
            /* The travel is (n - 1) panel widths. Derived from the count so a
               seventh format needs no CSS change. */
            style={{ '--n': MODES.length } as React.CSSProperties}
          >
            {MODES.map((m, i) => {
              /* Every panel is real content and none is hidden: side by side on a
                 moving track, two of them are legitimately on screen mid-transit,
                 and a screen reader should have all six either way. */
              return (
                <article
                  key={m.href}
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
                      /* The live panel and its immediate neighbours. Live alone
                         left the incoming panel with an empty stage for the
                         whole of the travel — you arrived at a format and its
                         footage appeared afterwards. Neighbours means at most
                         three players instead of six, and the panel is complete
                         before it reaches the middle. */
                      (!pinned || Math.abs(i - step) <= 1) && (
                        <DemoVideo
                          src={m.video.src}
                          poster={m.video.poster}
                          still={m.video.poster}
                          caption={m.video.caption}
                          alt={m.video.alt}
                          disclosure={m.video.disclosure}
                          contentAspect={m.video.contentAspect}
                        />
                      )
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

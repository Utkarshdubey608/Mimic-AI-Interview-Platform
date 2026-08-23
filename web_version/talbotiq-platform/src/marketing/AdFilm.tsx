/**
 * A film the reader chooses to watch.
 *
 * Separate from DemoVideo, which is the right component for the product captures
 * beside it and the wrong one here. DemoVideo arms itself from an observer as the
 * reader approaches and plays muted on a loop — correct for a one-or-two megabyte
 * clip that is evidence for a claim in the paragraph next to it. This file is
 * 12.7MB with a voice track. Fetching that on approach spends twelve megabytes of
 * somebody's connection on a decision they did not make, and starting a narrated
 * film silently and halfway through is worse than not offering it.
 *
 * So: a still, a play control, and nothing on the wire until it is pressed. After
 * that it is the browser's own player — real controls, a real timeline, a real
 * volume slider, because a film with narration is something people scrub and
 * pause and a bespoke two-button player would only take that away.
 *
 * `preload="none"` and `src` set together at mount is not belt and braces. A
 * `<video>` with a src attribute begins fetching metadata on its own in some
 * engines regardless of preload, which is exactly what this exists to avoid, so
 * the element does not exist at all until the reader asks for it.
 */
import { useRef, useState } from 'react'

export function AdFilm({ src, poster, label, caption }: {
  src: string
  poster: string
  /** The play control's accessible name. Says what will play, not "play". */
  label: string
  caption: string
}) {
  const [playing, setPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  return (
    <figure className="adfilm">
      <div className="adfilm-frame">
        {playing ? (
          <video
            ref={videoRef}
            src={src}
            poster={poster}
            controls
            autoPlay
            playsInline
            preload="auto"
            aria-label={label}
          />
        ) : (
          <>
            {/* Not a background-image: a poster is content, and a reader on a slow
                connection should see it arrive with a width and height already
                reserved rather than as a reflow. */}
            <img src={poster} alt="" width={1920} height={1080} decoding="async" />
            <button
              type="button"
              className="adfilm-play"
              onClick={() => setPlaying(true)}
              aria-label={label}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12z" /></svg>
              <span>Play</span>
            </button>
          </>
        )}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

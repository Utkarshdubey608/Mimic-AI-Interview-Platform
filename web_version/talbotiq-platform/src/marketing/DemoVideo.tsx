import { useEffect, useRef, useState } from 'react'

/**
 * The product demo, playing.
 *
 * The file is a recording of the ACTUAL application being driven — signing in,
 * opening a scored report, moving through a pipeline — captured by
 * scripts/record-product-demo.mjs against the synthetic store. Not a motion
 * graphic of an imagined product, and not a slideshow of stills.
 *
 * Three rules it has to obey:
 *
 *  · It costs nothing until it is wanted. preload="none" and the source is only
 *    attached once the figure is near the viewport, so a visitor who never
 *    scrolls this far never downloads 2.6 MB.
 *  · It stops when it leaves. An off-screen video decoding frames is a laptop
 *    fan spinning for nobody.
 *  · Reduced motion gets a still, not a paused video. Someone who asked the
 *    system for less motion should not be handed a play button as a consolation
 *    — the still frame carries the same information.
 */
export function DemoVideo({ src, poster, still, caption, alt, disclosure = 'Synthetic candidates', contentAspect, startAt = 0, priority = false, hold = false }: {
  src: string
  poster: string
  still: string
  caption: string
  alt: string
  /**
   * Aspect ratio of the picture inside the file, when the file is letterboxed.
   * Set it and the frame is cropped to the real content instead of showing the
   * capture tool's black bars — see `contentAspect` in demoAssets.ts. Left
   * undefined the file is shown whole, which is right for anything the
   * recorder produced.
   */
  contentAspect?: string
  /**
   * Suppress arming while true, and RELEASE the source if it was already
   * armed. The poster still shows; nothing is fetched, decoded or held in a
   * decoder.
   *
   * Releasing matters as much as gating. Gating alone meant each panel armed as
   * the reader settled on it and then stayed armed for the rest of the visit —
   * four live decoders by the end of one pass — and the section degraded run
   * over run (83, 80, 62, 30 frames across four passes) while the stage next
   * door held flat at 82-85 in the same passes. At most one source is attached
   * now. Re-arming re-reads from the HTTP cache, so going back is cheap.
   *
   * Exists for the horizontal format showcase. The arm observer below uses a
   * 600px rootMargin, which is right for a page you scroll DOWN — the source
   * attaches a screen early so playback has started by the time the frame
   * arrives. In a horizontal track the panels sit side by side, so every
   * neighbour is permanently inside that margin and all of them armed at once:
   * four multi-megabyte files fetching and decoding during the travel, which
   * cost a 157ms stall on a scroll that is otherwise a flat 17ms. Held until a
   * panel is the one being read, the same scroll runs at 85 frames with a 19ms
   * worst case — identical to the section next door.
   */
  hold?: boolean
  /**
   * The provenance chip beside the caption. Defaults to "Synthetic candidates",
   * which is true of every recording scripts/record-mode-demos.mjs produces —
   * it drives a fabricated candidate against the synthetic store. Footage of a
   * real person must override it: captioning a real face "synthetic" is exactly
   * the kind of unverifiable claim audit-marketing-claims.ts exists to catch,
   * and it is the one line on the figure a viewer is entitled to trust.
   */
  disclosure?: string
  /**
   * Above the fold. The observer that arms this component exists so a visitor
   * who never scrolls never downloads the file — but a hero is already on
   * screen at first paint, and waiting for an observer callback there paints an
   * empty box first. Attaches on mount and preloads metadata instead.
   */
  priority?: boolean
  /**
   * Seconds to skip at the head. Every recording begins with the app booting —
   * an auth check and an empty shell — and no visitor should be shown a
   * loading state as the opening argument. Trimmed in the player rather than
   * in the file because re-encoding would mean adding ffmpeg to the toolchain
   * for one cut. The loop returns here, not to zero, or the boot frames come
   * back every 23 seconds.
   */
  startAt?: number
}) {
  const hostRef = useRef<HTMLElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [armed, setArmed] = useState(priority)   // source attached
  const [reduced, setReduced] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)    // 0‥1 across the TRIMMED span

  const toggle = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }

  /** Seek from a click or drag anywhere on the rail. */
  const seekTo = (fraction: number) => {
    const v = videoRef.current
    if (!v || !isFinite(v.duration)) return
    const span = v.duration - startAt
    v.currentTime = startAt + Math.min(1, Math.max(0, fraction)) * span
  }

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  /* Play once the source arrives, if the frame is on screen.
   *
   * The play/pause observer below only acts on an intersection CHANGE. A held
   * video becomes visible first and is armed second, so that observer fires
   * while there is still no source to play — and nothing moves afterwards to
   * fire it again, leaving a visible frame paused on its poster. This covers the
   * arming edge, which the observer cannot see. */
  useEffect(() => {
    if (!armed || reduced) return
    const host = hostRef.current
    const v = videoRef.current
    if (!host || !v) return
    const r = host.getBoundingClientRect()
    const onScreen = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth
    if (onScreen) void v.play().catch(() => { /* autoplay refused; controls remain */ })
  }, [armed, reduced])

  useEffect(() => {
    if (reduced) return
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') return

    // Held: tear down. Pause, detach the source and tell the element to reload
    // from nothing, which is what actually frees the decoder — clearing the
    // React state alone leaves the media element holding its buffers.
    if (hold) {
      const v = videoRef.current
      if (v) {
        v.pause()
        v.removeAttribute('src')
        v.load()
      }
      if (armed) setArmed(false)
      return
    }

    // Attach the source a screen early, so playback starts as it arrives rather
    // than after a visible stall. A priority video is armed from mount, so it
    // needs no arming observer at all.
    let arm: IntersectionObserver | undefined
    if (!priority) {
      arm = new IntersectionObserver((es) => {
        if (es.some((e) => e.isIntersecting)) { setArmed(true); arm?.disconnect() }
      }, { rootMargin: '600px' })
      arm.observe(host)
    }

    // The play/pause observer stays in both modes: an off-screen video decoding
    // frames is a laptop fan spinning for nobody, hero or not.
    const play = new IntersectionObserver((es) => {
      const v = videoRef.current
      if (!v) return
      for (const e of es) {
        if (e.isIntersecting) void v.play().catch(() => { /* autoplay refused; controls remain */ })
        else v.pause()
      }
    }, { threshold: 0.25 })
    play.observe(host)

    return () => { arm?.disconnect(); play.disconnect() }
  }, [reduced, priority, hold, armed])

  // Both the video and the reduced-motion still are cut from the same frames,
  // so a letterboxed source needs the identical crop on each — otherwise the
  // two modes disagree about what the product looks like.
  const crop = contentAspect
    ? ({ aspectRatio: contentAspect, objectFit: 'cover' } as React.CSSProperties)
    : undefined

  return (
    <figure className="shot" ref={hostRef as React.RefObject<HTMLElement>}>
      {reduced ? (
        <img src={still} width={1400} height={875} alt={alt} decoding="async" style={crop} />
      ) : (
        <video
          ref={videoRef}
          className="shot-video"
          width={1280}
          height={800}
          style={crop}
          // Attached with the source, not before it. A poster is fetched as
          // soon as the attribute exists, even under preload="none" — so two
          // below-the-fold demos were pulling their posters into the initial
          // payload for a video nobody had scrolled to yet. That was the 4 kB
          // that put the page over budget.
          poster={armed ? poster : undefined}
          muted
          playsInline
          preload={priority ? 'metadata' : 'none'}
          aria-label={alt}
          onClick={toggle}
          onTimeUpdate={(e) => {
            const v = e.currentTarget
            // Guard on a finite duration, exactly as seekTo does. Before a
            // video's metadata arrives — and permanently if the file 404s —
            // duration is NaN, and `Math.max(0.001, NaN)` is NaN, not 0.001.
            // That fed NaN into the rail's `value` and React warned on every
            // timeupdate. A rail with nothing to measure sits at zero.
            if (!isFinite(v.duration)) { setProgress(0); return }
            const span = Math.max(0.001, v.duration - startAt)
            setProgress(Math.min(1, Math.max(0, (v.currentTime - startAt) / span)))
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          src={armed ? src : undefined}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            if (startAt > 0 && v.currentTime < startAt) v.currentTime = startAt
          }}
          // Not the `loop` attribute: it returns to 0, which replays the boot
          // frames startAt exists to skip.
          onEnded={(e) => {
            const v = e.currentTarget
            v.currentTime = startAt
            void v.play().catch(() => { /* left paused; controls remain */ })
          }}
        />
      )}
      {/* Deliberately not the native controls. Those render a timer — 0:09 / 0:23
          — which turns a demonstration into a thing with a length, and invites
          the reader to decide whether they have 23 seconds to spare. A pause
          button and a rail say the same thing without starting that argument. */}
      {!reduced && (
        <div className="shot-controls">
          <button
            type="button"
            className="shot-toggle"
            onClick={toggle}
            aria-label={playing ? 'Pause the product demo' : 'Play the product demo'}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.4" height="14" rx="1" /><rect x="13.6" y="5" width="3.4" height="14" rx="1" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12z" /></svg>
            )}
          </button>
          <input
            className="shot-rail"
            type="range"
            min={0}
            max={1000}
            value={Math.round(progress * 1000)}
            onChange={(e) => seekTo(Number(e.currentTarget.value) / 1000)}
            aria-label="Seek through the product demo"
            style={{ '--p': `${progress * 100}%` } as React.CSSProperties}
          />
        </div>
      )}
      <figcaption>
        {caption}
        <span className="ph">{disclosure}</span>
      </figcaption>
    </figure>
  )
}

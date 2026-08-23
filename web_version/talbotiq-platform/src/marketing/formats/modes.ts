/**
 * The six interview formats, as showcase panels.
 *
 * Derived from `TRACKS` rather than duplicating it: that is where a format's
 * name, tag, description and meta already live, and a second hand-kept list is
 * how a seventh format gets added to one and not the other.
 *
 * Footage resolves through `hasDemo`, so a format with nothing on disk gets
 * `video: null` and its panel says why. Two are in that position, for different
 * reasons — `two_way` is a live call with no captured session, and `mcq` is
 * advertised but not yet recorded.
 *
 * React-free and CSS-free on purpose: `npm test` runs plain tsx in Node with no
 * DOM, so anything reached through a component module drags a CSS import in and
 * cannot be tested at all.
 */
import { DEMO_COPY, demoPosterSrc, demoVideoSrc, hasDemo } from '../demoAssets'
import { TRACKS } from '../tracks'

export type Mode = {
  name: string
  tag: string
  desc: string
  meta: readonly string[]
  href: string
  video: {
    src: string
    poster: string
    alt: string
    caption: string
    disclosure?: string
    contentAspect?: string
  } | null
}

/** Track → its platform page. routes.test.ts proves these resolve. */
const HREF: Record<string, string> = {
  chatbot: '/platform/conversational-chat',
  voice: '/platform/voice-screening',
  video_avatar: '/platform/ai-video-avatar',
  two_way: '/platform/live-two-way',
  chat: '/platform/timed-qa',
  mcq: '/platform/assessments',
}

/** Why a format has no footage. Shown on the panel rather than left blank. */
const NO_FILM: Record<string, string> = {
  two_way: 'A live call between your interviewer and the candidate, so there is no captured session to replay. The page walks through it.',
  mcq: 'Newly advertised, and its recording has not been captured yet. The page covers what it does.',
}

export const MODES: readonly Mode[] = TRACKS.map((t) => ({
  name: t.name,
  tag: t.tag,
  desc: t.desc,
  meta: t.meta,
  href: HREF[t.track],
  video: hasDemo(t.track)
    ? {
        src: demoVideoSrc(t.track),
        poster: demoPosterSrc(t.track),
        alt: DEMO_COPY[t.track].alt,
        caption: DEMO_COPY[t.track].caption,
        disclosure: DEMO_COPY[t.track].disclosure,
        contentAspect: DEMO_COPY[t.track].contentAspect,
      }
    : null,
}))

export const noFilmReason = (href: string): string => {
  const track = Object.keys(HREF).find((k) => HREF[k] === href)
  return (track && NO_FILM[track]) || 'No recording of this format has been captured yet.'
}

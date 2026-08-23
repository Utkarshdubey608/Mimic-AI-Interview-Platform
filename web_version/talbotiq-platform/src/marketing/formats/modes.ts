/**
 * The six interview formats, as showcase panels.
 *
 * Derived from `TRACKS` rather than duplicating it: that is where a format's
 * name, tag, description and meta already live, and a second hand-kept list is
 * how a seventh format gets added to one and not the other.
 *
 * Footage resolves through `hasDemo`, so a format with nothing on disk gets
 * `video: null` and its panel says why. All six have something now. `two_way` is
 * the odd one: it has footage, but not under its own name — see TRIMMED.
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
    /** Seconds to skip at the head of the file. See TRIMMED below. */
    startAt?: number
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

/**
 * Why a format has no footage. Shown on the panel rather than left blank.
 *
 * Empty, as of the assessment film being recorded — all six formats now have
 * something to play. Kept, with the branch that reads it, because `video` is a
 * nullable type and a format can lose its file again: a panel that says why is a
 * better failure than a panel with a hole in it.
 */
const NO_FILM: Record<string, string> = {}

/**
 * Footage that is not simply `mode-<track>.webm` played from the start.
 *
 * `two_way` is here, and the reason is worth stating plainly because it is not
 * what the file name suggests. `mode-video_avatar.webm` is NOT a recording of an
 * AI video avatar. Watch it: the first three seconds are the candidate's face
 * check, and everything after that is the TalbotIQ live call — "2 people in call",
 * speaker view, a guest tile, an End interview button. There is no avatar in it at
 * any point. It is two-way footage that has been filed under the wrong format, and
 * this entry is what puts it on the panel it actually depicts.
 *
 * The face check is skipped because it belongs to every format that uses a camera,
 * not to this one — a film of the live call should open in the call. Skipped rather
 * than cut: there is no ffmpeg in this repo, so trimming the file is not available,
 * and `startAt` was already in DemoVideo for exactly this (it also handles the
 * loop, returning to `startAt` rather than to zero). The cost is that the whole
 * file is still fetched.
 */
const TRIMMED: Record<string, NonNullable<Mode['video']>> = {
  two_way: {
    src: demoVideoSrc('video_avatar'),
    poster: '/mimic-shots/mode-two_way-poster.jpg',
    startAt: 3.4,
    alt: 'A live two-way interview in progress in the TalbotIQ call room: the candidate on camera in the main tile, the interviewer in a smaller tile above it, a live badge and an End interview control in the header, and mute, camera, share and captions controls along the bottom.',
    caption: 'The interviewer’s room during a live call, from the moment the camera check ends.',
    disclosure: 'Real interview, used with permission',
    contentAspect: '16 / 9',
  },
}

export const MODES: readonly Mode[] = TRACKS.map((t) => ({
  name: t.name,
  tag: t.tag,
  desc: t.desc,
  meta: t.meta,
  href: HREF[t.track],
  video: TRIMMED[t.track] ?? (hasDemo(t.track)
    ? {
        src: demoVideoSrc(t.track),
        poster: demoPosterSrc(t.track),
        alt: DEMO_COPY[t.track].alt,
        caption: DEMO_COPY[t.track].caption,
        disclosure: DEMO_COPY[t.track].disclosure,
        contentAspect: DEMO_COPY[t.track].contentAspect,
      }
    : null),
}))

export const noFilmReason = (href: string): string => {
  const track = Object.keys(HREF).find((k) => HREF[k] === href)
  return (track && NO_FILM[track]) || 'No recording of this format has been captured yet.'
}

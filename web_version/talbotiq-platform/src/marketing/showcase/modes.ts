/**
 * The showcase's panels, derived from the format cards.
 *
 * Derived, not duplicated: `TRACKS` in MimicSite.tsx is where a format's name,
 * tag, description and meta already live, and a second hand-maintained list is
 * how a seventh format gets added to one of them and not the other.
 *
 * Footage is resolved through `hasDemo`, so a format with nothing on disk gets
 * `video: null` and the panel states that plainly. Two formats are in that
 * position today for different reasons: `two_way` runs live and there is no
 * captured session to show, and `mcq` is advertised but not yet recorded.
 */
import { DEMO_COPY, demoPosterSrc, demoVideoSrc, hasDemo } from '../demoAssets'
import { TRACKS } from '../tracks'

export type Mode = {
  name: string
  tag: string
  desc: string
  meta: readonly string[]
  /** The format's own platform page. */
  href: string
  /** null when there is no footage — the panel shows why instead of a player. */
  video: {
    src: string
    poster: string
    alt: string
    caption: string
    disclosure?: string
    contentAspect?: string
  } | null
}

/** Track → platform page. The pages exist; routes.test.ts proves the links resolve. */
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
  two_way: 'This format is a live call between your interviewer and the candidate, so there is no captured session to replay here. The walkthrough covers it.',
  mcq: 'This format is newly advertised and its recording has not been captured yet. The page covers what it does.',
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

/** The sentence a footage-less panel shows. */
export const noFilmReason = (href: string): string => {
  const track = Object.keys(HREF).find((k) => HREF[k] === href)
  return (track && NO_FILM[track]) || 'No recording of this format has been captured yet.'
}

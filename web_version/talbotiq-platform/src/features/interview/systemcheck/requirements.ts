/**
 * What each interview mode actually needs verified before it may start.
 *
 * A table, not a chain of `||` comparisons. The bug this feature exists to kill
 * came from a predicate that enumerated five of six tracks and quietly omitted
 * the sixth; `Record<TrackType, …>` makes that a compile error instead.
 *
 * Typed modes ask for nothing hardware-critical: the timed question stage does
 * not use `useFacialCapture` (only VideoStage and the avatar-screening page do),
 * so there is no hidden proctoring dependency on `chat`.
 */
import type { TrackType } from '@shared/types'

export type CheckId = 'browser' | 'mic' | 'camera' | 'face' | 'speaker' | 'connectivity'

const BY_TRACK: Record<TrackType, CheckId[]> = {
  chat:         ['browser'],
  chatbot:      ['browser'],
  // Spoken: the candidate must hear the interviewer, so output is confirmed too.
  voice:        ['browser', 'mic', 'speaker'],
  video_avatar: ['browser', 'mic', 'camera', 'face', 'speaker'],
  // Recorded answers — questions are on screen, so no speaker requirement.
  video:        ['browser', 'mic', 'camera', 'face'],
  // A live call fails in ways device access cannot predict; hence connectivity.
  two_way:      ['browser', 'mic', 'camera', 'face', 'speaker', 'connectivity'],
}

export function requirementsFor(track: TrackType): CheckId[] {
  return BY_TRACK[track] ?? ['browser']
}

export function requires(track: TrackType, id: CheckId): boolean {
  return requirementsFor(track).includes(id)
}

import type { TrackType } from '@shared/types'

/**
 * What happens when a candidate leaves the interview.
 *
 * ── What was wrong before ────────────────────────────────────────────────
 * The client counted tab switches, showed a small corner toast reading
 * "(1/3)", and then did nothing at all when the count reached 3. The limit was
 * decoration: a candidate could switch away forty times and the interview
 * carried on. Meanwhile the server had been dutifully counting the whole time.
 *
 * A rule that is announced and never enforced is worse than no rule. It tells
 * honest candidates they are constrained while the dishonest ones discover in
 * about ninety seconds that they are not.
 *
 * ── The policy ───────────────────────────────────────────────────────────
 * Every departure is acknowledged explicitly, in the middle of the screen,
 * because a corner toast during a timed answer is genuinely easy to miss. On
 * the final strike the interview ends and is submitted.
 *
 * Pure functions, no React and no network, so the decision can be tested
 * exhaustively. See integrityPolicy.test.ts.
 */

export type IntegrityKind = 'tab_switch' | 'fullscreen_exit'

export type IntegrityDecision =
  /** Nothing to show: the limit is not enforced, or this is not a countable event. */
  | { action: 'ignore' }
  /** Show the blocking notice. The candidate acknowledges and continues. */
  | { action: 'warn'; used: number; max: number; remaining: number }
  /** The limit is spent. Tell them, then submit the interview. */
  | { action: 'terminate'; used: number; max: number }

/**
 * Decide what to do about one integrity event.
 *
 * `used` and `max` come from the server response, which is the only counter
 * that matters: a client-side tally would reset on refresh, and refreshing is
 * exactly what someone gaming the limit would try.
 *
 * A missing or non-positive `max` means the recruiter did not set a limit, so
 * the event is still recorded server-side but nothing is enforced here. We do
 * not invent a default: silently enforcing a limit the recruiter never
 * configured would end interviews nobody agreed to end.
 */
export function decideIntegrity(
  used: number | undefined,
  max: number | undefined,
): IntegrityDecision {
  if (typeof used !== 'number' || typeof max !== 'number' || max <= 0) return { action: 'ignore' }
  if (used >= max) return { action: 'terminate', used, max }
  return { action: 'warn', used, max, remaining: Math.max(0, max - used) }
}

/**
 * Which API call actually ends an interview, per track.
 *
 * The six tracks do NOT share one completion path, and calling the wrong one
 * leaves a session half-finished: the timed engine's `complete` does not stop a
 * Tavus room, and `avatarComplete` does not score a written answer. Getting
 * this wrong on an auto-submit would end the interview in the UI while the
 * server still believed it was running.
 */
export type CompletionCall = 'complete' | 'avatarComplete' | 'twowayComplete'

export function completionCallFor(track: TrackType): CompletionCall {
  switch (track) {
    case 'video_avatar': return 'avatarComplete'
    case 'two_way': return 'twowayComplete'
    // chat, video: the timed engine. chatbot, voice: their own engines, but both
    // finalise through the same session complete endpoint.
    default: return 'complete'
  }
}

/** The wording for a notice. Kept here so it is covered by the same tests. */
export function integrityCopy(kind: IntegrityKind, decision: IntegrityDecision) {
  const what =
    kind === 'fullscreen_exit'
      ? 'You left fullscreen.'
      : 'You switched away from the interview.'

  if (decision.action === 'terminate') {
    return {
      title: 'Your interview has ended',
      body: `${what} That was the last of the ${decision.max} permitted, so the interview has been submitted with the answers you gave. The hiring team can see that the limit was reached.`,
      confirm: 'Close',
    }
  }
  if (decision.action === 'warn') {
    return {
      title: 'Please stay on this screen',
      body: `${what} This was recorded. ${decision.remaining === 1 ? 'One more and your interview will end automatically.' : `You have ${decision.remaining} left before your interview ends automatically.`}`,
      confirm: 'Continue interview',
    }
  }
  return { title: '', body: '', confirm: '' }
}

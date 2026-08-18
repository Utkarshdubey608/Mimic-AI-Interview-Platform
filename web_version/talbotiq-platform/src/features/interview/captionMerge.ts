import type { VoiceCaption } from '@shared/types'

/**
 * Merging two transcript streams into one ordered conversation.
 *
 * The voice interview has two sources of the candidate's words:
 *
 *   LOCAL   the browser's own recogniser. Instant, emits while they are still
 *           speaking, less accurate. Display only.
 *   GEMINI  `inputTranscription` from the Live API. Authoritative, and what the
 *           interview is SCORED from, but only emitted once its VAD decides the
 *           turn has ended.
 *
 * ── The bug this module fixes ────────────────────────────────────────────
 * Gemini's version of a candidate turn frequently arrives AFTER the next
 * question has already streamed in, because the model starts composing its
 * reply the moment the turn closes. The previous merge appended any candidate
 * line that had no open partial, so the rail showed the conversation in the
 * wrong order:
 *
 *     YOU             .
 *     AI INTERVIEWER  …Can you elaborate on the optimisation techniques?
 *     YOU             Sure, let's start.        ← actually said FIRST
 *
 * The fix is positional. The local recogniser opens the candidate's line while
 * they are still talking, so the line already sits in the right place; when
 * Gemini's text arrives it OVERWRITES that line rather than appending a new one.
 *
 * Pure functions, no React, so the ordering can be tested directly. See
 * captionMerge.test.ts.
 */

export interface MergedCaption extends VoiceCaption {
  /** Opened by the local recogniser, still awaiting Gemini's version. */
  local?: boolean
}

/**
 * Apply an authoritative caption from Gemini.
 *
 * A candidate line claims the OLDEST slot still waiting to be confirmed, which
 * is either a line the local recogniser opened or a partial Gemini itself
 * started. Oldest rather than newest matters: if the candidate got two
 * utterances in before either was confirmed, the first confirmation belongs to
 * the first thing they said, and claiming the newest would swap them.
 */
export function applyRemote(
  prev: MergedCaption[],
  role: 'interviewer' | 'candidate',
  text: string,
  final: boolean,
): MergedCaption[] {
  const next = [...prev]

  if (role === 'candidate') {
    const slot = next.findIndex((c) => c.role === 'candidate' && (c.local || !c.final))
    if (slot !== -1) {
      next[slot] = { role, text, final, local: false }
      return next
    }
    return [...next, { role, text, final }]
  }

  // The interviewer streams strictly in order, so extending its own most recent
  // unfinished line is always right.
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === role && !next[i].final) {
      next[i] = { role, text, final }
      return next
    }
  }
  return [...next, { role, text, final }]
}

/**
 * Apply the local recogniser's running text.
 *
 * It extends the candidate's currently-open local line, or opens a new one. A
 * new line is opened as soon as anything from the interviewer, or any confirmed
 * candidate line, sits after the last local one, because that means the previous
 * utterance is closed and this is a fresh one.
 *
 * Returns `prev` unchanged when nothing moved, so React can skip the re-render.
 */
export function applyLocal(prev: MergedCaption[], text: string): MergedCaption[] {
  if (!text) return prev
  const next = [...prev]

  for (let i = next.length - 1; i >= 0; i--) {
    const c = next[i]
    if (c.role === 'candidate' && c.local && !c.final) {
      if (c.text === text) return prev
      next[i] = { ...c, text }
      return next
    }
    // Anything else means the previous local line is closed off.
    if (c.role === 'interviewer' || !c.local) break
  }

  return [...next, { role: 'candidate', text, final: false, local: true }]
}

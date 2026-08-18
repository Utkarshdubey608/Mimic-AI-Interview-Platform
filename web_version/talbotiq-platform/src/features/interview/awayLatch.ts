/**
 * Deciding when a candidate has actually left, across browser engines.
 *
 * The bug this exists for: on Safari/macOS a candidate could switch tabs
 * indefinitely and nothing was recorded. The old detector listened to
 * `visibilitychange` alone, which Chrome fires reliably for a tab switch and
 * Safari does not always — notably when moving to another *application* rather
 * than another tab, where Safari may only blur the window.
 *
 * So we listen to several signals. That immediately creates two problems this
 * module exists to solve:
 *
 *  1. DOUBLE COUNTING. Chrome fires `blur` AND `visibilitychange` for one tab
 *     switch. Reporting both would inflate the warning count against a
 *     candidate who did one thing, and the count is shown to them and to the
 *     recruiter. The latch reports the FIRST signal of an away period and
 *     ignores the rest until they come back.
 *
 *  2. IFRAME FALSE POSITIVES. The avatar, two-way and voice modes embed a call
 *     in an iframe. Clicking into that iframe blurs the top window — the
 *     candidate has done nothing but click on their own interview. Blur is
 *     therefore only trusted when the DOCUMENT has also lost focus, which
 *     stays true while focus is merely inside an iframe.
 *
 * Pure and dependency-injected so both are provable without a browser.
 */

export type AwaySignal = 'hidden' | 'visible' | 'blur' | 'focus' | 'pagehide'

export interface LatchState {
  /** True between leaving and coming back. */
  away: boolean
}

export const initialLatch: LatchState = { away: false }

export interface LatchResult {
  state: LatchState
  /** Report an integrity event — true at most once per away period. */
  report: boolean
}

/**
 * @param hasFocus `document.hasFocus()` at the moment of the signal. Only
 *   consulted for `blur`: it is what separates "left the page" from "clicked
 *   the video iframe", because the document keeps focus in the latter.
 */
export function nextLatch(state: LatchState, signal: AwaySignal, hasFocus: boolean): LatchResult {
  switch (signal) {
    case 'visible':
    case 'focus':
      return { state: { away: false }, report: false }

    case 'blur':
      // Focus went somewhere inside our own page. Not a switch.
      if (hasFocus) return { state, report: false }
      return state.away ? { state, report: false } : { state: { away: true }, report: true }

    case 'hidden':
    case 'pagehide':
      return state.away ? { state, report: false } : { state: { away: true }, report: true }
  }
}

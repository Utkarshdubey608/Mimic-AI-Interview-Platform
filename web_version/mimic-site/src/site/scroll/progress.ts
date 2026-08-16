/**
 * Pure scroll math for the marketing scroll engine.
 *
 * Deliberately free of React and DOM so it can be unit-tested by `npm test`,
 * which runs plain tsx in Node with no jsdom. Everything that needs a DOM lives
 * in the components; everything that can be arithmetic lives here.
 */

/** Clamp to the 0‥1 range every progress value in this module operates on. */
export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** Symmetric ease. Exact at 0, 0.5 and 1 so step boundaries land cleanly. */
export function easeInOutCubic(t: number): number {
  const c = clamp01(t)
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}

export type StepState = { step: number; t: number; steps: number }

/**
 * Split a 0‥1 pass through a pinned section into a discrete step index and a
 * local 0‥1 position within that step.
 *
 * At p = 1 the naive `floor(p * steps)` returns `steps`, one past the last
 * index, so the final step is clamped and its local t resolves to exactly 1 —
 * the last beat must be able to reach its finished state.
 */
export function stepProgress(p: number, steps: number): StepState {
  const c = clamp01(p)
  if (steps <= 1) return { step: 0, t: c, steps }
  const scaled = c * steps
  const step = Math.min(steps - 1, Math.floor(scaled))
  return { step, t: scaled - step, steps }
}

/**
 * Breathing room a pinned stage keeps between its content and the two edges of
 * the viewport, in px. Content that ends exactly on the fold has not been cut,
 * but it reads as though it has, and one late-loading font is enough to turn
 * "exactly" into "cut". 24px is the smallest gap that still reads as a margin.
 */
export const STAGE_FIT_MARGIN = 24

/**
 * Whether a stage may pin.
 *
 * Pinning holds a section still inside a 100vh sticky box with `overflow:hidden`
 * and its content vertically centred, so content taller than the viewport is
 * silently cut in half — half off the top, half off the bottom. The process
 * section is 697px tall; on a 1536×640 laptop viewport (1920×800 at the 125%
 * scaling Windows ships on) it pinned anyway and the reader lost the first line
 * of "Invite. Interview. Score. Shortlist." and the last of the five steps.
 *
 * Width alone could not catch this: that viewport is 1536px wide, comfortably
 * past the 1081px gate. Height is what the effect actually spends, so height is
 * what it has to be able to afford — measured, not assumed, because the content
 * changes with copy, zoom and the reader's own font size.
 *
 * A `contentH` of 0 means "not measured yet", not "empty", and a `viewportH` of
 * 0 means there is no viewport to pin to. Neither may pin: an unpinned stage is
 * an ordinary section that shows every step, which is the one outcome that is
 * never wrong.
 */
export function canPinStage(env: {
  reduced: boolean
  wide: boolean
  contentH: number
  viewportH: number
}): boolean {
  if (env.reduced || !env.wide) return false
  if (env.contentH <= 0 || env.viewportH <= 0) return false
  return env.contentH + STAGE_FIT_MARGIN <= env.viewportH
}

/**
 * Progress of an element across the viewport: 0 when its top edge touches the
 * bottom of the viewport, 1 when its bottom edge clears the top.
 *
 * Takes a plain `{ top, height }` rather than a DOMRect so it stays testable.
 */
export function sectionProgress(rect: { top: number; height: number }, viewportH: number): number {
  const span = rect.height + viewportH
  if (span <= 0) return 0
  return clamp01((viewportH - rect.top) / span)
}

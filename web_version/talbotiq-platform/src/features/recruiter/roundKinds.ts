/**
 * The vocabulary a rounds timeline is drawn in.
 *
 * Split out of `TimelinePanel` rather than living beside the components: under
 * `react-refresh/only-export-components` a file that exports both a component and a
 * constant costs a warning, and the lint gate runs at `--max-warnings 0`.
 */
import type { RoundKind, RoundState } from '@shared/types'

export const KINDS: { id: RoundKind; label: string; hint: string }[] = [
  { id: 'resume', label: 'Résumé screen', hint: 'They submit a CV — no interview session' },
  { id: 'chat', label: 'Timed Q&A', hint: 'Typed answers, one question at a time' },
  { id: 'video', label: 'Video answers', hint: 'Recorded video responses' },
  { id: 'voice', label: 'Voice interview', hint: 'A spoken conversation with the AI' },
  { id: 'two_way', label: 'Live interview', hint: 'A real call with a person — you score it' },
]

/** What each state looks like on the chip beside a stage's name. */
export const STATE_CHIP: Record<RoundState, string> = {
  open: 'border-ok-rule bg-ok-bg text-ok',
  scheduled: 'border-border bg-surface-sunk text-ink-muted',
  // NOT an error colour. A closed round is a normal end state, not a fault.
  closed: 'border-border bg-surface-hover text-ink-body',
}

/** Plain words for the state, because "scheduled"/"open" are the stored values. */
export const STATE_WORD: Record<RoundState, string> = {
  open: 'Running now',
  scheduled: 'Not started',
  closed: 'Finished',
}

export const DOT_TONE = {
  done: 'border-ok bg-ok text-white',
  live: 'border-ok bg-ok-bg text-ok',
  waiting: 'border-rule-strong bg-surface text-ink-faint',
  action: 'border-action bg-action text-action-ink',
  muted: 'border-dashed border-rule-strong bg-surface text-ink-faint',
} as const

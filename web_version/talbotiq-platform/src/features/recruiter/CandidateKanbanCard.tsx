import { useNavigate } from 'react-router-dom'
import { ArrowRight, Undo2 } from 'lucide-react'
import { Badge, cn } from '@/components/ui'
import type { CandidateBoardCard } from '@shared/types'

const STATUS_VARIANT: Record<string, 'success' | 'info' | 'neutral'> = {
  completed: 'success',
  in_progress: 'info',
  assigned: 'neutral',
}
const STATUS_LABEL: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  assigned: 'Assigned',
}

/**
 * One candidate on the board. Built fresh — NOT the older `Cardlet` in
 * PipelineBoardPage.tsx, which is scoped to that file's own `BoardCard` /
 * `PipelineCandidate` types and is drag-driven.
 *
 * This card is still not draggable — see AdvanceCandidateModal's doc comment for
 * why — but it does mutate now, through explicit per-card actions that reuse the
 * same `roundsApi.assign`/`unassign` RoundsModal already calls. The root can no
 * longer be a single `<button>` (an interactive footer sits inside it now, and a
 * button cannot nest a button), so the "view report" region is its own inner
 * button and the actions are a sibling row.
 */
export function CandidateKanbanCard({
  card, roleLabel, onAdvance, onRemove,
}: {
  card: CandidateBoardCard
  /** Human label for `card.roleCategory`, resolved by the caller (which already
   *  has the category list loaded for the filter bar) — or null when unset. */
  roleLabel: string | null
  /** Absent (no button rendered) when `card.currentTestId` is null — a legacy
   *  interview created before round-scoping existed has nothing to act on. */
  onAdvance?: (card: CandidateBoardCard) => void
  onRemove?: (card: CandidateBoardCard) => void
}) {
  const navigate = useNavigate()
  const statusVariant = STATUS_VARIANT[card.currentStatus] ?? 'neutral'
  const statusLabel = STATUS_LABEL[card.currentStatus] ?? card.currentStatus.replace(/_/g, ' ')
  const canAct = !!card.currentTestId
  // Mirrors the server's own refusal in rounds_writer.unassign (anyone past
  // "assigned" holds a transcript/score it will not delete) — same defense-in-depth
  // pattern CandidateRow in RoundsModal.tsx already uses for its own move-back button.
  const canRemove = canAct && card.currentStatus === 'assigned'

  return (
    <div className="w-full rounded-2xl border border-border bg-surface p-3.5 transition-shadow duration-150 hover:shadow-sm">
      <button
        type="button"
        onClick={() => navigate(`/sessions/${card.currentInterviewId}/report`)}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-bold tracking-[-0.01em] text-ink">{card.name || card.email}</div>
          {/* Only a secondary line when it says something new. */}
          {card.name && (
            <div className="truncate font-mono text-[11px] leading-4 text-ink-faint">{card.email}</div>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="neutral">{roleLabel ?? 'Role not specified'}</Badge>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </div>

        {/* Progress dots — one per round the candidate has ACTUALLY been assigned
            to (`card.rounds`). Never fabricates rounds they have not reached. */}
        {card.rounds.length > 0 && (
          <div className="mt-2.5 flex items-center gap-1" aria-label="Round progress">
            {card.rounds.map((r) => (
              <span
                key={r.interviewId}
                title={`${r.roundTitle ?? `Round ${r.roundOrder + 1}`} — ${r.status.replace(/_/g, ' ')}`}
                className={cn(
                  'h-1.5 flex-1 rounded-full',
                  r.status === 'completed'
                    ? 'bg-ok'
                    : r.interviewId === card.currentInterviewId
                      ? 'bg-action'
                      : 'border border-border bg-surface-hover',
                )}
              />
            ))}
          </div>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-ink-muted">
            {card.currentRoundTitle ?? `Round ${card.currentRoundOrder + 1}`}
          </span>
          {card.currentScore !== null ? (
            <span className="text-sm font-bold tabular-nums text-ink">{card.currentScore}</span>
          ) : (
            <span title="No score yet" className="text-xs font-medium text-ink-disabled">—</span>
          )}
        </div>
      </button>

      {(onAdvance || onRemove) && canAct && (
        <div className="mt-2.5 flex items-center justify-end gap-1 border-t border-border pt-2">
          {onRemove && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(card) }}
              disabled={!canRemove}
              title={canRemove ? 'Take them out of this round' : 'They have already started this round — removing it would destroy their answers'}
              aria-label={`Take ${card.email} out of this round`}
              className="flex-shrink-0 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-danger-bg hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-faint"
            >
              <Undo2 size={14} />
            </button>
          )}
          {onAdvance && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAdvance(card) }}
              title="Advance to the next round"
              aria-label={`Advance ${card.email} to the next round`}
              className="flex-shrink-0 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <ArrowRight size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

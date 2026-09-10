import { useNavigate } from 'react-router-dom'
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
 * One candidate on the read-only board. Built fresh — NOT the older `Cardlet`
 * in PipelineBoardPage.tsx, which is scoped to that file's own `BoardCard` /
 * `PipelineCandidate` types and is draggable (this card deliberately is not:
 * the Kanban here never mutates a candidate's progress).
 */
export function CandidateKanbanCard({
  card, roleLabel,
}: {
  card: CandidateBoardCard
  /** Human label for `card.roleCategory`, resolved by the caller (which already
   *  has the category list loaded for the filter bar) — or null when unset. */
  roleLabel: string | null
}) {
  const navigate = useNavigate()
  const statusVariant = STATUS_VARIANT[card.currentStatus] ?? 'neutral'
  const statusLabel = STATUS_LABEL[card.currentStatus] ?? card.currentStatus.replace(/_/g, ' ')

  return (
    <button
      type="button"
      onClick={() => navigate(`/sessions/${card.currentInterviewId}/report`)}
      className={cn(
        'w-full rounded-2xl border border-border bg-surface p-3.5 text-left transition-shadow duration-150',
        'hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2',
      )}
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

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2.5">
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
  )
}

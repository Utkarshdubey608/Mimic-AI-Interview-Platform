import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowRight, Loader2, Undo2 } from 'lucide-react'
import { Button, Modal } from '@/components/ui'
import { roundsApi, describeFetchError } from '@/lib/api'
import type { CandidateBoardCard } from '@shared/types'

/**
 * Advance-to-next-round / remove-from-round confirmation, opened from a
 * CandidateKanbanCard action button.
 *
 * Deliberately NOT drag-and-drop (see CandidateKanbanCard's doc comment): this
 * board's columns span every RoleConfig a recruiter owns at once, so "the next
 * column" has no single meaning the way it does on PipelineBoardPage's one-pipeline
 * board. Instead this modal always computes the target from THIS candidate's own
 * timeline — `roundsApi.list(testId)`, filtered to `order === current + 1` — so it
 * can never offer (or imply) a round-1-to-round-4 jump, even though the shared
 * `assign`/`unassign` endpoints underneath do not themselves enforce adjacency
 * (RoundsModal's own "Add candidates" already relies on that flexibility today;
 * this is a narrower guarantee this specific surface imposes on itself).
 *
 * "Remove from round" — not "Reject" — because `unassign` is documented as the
 * undo for an accidental advance, not a hiring decision. The real decision flow
 * (RoundsModal's DecidePanel / outcomesApi.decideRound) is untouched by this.
 */
export function AdvanceCandidateModal({
  card, action, onClose,
}: {
  card: CandidateBoardCard | null
  action: 'advance' | 'remove' | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const open = !!card && !!action
  // undefined = still loading the timeline; null = no next round (last stage).
  const [nextRound, setNextRound] = useState<{ id: string; title: string } | null | undefined>(undefined)

  useEffect(() => {
    if (!open || action !== 'advance' || !card?.currentTestId) { setNextRound(undefined); return }
    let cancelled = false
    setNextRound(undefined)
    roundsApi.list(card.currentTestId)
      .then((timeline) => {
        if (cancelled) return
        const next = timeline.rounds.find((r) => r.order === card.currentRoundOrder + 1)
        setNextRound(next ? { id: next.id, title: next.title } : null)
      })
      .catch(() => { if (!cancelled) setNextRound(null) })
    return () => { cancelled = true }
    // card is a fresh object each board refetch; key off the two fields that
    // actually identify "which timeline, which position," not the object itself.
  }, [open, action, card?.currentTestId, card?.currentRoundOrder])

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['candidates-board'] })

  const advance = useMutation({
    mutationFn: () => roundsApi.assign(card!.currentTestId as string, nextRound!.id, [card!.email]),
    onSuccess: () => {
      toast.success(`Moved to "${nextRound?.title}"`)
      invalidate()
      onClose()
    },
    onError: (e) => toast.error(describeFetchError(e, 'Could not advance this candidate')),
  })

  const remove = useMutation({
    mutationFn: () => roundsApi.unassign(card!.currentTestId as string, card!.currentRoundId as string, [card!.email]),
    onSuccess: (r) => {
      /* `kept` is the honest half of the answer, same as RoundsModal's moveBack:
         the server refuses anyone who has already started, and a bare "removed 0"
         would read as a silent bug rather than the deliberate refusal it is. */
      if (r.removed > 0) toast.success('Taken out of this round.')
      if (r.kept.length) toast.error(`${r.kept[0].email} ${r.kept[0].reason} — left where they are.`)
      invalidate()
      onClose()
    },
    onError: (e) => toast.error(describeFetchError(e, 'Could not remove them from this round')),
  })

  const busy = advance.isPending || remove.isPending

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={action === 'advance' ? 'Advance to the next round' : 'Remove from this round'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          {action === 'advance' ? (
            <Button
              icon={<ArrowRight size={14} />} loading={advance.isPending}
              disabled={!nextRound || busy}
              onClick={() => advance.mutate()}
            >
              Advance
            </Button>
          ) : (
            <Button
              variant="danger" icon={<Undo2 size={14} />} loading={remove.isPending}
              disabled={busy}
              onClick={() => remove.mutate()}
            >
              Remove
            </Button>
          )}
        </>
      }
    >
      {action === 'advance' && (
        nextRound === undefined ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 size={14} className="animate-spin" /> Checking this pipeline's next round…</p>
        ) : nextRound === null ? (
          <p className="text-sm text-ink-body">This is already their last round in this pipeline — there is nowhere to advance them to.</p>
        ) : (
          <p className="text-sm leading-relaxed text-ink-body">
            Move <span className="font-semibold text-ink">{card?.name || card?.email}</span> from{' '}
            <span className="font-semibold text-ink">{card?.currentRoundTitle ?? `Round ${(card?.currentRoundOrder ?? 0) + 1}`}</span> into{' '}
            <span className="font-semibold text-ink">"{nextRound.title}"</span>? This assigns them to that round for real — it does not send a new invite
            email; do that from the round's own timeline view if they need one.
          </p>
        )
      )}
      {action === 'remove' && (
        <p className="text-sm leading-relaxed text-ink-body">
          Take <span className="font-semibold text-ink">{card?.name || card?.email}</span> out of{' '}
          <span className="font-semibold text-ink">{card?.currentRoundTitle ?? `Round ${(card?.currentRoundOrder ?? 0) + 1}`}</span>? They keep their place in
          earlier rounds and everything they did there — this only undoes this round's assignment, and refuses if they've already started it.
        </p>
      )}
    </Modal>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, RotateCw, Undo2 } from 'lucide-react'
import { Button, Modal, EmptyState, Skeleton, ErrorState } from '@/components/ui'
import { outcomesApi, describeFetchError } from '@/lib/api'
import type { RetryableEvaluation } from '@shared/types'

/**
 * Recovering an interview nothing managed to score.
 *
 * In the browser this was a dead end. The candidate's answers were sitting on the
 * interview document, the scorer could simply have run again, and there was no route
 * to it — so a recruiter's only options were a manual evaluation or asking someone to
 * sit the whole interview a second time. The phone had both actions; the web had
 * neither.
 *
 * **Two actions, deliberately in this order.** Re-scoring is free and keeps
 * everything, so it comes first and is the primary button. Clearing throws away the
 * candidate's answers and makes them do it again, so it is secondary, and it says so.
 */
export function RecoverScoringModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['retryable'],
    queryFn: outcomesApi.retryable,
    enabled: open,
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['retryable'] })
    void qc.invalidateQueries({ queryKey: ['sessions'] })
  }

  const retry = useMutation({
    mutationFn: (id: string) => outcomesApi.retryEvaluation(id),
    onMutate: (id) => setBusy(id),
    onSettled: () => setBusy(null),
    onSuccess: (result) => {
      /* The scorer never throws — it records failures on the document — so a
         response without an exception is NOT the same as a score. Read what
         actually happened and say it, or this feature reproduces the silent
         failure it exists to fix. */
      if (result.scored) {
        toast.success(`Scored ${result.overallScore ?? ''}`.trim())
      } else {
        toast.error(result.error || 'It failed again, for the same reason.')
      }
      invalidate()
    },
    onError: (error) =>
      toast.error(describeFetchError(error, 'Could not re-run scoring.')),
  })

  const clear = useMutation({
    mutationFn: (id: string) => outcomesApi.clearResult(id),
    onMutate: (id) => setBusy(id),
    onSettled: () => setBusy(null),
    onSuccess: () => {
      toast.success('Reopened — they can take it again.')
      invalidate()
    },
    onError: (error) =>
      toast.error(describeFetchError(error, 'Could not reopen the interview.')),
  })

  return (
    <Modal open={open} onClose={onClose} title="Interviews that were not scored">
      {list.isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : list.isError ? (
        <ErrorState
          title="Couldn’t load these"
          detail={describeFetchError(list.error, 'The interviews are safe — this is a display problem.')}
          onRetry={() => void list.refetch()}
        />
      ) : !list.data?.length ? (
        <EmptyState
          title="Nothing to recover"
          description="Every completed interview here has a score. Anything that fails to score in future shows up on this list with its answers kept, so it can be re-run."
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">
            Nothing scored these, and their answers were kept — so the scorer can simply
            run again. No one needs to sit the interview a second time.
          </p>

          <ul className="divide-y divide-border rounded-md border border-border">
            {list.data.map((row: RetryableEvaluation) => {
              const working = busy === row.id
              return (
                <li key={row.id} className="p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-900">
                        {row.candidate.name || row.candidate.email}
                      </p>
                      <p className="truncate text-xs text-neutral-500">{row.title}</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {/* The count is the evidence that a re-score can work at all. */}
                        {row.answers} stored answer{row.answers === 1 ? '' : 's'}
                      </p>
                    </div>

                    <div className="flex flex-shrink-0 gap-2">
                      <Button
                        size="sm"
                        onClick={() => retry.mutate(row.id)}
                        loading={working && retry.isPending}
                        disabled={working}
                        icon={<RotateCw size={14} />}
                      >
                        Score it again
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          /* Irreversible, and it costs the candidate their time —
                             so it asks, and names what is lost. */
                          if (
                            !window.confirm(
                              `Reopen this interview for ${row.candidate.email}?\n\n` +
                                'Their stored answers are deleted and they will have to ' +
                                'take it again. Try "Score it again" first — that keeps ' +
                                'everything.',
                            )
                          ) return
                          clear.mutate(row.id)
                        }}
                        loading={working && clear.isPending}
                        disabled={working}
                        icon={<Undo2 size={14} />}
                      >
                        Reopen
                      </Button>
                    </div>
                  </div>

                  {row.error ? (
                    <p className="mt-2 flex items-start gap-1.5 rounded-md bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-600">
                      <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-warning" aria-hidden="true" />
                      {/* Verbatim from the scorer: a transient upstream error reads
                          very differently from "too little was said", and only one of
                          them is worth retrying immediately. */}
                      {row.error}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Modal>
  )
}

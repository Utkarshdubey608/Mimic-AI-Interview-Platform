import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CheckCircle2, Info, Trophy } from 'lucide-react'
import { Button, Modal, Toggle, cn } from '@/components/ui'
import { outcomesApi, describeFetchError } from '@/lib/api'
import type { SessionListItem } from '@shared/types'

/**
 * Decide a round: who moves forward, what they are told, and whether to release it.
 *
 * This is the recruiter action the web app did not have. It could write
 * `resultPublished` only as `false`, at creation, and never set it true — so a
 * recruiter working in the browser could score a whole round and had no way to tell a
 * single candidate anything. Only the phone could release a result.
 *
 * Three decisions carried over from the Flutter implementation, which is the more
 * developed one:
 *
 * **Ranked by score, best first.** Only SCORED candidates are ranked — an unscored one
 * has no rank — so the list here is shorter than the round's candidate count, and the
 * gap is reported rather than hidden. A round that looks complete when a third of it
 * was never scored is how someone gets rejected for a scoring failure.
 *
 * **Deciding and releasing are separate.** The publish toggle defaults ON because
 * that is the common case, but turning it off lets a recruiter settle the whole round
 * and release it later in one go.
 *
 * **The notes are written FOR the candidate.** They are the only free text a candidate
 * ever sees about their interview — the score, the AI's verdict and its list of their
 * weaknesses never leave the recruiter's side, enforced server-side by an allowlist.
 */
export function DecideRoundModal({
  open,
  onClose,
  sessions,
}: {
  open: boolean
  onClose: () => void
  sessions: SessionListItem[]
}) {
  const qc = useQueryClient()

  /* Ranked best-first, and ONLY the scored ones.
   *
   * `overallScore` is absent rather than 0 for an interview that could not be scored —
   * a 0 would rank the candidate last as though they had earned it. So absence is
   * filtered out here, not sorted to the bottom. */
  const ranked = useMemo(
    () =>
      sessions
        .filter((s) => s.status === 'completed' && typeof s.overallScore === 'number')
        .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0)),
    [sessions],
  )

  /* Completed but never scored. Reported, never silently dropped: these people sat the
   * interview and are about to be excluded from a decision without anybody noticing. */
  const unscored = useMemo(
    () =>
      sessions.filter(
        (s) => s.status === 'completed' && typeof s.overallScore !== 'number',
      ),
    [sessions],
  )

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [noteForSelected, setNoteForSelected] = useState('')
  const [noteForRejected, setNoteForRejected] = useState('')
  const [publish, setPublish] = useState(true)
  /* Separate from `publish`, and OFF by default. Publishing makes the outcome visible
     when they next sign in; this pushes it to their inbox, and an email cannot be
     unsent. */
  const [sendEmails, setSendEmails] = useState(false)

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectTop = (n: number) =>
    setSelected(new Set(ranked.slice(0, n).map((s) => s.id)))

  const decide = useMutation({
    mutationFn: () =>
      outcomesApi.decideRound({
        ranked: ranked.map((s) => s.id),
        selectedIds: [...selected],
        noteForSelected: noteForSelected.trim() || undefined,
        noteForRejected: noteForRejected.trim() || undefined,
        publish,
        sendEmails,
      }),
    onSuccess: (result) => {
      toast.success(
        publish
          ? `${result.decided} candidate${result.decided === 1 ? '' : 's'} decided and told.`
          : `${result.decided} candidate${result.decided === 1 ? '' : 's'} decided. Nothing released yet.`,
      )
      /* A separate message, not folded into the one above: the DECISION landed for
         everyone regardless, and a bounced address is a different problem from a
         failed decision. Naming the count lets a recruiter retry those rather than
         re-sending to the whole round. */
      if (result.emailFailures?.length) {
        toast.error(
          `${result.emailFailures.length} email${result.emailFailures.length === 1 ? '' : 's'} could not be sent. The decisions are saved.`,
        )
      }
      void qc.invalidateQueries({ queryKey: ['sessions'] })
      onClose()
    },
    onError: (error) =>
      toast.error(
        describeFetchError(error, 'Could not record the decision. Nothing was changed.'),
      ),
  })

  const rejectedCount = ranked.length - selected.size

  return (
    <Modal open={open} onClose={onClose} title="Decide this round">
      {ranked.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Nothing to decide yet — no completed interview here has a score.
          {unscored.length > 0
            ? ` ${unscored.length} finished without one; re-score those first.`
            : ''}
        </p>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-neutral-600">
                {ranked.length} scored candidate{ranked.length === 1 ? '' : 's'}, best first.
                Tick everyone moving forward.
              </p>
              <div className="flex gap-1.5">
                {[3, 5, 10]
                  .filter((n) => n < ranked.length)
                  .map((n) => (
                    <Button key={n} variant="secondary" size="sm" onClick={() => selectTop(n)}>
                      Top {n}
                    </Button>
                  ))}
                {selected.size > 0 ? (
                  <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>

            {/* The list scrolls inside its own container so a round of two hundred
                does not push the decision controls off the page. */}
            <ul className="mt-3 max-h-[280px] overflow-y-auto rounded-md border border-border">
              {ranked.map((s, index) => {
                const isSelected = selected.has(s.id)
                return (
                  <li
                    key={s.id}
                    className={cn(
                      'flex items-center gap-3 border-b border-border px-3 py-2 last:border-0',
                      isSelected && 'bg-success/5',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(s.id)}
                      aria-label={`Move ${s.candidate.email} forward`}
                      className="h-4 w-4 flex-shrink-0 accent-primary"
                    />
                    {/* The rank the candidate will be STAMPED with — position in this
                        list, not something recomputed later. Shown so the recruiter
                        sees exactly what is about to be recorded. */}
                    <span className="w-7 flex-shrink-0 text-right text-xs tabular-nums text-neutral-400">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-900">
                      {s.candidate.name || s.candidate.email}
                    </span>
                    <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-neutral-900">
                      {s.overallScore}
                    </span>
                  </li>
                )
              })}
            </ul>

            {unscored.length > 0 ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                <Info size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                {/* Named rather than hidden: these candidates sat the interview and are
                    about to be left out of the decision entirely. */}
                {unscored.length} completed interview{unscored.length === 1 ? '' : 's'} could not
                be scored and {unscored.length === 1 ? 'is' : 'are'} not in this decision.
                Re-score {unscored.length === 1 ? 'it' : 'them'} first if they should be.
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
                <CheckCircle2 size={14} className="text-success" aria-hidden="true" />
                Note for the {selected.size} moving forward
              </span>
              <textarea
                value={noteForSelected}
                onChange={(e) => setNoteForSelected(e.target.value)}
                rows={3}
                placeholder="We'd like to take you to the next round…"
                className="mt-1.5 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
                <Info size={14} className="text-neutral-400" aria-hidden="true" />
                Note for the other {rejectedCount}
              </span>
              <textarea
                value={noteForRejected}
                onChange={(e) => setNoteForRejected(e.target.value)}
                rows={3}
                placeholder="Thank you for the time you gave this…"
                className="mt-1.5 w-full rounded-md border border-border px-3 py-2 text-sm"
              />
            </label>
          </div>

          {/* The candidate sees the outcome, their rank and these notes. Nothing else —
              not the score in the list above, not the AI's summary or its list of their
              weaknesses. That is enforced on the server by an allowlist, so this note
              is a reminder of the rule rather than the rule itself. */}
          <p className="rounded-md border border-border bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
            Candidates are shown the outcome, their rank, and the note you write here.
            They are never shown the score or the AI's assessment.
          </p>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="space-y-2">
            <Toggle
              checked={publish}
              onChange={setPublish}
              label="Tell the candidates now"
              // Off means decided but not released — settle the whole round, release
              // it when you are ready.
              description={publish ? undefined : 'Recorded but not shown to anyone yet.'}
            />
            <Toggle
              checked={sendEmails}
              onChange={setSendEmails}
              label="Email them as well"
              description={
                sendEmails
                  ? 'An email cannot be unsent.'
                  : 'They will see it next time they sign in.'
              }
            />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button
                onClick={() => decide.mutate()}
                loading={decide.isPending}
                disabled={decide.isPending}
                icon={<Trophy size={15} />}
              >
                {publish
                  ? `Decide and tell ${ranked.length}`
                  : `Record ${ranked.length} decision${ranked.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, CalendarClock, CheckCircle2, Plus, Square, UserPlus } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, Modal, Select, Skeleton, cn } from '@/components/ui'
import { roundsApi, describeFetchError } from '@/lib/api'
import type { InterviewRound, RoundKind, RoundState } from '@shared/types'

/**
 * A test's timeline, on the shared rounds model.
 *
 * The web had `web_pipelines` and the Flutter app had `tests/{testId}/rounds`, and
 * neither knew about the other — a candidate advanced on one was invisible on the
 * other. This is the Flutter model, which is the one being kept.
 *
 * **Additive, not a replacement.** The existing pipeline board still runs on
 * `web_pipelines`; the two models run in parallel until the old one is retired. This
 * panel is the capability the web genuinely lacked: authoring rounds a recruiter's
 * phone can also see.
 *
 * Two things it deliberately does NOT compute:
 *
 * • `state` comes from the server, derived from the clock. Recomputing it here would
 *   put a second answer in the product, and the two would disagree the moment a
 *   deadline passed between a fetch and a render.
 * • "Ending a round" is a server action for a reason a client cannot reproduce: each
 *   candidate's device gates on `expiresAt` on their OWN assignment, so closing a
 *   round means writing to every one of them.
 */
const KINDS: { id: RoundKind; label: string; hint: string }[] = [
  { id: 'resume', label: 'Résumé screen', hint: 'They submit a CV — no interview session' },
  { id: 'chat', label: 'Timed Q&A', hint: 'Typed answers, one question at a time' },
  { id: 'video', label: 'Video answers', hint: 'Recorded video responses' },
  { id: 'voice', label: 'Voice interview', hint: 'A spoken conversation with the AI' },
  { id: 'two_way', label: 'Live interview', hint: 'A real call with a person — you score it' },
]

const STATE_STYLE: Record<RoundState, string> = {
  open: 'border-ok-rule bg-ok-bg text-ok',
  scheduled: 'border-border bg-neutral-50 text-neutral-500',
  // NOT an error colour. A closed round is a normal end state, not a fault.
  closed: 'border-border bg-neutral-100 text-neutral-600',
}

export function TimelinePanel({ testId }: { testId: string }) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)

  const timeline = useQuery({
    queryKey: ['rounds', testId],
    queryFn: () => roundsApi.list(testId),
    enabled: !!testId,
  })

  const refresh = () => void qc.invalidateQueries({ queryKey: ['rounds', testId] })

  const end = useMutation({
    mutationFn: (roundId: string) => roundsApi.end(testId, roundId),
    onSuccess: (result) => {
      /* `lockedOut` is the number that matters: stamping the round alone closes
         nothing, so reporting "ended" without it would hide a no-op. */
      toast.success(
        result.lockedOut === 0
          ? 'Round ended. Nobody had it open.'
          : `Round ended — ${result.lockedOut} candidate${result.lockedOut === 1 ? '' : 's'} locked out.`,
      )
      refresh()
    },
    onError: (e) => toast.error(describeFetchError(e, 'Could not end the round.')),
  })

  const assign = useMutation({
    mutationFn: (roundId: string) => roundsApi.assign(testId, roundId),
    onSuccess: (result) => {
      toast.success(
        result.skipped > 0
          ? `${result.assigned} assigned, ${result.skipped} already in this round.`
          : `${result.assigned} candidate${result.assigned === 1 ? '' : 's'} assigned.`,
      )
      refresh()
    },
    onError: (e) => toast.error(describeFetchError(e, 'Could not assign candidates.')),
  })

  const adopt = useMutation({
    mutationFn: (roundId: string) => roundsApi.adopt(testId, roundId),
    onSuccess: (result) => {
      toast.success(`${result.adopted} earlier assignment(s) moved into this round.`)
      refresh()
    },
    onError: (e) => toast.error(describeFetchError(e, 'Could not adopt those.')),
  })

  const rounds = timeline.data?.rounds ?? []
  const orphaned = timeline.data?.legacyAssignments ?? 0

  return (
    <Card className="p-0">
      <div className="record-head flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <span className="section-label">Timeline</span>
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)} icon={<Plus size={14} />}>
          Add round
        </Button>
      </div>

      {timeline.isLoading ? (
        <div className="space-y-2 p-4">
          {[0, 1].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : timeline.isError ? (
        <div className="p-4">
          <ErrorState
            title="Couldn’t load the timeline"
            detail={describeFetchError(timeline.error, 'The rounds are safe — this is a display problem.')}
            onRetry={() => void timeline.refetch()}
          />
        </div>
      ) : rounds.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={<CalendarClock strokeWidth={1.75} />}
            title="One round, no timeline"
            description="Add rounds to run this test in stages — a résumé screen, then an interview, then a live call. Candidates already assigned can be moved into the first round you create."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rounds.map((round) => (
            <RoundRow
              key={round.id}
              round={round}
              busy={end.isPending || assign.isPending || adopt.isPending}
              onEnd={() => {
                /* Irreversible for the candidates in it, so it asks — and says what
                   actually happens rather than "are you sure?". */
                if (
                  !window.confirm(
                    `End "${round.title}" now?\n\nAnyone who has not finished loses access ` +
                      'immediately. Candidates who already completed it are unaffected.',
                  )
                ) return
                end.mutate(round.id)
              }}
              onAssign={() => assign.mutate(round.id)}
            />
          ))}
        </ul>
      )}

      {/* Named rather than hidden. These assignments predate the timeline, belong to no
          round, and are invisible to every round-scoped view — a recruiter cannot fix
          what nobody tells them about. Worse, assigning again creates a SECOND document
          per candidate, so the same test shows twice on their screen. */}
      {orphaned > 0 && rounds.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-warning/5 px-4 py-3">
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            {orphaned} candidate{orphaned === 1 ? '' : 's'} {orphaned === 1 ? 'was' : 'were'} assigned
            before this timeline existed, so {orphaned === 1 ? 'they belong' : 'they belong'} to no round.
            Move {orphaned === 1 ? 'them' : 'them'} into the first round — their existing answers and
            scores are kept.
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => adopt.mutate(rounds[0].id)}
            loading={adopt.isPending}
          >
            Move into “{rounds[0].title}”
          </Button>
        </div>
      ) : null}

      <AddRoundModal
        open={adding}
        onClose={() => setAdding(false)}
        testId={testId}
        onCreated={refresh}
      />
    </Card>
  )
}

function RoundRow({
  round,
  busy,
  onEnd,
  onAssign,
}: {
  round: InterviewRound
  busy: boolean
  onEnd: () => void
  onAssign: () => void
}) {
  const kind = KINDS.find((k) => k.id === round.kind)

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs tabular-nums text-neutral-400">{round.order + 1}</span>
          <span className="truncate text-sm font-semibold text-neutral-900">{round.title}</span>
          {/* Straight from the server — derived there from the clock, never stored. */}
          <span className={cn('rounded-md border px-2 py-0.5 text-[11px] font-semibold', STATE_STYLE[round.state])}>
            {round.state}
          </span>
          {round.endedManually ? (
            <span className="text-[11px] text-neutral-400">ended early</span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-xs text-neutral-500">
          {kind?.label ?? round.kind}
          {round.closesAt ? ` · closes ${new Date(round.closesAt).toLocaleDateString()}` : ''}
          {/* Worth saying: nobody scores a live round but the recruiter, because there
              is no recording for a model to read. */}
          {round.isRecruiterScored ? ' · you score this one' : ''}
        </p>
      </div>

      <div className="flex flex-shrink-0 gap-2">
        <Button size="sm" variant="secondary" onClick={onAssign} disabled={busy} icon={<UserPlus size={14} />}>
          Assign
        </Button>
        {round.state === 'closed' ? (
          <span className="inline-flex items-center gap-1.5 px-2 text-xs text-neutral-400">
            <CheckCircle2 size={14} aria-hidden="true" /> Closed
          </span>
        ) : (
          <Button size="sm" variant="secondary" onClick={onEnd} disabled={busy} icon={<Square size={14} />}>
            End now
          </Button>
        )}
      </div>
    </li>
  )
}

function AddRoundModal({
  open,
  onClose,
  testId,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  testId: string
  onCreated: () => void
}) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<RoundKind>('chat')
  const [closesAt, setClosesAt] = useState('')

  const create = useMutation({
    mutationFn: () =>
      roundsApi.create(testId, {
        title: title.trim(),
        kind,
        // Sent as an instant, not a date string: the server refuses anything it cannot
        // parse rather than dropping it, because a deadline that silently vanished
        // reads as a round that never closes.
        closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      }),
    onSuccess: () => {
      toast.success('Round added.')
      setTitle('')
      setClosesAt('')
      onCreated()
      onClose()
    },
    onError: (e) => toast.error(describeFetchError(e, 'Could not add the round.')),
  })

  return (
    <Modal open={open} onClose={onClose} title="Add a round">
      <div className="space-y-4">
        <label className="block">
          <span className="field-label mb-1.5 block">Name</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Technical screen"
            className="input-base"
            autoFocus
          />
        </label>

        <label className="block">
          <span className="field-label mb-1.5 block">What happens in it</span>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as RoundKind)}
            options={KINDS.map((k) => ({ value: k.id, label: k.label }))}
          />
          <p className="mt-1 text-xs text-neutral-500">
            {KINDS.find((k) => k.id === kind)?.hint}
          </p>
        </label>

        <label className="block">
          <span className="field-label mb-1.5 block">
            Closes <span className="font-normal normal-case tracking-normal text-neutral-400">(optional)</span>
          </span>
          <input
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
            className="input-base"
          />
          <p className="mt-1 text-xs text-neutral-500">
            {/* The deadline is what a candidate's device actually gates on, once it is
                copied down onto their assignment. */}
            Leave empty to keep it open until you end it yourself.
          </p>
        </label>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!title.trim() || create.isPending}
          >
            Add round
          </Button>
        </div>
      </div>
    </Modal>
  )
}

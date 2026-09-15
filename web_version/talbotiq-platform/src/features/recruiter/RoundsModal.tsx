import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Circle, Clock, Flag, Info,
  Plus, Square, Trophy, Undo2, UserPlus, Users,
} from 'lucide-react'
import { Button, Modal, Select, Skeleton, Toggle, cn } from '@/components/ui'
import { outcomesApi, roundsApi, describeFetchError } from '@/lib/api'
import type { InterviewRound, SessionListItem } from '@shared/types'
import { AddStageForm, TimelineNode } from './TimelinePanel'
import { KINDS, STATE_CHIP, STATE_WORD } from './roundKinds'

/**
 * One interview, start to finish: its stages, who is in each of them, and who moves on.
 *
 * ── Why "Timeline" and "Decide round" became one screen ─────────────────────
 * They were two buttons opening two modals, and they were two halves of one question.
 * The timeline said what stages an interview had; the decision ranked people with no
 * mention of WHICH stage they were being ranked in — the complaint that produced this
 * version was, exactly, "it's not clear which round we are talking about". A decision
 * is something you make about a stage, so it now lives INSIDE the stage, under the
 * list of the people in it.
 *
 * ── Candidates are grouped by `roundId`, not by title ───────────────────────
 * The sessions list stores one row per candidate PER ROUND. The server was already
 * sending `roundOrder` and `roundTitle` and nothing read them; `roundId` was added
 * beside them because two stages may share a title and identity is what grouping
 * needs.
 *
 * ── Scope is load-bearing ───────────────────────────────────────────────────
 * The decision used to receive the entire sessions list and rank all of it at once. On
 * a real account that meant a Software Engineer screen, a voice interview and a QA
 * smoke test ranked against each other — somebody stamped "3rd of 13" against twelve
 * people who never sat the same interview. `decideRound` writes `rank`/`rankOf` over
 * exactly the ids it is handed, so the scope is the client's to get right, and it is
 * now one stage of one interview.
 *
 * Interviews are grouped by batch (`testId`) where there is one; where there is not —
 * anything created before the shared assignment record existed — by TEMPLATE, because
 * "everyone who sat this interview" is the honest meaning of a round for those rows.
 * Pooling them into a single "no batch" group would have recreated the same bug.
 *
 * Three decisions carried over from the Flutter implementation, which is the more
 * developed one:
 *
 * **Ranked by score, best first.** Only SCORED candidates are ranked — an unscored one
 * has no rank — so the ranking is shorter than the stage's candidate count, and the
 * gap is reported rather than hidden. A round that looks complete when a third of it
 * was never scored is how someone gets rejected for a scoring failure.
 *
 * **Deciding and releasing are separate.** The publish toggle defaults ON because
 * that is the common case, but turning it off lets a recruiter settle a stage and
 * release it later.
 *
 * **The notes are written FOR the candidate.** They are the only free text a candidate
 * ever sees about their interview — the score, the AI's verdict and its list of their
 * weaknesses never leave the recruiter's side, enforced server-side by an allowlist.
 */

type Interview = {
  key: string
  name: string
  /** The batch behind it, when there is one. Only these have stages. */
  testId: string | null
  /** Every session in this interview, across all its stages. */
  rows: SessionListItem[]
  latest: string
}

/**
 * One person in a stage: who they are, and their session if they have started one.
 *
 * Two sources, because neither is complete on its own. The ROSTER (from the round's
 * assignments) is the authority on who is in a stage — somebody assigned to it has no
 * session row until they open their invite. The SESSION, where there is one, is the
 * only thing that carries a status and a score.
 */
type Roster = { email: string; name: string; session?: SessionListItem }

/** Everyone in one stage, split the ways the UI needs them. */
type Cohort = {
  all: Roster[]
  /** Completed and scored, best first — the only ones that can be ranked. */
  ranked: SessionListItem[]
  /** Completed but never scored. Named, never silently dropped. */
  unscored: SessionListItem[]
  /** Invited, not opened, or under way. */
  pending: number
}

function cohortOf(roster: Roster[]): Cohort {
  const done = roster
    .map((r) => r.session)
    .filter((s): s is SessionListItem => !!s && s.status === 'completed')
  return {
    all: roster,
    /* `overallScore` is absent rather than 0 for an interview that could not be scored
       — a 0 would rank the candidate last as though they had earned it. So absence is
       filtered out here, not sorted to the bottom. */
    ranked: done
      .filter((s) => typeof s.overallScore === 'number')
      .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0)),
    unscored: done.filter((s) => typeof s.overallScore !== 'number'),
    // Anyone with no finished session: never opened it, or still in it.
    pending: roster.length - done.length,
  }
}

/** A roster for an interview that has no stages — the sessions are all there is. */
function rosterFromSessions(rows: SessionListItem[]): Roster[] {
  return rows.map((s) => ({
    email: s.candidate.email,
    name: s.candidate.name || '',
    session: s,
  }))
}

/** The distinct interviews on this account, newest first. */
function buildInterviews(sessions: SessionListItem[]): Interview[] {
  const byKey = new Map<string, SessionListItem[]>()
  for (const s of sessions) {
    const key = s.testId ? `test:${s.testId}` : `tpl:${s.templateId}`
    const bucket = byKey.get(key)
    if (bucket) bucket.push(s)
    else byKey.set(key, [s])
  }
  return [...byKey.entries()]
    .map(([key, rows]) => ({
      key,
      name: rows[0].templateName || 'Untitled interview',
      testId: rows[0].testId ?? null,
      rows,
      latest: rows.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), ''),
    }))
    .sort((a, b) => (a.latest < b.latest ? 1 : -1))
}

const STATUS_WORD: Record<string, string> = {
  created: 'Not started',
  system_check: 'Not started',
  in_progress: 'Part way',
  completed: 'Done',
}

/* ── One candidate inside a stage ──────────────────────────────────────────── */
function CandidateRow({
  r, onMoveBack, busy,
}: {
  r: Roster
  /** Absent when there is nowhere to move back to. */
  onMoveBack?: () => void
  busy: boolean
}) {
  const s = r.session
  /* No session at all means they have not opened the invite. The server refuses to
     delete an assignment that HAS been started, because that document holds the
     transcript and the score computed from it — so the button says so here rather than
     letting the click fail. The two sides read different documents and can drift; the
     server is the authority and its refusal is reported. */
  const started = !!s && s.status !== 'created' && s.status !== 'system_check'

  return (
    <li className="flex items-center gap-2.5 border-b border-border px-3 py-1.5 last:border-0">
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.name || r.email}</span>
      <span className="flex-shrink-0 text-xs text-ink-muted">
        {s ? STATUS_WORD[s.status] ?? s.status : 'Not opened'}
      </span>
      <span className="w-8 flex-shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
        {typeof s?.overallScore === 'number' ? s.overallScore : '—'}
      </span>
      {onMoveBack ? (
        <button
          type="button"
          onClick={onMoveBack}
          disabled={busy || started}
          title={
            started
              ? 'They have already started this stage — removing it would destroy their answers'
              : 'Take them out of this stage'
          }
          aria-label={`Take ${r.email} out of this stage`}
          className="flex-shrink-0 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-danger-bg hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-faint"
        >
          <Undo2 size={14} />
        </button>
      ) : null}
    </li>
  )
}

/* ── Choosing who goes into a stage ───────────────────────────────────────────
   "Add candidates" used to take no argument, which the API reads as "everyone in the
   test" — so the only way to advance three people out of twelve was to advance all
   twelve and then take nine back out. The endpoint has always accepted a list; nothing
   ever sent one. */
function AddCandidatesPanel({
  eligible, busy, onAdd, onCancel,
}: {
  eligible: { email: string; name: string }[]
  busy: boolean
  onAdd: (emails: string[]) => void
  onCancel: () => void
}) {
  // Mounted with a `key` per stage by the caller, so this starts empty every time.
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const toggle = (email: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })

  if (eligible.length === 0) {
    return (
      <p className="mt-2 rounded-lg border border-dashed border-rule-strong px-3 py-2.5 text-xs text-ink-muted">
        Everyone in this interview is already in this stage.
      </p>
    )
  }

  return (
    <div className="mt-2 space-y-2.5 rounded-xl border border-border bg-surface-sunk/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-body">
          Tick who goes into this stage. {eligible.length} not in it yet.
        </p>
        <div className="flex gap-1.5">
          <Button
            size="xs"
            variant="secondary"
            onClick={() => setPicked(new Set(eligible.map((c) => c.email)))}
          >
            Everyone
          </Button>
          {picked.size > 0 ? (
            <Button size="xs" variant="secondary" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <ul className="max-h-[200px] overflow-y-auto rounded-lg border border-border bg-surface">
        {eligible.map((c) => {
          const on = picked.has(c.email)
          return (
            <li
              key={c.email}
              className={cn(
                'flex items-center gap-2.5 border-b border-border px-3 py-1.5 last:border-0',
                on && 'bg-ok-bg',
              )}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(c.email)}
                aria-label={`Add ${c.email} to this stage`}
                className="h-4 w-4 flex-shrink-0 accent-primary"
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {c.name || c.email}
              </span>
              {c.name ? (
                <span className="flex-shrink-0 truncate text-xs text-ink-muted">{c.email}</span>
              ) : null}
            </li>
          )
        })}
      </ul>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button
          size="sm"
          icon={<UserPlus size={14} />}
          loading={busy}
          disabled={picked.size === 0 || busy}
          onClick={() => onAdd([...picked])}
        >
          Add {picked.size || ''} to this stage
        </Button>
      </div>
    </div>
  )
}

/* ── The decision, for one stage or for the whole test ─────────────────────── */
function DecidePanel({
  cohort, submitLabel, busy, onSubmit,
}: {
  cohort: Cohort
  submitLabel: (publish: boolean, n: number) => string
  busy: boolean
  onSubmit: (payload: {
    selectedIds: string[]
    noteForSelected?: string
    noteForRejected?: string
    publish: boolean
    sendEmails: boolean
  }) => void
}) {
  const { ranked, unscored, pending } = cohort
  /* Mounted with a `key` per stage by the caller, so switching stages remounts this
     fresh. Ticks belong to the stage they were made in — carried across, "3 moving
     forward" would be counting people who are not in the list on screen. */
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

  return (
    <div className="mt-3 space-y-4 rounded-xl border border-border bg-surface-sunk/50 p-3.5">
      {pending > 0 ? (
        <p className="flex items-start gap-1.5 text-xs text-ink-muted">
          <Info size={13} className="mt-px flex-shrink-0" aria-hidden="true" />
          {pending} {pending === 1 ? 'person has' : 'people have'} not finished. Deciding
          now leaves them out.
        </p>
      ) : null}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-body">Best first. Tick everyone moving forward.</p>
          <div className="flex gap-1.5">
            {[3, 5, 10]
              .filter((n) => n < ranked.length)
              .map((n) => (
                <Button
                  key={n}
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelected(new Set(ranked.slice(0, n).map((s) => s.id)))}
                >
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

        {/* Scrolls inside its own container so a round of two hundred does not push
            the decision controls off the page. */}
        <ul className="mt-2.5 max-h-[220px] overflow-y-auto rounded-lg border border-border bg-surface">
          {ranked.map((s, index) => {
            const isSelected = selected.has(s.id)
            return (
              <li
                key={s.id}
                className={cn(
                  'flex items-center gap-3 border-b border-border px-3 py-2 last:border-0',
                  isSelected && 'bg-ok-bg',
                )}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(s.id)}
                  aria-label={`Move ${s.candidate.email} forward`}
                  className="h-4 w-4 flex-shrink-0 accent-primary"
                />
                {/* The rank the candidate will be STAMPED with — position in this list,
                    not something recomputed later. Shown so the recruiter sees exactly
                    what is about to be recorded. */}
                <span className="w-7 flex-shrink-0 text-right text-xs tabular-nums text-ink-faint">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {s.candidate.name || s.candidate.email}
                </span>
                <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-ink">
                  {s.overallScore}
                </span>
              </li>
            )
          })}
        </ul>

        {unscored.length > 0 ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
            <Info size={13} className="mt-px flex-shrink-0" aria-hidden="true" />
            {/* Named rather than hidden: these people sat it and are about to be left
                out of the decision entirely. */}
            {unscored.length} finished but could not be scored, so{' '}
            {unscored.length === 1 ? 'it is' : 'they are'} not in this decision.
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <CheckCircle2 size={14} className="text-ok" aria-hidden="true" />
            Note for the {selected.size} moving on
          </span>
          <textarea
            value={noteForSelected}
            onChange={(e) => setNoteForSelected(e.target.value)}
            rows={3}
            placeholder="We'd like to take you to the next round…"
            className="input-base mt-1.5 w-full resize-y py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
            <Info size={14} className="text-ink-faint" aria-hidden="true" />
            Note for the other {ranked.length - selected.size}
          </span>
          <textarea
            value={noteForRejected}
            onChange={(e) => setNoteForRejected(e.target.value)}
            rows={3}
            placeholder="Thank you for the time you gave this…"
            className="input-base mt-1.5 w-full resize-y py-2 text-sm"
          />
        </label>
      </div>

      {/* The candidate sees the outcome, their rank and these notes. Nothing else — not
          the score in the list above, not the AI's summary or its list of their
          weaknesses. That is enforced on the server by an allowlist, so this note is a
          reminder of the rule rather than the rule itself. */}
      <p className="rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-ink-muted">
        Each candidate is shown the outcome, their place out of {ranked.length}, and the
        note you write here. Never the score, never the AI's assessment.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3.5">
        <div className="space-y-2">
          <Toggle
            checked={publish}
            onChange={setPublish}
            label="Tell the candidates now"
            // Off means decided but not released — settle it, release it when ready.
            description={publish ? undefined : 'Recorded but not shown to anyone yet.'}
          />
          <Toggle
            checked={sendEmails}
            onChange={setSendEmails}
            label="Email them as well"
            description={
              sendEmails ? 'An email cannot be unsent.' : 'They will see it next time they sign in.'
            }
          />
        </div>
        <Button
          onClick={() =>
            onSubmit({
              selectedIds: [...selected],
              noteForSelected: noteForSelected.trim() || undefined,
              noteForRejected: noteForRejected.trim() || undefined,
              publish,
              sendEmails,
            })
          }
          loading={busy}
          disabled={busy}
          icon={<Trophy size={15} />}
        >
          {submitLabel(publish, ranked.length)}
        </Button>
      </div>
    </div>
  )
}

export function RoundsModal({
  open, onClose, sessions,
}: {
  open: boolean
  onClose: () => void
  sessions: SessionListItem[]
}) {
  const qc = useQueryClient()

  const interviews = useMemo(() => buildInterviews(sessions), [sessions])
  const [key, setKey] = useState<string | null>(null)
  /* Opens on the newest interview that has something to decide, rather than simply the
     newest — landing on one with nothing in it reads as "this feature is broken" when
     the answer is one line down the picker. */
  const fallback =
    interviews.find((i) => cohortOf(rosterFromSessions(i.rows)).ranked.length > 0)
    ?? interviews[0]
    ?? null
  const active = interviews.find((i) => i.key === key) ?? fallback
  const testId = active?.testId ?? null

  /** Which stage's candidate list and which stage's decision are unrolled. */
  const [openList, setOpenList] = useState<string | null>(null)
  const [openDecide, setOpenDecide] = useState<string | null>(null)
  /** Which stage's "who goes in" picker is unrolled. */
  const [openAdd, setOpenAdd] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    setOpenList(null)
    setOpenDecide(null)
    setOpenAdd(null)
    setAdding(false)
  }, [active?.key, open])

  const timeline = useQuery({
    queryKey: ['rounds', testId],
    queryFn: () => roundsApi.list(testId as string),
    enabled: open && !!testId,
  })

  const refreshRounds = () => void qc.invalidateQueries({ queryKey: ['rounds', testId] })
  const refreshSessions = () => void qc.invalidateQueries({ queryKey: ['sessions'] })

  const end = useMutation({
    mutationFn: (roundId: string) => roundsApi.end(testId as string, roundId),
    onSuccess: (r) => {
      /* `lockedOut` is the number that matters: stamping the round alone closes
         nothing, so reporting "ended" without it would hide a no-op. */
      toast.success(
        r.lockedOut === 0
          ? 'Stage ended. Nobody had it open.'
          : `Stage ended — ${r.lockedOut} candidate${r.lockedOut === 1 ? '' : 's'} locked out.`,
      )
      refreshRounds(); refreshSessions()
    },
    onError: (e) => toast.error(describeFetchError(e, 'Could not end the stage.')),
  })

  const assign = useMutation({
    mutationFn: (v: { roundId: string; candidates: string[] }) =>
      roundsApi.assign(testId as string, v.roundId, v.candidates),
    onSuccess: (r) => {
      toast.success(
        r.skipped > 0
          ? `${r.assigned} added, ${r.skipped} already in this stage.`
          : `${r.assigned} candidate${r.assigned === 1 ? '' : 's'} added.`,
      )
      setOpenAdd(null)
      refreshRounds(); refreshSessions()
    },
    onError: (e) => toast.error(describeFetchError(e, 'Could not add the candidates.')),
  })

  const adopt = useMutation({
    mutationFn: (roundId: string) => roundsApi.adopt(testId as string, roundId),
    onSuccess: (r) => { toast.success(`${r.adopted} earlier assignment(s) moved in.`); refreshRounds(); refreshSessions() },
    onError: (e) => toast.error(describeFetchError(e, 'Could not move those.')),
  })

  const moveBack = useMutation({
    mutationFn: (v: { roundId: string; email: string }) =>
      roundsApi.unassign(testId as string, v.roundId, [v.email]),
    onSuccess: (r) => {
      /* `kept` is the honest half of the answer: the server refuses anyone who has
         already started, and saying only "removed 0" would look like a bug. */
      if (r.removed > 0) toast.success('Taken out of this stage.')
      if (r.kept.length) toast.error(`${r.kept[0].email} ${r.kept[0].reason} — left where they are.`)
      refreshRounds(); refreshSessions()
    },
    onError: (e) => toast.error(describeFetchError(e, 'Could not take them out.')),
  })

  const decide = useMutation({
    mutationFn: (v: {
      ranked: string[]
      selectedIds: string[]
      noteForSelected?: string
      noteForRejected?: string
      publish: boolean
      sendEmails: boolean
      roundName: string
      thenCloseTest?: boolean
    }) =>
      outcomesApi
        .decideRound({
          ranked: v.ranked,
          selectedIds: v.selectedIds,
          noteForSelected: v.noteForSelected,
          noteForRejected: v.noteForRejected,
          publish: v.publish,
          sendEmails: v.sendEmails,
          // Named in the candidate's email, so "you were not selected" says what for.
          roundName: v.roundName,
        })
        /* Decide FIRST, close second. The decision is the durable, meaningful write;
           a failure to close afterwards leaves it standing and retryable, whereas the
           other order could close a test whose result never landed. */
        .then(async (result) => {
          if (v.thenCloseTest && testId) await roundsApi.closeTest(testId)
          return result
        }),
    onSuccess: (result) => {
      toast.success(
        result.decided === 0
          ? 'Nothing to decide.'
          : `${result.decided} candidate${result.decided === 1 ? '' : 's'} decided.`,
      )
      /* A separate message: the DECISION landed for everyone regardless, and a bounced
         address is a different problem from a failed decision. */
      if (result.emailFailures?.length) {
        toast.error(`${result.emailFailures.length} email(s) could not be sent. The decisions are saved.`)
      }
      refreshRounds(); refreshSessions()
      setOpenDecide(null)
    },
    onError: (e) => toast.error(describeFetchError(e, 'Could not record the decision. Nothing was changed.')),
  })

  /* Two interviews can carry the same name — "mcq round" twice in the list is real —
     and two identical lines in the picker is a choice nobody can make. Only the
     duplicates get a date appended, so the common case stays clean. */
  const labelFor = (i: Interview) => {
    const clash = interviews.filter((x) => x.name === i.name).length > 1
    if (!clash || !i.latest) return i.name
    const on = new Date(i.latest)
    return Number.isNaN(on.getTime()) ? i.name : `${i.name} · ${on.toLocaleDateString()}`
  }

  const rounds: InterviewRound[] = timeline.data?.rounds ?? []
  const orphaned = timeline.data?.legacyAssignments ?? 0

  /* Whether this server reports rosters at all.
     `rosters` shipped with `unassign`, `closeTest` and `roundId` on the sessions list,
     so its absence means an older backend and all four are missing together. Without
     this check the UI cannot tell "nobody is in this stage" from "this server cannot
     say", and it rendered the first — a confident "0 candidates" on a stage the server
     had just refused to re-assign because two people were already in it. Saying
     nothing would have been better than saying zero; saying which is better still. */
  const hasRosters = !!timeline.data && timeline.data.rosters !== undefined
  const busy = end.isPending || assign.isPending || adopt.isPending || moveBack.isPending

  /** Candidates of one stage, by `roundId`. Identity, not title — titles can collide. */
  const rowsOfRound = (roundId: string) =>
    (active?.rows ?? []).filter((s) => s.roundId === roundId)

  /* The stage's ROSTER — everyone assigned to it, whether or not they have started.
     The session rows alone are not enough: a person assigned to a stage has no session
     row until they open it, so building the list from sessions hid exactly the people
     a recruiter still has the option to take back out. The roster says who is there;
     the session row, when one exists, says how they did. */
  const rosterOf = (roundId: string): Roster[] => {
    const entries = timeline.data?.rosters?.[roundId] ?? []
    const byEmail = new Map(
      rowsOfRound(roundId).map((s) => [s.candidate.email?.trim().toLowerCase() ?? '', s]),
    )
    if (entries.length === 0) {
      // No roster (an older server, or a failed read) — fall back to what the sessions
      // list knows rather than showing an empty stage.
      return rowsOfRound(roundId).map((s) => ({
        email: s.candidate.email,
        name: s.candidate.name || '',
        session: s,
      }))
    }
    return entries.map((e) => ({
      email: e.email,
      name: e.name || byEmail.get(e.email)?.candidate.name || '',
      session: byEmail.get(e.email),
    }))
  }

  /* Everyone in this interview, deduplicated by address: the sessions list holds one
     row per candidate PER STAGE, so somebody in three stages is three rows and would
     otherwise appear in the picker three times. */
  const everyone = useMemo(() => {
    const byEmail = new Map<string, { email: string; name: string }>()
    const add = (rawEmail: string | undefined, name: string) => {
      const email = rawEmail?.trim().toLowerCase()
      if (!email) return
      const seen = byEmail.get(email)
      // Keep the first NAME found — some rows carry one and some do not.
      if (!seen) byEmail.set(email, { email, name: name || '' })
      else if (!seen.name && name) seen.name = name
    }
    // Rosters first: they include people who have not opened their invite and so have
    // no session row at all.
    for (const rows of Object.values(timeline.data?.rosters ?? {})) {
      for (const e of rows) add(e.email, e.name)
    }
    for (const s of active?.rows ?? []) add(s.candidate.email, s.candidate.name)
    return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email))
  }, [active?.rows, timeline.data?.rosters])

  /** Those not already in the stage — the only ones worth offering. */
  const eligibleFor = (roundId: string) => {
    const already = new Set(rosterOf(roundId).map((r) => r.email.trim().toLowerCase()))
    return everyone.filter((c) => !already.has(c.email))
  }

  /* Closing the whole test is only on offer once nothing is still running — a test
     with an open stage is not finished, and the button would be lying. */
  const allClosed = rounds.length > 0 && rounds.every((r) => r.state === 'closed')
  const lastRound = rounds.length ? rounds[rounds.length - 1] : null
  const finalCohort = cohortOf(
    lastRound ? rosterOf(lastRound.id) : rosterFromSessions(active?.rows ?? []),
  )

  const submit = (
    cohort: Cohort,
    roundName: string,
    thenCloseTest: boolean,
  ) => (p: {
    selectedIds: string[]
    noteForSelected?: string
    noteForRejected?: string
    publish: boolean
    sendEmails: boolean
  }) =>
    decide.mutate({
      // Scoped to the stage on screen. `rankOf` is the length of this array on the
      // server, so scoping the ids is what makes "3rd of 13" mean 3rd of THIS stage's
      // thirteen.
      ranked: cohort.ranked.map((s) => s.id),
      ...p,
      roundName,
      thenCloseTest,
    })

  return (
    <Modal open={open} onClose={onClose} title="Rounds" width="max-w-2xl">
      {!active ? (
        <p className="text-sm text-ink-muted">
          Nothing here yet — invite somebody to an interview and it will show up.
        </p>
      ) : (
        <div className="space-y-5">
          {interviews.length > 1 ? (
            <Select
              label="Which interview?"
              hint="Each one runs and is decided on its own. Nobody is ever ranked against someone who sat a different interview."
              value={active.key}
              onChange={(e) => setKey(e.target.value)}
              options={interviews.map((i) => {
                const c = cohortOf(rosterFromSessions(i.rows))
                return {
                  value: i.key,
                  label: `${labelFor(i)} — ${i.rows.length} candidate${i.rows.length === 1 ? '' : 's'}, ${c.ranked.length} scored`,
                }
              })}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              <strong className="font-semibold text-ink">{labelFor(active)}</strong>
            </p>
          )}

          {testId && timeline.data && !hasRosters ? (
            <p className="flex items-start gap-2 rounded-lg border border-warn-rule bg-warn-bg px-3 py-2.5 text-xs leading-relaxed text-warn">
              <AlertTriangle size={14} className="mt-px flex-shrink-0" aria-hidden="true" />
              <span>
                This server does not report who is in each stage yet, so the counts below
                only include people who have finished an interview — anyone invited and
                not yet started is missing. Moving candidates between stages and closing
                the test need the same update.
              </span>
            </p>
          ) : null}

          <ol className="pt-1">
            {!testId ? (
              /* No batch behind it, so there is nothing to sequence. Said plainly
                 rather than left as an empty timeline, which reads as a failure. */
              <SingleStageNode
                cohort={cohortOf(rosterFromSessions(active.rows))}
                name={active.name}
                openList={openList === 'single'}
                onToggleList={() => setOpenList((v) => (v === 'single' ? null : 'single'))}
                openDecide={openDecide === 'single'}
                onToggleDecide={() => setOpenDecide((v) => (v === 'single' ? null : 'single'))}
                onSubmit={submit(cohortOf(rosterFromSessions(active.rows)), active.name, false)}
                busy={decide.isPending}
              />
            ) : timeline.isLoading ? (
              [0, 1].map((i) => (
                <li key={i} className="flex gap-3.5 pb-5">
                  <Skeleton className="h-7 w-7 flex-shrink-0 rounded-full" />
                  <Skeleton className="h-12 flex-1" />
                </li>
              ))
            ) : timeline.isError ? (
              <TimelineNode
                tone="muted"
                icon={<AlertTriangle size={14} />}
                title="Couldn't load the stages"
                meta={describeFetchError(timeline.error, 'The stages are safe — this is a display problem.')}
                actions={
                  <Button size="sm" variant="secondary" onClick={() => void timeline.refetch()}>
                    Try again
                  </Button>
                }
              />
            ) : rounds.length === 0 ? (
              <SingleStageNode
                cohort={cohortOf(rosterFromSessions(active.rows))}
                name={active.name}
                openList={openList === 'single'}
                onToggleList={() => setOpenList((v) => (v === 'single' ? null : 'single'))}
                openDecide={openDecide === 'single'}
                onToggleDecide={() => setOpenDecide((v) => (v === 'single' ? null : 'single'))}
                onSubmit={submit(cohortOf(rosterFromSessions(active.rows)), active.name, false)}
                busy={decide.isPending}
              />
            ) : (
              rounds.map((round, index) => {
                const cohort = cohortOf(rosterOf(round.id))
                const kind = KINDS.find((k) => k.id === round.kind)
                const listOpen = openList === round.id
                const decideOpen = openDecide === round.id
                return (
                  <TimelineNode
                    key={round.id}
                    tone={round.state === 'closed' ? 'done' : round.state === 'open' ? 'live' : 'waiting'}
                    icon={
                      round.state === 'closed' ? <CheckCircle2 size={14} />
                        : round.state === 'open' ? <Circle size={11} className="fill-current" />
                        : <Clock size={13} />
                    }
                    title={<><span className="mr-1.5 text-xs tabular-nums text-ink-faint">{round.order + 1}</span>{round.title}</>}
                    chip={
                      /* Straight from the server — derived there from the clock, never
                         stored. */
                      <span className={cn('rounded-md border px-2 py-0.5 text-[11px] font-semibold', STATE_CHIP[round.state])}>
                        {STATE_WORD[round.state]}
                      </span>
                    }
                    meta={
                      <>
                        {kind?.label ?? round.kind}
                        {round.closesAt ? ` · closes ${new Date(round.closesAt).toLocaleDateString()}` : ''}
                        {/* Worth saying: nobody scores a live round but the recruiter,
                            because there is no recording for a model to read. */}
                        {round.isRecruiterScored ? ' · you score this one' : ''}
                        {round.endedManually ? ' · ended early' : ''}
                      </>
                    }
                    actions={
                      <>
                        <Button
                          size="sm"
                          variant={openAdd === round.id ? 'primary' : 'secondary'}
                          onClick={() => setOpenAdd((v) => (v === round.id ? null : round.id))}
                          aria-expanded={openAdd === round.id}
                          disabled={busy}
                          icon={<UserPlus size={14} />}
                        >
                          Add candidates
                        </Button>
                        {round.state !== 'closed' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            icon={<Square size={14} />}
                            onClick={() => {
                              /* Irreversible for the candidates in it, so it asks — and
                                 says what actually happens rather than "are you sure?". */
                              if (!window.confirm(
                                `End "${round.title}" now?\n\nAnyone who has not finished loses access ` +
                                  'immediately. Candidates who already completed it are unaffected.',
                              )) return
                              end.mutate(round.id)
                            }}
                          >
                            End now
                          </Button>
                        ) : null}
                      </>
                    }
                  >
                    {/* ── who is in this stage ───────────────────────────────── */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenList((v) => (v === round.id ? null : round.id))}
                        aria-expanded={listOpen}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-ink hover:underline"
                      >
                        {listOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        <Users size={12} />
                        {cohort.all.length} candidate{cohort.all.length === 1 ? '' : 's'}
                      </button>
                      <span className="text-xs text-ink-muted">
                        {cohort.ranked.length} scored
                        {cohort.unscored.length ? ` · ${cohort.unscored.length} not scored` : ''}
                        {cohort.pending ? ` · ${cohort.pending} still going` : ''}
                      </span>
                      {cohort.ranked.length > 0 ? (
                        <Button
                          size="xs"
                          variant={decideOpen ? 'secondary' : 'primary'}
                          icon={<Trophy size={12} />}
                          onClick={() => setOpenDecide((v) => (v === round.id ? null : round.id))}
                        >
                          {decideOpen ? 'Hide' : `Decide "${round.title}"`}
                        </Button>
                      ) : null}
                    </div>

                    {openAdd === round.id ? (
                      <AddCandidatesPanel
                        // Remounts per stage, so a selection never leaks across stages.
                        key={round.id}
                        eligible={eligibleFor(round.id)}
                        busy={assign.isPending}
                        onCancel={() => setOpenAdd(null)}
                        onAdd={(candidates) => assign.mutate({ roundId: round.id, candidates })}
                      />
                    ) : null}

                    {listOpen ? (
                      cohort.all.length === 0 ? (
                        <p className="mt-2 rounded-lg border border-dashed border-rule-strong px-3 py-2.5 text-xs text-ink-muted">
                          Nobody is in this stage yet. "Add candidates" lets you pick who goes in.
                        </p>
                      ) : (
                        <ul className="mt-2 max-h-[200px] overflow-y-auto rounded-lg border border-border bg-surface">
                          {cohort.all.map((r) => (
                            <CandidateRow
                              key={r.email}
                              r={r}
                              busy={busy}
                              /* Nowhere to go back TO from the first stage: taking
                                 somebody out of it removes them from the interview
                                 altogether, which is a different action from undoing an
                                 advance and is not what this button claims to do. */
                              onMoveBack={
                                index === 0 || !hasRosters
                                  ? undefined
                                  : () => {
                                      /* Asks, like "End now" does. Undoing is cheap —
                                         they keep their place in the earlier stage and
                                         "Add candidates" puts them back — but a misclick
                                         that silently removes somebody is not. */
                                      if (!window.confirm(
                                        `Take ${r.email} out of "${round.title}"?\n\n` +
                                          'They keep their place in the earlier stages and everything ' +
                                          'they did there. You can add them back at any time.',
                                      )) return
                                      moveBack.mutate({ roundId: round.id, email: r.email })
                                    }
                              }
                            />
                          ))}
                        </ul>
                      )
                    ) : null}

                    {decideOpen && cohort.ranked.length > 0 ? (
                      <DecidePanel
                        // Remounts per stage, so a selection never leaks across stages.
                        key={round.id}
                        cohort={cohort}
                        busy={decide.isPending}
                        onSubmit={submit(cohort, round.title, false)}
                        submitLabel={(publish, n) =>
                          publish ? `Decide and tell ${n}` : `Record ${n} decision${n === 1 ? '' : 's'}`
                        }
                      />
                    ) : null}
                  </TimelineNode>
                )
              })
            )}

            {/* Named rather than hidden. These assignments predate the timeline, belong
                to no stage, and are invisible to every stage-scoped view — a recruiter
                cannot fix what nobody tells them about. Worse, assigning again creates a
                SECOND document per candidate, so the same test shows twice for them. */}
            {orphaned > 0 && rounds.length > 0 ? (
              <TimelineNode
                tone="muted"
                icon={<AlertTriangle size={14} className="text-warn" />}
                title={<span className="text-warn">{orphaned} candidate{orphaned === 1 ? '' : 's'} in no stage</span>}
                meta={`They were invited before this timeline existed. Move them into "${rounds[0].title}" — their answers and scores are kept.`}
                actions={
                  <Button size="sm" variant="secondary" onClick={() => adopt.mutate(rounds[0].id)} loading={adopt.isPending}>
                    Move them in
                  </Button>
                }
              />
            ) : null}

            {testId ? (
              <TimelineNode
                tone="muted"
                icon={<Plus size={14} />}
                title={
                  <button
                    type="button"
                    onClick={() => setAdding((a) => !a)}
                    aria-expanded={adding}
                    className="text-sm font-semibold text-ink hover:underline"
                  >
                    Add a stage
                  </button>
                }
                meta={adding ? undefined : 'A CV screen, a second interview, a final call — whatever comes next.'}
              >
                {adding ? (
                  <AddStageForm
                    testId={testId}
                    onCancel={() => setAdding(false)}
                    onCreated={() => { setAdding(false); refreshRounds() }}
                  />
                ) : null}
              </TimelineNode>
            ) : null}

            {/* ── the end of the whole thing ──────────────────────────────────
                Only once every stage has finished. A test with a stage still
                running is not over, and offering to close it would be a lie. */}
            {testId && rounds.length > 0 ? (
              <TimelineNode
                tone={allClosed ? 'action' : 'muted'}
                icon={<Flag size={14} />}
                title="Close the test and declare the result"
                meta={
                  !allClosed
                    ? 'Available once every stage above has finished.'
                    : !hasRosters
                      ? 'Needs the server update described above.'
                    : finalCohort.ranked.length === 0
                      ? `Nothing to rank in "${lastRound?.title}" — no completed interview there has a score.`
                      : `Final say, on "${lastRound?.title}" — the last stage. ${finalCohort.ranked.length} scored.`
                }
                actions={
                  allClosed && hasRosters && finalCohort.ranked.length > 0 ? (
                    <Button
                      size="sm"
                      variant={openDecide === 'final' ? 'secondary' : 'primary'}
                      icon={<Flag size={14} />}
                      onClick={() => setOpenDecide((v) => (v === 'final' ? null : 'final'))}
                    >
                      {openDecide === 'final' ? 'Hide' : 'Declare'}
                    </Button>
                  ) : undefined
                }
              >
                {openDecide === 'final' && allClosed && hasRosters && finalCohort.ranked.length > 0 ? (
                  <DecidePanel
                    key="final"
                    cohort={finalCohort}
                    busy={decide.isPending}
                    onSubmit={submit(finalCohort, active.name, true)}
                    submitLabel={(_publish, n) => `Close the test and declare ${n}`}
                  />
                ) : null}
              </TimelineNode>
            ) : null}
          </ol>
        </div>
      )}
    </Modal>
  )
}

/* ── An interview with no stages: everyone sat the same thing ──────────────── */
function SingleStageNode({
  cohort, name, openList, onToggleList, openDecide, onToggleDecide, onSubmit, busy,
}: {
  cohort: Cohort
  name: string
  openList: boolean
  onToggleList: () => void
  openDecide: boolean
  onToggleDecide: () => void
  onSubmit: Parameters<typeof DecidePanel>[0]['onSubmit']
  busy: boolean
}) {
  return (
    <TimelineNode
      tone="done"
      icon={<Users size={14} />}
      title="Everyone sat the same thing"
      meta="This interview has no stages, so it runs as a single round."
    >
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleList}
          aria-expanded={openList}
          className="inline-flex items-center gap-1 text-xs font-semibold text-ink hover:underline"
        >
          {openList ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Users size={12} />
          {cohort.all.length} candidate{cohort.all.length === 1 ? '' : 's'}
        </button>
        <span className="text-xs text-ink-muted">
          {cohort.ranked.length} scored
          {cohort.unscored.length ? ` · ${cohort.unscored.length} not scored` : ''}
          {cohort.pending ? ` · ${cohort.pending} still going` : ''}
        </span>
        {cohort.ranked.length > 0 ? (
          <Button
            size="xs"
            variant={openDecide ? 'secondary' : 'primary'}
            icon={<Trophy size={12} />}
            onClick={onToggleDecide}
          >
            {openDecide ? 'Hide' : `Decide "${name}"`}
          </Button>
        ) : null}
      </div>

      {openList ? (
        <ul className="mt-2 max-h-[200px] overflow-y-auto rounded-lg border border-border bg-surface">
          {cohort.all.map((r) => (
            // No stages, so there is nothing to move anybody back to.
            <CandidateRow key={r.email} r={r} busy={busy} />
          ))}
        </ul>
      ) : null}

      {openDecide && cohort.ranked.length > 0 ? (
        <DecidePanel
          cohort={cohort}
          busy={busy}
          onSubmit={onSubmit}
          submitLabel={(publish, n) =>
            publish ? `Decide and tell ${n}` : `Record ${n} decision${n === 1 ? '' : 's'}`
          }
        />
      ) : null}
    </TimelineNode>
  )
}

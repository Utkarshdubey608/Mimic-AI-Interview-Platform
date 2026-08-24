import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Info, LogOut, Inbox } from 'lucide-react'
import {
  Button, Skeleton, ExhibitTab, Card, EmptyState, ErrorState, Page,
} from '@/components/ui'
import { AmbientField } from '@/components/shell/AmbientField'
import { MimicLockup } from '@/components/brand/MimicMark'
import { sessionsApi } from '@/lib/api'
import { useAuth } from '@/features/auth/AuthProvider'
import { AppearanceButton } from '@/features/theme/AppearanceButton'
import { ThemeToggle } from '@/features/theme/ThemeToggle'
import { useDocumentGround, useWorkspaceGround } from '@/lib/workspaceGround'
import type { CandidateAssignedSession, CandidateOutcome } from '@shared/types'

/**
 * The candidate's home: everything they have been invited to.
 *
 * Deliberately a short, quiet page. A candidate is here for a few seconds
 * before an interview and possibly never again, so it does exactly two things —
 * shows what is waiting for them, and gets them into it.
 *
 * The exhibit tab on each row is the same format coding the recruiter sees in
 * their sessions index, which is the one visual element shared by both halves
 * of the product.
 */
export default function CandidateHome() {
  const { user, signOutUser } = useAuth()
  const ground = useWorkspaceGround()
  useDocumentGround(ground)
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-sessions'],
    queryFn: sessionsApi.mine,
  })

  const pending = data?.filter((s) => s.status !== 'completed' && s.status !== 'expired') ?? []

  return (
    // FOLLOWS THE READER. This was pinned to the room on the argument that a
    // candidate's whole path should read as one dark product. The path is still
    // continuous — it is continuous with whatever they chose, which is the only
    // version of that argument that survives appearance being a preference. The
    // interview stages keep choosing their own ground per surface and still do:
    // a room is a room whatever the lobby looks like.
    <div data-ground={ground} className="relative min-h-screen bg-ground">
      <AmbientField variant={ground === 'room' ? 'room' : 'record'} />

      <header className="relative z-sticky border-b border-rule bg-surface/80 backdrop-blur-sm">
        <div className="mx-auto flex h-[60px] max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
          <MimicLockup />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">{user?.email}</span>
            {/* Compact: this header is 60px and already carries an address and a
                button, so the words go and the icons carry it. The accessible
                name keeps "Light" and "Dark". */}
            <ThemeToggle compact />
            {/* The palette, which a candidate had no way to reach at all — there
                is no candidate settings page, and on an invite link there is no
                account to hang one off. The one-tap light/dark switch stays beside
                it: that is the choice people actually make in a hurry, and burying
                it behind a second click to save 28px would be the wrong trade. */}
            <AppearanceButton />
            <Button variant="secondary" size="sm" onClick={() => void signOutUser()} icon={<LogOut size={14} />}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-raised">
        <Page width="reading">
          <h1 className="font-display text-[23px] font-bold tracking-[-0.02em] text-ink">Your interviews</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            {/* States the count rather than only listing rows: a candidate wants
                to know how many things are outstanding before they read any. */}
            {isLoading
              ? `Invitations for ${user?.email}.`
              : pending.length === 0
                ? `No interviews are waiting for ${user?.email}.`
                : `${pending.length} interview${pending.length === 1 ? '' : 's'} waiting for ${user?.email}.`}
          </p>

          <div className="mt-6">
            {isLoading ? (
              <ul className="space-y-3" aria-label="Loading your interviews" role="status">
                {[0, 1, 2].map((i) => (
                  <li key={i} className="flex items-center justify-between gap-4 rounded-lg border border-rule bg-surface p-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-48 max-w-full" />
                      <Skeleton className="h-3 w-32 max-w-full" />
                    </div>
                    <Skeleton className="h-9 w-36 flex-shrink-0" />
                  </li>
                ))}
              </ul>
            ) : isError ? (
              <Card>
                <ErrorState
                  title="Couldn’t load your interviews"
                  detail={
                    (error as Error)?.message ??
                    'Something went wrong while fetching your assigned interviews. Your invitations are safe, this is a display problem.'
                  }
                  onRetry={() => void refetch()}
                />
              </Card>
            ) : data && data.length > 0 ? (
              <ul className="space-y-3">
                {data.map((s) => <SessionRow key={s.id} s={s} />)}
              </ul>
            ) : (
              <Card>
                <EmptyState
                  icon={<Inbox strokeWidth={1.75} />}
                  title="No interviews assigned"
                  description="If you were expecting one, check that you are signed in with the email address your invite was sent to, or reply to the invite email and the hiring team can resend it."
                />
              </Card>
            )}
          </div>
        </Page>
      </main>
    </div>
  )
}

/**
 * The outcome copy, written for the candidate rather than the recruiter.
 *
 * No hiring vocabulary — "Moving forward", not "Strong Hire". The words are lifted
 * from `RoundOutcomeX.candidateLabel` in the Flutter app so the same decision reads
 * identically wherever the candidate happens to open it.
 */
const OUTCOME_COPY: Record<CandidateOutcome['outcome'], { label: string; blurb: string }> = {
  selected:     { label: 'Moving forward',     blurb: 'The hiring team will be in touch about the next step.' },
  not_selected: { label: 'Not moving forward', blurb: 'Thank you for the time you gave this.' },
  pending:      { label: 'Under review',       blurb: 'Your interview is with the hiring team. You will hear from them.' },
}

/**
 * What the candidate is told, and nothing else.
 *
 * Three fields, and the server will not send a fourth — see `CandidateOutcome`. There
 * is deliberately no score anywhere on this component, and no place to put one.
 */
function OutcomePanel({ outcome }: { outcome: CandidateOutcome }) {
  const copy = OUTCOME_COPY[outcome.outcome] ?? OUTCOME_COPY.pending

  /* `not_selected` is NOT an error state, and this is the one styling decision here
     that carries meaning. Red reads as "something went wrong" — a fault, possibly
     theirs. It is a decision, so it gets the same neutral treatment as any other
     piece of information. Mobile makes the same choice for the same reason
     (onSurfaceVariant, not error). */
  const tone =
    outcome.outcome === 'selected'
      ? 'border-ok-rule bg-ok-bg text-ok'
      : 'border-rule bg-ground text-ink-muted'

  return (
    <div className="mt-3 rounded-md border border-rule bg-ground/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold ${tone}`}>
          {outcome.outcome === 'selected' ? <CheckCircle2 size={14} aria-hidden="true" /> : <Info size={14} aria-hidden="true" />}
          {copy.label}
        </span>
        {/* Only when both halves are present — a position with no total reads as a
            bare number out of nowhere. The server drops a lone rank for the same
            reason, so this is belt and braces. */}
        {outcome.rank != null && outcome.rankOf != null ? (
          <span className="text-xs text-ink-muted">Ranked {outcome.rank} of {outcome.rankOf}</span>
        ) : null}
      </div>

      {outcome.candidateNote ? (
        <p className="mt-2.5 whitespace-pre-line border-l-2 border-rule pl-3 text-sm text-ink">
          {outcome.candidateNote}
        </p>
      ) : null}

      <p className="mt-2 text-xs text-ink-muted">{copy.blurb}</p>
    </div>
  )
}

function SessionRow({ s }: { s: CandidateAssignedSession }) {
  const done = s.status === 'completed' || s.status === 'expired'
  return (
    <li className="rounded-lg border border-rule bg-surface p-4 transition-colors duration-fast hover:border-rule-strong">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{s.templateName}</p>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
            {s.role ? <span className="truncate text-xs text-ink-muted">{s.role}</span> : null}
            <ExhibitTab track={s.track} />
          </div>
        </div>

        {done ? (
          <span className="flex flex-shrink-0 items-center gap-1.5 rounded-md border border-ok-rule bg-ok-bg px-3 py-1.5 text-sm font-semibold text-ok">
            <CheckCircle2 size={15} aria-hidden="true" /> Completed
          </span>
        ) : (
          <Link
            /* A résumé round goes somewhere else entirely — see the route comment in
               App.tsx. Keyed on `roundKind`, not `track`: the assignment carries
               `type: chat` for one, so routing on the track would send them into the
               interview engine. */
            to={s.roundKind === 'resume' ? `/submit-resume/${s.id}` : `/take/${s.id}`}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-action px-4 py-2 text-sm font-semibold text-action-ink shadow-primary-sm transition-[background-color,box-shadow] duration-fast hover:bg-action-hover hover:shadow-primary-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {s.roundKind === 'resume'
              ? 'Submit résumé'
              : s.status === 'in_progress'
                ? 'Continue'
                : 'Start interview'}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* The end of the journey, which used to not exist here at all: a candidate who
          interviewed on the web was shown "Completed" and never told anything else,
          not even about a result released from the phone. Absent until the recruiter
          publishes — the server sends null, so there is nothing to hide client-side. */}
      {s.outcome ? <OutcomePanel outcome={s.outcome} /> : null}
    </li>
  )
}

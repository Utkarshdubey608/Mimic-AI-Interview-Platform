import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, LogOut, Inbox, RotateCw } from 'lucide-react'
import {
  Button, Skeleton, ExhibitTab, Card, EmptyState, ErrorState, Page,
} from '@/components/ui'
import { AmbientField } from '@/components/shell/AmbientField'
import { MimicLockup } from '@/components/brand/MimicMark'
import { sessionsApi } from '@/lib/api'
import { useAuth } from '@/features/auth/AuthProvider'
import { useDocumentGround } from '@/lib/workspaceGround'
import type { CandidateAssignedSession } from '@shared/types'

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
  useDocumentGround('room')
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-sessions'],
    queryFn: sessionsApi.mine,
  })

  const pending = data?.filter((s) => s.status !== 'completed' && s.status !== 'expired') ?? []

  return (
    // The room, like the sign-in that led here: a candidate's whole path — the
    // public site's hero, the entry, this lobby, most interview stages — now
    // reads as one dark product rather than a light site with dark rooms in it.
    <div data-ground="room" className="relative min-h-screen bg-ground">
      <AmbientField variant="room" />

      <header className="relative z-sticky border-b border-rule bg-surface/80 backdrop-blur-sm">
        <div className="mx-auto flex h-[60px] max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
          <MimicLockup />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">{user?.email}</span>
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

function SessionRow({ s }: { s: CandidateAssignedSession }) {
  const done = s.status === 'completed' || s.status === 'expired'
  return (
    <li className="flex items-center justify-between gap-4 rounded-lg border border-rule bg-surface p-4 transition-colors duration-fast hover:border-rule-strong">
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
          to={`/take/${s.id}`}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-action px-4 py-2 text-sm font-semibold text-action-ink shadow-primary-sm transition-[background-color,box-shadow] duration-fast hover:bg-action-hover hover:shadow-primary-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {s.status === 'in_progress' ? 'Continue' : 'Start interview'}
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      )}
    </li>
  )
}

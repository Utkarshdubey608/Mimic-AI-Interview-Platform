import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CalendarClock, CheckCircle2, LogOut, Inbox, AlertTriangle, RotateCw } from 'lucide-react'
import { Button, Skeleton, ExhibitTab } from '@/components/ui'
import { sessionsApi } from '@/lib/api'
import { useAuth } from '@/features/auth/AuthProvider'
import type { CandidateAssignedSession } from '@shared/types'

export default function CandidateHome() {
  const { user, signOutUser } = useAuth()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-sessions'],
    queryFn: sessionsApi.mine,
  })

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-white">
        <div className="mx-auto flex h-[60px] max-w-4xl items-center justify-between px-6">
          <img src="/talbotiq-logo.png" alt="TalbotIQ" className="h-9 w-auto" />
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-neutral-500 sm:inline">{user?.email}</span>
            <button
              onClick={() => void signOutUser()}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-neutral-600 transition-colors duration-150 hover:border-primary-300 hover:bg-primary-50/60"
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-neutral-900">Your interviews</h1>
        <p className="mt-1 text-sm text-neutral-500">Interviews assigned to {user?.email}.</p>

        <div className="mt-6">
          {isLoading ? (
            <ul className="space-y-3" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <li key={i} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-white p-4 shadow-xs">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-48 max-w-full" />
                    <Skeleton className="h-3 w-32 max-w-full" />
                  </div>
                  <Skeleton className="h-9 w-36 flex-shrink-0 rounded-full" />
                </li>
              ))}
            </ul>
          ) : isError ? (
            <Card>
              <div className="flex flex-col items-center py-6 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-md border border-danger-border bg-danger-bg text-danger">
                  <AlertTriangle size={20} strokeWidth={1.75} />
                </span>
                <h2 className="mt-4 font-display text-base font-bold tracking-[-0.02em] text-neutral-900">
                  Couldn’t load your interviews
                </h2>
                <p className="mt-1 max-w-sm text-sm leading-relaxed text-neutral-500">
                  {(error as Error)?.message ?? 'Something went wrong while fetching your assigned interviews.'}
                </p>
                <Button variant="secondary" size="sm" className="mt-4" icon={<RotateCw size={13} />} onClick={() => void refetch()}>
                  Try again
                </Button>
              </div>
            </Card>
          ) : (data && data.length > 0) ? (
            <ul className="space-y-3">
              {data.map((s) => <SessionRow key={s.id} s={s} />)}
            </ul>
          ) : (
            <Card>
              <div className="flex flex-col items-center py-10 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full border border-primary-100 bg-primary-50 text-primary-700">
                  <Inbox size={24} strokeWidth={1.75} />
                </span>
                <h2 className="mt-4 font-display text-lg font-bold tracking-[-0.02em] text-neutral-900">No interviews assigned</h2>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-neutral-500">
                  There are no interviews assigned to this account. If you were expecting one, make sure you’re signed in
                  with the email address your invite was sent to, or contact the recruiter.
                </p>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}

function SessionRow({ s }: { s: CandidateAssignedSession }) {
  const done = s.status === 'completed' || s.status === 'expired'
  return (
    <li className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-white p-4 shadow-xs transition-colors duration-150 hover:border-primary-200">
      <div className="min-w-0">
        <p className="truncate font-semibold text-neutral-900">{s.templateName}</p>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          {s.role ? <span className="truncate text-xs text-neutral-500">{s.role}</span> : null}
          <ExhibitTab track={s.track} />
        </div>
      </div>
      {done ? (
        <span className="flex flex-shrink-0 items-center gap-1.5 rounded-md border border-success-border bg-success-bg px-3 py-1.5 text-sm font-semibold text-success">
          <CheckCircle2 size={15} /> Completed
        </span>
      ) : (
        <Link
          to={`/take/${s.id}`}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-md bg-primary-700 px-4 py-2 text-sm font-semibold text-white shadow-primary-sm transition-all duration-150 hover:bg-primary-800 hover:shadow-primary-md"
        >
          <CalendarClock size={15} /> {s.status === 'in_progress' ? 'Continue' : 'Start interview'}
        </Link>
      )}
    </li>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">{children}</div>
}

import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { KeyRound, LogOut, RotateCw, ShieldAlert, Sparkles } from 'lucide-react'
import { Button, cn } from '@/components/ui'
import { useAuth } from './AuthProvider'

/* ─── shared states ─────────────────────────────────────────────────────── */

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-ground bg-brand-wash px-5 py-10">{children}</div>
}

/**
 * One designed full-screen state: brand band, icon plate, heading, calm copy,
 * pill actions. Shared by every non-happy auth outcome so they read as a family.
 */
function StatePanel({ tone, icon, title, children, actions }: {
  tone: 'warning' | 'danger'
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="w-full max-w-md overflow-hidden rounded-3xl border border-rule bg-surface shadow-xl">
      <div className="h-1 w-full bg-brand-band" aria-hidden />
      <div className="p-8 text-center">
        <span
          className={cn(
            'mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border',
            tone === 'warning' ? 'border-warn-rule bg-warn-bg text-warn' : 'border-risk-rule bg-risk-bg text-risk',
          )}
          aria-hidden
        >
          {icon}
        </span>
        <h1 className="mt-5 font-display text-xl font-extrabold tracking-[-0.02em] text-ink">{title}</h1>
        <div className="mt-2.5 text-sm leading-relaxed text-ink-muted">{children}</div>
        {actions ? <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{actions}</div> : null}
      </div>
    </div>
  )
}

export function AuthLoading() {
  return (
    <FullScreen>
      <div className="flex w-full max-w-[220px] flex-col items-center gap-4" role="status" aria-live="polite">
        <div className="flex h-12 w-12 animate-pulse-soft items-center justify-center rounded-2xl bg-brand-field shadow-primary-sm" aria-hidden>
          <Sparkles className="text-white" size={20} />
        </div>
        <p className="text-sm font-medium text-ink-muted">Checking your session…</p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-rule" aria-hidden>
          <span className="block h-full w-1/3 animate-pulse rounded-full bg-ink-disabled" />
        </div>
      </div>
    </FullScreen>
  )
}

/** Shown when the Firebase env vars are missing — the app can't authenticate. */
export function FirebaseNotConfigured() {
  return (
    <FullScreen>
      <StatePanel
        tone="warning"
        icon={<KeyRound size={22} />}
        title="Sign-in isn’t configured yet"
        actions={
          <Button variant="secondary" size="sm" icon={<RotateCw size={14} />} onClick={() => location.reload()}>
            Reload after configuring
          </Button>
        }
      >
        <p>
          This deployment is missing its Firebase credentials, so no one can sign in yet. Set the variables below
          (plus the server’s Firebase Admin credentials), then reload.
        </p>
        <div className="mt-4 rounded-xl border border-rule bg-surface-sunk px-3.5 py-3 text-left">
          <p className="font-mono text-xs text-ink-body">VITE_FIREBASE_*</p>
          <p className="mt-1.5 text-xs text-ink-muted">
            Full list and setup steps: <span className="font-mono text-ink-muted">docs/AUTH.md</span>
          </p>
        </div>
      </StatePanel>
    </FullScreen>
  )
}

function AccountError({ message }: { message: string }) {
  const { signOutUser } = useAuth()
  return (
    <FullScreen>
      <StatePanel
        tone="danger"
        icon={<ShieldAlert size={22} />}
        title="We couldn’t verify your account"
        actions={
          <>
            <Button icon={<LogOut size={15} />} onClick={() => void signOutUser()}>
              Sign out and try again
            </Button>
            <Button variant="secondary" icon={<RotateCw size={14} />} onClick={() => location.reload()}>
              Reload
            </Button>
          </>
        }
      >
        <p>{message}</p>
      </StatePanel>
    </FullScreen>
  )
}

/* ─── guards (used as layout routes) ────────────────────────────────────── */

/** Recruiter-only. Candidates are bounced to their own home; signed-out users to login. */
export function RequireRecruiter() {
  const { configured, loading, isAuthenticated, role, error } = useAuth()
  const location = useLocation()
  if (!configured) return <FirebaseNotConfigured />
  if (loading) return <AuthLoading />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (error) return <AccountError message={error} />
  if (role !== 'recruiter') return <Navigate to="/candidate" replace />
  return <Outlet />
}

/** Candidate-only. Recruiters are bounced to their dashboard; signed-out users to login. */
export function RequireCandidate() {
  const { configured, loading, isAuthenticated, role, error } = useAuth()
  const location = useLocation()
  if (!configured) return <FirebaseNotConfigured />
  if (loading) return <AuthLoading />
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (error) return <AccountError message={error} />
  if (role === 'recruiter') return <Navigate to="/sessions" replace />
  return <Outlet />
}

/** Root/catch-all: send each user to the right home for their role. */
export function HomeRedirect() {
  const { configured, loading, isAuthenticated, role } = useAuth()
  if (!configured) return <FirebaseNotConfigured />
  if (loading) return <AuthLoading />
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <Navigate to={role === 'recruiter' ? '/sessions' : '/candidate'} replace />
}

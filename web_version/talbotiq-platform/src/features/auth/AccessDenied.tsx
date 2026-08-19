import { useNavigate } from 'react-router-dom'
import { Home, LogIn, LogOut, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui'
import { useAuth } from './AuthProvider'

export default function AccessDenied() {
  const { isAuthenticated, role, signOutUser } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="flex min-h-screen items-center justify-center bg-ground bg-brand-wash px-5 py-10">
      {/* Same state family as the auth guards: brand band, icon plate, calm copy, pill actions. */}
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-rule bg-surface shadow-xl">
        <div className="h-1 w-full bg-brand-band" aria-hidden />
        <div className="p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-risk-rule bg-risk-bg text-risk" aria-hidden>
            <ShieldAlert size={22} />
          </span>
          <h1 className="mt-5 font-display text-xl font-extrabold tracking-[-0.02em] text-ink">Access denied</h1>
          <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
            {isAuthenticated
              ? 'This page belongs to a different role, so your account can’t open it. Head back to your own workspace.'
              : 'You need to be signed in to view this page.'}
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            {isAuthenticated ? (
              <Button icon={<Home size={15} />} onClick={() => navigate(role === 'recruiter' ? '/sessions' : '/candidate')}>
                Go to my home
              </Button>
            ) : (
              <Button icon={<LogIn size={15} />} onClick={() => navigate('/login')}>
                Sign in
              </Button>
            )}
            {isAuthenticated && (
              <Button variant="secondary" icon={<LogOut size={14} />} onClick={() => void signOutUser()}>
                Sign out
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

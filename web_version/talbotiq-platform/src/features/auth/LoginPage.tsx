import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, Briefcase, Lock, Mail, ShieldCheck, User as UserIcon } from 'lucide-react'
import { Button, cn } from '@/components/ui'
import { AmbientField } from '@/components/shell/AmbientField'
import { MimicMark } from '@/components/brand/MimicMark'
import { pageVariants } from '@/design/motion'
import { useAuth } from './AuthProvider'
import { AuthLoading, FirebaseNotConfigured } from './guards'
import type { UserRole } from '@shared/types'

/**
 * MIMIC — sign in.
 *
 * ── The rule this screen is built around ──────────────────────────────────
 * Nothing may delay signing in.
 *
 * The previous version mounted a WebGL splash over this form on every visit.
 * The form painted first and the splash faded out over it, which was a careful
 * piece of engineering in service of the wrong goal: the most frequent action in
 * the product — a recruiter arriving at work — was gated behind an animation
 * they had already seen. The splash is gone, and with it a 356 KB chunk and a
 * three.js dependency on the entry route.
 *
 * The atmosphere is now the background itself: two slow light fields on
 * near-black, drawn in CSS, costing nothing, present from the first frame. There
 * is no entrance the user has to sit through — the form is interactive
 * immediately, and the only motion is a 240ms settle on the card.
 *
 * ── Role at sign-up, not at sign-in ───────────────────────────────────────
 * Signing up asks whether you are a candidate or a recruiter, because that
 * writes `users/{uid}.role` and determines the whole product you get. Signing IN
 * does not ask, because the answer is already stored and asking again would make
 * the common path longer to no purpose — and would let someone pick the wrong
 * one and conclude the product is broken.
 */

type Mode = 'signin' | 'signup'

/** Turn a Firebase auth error into a short, human message. */
function friendly(err: unknown): string {
  const code = (err as { code?: string })?.code ?? ''
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'Incorrect email or password.'
    case 'auth/email-already-in-use': return 'An account with that email already exists, sign in instead.'
    case 'auth/weak-password': return 'Password should be at least 6 characters.'
    case 'auth/invalid-email': return 'That doesn’t look like a valid email address.'
    case 'auth/too-many-requests': return 'Too many attempts, please wait a moment and try again.'
    case 'auth/network-request-failed': return 'We couldn’t reach the server. Check your connection and try again.'
    default: return (err as Error)?.message || 'Something went wrong. Please try again.'
  }
}

const ROLE_OPTIONS: { value: UserRole; label: string; description: string; icon: React.ReactNode }[] = [
  { value: 'candidate', label: 'Candidate', description: 'Take interviews and follow your invites', icon: <UserIcon size={16} /> },
  { value: 'recruiter', label: 'Recruiter', description: 'Set up screenings and review results', icon: <Briefcase size={16} /> },
]

export default function LoginPage() {
  const { configured, loading, isAuthenticated, role, signInWithEmail, signUpWithEmail } = useAuth()
  const location = useLocation()
  const reduce = useReducedMotion() ?? false

  const [mode, setMode] = useState<Mode>('signin')
  const [roleIntent, setRoleIntent] = useState<UserRole>('candidate')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!configured) return <FirebaseNotConfigured />
  if (isAuthenticated && role && !loading) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? (role === 'recruiter' ? '/sessions' : '/candidate')} replace />
  }
  if (loading) return <AuthLoading />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      if (mode === 'signup') {
        await signUpWithEmail(email.trim(), password, roleIntent, name.trim() || undefined)
      } else {
        await signInWithEmail(email.trim(), password)
      }
      // On success, AuthProvider's live role stream re-routes via <Navigate> above.
    } catch (e2) {
      setErr(friendly(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    // The entry surface is PAPER, not a room — it is the marketing site's own
    // hero ground, so arriving here from the public site is continuous rather
    // than a jump between two identities. An earlier pass built this as a
    // near-black room; it looked expensive and belonged to a different company.
    <div className="relative flex min-h-screen flex-col bg-ground">
      <AmbientField variant="entry" />

      <main className="relative z-raised flex flex-1 items-center justify-center px-5 py-10">
        <motion.div
          variants={pageVariants(reduce)}
          initial="initial"
          animate="animate"
          className="w-full max-w-[26rem]"
        >
          {/* ── Brand lockup ─────────────────────────────────────────────
              The mark, the name, and one line that says what this is. Set above
              the card rather than inside it, so the card is purely the task. */}
          <div className="mb-7 flex flex-col items-center text-center">
            <MimicMark size="lg" />
            <h1 className="mt-4 font-display text-[26px] font-bold tracking-[-0.03em] text-ink">
              {mode === 'signup' ? 'Create your account' : 'Sign in to Mimic'}
            </h1>
            <p className="mt-1.5 max-w-[22rem] text-sm leading-relaxed text-ink-muted">
              {mode === 'signup'
                ? 'Interviews that produce evidence, not just a score.'
                : 'Structured AI interviewing, with the record behind every result.'}
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-rule bg-surface shadow-lg">
            {/* One hairline of the brand band. The only gradient on this screen. */}
            <div className="h-[2px] w-full bg-brand-band" aria-hidden="true" />

            <div className="p-6 sm:p-7">
              {/* ── Mode switch ────────────────────────────────────────────
                  A real tablist. Two destinations, both always visible, so
                  nobody has to discover that signing up exists. */}
              <div role="tablist" aria-label="Sign in or create an account" className="mb-6 flex gap-1 rounded-md bg-surface-sunk p-1">
                {(['signin', 'signup'] as const).map((m) => (
                  <button
                    key={m}
                    role="tab"
                    type="button"
                    aria-selected={mode === m}
                    onClick={() => { setMode(m); setErr(null) }}
                    className={cn(
                      'flex-1 rounded-sm px-3 py-1.5 text-sm font-semibold transition-colors duration-fast',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      mode === m
                        ? 'bg-surface-raised text-ink shadow-sm'
                        : 'text-ink-muted hover:text-ink-body',
                    )}
                  >
                    {m === 'signin' ? 'Sign in' : 'Create account'}
                  </button>
                ))}
              </div>

              {/* ── Role, at sign-up only ─────────────────────────────────── */}
              {mode === 'signup' && (
                <fieldset className="mb-5">
                  <legend className="field-label">I am a</legend>
                  <div className="grid grid-cols-2 gap-2.5">
                    {ROLE_OPTIONS.map(({ value: r, label, description, icon }) => {
                      const selected = roleIntent === r
                      return (
                        <button
                          key={r}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => { setRoleIntent(r); setErr(null) }}
                          className={cn(
                            'flex flex-col items-start rounded-lg border p-3 text-left',
                            'transition-[border-color,background-color] duration-fast',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                            selected
                              ? 'border-ink bg-surface-sunk'
                              : 'border-rule bg-surface-sunk hover:border-rule-strong',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-fast',
                              selected ? 'bg-action text-action-ink' : 'bg-surface-hover text-ink-muted',
                            )}
                            aria-hidden="true"
                          >
                            {icon}
                          </span>
                          <span className="mt-2.5 text-sm font-semibold text-ink">{label}</span>
                          <span className="mt-0.5 text-xs leading-snug text-ink-muted">{description}</span>
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
              )}

              {err && (
                <div
                  role="alert"
                  className="mb-5 flex items-start gap-2 rounded-md border border-risk-rule bg-risk-bg px-3.5 py-2.5 text-sm text-risk"
                >
                  <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{err}</span>
                </div>
              )}

              <form onSubmit={submit} noValidate>
                <div className="space-y-3">
                  {mode === 'signup' && (
                    <Field
                      icon={<UserIcon size={15} />} type="text" label="Full name"
                      autoComplete="name" value={name} onChange={setName}
                    />
                  )}
                  <Field
                    icon={<Mail size={15} />} type="email" label="Email" required
                    autoComplete="email" value={email} onChange={setEmail}
                  />
                  <Field
                    icon={<Lock size={15} />} type="password" label="Password" required
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    value={password} onChange={setPassword}
                  />
                </div>

                <Button type="submit" size="lg" block loading={busy} className="mt-5">
                  {mode === 'signup' ? `Create ${roleIntent} account` : 'Sign in'}
                </Button>
              </form>

              {/* ── Trust ────────────────────────────────────────────────────
                  One line, and it says something true and specific. A row of
                  compliance badges nobody has audited is worse than nothing. */}
              <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-ink-faint">
                <ShieldCheck size={14} strokeWidth={1.75} className="mt-px flex-shrink-0" aria-hidden="true" />
                Your credentials are handled by Firebase Authentication. Interview
                recordings and transcripts are visible only to the hiring team that
                invited you.
              </p>
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  )
}

/**
 * A labelled field with a leading glyph.
 *
 * The label is a real `<label>`, not a placeholder. A placeholder-as-label
 * disappears the moment someone starts typing, which is exactly when they are
 * most likely to need it — and it fails every autofill heuristic.
 */
function Field({
  icon, label, value, onChange, ...rest
}: {
  icon: React.ReactNode
  label: string
  value: string
  onChange: (v: string) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = `login-${label.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true">
          {icon}
        </span>
        <input
          {...rest}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-base pl-9"
        />
      </div>
    </div>
  )
}

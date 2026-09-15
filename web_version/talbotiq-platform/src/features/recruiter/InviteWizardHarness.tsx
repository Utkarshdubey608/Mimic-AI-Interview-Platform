import { AuthProvider } from '@/features/auth/AuthProvider'
import InviteWizard from './InviteWizard'

/**
 * Browser-test harness for the recruiter's invite wizard.
 *
 * Mounted only in development (see App.tsx), outside the identity gate — same
 * reasoning as `/__mcq`: a Playwright run has no Firebase session. Unlike
 * `McqSetsPage`, two of InviteWizard's own children (`InviteEmailStep`,
 * `ReviewSend`) call `useAuth()` directly, which throws outside an
 * `AuthProvider` — so this wraps the REAL provider (untouched, same one
 * `AuthedApp` uses), not a stub. That is a narrower thing than "stubbing
 * auth": it supplies context a component structurally requires to render, it
 * grants no access, and `RequireRecruiter`'s identity gate — the thing the
 * "no bypass" rule in App.tsx is actually about — still does not wrap this
 * route. With no real session, `user`/`firebaseUser` simply resolve to null,
 * which both components already handle (they fall back to a generic name).
 */
export default function InviteWizardHarness() {
  return (
    <AuthProvider>
      <InviteWizard />
    </AuthProvider>
  )
}

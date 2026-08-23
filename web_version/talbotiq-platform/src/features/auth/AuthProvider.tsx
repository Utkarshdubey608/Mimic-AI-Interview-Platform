import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import {
  onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail,
  createUserWithEmailAndPassword, signOut, updateProfile,
  type User,
} from 'firebase/auth'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { companyKey, companyDisplay } from '@/lib/companyKey'
import { clearGroundChoice } from '@/lib/workspaceGround'
import { firebaseAuth, firestore, firebaseConfigured, getIdTokenOrNull } from '@/lib/firebase'
import { httpBase, commonBase } from '@/lib/apiOrigin'
import type { AppUser, UserRole } from '@shared/types'

/**
 * Auth context — mirrors the Flutter app's AuthService + AuthGate model so the
 * two clients interoperate on the same Firebase project (`talbotiq-9cc4e`):
 *
 *   • Identity:  Firebase Email/Password.
 *   • Role:      Firestore `users/{uid}.role`, chosen at sign-up and read LIVE
 *                (onSnapshot). A missing doc defaults to `candidate`, so the UI
 *                re-routes automatically the moment the role doc appears.
 *   • No custom claims, no demo mode. The backend still verifies the ID token on
 *                every /api request and reads the SAME users/{uid}.role, so the
 *                client and server always agree on the role.
 */
interface AuthContextValue {
  configured: boolean            // Firebase env present; false → "configure sign-in" notice
  loading: boolean
  isAuthenticated: boolean
  firebaseUser: User | null
  user: AppUser | null           // synthesized from the Firebase user + role doc
  role: UserRole | null
  error: string | null
  /** The company on `users/{uid}`, live. `null` means genuinely absent — an account
   *  created before either client collected one. RecruiterShell prompts on it. */
  accountCompanyKey: string | null
  accountCompany: string | null
  /** Record a company on an existing account. Writes both forms, in the same shape
   *  sign-up does, so a backfilled account is indistinguishable from a new one. */
  recordCompany: (name: string) => Promise<void>
  signInWithEmail: (email: string, password: string) => Promise<void>
  /** Send a reset link. Mirrors the Flutter app's `AuthService.sendPasswordReset`,
   *  which was the ONLY place in the product a password could be recovered — a web
   *  user's only route back was to install the app. */
  sendPasswordReset: (email: string) => Promise<void>
  signUpWithEmail: (email: string, password: string, role: UserRole, displayName?: string, company?: string) => Promise<void>
  signOutUser: () => Promise<void>
}

const AuthCtx = createContext<AuthContextValue | null>(null)

/**
 * One-time global fetch interceptor: attach the Firebase ID token to every
 * request aimed at OUR backend — the configured web base (`…/api/web`) and the
 * shared common base (`…/api`), relative or absolute. Matching the configured
 * bases (not a literal '/api') is what keeps the header attached when
 * VITE_API_BASE points at a cross-origin host. Covers both the typed api.ts
 * client and the raw fetch() calls in the ported avatar UI. External requests
 * and calls that already carry an Authorization header are untouched.
 */
let fetchPatched = false
function installFetchInterceptor() {
  if (fetchPatched || typeof window === 'undefined') return
  fetchPatched = true
  const original = window.fetch.bind(window)
  const bases = [httpBase(), commonBase()]
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : String(input)
      const isApi = bases.some((b) => url.startsWith(b) || url.startsWith(`${window.location.origin}${b}`))
      if (isApi && firebaseConfigured) {
        const token = await getIdTokenOrNull()
        if (token) {
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
          if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
          return original(input, { ...init, headers })
        }
      }
    } catch {
      /* fall through to an unmodified request */
    }
    return original(input, init)
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [role, setRole] = useState<UserRole | null>(null)
  const [name, setName] = useState<string | null>(null)
  /* The company this account belongs to, read LIVE from the same doc as the role.
     `null` means the field is genuinely absent — every account created on the Flutter
     app before it collected one, and every account that predates the field. That is
     what the prompt in RecruiterShell keys off. */
  const [accountCompanyKey, setAccountCompanyKey] = useState<string | null>(null)
  const [accountCompany, setAccountCompany] = useState<string | null>(null)
  const [loading, setLoading] = useState(firebaseConfigured)
  const [error, setError] = useState<string | null>(null)
  const roleUnsub = useRef<null | (() => void)>(null)

  useEffect(() => {
    if (!firebaseConfigured) { setLoading(false); return }
    installFetchInterceptor()

    const unsub = onAuthStateChanged(firebaseAuth(), (u) => {
      // Tear down the previous user's role subscription before starting a new one.
      roleUnsub.current?.(); roleUnsub.current = null
      setFirebaseUser(u)
      setError(null)
      if (!u) { setRole(null); setName(null); setAccountCompanyKey(null); setAccountCompany(null); setLoading(false); return }

      setLoading(true)
      // Live role stream from users/{uid} — the same doc the Flutter app writes.
      // Missing doc → candidate (an account created outside the app, or the split
      // second before sign-up finishes writing the doc).
      roleUnsub.current = onSnapshot(
        doc(firestore(), 'users', u.uid),
        (snap) => {
          const data = snap.data()
          setRole(data?.role === 'recruiter' ? 'recruiter' : 'candidate')
          setName(typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : null)
          const storedKey = typeof data?.companyKey === 'string' ? data.companyKey.trim() : ''
          setAccountCompanyKey(storedKey || null)
          setAccountCompany(typeof data?.company === 'string' && data.company.trim() ? data.company.trim() : null)
          setLoading(false)
        },
        (err) => {
          setRole('candidate')   // fail safe to least privilege
          // Cleared rather than left stale: a failed read must not leave the previous
          // account's company in place for the next one.
          setAccountCompanyKey(null)
          setAccountCompany(null)
          setError(err instanceof Error ? err.message : 'Could not read your account role')
          setLoading(false)
        },
      )
    })

    return () => { unsub(); roleUnsub.current?.(); roleUnsub.current = null }
  }, [])

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(firebaseAuth(), email.trim(), password)
  }, [])

  const recordCompany = useCallback(async (name: string) => {
    const user = firebaseAuth().currentUser
    if (!user) throw new Error('You are signed out.')
    const key = companyKey(name)
    // Refused rather than written blank. An empty key stored as a VALUE becomes the
    // bucket every company-less account falls into, which is the leak the whole
    // scoping exists to prevent — see src/lib/companyKey.ts.
    if (!key) throw new Error('Enter your company name.')
    await setDoc(
      doc(firestore(), 'users', user.uid),
      { company: companyDisplay(name), companyKey: key, updatedAt: serverTimestamp() },
      { merge: true },
    )
    // No local setState: the onSnapshot above is live, so the prompt closes when the
    // write lands rather than when this resolves. One source of truth for the value.
  }, [])

  const sendPasswordReset = useCallback(async (email: string) => {
    await sendPasswordResetEmail(firebaseAuth(), email.trim())
  }, [])

  const signUpWithEmail = useCallback(
    async (email: string, password: string, role: UserRole, displayName?: string, company?: string) => {
      const cred = await createUserWithEmailAndPassword(firebaseAuth(), email.trim(), password)
      const dn = displayName?.trim()
      if (dn) { try { await updateProfile(cred.user, { displayName: dn }) } catch { /* non-fatal */ } }
      // Write the role doc in the EXACT shape the Flutter app uses (auth_service.dart)
      // so an account created here behaves identically on the app, and vice-versa.
      await setDoc(doc(firestore(), 'users', cred.user.uid), {
        email: cred.user.email,
        emailLower: (cred.user.email ?? email).trim().toLowerCase(),
        role,
        ...(dn ? { name: dn } : {}),
        // Both forms, and both are needed. `company` is what they typed, kept for
        // display; `companyKey` is the normalised form and the only thing ever
        // compared, so "TalbotIQ" and "talbotiq" are one company. Written only
        // when given — an empty key must never become a bucket that everyone with
        // no company falls into. See src/lib/companyKey.ts.
        ...(companyKey(company) ? { company: companyDisplay(company), companyKey: companyKey(company) } : {}),
        createdAt: serverTimestamp(),
      })
    },
    [],
  )

  const signOutUser = useCallback(async () => {
    await signOut(firebaseAuth())
    setRole(null); setName(null)
    /* Forget that a ground was CHOSEN, but keep which one. The next person at
       this browser is asked again rather than silently inheriting the last one's
       appearance — and because the value survives, "Go to workspace" on the
       picker still has a previous mode to go with, which is the whole point of
       storing the two separately. */
    clearGroundChoice()
  }, [])

  const user: AppUser | null =
    firebaseUser && role
      ? {
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? '',
          role,
          displayName: name ?? firebaseUser.displayName ?? undefined,
          emailVerified: firebaseUser.emailVerified,
          status: 'active',
          createdAt: '',
          updatedAt: '',
        }
      : null

  const value: AuthContextValue = {
    configured: firebaseConfigured,
    loading,
    isAuthenticated: !!firebaseUser,
    firebaseUser,
    user,
    role,
    error,
    accountCompanyKey,
    accountCompany,
    recordCompany,
    signInWithEmail,
    sendPasswordReset,
    signUpWithEmail,
    signOutUser,
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

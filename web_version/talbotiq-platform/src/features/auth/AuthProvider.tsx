import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile,
  type User,
} from 'firebase/auth'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
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
  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (email: string, password: string, role: UserRole, displayName?: string) => Promise<void>
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
      if (!u) { setRole(null); setName(null); setLoading(false); return }

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
          setLoading(false)
        },
        (err) => {
          setRole('candidate')   // fail safe to least privilege
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

  const signUpWithEmail = useCallback(
    async (email: string, password: string, role: UserRole, displayName?: string) => {
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
        createdAt: serverTimestamp(),
      })
    },
    [],
  )

  const signOutUser = useCallback(async () => {
    await signOut(firebaseAuth())
    setRole(null); setName(null)
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
    signInWithEmail,
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

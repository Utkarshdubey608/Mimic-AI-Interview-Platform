import { Outlet } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import MimicGuide from '@/features/guide/MimicGuide'

/**
 * The authenticated half of the app.
 *
 * This lives in its own module so that importing it is what pulls Firebase in.
 * App.tsx loads it lazily, which keeps the Firebase SDK — 167 KB, the single
 * largest asset on the site — out of the initial chunk. (This boundary
 * originally existed to keep Firebase off the public MIMIC marketing pages;
 * the marketing site is a standalone app now, but the split still pays for
 * itself on first paint.)
 *
 * AuthProvider's own implementation is untouched; only where it mounts changed.
 * The in-product assistant sits here too.
 */
export default function AuthedApp() {
  return (
    <AuthProvider>
      <Outlet />
      <MimicGuide />
    </AuthProvider>
  )
}

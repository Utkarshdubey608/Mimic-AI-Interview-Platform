import { Outlet } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import MimicGuide from '@/features/guide/MimicGuide'

/**
 * The authenticated half of the app.
 *
 * This lives in its own module so that importing it is what pulls Firebase in.
 * App.tsx loads it lazily, which keeps the Firebase SDK — 167 KB, the single
 * largest asset on the site — off the public marketing pages entirely. Nothing
 * under src/features/marketing uses auth, so those pages should never have been
 * paying for it.
 *
 * AuthProvider's own implementation is untouched; only where it mounts changed.
 * The in-product assistant sits here too, so it is naturally absent from the
 * public site rather than needing a path check.
 */
export default function AuthedApp() {
  return (
    <AuthProvider>
      <Outlet />
      <MimicGuide />
    </AuthProvider>
  )
}

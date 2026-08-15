import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Nav } from '@/components/layout/Nav'
import { refreshServiceStatus } from '@/store/useAppStore'
import { IntroFaceSync } from '@/features/intro/IntroFaceSync'

/**
 * Recruiter app chrome — top nav + routed content. Mounts only for an
 * authenticated recruiter, so this is where we (re)load the server-side
 * service-configuration flags now that the request carries the ID token.
 *
 * Extracted from App.tsx into its own module so it can be loaded lazily: both
 * Nav and IntroFaceSync reach Firebase (via useAuth and getIdTokenOrNull), and
 * importing them from App.tsx put the SDK on every route including the public
 * marketing site.
 */
export default function RecruiterShell() {
  useEffect(() => { refreshServiceStatus() }, [])
  // The spine is fixed at 15rem on md+, so the record surface is inset by that
  // width rather than sitting under it. Below md the spine becomes a sticky
  // cover bar and the inset drops to zero.
  return (
    <div className="min-h-screen bg-background font-sans">
      <Nav />
      {/* pr-20 on md+ reserves the column the floating guide launcher occupies.
          A `fixed` overlay over a long scroll always covers whatever row is at
          the bottom of the viewport, so the only real fix is to keep content out
          of its lane rather than to pad the end of the document. */}
      <main className="md:pl-[15rem] md:pr-20">
        <Outlet />
      </main>
      {/* Background, one-time sync of real replica thumbnails into the intro's
          face cache (IndexedDB). Renders nothing; no extra Tavus call. */}
      <IntroFaceSync />
    </div>
  )
}

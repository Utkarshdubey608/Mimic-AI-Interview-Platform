import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Nav } from '@/components/layout/Nav'
import { refreshServiceStatus } from '@/store/useAppStore'
import { IntroFaceSync } from '@/features/intro/IntroFaceSync'
import { CompanyPrompt } from '@/features/auth/CompanyPrompt'
import { useDocumentGround, useWorkspaceGround } from '@/lib/workspaceGround'

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

  // The workspace lives in the room by default; a recruiter reading transcripts
  // all day can switch to the light record from the spine. Setting the ground on
  // <html> — not just on this subtree — is what keeps the page edge honest:
  // html/body paint var(--ground), so without this an over-scroll bounce or a
  // route transition would flash the wrong ground behind the workspace. Restored
  // on unmount so the candidate surfaces and the marketing site keep choosing
  // their own ground.
  const ground = useWorkspaceGround()
  useDocumentGround(ground)

  // The spine is fixed, so the workspace surface is inset by its width rather
  // than sitting under it — and that width now changes with the viewport:
  //
  //   < md            a sticky cover bar; the inset drops to zero
  //   md .. xl        a 4rem icon rail (--spine-w-collapsed)
  //   >= xl           the full 15rem spine (--spine-w)
  //
  // The middle step exists because at 1024px a 15rem spine takes 23% of the
  // viewport and the sessions record starts clipping its own score column. The
  // collapsed width was already in the token layer and had never been used.
  return (
    <div data-ground={ground} className="min-h-screen bg-background font-sans">
      <Nav />
      {/* pr-20 on md+ reserves the column the floating guide launcher occupies.
          A `fixed` overlay over a long scroll always covers whatever row is at
          the bottom of the viewport, so the only real fix is to keep content out
          of its lane rather than to pad the end of the document. */}
      <main className="md:pl-spine-collapsed xl:pl-spine md:pr-20">
        <Outlet />
      </main>
      {/* Background, one-time sync of real replica thumbnails into the intro's
          face cache (IndexedDB). Renders nothing; no extra Tavus call. */}
      <IntroFaceSync />
      {/* Asks an existing recruiter for their company, once. Mounted on the shell
          rather than on a page so it cannot be skipped by navigating — templates and
          question sets are scoped by the key, and without one a recruiter silently
          stops seeing their colleagues' work. Renders nothing once it is set. */}
      <CompanyPrompt />
    </div>
  )
}

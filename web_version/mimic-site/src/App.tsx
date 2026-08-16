import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'

/**
 * The MIMIC marketing site, standalone.
 *
 * This used to live inside the web application at /mimic* (see
 * web_version/talbotiq-platform). It is now its own app so the two can ship
 * independently: no Firebase, no auth, no product code — the only network
 * call on the whole site is the demo-request form's POST to the backend's
 * public /api/web/leads route. Pages keep their old paths minus the /mimic
 * prefix (the canonical host is mimic.talbotiq.com; redirects from the old
 * app paths are the app's concern, not this site's).
 */
const MimicSite     = lazy(() => import('./site/MimicSite'))
const MarketingPage = lazy(() => import('./site/MarketingPage'))

/** Route-transition fallback — quiet, just the page ground. */
function RouteFallback() {
  return <div style={{ minHeight: '100vh' }} aria-busy="true" aria-live="polite" />
}

/**
 * Scroll management for SPA navigations. React Router's pushState neither
 * scrolls to the top on a route change nor honors #fragments — so without
 * this, every inner page's "Book a demo" (to="/#demo") landed on the home
 * page at the visitor's previous scroll offset instead of the form (the
 * site's main conversion path), and ordinary link navigations kept the prior
 * page's position. Hash targets are retried across frames because the lazy
 * route chunk mounts after the navigation commits.
 */
const STICKY_NAV_OFFSET = 72
function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    const behavior: ScrollBehavior =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    if (hash) {
      const id = hash.slice(1)
      let tries = 0
      let raf = 0
      const attempt = () => {
        const el = document.getElementById(id)
        if (el) {
          window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - STICKY_NAV_OFFSET, behavior })
        } else if (++tries < 60) {
          raf = requestAnimationFrame(attempt) // lazy chunk still mounting
        }
      }
      attempt()
      return () => cancelAnimationFrame(raf)
    }
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname, hash])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollManager />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<MimicSite />} />
          <Route path="/*" element={<MarketingPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

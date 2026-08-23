import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { NAV, type NavGroup } from './content'
import { useAuth } from '@/features/auth/AuthProvider'
import { Ico } from './icons'
import { ScrollProgress, useSectionCues, useSmoothScroll } from './motion'
import { Field } from './Field'
import { InkTrail } from './ink/InkTrail'
import { RoamingInk } from './ink/RoamingInk'
import './mimicSite.css'

const Mark = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M7 21V11l5 6 4-6 4 6 5-6v10" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Shared marketing chrome — announcement bar, accessible mega-menu and footer.
 *  Used by the home page and every inner page so the navigation is defined once. */
export function MarketingLayout({ children, seo }: { children: ReactNode; seo?: { title: string; desc: string } }) {
  // Site-wide scroll feel. Skipped entirely under prefers-reduced-motion, and
  // the Lenis chunk is only fetched when it will actually be used.
  useSmoothScroll()
  const [banner, setBanner] = useState(true)
  const [open, setOpen] = useState<string | null>(null)   // desktop mega-panel
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobileGroup, setMobileGroup] = useState<string | null>(null)
  const hideTimer = useRef<number | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
  const loc = useLocation()

  /**
   * The crossing between the public site and the application.
   *
   * Signed out it reads "Sign in" and goes to /login, exactly as before. Signed
   * in it offers the workspace instead, because showing "Sign in" to someone
   * who already is undoes the illusion that this is one site. The destination
   * is the same one HomeRedirect picks, so both doors lead to the same place.
   *
   * Auth is only READ here. The provider, the guards and the sign-in flow are
   * untouched; marketing renders inside the existing AuthedApp.
   */
  const { isAuthenticated, role } = useAuth()
  const crossing = isAuthenticated
    ? { to: role === 'recruiter' ? '/sessions' : '/candidate', label: 'Go to workspace' }
    : { to: '/login', label: 'Sign in' }

  // Per-route SEO head (SPA shares one <head>): set on mount/route, restore after.
  useEffect(() => {
    if (!seo) return
    const prev = document.title
    document.title = seo.title
    const added: HTMLElement[] = []
    const set = (sel: string, attr: string, key: string, val: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(sel)
      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); added.push(el) }
      el.setAttribute('content', val)
    }
    set('meta[name="description"]', 'name', 'description', seo.desc)
    set('meta[property="og:title"]', 'property', 'og:title', seo.title)
    set('meta[property="og:description"]', 'property', 'og:description', seo.desc)
    // Reuse the prerendered canonical when there is one. The build writes a
    // real <head> per marketing route (scripts/prerender-marketing-seo.ts), so
    // appending unconditionally would leave two canonical links on every page, // which search engines may resolve by ignoring both.
    let canon = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canon) {
      canon = document.createElement('link'); canon.rel = 'canonical'
      document.head.appendChild(canon); added.push(canon)
    }
    canon.href = `https://mimic.talbotiq.com${loc.pathname}`
    return () => { document.title = prev; added.forEach((e) => e.remove()) }
  }, [seo, loc.pathname])

  // Section cues, re-armed per route. Defined here rather than per page so all
  // 73 marketing routes get the same treatment from one observer — see the hook.
  useSectionCues(loc.pathname)

  // Close menus on route change.
  useEffect(() => { setOpen(null); setMobileOpen(false); setMobileGroup(null) }, [loc.pathname, loc.hash])
  // Click-outside + Escape close the desktop panel.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(null); setMobileOpen(false) } }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [])
  useEffect(() => () => { if (hideTimer.current) window.clearTimeout(hideTimer.current) }, [])

  const enter = (k: string) => { if (hideTimer.current) window.clearTimeout(hideTimer.current); hideTimer.current = window.setTimeout(() => setOpen(k), 110) }
  const leave = () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); hideTimer.current = window.setTimeout(() => setOpen(null), 150) }
  const active = (g: NavGroup) => loc.pathname === g.to || loc.pathname.startsWith(g.to + '/')

  return (
    <div className="mimic-site">
      {/* The ink trail on every surface that does not already carry one — which
          is every white band on all 74 routes. One layer, mounted here rather
          than per page, because it finds its own host. See RoamingInk. */}
      <RoamingInk />
      <ScrollProgress />
      {banner && (
        <div className="banner" role="region" aria-label="Announcement">
          <span>
            Every applicant interviewed the day they apply.{' '}
            <Link to="/#scoring">See how the scoring works<Ico n="arrow" /></Link>
          </span>
          <button type="button" aria-label="Dismiss announcement" onClick={() => setBanner(false)}>
            <Ico n="close" />
          </button>
        </div>
      )}

      <header className="nav" ref={navRef}>
        <div className="wrap nav-in">
          <Link className="brand" to="/" aria-label="Mimic by TalbotIQ, home">
            <span className="mk"><Mark /></span>Mimic
          </Link>

          <nav className="navlinks" aria-label="Primary" onMouseLeave={leave}>
            {NAV.map((g) => (
              <button key={g.key} type="button" aria-expanded={open === g.key} aria-haspopup="true"
                className={active(g) ? 'is-active' : undefined}
                onMouseEnter={() => enter(g.key)} onFocus={() => setOpen(g.key)}
                onClick={() => setOpen(open === g.key ? null : g.key)}>
                {g.label}
                <Ico n="chevron" className="caret" />
              </button>
            ))}
          </nav>

          <div className="nav-right">
            <Link className="signin" to={crossing.to}>{crossing.label}</Link>
            <Link className="btn btn-primary" to="/#demo">Book a demo</Link>
            <button className="navtoggle" type="button" aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen} onClick={() => setMobileOpen((o) => !o)}>
              <Ico n={mobileOpen ? 'close' : 'menu'} />
            </button>
          </div>
        </div>

        {open && (
          <div className="mega open"
            onMouseEnter={() => { if (hideTimer.current) window.clearTimeout(hideTimer.current) }}
            onMouseLeave={leave}>
            <div className="wrap mega-in">
              {NAV.find((g) => g.key === open)!.columns.map((col) => (
                /* Classed, so the menu has styling of its own. Unclassed, the
                   headings and links fell through to the base `a` rule and
                   rendered as plain blue browser links in a bulleted list. */
                <div key={col.title} className="mega-col">
                  <h4>{col.title}</h4>
                  <ul>{col.links.map((l) => <li key={l.label}><Link to={l.to}>{l.label}</Link></li>)}</ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {mobileOpen && (
          <div className="mmenu">
            {NAV.map((g) => (
              <div key={g.key} className="macc">
                <button type="button" aria-expanded={mobileGroup === g.key}
                  onClick={() => setMobileGroup(mobileGroup === g.key ? null : g.key)}>
                  {g.label}
                  <Ico n="chevron" />
                </button>
                {mobileGroup === g.key && (
                  <div className="macc-body">
                    {g.columns.map((col) => (
                      <div key={col.title}>
                        <h5>{col.title}</h5>
                        {col.links.map((l) => <Link key={l.label} to={l.to}>{l.label}</Link>)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {/* Styled in mimicSite.css (`.mmenu > a`), not inline: the inline
                padding here was 2px horizontal, which left "Sign in" hard
                against the screen edge while every group label above it sat at
                19px. */}
            <Link to={crossing.to}>{crossing.label}</Link>
            <Link className="btn btn-primary" to="/#demo">Book a demo</Link>
          </div>
        )}
      </header>

      {children}

      <footer className="foot">
        {/* The last ink field on every page, and the one the reader leaves on.
            Its own seed again, so the three fields on the homepage read as three
            surfaces rather than one repeated loop. */}
        <Field seed={23} />
        {/* The footer is an ink field on every page, so the ink belongs here
            too — it is the last dark surface the reader passes through. */}
        <InkTrail />
        <div className="wrap">
          <div className="foot-grid">
            <div className="foot-brand">
              <span className="brand" style={{ color: '#fff' }}><span className="mk"><Mark /></span>Mimic</span>
              <p>AI interviews for every candidate. A TalbotIQ product.</p>
            </div>
            {NAV.map((g) => (
              <div key={g.key}>
                <h4>{g.label}</h4>
                <ul>{g.columns.flatMap((c) => c.links).slice(0, 6).map((l) => <li key={l.label}><Link to={l.to}>{l.label}</Link></li>)}</ul>
              </div>
            ))}
          </div>
          <div className="foot-bottom">
            <span>© 2026 TalbotIQ. Mimic is a product of TalbotIQ.</span>
            {/* Inherits the light footer's muted ink — the footer is no longer a dark field. */}
            <span><Link to="/company/legal" style={{ color: 'inherit' }}>Legal &amp; privacy</Link></span>
          </div>
        </div>
      </footer>
    </div>
  )
}

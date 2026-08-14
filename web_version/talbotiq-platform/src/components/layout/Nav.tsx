import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Menu, X } from 'lucide-react'
import { cn } from '@/components/ui'
import { useAppStore } from '@/store/useAppStore'
import { useAuth } from '@/features/auth/AuthProvider'

function initialsOf(label: string): string {
  const parts = label.split(/[\s@._-]+/).filter(Boolean).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || 'U'
}

// Menu bar = the Mimic design's 7-tab standard (Sessions · Templates · Question
// sets · Pipelines · Analytics · Avatar studio · Settings). In Mimic's IA,
// candidate results live inside Sessions → View report, and the avatar interview
// room launches from Avatar studio (/setup) — so /interview and /results stay
// as working routes but are intentionally not top-level tabs.
const LINKS = [
  { to: '/sessions',      label: 'Sessions' },
  { to: '/templates',     label: 'Templates' },
  { to: '/question-sets', label: 'Question sets' },
  { to: '/pipelines',     label: 'Pipelines' },
  { to: '/analytics',     label: 'Analytics' },
  { to: '/setup',         label: 'Avatar studio' },
  { to: '/settings',      label: 'Settings' },
]

export function Nav() {
  const { interviewActive, tavusKey } = useAppStore()
  const { user, signOutUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const label = user?.displayName || user?.email || ''

  // Below md the seven tabs cannot fit, and an overflowing row put Pipelines,
  // Analytics, Avatar studio, Settings and Sign out off-screen with no way to
  // reach them. Collapse them into a disclosure menu instead.
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <header className="sticky top-0 z-40 bg-white/92 backdrop-blur-md border-b border-border" style={{ boxShadow: '0 1px 3px rgba(27,11,59,0.05)' }}>
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 h-[64px] flex items-center justify-between gap-3 md:gap-6">

        {/* Brand — Mimic wordmark (product) */}
        <button
          onClick={() => navigate('/sessions')}
          className="flex items-center gap-2.5 focus:outline-none flex-shrink-0"
          aria-label="Mimic home"
        >
          <span className="grid place-items-center h-8 w-8 rounded-lg bg-brand-field shadow-primary-sm">
            <svg viewBox="0 0 32 32" className="h-[18px] w-[18px]" aria-hidden="true">
              <path d="M7 21V11l5 6 4-6 4 6 5-6v10" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="font-display text-[20px] font-extrabold tracking-[-0.035em] text-neutral-900">Mimic</span>
        </button>

        {/* Nav tabs — pill style exactly matching screenshot */}
        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {LINKS.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                cn(
                  'px-4 py-1.5 rounded-full text-sm font-semibold transition-all duration-150 whitespace-nowrap',
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100',
                )
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        {/* Right */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {interviewActive && (
            <span className="flex items-center gap-1.5 text-xs font-bold text-mint-ink uppercase tracking-wider bg-mint-bg border border-mint-border px-3 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              Live
            </span>
          )}

          {!tavusKey && (
            <button
              onClick={() => navigate('/settings')}
              className="hidden md:inline-flex text-xs font-medium text-warning bg-warning-bg border border-warning-border px-3 py-1.5 rounded-full hover:brightness-95 transition-[filter]"
            >
              Add API Key →
            </button>
          )}

          {/* Signed-in user + sign out */}
          <div
            className="hidden md:flex w-9 h-9 rounded-full bg-brand-field items-center justify-center text-white text-xs font-bold shadow-primary-sm"
            title={label}
          >
            {initialsOf(label)}
          </div>
          <button
            onClick={() => void signOutUser()}
            title="Sign out"
            aria-label="Sign out"
            className="hidden md:flex items-center justify-center w-9 h-9 rounded-full text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors"
          >
            <LogOut size={17} />
          </button>

          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mimic-mobile-menu"
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-full text-neutral-700 hover:bg-neutral-100 transition-colors"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile disclosure — every destination the tab row holds on desktop */}
      {menuOpen && (
        <div id="mimic-mobile-menu" className="md:hidden border-t border-border bg-white px-4 py-3">
          <nav className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors duration-150',
                    isActive ? 'bg-primary text-white' : 'text-neutral-700 hover:bg-neutral-100',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-brand-field text-[11px] font-bold text-white"
              >
                {initialsOf(label)}
              </span>
              <span className="truncate text-xs text-neutral-500">{label}</span>
            </span>
            <button
              onClick={() => void signOutUser()}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 transition-colors"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>

          {!tavusKey && (
            <button
              onClick={() => navigate('/settings')}
              className="mt-3 w-full rounded-full border border-warning-border bg-warning-bg px-3 py-2 text-xs font-medium text-warning"
            >
              Add API Key →
            </button>
          )}
        </div>
      )}
    </header>
  )
}

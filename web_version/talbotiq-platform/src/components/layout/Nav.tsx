import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LogOut, Menu, X, Files, GitBranch, FileText, ListChecks, ListTodo,
  Workflow, // Code2 — restore alongside the commented-out Coding problems entry below
  BarChart3, UserSquare2, Settings as SettingsIcon, KeyRound,
} from 'lucide-react'
import { cn } from '@/components/ui'
import { useAppStore } from '@/store/useAppStore'
import { useAuth } from '@/features/auth/AuthProvider'
import { MimicMark } from '@/components/brand/MimicMark'
import { setWorkspaceGround, DARK_GROUND_ENABLED, useWorkspaceGround } from '@/lib/workspaceGround'

/**
 * THE SPINE — the bundle's cover, carrying its sections.
 *
 * Replaces the seven flat top tabs. That row had no hierarchy: Sessions, which
 * a recruiter opens every day, sat beside Settings, which they touch once a
 * quarter. The spine groups the same seven destinations by how often they are
 * needed, so the daily work is at the top of the eye's travel and configuration
 * is at the bottom where it belongs.
 *
 * Ink ground, because a bundle has a cover and the pages do not. The active
 * section is marked the way a tab is seated: a registrar-ink edge and a lifted
 * ground, never a filled pill.
 *
 * Below `md` a spine cannot show, so it collapses into a disclosure holding
 * every destination plus identity, sign-out and the API-key prompt — the same
 * completeness rule the previous nav established, kept.
 */

function initialsOf(label: string): string {
  const parts = label.split(/[\s@._-]+/).filter(Boolean).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || 'U'
}

interface Dest { to: string; label: string; icon: typeof Files }
interface Group { label: string; items: Dest[] }

// Ordered by frequency of use, not by feature parity. In Mimic's IA candidate
// results live inside Sessions → View report, and the avatar interview room
// launches from Avatar studio, so /interview and /results stay routable without
// being sections of the bundle.
const GROUPS: Group[] = [
  {
    label: 'The record',
    items: [
      { to: '/sessions',  label: 'Sessions',  icon: Files },
      { to: '/pipelines', label: 'Pipelines', icon: GitBranch },
      { to: '/candidates/role-pipelines', label: 'Role pipelines', icon: Workflow },
    ],
  },
  {
    label: 'The standard',
    items: [
      { to: '/templates',     label: 'Templates',     icon: FileText },
      { to: '/question-sets', label: 'Question sets', icon: ListChecks },
      { to: '/mcq-sets', label: 'Assessments', icon: ListTodo },
      /* ── Coding interviews are switched off in the web app ────────────────
         Commented out rather than deleted, so turning the feature back on is
         this line plus the route in App.tsx and the `coding` entry in
         InviteWizard's MODES. `ALL` below feeds the command palette from this
         same array, so hiding it here hides it there too.

         Beside Assessments rather than under Configuration: a coding problem is
         a thing a candidate is set, like a paper, not a setting.
      { to: '/coding-problems', label: 'Coding problems', icon: Code2 },
      */
      { to: '/essay-prompts', label: 'Essay questions', icon: FileText },
    ],
  },
  {
    label: 'Findings',
    items: [
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { to: '/setup',    label: 'Avatar studio', icon: UserSquare2 },
      { to: '/settings', label: 'Settings',      icon: SettingsIcon },
    ],
  },
]
const ALL: Dest[] = GROUPS.flatMap((g) => g.items)

/* The chevron mark, on ink — a confirmed brand asset — used to be inlined here
   as a local `Mark` component. It has been REMOVED: the shared
   `MimicMark` above is the single source for it and is what this spine renders.
   Git history has the inline version. */

/**
 * The ground switch — the workspace read in the ROOM (dark) or on the RECORD
 * (light). Product vocabulary rather than a sun/moon glyph, because the two
 * grounds are named concepts here, not generic themes. Lives in the spine's
 * footer with the other secondary signals; the spine itself is the bundle's
 * ink cover and does not change with the ground.
 */
/* LIGHT AND DARK, not "room" and "record".
   The previous labels were the product's own words for the two grounds, and the
   comment defending them was right that both are real vocabulary — but they were
   the only control in the app that used it, and the word for the value is not the
   word for the choice. The same switch now exists on the entry screen and in the
   candidate header, and the first-run picker offers the two by these names, so a
   spine that says "record" is the one place the same control disagrees with
   itself. The ground names are unchanged everywhere they matter: in the store, in
   `data-ground`, in the token layer and in every comment about them. */
function GroundSwitch({ compact = false }: { compact?: boolean }) {
  // DARK-OFF: nothing to switch between while the dark ground is off.
  const ground = useWorkspaceGround()
  if (!DARK_GROUND_ENABLED) return null
  return (
    <div
      role="group"
      aria-label="Workspace ground"
      className={cn(
        'grid grid-cols-1 xl:grid-cols-2 rounded-md border border-brand-border bg-brand-black p-0.5',
        compact ? 'w-full' : '',
      )}
    >
      {([['room', 'Dark'], ['record', 'Light']] as const).map(([g, label]) => (
        <button
          key={g}
          onClick={() => setWorkspaceGround(g)}
          aria-pressed={ground === g}
          className={cn(
            // Tighter in the collapsed rail: two words have to fit a 48px inner
            // width there, and neither can be abbreviated away.
            'min-h-[28px] xl:min-h-[30px] rounded-[4px] px-0.5 xl:px-2 text-[10px] xl:text-[11px] font-semibold transition-colors duration-150',
            ground === g
              ? 'bg-brand-card text-brand-gold-light'
              : 'text-brand-gray hover:text-brand-gold-light',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function itemClass(isActive: boolean) {
  return cn(
    'group relative flex items-center gap-2.5 rounded-md py-2 text-sm transition-colors duration-150',
    // Collapsed, the row is a centred glyph; at lg it becomes a labelled row.
    'justify-center px-2 xl:justify-start xl:pl-3 xl:pr-2.5',
    // The seated-tab mark: an accent edge and a lifted ground.
    isActive
      ? 'bg-brand-card text-brand-gold-light font-semibold before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-brand-gold'
      : 'text-brand-gray hover:text-brand-gold-light hover:bg-brand-card/60 font-medium',
  )
}

export function Nav() {
  const { interviewActive, tavusConfigured } = useAppStore()
  const { user, signOutUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const label = user?.displayName || user?.email || ''

  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const liveMark = interviewActive && (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-green-light">
      <span className="live-dot" aria-hidden="true" /> Live
    </span>
  )

  return (
    <>
      {/* ── Desktop: the spine ──────────────────────────────────────────── */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-40 w-spine-collapsed xl:w-spine flex-col bg-brand-black border-r border-brand-border">
        <div className="flex items-center justify-center xl:justify-start gap-2.5 px-3 xl:px-4 h-[60px] flex-shrink-0">
          <button
            onClick={() => navigate('/sessions')}
            className="flex items-center gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold rounded-md"
            aria-label="Mimic home"
          >
            <MimicMark size="md" tone="plain" className="border border-brand-border bg-brand-card text-brand-gold-light" />
            <span className="hidden xl:inline font-display text-[19px] font-bold tracking-[-0.03em] text-white">Mimic</span>
          </button>
        </div>

        {/* ACCOUNT — at the TOP, deliberately.
            This lived in the spine's footer, pinned to the bottom edge of the
            viewport. That is too fragile for the only way out of the app: any
            condition that clips the bottom edge — a window taller than the
            screen, browser zoom, mobile chrome — hid it completely, and it was
            reported missing twice for exactly that reason. At the top it cannot
            be clipped, and it is where sidebar products put account anyway. */}
        <div className="flex-shrink-0 border-y border-brand-border px-2 xl:px-2.5 py-2.5">
          <div className="flex items-center justify-center xl:justify-start gap-2.5 xl:px-1 pb-2" title={label}>
            <span
              aria-hidden="true"
              className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md border border-brand-border bg-brand-card text-[10px] font-bold text-brand-gold-light"
            >
              {initialsOf(label)}
            </span>
            <span className="hidden xl:block min-w-0 flex-1">
              <span className="block truncate text-xs text-brand-gold-light">{label}</span>
              {user?.admin && <span className="block text-[10px] text-brand-gray">Administrator</span>}
            </span>
          </div>
          <button
            onClick={() => void signOutUser()}
            aria-label="Sign out"
            title="Sign out"
            className="flex w-full min-h-[38px] items-center justify-center xl:justify-start gap-2.5 rounded-md px-2 xl:pl-3 xl:pr-2.5 py-2 text-sm font-medium text-brand-gray transition-colors duration-150 hover:bg-brand-card hover:text-brand-gold-light"
          >
            <LogOut size={15} strokeWidth={1.75} className="flex-shrink-0" aria-hidden="true" />
            <span className="hidden xl:inline">Sign out</span>
          </button>
        </div>

        <nav aria-label="Sections" className="flex-1 overflow-y-auto px-2 xl:px-2.5 pb-3">
          {GROUPS.map((g, gi) => (
            <div key={g.label} className="mb-3 xl:mb-5 last:mb-0">
              {/* Collapsed, a group heading has nowhere to go — 4rem cannot hold
                  "Configuration". It becomes a hairline instead, so the grouping
                  the spine is built on survives as rhythm rather than vanishing.
                  Not before the first group: a rule under the account block
                  would read as a double border. */}
              <p className="hidden xl:block px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.13em] text-brand-gray/70">
                {g.label}
              </p>
              {gi > 0 && <div aria-hidden="true" className="xl:hidden mx-2 mb-2 h-px bg-brand-border" />}
              <div className="flex flex-col gap-0.5">
                {g.items.map((d) => (
                  <NavLink
                    key={d.to}
                    to={d.to}
                    /* The label is the accessible name at every width; `title`
                       is what gives a sighted pointer user the same word while
                       the rail is collapsed. */
                    title={d.label}
                    className={({ isActive }) => itemClass(isActive)}
                  >
                    <d.icon size={15} strokeWidth={1.75} className="flex-shrink-0" aria-hidden="true" />
                    <span className="hidden xl:inline">{d.label}</span>
                    <span className="sr-only xl:hidden">{d.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer now holds only secondary signals. Nothing essential lives at
            the bottom edge, because the bottom edge is the first thing a short
            viewport loses. */}
        <div className="flex-shrink-0 border-t border-brand-border p-2 xl:p-2.5 space-y-2">
          {liveMark && <div className="hidden xl:block px-1">{liveMark}</div>}

          {!tavusConfigured && (
            <button
              onClick={() => navigate('/settings')}
              title="Add an API key"
              className="flex w-full items-center justify-center xl:justify-start gap-2 rounded-md border border-warning/35 bg-warning/10 px-2 xl:px-2.5 py-1.5 text-left text-xs font-medium text-warning transition-colors hover:bg-warning/15"
            >
              <KeyRound size={13} strokeWidth={2} className="flex-shrink-0" aria-hidden="true" />
              <span className="hidden xl:inline">Add an API key</span>
            </button>
          )}

          <GroundSwitch compact />
        </div>
      </aside>

      {/* ── Mobile: cover bar + disclosure ──────────────────────────────── */}
      <header className="md:hidden sticky top-0 z-40 bg-brand-black border-b border-brand-border">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <button
            onClick={() => navigate('/sessions')}
            className="flex items-center gap-2.5 focus:outline-none"
            aria-label="Mimic home"
          >
            <MimicMark size="md" tone="plain" className="border border-brand-border bg-brand-card text-brand-gold-light" />
            <span className="font-display text-[18px] font-bold tracking-[-0.03em] text-white">Mimic</span>
          </button>
          <div className="flex items-center gap-2">
            {liveMark}
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="mimic-mobile-menu"
              className="flex h-10 w-10 items-center justify-center rounded-md text-brand-gold-light transition-colors hover:bg-brand-card"
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div id="mimic-mobile-menu" className="border-t border-brand-border px-3 py-3 animate-slide-up">
            <nav aria-label="Sections">
              {GROUPS.map((g) => (
                <div key={g.label} className="mb-4 last:mb-0">
                  <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.13em] text-brand-gray/70">
                    {g.label}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {g.items.map((d) => (
                      <NavLink key={d.to} to={d.to} className={({ isActive }) => cn(itemClass(isActive), 'min-h-[44px]')}>
                        <d.icon size={16} strokeWidth={1.75} className="flex-shrink-0" aria-hidden="true" />
                        {d.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </nav>

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-brand-border pt-3">
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md border border-brand-border bg-brand-card text-[11px] font-bold text-brand-gold-light"
                >
                  {initialsOf(label)}
                </span>
                <span className="truncate text-xs text-brand-gray">{label}</span>
              </span>
              <button
                onClick={() => void signOutUser()}
                className="inline-flex min-h-[44px] flex-shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-brand-gold-light transition-colors hover:bg-brand-card"
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>

            {!tavusConfigured && (
              <button
                onClick={() => navigate('/settings')}
                className="mt-3 flex min-h-[44px] w-full items-center gap-2 rounded-md border border-warning/35 bg-warning/10 px-3 text-xs font-medium text-warning"
              >
                <KeyRound size={14} strokeWidth={2} aria-hidden="true" /> Add an API key
              </button>
            )}

            <div className="mt-3">
              <GroundSwitch compact />
            </div>
          </div>
        )}
      </header>
    </>
  )
}

/** The seven destinations, for any surface that needs to enumerate them. */
export const NAV_DESTINATIONS = ALL

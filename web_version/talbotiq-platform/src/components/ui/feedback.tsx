import React from 'react'
import { AlertTriangle, Inbox, Sparkles } from 'lucide-react'
import { cn } from './cn'
import { Button } from './primitives'
import { status as STATUS, type StatusKey } from '@/design/tokens'

/**
 * MIMIC — status, empty, loading and error states.
 *
 * The binding rule of this file: **colour is never the only carrier of meaning.**
 *
 * Every status in the product is expressed three ways at once — a colour, a
 * glyph, and a word. That is not only a colour-vision accommodation, though it
 * is that. It is also what makes a status survive the places colour does not go:
 * a printed report, a PDF export, a plain-text notification email, a screen
 * reader, a monochrome projector in a hiring review meeting.
 *
 * The second rule: **an error is never rendered as an empty state.** "No results"
 * and "we could not load your results" are opposite facts, and showing the first
 * when the second is true tells a recruiter they have no candidates.
 */

/* ═══ Badge ════════════════════════════════════════════════════════════════ */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'intel' | 'live'

export function Badge({
  children, variant = 'neutral', icon, className,
}: {
  children: React.ReactNode
  variant?: BadgeVariant
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <span className={cn('badge', `badge-${variant}`, className)}>
      {icon && <span className="flex-shrink-0" aria-hidden="true">{icon}</span>}
      {children}
    </span>
  )
}

/* ═══ StatusMark ═══════════════════════════════════════════════════════════
   The colour-safe status primitive. Prefer this over `Badge` anywhere the value
   is a *state* rather than a label — a session's outcome, a service's health, a
   check's result.

   `dense` drops to glyph-plus-colour for a table cell where a full word will not
   fit — but the word still reaches assistive technology through the label, and
   the column header names the dimension, so the meaning is never lost. */

export function StatusMark({
  kind, label, dense, className,
}: {
  kind: StatusKey
  /** Overrides the default word. The word is what makes this colour-safe. */
  label?: string
  dense?: boolean
  className?: string
}) {
  const s = STATUS[kind]
  const word = label ?? s.word

  const tone: Record<StatusKey, string> = {
    ok:      'text-ok bg-ok-bg border-ok-rule',
    warn:    'text-warn bg-warn-bg border-warn-rule',
    risk:    'text-risk bg-risk-bg border-risk-rule',
    neutral: 'text-ink-body bg-surface-hover border-rule',
    live:    'text-live bg-live-bg border-live-bg',
    intel:   'text-intel bg-intel-bg border-intel-bg',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5',
        'text-2xs font-semibold leading-[1.35]',
        tone[kind],
        className,
      )}
    >
      <span className="font-mono leading-none" aria-hidden="true">{s.glyph}</span>
      {dense ? <span className="sr-only">{word}</span> : word}
    </span>
  )
}

/* ═══ Skeleton ═════════════════════════════════════════════════════════════
   Shaped like the content it replaces, never a spinner, and never taller or
   shorter than the real thing — a skeleton whose height differs from the loaded
   content makes the page jump, which is worse than no skeleton at all.

   The block was a whole-element opacity pulse. A pulse says "this is switched
   off"; a sweep says "this is arriving", which is the actual fact. The sweep is
   a single translated gradient — transform only, so a table of forty of them
   costs one composited layer each and nothing on the main thread.

   The sweep colour is INK at 8%, not a lighter grey. That is what lets one
   declaration be right on both grounds: on paper the ink darkens the block as it
   passes, in a room the ink is near-white so the same rule lightens it. A
   hard-coded highlight would be a white smear on near-black. */

/* Kept out of the class string deliberately: an arbitrary Tailwind value
   containing a nested `color-mix()` is exactly the kind of string that survives
   review and then silently fails to generate. */
const SKELETON_SWEEP: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--ink) 8%, transparent) 50%, transparent 100%)',
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      style={style}
      className={cn('relative overflow-hidden rounded-sm bg-surface-hover', className)}
    >
      {/* Under `prefers-reduced-motion` the global policy in index.css collapses
          every animation to 0.01ms with a single iteration, so the sweep runs
          off the right edge once and is never seen again — the block resolves to
          its static ground. Nothing here needs a second reduced-motion branch,
          because the whole effect is carried by `animation`. */}
      <span className="absolute inset-0 animate-sheen" style={SKELETON_SWEEP} />
    </div>
  )
}

/**
 * The loading state for a record index: ruled rows at the real 52px row height,
 * so the page does not reflow when the data lands.
 */
export function RecordRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading records" className={cn('divide-y divide-rule', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-[52px] items-center gap-4 px-4">
          <Skeleton className="h-3 w-3 flex-shrink-0" />
          <Skeleton className="h-3" style={{ width: `${28 - (i % 3) * 5}%` }} />
          <Skeleton className="ml-auto h-3 w-20" />
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  )
}

/** A skeleton grid for card layouts — templates, replicas, personas. */
export function RecordCards({ cards = 6, className }: { cards?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3', className)}
    >
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="card p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-4 w-3/4" />
          <Skeleton className="mt-2 h-3 w-1/2" />
          <div className="mt-5 flex gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-14" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ═══ Vacant-state composition ═════════════════════════════════════════════
   Three states share one composition, because they are the same object seen
   three ways: a region that has nothing in it and a reason why.

   What makes the arrangement read as composed rather than as a centred stack of
   leftovers is the key light. A vacant region is the one place on a page with no
   subject, so the light is what supplies one: a single soft pool behind the
   plate, drawn from the halo token, which exists at 8–11% alpha and therefore
   can never carry meaning or need a contrast gate. One light, one region — the
   same rule the sign-in card and the AI presence follow.

   The plate itself is a filed object: squared, ruled, sunk below the surface it
   sits on, with the ground's own elevation on it (an offset shadow on paper, a
   light-catching top hairline in a room). */

function StateKeylight() {
  return (
    <span
      aria-hidden="true"
      // -z-10 inside the state's own stacking context (`isolate` on the root),
      // so the wash sits under the plate and the type without escaping behind
      // whatever the state is rendered into.
      className="keylight-accent pointer-events-none absolute inset-0 -z-10"
      style={{ '--key-y': '30%' } as React.CSSProperties}
    />
  )
}

function StatePlate({ tone = 'neutral', children }: { tone?: 'neutral' | 'risk'; children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md border shadow-xs',
        // The glyph is normalised here rather than at each call site, so the
        // three states cannot drift to three different icon sizes.
        '[&_svg]:h-5 [&_svg]:w-5',
        tone === 'risk'
          ? 'border-risk-rule bg-risk-bg text-risk'
          : 'border-rule bg-surface-sunk text-ink-muted',
      )}
    >
      {children}
    </span>
  )
}

/** Title and description set to one rhythm across all three states. */
function StateCopy({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="max-w-md">
      <p className="font-display text-base font-bold tracking-[-0.012em] text-ink">{title}</p>
      {children && (
        <p className="mx-auto mt-2 text-sm leading-relaxed text-pretty text-ink-muted">{children}</p>
      )}
    </div>
  )
}

/* ═══ EmptyState ═══════════════════════════════════════════════════════════ */

export function EmptyState({
  icon, title, description, action, secondaryAction, className,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  secondaryAction?: React.ReactNode
  className?: string
}) {
  return (
    // An empty section of the bundle: the tab is there, the pages are not.
    <div className={cn('relative isolate flex flex-col items-center justify-center gap-5 px-6 py-16 text-center', className)}>
      <StateKeylight />
      <StatePlate>{icon ?? <Inbox strokeWidth={1.75} />}</StatePlate>
      <StateCopy title={title}>{description}</StateCopy>
      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}

/**
 * The state for a filter that matched nothing.
 *
 * Deliberately distinct from `EmptyState`: "you have no sessions" and "no
 * session matches these four filters" call for opposite actions, and collapsing
 * them into one screen is how a recruiter concludes their data is missing.
 */
export function NoResultsState({ query, onClear, className }: { query?: string; onClear?: () => void; className?: string }) {
  return (
    <div className={cn('relative isolate flex flex-col items-center justify-center gap-5 px-6 py-14 text-center', className)}>
      <StateKeylight />
      <StatePlate><Inbox strokeWidth={1.75} /></StatePlate>
      <StateCopy title="No matches">
        {query
          ? <>Nothing matches <span className="font-medium text-ink-body">“{query}”</span> with the current filters.</>
          : 'Nothing matches the current filters.'}
      </StateCopy>
      {onClear && (
        <Button variant="secondary" size="sm" onClick={onClear}>Clear filters</Button>
      )}
    </div>
  )
}

/* ═══ ErrorState ═══════════════════════════════════════════════════════════ */

export function ErrorState({
  title, detail, onRetry, className,
}: {
  title: string
  detail?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    // `role="alert"` so the failure is announced. A recruiter who cannot see the
    // screen otherwise learns nothing happened only by the absence of content.
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-5 px-6 py-16 text-center', className)}
    >
      {/* Deliberately no key light here. The halo is drawn from the accent, and
          a soft registrar-blue pool behind a failure reads as ornament on bad
          news. The seal-toned plate is the only mark this state needs. */}
      <StatePlate tone="risk"><AlertTriangle strokeWidth={1.75} /></StatePlate>
      <StateCopy title={title}>{detail}</StateCopy>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
      )}
    </div>
  )
}

/* ═══ InlineNotice ═════════════════════════════════════════════════════════
   A message attached to a region rather than to the page: a warning above a
   form, an explanation of absent data, a service-status note. */

export function InlineNotice({
  tone = 'neutral', title, children, icon, action, className,
}: {
  tone?: 'neutral' | 'info' | 'warn' | 'risk' | 'intel'
  title?: string
  children?: React.ReactNode
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const tones = {
    neutral: 'border-rule bg-surface-sunk text-ink-body',
    info:    'border-signal-soft bg-signal-soft text-signal-ink',
    warn:    'border-warn-rule bg-warn-bg text-warn',
    risk:    'border-risk-rule bg-risk-bg text-risk',
    intel:   'border-intel-bg bg-intel-bg text-intel',
  }
  const defaultIcon = tone === 'intel' ? <Sparkles size={15} strokeWidth={2} />
    : tone === 'risk' || tone === 'warn' ? <AlertTriangle size={15} strokeWidth={2} />
    : null

  return (
    <div
      role={tone === 'risk' ? 'alert' : undefined}
      className={cn('flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm', tones[tone], className)}
    >
      {(icon ?? defaultIcon) && (
        <span className="mt-px flex-shrink-0" aria-hidden="true">{icon ?? defaultIcon}</span>
      )}
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

/**
 * The marker for content a model produced.
 *
 * This exists because the report has to distinguish four different kinds of
 * claim — an AI inference, a deterministic heuristic, a signal that was not
 * available, and a human reviewer's note — and a recruiter making a hiring
 * decision is entitled to know which one they are reading.
 */
export function ProvenanceMark({
  kind, className,
}: {
  kind: 'ai' | 'heuristic' | 'unavailable' | 'human'
  className?: string
}) {
  const map = {
    ai:          { label: 'AI inference',  glyph: '◆', cls: 'text-intel bg-intel-bg border-intel-bg' },
    heuristic:   { label: 'Computed',      glyph: '∑', cls: 'text-ink-body bg-surface-hover border-rule' },
    unavailable: { label: 'Not captured',  glyph: '–', cls: 'text-ink-muted bg-surface-sunk border-rule border-dashed' },
    human:       { label: 'Reviewer note', glyph: '✎', cls: 'text-signal-ink bg-signal-soft border-signal-soft' },
  }[kind]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-2xs font-semibold',
        map.cls,
        className,
      )}
    >
      <span className="font-mono leading-none" aria-hidden="true">{map.glyph}</span>
      {map.label}
    </span>
  )
}

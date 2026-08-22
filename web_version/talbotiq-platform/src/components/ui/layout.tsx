import React from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from './cn'
import { exhibit, type TrackKey } from '@/design/tokens'

/**
 * MIMIC — page and section scaffolding.
 *
 * The audit found four different page widths (1440 / 1100 / 5xl / 2xl) and
 * exactly one page that reduced its edge padding on mobile. That is not a
 * styling defect, it is a missing primitive: every page was making a layout
 * decision that no page should be making. `Page` is that decision, made once.
 */

/* ═══ Page ═════════════════════════════════════════════════════════════════ */

export function Page({
  children, width = 'default', className, bleed,
}: {
  children: React.ReactNode
  /**
   * `default`  the workspace width — tables, boards, grids.
   * `reading`  long-form: an editor, a transcript, settings. Narrow enough to
   *            keep a readable measure instead of a 1400px line of text.
   * `full`     edge to edge. For a board that scrolls horizontally, nothing else.
   */
  width?: 'default' | 'reading' | 'full'
  /** Removes the vertical rhythm, for a page that manages its own. */
  bleed?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        width !== 'full' && 'page',
        width === 'reading' && 'page-reading',
        width === 'full' && 'w-full px-4 sm:px-6',
        !bleed && 'py-7 pb-20',
        className,
      )}
    >
      {children}
    </div>
  )
}

/* ═══ Breadcrumbs ══════════════════════════════════════════════════════════
   Rendered only where they improve orientation: a nested record (a template
   inside the library, a board inside a pipeline). A breadcrumb on a top-level
   destination is noise — the spine already says where you are. */

export function Breadcrumbs({
  items, className,
}: {
  items: { label: string; to?: string }[]
  className?: string
}) {
  if (items.length < 2) return null
  return (
    <nav aria-label="Breadcrumb" className={cn('mb-3', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-xs">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1">
              {item.to && !last ? (
                <Link
                  to={item.to}
                  className="rounded-sm text-ink-muted transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {item.label}
                </Link>
              ) : (
                <span className={last ? 'font-medium text-ink-body' : 'text-ink-muted'} aria-current={last ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
              {!last && <ChevronRight size={12} className="text-ink-faint" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/* ═══ PageHeader ═══════════════════════════════════════════════════════════ */

export function PageHeader({
  title, description, action, breadcrumbs, meta, className,
}: {
  /**
   * DEPRECATED and deliberately not rendered. An uppercase label above a
   * heading is an eyebrow — the heading already carries its own weight. Retained
   * only so the existing call sites keep typechecking; passing it is a no-op and
   * call sites should drop it as they are touched.
   */
  kicker?: string
  title: string
  description?: string
  action?: React.ReactNode
  breadcrumbs?: { label: string; to?: string }[]
  /** Status marks, counts, or timestamps that qualify the title. */
  meta?: React.ReactNode
  className?: string
}) {
  return (
    // No bottom rule. Screens in this world open onto a record whose own ink
    // cover-rule sits just below, and two horizontal rules close together read
    // as a rendering fault rather than as structure.
    <div className={cn('mb-7', className)}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {/* 22px, not 30-36. A workspace page is a place someone works all day;
              its name is wayfinding, not a cover line. The display voice keeps
              its widened character at a size that reads as confident rather than
              loud — the marketing site is where the 68px voice lives. */}
          <h1 className="font-display text-[21px] font-bold tracking-[-0.015em] text-ink sm:text-[23px]">{title}</h1>
          {description && (
            <p className="measure mt-1.5 text-sm leading-relaxed text-ink-muted">{description}</p>
          )}
          {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {action && <div className="flex flex-shrink-0 items-center gap-2">{action}</div>}
      </div>
    </div>
  )
}

/* ═══ SectionTitle ═════════════════════════════════════════════════════════ */

export function SectionTitle({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-5 flex items-center gap-3', className)}>
      <span className="section-label">{children}</span>
      <div className="h-px flex-1 bg-rule" />
      {action}
    </div>
  )
}

/* ═══ RecordSection ════════════════════════════════════════════════════════
   A section of the bundle, introduced by its ruled cover head.

   This replaces the scaffold every workspace area was built from: a tinted icon
   plate beside a bold title and a line of description, repeated down the page.
   Three things were wrong with it. The plate carried no information — the icon
   was decorative and the title already said the thing. Same-size icon-heading-
   text cards as page structure is the category's laziest arrangement. And a page
   of them has no scannable index: every section looked exactly as important as
   every other one.

   The cover head gives each section a LABEL, which is what a bundle actually
   uses to find a section, and puts status where the eye already lands — right of
   the label — instead of buried in the body.

   `tone="ink"` gives the head the full ink band, for the one section on a page
   that outranks the others. Used more than once per page it stops ranking
   anything. */

export function RecordSection({
  label, title, description, action, tone = 'rule', children, className, bodyClassName,
}: {
  label: string
  title?: string
  description?: string
  action?: React.ReactNode
  tone?: 'rule' | 'ink'
  children?: React.ReactNode
  className?: string
  /** Padding for the body. Pass `''` for a flush table or list. */
  bodyClassName?: string
}) {
  const ink = tone === 'ink'
  return (
    <section className={cn('card overflow-hidden', className)}>
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5',
          ink ? 'bg-ink' : 'record-head',
        )}
      >
        <span className={cn('section-label', ink && 'text-ink-inverse opacity-80')}>{label}</span>
        {action && <span className="flex flex-shrink-0 items-center gap-2">{action}</span>}
      </div>

      {(title || description) && (
        <div className="border-b border-rule px-4 py-3.5">
          {title && <h2 className="font-display text-[15px] font-bold text-ink">{title}</h2>}
          {description && (
            <p className={cn('measure text-xs leading-relaxed text-ink-muted', title && 'mt-1')}>
              {description}
            </p>
          )}
        </div>
      )}

      {children && <div className={bodyClassName}>{children}</div>}
    </section>
  )
}

/* ═══ Card ═════════════════════════════════════════════════════════════════ */

export function Card({
  children, className, hover, interactive, ...p
}: React.HTMLAttributes<HTMLDivElement> & {
  /** Hover elevation only: the card responds, but nothing happens on click. */
  hover?: boolean
  /**
   * The card IS the target — a template tile, a pipeline card, a link block.
   * Adds a 1px lift to `hover`'s elevation change, so the object rises off the
   * desk rather than only brightening. Default off; `hover` is unchanged.
   */
  interactive?: boolean
}) {
  return (
    <div
      className={cn(
        'card',
        (hover || interactive) && 'card-hover',
        interactive && [
          // `.card-hover` declares its own `transition` for shadow and border.
          // A bare `transition-transform` utility would REPLACE that property
          // list (utilities beat the components layer) and silently kill the
          // elevation fade, so the full list is restated here instead.
          'transition-[transform,box-shadow,border-color] duration-fast ease-out',
          // One pixel. Two is a card that jumps; the shadow is doing most of the
          // work and the lift only has to make the shadow believable.
          'motion-safe:hover:-translate-y-px',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          p.onClick && 'cursor-pointer',
        ],
        className,
      )}
      {...p}
    >
      {children}
    </div>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('divider my-5', className)} />
}

/* ═══ ExhibitTab ═══════════════════════════════════════════════════════════
   The index tab on a bundle section. The colour IS the interview format, so a
   recruiter scanning a column reads format before reading a word — and the word
   is always there too, so the colour is a second encoding rather than the only
   one. */

export type { TrackKey }

export function ExhibitTab({ track, className }: { track: string; className?: string }) {
  const e = exhibit[track as TrackKey]
  const cls = {
    chat: 'tab-chat', chatbot: 'tab-chatbot', voice: 'tab-voice',
    video_avatar: 'tab-avatar', video: 'tab-video', two_way: 'tab-twoway',
  }[track as TrackKey]
  return <span className={cn('tab', cls, className)}>{e?.label ?? track}</span>
}

/* ═══ Citation ═════════════════════════════════════════════════════════════
   The product's signature affordance. A score is never a bare number: it names
   the line of the record that produced it, and following it turns to that line.

   `label` exists because not every surface HAS a line or a count — the sessions
   index knows a record is scored but not how many lines were cited. Inventing a
   number to fill the column would be fabricating evidence, which is the one
   thing this product must never do, so the affordance stays honest: it names
   what it can and links to the record. */

export function Citation({
  line, count, label, onOpen, className,
}: {
  line?: number
  count?: number
  label?: string
  onOpen?: () => void
  className?: string
}) {
  const text = line != null ? `L${line}` : count != null ? `${count} cited` : label ?? 'no citation'
  const dead = line == null && count == null && !label

  if (dead || !onOpen) {
    return <span className={cn('cite text-ink-faint no-underline', className)}>{text}</span>
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={line != null ? `Open transcript at line ${line}` : `Open ${text}`}
      className={cn('cite rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', className)}
    >
      {text}
    </button>
  )
}

/* ═══ StatFigure ═══════════════════════════════════════════════════════════
   A ruled figure, not a metric card.

   The big-number-in-a-box tile is the category's laziest scaffold, and four in a
   row is the hero-metric template. Here a figure is set like an entry in a
   schedule: a label, a rule under it, then the value — and movement stated by a
   glyph and a word rather than only by a coloured arrow.

   The value sets in the DISPLAY voice with tabular figures, not in the mono. The
   mono is the product's measurement voice and it stays that way for scores,
   timers, IDs and gutter numbers — values read inside a line of type, where
   monospacing is the thing that keeps a column honest. A figure is not read
   inside a line; it is the object the card exists for, so it takes the widened
   editorial face and `nums` does the column-alignment job on its own. */

/** Trend is carried by a glyph FIRST and a tone second, so it survives a
 *  monochrome export, a projector and a red-green deficit. `flat` exists so a
 *  figure that has not moved says so, rather than going silent. */
const TREND: Record<'up' | 'down' | 'flat', { glyph: string; tone: string; said: string }> = {
  up:   { glyph: '▲', tone: 'text-ok',        said: 'Up' },
  down: { glyph: '▼', tone: 'text-risk',      said: 'Down' },
  flat: { glyph: '—', tone: 'text-ink-muted', said: 'Unchanged' },
}

export function StatFigure({
  label, value, unit, sub, trend, cite, className,
}: {
  label: string
  value: string | number
  /** A scale, set quieter than the value: `%`, `min`, `/100`. */
  unit?: string
  sub?: string
  trend?: 'up' | 'down' | 'flat'
  /** The evidence behind the figure. A number that cannot be traced is a claim. */
  cite?: React.ReactNode
  className?: string
}) {
  const t = trend ? TREND[trend] : null

  return (
    <div className={cn('rounded-lg border border-rule bg-surface px-4 py-3.5', className)}>
      <p className="section-label">{label}</p>
      {/* The rule the file's own description has always claimed: label ABOVE a
          rule, value below it. It is what turns four of these in a row from
          metric tiles into entries in a schedule. */}
      <div className="mt-2 h-px bg-rule" aria-hidden="true" />
      {/* The display voice, widened, at 26px — the figure is the one thing on
          the card worth setting, and `nums` keeps a row of them aligned to the
          digit, which was the whole job the mono was doing here.

          The type classes stay on the <p> itself rather than on an inner span:
          a caller that wants a bigger anchor figure overrides it with a child
          selector, and burying the size a level down would break that quietly.
          NOTE for the sessions lane — SessionsPage.tsx targets `[&>p.font-mono]`
          to reach this line; that selector now needs to be `[&>p]`. */}
      <p className="mt-2.5 font-display text-[26px] font-bold leading-none tracking-[-0.02em] nums text-ink">
        {value}
        {unit && <span className="ml-1.5 text-sm font-medium text-ink-faint">{unit}</span>}
      </p>
      {(sub || t) && (
        <p className={cn('mt-2.5 flex items-baseline gap-1.5 text-xs font-medium', t ? t.tone : 'text-ink-muted')}>
          {t && (
            <>
              {/* The glyph is redundant with the tone, which is the point: the
                  glyph survives when the colour does not, and the word behind it
                  reaches a screen reader either way. */}
              <span aria-hidden="true" className="font-mono text-[10px] leading-none">{t.glyph}</span>
              <span className="sr-only">{t.said}.</span>
            </>
          )}
          {sub && <span className="min-w-0">{sub}</span>}
        </p>
      )}
      {cite && <div className="mt-2.5">{cite}</div>}
    </div>
  )
}

/** Legacy name for `StatFigure`. `color` was always ignored — figures are ink. */
export function StatCard({ label, value, sub, trend, className }: {
  label: string; value: string | number; sub?: string; trend?: 'up' | 'down' | 'flat'
  color?: string; className?: string
}) {
  return <StatFigure label={label} value={value} sub={sub} trend={trend} className={className} />
}

/* ═══ InfoRow ══════════════════════════════════════════════════════════════ */

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-rule py-3 last:border-0">
      <span className="flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
      <span className="text-right text-sm text-ink-body">{value}</span>
    </div>
  )
}

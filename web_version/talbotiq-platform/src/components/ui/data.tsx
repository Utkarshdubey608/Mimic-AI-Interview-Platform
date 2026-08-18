import React from 'react'
import { ChevronLeft, ChevronRight, Search, X, SlidersHorizontal } from 'lucide-react'
import { cn } from './cn'
import { Button } from './primitives'

/**
 * MIMIC — data primitives: table, filter bar, pagination, toolbar.
 *
 * The audit found that only 7 files in the product used a real `<table>`; the
 * rest built tabular data out of div grids. That is not a cosmetic issue. A div
 * grid has no row or column relationship, so a screen-reader user hears a flat
 * stream of values with no way to know which candidate a score belongs to, and
 * "navigate to the next row" does not exist.
 *
 * So `Table` here is a real table element with real semantics, styled to read as
 * the record index it is: a ruled list with a seated header, not a spreadsheet.
 */

/* ═══ Toolbar ══════════════════════════════════════════════════════════════
   The command strip above a data region: search, filters, result count, batch
   actions. Sticky, because the actions that operate on a selection must remain
   reachable while scrolling the selection. */

export function Toolbar({
  children, className, sticky,
}: {
  children: React.ReactNode
  className?: string
  sticky?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 border-b border-rule bg-surface px-4 py-2.5',
        sticky && 'sticky top-0 z-sticky',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Pushes everything after it to the right edge of a Toolbar. */
export function ToolbarSpacer() {
  return <div className="flex-1" />
}

/* ═══ SearchField ══════════════════════════════════════════════════════════ */

export function SearchField({
  value, onChange, placeholder = 'Search', label, className, autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** Accessible name. Defaults to the placeholder, which is not a label. */
  label?: string
  className?: string
  autoFocus?: boolean
}) {
  const id = React.useId()
  return (
    <div className={cn('relative', className)}>
      <label htmlFor={id} className="sr-only">{label ?? placeholder}</label>
      <Search
        size={14} strokeWidth={2} aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
      />
      <input
        id={id}
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="input-base h-8 pl-8.5 pr-8 text-sm"
        style={{ paddingLeft: '2.125rem' }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X size={13} strokeWidth={2.25} />
        </button>
      )}
    </div>
  )
}

/* ═══ FilterBar ════════════════════════════════════════════════════════════
   Filters, the count they produced, and one honest way to undo them.

   The count is not decoration: it is the only thing that tells a recruiter
   whether an empty screen means "no candidates" or "four filters and no
   matches". `activeCount` drives the clear-all affordance, which appears only
   when there is something to clear. */

export function FilterBar({
  children, resultCount, totalCount, activeCount = 0, onClearAll, className,
}: {
  children: React.ReactNode
  resultCount?: number
  totalCount?: number
  activeCount?: number
  onClearAll?: () => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-2', className)}>
      <SlidersHorizontal size={14} className="flex-shrink-0 text-ink-muted" aria-hidden="true" />
      {children}

      {activeCount > 0 && onClearAll && (
        <Button variant="ghost" size="xs" onClick={onClearAll}>
          Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
        </Button>
      )}

      {resultCount != null && (
        <span className="ml-auto font-mono text-xs nums text-ink-muted" aria-live="polite">
          {totalCount != null && resultCount !== totalCount
            ? <>{resultCount.toLocaleString()} of {totalCount.toLocaleString()}</>
            : <>{resultCount.toLocaleString()} {resultCount === 1 ? 'record' : 'records'}</>}
        </span>
      )}
    </div>
  )
}

/**
 * A single filter control. A native select, so it works with a keyboard, a
 * screen reader and a phone's picker without us reimplementing any of it.
 */
export function FilterSelect({
  label, value, onChange, options, className,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  const id = React.useId()
  const active = value !== '' && value !== 'all'
  return (
    <div className={cn('relative', className)}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'h-8 cursor-pointer appearance-none rounded-md border bg-surface pl-2.5 pr-7 text-xs font-medium text-ink',
          'transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          // An active filter is marked by its border AND by showing the chosen
          // value as its own text — never by colour alone.
          active ? 'border-signal text-signal-ink' : 'border-rule-input hover:border-ink-faint',
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.value === 'all' || o.value === '' ? label : o.label}</option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted"
        width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  )
}

/* ═══ Table ════════════════════════════════════════════════════════════════
   A real `<table>`. The visual grammar is a ruled index — a seated header, 52px
   rows, a hairline between each — not a spreadsheet with vertical gridlines.

   Responsive behaviour is intentional rather than "add overflow-x and hope": the
   table scrolls horizontally inside its own container, and columns declare a
   `hideBelow` breakpoint so the least important ones drop out on a narrow
   screen instead of every column becoming unreadably thin. */

export interface Column<T> {
  key: string
  header: React.ReactNode
  /** Cell renderer. */
  cell: (row: T, index: number) => React.ReactNode
  /** `right` for any numeric column, so digits align. */
  align?: 'left' | 'right' | 'center'
  width?: string
  /** Below this breakpoint the column is not rendered at all. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
  /** Screen-reader name when `header` is a glyph or empty. */
  srHeader?: string
}

const HIDE: Record<NonNullable<Column<unknown>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
}

export function Table<T>({
  columns, rows, rowKey, onRowClick, caption, selected, className, emptyMessage,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  /** Makes rows activatable. Keyboard support is provided here, not by callers. */
  onRowClick?: (row: T) => void
  /** Describes the table for assistive technology. Visually hidden. */
  caption: string
  selected?: (row: T) => boolean
  className?: string
  emptyMessage?: React.ReactNode
}) {
  if (rows.length === 0 && emptyMessage) return <>{emptyMessage}</>

  return (
    // The scroll container, not the page. A page that scrolls sideways because
    // of one wide table is the single most common responsive failure in this
    // category.
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-rule bg-surface-sunk">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={cn(
                  'section-label whitespace-nowrap px-4 py-2.5 text-left font-bold',
                  c.align === 'right' && 'text-right',
                  c.align === 'center' && 'text-center',
                  c.hideBelow && HIDE[c.hideBelow],
                )}
              >
                {c.srHeader ? <span className="sr-only">{c.srHeader}</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isSelected = selected?.(row) ?? false
            const activate = onRowClick ? () => onRowClick(row) : undefined
            return (
              <tr
                key={rowKey(row, i)}
                // A clickable row gets real button semantics: reachable by Tab,
                // activated by Enter or Space, announced as actionable. A bare
                // onClick on <tr> is invisible to a keyboard.
                {...(activate && {
                  tabIndex: 0,
                  role: 'button',
                  onClick: activate,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() }
                  },
                })}
                aria-selected={selected ? isSelected : undefined}
                className={cn(
                  'border-b border-rule transition-colors duration-fast last:border-0',
                  activate && 'cursor-pointer hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                  isSelected && 'bg-signal-soft',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-4 py-3 align-middle text-ink-body',
                      c.align === 'right' && 'text-right',
                      c.align === 'center' && 'text-center',
                      c.hideBelow && HIDE[c.hideBelow],
                    )}
                  >
                    {c.cell(row, i)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ═══ Pagination ═══════════════════════════════════════════════════════════ */

export function Pagination({
  page, pageCount, onPage, total, pageSize, className,
}: {
  page: number
  pageCount: number
  onPage: (p: number) => void
  total?: number
  pageSize?: number
  className?: string
}) {
  if (pageCount <= 1) return null

  const from = pageSize ? (page - 1) * pageSize + 1 : null
  const to = pageSize && total ? Math.min(page * pageSize, total) : null

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex flex-wrap items-center justify-between gap-3 border-t border-rule px-4 py-3', className)}
    >
      <span className="font-mono text-xs nums text-ink-muted">
        {from && to && total
          ? <>{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</>
          : <>Page {page} of {pageCount}</>}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="secondary" size="sm" iconOnly
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          icon={<ChevronLeft size={15} />}
        />
        <span className="px-2 font-mono text-xs nums text-ink-body" aria-current="page">
          {page} / {pageCount}
        </span>
        <Button
          variant="secondary" size="sm" iconOnly
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
          icon={<ChevronRight size={15} />}
        />
      </div>
    </nav>
  )
}

/* ═══ ScoreValue ═══════════════════════════════════════════════════════════
   A score, set the one way scores are set in this product: tabular mono, with
   its scale stated. `82` alone is meaningless — `82/100` is a measurement.

   The bar is a second, faster encoding of the same number, and it is drawn in
   ink rather than in a red-amber-green ramp on purpose: a colour-coded score
   invites the reader to accept the colour's verdict instead of reading the
   evidence, which is exactly the behaviour this product exists to discourage. */

export function ScoreValue({
  value, outOf = 100, showBar, className,
}: {
  value: number | null | undefined
  outOf?: number
  showBar?: boolean
  className?: string
}) {
  if (value == null) {
    return <span className={cn('font-mono text-xs nums text-ink-faint', className)}>—</span>
  }
  const pct = Math.max(0, Math.min(100, (value / outOf) * 100))
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="font-mono text-sm font-medium nums text-ink">
        {value}
        <span className="text-ink-faint">/{outOf}</span>
      </span>
      {showBar && (
        <span className="h-1 w-12 flex-shrink-0 overflow-hidden rounded-sm bg-rule" aria-hidden="true">
          <span className="block h-full bg-ink" style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  )
}

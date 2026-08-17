import React from 'react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { AlertCircle } from 'lucide-react'

export const cn = (...c: Parameters<typeof clsx>) => twMerge(clsx(c))

/* ─── Button ─────────────────────────────────────────────────────────────── */
interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'mint'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
}
export function Button({ variant = 'primary', size = 'md', loading, icon, children, className, disabled, ...p }: BtnProps) {
  // Squared controls. The pill shape was the inherited brand's signature and
  // left with it — a bundle is filed with squared tabs and stamped boxes, and a
  // fully-rounded control reads as a different product entirely.
  const base = [
    'inline-flex items-center justify-center gap-2 font-semibold rounded-md',
    'transition-[background-color,border-color,box-shadow,color] duration-150 ease-record',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
    'select-none whitespace-nowrap',
  ].join(' ')

  const variants = {
    // Registrar ink — the authority action.
    // Ink, not the tint: in this product green already means 'passed', and an
    // action must never read as a verdict. Weight marks the action.
    primary:  'bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-900 shadow-sm hover:shadow-md',
    secondary:'bg-white text-neutral-800 border border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50 active:bg-neutral-100',
    ghost:    'bg-transparent text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200',
    danger:   'bg-white text-danger border border-danger-border hover:bg-danger-bg active:bg-danger-bg',
    outline:  'bg-transparent text-primary-700 border border-primary-700 hover:bg-primary-50 active:bg-primary-100',
    // Legacy name. The hero action is now ink-on-ink: the bundle cover itself.
    mint:     'bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-900 shadow-sm hover:shadow-md',
  }
  const sizes = {
    xs: 'h-7 px-2.5 text-xs',
    sm: 'h-8 px-3 text-xs',
    md: 'h-9 px-4 text-sm',
    lg: 'h-11 px-6 text-base',
  }

  return (
    <button {...p} disabled={disabled || loading} className={cn(base, variants[variant], sizes[size], className)}>
      {loading
        ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
        : icon && <span className="flex-shrink-0">{icon}</span>
      }
      {children}
    </button>
  )
}

/* ─── Input ──────────────────────────────────────────────────────────────── */
interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string; hint?: string; error?: string
  suffix?: React.ReactNode; prefix?: React.ReactNode
}
export function Input({ label, hint, error, suffix, prefix, className, id, ...p }: InputProps) {
  const iid = id ?? label?.toLowerCase().replace(/\W+/g, '-')
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={iid} className="field-label">{label}</label>}
      <div className="relative">
        {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none">{prefix}</span>}
        <input
          id={iid}
          className={cn(
            'input-base',
            prefix && 'pl-9',
            suffix && 'pr-9',
            error && '!border-danger !ring-0 focus:!ring-2 focus:!ring-danger/20',
            className,
          )}
          {...p}
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400">{suffix}</span>}
      </div>
      {hint && !error && <p className="text-xs text-neutral-400">{hint}</p>}
      {error && <p className="text-xs text-danger flex items-start gap-1.5"><AlertCircle size={13} strokeWidth={2} className="mt-px flex-shrink-0" aria-hidden="true" />{error}</p>}
    </div>
  )
}

/* ─── Textarea ───────────────────────────────────────────────────────────── */
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string; hint?: string; error?: string; charLimit?: number
}
export function Textarea({ label, hint, error, charLimit, className, value, ...p }: TextareaProps) {
  const len = typeof value === 'string' ? value.length : 0
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <div className="flex items-center justify-between">
          <label className="field-label">{label}</label>
          {charLimit && <span className={cn('text-xs font-mono tabular-nums', len > charLimit * 0.9 ? 'text-danger' : 'text-neutral-400')}>{len.toLocaleString()}/{charLimit.toLocaleString()}</span>}
        </div>
      )}
      <textarea
        value={value}
        className={cn('textarea-base', error && '!border-danger', className)}
        {...p}
      />
      {hint && !error && <p className="text-xs text-neutral-400">{hint}</p>}
      {error && <p className="text-xs text-danger flex items-start gap-1.5"><AlertCircle size={13} strokeWidth={2} className="mt-px flex-shrink-0" aria-hidden="true" />{error}</p>}
    </div>
  )
}

/* ─── Select ─────────────────────────────────────────────────────────────── */
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string; hint?: string; error?: string
  options: { value: string; label: string }[]
}
export function Select({ label, hint, error, options, className, ...p }: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="field-label">{label}</label>}
      <div className="relative">
        <select
          className={cn('input-base appearance-none pr-8 cursor-pointer', error && '!border-danger', className)}
          {...p}
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      {hint && <p className="text-xs text-neutral-400">{hint}</p>}
      {error && <p className="text-xs text-danger flex items-start gap-1.5"><AlertCircle size={13} strokeWidth={2} className="mt-px flex-shrink-0" aria-hidden="true" />{error}</p>}
    </div>
  )
}

/* ─── Toggle ─────────────────────────────────────────────────────────────── */
interface ToggleProps { checked: boolean; onChange: (v: boolean) => void; label?: string; description?: string }
export function Toggle({ checked, onChange, label, description }: ToggleProps) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      {(label || description) && (
        <div className="flex-1 min-w-0">
          {label && <p className="text-sm font-medium text-neutral-800 leading-tight">{label}</p>}
          {description && <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">{description}</p>}
        </div>
      )}
      <button
        type="button" role="switch" aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative flex-shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-1', checked ? 'bg-primary-700' : 'bg-neutral-200')}
      >
        <span className={cn('absolute top-[3px] w-4 h-4 bg-white rounded-full shadow-sm transition-all duration-200', checked ? 'left-[22px]' : 'left-[3px]')} />
      </button>
    </div>
  )
}

/* ─── Slider ─────────────────────────────────────────────────────────────── */
interface SliderProps {
  value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number
  label?: string; hint?: string; formatValue?: (v: number) => string
}
export function Slider({ value, onChange, min = 0, max = 1, step = 0.01, label, hint, formatValue }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <div className="flex items-center justify-between">
          <span className="field-label">{label}</span>
          <span className="text-xs font-semibold font-mono text-neutral-900 tabular-nums">
            {formatValue ? formatValue(value) : value.toFixed(2)}
          </span>
        </div>
      )}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-[3px] rounded-sm appearance-none cursor-pointer"
        style={{ background: `linear-gradient(to right, #0E1420 0%, #0E1420 ${pct}%, #E7E7EA ${pct}%, #E7E7EA 100%)` }}
      />
      {hint && <p className="text-xs text-neutral-400">{hint}</p>}
    </div>
  )
}

/* ─── Badge ──────────────────────────────────────────────────────────────── */
interface BadgeProps { children: React.ReactNode; variant?: 'success' | 'warning' | 'danger' | 'neutral' | 'info'; className?: string }
export function Badge({ children, variant = 'neutral', className }: BadgeProps) {
  return <span className={cn('badge', `badge-${variant}`, className)}>{children}</span>
}

/* ─── Card ───────────────────────────────────────────────────────────────── */
export function Card({ children, className, hover, ...p }: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return <div className={cn('card', hover && 'card-hover', className)} {...p}>{children}</div>
}

/* ─── SectionTitle ───────────────────────────────────────────────────────── */
export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 mb-5', className)}>
      <span className="section-label">{children}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

/* ─── PageHeader ─────────────────────────────────────────────────────────── */
/**
 * The cover line of a record: a rule, the title, and the actions that operate
 * on it.
 *
 * `kicker` is DEPRECATED and deliberately not rendered. An uppercase label
 * above a heading is an eyebrow — the one pattern no brief earns back, because
 * the heading already carries its own weight. The prop is retained only so the
 * ~40 existing call sites keep typechecking; passing it is a no-op, and call
 * sites should drop it as they are touched. Do not reintroduce the render.
 */
export function PageHeader({ title, description, action }: { kicker?: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    // No bottom rule here. Screens in this world open onto a record whose own
    // ink cover-rule sits ~25px below, and two horizontal rules that close
    // together read as a rendering fault rather than as structure. The record's
    // rule is the distinctive one, so it is the one that survives.
    <div className="mb-7">
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-[30px] sm:text-4xl font-bold text-neutral-900">{title}</h1>
          {description && <p className="text-neutral-500 mt-2 text-sm measure leading-relaxed">{description}</p>}
        </div>
        {action && <div className="flex-shrink-0 flex items-center gap-2">{action}</div>}
      </div>
    </div>
  )
}

/* ─── RecordSection ──────────────────────────────────────────────────────────
   A section of the bundle, introduced by its ruled cover head.

   Replaces the scaffold every workspace area was built from: a 9x9 tinted icon
   plate beside a bold title and a line of description, repeated down the page.
   Three things were wrong with it. The plate carried no information — the icon
   was decorative and the title already said the thing. Same-size icon+heading+
   text cards as page structure is the category's laziest arrangement. And a page
   of them has no scannable index: every section looked exactly as important as
   every other one.

   The cover head gives each section a LABEL, which is what a bundle actually
   uses to find a section, and puts status where the eye already lands (right of
   the label) instead of buried in the body. `title` is optional: a section whose
   label is sufficient does not repeat itself.

   `action` takes a status chip or a control. `tone="ink"` gives the head the
   full ink band for the one section on a page that outranks the others. */
export function RecordSection({
  label, title, description, action, tone = 'rule', children, className,
}: {
  label: string
  title?: string
  description?: string
  action?: React.ReactNode
  tone?: 'rule' | 'ink'
  children?: React.ReactNode
  className?: string
}) {
  const ink = tone === 'ink'
  return (
    <section className={cn('card overflow-hidden', className)}>
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5',
          ink ? 'bg-neutral-900' : 'record-head',
        )}
      >
        <span className={cn('section-label', ink && 'text-brand-gray')}>{label}</span>
        {action && <span className="flex flex-shrink-0 items-center gap-2">{action}</span>}
      </div>

      {(title || description) && (
        <div className="border-b border-border px-4 py-3.5">
          {title && <h2 className="font-display text-[15px] font-bold text-neutral-900">{title}</h2>}
          {description && (
            <p className={cn('text-xs leading-relaxed text-neutral-500 measure', title && 'mt-1')}>
              {description}
            </p>
          )}
        </div>
      )}

      {children}
    </section>
  )
}

/* ─── ExhibitTab ─────────────────────────────────────────────────────────────
   The index tab on a bundle section. The colour IS the interview format, so a
   recruiter scanning a column reads format before reading a word. */
export type TrackKey = 'chat' | 'chatbot' | 'voice' | 'video_avatar' | 'video' | 'two_way'
const TRACK_TAB: Record<TrackKey, { cls: string; label: string }> = {
  chat:         { cls: 'tab-chat',    label: 'Timed Q&A' },
  chatbot:      { cls: 'tab-chatbot', label: 'Conversational' },
  voice:        { cls: 'tab-voice',   label: 'Voice' },
  video_avatar: { cls: 'tab-avatar',  label: 'Avatar' },
  video:        { cls: 'tab-video',   label: 'Video' },
  two_way:      { cls: 'tab-twoway',  label: 'Two-way' },
}
export function ExhibitTab({ track, className }: { track: string; className?: string }) {
  const t = TRACK_TAB[track as TrackKey] ?? { cls: '', label: track }
  return <span className={cn('tab', t.cls, className)}>{t.label}</span>
}

/* ─── Citation ───────────────────────────────────────────────────────────────
   The signature affordance. A score is never a bare number: it names the line
   of the record that produced it, and following it turns to that line. */
export function Citation({ line, count, label, onOpen, className }: { line?: number; count?: number; label?: string; onOpen?: () => void; className?: string }) {
  // `label` exists because not every surface HAS a line or a count. The sessions
  // list, for example, knows a record is scored but not how many lines were
  // cited — and inventing a number to fill the column would be fabricating
  // evidence, which is the one thing this product must never do. So the
  // affordance stays honest: it names what it can and links to the record.
  const text = line != null ? `L${line}` : count != null ? `${count} cited` : label ?? 'no citation'
  const dead = line == null && count == null && !label
  if (dead || !onOpen) return <span className={cn('cite no-underline text-neutral-400', className)}>{text}</span>
  return <button type="button" onClick={onOpen} className={cn('cite', className)}>{text}</button>
}

/* ─── StatCard ───────────────────────────────────────────────────────────────
   A ruled figure, not a metric card.

   The big-number-in-a-box tile is the category's laziest scaffold, and four of
   them in a row is the hero-metric template. Here a figure is set like an entry
   in a schedule: label above a rule, value in tabular mono so a row of them
   aligns to the digit, movement stated in words. `color` is accepted for
   compatibility but ignored — figures are ink, and the exhibit ramp is reserved
   for encoding interview formats. */
interface StatCardProps { label: string; value: string | number; sub?: string; trend?: 'up' | 'down'; color?: string }
export function StatCard({ label, value, sub, trend }: StatCardProps) {
  return (
    <div className="bg-surface border border-border rounded-lg px-4 py-3.5">
      <p className="section-label">{label}</p>
      <p className="mt-2 font-mono nums text-[27px] leading-none font-medium text-neutral-900">{value}</p>
      {sub && (
        <p className={cn(
          'text-xs mt-2 font-medium',
          trend === 'up' ? 'text-success' : trend === 'down' ? 'text-danger' : 'text-neutral-500',
        )}>
          {sub}
        </p>
      )}
    </div>
  )
}

/* ─── Modal ──────────────────────────────────────────────────────────────── */
interface ModalProps { open: boolean; onClose: () => void; title?: string; description?: string; children: React.ReactNode; width?: string }
export function Modal({ open, onClose, title, description, children, width = 'max-w-xl' }: ModalProps) {
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) { document.addEventListener('keydown', h); document.body.style.overflow = 'hidden' }
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = '' }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-neutral-900/45 animate-fade-in" />
      {/* A record lifted off the desk: squared, with the ink rule of a cover
          sheet along its top edge. */}
      <div
        className={cn('relative w-full bg-white rounded-lg shadow-xl border border-border animate-slide-up max-h-[90vh] overflow-y-auto', width)}
        onClick={e => e.stopPropagation()}
      >
        {(title || description) && (
          <div className="px-6 pt-5 pb-4 record-head">
            <div className="flex items-start justify-between gap-4">
              <div>
                {title && <h2 className="font-display text-lg font-bold text-neutral-900">{title}</h2>}
                {description && <p className="text-sm text-neutral-500 mt-1 measure">{description}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 transition-colors flex-shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        )}
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

/* ─── JsonPreview ────────────────────────────────────────────────────────── */
export function JsonPreview({ data, title = 'Request Preview', method = 'POST', endpoint = '/v2/conversations' }: { data: unknown; title?: string; method?: string; endpoint?: string }) {
  return (
    <div className="rounded-xl overflow-hidden border border-neutral-200 font-mono text-xs">
      <div className="flex items-center justify-between px-4 py-2.5 bg-neutral-900 border-b border-neutral-700">
        <span className="text-neutral-400">{title}</span>
        <div className="flex items-center gap-2">
          <span className="bg-primary-700/20 text-primary-400 px-2 py-0.5 rounded text-[10px] font-bold">{method}</span>
          <span className="text-neutral-500 text-[10px]">tavusapi.com{endpoint}</span>
        </div>
      </div>
      <pre className="p-4 bg-neutral-950 text-emerald-400 overflow-x-auto max-h-80 leading-relaxed">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}

/* ─── EmptyState ─────────────────────────────────────────────────────────── */
export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    // An empty section of the bundle: the tab is there, the pages are not.
    <div className="flex flex-col items-center justify-center py-16 px-6 gap-4 text-center">
      {icon && (
        <div className="w-11 h-11 rounded-md bg-neutral-100 border border-border text-neutral-500 flex items-center justify-center [&_svg]:w-5 [&_svg]:h-5">
          {icon}
        </div>
      )}
      <div>
        <p className="font-display font-bold text-base text-neutral-900">{title}</p>
        {description && <p className="text-sm text-neutral-500 mt-1.5 max-w-sm mx-auto leading-relaxed">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

/* ─── Skeleton ───────────────────────────────────────────────────────────────
   Shaped like the content it replaces, never a spinner. Squared, because what
   is loading is a ruled row. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div style={style} className={cn('animate-pulse bg-neutral-100 rounded-sm', className)} />
}

/* ─── RecordRows ─────────────────────────────────────────────────────────────
   The loading state for a bundle index: ruled rows at the real row height, so
   the page does not reflow when the data lands. */
export function RecordRows({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading records" className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 h-[52px]">
          <Skeleton className="h-3 w-3 flex-shrink-0" />
          <Skeleton className="h-3" style={{ width: `${28 - (i % 3) * 5}%` }} />
          <Skeleton className="h-3 w-20 ml-auto" />
          <Skeleton className="h-3 w-10" />
        </div>
      ))}
    </div>
  )
}

/* ─── ErrorState ─────────────────────────────────────────────────────────────
   Binding rule from the design system: an error is NEVER rendered as an empty
   state. It names what failed, what it means for their data, and the recovery. */
export function ErrorState({ title, detail, onRetry }: { title: string; detail?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 gap-4 text-center">
      <div className="w-11 h-11 rounded-md bg-danger-bg border border-danger-border text-danger flex items-center justify-center">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M12 9v4M12 17h.01" /><circle cx="12" cy="12" r="9" />
        </svg>
      </div>
      <div>
        <p className="font-display font-bold text-base text-neutral-900">{title}</p>
        {detail && <p className="text-sm text-neutral-500 mt-1.5 max-w-md mx-auto leading-relaxed">{detail}</p>}
      </div>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">Try again</Button>}
    </div>
  )
}

/* ─── Divider ────────────────────────────────────────────────────────────── */
export function Divider({ className }: { className?: string }) {
  return <div className={cn('divider my-5', className)} />
}

/* ─── InfoRow (settings / detail rows) ──────────────────────────────────── */
export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-3 border-b border-border last:border-0 gap-4">
      <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide flex-shrink-0">{label}</span>
      <span className="text-sm text-neutral-800 text-right">{value}</span>
    </div>
  )
}

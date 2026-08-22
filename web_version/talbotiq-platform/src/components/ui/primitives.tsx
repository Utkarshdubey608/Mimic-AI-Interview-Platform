import React from 'react'
import { AlertCircle, Check, ChevronDown } from 'lucide-react'
import { cn } from './cn'

/**
 * MIMIC — form and action primitives.
 *
 * Every control here is ground-aware: it is built from semantic tokens
 * (`surface`, `ink`, `rule`, `signal`) rather than literal colours, so the same
 * component is correct on the light record surface and inside a dark interview
 * room without a `dark:` variant anywhere.
 *
 * Every control also has a complete state set — rest, hover, active, focus,
 * disabled, loading, and where applicable invalid — because a control that only
 * looks right at rest is the thing that makes an interface feel unfinished.
 */

/* ═══ Button ═══════════════════════════════════════════════════════════════ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'mint' | 'intel'
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: React.ReactNode
  /** Trailing icon. Use for direction (→) or disclosure, never for decoration. */
  iconRight?: React.ReactNode
  /** Icon-only. Requires `aria-label`; enforced in development. */
  iconOnly?: boolean
  /** Fills its container. Preferred over passing `w-full` so intent is explicit. */
  block?: boolean
}

const BTN_VARIANTS: Record<ButtonVariant, string> = {
  // INK — the authority action, matching the marketing site's .btn-primary.
  // One per region of a screen. It was registrar blue in a first draft; the
  // public site uses blue only for links and focus, so a blue primary button
  // made the product read as a different brand from its own home page.
  primary:
    'bg-action text-action-ink hover:bg-action-hover shadow-primary-sm hover:shadow-primary-md',
  secondary:
    'bg-surface text-ink border border-rule-input hover:border-ink-faint hover:bg-surface-hover active:bg-surface-sunk',
  ghost:
    'bg-transparent text-ink-muted hover:text-ink hover:bg-surface-hover active:bg-surface-sunk',
  danger:
    'bg-surface text-risk border border-risk-rule hover:bg-risk-bg active:bg-risk-bg',
  outline:
    'bg-transparent text-signal-ink border border-signal hover:bg-signal-soft active:bg-signal-soft',
  // Legacy name, now an alias of the ink action — the two had drifted into
  // being the same thing with different hover behaviour.
  mint:
    'bg-action text-action-ink hover:bg-action-hover shadow-sm hover:shadow-md',
  // Machine action — generate, re-score, ask the model. Marked by its label and
  // its icon rather than by a hue, since the brand has no colour to spare for it.
  intel:
    'bg-intel-bg text-intel border border-rule hover:bg-surface-hover',
}

const BTN_SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5',
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-base gap-2',
}

// Icon-only buttons must stay square, or a 9px-tall glyph sits in a 40px-wide box.
const BTN_ICON_SIZES: Record<ButtonSize, string> = {
  xs: 'h-7 w-7 p-0',
  sm: 'h-8 w-8 p-0',
  md: 'h-9 w-9 p-0',
  lg: 'h-11 w-11 p-0',
}

export function Button({
  variant = 'primary', size = 'md', loading, icon, iconRight, iconOnly, block,
  children, className, disabled, type = 'button', ...p
}: BtnProps) {
  if (import.meta.env.DEV && iconOnly && !p['aria-label'] && !p['aria-labelledby']) {
    // Loud in development, silent in production: an unlabelled icon button is
    // invisible to a screen reader, and the only reliable time to catch it is
    // while the person who wrote it is still looking at the screen.
    console.error('[Button] iconOnly requires an aria-label.', { children })
  }

  return (
    <button
      {...p}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center font-semibold rounded-md select-none whitespace-nowrap',
        'transition-[background-color,border-color,box-shadow,color,transform] duration-fast ease-out',
        // Press feedback: transform only, faster down than up, so the button
        // reads as depressed the instant the pointer commits. Gated on
        // `motion-safe` because under the reduced-motion policy `transform` is
        // dropped from the transition list — the scale would still happen, just
        // uncushioned, which is a jump rather than feedback.
        'motion-safe:active:scale-[0.985] active:duration-75',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        // Disabled is flat: no ink weight, no lift. A greyed button that still
        // casts a shadow reads as pressable.
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none disabled:shadow-none',
        BTN_VARIANTS[variant],
        iconOnly ? BTN_ICON_SIZES[size] : BTN_SIZES[size],
        // Busy is NOT disabled, even though it is implemented with the disabled
        // attribute. It is still the live control the person just pressed, so it
        // keeps its full ink; the spinner and `aria-busy` carry the state
        // instead. Without this a loading button and a dead button look the same.
        loading && 'disabled:opacity-100',
        block && 'w-full',
        className,
      )}
    >
      {loading ? (
        <span
          className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : (
        icon && <span className="flex-shrink-0" aria-hidden="true">{icon}</span>
      )}
      {children}
      {iconRight && !loading && <span className="flex-shrink-0" aria-hidden="true">{iconRight}</span>}
    </button>
  )
}

/* ═══ Field scaffolding ════════════════════════════════════════════════════
   Label, hint and error share one layout across every field type, and the wiring
   between them is done here rather than at each call site — which is what makes
   `aria-describedby` and `aria-invalid` reliable instead of occasional. */

interface FieldShellProps {
  id: string
  label?: string
  hint?: string
  error?: string
  /** Rendered right of the label — a character counter, an optional marker. */
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}

function FieldShell({ id, label, hint, error, aside, children, className }: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {(label || aside) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && <label htmlFor={id} className="field-label mb-0">{label}</label>}
          {aside}
        </div>
      )}
      {children}
      {/* The hint is hidden once there is an error: two competing lines of
          guidance under one field is worse than one clear correction. */}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-ink-muted">{hint}</p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-start gap-1.5 text-xs text-risk">
          <AlertCircle size={13} strokeWidth={2} className="mt-px flex-shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

/** Stable id from a label, so a field without an explicit id still wires up. */
function useFieldId(explicit: string | undefined, label: string | undefined) {
  const auto = React.useId()
  return explicit ?? (label ? `${label.toLowerCase().replace(/\W+/g, '-')}-${auto}` : auto)
}

function describedBy(id: string, hint?: string, error?: string) {
  const parts = [error && `${id}-error`, hint && !error && `${id}-hint`].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

/* ═══ Field validity ═══════════════════════════════════════════════════════
   Rest, hover, focus and disabled all come from `.input-base` — they are not
   duplicated here, so a change to the field language happens in one file.

   What the base class cannot know is validity, so the two verdict states are
   composed on top of it. Both are drawn the same way (border + focus ring in the
   verdict's tone) and both are paired with a glyph, because the field's own
   colour is the one thing a monochrome export, a projector or a red-green
   colour deficit will not carry. The tones resolve through `color-mix` over the
   semantic token rather than a literal rgb() so the ring is correct in the room
   as well as on the record — `--risk` is a deep red on paper and a lifted coral
   on near-black, and a hard-coded value would only ever be right on one. */
const FIELD_INVALID =
  'border-risk focus:border-risk focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--risk)_22%,transparent)]'
const FIELD_VALID =
  'border-ok focus:border-ok focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ok)_20%,transparent)]'

/** Which verdict a field is showing. `error` always wins: it is the correction. */
function verdict(error?: string, valid?: boolean) {
  if (error) return 'invalid' as const
  if (valid) return 'valid' as const
  return null
}

/* ═══ Input ════════════════════════════════════════════════════════════════ */

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string; hint?: string; error?: string
  /**
   * Marks a field as satisfied — a checked availability, a validated code. The
   * sibling of `error`, and ignored while `error` is set. Optional and
   * defaulting to off, so no existing call site changes.
   */
  valid?: boolean
  suffix?: React.ReactNode; prefix?: React.ReactNode
  /** Wrapper class. `className` goes to the input itself. */
  fieldClassName?: string
}

export function Input({
  label, hint, error, valid, suffix, prefix, className, fieldClassName, id, ...p
}: InputProps) {
  const iid = useFieldId(id, label)
  const v = verdict(error, valid)
  // The check occupies the suffix slot, so it never renders over a caller's own.
  const showCheck = v === 'valid' && !suffix

  return (
    <FieldShell id={iid} label={label} hint={hint} error={error} className={fieldClassName}>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={iid}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(iid, hint, error)}
          className={cn(
            'input-base',
            prefix && 'pl-9',
            (suffix || showCheck) && 'pr-9',
            v === 'invalid' && FIELD_INVALID,
            v === 'valid' && FIELD_VALID,
            className,
          )}
          {...p}
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">{suffix}</span>
        )}
        {showCheck && (
          <Check
            size={14} strokeWidth={2.75} aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 animate-fade-in text-ok"
          />
        )}
      </div>
    </FieldShell>
  )
}

/* ═══ Textarea ═════════════════════════════════════════════════════════════ */

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string; hint?: string; error?: string; charLimit?: number
  /** Sibling of `error`. See `Input.valid`. */
  valid?: boolean
  fieldClassName?: string
}

export function Textarea({
  label, hint, error, valid, charLimit, className, fieldClassName, value, id, ...p
}: TextareaProps) {
  const iid = useFieldId(id, label)
  const len = typeof value === 'string' ? value.length : 0
  const near = charLimit != null && len > charLimit * 0.9
  const over = charLimit != null && len > charLimit
  // Over the limit is an error the caller did not have to declare.
  const v = verdict(error || (over ? 'over' : undefined), valid)

  return (
    <FieldShell
      id={iid}
      label={label}
      hint={hint}
      error={error}
      className={fieldClassName}
      aside={
        (v === 'valid' || charLimit != null) && (
          <span className="flex items-center gap-2">
            {/* The mark sits beside the counter rather than inside the field:
                a textarea's bottom-right corner belongs to the resize grip. */}
            {v === 'valid' && (
              <Check size={13} strokeWidth={2.75} aria-hidden="true" className="animate-fade-in text-ok" />
            )}
            {charLimit != null && (
              <span
                className={cn('font-mono text-xs nums', over ? 'text-risk' : near ? 'text-warn' : 'text-ink-muted')}
                // Announced politely rather than assertively: a counter that
                // interrupts on every keystroke makes a textarea unusable with a
                // screen reader.
                aria-live="polite"
              >
                {len.toLocaleString()}/{charLimit.toLocaleString()}
              </span>
            )}
          </span>
        )
      }
    >
      <textarea
        id={iid}
        value={value}
        aria-invalid={error || over ? true : undefined}
        aria-describedby={describedBy(iid, hint, error)}
        className={cn(
          'textarea-base',
          // `.textarea-base` has no disabled rule of its own (`.input-base`
          // does), so a disabled textarea was indistinguishable from an empty
          // editable one on both grounds. Tokens, so it is correct in a room too.
          'disabled:cursor-not-allowed disabled:bg-surface-sunk disabled:text-ink-disabled',
          v === 'invalid' && FIELD_INVALID,
          v === 'valid' && FIELD_VALID,
          className,
        )}
        {...p}
      />
    </FieldShell>
  )
}

/* ═══ Select ═══════════════════════════════════════════════════════════════
   A native `<select>`, deliberately. A custom listbox would let us style the
   options, and it would also mean reimplementing typeahead, mobile pickers and
   screen-reader semantics that the platform already gets right. The chevron is
   ours; the behaviour is the browser's. */

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string; hint?: string; error?: string
  /** Sibling of `error`. See `Input.valid`. */
  valid?: boolean
  options: { value: string; label: string; disabled?: boolean }[]
  /** Leading placeholder option, rendered disabled. */
  placeholder?: string
  fieldClassName?: string
}

export function Select({
  label, hint, error, valid, options, placeholder, className, fieldClassName, id, ...p
}: SelectProps) {
  const iid = useFieldId(id, label)
  const v = verdict(error, valid)
  return (
    <FieldShell id={iid} label={label} hint={hint} error={error} className={fieldClassName}>
      <div className="relative">
        <select
          id={iid}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(iid, hint, error)}
          className={cn(
            'input-base cursor-pointer appearance-none pr-8',
            'disabled:cursor-not-allowed',
            // The check seats to the left of the chevron, so the value needs a
            // second glyph's worth of room rather than overprinting it.
            v === 'valid' && 'pr-[3.25rem]',
            v === 'invalid' && FIELD_INVALID,
            v === 'valid' && FIELD_VALID,
            className,
          )}
          {...p}
        >
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
          ))}
        </select>
        {v === 'valid' && (
          <Check
            size={14} strokeWidth={2.75} aria-hidden="true"
            className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2 animate-fade-in text-ok"
          />
        )}
        <ChevronDown
          size={14} strokeWidth={2.25} aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted"
        />
      </div>
    </FieldShell>
  )
}

/* ═══ Checkbox ═════════════════════════════════════════════════════════════
   A real input under a drawn box: the input stays in the accessibility tree and
   keeps native keyboard behaviour, while the visible mark is ours. `peer` does
   the state plumbing, so there is no React state to get out of sync. */

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: React.ReactNode
  description?: string
  error?: string
}

export function Checkbox({ label, description, error, className, id, ...p }: CheckboxProps) {
  const iid = useFieldId(id, typeof label === 'string' ? label : undefined)
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-start gap-2.5">
        <span className="relative flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center">
          <input
            id={iid}
            type="checkbox"
            aria-invalid={error ? true : undefined}
            aria-describedby={description ? `${iid}-desc` : undefined}
            className={cn(
              'peer h-[18px] w-[18px] cursor-pointer appearance-none rounded-sm border bg-surface',
              'transition-[background-color,border-color,transform] duration-fast ease-out',
              'checked:border-ink checked:bg-ink',
              // `enabled:` — a disabled box that still lights up under the
              // pointer is telling the person it will accept a click.
              'enabled:hover:border-ink-faint',
              // The box compresses under the pointer, so the hit is felt before
              // the mark appears.
              'motion-safe:enabled:active:scale-90',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
              error ? 'border-risk' : 'border-rule-input',
            )}
            {...p}
          />
          {/* The mark seats into the box rather than switching on: it scales up
              from 75% as it fades, over the same 150ms the fill takes, so the
              two read as one event. Reduced motion keeps the fade and drops the
              travel — the global policy removes `transform` from the transition
              list, so the mark simply arrives at full size. */}
          <Check
            size={13} strokeWidth={3} aria-hidden="true"
            className={cn(
              'pointer-events-none absolute scale-75 text-ink-inverse opacity-0',
              'transition-[opacity,transform] duration-fast ease-out',
              'peer-checked:scale-100 peer-checked:opacity-100',
            )}
          />
        </span>
        {label && (
          <label htmlFor={iid} className="cursor-pointer select-none text-sm leading-[18px] text-ink-body">
            {label}
          </label>
        )}
      </div>
      {description && (
        <p id={`${iid}-desc`} className="pl-[28px] text-xs leading-relaxed text-ink-muted">{description}</p>
      )}
      {error && (
        <p className="flex items-start gap-1.5 pl-[28px] text-xs text-risk">
          <AlertCircle size={13} strokeWidth={2} className="mt-px flex-shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

/* ═══ Toggle ═══════════════════════════════════════════════════════════════
   The one place the round shape is legal on a control, because a switch that is
   not a switch shape is not read as a switch. */

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
  /** `inline` drops the label block, for use inside a row that already has one. */
  inline?: boolean
}

export function Toggle({ checked, onChange, label, description, disabled, inline }: ToggleProps) {
  const id = React.useId()
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={label ? `${id}-label` : undefined}
      aria-describedby={description ? `${id}-desc` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'group relative h-[22px] w-10 flex-shrink-0 rounded-full',
        // 150ms, not 240: a switch that takes a quarter of a second to throw
        // feels like it is deciding. The track and the thumb are given the same
        // duration and the same curve so they arrive together.
        'transition-colors duration-fast ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-ink' : 'bg-rule-strong',
      )}
    >
      <span
        className={cn(
          'absolute top-[3px] h-4 w-4 rounded-full bg-surface shadow-sm',
          // transform, not `left`: animating `left` is a layout property and
          // would invalidate on every frame. The press scale composes into the
          // same transform as the travel, so the thumb compresses wherever it
          // happens to be rather than snapping back to an origin.
          'transition-transform duration-fast ease-out',
          // No `enabled:` guard needed — a disabled button never matches :active.
          'motion-safe:group-active:scale-90',
          checked ? 'translate-x-[21px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  )

  if (inline) return control

  return (
    <div className="flex items-center justify-between gap-6 py-3">
      {(label || description) && (
        <div className="min-w-0 flex-1">
          {label && (
            <p id={`${id}-label`} className="text-sm font-medium leading-tight text-ink">{label}</p>
          )}
          {description && (
            <p id={`${id}-desc`} className="mt-0.5 text-xs leading-relaxed text-ink-muted">{description}</p>
          )}
        </div>
      )}
      {control}
    </div>
  )
}

/* ═══ Slider ═══════════════════════════════════════════════════════════════ */

interface SliderProps {
  value: number
  onChange: (v: number) => void
  min?: number; max?: number; step?: number
  label?: string; hint?: string
  formatValue?: (v: number) => string
  disabled?: boolean
}

export function Slider({
  value, onChange, min = 0, max = 1, step = 0.01, label, hint, formatValue, disabled,
}: SliderProps) {
  const id = React.useId()
  const pct = ((value - min) / (max - min)) * 100
  const text = formatValue ? formatValue(value) : value.toFixed(2)

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <div className="flex items-center justify-between">
          <label htmlFor={id} className="field-label mb-0">{label}</label>
          <span className="font-mono text-xs font-semibold nums text-signal-ink">{text}</span>
        </div>
      )}
      <input
        id={id}
        type="range"
        min={min} max={max} step={step} value={value}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-valuetext={text}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          'h-[3px] w-full cursor-pointer appearance-none rounded-sm disabled:cursor-not-allowed disabled:opacity-50',
          // The thumb is the moving part, and it lives in a pseudo-element that
          // index.css draws — so its physics are declared here rather than
          // duplicating the shape. It grows under the pointer and compresses on
          // the grab, which is what makes a drag feel held rather than watched.
          // Transform only; the halo on hover is already index.css's job.
          // The pseudo-element variant is written FIRST on purpose. Tailwind
          // applies variants right-to-left, so a trailing `[&::-webkit-slider-
          // thumb]` lands BEFORE `:hover` in the compound selector and produces
          // `::-webkit-slider-thumb:hover:enabled`, which is invalid — a
          // pseudo-element has to be last. Leftmost puts it last, where it
          // belongs: `:hover:enabled::-webkit-slider-thumb`.
          '[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-fast [&::-webkit-slider-thumb]:ease-out',
          '[&::-webkit-slider-thumb]:motion-safe:enabled:hover:scale-110',
          '[&::-webkit-slider-thumb]:motion-safe:enabled:active:scale-95',
        )}
        // The filled portion is painted as a gradient stop rather than as a
        // second element, so the track cannot desynchronise from the thumb.
        style={{
          background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--rule) ${pct}%, var(--rule) 100%)`,
        }}
      />
      {hint && <p id={`${id}-hint`} className="text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}

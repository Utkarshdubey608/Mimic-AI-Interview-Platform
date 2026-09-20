import { Check } from 'lucide-react'
import { cn } from '@/components/ui'

/**
 * The recruiter wizard chrome — stepper, section heading, choice card, footer.
 *
 * Lifted out of InviteWizard when the question-set builder became a wizard too.
 * A recruiter who has sent one batch of invites already knows how a wizard in
 * this product behaves: where the step numbers are, that a choice is a card
 * with a tick in its corner, that Back is bottom-left and the primary action is
 * bottom-right. Copying that by hand into a second screen is how two flows end
 * up almost the same, which is worse than either being different on purpose.
 *
 * Both wizards import these. Neither owns them.
 */

export interface WizardStep {
  n: number
  title: string
  hint: string
}

export function WizardStepper({ steps, step }: { steps: readonly WizardStep[]; step: number }) {
  const current = steps.find((s) => s.n === step)
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-4 shadow-xs">
      <ol className="flex items-center" aria-label={`Step ${step} of ${steps.length}`}>
        {steps.map((s, i) => {
          const done = step > s.n
          const active = step === s.n
          return (
            <li key={s.n} className={cn('flex items-center', i < steps.length - 1 && 'flex-1')}>
              <div className="flex items-center gap-2.5">
                <span
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums transition-all duration-200',
                    done ? 'bg-action text-action-ink shadow-primary-sm'
                      : active ? 'bg-action text-action-ink ring-4 ring-signal shadow-primary-sm'
                      : 'border border-border bg-surface text-ink-faint',
                  )}
                >
                  {done ? <Check size={15} strokeWidth={3} /> : s.n}
                </span>
                <div className="hidden sm:block">
                  <p className={cn('whitespace-nowrap text-[13px] font-semibold leading-tight', active ? 'text-ink' : done ? 'text-ink-body' : 'text-ink-faint')}>{s.title}</p>
                  <p className="hidden whitespace-nowrap text-[11px] leading-tight text-ink-faint lg:block">{s.hint}</p>
                </div>
              </div>
              {i < steps.length - 1 && (
                <div className="mx-2.5 h-[2px] min-w-[14px] flex-1 overflow-hidden rounded-full bg-border sm:mx-3">
                  <div className={cn('h-full rounded-full bg-action transition-all duration-300', done ? 'w-full' : 'w-0')} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-xs font-medium text-ink-muted sm:hidden">
        Step <span className="tabular-nums">{step}</span> of <span className="tabular-nums">{steps.length}</span> · {current?.title}
      </p>
    </div>
  )
}

/** Section heading inside a step — generous above, tight below. */
export function StepSection({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-extrabold tracking-[-0.02em] text-ink">{title}</h2>
          {hint && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** The wizard's one selectable-card shape — used by every choice grid.
 *
 *  `walk` tags the card for the guided walkthrough's spotlight. It is a prop
 *  rather than a wrapper element at the call site because a wrapper becomes the
 *  grid item, and the card inside it then stops matching its neighbours' height. */
export function SelectCard({ selected, onClick, icon, title, blurb, walk, children }: {
  selected: boolean; onClick: () => void; icon: React.ReactNode; title: string; blurb: string
  walk?: string; children?: React.ReactNode
}) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={selected} data-walk={walk}
      className={cn(
        'relative flex h-full items-start gap-3.5 rounded-2xl border bg-surface p-4 pr-10 text-left transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2',
        selected
          ? 'border-action bg-surface-hover/40 shadow-primary-sm ring-1 ring-signal'
          : 'border-border hover:border-rule-strong hover:shadow-sm',
      )}
    >
      <span className={cn(
        'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border transition-colors duration-150',
        selected
          ? 'border-action bg-action text-action-ink'
          : 'border-border bg-surface-sunk text-ink-muted',
      )}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{blurb}</span>
        {children}
      </span>
      {selected && (
        <span className="absolute right-3.5 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-action text-action-ink">
          <Check size={12} strokeWidth={3} />
        </span>
      )}
    </button>
  )
}

/** Sticky footer row for every step: back/cancel on the left, hint + primary on the right.
 *
 *  The hint says WHY the primary is disabled, so on a phone — where there is no
 *  room for it beside the button — it wraps onto its own line rather than
 *  disappearing, which left a disabled button and no explanation. The desktop
 *  row is unchanged. */
export function StepFooter({ left, hint, right }: { left: React.ReactNode; hint?: string; right: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
      <div className="flex items-center gap-2">{left}</div>
      <div className="flex items-center gap-3">
        {hint && <p className="hidden text-xs text-ink-faint sm:block">{hint}</p>}
        {right}
      </div>
      {hint && <p className="order-last w-full text-xs text-ink-faint sm:hidden">{hint}</p>}
    </div>
  )
}

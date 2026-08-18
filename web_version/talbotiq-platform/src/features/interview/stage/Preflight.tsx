import React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check } from 'lucide-react'
import { cn } from '@/components/ui'
import { pageVariants } from '@/design/motion'

/**
 * MIMIC — the pre-flight scaffold.
 *
 * Every screen before the first question — choose a format, welcome, résumé,
 * system check — is one card in one sequence, and this is that card.
 *
 * ── Why a step meter, and why it is not a progress bar ────────────────────
 * The single most common thing a candidate wants to know before an assessment
 * is "how much of this is there". A bar answers that with a proportion; a meter
 * answers it with a LIST — and the list also says what each step is, so someone
 * on step two already knows that a system check is coming and that no question
 * has been asked yet.
 *
 * That distinction is the whole point of the pre-flight: nothing here is being
 * assessed, and the candidate should be able to tell.
 */

export type PreflightStep = 'track' | 'welcome' | 'resume' | 'systemcheck'

const STEP_LABEL: Record<PreflightStep, string> = {
  track: 'Format',
  welcome: 'How it works',
  resume: 'About you',
  systemcheck: 'Ready check',
}

/**
 * The card every pre-flight screen sits in.
 *
 * `steps` is the sequence THIS candidate will actually see, computed by the
 * caller — a fixed-format interview never shows "choose a format", and a track
 * that does not need a résumé never shows that step. Showing a step someone will
 * not reach is worse than showing no steps at all.
 */
export function PreflightCard({
  step, steps, title, description, children, footer, className,
}: {
  step: PreflightStep
  steps: PreflightStep[]
  title: string
  description?: string
  children?: React.ReactNode
  /** Actions. Kept out of the body so every screen's primary action is in the
      same place, which is what lets someone move through four screens without
      re-reading the layout each time. */
  footer?: React.ReactNode
  className?: string
}) {
  const reduce = useReducedMotion() ?? false
  const index = steps.indexOf(step)

  return (
    <motion.div
      variants={pageVariants(reduce)}
      initial="initial"
      animate="animate"
      exit="exit"
      className={cn('overflow-hidden rounded-xl border border-rule bg-surface shadow-lg', className)}
    >
      {steps.length > 1 && <StepMeter steps={steps} current={index} />}

      <div className="p-6 sm:p-8">
        <h1 className="text-balance font-display text-[26px] font-bold leading-[1.15] text-ink sm:text-[30px]">
          {title}
        </h1>
        {description && (
          <p className="measure mt-3 text-[15px] leading-relaxed text-ink-muted">{description}</p>
        )}
        {children && <div className="mt-7">{children}</div>}
      </div>

      {footer && (
        <div className="border-t border-rule bg-surface-sunk px-6 py-5 sm:px-8">{footer}</div>
      )}
    </motion.div>
  )
}

/**
 * The step sequence.
 *
 * A done step is marked with a tick AND the word "done" for assistive
 * technology; the current one is marked with `aria-current`. Neither depends on
 * the colour, which is what keeps it readable for someone who cannot separate
 * the accent from the neutral.
 */
function StepMeter({ steps, current }: { steps: PreflightStep[]; current: number }) {
  return (
    <nav aria-label="Interview setup progress" className="border-b border-rule bg-surface-sunk px-6 py-3 sm:px-8">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {steps.map((s, i) => {
          const done = i < current
          const now = i === current
          return (
            <li key={s} className="flex items-center gap-2">
              <span
                aria-current={now ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 text-2xs font-semibold',
                  now ? 'text-ink' : done ? 'text-ink-muted' : 'text-ink-faint',
                )}
              >
                <span
                  className={cn(
                    'grid h-4 w-4 flex-shrink-0 place-items-center rounded-sm border font-mono text-[9px] nums',
                    now ? 'border-ink bg-ink text-ink-inverse'
                      : done ? 'border-ink bg-surface text-ink'
                      : 'border-rule bg-surface text-ink-faint',
                  )}
                  aria-hidden="true"
                >
                  {done ? <Check size={10} strokeWidth={3} /> : i + 1}
                </span>
                {STEP_LABEL[s]}
                {done && <span className="sr-only">, done</span>}
              </span>
              {i < steps.length - 1 && (
                <span className="h-px w-4 flex-shrink-0 bg-rule" aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * A row in a list of expectations — what a format involves, what is checked
 * before starting, what the rules are.
 *
 * The icon plate is drawn in ink rather than in the tenant's accent. The accent
 * is an arbitrary tenant-supplied hex, and the previous screens built these
 * plates by concatenating alpha onto it (`accent + '14'`), which produced a
 * different, unverifiable contrast for every customer. Ink is the same
 * everywhere and it is the one value in the system guaranteed to be readable.
 */
export function ExpectationRow({
  icon, title, children,
}: {
  icon: React.ReactNode
  title?: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-3.5">
      <span
        className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-rule bg-surface-sunk text-ink-body"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0 pt-1">
        {title && <p className="text-sm font-semibold text-ink">{title}</p>}
        <p className={cn('text-sm leading-relaxed text-ink-body', title && 'mt-0.5 text-ink-muted')}>
          {children}
        </p>
      </div>
    </li>
  )
}

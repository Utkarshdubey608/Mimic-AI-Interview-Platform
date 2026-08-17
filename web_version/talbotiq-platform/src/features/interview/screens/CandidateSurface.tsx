/**
 * The candidate flow's shared visual language.
 *
 * Six interview modes reached the same three moments — a card before the
 * interview, a sign-off after it, and a status plate inside both — and each mode
 * had drawn them itself. The pre-flight card existed as five literal copies of
 * the same class string, the sign-off as four separate implementations with
 * different disc geometry, and the header as five variants that disagreed on
 * width, surface and chip. A candidate crossing from the system check into a
 * voice interview therefore crossed a visual seam that meant nothing.
 *
 * These three components are that language, written once. They are PRESENTATION
 * ONLY: no timers, no media, no lifecycle. Every stage keeps its own machinery
 * and simply stops re-drawing the frame around it.
 */
import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, AlertTriangle, ShieldCheck } from 'lucide-react'

/* ── Surface ────────────────────────────────────────────────────────────────
   One card, one entrance. `wide` is for the cards that carry a list or a video
   preview rather than a paragraph. */
export function CandidateSurface({
  children, wide, className,
}: { children: ReactNode; wide?: boolean; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      // Critically damped, no overshoot: this card is arriving, not bouncing.
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className={[
        'w-full rounded-3xl border border-border bg-white shadow-lg',
        wide ? 'max-w-2xl p-8 sm:p-10' : 'max-w-md p-10',
        className ?? '',
      ].join(' ')}
    >
      {children}
    </motion.div>
  )
}

/** Full-height ground the surface sits on, for stages that own the whole page. */
export function CandidateStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      {children}
    </div>
  )
}

/* ── Status plate ───────────────────────────────────────────────────────────
   The disc every moment opens with. One geometry — 64px plate, 26px glyph —
   instead of the 56/64/80px discs the four sign-offs each chose. Tone carries
   meaning: `neutral` for a step, `done` for a finish, `warn` for an interrupted
   one. Ink rather than a tint, because on a card this quiet ink already reads,
   and colour here would be the only saturation on the screen. */
export function StatusPlate({
  tone = 'neutral', children,
}: { tone?: 'neutral' | 'done' | 'warn'; children: ReactNode }) {
  const skin =
    tone === 'warn' ? 'border-warning-border bg-warning-bg text-warning'
    : tone === 'done' ? 'border-transparent bg-neutral-900 text-white'
    : 'border-border bg-neutral-50 text-neutral-700'
  return (
    <span
      className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border ${skin}`}
      aria-hidden
    >
      {children}
    </span>
  )
}

/* ── Sign-off ───────────────────────────────────────────────────────────────
   The last thing a candidate sees. It has to answer three questions without
   being asked: is it over, did it count, and may I leave. */
export function CandidateSignOff({
  companyName, interrupted, note,
}: { companyName: string; interrupted?: boolean; note?: string }) {
  return (
    <>
      <StatusPlate tone={interrupted ? 'warn' : 'done'}>
        {interrupted ? <AlertTriangle size={26} /> : <Check size={26} strokeWidth={2.5} />}
      </StatusPlate>

      <h1 className="mt-6 font-display text-2xl font-extrabold tracking-[-0.03em] text-neutral-900 sm:text-3xl">
        {interrupted ? 'Interview interrupted' : 'All done — thank you.'}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-balance leading-relaxed text-neutral-500">
        {interrupted
          ? `The connection dropped before the interview finished, so it ended early. Please reach out to the ${companyName} hiring team and we’ll help you complete it.`
          : note ??
            `Your responses have been submitted to the ${companyName} team. There’s nothing more you need to do — you can safely close this window.`}
      </p>

      {!interrupted && (
        <div className="mt-8 border-t border-border pt-5">
          <p className="mx-auto flex max-w-sm items-start justify-center gap-2 text-left text-xs leading-relaxed text-neutral-400">
            <ShieldCheck size={14} strokeWidth={1.75} className="mt-0.5 flex-shrink-0" />
            <span>Your answers are reviewed by the hiring team. Scores aren’t shown to candidates.</span>
          </p>
        </div>
      )}
    </>
  )
}

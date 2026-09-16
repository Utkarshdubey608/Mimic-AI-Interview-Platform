import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, Mail, ShieldCheck } from 'lucide-react'
import { cn } from '@/components/ui'
import { pageVariants } from '@/design/motion'
import { CandidateFeedback } from './CandidateFeedback'
import { ReturnToSite } from '../stage/ReturnToSite'
import type { BrandingConfig } from '@shared/types'

/**
 * The last thing a candidate sees.
 *
 * Almost every product in this category treats it as a receipt. It is worth more
 * than that: it is the only screen a rejected candidate will remember, and the
 * only impression of the employer that the product itself controls.
 *
 * ── Three things it has to do, in this order ──────────────────────────────
 *   1. CLOSE THE LOOP. Confirm the answers arrived, so nobody sits wondering
 *      whether to redo it.
 *   2. SAY WHAT HAPPENS NEXT, honestly and without over-promising. "The team
 *      will review and be in touch" is true; a timeline we cannot keep is not.
 *   3. RELEASE THEM. Say explicitly that there is nothing left to do. A
 *      candidate who is not told this will keep the tab open for a day.
 *
 * ── What it deliberately does NOT do ──────────────────────────────────────
 * No score, no percentile, no "how you did", no strengths and weaknesses. That
 * analysis exists and is on the recruiter's report, and showing any of it here
 * would be an evaluation delivered by a machine with no human in the loop and no
 * right of reply. The absence is a decision, not an omission.
 */
export function Completion({
  sessionId, accentClassName,
}: {
  branding: BrandingConfig
  sessionId?: string
  /** Overrides the checkmark and "Go to Mimic" button for one track's own
   *  branding (the chat track's Talbotiq green), leaving every other track's
   *  shared `--ink`/`--action` tokens untouched. */
  accentClassName?: string
}) {
  const reduce = useReducedMotion() ?? false
  // Set once the feedback step is answered EITHER way — sent or declined. Both
  // mean the same thing here: the candidate is finished with this page.
  const [done, setDone] = useState(false)

  return (
    // Self-contained: capped to the viewport and scrollable AS ONE UNIT
    // (title card, feedback, the "go to Mimic" bar), regardless of which
    // screen renders it or how that screen's own wrapper is sized. This used
    // to be a bare Fragment with no height of its own — on three tracks with
    // no explicit cap anywhere in the chain, the whole page just grew past
    // the viewport, and the callers that DID try to cap it were doing so one
    // layer up, which turned out not to reliably constrain content one more
    // layer down.
    <div className="max-h-[calc(100vh-6rem)] w-full overflow-y-auto">
    <motion.div
      variants={pageVariants(reduce)}
      initial="initial"
      animate="animate"
      className="overflow-hidden rounded-xl border border-rule bg-surface shadow-lg"
    >
      <div className="px-6 py-10 text-center sm:px-10 sm:py-12">
        {/* The mark. Ink rather than the tenant's accent, because the accent is
            an arbitrary hex and this is the one element on the page that must
            read as resolved on every tenant's brand. */}
        <motion.span
          className={cn(
            'mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ink text-ink-inverse',
            accentClassName,
          )}
          initial={reduce ? false : { scale: 0.86, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.08, duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
        >
          <Check size={28} strokeWidth={2.75} aria-hidden="true" />
        </motion.span>

        <h1 className="mt-6 font-display text-[28px] font-bold tracking-[-0.03em] text-ink sm:text-3xl">
          All done, thank you.
        </h1>
        <p className="measure mx-auto mt-3 text-balance leading-relaxed text-ink-muted">
          Your answers have been submitted to the hiring team. There is
          nothing else you need to do, and you can safely close this window.
        </p>
      </div>

      <div className="grid gap-px border-t border-rule bg-rule sm:grid-cols-2">
        <div className="bg-surface-sunk px-6 py-5">
          <p className="section-label">What happens next</p>
          <p className="mt-2 flex items-start gap-2.5 text-sm leading-relaxed text-ink-body">
            <Mail size={15} strokeWidth={1.75} className="mt-0.5 flex-shrink-0 text-ink-muted" aria-hidden="true" />
            <span>
              The hiring team reviews your interview and
              contacts you by email about next steps.
            </span>
          </p>
        </div>
        <div className="bg-surface-sunk px-6 py-5">
          <p className="section-label">Your responses</p>
          <p className="mt-2 flex items-start gap-2.5 text-sm leading-relaxed text-ink-body">
            <ShieldCheck size={15} strokeWidth={1.75} className="mt-0.5 flex-shrink-0 text-ink-muted" aria-hidden="true" />
            <span>
              Visible only to the hiring team. Scores and evaluation
              notes are not shown to candidates.
            </span>
          </p>
        </div>
      </div>
    </motion.div>

    {/* Feedback sits BELOW the completion card, never in front of it. The
        interview is over and submitted; this is a request, not a gate. Because
        every track now ends on this one component, adding it here gives all six
        formats the same closing step. */}
    {sessionId && <CandidateFeedback sessionId={sessionId} onResolved={() => setDone(true)} />}

    {/* And then out of the product. The candidate arrived from an emailed link
        straight into an interview, so without this the only exit is closing the
        tab.

        TWO countdowns, because the two situations are not alike. Until the
        feedback step is answered the long one runs and ANY interaction cancels
        it, so nobody is dragged away mid-sentence. Once they have sent feedback
        or declined it there is nothing left on this page to interrupt, so it
        becomes a short countdown that no longer listens for interaction — the
        interaction that would have cancelled it is the very click that finished
        the step. Remounted by `key` so the new countdown starts from full. */}
    <ReturnToSite
      key={done ? 'after-feedback' : 'initial'}
      seconds={done ? 4 : 20}
      cancellable={!done}
      accentClassName={accentClassName}
    />
    </div>
  )
}

import React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui'
import { integrityCopy } from '../integrityPolicy'
import type { PendingIntegrityNotice } from '../useIntegrityMonitor'

/**
 * MIMIC — the integrity notice.
 *
 * A full-screen, centred, blocking dialog. It replaces a corner toast, and the
 * change is deliberate on every axis:
 *
 *   IT IS IN THE MIDDLE      A candidate mid-answer does not see the corner of
 *                            their screen. This is the one message in the
 *                            interview they must not miss, because the next one
 *                            may end their interview.
 *   IT BLOCKS                They acknowledge it before continuing, so nobody
 *                            can later say they were not told.
 *   IT STATES THE COST       "You have 2 left before your interview ends
 *                            automatically" is information they can act on. A
 *                            bare "(1/3)" is a score they have to decode.
 *   IT ENDS THE INTERVIEW    On the final strike there is no continue button,
 *                            because there is nothing to continue to.
 *
 * The tone is deliberately plain rather than accusatory. Someone may have
 * switched away because a delivery arrived. The product records what happened
 * and applies the recruiter's rule; it does not editorialise about why.
 */
export function IntegrityGate({
  notice, onAcknowledge, onEnded,
}: {
  notice: PendingIntegrityNotice | null
  onAcknowledge: () => void
  /** Called once when the limit is reached, to submit and end the interview. */
  onEnded: () => void
}) {
  const reduce = useReducedMotion() ?? false
  const ref = React.useRef<HTMLDivElement>(null)
  const firedRef = React.useRef(false)
  const terminal = notice?.decision.action === 'terminate'

  // Submit exactly once, the moment the limit is reached. In an effect rather
  // than in the render path so the interview is ended by a committed state
  // change, not by a render that React is free to discard.
  React.useEffect(() => {
    if (terminal && !firedRef.current) {
      firedRef.current = true
      onEnded()
    }
  }, [terminal, onEnded])

  // Focus moves into the dialog so the acknowledgement is reachable by keyboard,
  // and Escape is deliberately NOT wired: this is the one dialog in the product
  // that must be dismissed on purpose.
  React.useEffect(() => {
    if (!notice) return
    const raf = requestAnimationFrame(() => ref.current?.focus())
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(raf)
      document.body.style.overflow = prevOverflow
    }
  }, [notice])

  if (!notice) return null
  const copy = integrityCopy(notice.kind, notice.decision)

  return (
    <div
      className="fixed inset-0 z-hud flex items-center justify-center px-5"
      // role=alertdialog: this interrupts, and it is about the user's own
      // situation rather than a piece of content they navigated to.
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="integrity-title"
      aria-describedby="integrity-body"
    >
      <div className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-sm" aria-hidden="true" />

      <motion.div
        ref={ref}
        tabIndex={-1}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-lg rounded-xl border border-rule bg-surface p-8 text-center shadow-xl outline-none sm:p-10"
      >
        <span
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full border ${
            terminal ? 'border-risk-rule bg-risk-bg text-risk' : 'border-warn-rule bg-warn-bg text-warn'
          }`}
          aria-hidden="true"
        >
          <ShieldAlert size={26} strokeWidth={1.75} />
        </span>

        <h2
          id="integrity-title"
          className="mt-5 text-balance font-display text-[24px] font-bold leading-[1.2] text-ink sm:text-[28px]"
        >
          {copy.title}
        </h2>

        <p id="integrity-body" className="measure mx-auto mt-3 text-[15px] leading-relaxed text-ink-muted">
          {copy.body}
        </p>

        {/* The count, stated as a figure as well as in the sentence above, so it
            is scannable for someone who has already read the explanation once. */}
        {notice.decision.action !== 'ignore' && (
          <p className="mt-5 font-mono text-sm nums text-ink-body">
            {notice.decision.used} of {notice.decision.max}
          </p>
        )}

        <div className="mt-7">
          <Button
            size="lg"
            block
            onClick={terminal ? undefined : onAcknowledge}
            disabled={terminal}
          >
            {copy.confirm}
          </Button>
        </div>

        {terminal && (
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            You can close this window. Your answers have been sent to the hiring team.
          </p>
        )}
      </motion.div>
    </div>
  )
}

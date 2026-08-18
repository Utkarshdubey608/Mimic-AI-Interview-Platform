import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import type { BrandingConfig } from '@shared/types'
import type { IntegrityWarning } from '../useIntegrityMonitor'

interface Props {
  warning: IntegrityWarning | null
  branding: BrandingConfig
  onAcknowledge: () => void
}

/**
 * The tab-switch warning, as a blocking centred dialog.
 *
 * It replaces a corner toast that candidates missed. Three deliberate choices:
 *
 *  * It BLOCKS. Acknowledgement is the point — a warning that scrolls past
 *    changes nothing, and the candidate should know a switch was recorded
 *    before they carry on.
 *  * It never tears anything down. Live modes (voice, avatar, two-way) keep
 *    their sockets and streams open underneath; this is an overlay, so
 *    acknowledging resumes exactly where they were rather than reconnecting.
 *  * The tone is firm, not threatening. This is a screening interview, and a
 *    candidate who glanced at another window is usually not cheating. Telling
 *    them plainly what was recorded respects them and still deters.
 */
export function IntegrityWarningModal({ warning, branding, onAcknowledge }: Props) {
  const reduce = useReducedMotion()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const open = warning !== null

  // Focus the only action, so a keyboard or screen-reader candidate lands on the
  // way out rather than having to hunt for it.
  useEffect(() => {
    if (open) buttonRef.current?.focus()
  }, [open])

  // Deliberately NO Escape-to-close: dismissing without reading is the behaviour
  // this replaced. Tab is trapped on the single button for the same reason.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault()
      if (e.key === 'Tab') { e.preventDefault(); buttonRef.current?.focus() }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open])

  if (!warning) return null

  const showCount = typeof warning.count === 'number' && warning.count > 0
  const accent = branding.accentColor

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-900/70 p-5 backdrop-blur-sm"
      data-testid="integrity-warning"
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="integrity-warning-title"
        aria-describedby="integrity-warning-body"
        initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md rounded-3xl border border-border bg-white p-8 text-center shadow-2xl"
      >
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-warning-border bg-warning-bg text-warning">
          <AlertTriangle size={22} strokeWidth={1.75} />
        </span>

        <h2
          id="integrity-warning-title"
          className="mt-5 font-display text-xl font-extrabold tracking-[-0.02em] text-balance text-neutral-900"
        >
          You left the interview tab
        </h2>

        <p id="integrity-warning-body" className="mt-2.5 text-sm leading-relaxed text-neutral-500">
          {warning.message}
        </p>

        {showCount && (
          <p className="mt-3 text-xs font-semibold text-neutral-400" data-testid="integrity-count">
            {warning.max
              ? `Recorded ${warning.count} of ${warning.max} allowed`
              : `Switches recorded: ${warning.count}`}
          </p>
        )}

        <button
          ref={buttonRef}
          onClick={onAcknowledge}
          data-testid="integrity-acknowledge"
          className="mt-7 inline-flex h-12 w-full items-center justify-center rounded-md text-base font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ background: accent }}
        >
          I understand, return to the interview
        </button>

        <p className="mt-3.5 text-xs leading-relaxed text-neutral-400">
          Your interview is still running. Nothing has been lost.
        </p>
      </motion.div>
    </div>
  )
}

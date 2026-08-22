import React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X, AlertTriangle } from 'lucide-react'
import { cn } from './cn'
import { Button } from './primitives'
import { overlayVariants, scrimVariants, drawerVariants } from '@/design/motion'

/**
 * MIMIC — overlays: modal, drawer, confirmation.
 *
 * The existing Modal closed on Escape and locked body scroll, which is the easy
 * half. This adds the half that actually determines whether a dialog is usable
 * without a mouse:
 *
 *   · focus MOVES INTO the dialog when it opens, and RETURNS to the element that
 *     opened it when it closes — otherwise a keyboard user is dropped at the top
 *     of the document every time they dismiss something
 *   · focus is TRAPPED, so Tab cannot walk into the page behind the scrim and
 *     leave the user typing into content they cannot see
 *   · `role="dialog"` + `aria-modal` + a labelled title, so assistive technology
 *     announces what opened rather than reading the page from the top
 *
 * These are not enhancements. Without them the overlay is a visual effect that
 * happens to sit above the page.
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Focus containment for an open overlay.
 *
 * Returns the ref to attach to the overlay surface. While `open`, it:
 *   1. remembers what had focus,
 *   2. moves focus to the first focusable node inside (or the surface itself),
 *   3. cycles Tab/Shift+Tab within the surface,
 *   4. restores focus on close.
 */
function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = React.useRef<HTMLDivElement>(null)
  const restoreTo = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement as HTMLElement | null

    const surface = ref.current
    // rAF, not a bare call: the surface is mounted but framer-motion has not
    // finished its first commit, and focusing a node mid-enter can be undone.
    const raf = requestAnimationFrame(() => {
      const first = surface?.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? surface)?.focus()
    })

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
      if (e.key !== 'Tab' || !surface) return

      const nodes = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((n) => n.offsetParent !== null || n === document.activeElement)
      if (nodes.length === 0) { e.preventDefault(); return }

      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement

      if (e.shiftKey && (active === first || !surface.contains(active))) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      // Only restore if focus is still somewhere in the (now unmounting)
      // overlay; if the app moved focus deliberately, leave it alone.
      restoreTo.current?.focus?.()
    }
  }, [open, onClose])

  return ref
}

/* ═══ Modal ════════════════════════════════════════════════════════════════ */

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  /** Tailwind max-width class. */
  width?: string
  /** Actions pinned to the foot, outside the scrolling body. */
  footer?: React.ReactNode
}

export function Modal({ open, onClose, title, description, children, width = 'max-w-xl', footer }: ModalProps) {
  const reduce = useReducedMotion() ?? false
  const ref = useFocusTrap(open, onClose)
  const titleId = React.useId()
  const descId = React.useId()

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4 sm:p-6">
          {/* The one place glass is earned: the dialog genuinely floats above a
              page that is still there, and a 4px blur is what says the page is
              behind it rather than switched off. On the scrim only — never on
              the surface, which has to stay a legible sheet of paper. */}
          <motion.div
            className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-sm"
            variants={scrimVariants()}
            initial="initial" animate="animate" exit="exit"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            variants={overlayVariants(reduce)}
            initial="initial" animate="animate" exit="exit"
            className={cn(
              'relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl',
              'border border-rule bg-surface shadow-xl outline-none',
              width,
            )}
          >
            {(title || description) && (
              <div className="record-head flex-shrink-0 px-6 pb-4 pt-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    {title && <h2 id={titleId} className="font-display text-lg font-bold text-ink">{title}</h2>}
                    {description && (
                      <p id={descId} className="measure mt-1 text-sm text-ink-muted">{description}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost" size="sm" iconOnly
                    aria-label="Close dialog"
                    onClick={onClose}
                    icon={<X size={16} strokeWidth={2} />}
                    className="-mr-1 -mt-1 flex-shrink-0"
                  />
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>

            {footer && (
              <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-rule bg-surface-sunk px-6 py-3.5">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/* ═══ Drawer ═══════════════════════════════════════════════════════════════
   A side panel for detail that should not cost the reader their place in the
   list. Preferred over a modal whenever the underlying list is still the
   subject — reviewing candidates one after another, inspecting a question. */

export function Drawer({
  open, onClose, title, description, children, footer, side = 'right', width = 'max-w-lg',
}: ModalProps & { side?: 'right' | 'left' }) {
  const reduce = useReducedMotion() ?? false
  const ref = useFocusTrap(open, onClose)
  const titleId = React.useId()

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-drawer flex">
          <motion.div
            className="absolute inset-0 bg-[var(--scrim)] backdrop-blur-sm"
            variants={scrimVariants()}
            initial="initial" animate="animate" exit="exit"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            variants={drawerVariants(reduce, side)}
            initial="initial" animate="animate" exit="exit"
            className={cn(
              'relative flex h-full w-full flex-col bg-surface shadow-xl outline-none',
              side === 'right' ? 'ml-auto border-l' : 'mr-auto border-r',
              'border-rule',
              width,
            )}
          >
            {(title || description) && (
              <div className="record-head flex flex-shrink-0 items-start justify-between gap-4 px-5 pb-4 pt-4">
                <div className="min-w-0">
                  {title && <h2 id={titleId} className="font-display text-base font-bold text-ink">{title}</h2>}
                  {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
                </div>
                <Button
                  variant="ghost" size="sm" iconOnly
                  aria-label="Close panel"
                  onClick={onClose}
                  icon={<X size={16} strokeWidth={2} />}
                  className="-mr-1 flex-shrink-0"
                />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
            {footer && (
              <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-rule bg-surface-sunk px-5 py-3.5">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/* ═══ ConfirmDialog ════════════════════════════════════════════════════════
   One confirmation flow for the whole product, so a destructive action never
   depends on a page having remembered to build its own.

   `requireTyping` is for the genuinely irreversible: the operator must type the
   subject's name. It is deliberately awkward — that is the feature — and it is
   reserved for actions that destroy a candidate's record or end a live session.
   Using it for ordinary deletes trains people to type through it. */

export function ConfirmDialog({
  open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', tone = 'danger',
  requireTyping, busy,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  body?: React.ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'primary'
  requireTyping?: string
  busy?: boolean
}) {
  const [typed, setTyped] = React.useState('')
  React.useEffect(() => { if (!open) setTyped('') }, [open])

  const blocked = requireTyping ? typed.trim() !== requireTyping.trim() : false

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
            disabled={blocked}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3.5">
        {tone === 'danger' && (
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-risk-rule bg-risk-bg text-risk" aria-hidden="true">
            <AlertTriangle size={17} strokeWidth={1.75} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-bold text-ink">{title}</h2>
          {body && <div className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</div>}

          {requireTyping && (
            <label className="mt-4 block">
              <span className="field-label">
                Type <span className="font-mono text-ink">{requireTyping}</span> to confirm
              </span>
              <input
                className="input-base"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}
        </div>
      </div>
    </Modal>
  )
}

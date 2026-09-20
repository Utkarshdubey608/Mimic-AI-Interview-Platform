import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, GraduationCap, List, X } from 'lucide-react'
import { cn } from '@/components/ui'

/**
 * A guided walkthrough, in the shape VS Code's "Get Started" uses.
 *
 * The thing that makes that pattern work, and that a modal tour does not: the
 * product stays usable while the tutorial is open. The panel docks in a corner,
 * the step being explained is ringed in place, and the person can stop reading
 * and try it at any point — the walkthrough does not sit on top of the screen
 * demanding to be dismissed first. So:
 *
 *   · NO SCRIM. A dimmed page says "you may not touch this", which is the
 *     opposite of what a walkthrough is for.
 *   · The ring is drawn OVER the target, not around a clone of it, and it is
 *     `pointer-events-none`, so the control underneath still takes the click.
 *   · Steps can DRIVE the host (`onEnter`) — the wizard follows along to the
 *     step being described, so the explanation and the screen always agree.
 *   · The chapter list is one click away, because somebody returning to the
 *     tutorial usually wants one specific thing, not a replay from step one.
 *
 * Whoever mounts it decides what a step does to their own UI; this component
 * knows only about reading, ringing and navigating.
 */

export interface WalkthroughStep {
  /** Stable id — used as the React key and passed back to `onEnter`. */
  id: string
  title: string
  /** The `data-walk` value of the element to ring. Omit for a step about the page as a whole. */
  target?: string
  body: React.ReactNode
  /** Short "do this" line, set apart from the explanation. */
  action?: string
}

interface Rect { top: number; left: number; width: number; height: number }

/**
 * Track a target's box on screen.
 *
 * It is re-measured on scroll and resize, and again on a slow interval, because
 * the element being ringed lives inside a wizard whose content grows and shrinks
 * as the recruiter types — a ResizeObserver on the target alone misses a card
 * above it getting taller. 400ms is invisible to a reader and costs nothing.
 */
function useTargetRect(target: string | undefined, active: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)

  const measure = useCallback(() => {
    if (!target) { setRect(null); return }
    const el = document.querySelector<HTMLElement>(`[data-walk="${target}"]`)
    if (!el) { setRect(null); return }
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) { setRect(null); return }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [target])

  useLayoutEffect(() => {
    if (!active) return
    // The target may have just been revealed by `onEnter` switching wizard step,
    // so measure after paint rather than during this commit.
    const raf = requestAnimationFrame(() => {
      const el = target ? document.querySelector<HTMLElement>(`[data-walk="${target}"]`) : null
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      measure()
    })
    const id = window.setInterval(measure, 400)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(id)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [target, active, measure])

  return rect
}

export interface WalkthroughProps {
  open: boolean
  steps: WalkthroughStep[]
  /** Called on every step entry (including the first) so the host can follow along. */
  onEnter?: (step: WalkthroughStep, index: number) => void
  /** Called when the tour is dismissed or finished — restore whatever `onEnter` moved. */
  onClose: () => void
  /** Tucked under the title, e.g. "Question sets". */
  kicker?: string
}

export function Walkthrough({ open, steps, onEnter, onClose, kicker }: WalkthroughProps) {
  const [index, setIndex] = useState(0)
  const [chapters, setChapters] = useState(false)
  const [seen, setSeen] = useState<Set<string>>(() => new Set())
  const onEnterRef = useRef(onEnter)
  onEnterRef.current = onEnter

  const step = steps[Math.min(index, steps.length - 1)]
  const rect = useTargetRect(step?.target, open)

  // Every open starts at the beginning; the chapter list is how somebody skips.
  useEffect(() => {
    if (open) { setIndex(0); setChapters(false); setSeen(new Set()) }
  }, [open])

  // Drive the host to the step being described, and remember where we've been.
  useEffect(() => {
    if (!open || !step) return
    onEnterRef.current?.(step, index)
    setSeen((s) => (s.has(step.id) ? s : new Set(s).add(step.id)))
  }, [open, step, index])

  const last = index >= steps.length - 1
  const next = useCallback(() => (last ? onClose() : setIndex((i) => i + 1)), [last, onClose])
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Arrow keys page through the tour, but never while the recruiter is typing —
  // a tour that hijacks → inside a textarea is worse than no tour.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (typing) return
      if (e.key === 'ArrowRight') { e.preventDefault(); next() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, next, back, onClose])

  if (!open || !step) return null

  return (
    <>
      {/* ── The ring. Follows the target; never intercepts a click. ── */}
      {rect && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-overlay rounded-xl border-2 border-action bg-action-soft/20 transition-all duration-200 motion-reduce:transition-none"
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}

      {/* ── The panel. Bottom-right on a desktop, a sheet on a phone. ── */}
      <aside
        role="dialog"
        aria-label="Guided tour"
        className={cn(
          'fixed z-modal flex flex-col overflow-hidden rounded-2xl border border-rule-strong bg-surface shadow-lg',
          'inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[380px]',
        )}
      >
        <header className="flex items-start gap-2 border-b border-border bg-surface-sunk px-4 py-3">
          <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-action text-action-ink">
            <GraduationCap size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
              {kicker ?? 'Guided tour'}
            </p>
            <p className="truncate text-sm font-bold text-ink">{step.title}</p>
          </div>
          <button
            onClick={() => setChapters((c) => !c)}
            aria-expanded={chapters}
            aria-label={chapters ? 'Hide all steps' : 'Show all steps'}
            title="All steps"
            className={cn(
              'rounded-lg p-1.5 transition-colors duration-150 hover:bg-surface-hover',
              chapters ? 'text-ink' : 'text-ink-faint hover:text-ink',
            )}
          >
            <List size={15} />
          </button>
          <button
            onClick={onClose}
            aria-label="Close the tour"
            className="rounded-lg p-1.5 text-ink-faint transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
          >
            <X size={15} />
          </button>
        </header>

        {chapters ? (
          <ol className="max-h-[46vh] overflow-y-auto p-2">
            {steps.map((s, i) => {
              const done = seen.has(s.id) && i !== index
              return (
                <li key={s.id}>
                  <button
                    onClick={() => { setIndex(i); setChapters(false) }}
                    aria-current={i === index ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150',
                      i === index ? 'bg-surface-hover font-semibold text-ink' : 'text-ink-body hover:bg-surface-hover/60',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums',
                        i === index ? 'bg-action text-action-ink' : done ? 'bg-ok-bg text-ok' : 'border border-border text-ink-faint',
                      )}
                    >
                      {done ? <Check size={10} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        ) : (
          <div className="max-h-[42vh] overflow-y-auto px-4 py-3.5">
            <div className="space-y-2.5 text-[13px] leading-relaxed text-ink-body">{step.body}</div>
            {step.action && (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-rule bg-surface-hover/60 px-3 py-2 text-xs font-medium leading-relaxed text-ink">
                <ArrowRight size={13} className="mt-0.5 flex-shrink-0 text-ink-muted" />
                <span>{step.action}</span>
              </p>
            )}
          </div>
        )}

        <footer className="flex items-center gap-2 border-t border-border px-4 py-3">
          {/* Progress as a bar rather than dots: twelve dots is a rash, and the
              count is what somebody deciding whether to keep going wants. */}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tabular-nums text-ink-muted">
              {index + 1} of {steps.length}
            </p>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-hover">
              <div
                className="h-full rounded-full bg-action transition-all duration-300"
                style={{ width: `${((index + 1) / steps.length) * 100}%` }}
              />
            </div>
          </div>
          <button
            onClick={back}
            disabled={index === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-ink-muted transition-colors duration-150 hover:bg-surface-hover hover:text-ink disabled:pointer-events-none disabled:text-ink-disabled"
          >
            <ArrowLeft size={13} /> Back
          </button>
          <button
            onClick={next}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-action-edge bg-action px-3 text-xs font-semibold text-action-ink shadow-primary-sm transition-colors duration-150 hover:bg-action-hover"
          >
            {last ? 'Finish' : 'Next'} {last ? <Check size={13} /> : <ArrowRight size={13} />}
          </button>
        </footer>
      </aside>
    </>
  )
}

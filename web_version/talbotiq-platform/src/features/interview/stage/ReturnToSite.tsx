import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui'

/**
 * MIMIC — leaving the interview.
 *
 * After the thank-you screen the candidate is returned to the Mimic site. They
 * arrived from an emailed link straight into an interview, so without this the
 * only exit from the product is closing the tab, and there is nowhere to find
 * out what the thing that just interviewed them actually is.
 *
 * ── Why the countdown yields, and when it stops yielding ─────────────────
 * The feedback form sits on this same screen. A timer that fires while someone
 * is halfway through typing a comment would destroy what they wrote and read as
 * a malfunction, so while that form is open the countdown is cancelled
 * permanently by ANY interaction on the screen: a keystroke, a click, a focus.
 * Someone who is engaged does not get moved; someone who has finished reading
 * does.
 *
 * Once the form is answered — sent OR declined — the caller remounts this with
 * `cancellable={false}` and a short count. Yielding past that point was the
 * bug: the click that answered the form was itself an interaction, so it
 * cancelled the countdown it should have started, and every candidate who
 * engaged with feedback was left on a screen whose only exit was closing the
 * tab. Deferring to interaction is right up to the moment there is nothing left
 * to interrupt.
 *
 * ── Why it is visible and cancellable ────────────────────────────────────
 * An unannounced redirect after an assessment is alarming. It looks like the
 * page crashed, and a candidate cannot tell whether their submission survived.
 * So the count is shown, "Stay on this page" is always there, and the button to
 * go immediately is available from the first second.
 */
export function ReturnToSite({
  seconds = 20,
  to = '/',
  cancellable = true,
}: {
  seconds?: number
  /** The marketing site. Same router, so this works in dev and in production. */
  to?: string
  /**
   * Whether interaction stops the clock.
   *
   * True while the feedback form above is still open — a timer that fires
   * mid-sentence destroys what someone wrote and reads as a malfunction.
   *
   * False once that step has been answered, and that case is the reason this
   * prop exists. At that point nothing is left on the page to interrupt, and the
   * only interaction still arriving is the click that finished the step — which
   * under the cancelling rule would instantly stop the very countdown it should
   * have started, leaving the candidate parked on a dead-end screen.
   */
  cancellable?: boolean
}) {
  const navigate = useNavigate()
  const [left, setLeft] = useState(seconds)
  const [cancelled, setCancelled] = useState(false)
  const cancelledRef = useRef(false)

  const cancel = useCallback(() => {
    if (cancelledRef.current) return
    cancelledRef.current = true
    setCancelled(true)
  }, [])

  /* Any real interaction on the page stops the clock. `capture` so it is seen
     even when a child stops propagation, and `once` per event type because one
     cancellation is permanent: a candidate who came back to read should not have
     the timer silently restart on them. */
  useEffect(() => {
    if (cancelled || !cancellable) return
    const events: (keyof DocumentEventMap)[] = ['keydown', 'pointerdown', 'focusin']
    events.forEach((e) => document.addEventListener(e, cancel, { capture: true, once: true }))
    return () => events.forEach((e) => document.removeEventListener(e, cancel, { capture: true }))
  }, [cancel, cancelled, cancellable])

  useEffect(() => {
    if (cancelled) return
    if (left <= 0) { navigate(to); return }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(id)
  }, [left, cancelled, navigate, to])

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule bg-surface px-6 py-5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">Finished here</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted" aria-live="polite">
          {cancelled
            ? 'You can close this window, or read more about Mimic.'
            : `Taking you to the Mimic site in ${left} second${left === 1 ? '' : 's'}.`}
        </p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        {!cancelled && (
          <Button variant="ghost" size="sm" onClick={cancel}>
            Stay on this page
          </Button>
        )}
        <Button size="sm" onClick={() => navigate(to)} iconRight={<ArrowRight size={15} />}>
          Go to Mimic
        </Button>
      </div>
    </div>
  )
}

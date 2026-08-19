import { useState } from 'react'
import { Check, Send } from 'lucide-react'
import { cn, Button, Textarea } from '@/components/ui'
import { sessionsApi } from '@/lib/api'

/**
 * MIMIC — how was that, for you?
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Every other piece of "feedback" in this product runs in one direction: the
 * recruiter's assessment of the candidate. Nobody was asking the person who had
 * just been interviewed by a machine what the experience was actually like,
 * which means the one group who can tell us whether AI interviewing is working
 * had no way to say so.
 *
 * ── The rules it is built to ─────────────────────────────────────────────
 *   OPTIONAL AND SKIPPABLE. It sits BELOW the completion message, never in
 *   front of it. The candidate has finished; they owe us nothing, and a
 *   feedback gate after an assessment is close to coercion.
 *
 *   IT SAYS IT DOES NOT COUNT. Without that sentence a candidate will either
 *   flatter the process or stay silent, because from where they are sitting
 *   anything they type looks like it might reach the person deciding on them.
 *   The server enforces this too: the field is written to a key the scorer
 *   never reads.
 *
 *   IT IS SHORT. Two questions. Someone who has just been assessed for half an
 *   hour will not complete a survey, and a long form here would collect nothing
 *   while making the ending feel like admin.
 */

const RATINGS = [
  { value: 1, label: 'Poor' },
  { value: 2, label: 'Fair' },
  { value: 3, label: 'Okay' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Great' },
]

export function CandidateFeedback({
  sessionId,
  onResolved,
}: {
  sessionId: string
  /**
   * Fired when the candidate is finished with this step, whichever way they
   * finished it — sent or declined. From this screen's point of view the two are
   * the same event, and treating "No thanks" as unfinished would strand exactly
   * the people who answered quickest.
   */
  onResolved?: () => void
}) {
  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')

  const canSend = state === 'idle' && (rating !== null || comment.trim().length > 0)

  const send = async () => {
    if (!canSend) return
    setState('sending')
    try {
      await sessionsApi.candidateFeedback(sessionId, {
        ...(rating !== null ? { rating } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      })
    } catch {
      // Deliberately swallowed. This is a courtesy at the end of an interview
      // that is already complete and already submitted; showing a candidate an
      // error about their optional comment would imply something went wrong
      // with their actual interview, which is the last thing they should think.
    }
    setState('sent')
    onResolved?.()
  }

  if (state === 'sent') {
    return (
      <div className="mt-4 rounded-xl border border-rule bg-surface px-6 py-5">
        <p className="flex items-center gap-2.5 text-sm font-medium text-ink">
          <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-ok-bg text-ok" aria-hidden="true">
            <Check size={13} strokeWidth={3} />
          </span>
          Thank you, that is genuinely useful.
        </p>
      </div>
    )
  }

  return (
    <section className="mt-4 rounded-xl border border-rule bg-surface px-6 py-5" aria-labelledby="feedback-heading">
      <h2 id="feedback-heading" className="font-display text-base font-bold text-ink">
        How was this interview for you?
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        This goes to the team who build Mimic. It is not shared with the hiring team and it
        has no effect on your application.
      </p>

      {/* The scale is labelled at every point rather than only at the ends. A
          row of unlabelled stars asks the candidate to invent what 3 means. */}
      <fieldset className="mt-4">
        <legend className="sr-only">Rate your experience</legend>
        <div className="flex flex-wrap gap-2">
          {RATINGS.map((r) => {
            const on = rating === r.value
            return (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setRating(on ? null : r.value)}
                className={cn(
                  'inline-flex min-w-[4.5rem] items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold',
                  'transition-[background-color,border-color] duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                  on
                    ? 'border-ink bg-ink text-ink-inverse'
                    : 'border-rule bg-surface text-ink-body hover:border-rule-strong hover:bg-surface-hover',
                )}
              >
                {r.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="mt-4">
        <Textarea
          label="Anything you would change?"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional"
          charLimit={2000}
          className="min-h-[88px]"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          size="md"
          onClick={() => void send()}
          disabled={!canSend}
          loading={state === 'sending'}
          icon={<Send size={15} />}
        >
          Send feedback
        </Button>
        <button
          type="button"
          onClick={() => { setState('sent'); onResolved?.() }}
          className="rounded-sm text-sm text-ink-muted underline underline-offset-2 transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          No thanks
        </button>
      </div>
    </section>
  )
}

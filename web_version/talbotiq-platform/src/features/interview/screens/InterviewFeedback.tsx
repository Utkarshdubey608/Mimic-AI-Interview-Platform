import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Loader2, Star } from 'lucide-react'
import { sessionsApi } from '@/lib/api'

/** Where a finished candidate is sent. `/` is the Mimic app (App.tsx). */
const MIMIC_HOME = '/'
const REDIRECT_DELAY_MS = 1600

interface Props {
  sessionId: string
  accentColor: string
}

/**
 * The last thing a candidate sees: a short rating, then back to the Mimic app.
 *
 * Deliberately SKIPPABLE. Someone who has just finished a screening interview
 * does not owe us a review, and holding the exit hostage for one would sour the
 * final impression of a company they may still want to work for. Skipping takes
 * the same path as submitting.
 *
 * The redirect is the bug this also fixes: candidates previously landed on a
 * dead-end "you can close this window" screen and were never returned anywhere.
 * It fires after the write settles, and fires ANYWAY if the write fails — a
 * feedback POST that 500s must not strand someone on a terminal page.
 */
export function InterviewFeedback({ sessionId, accentColor }: Props) {
  const reduce = useReducedMotion()
  const navigate = useNavigate()
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [issues, setIssues] = useState(false)
  const [phase, setPhase] = useState<'asking' | 'sending' | 'leaving'>('asking')

  useEffect(() => {
    if (phase !== 'leaving') return
    const t = window.setTimeout(() => navigate(MIMIC_HOME), REDIRECT_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [phase, navigate])

  const leave = () => setPhase('leaving')

  const submit = async () => {
    if (rating < 1) return
    setPhase('sending')
    try {
      await sessionsApi.submitFeedback(sessionId, {
        rating,
        comment: comment.trim(),
        hadTechnicalIssues: issues,
      })
    } catch {
      // Their opinion is worth having, not worth trapping them for.
    }
    leave()
  }

  if (phase === 'leaving') {
    return (
      <div className="mt-8 border-t border-border pt-6 text-center" data-testid="feedback-leaving">
        <p className="flex items-center justify-center gap-2 text-sm text-neutral-500">
          <Loader2 size={16} className="animate-spin" /> Thank you. Taking you back…
        </p>
      </div>
    )
  }

  const shown = hovered || rating

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduce ? 0 : 0.25 }}
      className="mt-8 border-t border-border pt-6"
      data-testid="feedback-step"
    >
      <p className="text-sm font-semibold text-neutral-900">How was that for you?</p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-400">
        Optional, and it goes to the team who set this up, not into your assessment.
      </p>

      <div className="mt-4 flex justify-center gap-1.5" role="radiogroup" aria-label="Rate your experience">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} out of 5`}
            data-testid={`feedback-star-${n}`}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            className="rounded-md p-1 transition-transform duration-100 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            <Star
              size={28}
              strokeWidth={1.75}
              className={n <= shown ? '' : 'text-neutral-300'}
              style={n <= shown ? { color: accentColor, fill: accentColor } : undefined}
            />
          </button>
        ))}
      </div>

      {rating > 0 && (
        <div className="mt-5 space-y-3 text-left">
          <label className="block">
            <span className="text-xs text-neutral-500">Anything you would change? (optional)</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={2000}
              data-testid="feedback-comment"
              className="mt-1 w-full resize-none rounded-xl border border-border bg-white p-3 text-sm text-neutral-900 placeholder:text-neutral-400"
              placeholder="A sentence is plenty."
            />
          </label>

          <label className="flex items-start gap-2.5 text-left">
            <input
              type="checkbox"
              checked={issues}
              onChange={(e) => setIssues(e.target.checked)}
              data-testid="feedback-issues"
              className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-neutral-300"
            />
            <span className="text-xs leading-relaxed text-neutral-500">
              I had a technical problem (audio, video, or the page itself).
            </span>
          </label>
        </div>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={leave}
          data-testid="feedback-skip"
          className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-white px-5 text-sm font-semibold text-neutral-600 transition-colors hover:bg-neutral-50"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={rating < 1 || phase === 'sending'}
          data-testid="feedback-submit"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md px-6 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: accentColor }}
        >
          {phase === 'sending' ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : 'Send feedback'}
        </button>
      </div>
    </motion.div>
  )
}

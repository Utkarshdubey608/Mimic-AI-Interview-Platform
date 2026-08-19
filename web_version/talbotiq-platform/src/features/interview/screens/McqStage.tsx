import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, Loader2, Send, AlertTriangle, Clock } from 'lucide-react'
import { cn } from '@/components/ui'
import { mcqSessionApi } from '@/lib/api'
import type { BrandingConfig, McqPaperState } from '@shared/types'
import { InterviewStage } from '../stage/InterviewStage'
import { Completion } from './Completion'

/**
 * MIMIC — the MCQ paper, as a candidate sits it.
 *
 * The closed-ended mode, and the only one with no interviewer: nothing is spoken,
 * nothing is recorded, nothing is judged by a model. That shapes the screen — it
 * should feel like sitting an assessment, not like being watched during one.
 *
 * ── One question at a time ────────────────────────────────────────────────
 * Not a scrolling list of forty. A single question with its options is the whole
 * viewport's worth of attention, which is what a considered answer needs; a long
 * scroll invites skimming and makes progress impossible to feel. Back and forward
 * both work, because a paper you cannot revisit is a memory test.
 *
 * ── Answers are saved as they are chosen ──────────────────────────────────
 * Every selection is debounced onto the server. A candidate who loses their
 * connection, closes a laptop lid or refreshes must find the paper as they left
 * it — losing twenty answers to a dropped WiFi connection would be the single
 * worst thing this screen could do to somebody's application.
 *
 * The final submit sends the answers again rather than trusting the last
 * auto-save, so answering the last question and pressing Submit immediately
 * cannot lose that answer to a debounce that never fired.
 *
 * ── What is deliberately absent ───────────────────────────────────────────
 * The answer key, obviously — it is never in the payload. But also: no score
 * unless the recruiter chose to show one, no "3 wrong so far", no per-question
 * feedback mid-paper. A running tally would change how someone answers the rest,
 * which makes the assessment measure composure rather than knowledge.
 */


/**
 * An answer is a LIST of option ids for single and multi, and a promptId→matchId
 * MAPPING for a pairing. These two helpers are the only places that decide which
 * is which, so nothing below has to hold a union in its head.
 *
 * Both are total: an unanswered question yields an empty list or an empty mapping
 * rather than undefined, which is what lets the controls render uniformly.
 */
type Answer = string[] | Record<string, string>

const picked = (answers: Record<string, Answer>, id: string): string[] => {
  const value = answers[id]
  return Array.isArray(value) ? value : []
}

const paired = (answers: Record<string, Answer>, id: string): Record<string, string> => {
  const value = answers[id]
  return value && !Array.isArray(value) ? value : {}
}

/** Has this question been answered at all? Counts either shape. */
const isAnswered = (answers: Record<string, Answer>, id: string): boolean => {
  const value = answers[id]
  return Array.isArray(value) ? value.length > 0 : Object.keys(value ?? {}).length > 0
}

export function McqStage({
  sessionId, branding, onIntegrity,
}: { sessionId: string; branding: BrandingConfig; onIntegrity?: (type: string) => void }) {
  const reduce = useReducedMotion() ?? false
  const [state, setState] = useState<McqPaperState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [submitting, setSubmitting] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Load the paper. Opening it is what marks the assessment started, server-side.
  useEffect(() => {
    let alive = true
    mcqSessionApi.paper(sessionId)
      .then((s) => { if (!alive) return; setState(s); setAnswers((s.answers ?? {}) as Record<string, Answer>) })
      .catch((e: Error) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [sessionId])

  /* Debounced auto-save. The ref holds the latest answers so the timer always
     sends what is on screen now, not what was there when it was scheduled. */
  const answersRef = useRef(answers)
  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => {
    if (!state || state.submittedAt) return
    const id = setTimeout(() => {
      mcqSessionApi.save(sessionId, answersRef.current)
        .then(() => setSavedAt(Date.now()))
        // Swallowed on purpose: a failed auto-save is not the candidate's problem
        // to solve mid-paper, and the submit sends everything again anyway.
        .catch(() => {})
    }, 700)
    return () => clearTimeout(id)
  }, [answers, sessionId, state])

  const questions = state?.questions ?? []
  const current = questions[index]
  const answeredCount = useMemo(
    () => questions.filter((q) => isAnswered(answers, q.id)).length,
    [questions, answers],
  )

  const toggle = useCallback((questionId: string, optionId: string, multi: boolean) => {
    setAnswers((prev) => {
      const chosen = picked(prev, questionId)
      if (multi) {
        return {
          ...prev,
          [questionId]: chosen.includes(optionId)
            ? chosen.filter((o) => o !== optionId)
            : [...chosen, optionId],
        }
      }
      // Single answer: choosing replaces, and choosing the same option again
      // clears it — a candidate who picked by accident can unpick.
      return { ...prev, [questionId]: chosen[0] === optionId ? [] : [optionId] }
    })
  }, [])

  /** Pair one prompt with one match, or clear it. */
  const pair = useCallback((questionId: string, promptId: string, matchId: string) => {
    setAnswers((prev) => {
      const next = { ...paired(prev, questionId) }
      if (matchId) next[promptId] = matchId
      // An empty selection removes the row rather than storing "", so a cleared
      // pairing is indistinguishable from one never made.
      else delete next[promptId]
      return { ...prev, [questionId]: next }
    })
  }, [])

  const submit = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      // Send the answers WITH the submit rather than relying on the last
      // auto-save: answering the final question and pressing Submit immediately
      // must not lose it to a debounce that never fired.
      const next = await mcqSessionApi.submit(sessionId, answersRef.current)
      setState(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit')
    } finally {
      setSubmitting(false)
    }
  }, [sessionId, submitting])

  if (error) {
    return (
      <InterviewStage branding={branding} track="mcq">
        <div className="mx-auto max-w-md py-16 text-center">
          <AlertTriangle className="mx-auto text-warn" size={28} strokeWidth={1.75} />
          <p className="mt-4 text-sm font-medium text-ink">{error}</p>
          <p className="mt-1 text-xs text-ink-muted">
            Nothing you have answered is lost — reload and the paper returns as you left it.
          </p>
        </div>
      </InterviewStage>
    )
  }

  if (!state) {
    return (
      <InterviewStage branding={branding} track="mcq">
        <div className="flex items-center justify-center gap-2.5 py-24 text-sm text-ink-muted">
          <Loader2 size={16} className="animate-spin" /> Loading your assessment…
        </div>
      </InterviewStage>
    )
  }

  // Finished: the same closing screen every other track ends on, so the six
  // formats do not each say goodbye differently.
  if (state.submittedAt || state.status === 'completed') {
    return <Completion branding={branding} sessionId={sessionId} />
  }

  if (!current) {
    return (
      <InterviewStage branding={branding} track="mcq">
        <div className="py-24 text-center text-sm text-ink-muted">This assessment has no questions.</div>
      </InterviewStage>
    )
  }

  const chosen = picked(answers, current.id)
  const pairing = paired(answers, current.id)
  const isMulti = current.type === 'multi'
  const isMatch = current.type === 'match'
  const last = index === questions.length - 1

  return (
    <InterviewStage branding={branding} track="mcq">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between">
          <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-muted">
            Question {index + 1} of {questions.length}
          </span>
          <span className="flex items-center gap-2 text-xs text-ink-muted" aria-live="polite">
            {savedAt && <><Check size={12} className="text-ok" /> Answers saved</>}
          </span>
        </div>

        {/* Progress by ANSWERED, not by position: it tells a candidate what is
            left to do rather than how far they have scrolled. */}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-rule">
          <div
            className="h-full rounded-full bg-action transition-[width] duration-300"
            style={{ width: `${(answeredCount / Math.max(1, questions.length)) * 100}%` }}
          />
        </div>

        <motion.div
          key={current.id}
          initial={reduce ? undefined : { opacity: 0, y: 8 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="mt-7"
        >
          <h1 className="font-display text-xl font-bold leading-snug text-ink sm:text-2xl">
            {current.text}
          </h1>
          <p className="mt-2 text-xs text-ink-muted">
            {isMatch
              ? 'Pair each item on the left with one on the right.'
              : isMulti
                ? 'Select all that apply.'
                : 'Select one answer.'}
          </p>

          {/* The snippet a code-reading question is about. Rendered monospace and
              scrollable in its own right: a long line must not push the page
              sideways on a phone, and a candidate being scored should never have
              to fight the layout to read the code. */}
          {current.code && (
            <pre className="mt-4 max-h-80 overflow-auto rounded-xl border border-rule bg-surface-hover p-4 text-xs leading-relaxed text-ink">
              <code>{current.code}</code>
            </pre>
          )}

          {isMatch ? (
            /* A SELECT PER ROW rather than drag-and-drop. Dragging is the obvious
               design and the wrong one here: it is poor on a phone, hostile to
               keyboards and screen readers, and this is a screen somebody is being
               scored on. A native select is none of those things, and the spec
               allows either. */
            <div className="mt-5 space-y-2.5">
              {(current.prompts ?? []).map((prompt, i) => (
                <div
                  key={prompt.id}
                  className="flex flex-col gap-2 rounded-xl border border-rule bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
                >
                  <span className="flex-1 text-sm text-ink">{prompt.text}</span>
                  <label className="sr-only" htmlFor={`pair-${prompt.id}`}>
                    Match for {prompt.text}
                  </label>
                  <select
                    id={`pair-${prompt.id}`}
                    value={pairing[prompt.id] ?? ''}
                    onChange={(e) => pair(current.id, prompt.id, e.target.value)}
                    className="h-10 w-full rounded-lg border border-rule-input bg-surface px-3 text-sm text-ink sm:w-64"
                  >
                    <option value="">Choose…</option>
                    {(current.matches ?? []).map((match) => (
                      <option key={match.id} value={match.id}>
                        {match.text}
                      </option>
                    ))}
                  </select>
                  <span className="sr-only">Row {i + 1}</span>
                </div>
              ))}
            </div>
          ) : (
          <div className="mt-5 space-y-2.5" role={isMulti ? 'group' : 'radiogroup'}>
            {current.options.map((option, i) => {
              const on = chosen.includes(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  role={isMulti ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  onClick={() => toggle(current.id, option.id, isMulti)}
                  className={cn(
                    'flex w-full items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-colors duration-fast',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal',
                    on
                      ? 'border-action bg-surface-hover'
                      : 'border-rule bg-surface hover:border-rule-strong',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 flex-shrink-0 items-center justify-center border transition-colors duration-fast',
                      isMulti ? 'rounded-md' : 'rounded-full',
                      on ? 'border-action bg-action text-on-action' : 'border-rule-input text-transparent',
                    )}
                    aria-hidden="true"
                  >
                    <Check size={13} strokeWidth={3} />
                  </span>
                  <span className="w-4 flex-shrink-0 text-xs font-bold text-ink-faint">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="text-sm leading-relaxed text-ink-body">{option.text}</span>
                </button>
              )
            })}
          </div>
          )}
        </motion.div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5">
          {/* Back is always available. A paper you cannot revisit is a memory test. */}
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="rounded-lg px-3 py-2 text-sm font-medium text-ink-muted transition-colors duration-fast hover:text-ink disabled:opacity-30"
          >
            Back
          </button>

          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-muted">
              {answeredCount} of {questions.length} answered
            </span>
            {last ? (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-action px-5 py-2.5 text-sm font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover disabled:opacity-60"
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Submit assessment
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
                className="inline-flex items-center gap-2 rounded-lg bg-action px-5 py-2.5 text-sm font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover"
              >
                Next
              </button>
            )}
          </div>
        </div>

        {/* Said once, at the end, rather than as a warning on every question: an
            unanswered question scores nothing, and someone about to submit an
            incomplete paper should know before they do, not after. */}
        {last && answeredCount < questions.length && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-warn">
            <Clock size={12} /> {questions.length - answeredCount} question
            {questions.length - answeredCount === 1 ? '' : 's'} still unanswered.
          </p>
        )}
      </div>
    </InterviewStage>
  )
}

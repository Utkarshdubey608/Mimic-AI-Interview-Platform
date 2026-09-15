import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, Loader2, Send, AlertTriangle, Clock, BookOpen, ImageIcon, Code2 } from 'lucide-react'
import { cn } from '@/components/ui'
import { mcqSessionApi } from '@/lib/api'
import type { BrandingConfig, McqPaperState, McqSectionPublic } from '@shared/types'
import { InterviewStage } from '../stage/InterviewStage'
import { Completion } from './Completion'
import { CircularCountdown } from '../components/CircularCountdown'

/**
 * MIMIC — the MCQ paper, as a candidate sits it.
 *
 * The closed-ended mode, and the only one with no interviewer: nothing is spoken,
 * nothing is recorded, nothing is judged by a model. That shapes the screen — it
 * should feel like sitting an assessment, not like being watched during one.
 *
 * ── One question at a time, forward only ──────────────────────────────────
 * Not a scrolling list of forty, and not one you can wander back through
 * either: there is no Back, no jump, and Next is disabled until the current
 * question is answered — a locked-forward paper, the same rule a proctored
 * exam runs on. This is enforced here, in the client; nothing server-side yet
 * stops a direct API call from saving an answer for a question the UI never
 * reached, which is the next piece of this to build.
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
  sessionId, branding,
}: { sessionId: string; branding: BrandingConfig; onIntegrity?: (type: string) => void }) {
  const reduce = useReducedMotion() ?? false
  const [state, setState] = useState<McqPaperState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [submitting, setSubmitting] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // Seeded from the server on every load/resync, then ticked down locally
  // between them — the server, not this countdown, is what actually closes
  // the paper (see the 5s resync below and sessions_mcq.py's own expiry
  // check on every read/write).
  const [remaining, setRemaining] = useState<number | null>(null)

  // Load the paper. Opening it is what marks the assessment started, server-side.
  useEffect(() => {
    let alive = true
    mcqSessionApi.paper(sessionId)
      .then((s) => {
        if (!alive) return
        setState(s)
        setAnswers((s.answers ?? {}) as Record<string, Answer>)
        setRemaining(s.remainingSeconds ?? null)
      })
      .catch((e: Error) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [sessionId])

  // Resync with the server every 5s, same cadence useInterviewClock polls at
  // — only while timed and not yet submitted, so an untimed paper (the
  // common case for most papers today) costs nothing extra. This is what
  // actually closes the paper: a client that stopped ticking, or whose local
  // clock drifted, still finds the deadline applied the moment it next asks.
  useEffect(() => {
    if (!state || state.submittedAt || state.totalSeconds == null) return
    const id = setInterval(() => {
      mcqSessionApi.paper(sessionId).then((s) => {
        setState(s)
        setRemaining(s.remainingSeconds ?? null)
        // The server may have auto-submitted between polls — the paper's
        // own answers are authoritative once that happens.
        if (s.submittedAt) setAnswers((s.answers ?? {}) as Record<string, Answer>)
      }).catch(() => {})
    }, 5_000)
    return () => clearInterval(id)
  }, [sessionId, state])

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

  // Which section each question belongs to, and where the candidate is inside
  // it. The server already sends this (`public_sections`'s `questionIds`) — it
  // was simply never read here, so a sectioned paper looked identical to a flat
  // one: no section name, no instructions, no passage, nothing indicating why
  // question 6 suddenly reads differently from question 5.
  const sections = state?.sections ?? null
  const sectionByQuestionId = useMemo(() => {
    const map = new Map<string, McqSectionPublic>()
    for (const section of sections ?? []) {
      for (const qid of section.questionIds ?? []) map.set(qid, section)
    }
    return map
  }, [sections])
  const currentSection = current ? sectionByQuestionId.get(current.id) ?? null : null
  const sectionIndex = currentSection && sections ? sections.findIndex((s) => s.id === currentSection.id) : -1
  const sectionQuestionIds = currentSection?.questionIds ?? null
  const positionInSection = sectionQuestionIds && current ? sectionQuestionIds.indexOf(current.id) : -1

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

  // Local 1s tick, purely presentational — interpolates between the 5s
  // resyncs above so the number does not visibly jump. Auto-submits at zero
  // as a client-side courtesy; the server enforces the same deadline
  // independently on the very next request either way.
  useEffect(() => {
    if (remaining === null || remaining <= 0 || !state || state.submittedAt) return
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r === null) return r
        if (r <= 1) {
          void submit()
          return 0
        }
        return r - 1
      })
    }, 1_000)
    return () => clearInterval(id)
  }, [remaining, state, submit])

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
  const currentAnswered = isAnswered(answers, current.id)

  return (
    <InterviewStage branding={branding} track="mcq">
      <div className="mx-auto max-w-3xl">
        {/* Section banner — the paper's structure, stated rather than implied.
            Absent for an unsectioned paper (state.sections is null), which
            renders exactly as it always did: no banner, no section maths. */}
        {sections && sections.length > 0 && currentSection && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rule bg-surface-hover/60 px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm font-bold text-ink">
              <span
                className="flex h-6 min-w-[1.75rem] items-center justify-center rounded-full px-1.5 text-2xs font-extrabold text-white"
                style={{ backgroundColor: branding.accentColor ?? '#0E1420' }}
              >
                {sectionIndex + 1}
              </span>
              Section {sectionIndex + 1} of {sections.length} — {currentSection.name || 'Untitled section'}
            </div>
            {sectionQuestionIds && positionInSection >= 0 && (
              <span className="text-2xs font-bold uppercase tracking-[0.1em] text-ink-muted">
                Question {positionInSection + 1} of {sectionQuestionIds.length} in this section
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-muted">
            Question {index + 1} of {questions.length} overall
          </span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs text-ink-muted" aria-live="polite">
              {savedAt && <><Check size={12} className="text-ok" /> Answers saved</>}
            </span>
            {/* Absent for an untimed paper — most papers today — rather than
                showing a clock that enforces nothing. See sessions_mcq.py's
                `remainingSeconds`. */}
            {state.totalSeconds != null && remaining !== null && (
              <CircularCountdown
                remaining={remaining}
                total={state.totalSeconds}
                phase="answer"
                warningThreshold={60}
                accentColor={branding.accentColor ?? '#0E1420'}
                size={44}
              />
            )}
          </div>
        </div>
        {/* A textual companion to the ring's colour ramp — urgency must not be
            colour-only. Silent otherwise; the ring's own sr-only live region
            already announces the running time on every render. */}
        {state.totalSeconds != null && remaining !== null && remaining > 0 && remaining <= 60 && (
          <p role="alert" className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warn">
            <Clock size={12} /> Less than a minute left — this assessment submits automatically at zero.
          </p>
        )}

        {/* Progress by ANSWERED, not by position: it tells a candidate what is
            left to do rather than how far they have scrolled. */}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-rule">
          <div
            className="h-full rounded-full bg-action transition-[width] duration-300"
            style={{ width: `${(answeredCount / Math.max(1, questions.length)) * 100}%` }}
          />
        </div>

        {/* The passage/instructions a WHOLE section is about — carried on the
            section manifest, and previously never rendered at all: a
            comprehension section with a passage showed only its questions,
            with nothing to read them against. Shown once per section, not
            re-shown on every question within it, so it doesn't scroll away
            from view — it stays pinned above the question card. */}
        {currentSection?.instructions && (
          <p className="mt-4 rounded-lg border border-rule-strong bg-surface-sunk px-4 py-2.5 text-xs leading-relaxed text-ink-muted">
            {currentSection.instructions}
          </p>
        )}
        {currentSection?.passage && (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-rule bg-surface-hover/40 p-4">
            <BookOpen size={16} className="mt-0.5 flex-shrink-0 text-ink-muted" strokeWidth={1.75} />
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-body">{currentSection.passage}</p>
          </div>
        )}

        <motion.div
          key={current.id}
          initial={reduce ? undefined : { opacity: 0, y: 8 }}
          animate={reduce ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="mt-5 rounded-2xl border border-rule bg-surface p-6 shadow-sm sm:p-7"
        >
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sm font-extrabold text-white"
              style={{ backgroundColor: branding.accentColor ?? '#0E1420' }}
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div className="flex-1">
              <h1 className="font-display text-xl font-bold leading-snug text-ink sm:text-2xl">
                {current.text}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-xs text-ink-muted">
                  {isMatch
                    ? 'Pair each item on the left with one on the right.'
                    : isMulti
                      ? 'Select all that apply.'
                      : 'Select one answer.'}
                </p>
                {current.imageDataUrl && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-2xs font-bold uppercase tracking-wide text-ink-muted">
                    <ImageIcon size={11} /> Diagram question
                  </span>
                )}
                {current.code && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-2xs font-bold uppercase tracking-wide text-ink-muted">
                    <Code2 size={11} /> Code question
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* The snippet a code-reading question is about. Rendered monospace and
              scrollable in its own right: a long line must not push the page
              sideways on a phone, and a candidate being scored should never have
              to fight the layout to read the code. */}
          {current.code && (
            <pre className="mt-4 max-h-80 overflow-auto rounded-xl border border-rule bg-surface-hover p-4 text-xs leading-relaxed text-ink">
              <code>{current.code}</code>
            </pre>
          )}

          {/* The diagram a directions/aptitude question is about. White-background
              PNG, so it reads the same in light or dark mode without a themed
              frame fighting the image's own colors. */}
          {current.imageDataUrl && (
            <div className="mt-4 overflow-hidden rounded-xl border border-rule bg-white p-3">
              <img src={current.imageDataUrl} alt="Diagram for this question" className="mx-auto block max-w-full" />
            </div>
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
                      on ? 'border-action bg-action text-action-ink' : 'border-rule-input text-transparent',
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

        <div className="mt-8 flex flex-wrap items-center justify-end gap-3 border-t border-rule pt-5">
          {/* Locked forward: no Back, no jump, and Next/Submit stay disabled
              until the question on screen is actually answered. Once you move
              on, there is no way back to it from here. */}
          <span className="text-xs text-ink-muted">
            {answeredCount} of {questions.length} answered
          </span>
          {last ? (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || !currentAnswered}
              title={!currentAnswered ? 'Answer this question to submit' : undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-action px-5 py-2.5 text-sm font-semibold text-action-ink transition-colors duration-fast hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              Submit assessment
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
              disabled={!currentAnswered}
              title={!currentAnswered ? 'Answer this question to continue' : undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-action px-5 py-2.5 text-sm font-semibold text-action-ink transition-colors duration-fast hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          )}
        </div>
        {!currentAnswered && (
          <p className="mt-2.5 text-right text-xs text-ink-muted">
            Answer this question to move on — you can't skip ahead or go back once you leave it.
          </p>
        )}

      </div>
    </InterviewStage>
  )
}

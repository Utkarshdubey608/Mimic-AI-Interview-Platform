import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Send, Loader2, CheckCircle2, Lightbulb, AlertTriangle, Clock } from 'lucide-react'
import { cn } from '@/components/ui'
import type { BrandingConfig } from '@shared/types'
import { useChatbotSession } from '../useChatbotSession'
import { CircularCountdown } from '../components/CircularCountdown'
import { MimicMark } from '@/components/brand/MimicMark'
import { InterviewStage, PhaseMark } from '../stage/InterviewStage'
import { Completion } from './Completion'

interface Props {
  sessionId: string
  branding: BrandingConfig
  onIntegrity?: (type: string) => void
}

/**
 * The interviewer's avatar on every one of its turns.
 *
 * It was the tenant's first initial — a bare "T" in a box, repeated down the
 * whole transcript. That is the weakest possible mark: it carries no meaning a
 * candidate can use, it is indistinguishable between two customers whose names
 * start with the same letter, and it made the interviewer look like a
 * placeholder.
 *
 * It is now the Mimic mark, which is honest about who is asking: the questions
 * come from the interviewer, and the interviewer is this product.
 */
function InterviewerMark() {
  return <MimicMark size="md" className="shadow-xs" />
}

/**
 * The rotating mark that accompanies "Thinking…".
 *
 * A six-spoke asterisk rather than a circular spinner. A spinner implies a job
 * with a known duration; an interviewer deciding what to ask next has neither,
 * and the asterisk reads as activity without making that promise. It rotates
 * slowly and breathes, so it is legible as motion at 14px without drawing the
 * eye the way a fast spinner does.
 *
 * Under reduced motion it renders static — the word beside it already carries
 * the meaning, which is why the word is not optional.
 */
function ThinkingMark({ reduce }: { reduce: boolean | null }) {
  return (
    <motion.svg
      viewBox="0 0 24 24"
      className="h-[15px] w-[15px] flex-shrink-0 text-ink"
      aria-hidden="true"
      animate={reduce ? undefined : { rotate: 360 }}
      transition={{ duration: 3.6, repeat: Infinity, ease: 'linear' }}
    >
      {[0, 60, 120].map((deg) => (
        <line
          key={deg}
          x1="12" y1="3.5" x2="12" y2="20.5"
          stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
    </motion.svg>
  )
}

/** "Thinking…" — a mark and a word. Its ≥3s minimum lifetime is enforced by the
 *  session hook, so it is never a flash. */
function ThinkingIndicator({ reduce }: { reduce: boolean | null }) {
  return (
    <div className="flex items-end justify-start gap-2.5">
      <InterviewerMark />
      <div
        className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-rule bg-surface px-4 py-3 shadow-xs"
        role="status"
        aria-live="polite"
      >
        <ThinkingMark reduce={reduce} />
        <span className="text-sm font-medium text-ink-body">Thinking…</span>
      </div>
    </div>
  )
}

export function ChatbotStage({ sessionId, branding, onIntegrity }: Props) {
  const chat = useChatbotSession(sessionId)
  const reduce = useReducedMotion()
  const [text, setText] = useState('')
  // Readiness break: when the candidate isn't ready, offer a short timed pause.
  const [breakStage, setBreakStage] = useState<'none' | 'choosing' | 'counting'>('none')
  const [breakRemaining, setBreakRemaining] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const accent = branding.accentColor || '#1D3FA0'
  const s = chat.state
  const visibleTranscript = chat.visibleTranscript
  const turnId = s?.currentTurnId ?? null

  const READY_NO = 'No, I need a moment.'

  // The interviewer is "thinking" whenever a begin/answer turn is in flight or
  // being held behind the minimum think-time floor (including the initial load,
  // so the opening greeting is preceded by the indicator too).
  const interviewerThinking = chat.sending || (chat.loading && !s)

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' })
  }, [visibleTranscript.length, interviewerThinking, chat.pendingAnswer, reduce])

  // Reset composer to the server draft when the current turn changes.
  useEffect(() => { setText(s?.draft ?? ''); setBreakStage('none') }, [turnId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Readiness break countdown → auto-start when it reaches zero.
  useEffect(() => {
    if (breakStage !== 'counting') return
    if (breakRemaining <= 0) { beginAfterBreak(); return }
    const id = setTimeout(() => setBreakRemaining((r) => r - 1), 1000)
    return () => clearTimeout(id)
  }, [breakStage, breakRemaining]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced draft auto-save (secondary backstop — the composer submits the live
  // text on expiry below, so this only matters if the tab is backgrounded).
  useEffect(() => {
    if (!turnId) return
    const id = setTimeout(() => chat.saveDraft(text), 800)
    return () => clearTimeout(id)
  }, [text, turnId]) // eslint-disable-line react-hooks/exhaustive-deps

  const inThinkingPhase = s?.phase === 'thinking' // optional timed prep sub-window
  const inProgress = s?.status === 'in_progress'
  // The opening "are you ready?" turn takes a simple Yes/No dropdown, not free text.
  const currentTurn = s?.transcript.find((t) => t.id === turnId)
  const isReadiness = currentTurn?.turnType === 'greeting'
  const canSend = !!turnId && !chat.sending && !inThinkingPhase && inProgress && text.trim().length > 0

  // Keep the live composer text in a ref so the expiry auto-submit captures exactly
  // what's typed (not the debounced draft, which could be stale/empty).
  const textRef = useRef(text)
  useEffect(() => { textRef.current = text }, [text])

  // When the answer timer hits zero, auto-submit whatever the candidate has typed.
  // This preserves the typed content AND advances via the normal reveal flow, which
  // arms the NEXT question's timer. Guarded per-turn so it fires exactly once.
  const autoSubmittedTurn = useRef<string | null>(null)
  useEffect(() => {
    if (s?.phase !== 'answer' || !turnId || !inProgress || chat.sending) return
    if (chat.secondsLeft > 0 || autoSubmittedTurn.current === turnId) return
    autoSubmittedTurn.current = turnId
    const typed = textRef.current
    setText('')
    chat.send(typed)
  }, [chat.secondsLeft, s?.phase, turnId, inProgress, chat.sending]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!canSend) return
    const t = text
    setText('')
    chat.send(t)
  }

  // Readiness Send: "Yes" starts immediately; "No" opens the timed break.
  const submitReadiness = () => {
    if (!canSend) return
    if (text === READY_NO) { setBreakStage('choosing'); setText('') }
    else { const t = text; setText(''); chat.send(t) }
  }
  const startBreak = (seconds: number) => { setBreakRemaining(seconds); setBreakStage('counting') }
  const beginAfterBreak = () => {
    if (breakStage === 'none') return
    setBreakStage('none')
    setBreakRemaining(0)
    chat.send('Okay, I’m ready now, thank you.')
  }
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`

  /* Shared control shapes, on the system's own tokens. These used to carry
     `branding.accentColor` through inline style — but the accent is arbitrary
     tenant-supplied hex, so white-on-accent had no contrast guarantee, and this
     is the interview's primary action. */
  const accentPill = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-action px-5 text-sm font-semibold text-action-ink shadow-primary-sm transition-[background-color,box-shadow] duration-fast hover:bg-action-hover hover:shadow-primary-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40'
  const outlinePill = 'inline-flex items-center justify-center rounded-md border bg-surface font-semibold transition-colors duration-fast hover:bg-surface-hover'

  if (s?.finished) {
    // The shared completion screen, so a conversational interview ends exactly
    // the way a timed one does. This used to be a bespoke card with its own
    // wording, its own accent bar and its own tick plate.
    return (
      <InterviewStage branding={branding} track="chatbot">
        <Completion branding={branding} sessionId={sessionId} />
      </InterviewStage>
    )
  }

  return (
    <InterviewStage
      branding={branding}
      track="chatbot"
      layout="focus"
      progress={s && s.progress.total > 0 && s.progress.current > 0 ? s.progress : undefined}
      phase={s?.phase ? <PhaseMark phase={s.phase === 'thinking' ? 'prep' : 'answer'} /> : undefined}
      /* The countdown ring is shown ONLY while a timed question turn is armed —
         never during greeting, readiness, the thinking indicator or wrap-up. */
      timer={
        s?.phase ? (
          <CircularCountdown
            remaining={chat.remaining}
            total={s.totalPhaseSeconds}
            phase={s.phase === 'thinking' ? 'prep' : 'answer'}
            warningThreshold={s.timing.warningThresholdSeconds}
            accentColor={accent}
            size={44}
          />
        ) : undefined
      }
    >
      {/* transcript */}
      <div ref={scrollRef} className="mx-auto w-full max-w-3xl flex-1 space-y-3.5 overflow-y-auto px-4 py-7">
        {visibleTranscript.map((t) => (
          <motion.div
            key={t.id}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn('flex items-end gap-2.5', t.role === 'candidate' ? 'justify-end' : 'justify-start')}
          >
            {t.role !== 'candidate' && <InterviewerMark />}
            <div
              className={
                t.role === 'candidate'
                  ? 'max-w-[76%] rounded-2xl rounded-br-md bg-action px-4 py-3 text-[15px] text-action-ink shadow-sm'
                  : 'max-w-[76%] rounded-2xl rounded-bl-md border border-rule bg-surface px-4 py-3 text-[15px] text-ink shadow-xs'
              }
            >
              <p className="whitespace-pre-wrap leading-[1.6]">{t.content}</p>
            </div>
          </motion.div>
        ))}

        {/* Optimistic candidate bubble, keeps their answer on screen while the
            interviewer "thinks" (the real turn replaces it on reveal). */}
        {chat.pendingAnswer && chat.pendingAnswer.trim() !== '' && (
          <div className="flex items-end justify-end gap-2.5">
            <div className="max-w-[76%] rounded-2xl rounded-br-md bg-action px-4 py-3 text-[15px] text-action-ink opacity-90 shadow-sm">
              <p className="whitespace-pre-wrap leading-[1.6]">{chat.pendingAnswer}</p>
            </div>
          </div>
        )}

        {interviewerThinking && <ThinkingIndicator reduce={reduce} />}
      </div>

      {/* composer */}
      <div className="sticky bottom-0 border-t border-rule bg-ground/95 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl px-4 py-3.5">
          {inThinkingPhase && s && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-rule bg-surface px-4 py-3 shadow-xs">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-rule bg-surface-sunk text-ink-body">
                <Lightbulb size={16} strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="section-label">Preparation time</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">
                  Read the question and structure your answer, situation, task, action, result.
                </p>
              </div>
              {s.timing.allowSkipThinking && (
                <button
                  type="button"
                  onClick={() => chat.skipThinking()}
                  className={cn(outlinePill, 'h-9 flex-shrink-0 border-signal px-4 text-xs text-signal-ink')}

                >
                  Start answering now
                </button>
              )}
            </div>
          )}
          {isReadiness && breakStage === 'choosing' ? (
            /* Candidate isn't ready — offer a short break with auto-start. */
            <div className="rounded-lg border border-rule bg-surface p-5 text-center shadow-sm">
              <span
                className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-rule bg-surface-sunk text-ink-body"
                aria-hidden="true"
              >
                <Clock size={19} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-medium text-ink-body">
                No problem, take your time. I’ll begin automatically in:
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {[30, 45, 60].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => startBreak(sec)}
                    className={cn(outlinePill, 'h-10 border-signal px-5 text-sm text-signal-ink')}
  
                  >
                    {sec === 60 ? '1 minute' : `${sec} seconds`}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={beginAfterBreak}
                className="mt-4 rounded-sm text-xs font-medium text-ink-muted underline underline-offset-2 transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Actually, I’m ready now
              </button>
            </div>
          ) : isReadiness && breakStage === 'counting' ? (
            /* Break countdown — auto-starts at zero; can start early. */
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-surface p-4 shadow-sm">
              <span className="flex items-baseline gap-2 text-sm text-ink-body" aria-live="polite">
                <span className="font-mono text-2xl font-semibold nums tracking-[-0.02em] text-ink">
                  {mmss(breakRemaining)}
                </span>
                until we begin…
              </span>
              <button
                type="button"
                onClick={beginAfterBreak}
                disabled={chat.sending}
                className={accentPill}
              >
                {chat.sending
                  ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  : <Send size={16} aria-hidden="true" />}
                Start now
              </button>
            </div>
          ) : isReadiness ? (
            /* Opening "are you ready?" turn: a simple Yes/No dropdown, not free text. */
            <div className="rounded-lg border border-rule bg-surface p-4 shadow-sm">
              <p className="section-label mb-2.5">Ready to begin?</p>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <select
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={chat.sending || !inProgress}
                    className="input-base h-11 cursor-pointer appearance-none pr-9 disabled:cursor-not-allowed"
                    aria-label="Are you ready to begin?"
                    autoFocus
                  >
                    <option value="">Select an option…</option>
                    <option value="Yes, I'm ready to begin.">Yes, I'm ready</option>
                    <option value="No, I need a moment.">No, not yet</option>
                  </select>
                  <svg
                    className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-muted"
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
                <button
                  type="button"
                  onClick={submitReadiness}
                  disabled={!canSend}
                  className={cn(accentPill, 'h-11')}
                  aria-label="Send"
                >
                  {chat.sending
                    ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    : <Send size={16} aria-hidden="true" />}
                  Send
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                className="flex items-end gap-2 rounded-lg border border-rule-input bg-surface py-2 pl-4 pr-2 shadow-sm transition-[border-color,box-shadow] duration-fast focus-within:border-signal focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)]"
              >
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                  onPaste={(e) => { if (s?.integrity.disablePasteInAnswers) { e.preventDefault(); onIntegrity?.('paste_blocked') } }}
                  onCopy={(e) => { if (s?.integrity.disableCopy) { e.preventDefault(); onIntegrity?.('copy_blocked') } }}
                  disabled={inThinkingPhase || chat.sending || !inProgress}
                  placeholder={
                    interviewerThinking
                      ? 'Your interviewer is thinking…'
                      : inThinkingPhase
                        ? 'Answering unlocks when preparation ends…'
                        : 'Type your answer…'
                  }
                  rows={2}
                  className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-[1.6] text-ink outline-none placeholder:text-ink-muted disabled:opacity-60"
                  aria-label="Your answer"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSend}
                  className="mb-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-action text-action-ink shadow-sm transition-[background-color,box-shadow] duration-fast hover:bg-action-hover hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-sm"
                  aria-label="Send answer"
                >
                  {chat.sending
                    ? <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                    : <Send size={18} aria-hidden="true" />}
                </button>
              </div>
              <p className="mt-1.5 pr-2 text-right text-[11px] font-medium text-ink-muted">
                Enter to send · Shift + Enter for a new line
              </p>
            </>
          )}
          {chat.error && (
            <div role="alert" className="mt-2.5 flex items-start gap-2.5 rounded-md border border-risk-rule bg-risk-bg px-3.5 py-2.5">
              <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 flex-shrink-0 text-risk" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-risk">{chat.error}</p>
                <p className="mt-0.5 text-xs font-medium leading-relaxed text-risk/85">
                  Check your connection and try again, your saved progress is kept.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </InterviewStage>
  )
}

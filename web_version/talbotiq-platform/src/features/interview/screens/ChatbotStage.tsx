import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Send, Loader2, CheckCircle2, Lightbulb, AlertTriangle, Clock } from 'lucide-react'
import { cn } from '@/components/ui'
import type { BrandingConfig } from '@shared/types'
import { useChatbotSession } from '../useChatbotSession'
import { CircularCountdown } from '../components/CircularCountdown'

interface Props {
  sessionId: string
  branding: BrandingConfig
  onIntegrity?: (type: string) => void
}

/** Small brand mark that anchors every interviewer bubble to the company. */
function InterviewerMark({ branding, accent }: { branding: BrandingConfig; accent: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 flex-shrink-0 select-none items-center justify-center overflow-hidden rounded-md border border-border bg-white text-[11px] font-bold leading-none shadow-xs"
      style={{ color: accent }}
    >
      {branding.logoUrl
        ? <img src={branding.logoUrl} alt="" className="h-full w-full object-contain" />
        : branding.companyName.charAt(0).toUpperCase()}
    </span>
  )
}

/** Claude-style "Thinking…" indicator — pulsing dots (or a static label under
 *  reduced motion). Its ≥3s minimum lifetime is enforced by the session hook. */
function ThinkingIndicator({ reduce, branding, accent }: { reduce: boolean | null; branding: BrandingConfig; accent: string }) {
  return (
    <div className="flex items-end justify-start gap-2.5">
      <InterviewerMark branding={branding} accent={accent} />
      <div
        className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-border bg-white px-4 py-3.5 shadow-xs"
        role="status"
        aria-live="polite"
        aria-label="Interviewer is thinking"
      >
        {reduce ? (
          <span className="text-sm font-medium text-neutral-500">Thinking…</span>
        ) : (
          <>
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-neutral-400"
                animate={{ opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
              />
            ))}
            <span className="ml-1.5 text-xs font-medium text-neutral-400">Thinking…</span>
          </>
        )}
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
  const accent = branding.accentColor || '#0B7A45'
  const accentVar = { '--accent': accent } as CSSProperties
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

  /* Shared control shapes — the accent is candidate-branded, so these carry it
     through inline style rather than a static token class. */
  const accentPill = 'inline-flex h-10 items-center justify-center gap-1.5 rounded-md px-5 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-sm'
  const outlinePill = 'inline-flex items-center justify-center rounded-md border-[1.5px] bg-white font-semibold transition-colors duration-150 hover:bg-neutral-50'

  if (s?.finished) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md overflow-hidden rounded-3xl border border-border bg-white shadow-xl"
        >
          <div className="h-1.5 w-full" style={{ background: accent }} aria-hidden="true" />
          <div className="p-10 text-center">
            <span
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: `${accent}14`, color: accent }}
            >
              <CheckCircle2 size={30} strokeWidth={1.75} />
            </span>
            <h1 className="mt-6 font-display text-2xl font-extrabold tracking-[-0.03em] text-neutral-900">
              All done, thank you!
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-neutral-500">
              Your responses were submitted to {branding.companyName}. The hiring team will be in touch.
            </p>
            <div className="divider my-7" />
            <p className="text-xs text-neutral-400">You can safely close this window.</p>
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* header */}
      <div className="sticky top-0 z-10 border-b border-border bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="h-7 w-7 flex-shrink-0 rounded-lg object-contain" />
            ) : (
              <span
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{ background: accent }}
              >
                {branding.companyName.charAt(0)}
              </span>
            )}
            <span className="truncate font-display text-sm font-bold tracking-[-0.01em] text-neutral-800">
              {branding.companyName}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {s && s.progress.total > 0 && s.progress.current > 0 && (
              <span className="hidden text-xs font-semibold tabular-nums text-neutral-500 sm:inline">
                Question {s.progress.current} <span className="text-neutral-400">of {s.progress.total}</span>
              </span>
            )}
            {/* Countdown ring — shown ONLY while a timed question turn is armed
                (never during greeting/readiness/thinking-indicator/wrap-up). */}
            {s?.phase && (
              <CircularCountdown
                remaining={chat.remaining}
                total={s.totalPhaseSeconds}
                phase={s.phase === 'thinking' ? 'prep' : 'answer'}
                warningThreshold={s.timing.warningThresholdSeconds}
                accentColor={accent}
                size={60}
              />
            )}
          </div>
        </div>
      </div>

      {/* transcript */}
      <div ref={scrollRef} className="mx-auto w-full max-w-3xl flex-1 space-y-3.5 overflow-y-auto px-4 py-7">
        {visibleTranscript.map((t) => (
          <motion.div
            key={t.id}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn('flex items-end gap-2.5', t.role === 'candidate' ? 'justify-end' : 'justify-start')}
          >
            {t.role !== 'candidate' && <InterviewerMark branding={branding} accent={accent} />}
            <div
              className={
                t.role === 'candidate'
                  ? 'max-w-[76%] rounded-2xl rounded-br-md px-4 py-3 text-[15px] text-white shadow-sm'
                  : 'max-w-[76%] rounded-2xl rounded-bl-md border border-border bg-white px-4 py-3 text-[15px] text-neutral-800 shadow-xs'
              }
              style={t.role === 'candidate' ? { background: accent } : undefined}
            >
              <p className="whitespace-pre-wrap leading-[1.6]">{t.content}</p>
            </div>
          </motion.div>
        ))}

        {/* Optimistic candidate bubble — keeps their answer on screen while the
            interviewer "thinks" (the real turn replaces it on reveal). */}
        {chat.pendingAnswer && chat.pendingAnswer.trim() !== '' && (
          <div className="flex items-end justify-end gap-2.5">
            <div className="max-w-[76%] rounded-2xl rounded-br-md px-4 py-3 text-[15px] text-white opacity-90 shadow-sm" style={{ background: accent }}>
              <p className="whitespace-pre-wrap leading-[1.6]">{chat.pendingAnswer}</p>
            </div>
          </div>
        )}

        {interviewerThinking && <ThinkingIndicator reduce={reduce} branding={branding} accent={accent} />}
      </div>

      {/* composer */}
      <div className="sticky bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl px-4 py-3.5">
          {inThinkingPhase && s && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-white px-4 py-3 shadow-xs">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-warning-border bg-warning-bg text-warning">
                <Lightbulb size={16} strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-warning">Preparation time</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-neutral-600">
                  Read the question and structure your answer — situation, task, action, result.
                </p>
              </div>
              {s.timing.allowSkipThinking && (
                <button
                  type="button"
                  onClick={() => chat.skipThinking()}
                  className={cn(outlinePill, 'h-9 flex-shrink-0 px-4 text-xs')}
                  style={{ borderColor: accent, color: accent }}
                >
                  Start answering now
                </button>
              )}
            </div>
          )}
          {isReadiness && breakStage === 'choosing' ? (
            /* Candidate isn't ready — offer a short break with auto-start. */
            <div className="rounded-2xl border border-border bg-white p-5 text-center shadow-sm">
              <span
                className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ background: `${accent}14`, color: accent }}
              >
                <Clock size={19} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-medium text-neutral-700">
                No problem — take your time. I’ll begin automatically in:
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {[30, 45, 60].map((sec) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => startBreak(sec)}
                    className={cn(outlinePill, 'h-10 px-5 text-sm')}
                    style={{ borderColor: accent, color: accent }}
                  >
                    {sec === 60 ? '1 minute' : `${sec} seconds`}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={beginAfterBreak}
                className="mt-4 text-xs font-medium text-neutral-500 underline underline-offset-2 transition-colors duration-150 hover:text-neutral-800"
              >
                Actually, I’m ready now
              </button>
            </div>
          ) : isReadiness && breakStage === 'counting' ? (
            /* Break countdown — auto-starts at zero; can start early. */
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-white p-4 shadow-sm">
              <span className="flex items-baseline gap-2 text-sm text-neutral-600" aria-live="polite">
                <span className="font-display text-2xl font-extrabold tabular-nums tracking-[-0.02em]" style={{ color: accent }}>
                  {mmss(breakRemaining)}
                </span>
                until we begin…
              </span>
              <button
                type="button"
                onClick={beginAfterBreak}
                disabled={chat.sending}
                className={accentPill}
                style={{ background: accent }}
              >
                {chat.sending
                  ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  : <Send size={16} aria-hidden="true" />}
                Start now
              </button>
            </div>
          ) : isReadiness ? (
            /* Opening "are you ready?" turn: a simple Yes/No dropdown, not free text. */
            <div className="rounded-2xl border border-border bg-white p-4 shadow-sm" style={accentVar}>
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500">Ready to begin?</p>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <select
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={chat.sending || !inProgress}
                    className="h-11 w-full cursor-pointer appearance-none rounded-xl border-[1.5px] border-border bg-white pl-3.5 pr-9 text-sm text-neutral-800 outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Are you ready to begin?"
                    autoFocus
                  >
                    <option value="">Select an option…</option>
                    <option value="Yes, I'm ready to begin.">Yes, I'm ready</option>
                    <option value="No, I need a moment.">No, not yet</option>
                  </select>
                  <svg
                    className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400"
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
                  style={{ background: accent }}
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
                className="flex items-end gap-2 rounded-[26px] border border-border bg-white py-2 pl-4 pr-2 shadow-sm transition-[border-color,box-shadow] duration-150 focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_12%,transparent)]"
                style={accentVar}
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
                  className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-[1.6] text-neutral-800 outline-none placeholder:text-neutral-400 disabled:opacity-60"
                  aria-label="Your answer"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSend}
                  className="mb-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all duration-150 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-sm"
                  style={{ background: accent }}
                  aria-label="Send answer"
                >
                  {chat.sending
                    ? <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                    : <Send size={18} aria-hidden="true" />}
                </button>
              </div>
              <p className="mt-1.5 pr-2 text-right text-[11px] font-medium text-neutral-400">
                Enter to send · Shift + Enter for a new line
              </p>
            </>
          )}
          {chat.error && (
            <div role="alert" className="mt-2.5 flex items-start gap-2.5 rounded-xl border border-danger-border bg-danger-bg px-3.5 py-2.5">
              <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 flex-shrink-0 text-danger" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-danger">{chat.error}</p>
                <p className="mt-0.5 text-xs font-medium leading-relaxed text-danger/85">
                  Check your connection and try again — your saved progress is kept.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

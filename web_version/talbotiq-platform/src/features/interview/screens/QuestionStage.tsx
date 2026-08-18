import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, Lightbulb, Send, FastForward, Lock, Loader2 } from 'lucide-react'
import { cn } from '@/components/ui'
import { CircularCountdown } from '../components/CircularCountdown'
import { CameraRecorder } from '../components/CameraRecorder'
import type { CandidateSessionState } from '@shared/types'

interface Props {
  state: CandidateSessionState
  remaining: number
  secondsLeft: number
  busy: boolean
  onSkipPrep: () => void
  onSubmit: (answer: string) => void
  onSaveDraft: (draft: string) => void
  onIntegrity?: (type: string) => void
}

export function QuestionStage({
  state, remaining, secondsLeft, busy, onSkipPrep, onSubmit, onSaveDraft, onIntegrity,
}: Props) {
  const reduce = useReducedMotion()
  const { phase, timing, integrity, question, track } = state
  const isAnswer = phase === 'answer'
  const warning = isAnswer && secondsLeft <= timing.warningThresholdSeconds

  const [text, setText] = useState(state.draft ?? '')
  const textRef = useRef(text)
  textRef.current = text
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus the answer box the moment the answer phase opens.
  useEffect(() => {
    if (isAnswer && track === 'chat') taRef.current?.focus()
  }, [isAnswer, track])

  // Debounced draft auto-save + flush on unmount (so a refresh / auto-submit keeps text).
  useEffect(() => {
    const id = setTimeout(() => onSaveDraft(textRef.current), 900)
    return () => clearTimeout(id)
  }, [text, onSaveDraft])
  useEffect(() => () => { onSaveDraft(textRef.current) }, [onSaveDraft])

  if (!question) return null

  const accent = state.branding.accentColor
  const accentVar = { '--accent': accent } as CSSProperties
  const words = text.trim().split(/\s+/).filter(Boolean).length

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduce ? undefined : { opacity: 0, x: -24 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      {/* Question + countdown */}
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 pt-1">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em]',
              isAnswer
                ? 'border-success-border bg-success-bg text-success'
                : 'border-neutral-200 bg-neutral-100 text-neutral-500',
            )}
          >
            {isAnswer && <span className="live-dot" aria-hidden="true" />}
            {isAnswer ? 'Answering' : 'Preparation'}
          </span>
          <h2 className="mt-4 text-balance font-display text-[26px] font-extrabold leading-[1.22] tracking-[-0.03em] text-neutral-900 sm:text-[30px]">
            {question.text}
          </h2>
        </div>
        <div className="flex-shrink-0">
          <CircularCountdown
            remaining={remaining}
            total={state.totalPhaseSeconds}
            phase={phase ?? 'prep'}
            warningThreshold={timing.warningThresholdSeconds}
            accentColor={state.branding.accentColor}
          />
        </div>
      </div>

      {/* Preparation tip — composed row, warning accent on a calm neutral card */}
      {!isAnswer && (
        <div className="flex items-start gap-3.5 rounded-2xl border border-border bg-neutral-50 p-4">
          <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-warning-border bg-warning-bg text-warning">
            <Lightbulb size={17} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-warning">Interview tip</p>
            <p className="mt-1 text-sm leading-relaxed text-neutral-700">
              Structure your answer with <strong className="font-semibold text-neutral-900">STAR</strong>, situation,
              task, action, result.
            </p>
          </div>
        </div>
      )}

      {/* Answer surface */}
      {track === 'video_avatar' ? (
        <CameraRecorder active={isAnswer} accentColor={state.branding.accentColor} />
      ) : (
        <div
          style={accentVar}
          className={cn(
            'overflow-hidden rounded-2xl border-[1.5px] transition-[border-color,box-shadow] duration-150',
            isAnswer
              ? 'border-border bg-white focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_14%,transparent)]'
              : 'border-dashed border-neutral-200 bg-neutral-50',
          )}
        >
          <div className={cn('flex items-center justify-between gap-3 border-b px-5 py-2.5', isAnswer ? 'border-border' : 'border-neutral-200')}>
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500">Your answer</span>
            {isAnswer ? (
              <span className="text-xs font-medium tabular-nums text-neutral-400">
                {words} {words === 1 ? 'word' : 'words'}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-neutral-400">
                <Lock size={12} strokeWidth={2} aria-hidden="true" /> Unlocks when the answer timer starts
              </span>
            )}
          </div>
          <textarea
            ref={taRef}
            value={text}
            disabled={!isAnswer || busy}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => { if (integrity.disablePasteInAnswers) { e.preventDefault(); onIntegrity?.('paste_blocked') } }}
            onCopy={(e) => { if (integrity.disableCopy) { e.preventDefault(); onIntegrity?.('copy_blocked') } }}
            placeholder={isAnswer ? 'Type your answer here…' : 'Your answer box unlocks when the answer timer begins.'}
            aria-label="Your answer"
            className={cn(
              'h-56 w-full resize-none bg-transparent px-5 py-4 text-[15px] leading-[1.7] text-neutral-800 outline-none placeholder:text-neutral-400',
              !isAnswer && 'cursor-not-allowed text-neutral-400',
            )}
          />
        </div>
      )}

      {/* Auto-submit warning */}
      {warning && (
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          role="alert"
          className="flex items-center gap-3 rounded-2xl border border-danger-border bg-danger-bg px-4 py-3"
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-danger-border bg-white text-danger">
            <AlertTriangle size={15} strokeWidth={2} />
          </span>
          <p className="text-sm font-semibold text-danger">
            <span className="tabular-nums">{secondsLeft}s</span> left, your answer submits automatically at zero.
          </p>
        </motion.div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xs text-xs leading-relaxed text-neutral-400">
          {isAnswer
            ? 'Saved as you type. You can’t return to this question once you continue.'
            : 'Read the question and gather your thoughts.'}
        </p>
        <div className="flex gap-2">
          {!isAnswer && timing.allowSkipPrep && (
            <button
              type="button"
              onClick={onSkipPrep}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-md border-[1.5px] bg-white px-5 text-sm font-semibold transition-all duration-150 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderColor: accent, color: accent }}
            >
              {busy
                ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                : <FastForward size={16} aria-hidden="true" />}
              Start answering now
            </button>
          )}
          {isAnswer && timing.allowEarlySubmit && (
            <button
              type="button"
              onClick={() => onSubmit(text)}
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-md px-6 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              style={{ background: accent }}
            >
              {busy
                ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                : <Send size={16} aria-hidden="true" />}
              Submit &amp; continue
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}

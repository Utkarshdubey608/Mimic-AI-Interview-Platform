import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, Lightbulb, Send, FastForward, Lock, Check } from 'lucide-react'
import { cn, Button } from '@/components/ui'
import { stageVariants } from '@/design/motion'
import { CircularCountdown } from '../components/CircularCountdown'
import { CameraRecorder } from '../components/CameraRecorder'
import type { CandidateSessionState } from '@shared/types'

/**
 * TIMED Q&A — the written interview stage.
 *
 * A distraction-free canvas for someone composing prose against a clock. Three
 * things carry the design:
 *
 *   THE QUESTION IS THE PAGE. It is set at display size with a real measure,
 *   because it is the only thing on screen the candidate has to hold in their
 *   head while they write.
 *
 *   PREPARATION AND ANSWERING LOOK DIFFERENT. During preparation the answer box
 *   is visibly, explicitly locked rather than merely inert — a disabled textarea
 *   with no explanation reads as a bug, and a candidate who thinks the page is
 *   broken spends their preparation time debugging it.
 *
 *   THE SAVE STATE IS VISIBLE. "Saved as you type" is a promise, and a promise
 *   about someone's assessment answers has to be shown being kept, not asserted
 *   once in grey text.
 */

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

type SaveState = 'idle' | 'saving' | 'saved'

export function QuestionStage({
  state, remaining, secondsLeft, busy, onSkipPrep, onSubmit, onSaveDraft, onIntegrity,
}: Props) {
  const reduce = useReducedMotion() ?? false
  const { phase, timing, integrity, question, track } = state
  const isAnswer = phase === 'answer'
  const warning = isAnswer && secondsLeft <= timing.warningThresholdSeconds

  const [text, setText] = useState(state.draft ?? '')
  const [save, setSave] = useState<SaveState>('idle')
  const textRef = useRef(text)
  textRef.current = text
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Focus the answer box the moment the answer phase opens, so the candidate
  // does not spend their first seconds looking for where to type.
  useEffect(() => {
    if (isAnswer && track === 'chat') taRef.current?.focus()
  }, [isAnswer, track])

  // Debounced draft auto-save, with the save state surfaced. The flush on
  // unmount is what makes a refresh or an auto-submit keep the text.
  useEffect(() => {
    if (!text) return
    setSave('saving')
    const id = setTimeout(() => {
      onSaveDraft(textRef.current)
      setSave('saved')
    }, 900)
    return () => clearTimeout(id)
  }, [text, onSaveDraft])
  useEffect(() => () => { onSaveDraft(textRef.current) }, [onSaveDraft])

  if (!question) return null

  const words = text.trim().split(/\s+/).filter(Boolean).length

  return (
    <motion.div
      key={question.id}
      variants={stageVariants(reduce)}
      initial="initial"
      animate="animate"
      exit="exit"
      className="space-y-6"
    >
      {/* ── The question ──────────────────────────────────────────────────
          Set as the page's subject, with the countdown beside it rather than
          above it, so the eye lands on the words first and the clock second. */}
      <div className="flex items-start justify-between gap-5">
        <h2 className="measure min-w-0 text-balance pt-1 font-display text-[26px] font-bold leading-[1.22] text-ink sm:text-[30px]">
          {question.text}
        </h2>
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

      {/* ── Preparation guidance ──────────────────────────────────────────
          Present only while preparing. Once the answer window opens it is
          removed rather than greyed: at that point it is competing for the
          attention the candidate needs for their own answer. */}
      {!isAnswer && (
        <div className="flex items-start gap-3.5 rounded-lg border border-rule bg-surface-sunk p-4">
          <span
            className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-rule bg-surface text-ink-body"
            aria-hidden="true"
          >
            <Lightbulb size={17} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">While you prepare</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              A structured answer scores better than a longer one. Try{' '}
              <strong className="font-semibold text-ink-body">situation, task, action, result</strong>: what
              the circumstances were, what you were responsible for, what you did, and
              what changed because of it.
            </p>
          </div>
        </div>
      )}

      {/* ── The answer surface ────────────────────────────────────────────── */}
      {track === 'video_avatar' ? (
        <CameraRecorder active={isAnswer} accentColor={state.branding.accentColor} />
      ) : (
        <div
          className={cn(
            'overflow-hidden rounded-lg border transition-[border-color,box-shadow] duration-fast',
            isAnswer
              ? 'border-rule-input bg-surface focus-within:border-signal focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_18%,transparent)]'
              : 'border-dashed border-rule bg-surface-sunk',
          )}
        >
          <div className={cn('flex items-center justify-between gap-3 border-b px-4 py-2.5', isAnswer ? 'border-rule' : 'border-rule')}>
            <span className="section-label">Your answer</span>

            {isAnswer ? (
              <span className="flex items-center gap-3">
                {/* The save state, shown rather than promised. */}
                <span className="flex items-center gap-1.5 text-xs text-ink-muted" aria-live="polite">
                  {save === 'saving' && <>Saving…</>}
                  {save === 'saved' && (
                    <><Check size={12} strokeWidth={2.5} aria-hidden="true" /> Saved</>
                  )}
                </span>
                <span className="font-mono text-xs nums text-ink-muted">
                  {words} {words === 1 ? 'word' : 'words'}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                <Lock size={12} strokeWidth={2} aria-hidden="true" />
                Unlocks when the answer timer starts
              </span>
            )}
          </div>

          <textarea
            ref={taRef}
            value={text}
            disabled={!isAnswer || busy}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              if (integrity.disablePasteInAnswers) { e.preventDefault(); onIntegrity?.('paste_blocked') }
            }}
            onCopy={(e) => {
              if (integrity.disableCopy) { e.preventDefault(); onIntegrity?.('copy_blocked') }
            }}
            placeholder={isAnswer ? 'Type your answer here…' : 'Your answer box unlocks when the answer timer begins.'}
            aria-label="Your answer"
            className={cn(
              'h-56 w-full resize-none bg-transparent px-4 py-3.5 text-[15px] leading-[1.7] text-ink outline-none placeholder:text-ink-muted',
              !isAnswer && 'cursor-not-allowed text-ink-muted',
            )}
          />
        </div>
      )}

      {/* ── Auto-submit warning ───────────────────────────────────────────
          role="alert" so it is announced, and the seconds are in the text so it
          says the same thing to someone who cannot see the colour. */}
      {warning && (
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          role="alert"
          className="flex items-center gap-3 rounded-lg border border-risk-rule bg-risk-bg px-4 py-3"
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-risk-rule bg-surface text-risk" aria-hidden="true">
            <AlertTriangle size={15} strokeWidth={2} />
          </span>
          <p className="text-sm font-semibold text-risk">
            <span className="font-mono nums">{secondsLeft}s</span> left, your answer submits automatically at zero.
          </p>
        </motion.div>
      )}

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xs text-xs leading-relaxed text-ink-muted">
          {isAnswer
            ? 'Saved as you type. You cannot return to this question once you continue.'
            : 'Read the question and gather your thoughts. Nothing is being recorded yet.'}
        </p>
        <div className="flex gap-2">
          {!isAnswer && timing.allowSkipPrep && (
            <Button
              variant="outline" size="md" onClick={onSkipPrep} loading={busy}
              icon={<FastForward size={16} />}
            >
              Start answering now
            </Button>
          )}
          {isAnswer && timing.allowEarlySubmit && (
            <Button
              size="md" onClick={() => onSubmit(text)} loading={busy}
              icon={<Send size={16} />}
            >
              Submit &amp; continue
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  )
}

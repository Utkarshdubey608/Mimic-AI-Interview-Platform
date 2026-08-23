import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, Send, FastForward, Loader2, Camera } from 'lucide-react'
import { Button } from '@/components/ui'
import { CircularCountdown } from '../components/CircularCountdown'
import { useAnswerRecorder } from '../useAnswerRecorder'
import { sessionsApi } from '@/lib/api'
import type { CandidateSessionState } from '@shared/types'

interface Props {
  sessionId: string
  state: CandidateSessionState
  remaining: number
  secondsLeft: number
  busy: boolean
  rec: ReturnType<typeof useAnswerRecorder>
  onSkipPrep: () => void
  onSubmitText: (answerText: string) => Promise<boolean>
  onIntegrity?: (type: string) => void
}

/** Inline banner — one shape for the warning and error notices below the stage. */
function Notice({ tone, children, alert }: { tone: 'danger' | 'warning'; children: ReactNode; alert?: boolean }) {
  const tones = {
    danger: 'border-risk-rule bg-risk-bg text-risk',
    warning: 'border-warn-rule bg-warn-bg text-warn',
  }
  return (
    <div
      role={alert ? 'alert' : undefined}
      className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm font-medium leading-relaxed ${tones[tone]}`}
    >
      <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  )
}

/**
 * Video Interview answer screen. Runs on the shared timed engine: 30s prep
 * (camera preview live) → answer phase auto-starts live transcription off the
 * shared stream's audio track (Deepgram relay) → the candidate submits (or a
 * small client buffer before the server deadline auto-submits), which stops
 * transcribing and submits the accumulated transcript as the answer text. No
 * video is recorded/uploaded.
 */
export function VideoStage({ sessionId, state, remaining, secondsLeft, busy, rec, onSkipPrep, onSubmitText, onIntegrity }: Props) {
  const reduce = useReducedMotion()
  const { phase, timing, question, branding } = state
  const videoEl = useRef<HTMLVideoElement>(null)
  const [uploading, setUploading] = useState(false)
  const [submitFailed, setSubmitFailed] = useState(false)
  const submittingRef = useRef(false)
  const facialDoneRef = useRef(false)
  const isAnswer = phase === 'answer'
  const warning = isAnswer && secondsLeft <= timing.warningThresholdSeconds
  const total = state.progress.total

  // Acquire the camera once, attach the live preview.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void rec.acquire().catch(() => onIntegrity?.('camera_denied')) }, [])            // acquire once
  useEffect(() => { if (rec.ready && videoEl.current) rec.attachPreview(videoEl.current) }, [rec.ready])

  // Start live transcription when the answer phase opens.
  useEffect(() => { if (isAnswer && rec.ready && !rec.recording) rec.startTranscribing() }, [isAnswer, rec.ready, rec.recording])

  // Facial capture (Task 7): start once the camera is ready (startFacial is
  // idempotent, so this is safe across VideoStage remounts per question), and
  // keep it pointed at the current question for per-question bucketing.
  useEffect(() => { if (rec.ready && !facialDoneRef.current) rec.startFacial(sessionId, total) }, [rec, rec.ready, sessionId, total])
  useEffect(() => { rec.setFacialQuestion(Math.max(0, state.progress.current - 1)) }, [rec, state.progress.current])

  const doSubmit = async () => {
    if (submittingRef.current || !question) return
    submittingRef.current = true
    setUploading(true)                         // reuse as a brief "submitting" state
    try {
      const transcript = await rec.stopTranscribing()
      const ok = await onSubmitText(transcript)
      if (!ok) setSubmitFailed(true)
    } catch (err) {
      console.error('[video] submit failed', err)
      setSubmitFailed(true)
    } finally {
      // Last question: stop facial capture and upload the aggregated summary.
      // Its own try/catch, run regardless of whether the video upload/submit
      // above threw — otherwise a failure on the LAST question would lose the
      // facial summary AND leave the Rekognition capture loop running.
      if (state.progress.current >= total) {
        try {
          const summary = rec.stopFacial(total)
          facialDoneRef.current = true
          if (summary) await sessionsApi.facial(sessionId, summary)
        } catch (err) { console.error('[video] facial upload failed', err) }
      }
      setUploading(false)
      submittingRef.current = false
    }
  }

  // Client-side pre-emptive submit ~3s before the server deadline so the transcript
  // is submitted before the engine's own empty auto-submit advances the question.
  useEffect(() => {
    if (isAnswer && secondsLeft <= 3 && !submittingRef.current) void doSubmit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnswer, secondsLeft])

  if (!question) return null

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduce ? undefined : { opacity: 0, x: -24 }}
      transition={{ duration: 0.25 }}
      className="space-y-6"
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            {isAnswer ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-ok-rule bg-ok-bg px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-ok">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Recording answer
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md border border-rule bg-surface-hover px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                Preparation
              </span>
            )}
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted tabular-nums">
              Question {Math.min(state.progress.current, total)} of {total}
            </span>
          </div>
          <h2 className="mt-3 font-display text-2xl font-extrabold leading-snug tracking-[-0.03em] text-ink">{question.text}</h2>
        </div>
        <div className="flex-shrink-0">
          <CircularCountdown
            remaining={remaining}
            total={state.totalPhaseSeconds}
            phase={phase ?? 'prep'}
            warningThreshold={timing.warningThresholdSeconds}
            accentColor={branding.accentColor}
          />
        </div>
      </div>

      {/* Camera stage */}
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-rule bg-brand-black shadow-lg">
        <video ref={videoEl} autoPlay muted playsInline className="h-full w-full object-cover" />

        {/* camera warming up, placeholder for the frame that's about to arrive */}
        {!rec.ready && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-brand-card">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-brand-border bg-white/5 text-brand-gray">
              <Camera size={22} />
            </span>
            <div className="flex flex-col items-center gap-2">
              <span className="text-sm font-medium text-brand-gray">Starting your camera…</span>
              <span className="h-1.5 w-36 animate-pulse rounded-full bg-white/10" />
            </div>
          </div>
        )}

        {/* status chip */}
        {rec.ready && (
          rec.recording ? (
            <span className="absolute left-3 top-3 z-5 flex items-center gap-1.5 rounded-md border border-white/10 bg-brand-black/70 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> Rec
            </span>
          ) : (
            <span className="absolute left-3 top-3 z-5 flex items-center gap-1.5 rounded-md border border-white/10 bg-brand-black/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
              <Camera size={12} /> Preview
            </span>
          )
        )}

        {/* prep overlay */}
        {!isAnswer && rec.ready && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-brand-black/55 px-6 text-center backdrop-blur-[2px]">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-gold-light">Preparation time</p>
            <p className="max-w-xs text-sm font-medium leading-relaxed text-white/90">
              Read the question and get ready. Answer aloud, the timer starts your response.
            </p>
          </div>
        )}

        {uploading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-brand-black/75 backdrop-blur-[2px]">
            <Loader2 size={24} className="animate-spin text-brand-gold-light" />
            <p className="text-sm font-medium text-white">Saving your answer…</p>
          </div>
        )}
      </div>

      {submitFailed && (
        <Notice tone="danger" alert>
          We couldn’t confirm that your answer was submitted. If the interview has already moved on, that question may be
          missing its transcript, let the hiring team know.
        </Notice>
      )}
      {rec.error && <Notice tone="danger" alert>{rec.error}</Notice>}
      {warning && !uploading && (
        <Notice tone="warning">
          <span className="tabular-nums">{secondsLeft}s</span> left, your answer submits automatically.
        </Notice>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-xs leading-relaxed text-ink-muted">
          {isAnswer ? 'You can’t return to this question once you continue.' : 'Read the question and gather your thoughts.'}
        </p>
        <div className="flex gap-2.5">
          {!isAnswer && timing.allowSkipPrep && (
            <Button
              variant="outline"
              size="md"
              onClick={onSkipPrep}
              disabled={busy || !rec.ready}
              icon={<FastForward size={16} />}
            >
              Start recording now
            </Button>
          )}
          {isAnswer && timing.allowEarlySubmit && (
            <Button
              size="md"
              onClick={() => void doSubmit()}
              loading={busy || uploading}
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

interface VideoInterviewProps {
  sessionId: string
  state: CandidateSessionState
  remaining: number
  secondsLeft: number
  busy: boolean
  onSkipPrep: () => void
  onSubmitText: (answerText: string) => Promise<boolean>
  onIntegrity?: (type: string) => void
}

/** Stable owner of the camera stream for the whole video interview. VideoStage
 *  remounts per question (for the slide transition); the stream persists here. */
export function VideoInterview(props: VideoInterviewProps) {
  const rec = useAnswerRecorder()
  return (
    <AnimatePresence mode="wait">
      <VideoStage key={props.state.question?.id ?? 'q'} rec={rec} {...props} />
    </AnimatePresence>
  )
}

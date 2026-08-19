import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { Button, Skeleton } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { useInterviewClock } from './useInterviewClock'
import { useIntegrityMonitor } from './useIntegrityMonitor'
import { InterviewStage, PhaseMark, StageTimer } from './stage/InterviewStage'
import { IntegrityGate } from './stage/IntegrityGate'
import { completionCallFor } from './integrityPolicy'
import { sessionsApi } from '@/lib/api'
import type { PreflightStep } from './stage/Preflight'
import { TrackSelect } from './screens/TrackSelect'
import { Welcome } from './screens/Welcome'
import { DeviceCheck } from './stage/DeviceCheck'
import { ResumeUpload } from './screens/ResumeUpload'
import { QuestionStage } from './screens/QuestionStage'
import { ChatbotStage } from './screens/ChatbotStage'
import { McqStage } from './screens/McqStage'
import { AvatarStage } from './screens/AvatarStage'
import { VoiceStage } from './screens/VoiceStage'
import { TwoWayStage } from './screens/TwoWayStage'
import { VideoInterview } from './screens/VideoStage'
import { Completion } from './screens/Completion'
import type { BrandingConfig } from '@shared/types'

/**
 * The candidate journey, end to end.
 *
 * The state machine is unchanged — `useInterviewClock` still owns the session,
 * the same six tracks still branch to the same six engines, and every API call
 * is where it was. What changed is that all of them now render inside
 * `InterviewStage`, so a candidate gets the same identity, progress, timer, help
 * and integrity affordances whichever format their recruiter chose.
 *
 * The four conversational tracks mount their own `InterviewStage` internally
 * rather than being wrapped here, because each owns its full-screen layout
 * (a video room's transport tray and connection meter are not things this
 * component can supply). They consume the same shell; they just configure it
 * themselves.
 */

const FALLBACK_BRANDING: BrandingConfig = { companyName: 'Mimic', accentColor: '#1D3FA0' }

export default function TakeInterviewPage() {
  const { sessionId = '' } = useParams()
  const { signOutUser } = useAuth()
  const clock = useInterviewClock(sessionId)
  const [preStep, setPreStep] = useState<PreflightStep>('track')
  const [chatbotStarted, setChatbotStarted] = useState(false)
  // Hooks must run unconditionally, before the early returns below.
  //
  // `active` is deliberately `status === 'in_progress'`: the monitor must not
  // count anything during pre-flight (a candidate reading the rules in another
  // tab has broken no rule) nor after completion (they have finished; their
  // inbox is their own business).
  const integrity = useIntegrityMonitor(sessionId, clock.state?.integrity, clock.state?.status === 'in_progress')

  /* ── Auto-submit when the integrity limit is spent ─────────────────────
     The six tracks do not share one completion path, so the call is chosen from
     the track. Calling the timed engine's complete() on an avatar interview
     would end it in the UI while the Tavus room carried on running. */
  const track = clock.state?.track
  const endForIntegrity = useCallback(() => {
    if (!track) return
    const call = completionCallFor(track)
    // The timed engine goes through the clock's own `completeNow`, which routes
    // via the same `action()` wrapper as every other transition and refreshes
    // the session afterwards. Bypassing it with a bare API call would leave the
    // clock holding a stale `in_progress` state.
    const done =
      call === 'avatarComplete' ? sessionsApi.avatarComplete(sessionId)
      : call === 'twowayComplete' ? sessionsApi.twowayComplete(sessionId)
      : clock.completeNow()
    // Best effort, and deliberately so: the candidate has already been told the
    // interview is over. If this request fails the server still holds every
    // answer that was submitted, and its own timers close the session out.
    void Promise.resolve(done).catch(() => {}).finally(() => { void clock.refresh() })
  }, [track, sessionId, clock])

  const gate = (
    <IntegrityGate
      notice={integrity.notice}
      onAcknowledge={integrity.acknowledge}
      onEnded={endForIntegrity}
    />
  )

  /* ── Initial load ──────────────────────────────────────────────────────
     The skeleton mirrors the real shell and the real card, at the real
     heights, so nothing moves when the data lands. */
  if (clock.loading && !clock.state) {
    return (
      <div className="flex min-h-screen flex-col bg-ground">
        <header className="border-b border-rule bg-surface/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-4xl items-center gap-2.5 px-5">
            <Skeleton className="h-7 w-7 rounded-md" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        </header>
        <main className="flex flex-1 items-start justify-center px-4 py-8 sm:px-5 sm:py-10">
          <div
            className="w-full max-w-2xl rounded-xl border border-rule bg-surface p-6 shadow-lg sm:p-8"
            role="status"
            aria-label="Loading your interview"
          >
            <Skeleton className="h-3 w-40" />
            <Skeleton className="mt-6 h-8 w-3/4" />
            <Skeleton className="mt-3 h-4 w-1/2" />
            <div className="mt-8 space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
            <Skeleton className="mt-8 h-11 w-44" />
          </div>
        </main>
      </div>
    )
  }

  /* ── Hard error: a bad link, or the wrong account ─────────────────────── */
  if (clock.error && !clock.state) {
    const wrongAccount = /different email/i.test(clock.error)
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground px-5 py-10">
        <div className="w-full max-w-md rounded-xl border border-rule bg-surface p-8 text-center shadow-lg">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-risk-rule bg-risk-bg text-risk" aria-hidden="true">
            <AlertTriangle size={22} strokeWidth={1.75} />
          </span>
          <h1 className="mt-5 text-balance font-display text-xl font-bold tracking-[-0.02em] text-ink">
            {wrongAccount ? 'Signed in with a different account' : 'We couldn’t open this interview'}
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-ink-muted">
            {clock.error}{wrongAccount ? '' : '. Please double-check your invite link.'}
          </p>
          <Button onClick={() => { void signOutUser() }} className="mt-6">
            {wrongAccount ? 'Sign out & switch account' : 'Sign out and try again'}
          </Button>
          <p className="mt-4 text-xs leading-relaxed text-ink-muted">
            Still stuck? Reply to your invite email and the hiring team will send a fresh link.
          </p>
        </div>
      </div>
    )
  }

  const s = clock.state!
  const branding = s.branding ?? FALLBACK_BRANDING

  if (s.status === 'completed' || s.status === 'expired') {
    return (
      <InterviewStage branding={branding} track={s.track} ground="record">
        <Completion branding={branding} sessionId={sessionId} />
      </InterviewStage>
    )
  }

  /* ── Conversational and realtime tracks ────────────────────────────────
     Each runs its own full-screen engine and mounts InterviewStage itself,
     because only they know their transport controls and connection state. */
  /* MCQ is neither conversational nor timed: it runs its own paper, mounts its
     own stage, and needs no résumé, no devices and no engine. It therefore comes
     BEFORE the pre-step machinery below, which exists to choose a format and
     collect a résumé neither of which apply to a written assessment. */
  if (s.track === 'mcq') {
    return <>{gate}<McqStage sessionId={sessionId} branding={branding} onIntegrity={integrity.post} /></>
  }
  if (s.track === 'chatbot' && (chatbotStarted || s.status === 'in_progress')) {
    return <>{gate}<ChatbotStage sessionId={sessionId} branding={branding} onIntegrity={integrity.post} /></>
  }
  if (s.track === 'video_avatar' && (chatbotStarted || s.status === 'in_progress')) {
    // First entry runs the on-device face-framing pre-flight inside AvatarStage
    // (the Tavus conversation is created in parallel while the candidate frames
    // their face). Reconnects — status already in_progress — go straight back
    // into the room; never re-gate a refresh mid-call.
    return (
      <>
        {gate}
        <AvatarStage
          sessionId={sessionId}
          branding={branding}
          onIntegrity={integrity.post}
          preflight={s.status !== 'in_progress'}
        />
      </>
    )
  }
  if (s.track === 'voice' && (chatbotStarted || s.status === 'in_progress')) {
    return <>{gate}<VoiceStage sessionId={sessionId} branding={branding} /></>
  }
  if (s.track === 'two_way' && (chatbotStarted || s.status === 'in_progress')) {
    // No onIntegrity here: TwoWayStage has no paste/copy fields or camera
    // pre-flight of its own to report on, and tab-switch/fullscreen detection
    // already runs unconditionally in useIntegrityMonitor above.
    return <>{gate}<TwoWayStage sessionId={sessionId} branding={branding} /></>
  }

  /* ── The timed engine: Q&A and recorded video ──────────────────────────── */
  if (s.status === 'in_progress') {
    const phase = s.phase === 'answer' ? 'answer' : 'prep'
    const warning = s.phase === 'answer' && clock.secondsLeft <= s.timing.warningThresholdSeconds

    const chrome = {
      progress: s.progress,
      phase: <PhaseMark phase={phase} />,
      timer: <StageTimer seconds={clock.secondsLeft} warning={warning} />,
    }

    if (s.track === 'video') {
      return (
        <InterviewStage branding={branding} track={s.track} {...chrome}>
          {gate}
          <VideoInterview
            sessionId={sessionId}
            state={s}
            remaining={clock.remaining}
            secondsLeft={clock.secondsLeft}
            busy={clock.busy}
            onSkipPrep={clock.skipPrep}
            onSubmitText={clock.submitText}
            onIntegrity={integrity.post}
          />
        </InterviewStage>
      )
    }

    return (
      <InterviewStage branding={branding} track={s.track} {...chrome}>
        {gate}
        <AnimatePresence mode="wait">
          <QuestionStage
            key={s.question?.id ?? 'q'}
            state={s}
            remaining={clock.remaining}
            secondsLeft={clock.secondsLeft}
            busy={clock.busy}
            onSkipPrep={clock.skipPrep}
            onSubmit={clock.submit}
            onSaveDraft={clock.saveDraft}
            onIntegrity={integrity.post}
          />
        </AnimatePresence>
      </InterviewStage>
    )
  }

  /* ── Pre-flight: status created | system_check ─────────────────────────── */

  // A conversational track's format is fixed by the template, so "choose a
  // format" is skipped. Recorded video is fixed by the invite too, but runs on
  // the timed engine rather than a conversational one.
  const conversational = s.track === 'chatbot' || s.track === 'video_avatar' || s.track === 'voice' || s.track === 'two_way'
  const fixedFormat = conversational || s.track === 'video'

  // Video-avatar interviews ALWAYS collect the candidate's full name and résumé
  // first — the name is used in the avatar's greeting and questions, the résumé
  // as its background knowledge. Other tracks only when the plan needs it.
  const needsIntake = s.awaitingResume || (s.track === 'video_avatar' && !s.hasResume)

  // The step sequence THIS candidate will actually walk, computed once and
  // passed down. Showing a step someone will never reach is worse than showing
  // no steps at all.
  const steps: PreflightStep[] = [
    ...(fixedFormat ? [] : ['track' as const]),
    'welcome' as const,
    ...(needsIntake ? ['resume' as const] : []),
    'systemcheck' as const,
  ]

  const step: PreflightStep = fixedFormat && preStep === 'track' ? 'welcome' : preStep

  return (
    <InterviewStage branding={branding} track={s.track} ground="record">
      <AnimatePresence mode="wait">
        {step === 'track' && (
          <TrackSelect
            key="track"
            branding={branding}
            steps={steps}
            defaultTrack={s.track}
            busy={clock.busy}
            onChoose={async (t) => {
              await clock.setTrack(t)
              setPreStep('welcome')
            }}
          />
        )}
        {step === 'welcome' && (
          <Welcome
            key="welcome"
            branding={branding}
            timing={s.timing}
            track={s.track}
            steps={steps}
            onContinue={() => {
              if (needsIntake) { setPreStep('resume') }
              else { clock.systemCheck(); setPreStep('systemcheck') }
            }}
          />
        )}
        {step === 'resume' && (
          <ResumeUpload
            key="resume"
            branding={branding}
            steps={steps}
            busy={clock.busy}
            onUpload={async (file, fullName) => {
              await clock.uploadResume(file, fullName)
              clock.systemCheck()
              setPreStep('systemcheck')
            }}
          />
        )}
        {step === 'systemcheck' && (
          // The real check: browser capabilities, a live microphone level meter,
          // and a camera preview where the format uses one. It replaces a static
          // checklist that measured nothing and let a candidate with a dead
          // microphone walk into a voice interview.
          <DeviceCheck
            key="check"
            branding={branding}
            track={s.track}
            steps={steps}
            busy={clock.busy}
            onBegin={() => {
              integrity.enterFullscreen()
              if (conversational) setChatbotStarted(true)
              else clock.begin()
            }}
          />
        )}
      </AnimatePresence>
    </InterviewStage>
  )
}

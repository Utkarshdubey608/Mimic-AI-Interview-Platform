import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { Button, Skeleton } from '@/components/ui'
import { useAuth } from '@/features/auth/AuthProvider'
import { useInterviewClock } from './useInterviewClock'
import { useIntegrityMonitor } from './useIntegrityMonitor'
import { InterviewShell } from './components/InterviewShell'
import { IntegrityWarningModal } from './components/IntegrityWarningModal'
import { INITIAL_PRE_STEP, isConversational, type PreStep } from './preStep'
import { Welcome } from './screens/Welcome'
import { SystemCheckScreen } from './systemcheck/SystemCheckScreen'
import { ResumeUpload } from './screens/ResumeUpload'
import { QuestionStage } from './screens/QuestionStage'
import { ChatbotStage } from './screens/ChatbotStage'
import { AvatarStage } from './screens/AvatarStage'
import { VoiceStage } from './screens/VoiceStage'
import { TwoWayStage } from './screens/TwoWayStage'
import { VideoInterview } from './screens/VideoStage'
import { Completion } from './screens/Completion'
import type { BrandingConfig } from '@shared/types'

import { FALLBACK_BRANDING } from './branding'

export default function TakeInterviewPage() {
  const { sessionId = '' } = useParams()
  const { signOutUser } = useAuth()
  const clock = useInterviewClock(sessionId)
  const [preStep, setPreStep] = useState<PreStep>(INITIAL_PRE_STEP)
  const [chatbotStarted, setChatbotStarted] = useState(false)
  // Hooks must run unconditionally (before the early returns below).
  const integrity = useIntegrityMonitor(sessionId, clock.state?.integrity, clock.state?.status === 'in_progress')

  // The server ends the interview when the tab-switch limit is exceeded. Pull
  // the new state straight away rather than letting the candidate sit in a
  // finished interview until the next five-second poll notices.
  useEffect(() => {
    if (integrity.terminated) void clock.refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrity.terminated])

  // Initial load — skeleton mirrors the shell + pre-flight card that follow.
  if (clock.loading && !clock.state) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <header className="border-b border-border bg-white/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-4xl items-center gap-2.5 px-5">
            <Skeleton className="h-7 w-7 rounded-lg" />
            <Skeleton className="h-3.5 w-28 rounded" />
          </div>
        </header>
        <main className="flex flex-1 items-center justify-center px-5 py-10 sm:py-12">
          <div
            className="w-full max-w-2xl rounded-3xl border border-border bg-white p-8 shadow-lg sm:p-10"
            role="status"
            aria-label="Loading your interview"
          >
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="mt-5 h-8 w-3/4 rounded-lg" />
            <Skeleton className="mt-3 h-4 w-1/2 rounded" />
            <div className="mt-8 space-y-3">
              <Skeleton className="h-20 w-full rounded-2xl" />
              <Skeleton className="h-20 w-full rounded-2xl" />
              <Skeleton className="h-20 w-full rounded-2xl" />
            </div>
            <Skeleton className="mt-8 h-12 w-full rounded-md" />
          </div>
        </main>
      </div>
    )
  }

  // Hard error (bad link, or signed in with a different account than the invite's).
  if (clock.error && !clock.state) {
    const wrongAccount = /different email/i.test(clock.error)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
        <div className="w-full max-w-md rounded-3xl border border-border bg-white p-8 text-center shadow-lg sm:p-10">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-danger-border bg-danger-bg text-danger">
            <AlertTriangle size={22} strokeWidth={1.75} />
          </span>
          <h1 className="mt-5 font-display text-xl font-extrabold tracking-[-0.02em] text-balance text-neutral-900">
            {wrongAccount ? 'Signed in with a different account' : 'We couldn’t open this interview'}
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-neutral-500">
            {clock.error}{wrongAccount ? '' : '. Please double-check your invite link.'}
          </p>
          <Button
            onClick={() => { void signOutUser() }}
            className="mt-6"
          >
            {wrongAccount ? 'Sign out & switch account' : 'Sign out and try again'}
          </Button>
          <p className="mt-4 text-xs leading-relaxed text-neutral-400">
            Still stuck? Reply to your invite email and the hiring team will send a fresh link.
          </p>
        </div>
      </div>
    )
  }

  const s = clock.state!
  const branding = s.branding ?? FALLBACK_BRANDING

  /**
   * Every live branch below returns through this, so the tab-switch warning
   * reaches all six modes from one place. It is an overlay, never a replacement:
   * the stage underneath keeps its sockets, streams and timers, so acknowledging
   * resumes the interview rather than restarting anything.
   */
  const withIntegrityWarning = (node: ReactNode) => (
    // data-surface scopes the candidate Apple token layer. It lives here rather
    // than in InterviewShell because the four conversational stages return
    // outside the shell entirely, and they are the modes the layer matters most
    // to. `display: contents` so the wrapper adds no box of its own.
    <div data-surface="candidate" style={{ display: 'contents' }}>
      {node}
      <IntegrityWarningModal
        warning={integrity.warning}
        branding={branding}
        onAcknowledge={integrity.acknowledge}
      />
    </div>
  )

  if (s.status === 'completed' || s.status === 'expired') {
    return (
      <InterviewShell branding={branding}>
        <Completion branding={branding} sessionId={sessionId} />
      </InterviewShell>
    )
  }

  // Conversational tracks run their own full-screen experience (engine-driven).
  if (s.track === 'chatbot' && (chatbotStarted || s.status === 'in_progress')) {
    return withIntegrityWarning(<ChatbotStage sessionId={sessionId} branding={branding} onIntegrity={integrity.post} />)
  }
  if (s.track === 'video_avatar' && (chatbotStarted || s.status === 'in_progress')) {
    // First entry runs the on-device face-framing pre-flight inside AvatarStage
    // (the Tavus conversation is created in parallel while the candidate frames
    // their face). Reconnects — status already in_progress — skip straight back
    // into the room; never re-gate a refresh mid-call.
    return withIntegrityWarning(
      <AvatarStage
        sessionId={sessionId}
        branding={branding}
        onIntegrity={integrity.post}
        preflight={s.status !== 'in_progress'}
      />
    )
  }
  // Voice track runs its own realtime call screen (WebSocket → Gemini Live).
  if (s.track === 'voice' && (chatbotStarted || s.status === 'in_progress')) {
    return withIntegrityWarning(<VoiceStage sessionId={sessionId} branding={branding} />)
  }
  // Two-way track is a live recruiter↔candidate Daily call (own full-screen
  // room, not the timed engine) — reconnects (status already in_progress)
  // skip straight back into the lobby/room.
  if (s.track === 'two_way' && (chatbotStarted || s.status === 'in_progress')) {
    // No onIntegrity here: TwoWayStage has no paste/copy fields or camera
    // pre-flight of its own to report on, and tab-switch/fullscreen detection
    // already runs unconditionally in the useIntegrityMonitor hook above
    // (keyed only on `active`, not on which stage is rendered).
    return withIntegrityWarning(<TwoWayStage sessionId={sessionId} branding={branding} />)
  }

  if (s.status === 'in_progress') {
    if (s.track === 'video') {
      return withIntegrityWarning(
        <InterviewShell branding={branding} progress={s.progress} live>
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
        </InterviewShell>
      )
    }
    return withIntegrityWarning(
      <InterviewShell branding={branding} progress={s.progress} live>
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
      </InterviewShell>
    )
  }

  // status: created | system_check → pre-interview screens.
  // The format is the recruiter's, fixed by the invite for every track — the
  // candidate is never asked to choose it. See preStep.ts for the bug that
  // reasoning replaced.
  const conversational = isConversational(s.track)
  // Video-avatar interviews ALWAYS collect the candidate's full name + résumé
  // first — both are fed to the Tavus avatar (name in the greeting/questions,
  // résumé as its background knowledge). Other tracks only when the question
  // plan needs the résumé.
  const needsIntake = s.awaitingResume || (s.track === 'video_avatar' && !s.hasResume)
  return (
    <InterviewShell branding={branding}>
      <AnimatePresence mode="wait">
        {preStep === 'welcome' && (
          <Welcome
            key="welcome"
            branding={branding}
            timing={s.timing}
            onContinue={() => {
              if (needsIntake) { setPreStep('resume') }
              else { clock.systemCheck(); setPreStep('systemcheck') }
            }}
          />
        )}
        {preStep === 'resume' && (
          <ResumeUpload
            key="resume"
            branding={branding}
            busy={clock.busy}
            onUpload={async (file, fullName) => { await clock.uploadResume(file, fullName); clock.systemCheck(); setPreStep('systemcheck') }}
          />
        )}
        {preStep === 'systemcheck' && (
          <SystemCheckScreen
            key="check"
            branding={branding}
            track={s.track}
            busy={clock.busy}
            onBegin={() => {
              integrity.enterFullscreen()
              if (conversational) setChatbotStarted(true)
              else clock.begin()
            }}
          />
        )}
      </AnimatePresence>
    </InterviewShell>
  )
}

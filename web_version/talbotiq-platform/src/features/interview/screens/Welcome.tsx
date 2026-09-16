import { Clock, EyeOff, Lock, ArrowRight, ShieldCheck, MessagesSquare, Mic, AlignLeft, MonitorCheck } from 'lucide-react'
import { Button } from '@/components/ui'
import { PreflightCard, ExpectationRow, type PreflightStep } from '../stage/Preflight'
import type { BrandingConfig, PublicTimingView, TrackType } from '@shared/types'

interface Props {
  branding: BrandingConfig
  timing: PublicTimingView
  track: TrackType
  steps: PreflightStep[]
  onContinue: () => void
}

/**
 * The one screen that sets a candidate's expectations for everything that
 * follows.
 *
 * ── Why this is track-aware ───────────────────────────────────────────────
 * It used to state the same three rules to everybody: a per-question prep
 * timer, an answer timer, and "your answer submits automatically when the timer
 * ends".
 *
 * Those are the TIMED ENGINE's rules. They are true for written Q&A and for
 * recorded video, and they are simply false for a voice, chatbot, avatar or
 * two-way interview — those are conversations, with no per-question countdown
 * and nothing that auto-submits. A candidate about to have a spoken
 * conversation was being told they had thirty seconds to prepare and two
 * minutes to answer each question, and then discovering that no such clock
 * existed.
 *
 * That is worse than a cosmetic bug: this screen's entire job is to be the one
 * place a candidate can trust about how they are going to be assessed, and it
 * was describing a different interview from the one they were about to take.
 */

/** The formats that run on the timed engine, and therefore have a clock. */
function isTimed(track: TrackType) {
  return track === 'chat' || track === 'video'
}

export function Welcome({ branding, timing, track, steps, onContinue }: Props) {
  const answerMinutes = Math.round(timing.answerSeconds / 60) || 1
  const plural = timing.answerSeconds >= 120 ? 's' : ''
  const timed = isTimed(track)
  const spoken = track === 'voice' || track === 'video_avatar' || track === 'two_way'
  const chat = track === 'chatbot'

  /* `welcomeMessage` is tenant-supplied prose, and it was previously rendered AS
     the h1. That produced a four-line, 30px display heading out of what is
     really a greeting, which crowds the card and buries the structure of the
     screen. A heading should say where you are; a greeting is body copy. */
  const greeting = branding.welcomeMessage?.trim()

  return (
    <PreflightCard
      step="welcome"
      steps={steps}
      title="Your interview"
      description={greeting || 'Here is exactly how it works, before you begin.'}
      footer={
        <>
          <Button size="lg" onClick={onContinue} iconRight={<ArrowRight size={18} />}>
            Continue
          </Button>
          <p className="mt-3 text-xs leading-relaxed text-ink-muted">
            Nothing starts yet, there is a final ready check before you begin.
          </p>
        </>
      }
    >
      {greeting && (
        <p className="-mt-2 mb-6 text-sm text-ink-muted">Here is exactly how it works, before you begin.</p>
      )}

      <ul className="space-y-5">
        {timed ? (
          <>
            <ExpectationRow icon={<Clock size={19} strokeWidth={1.75} />} title="The clock">
              Each question gives you{' '}
              <strong className="font-semibold text-ink">{timing.prepSeconds} seconds</strong> to prepare,
              then <strong className="font-semibold text-ink">{answerMinutes} minute{plural}</strong> to answer.
            </ExpectationRow>

            <ExpectationRow icon={<Lock size={19} strokeWidth={1.75} />} title="One pass, forwards">
              Your answer submits automatically when the timer ends. You cannot return
              to an earlier question or edit an answer you have already given.
            </ExpectationRow>
          </>
        ) : (
          <ExpectationRow
            icon={spoken ? <Mic size={19} strokeWidth={1.75} /> : <MessagesSquare size={19} strokeWidth={1.75} />}
            title={chat ? 'A written conversation' : 'A conversation, not a form'}
          >
            {spoken
              ? 'Your interviewer asks a question, you answer out loud, and it follows up on what you say. There is no per-question countdown, so take the time you need to think.'
              : chat
                ? 'Your interviewer asks one question at a time, in writing, and follows up on what you say — the same way a real interviewer would. Read each question carefully before you reply.'
                : 'Your interviewer asks a question, you reply, and it follows up on what you say. Answer in your own words; there is no word count to hit.'}
          </ExpectationRow>
        )}

        {chat && (
          <ExpectationRow icon={<AlignLeft size={19} strokeWidth={1.75} />} title="Answer fully">
            Write a complete, considered response for every question — explain your
            reasoning and give concrete detail, the way you would in person. A short or
            vague reply is the one thing that reads poorly here.
          </ExpectationRow>
        )}

        <ExpectationRow icon={<EyeOff size={19} strokeWidth={1.75} />} title="One question at a time">
          Questions come one at a time, and later ones stay hidden until it is their
          turn. There is nothing to read ahead to.
        </ExpectationRow>

        {chat && (
          <ExpectationRow icon={<MonitorCheck size={19} strokeWidth={1.75} />} title="Stay on this tab">
            Keep this tab focused and in fullscreen for the whole interview. Switching
            to another tab, app, or window is recorded, and repeated switches will end
            the interview automatically.
          </ExpectationRow>
        )}

        <ExpectationRow icon={<ShieldCheck size={19} strokeWidth={1.75} />} title="Who sees this">
          Your answers go to the hiring team and no one else. You can read the full
          terms at any time from the help button in the corner.
        </ExpectationRow>
      </ul>
    </PreflightCard>
  )
}

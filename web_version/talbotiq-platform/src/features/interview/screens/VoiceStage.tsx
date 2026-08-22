import { useLayoutEffect, useRef, useState } from 'react'
import { Mic, AlertTriangle, CheckCircle2, Captions, ShieldCheck, Loader2 } from 'lucide-react'
import { Button, cn } from '@/components/ui'
import { InterviewStage } from '../stage/InterviewStage'
import { Transport, ConnectionMeter, type ConnectionQuality } from '../stage/Transport'
import { VoiceOrb } from '../stage/VoiceOrb'
import { PreflightCard } from '../stage/Preflight'
import { Completion } from './Completion'
import { useVoiceSession, type MergedCaption } from '../useVoiceSession'
import type { BrandingConfig, VoicePhase } from '@shared/types'

/**
 * VOICE INTERVIEW — a live room, not a form page.
 *
 * The audit found this screen rendered as a centred white card with a coloured
 * circle on it: the only realtime, eyes-free surface in the product, styled like
 * a settings page. It is now a room on the dark ground, where the orb is the
 * brightest thing on screen — because in a voice interview the orb is the
 * interviewer, and nothing else on the page should compete with it.
 *
 * ── What a voice call needs that a form page does not ─────────────────────
 *   · TURN-TAKING made visible. Without a face, the candidate has no cue for
 *     whose turn it is. The orb's motion direction and the phase label carry it.
 *   · CONNECTION QUALITY, always visible. On a spoken interview a degraded
 *     connection is silent until it has already cost the candidate an answer.
 *   · A TRANSCRIPT AFFORDANCE, not a hidden toggle. Captions are an
 *     accessibility requirement for a spoken assessment, not a preference.
 *   · A RECONNECT STATE that stops the candidate talking into a dead mic.
 *
 * The business logic is untouched: `useVoiceSession` and its WebSocket contract
 * are exactly as they were, and this file only changes what is drawn.
 */

interface Props {
  sessionId: string
  branding: BrandingConfig
  personaName?: string
}

const PHASE_LABEL: Record<VoicePhase, string> = {
  connecting: 'Connecting',
  greeting: 'Interviewer is speaking',
  speaking: 'Interviewer is speaking',
  listening: 'Your turn, go ahead',
  thinking: 'One moment',
  ended: 'Interview complete',
  error: 'Something went wrong',
}

/**
 * The live transcript.
 *
 * Two things make it feel instant rather than merely be instant:
 *
 *   IT FOLLOWS ITS TAIL. `scrollTop = scrollHeight` on every caption change,
 *   in a layout effect so it lands in the same frame as the text — after paint
 *   would show one frame of the old position on every single word.
 *
 *   THE IN-PROGRESS LINE IS MARKED. A caption that is still streaming carries a
 *   cursor, so a candidate can see the words arriving instead of wondering
 *   whether the screen has frozen. The distinction is `final` on the caption,
 *   which the client already tracks.
 */
function CaptionRail({
  captions, personaName,
}: {
  captions: MergedCaption[]
  personaName: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)

  // useLayoutEffect, not useEffect: the scroll must be applied before the
  // browser paints the new text, or every caption update shows a frame at the
  // previous scroll position and the rail visibly stutters.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [captions])

  return (
    <div className="mt-8 w-full max-w-xl overflow-hidden rounded-lg border border-rule bg-surface">
      <div className="flex items-center gap-2 border-b border-rule px-4 py-2.5">
        <Captions size={13} className="text-ink-muted" aria-hidden="true" />
        <span className="section-label">Live captions</span>
      </div>
      {/* aria-live="polite" + atomic=false: assistive tech announces new lines
          as they land, without re-reading the whole transcript each time. */}
      <div
        ref={boxRef}
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Live captions"
        className="h-52 overflow-y-auto p-4 text-sm"
      >
        {captions.length === 0 ? (
          <p className="py-3 text-center text-ink-muted">
            Captions appear here as the conversation goes on.
          </p>
        ) : (
          <div className="space-y-3">
            {captions.slice(-14).map((c, i) => (
              <p key={i} className="leading-relaxed">
                <span
                  className={cn(
                    'text-2xs font-bold uppercase tracking-wider',
                    c.role === 'candidate' ? 'text-ink' : 'text-signal-ink',
                  )}
                >
                  {c.role === 'candidate' ? 'You' : personaName}
                </span>
                <br />
                <span className={c.role === 'candidate' ? 'text-ink' : 'text-ink-body'}>
                  {c.text}
                  {!c.final && (
                    <span
                      className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-ink-faint align-baseline"
                      aria-hidden="true"
                    />
                  )}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function VoiceStage({ sessionId, branding, personaName = 'AI Interviewer' }: Props) {
  const v = useVoiceSession(sessionId)
  const [gestured, setGestured] = useState(false)

  /* ── The start gate ────────────────────────────────────────────────────
     `getUserMedia` requires a user gesture, so this screen is mandatory. It is
     used to set expectations rather than treated as an obstacle: it names the
     interviewer, says what is about to be asked for, and states the microphone
     boundary before requesting the permission rather than after. */
  if (!gestured) {
    return (
      <InterviewStage branding={branding} track="voice">
        <PreflightCard
          step="systemcheck"
          steps={['systemcheck']}
          title="Voice interview"
          description={`You will have a spoken conversation with ${personaName}. Find somewhere quiet, when you are ready, we will ask for your microphone and begin.`}
          footer={
            <>
              <Button
                size="lg"
                icon={<Mic size={18} />}
                onClick={() => { setGestured(true); void v.start() }}
              >
                Start voice interview
              </Button>
              <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
                <ShieldCheck size={14} strokeWidth={1.75} className="mt-px flex-shrink-0" aria-hidden="true" />
                Your microphone is active only while the interview is running, and it
                stops the moment the call ends.
              </p>
            </>
          }
        />
      </InterviewStage>
    )
  }

  /* ── Terminal states ───────────────────────────────────────────────────
     A graceful finish and a dropped call are DIFFERENT screens. Telling a
     candidate "all done, thank you" when their connection died mid-answer is
     the worst possible failure of this product's honesty. */
  if (v.phase === 'ended') {
    // A graceful finish uses the SAME completion screen as every other interview
    // mode. It had its own bespoke card, which meant the last thing a candidate
    // saw depended on which format their recruiter happened to pick.
    if (v.endedGraceful) {
      return (
        <InterviewStage branding={branding} track="voice">
          <Completion branding={branding} sessionId={sessionId} />
        </InterviewStage>
      )
    }
    // An interrupted call is NOT a completion and must never borrow its wording.
    // Telling someone "all done, thank you" when their connection died mid-answer
    // is a lie the product would be telling at the worst possible moment.
    return (
      <InterviewStage branding={branding} track="voice">
        <PreflightCard
          step="systemcheck"
          steps={['systemcheck']}
          title="The interview ended early"
          description="The connection dropped before the interview finished. Please contact the hiring team. They can send you a fresh link to complete it."
        >
          <span
            className="flex h-12 w-12 items-center justify-center rounded-md border border-warn-rule bg-warn-bg text-warn"
            aria-hidden="true"
          >
            <AlertTriangle size={24} strokeWidth={1.75} />
          </span>
        </PreflightCard>
      </InterviewStage>
    )
  }

  if (v.phase === 'error') {
    return (
      <InterviewStage branding={branding} track="voice">
        <PreflightCard
          step="systemcheck"
          steps={['systemcheck']}
          title={v.permissionDenied ? 'Microphone access is blocked' : 'We lost the connection'}
          description={v.error ?? undefined}
        >
          {/* The recovery is the point of an error screen. Naming the cause and
              stopping there leaves the candidate exactly where they were. */}
          <div className="rounded-lg border border-rule bg-surface-sunk p-4">
            <p className="section-label">How to continue</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-body">
              {v.permissionDenied
                ? 'Allow microphone access from the icon in your browser’s address bar, then reload this page to start again.'
                : 'Check your internet connection and reload this page. If it keeps happening, contact the hiring team who sent your invitation.'}
            </p>
          </div>
        </PreflightCard>
      </InterviewStage>
    )
  }

  /* ── The live room ─────────────────────────────────────────────────────── */

  const connecting = v.phase === 'connecting'
  const quality: ConnectionQuality = v.reconnecting ? 'lost' : connecting ? 'connecting' : 'good'
  const statusLabel = v.reconnecting ? 'Reconnecting' : PHASE_LABEL[v.phase]

  return (
    <InterviewStage
      branding={branding}
      track="voice"
      layout="focus"
     
      connection={<ConnectionMeter quality={quality} />}
      transport={
        /* `busy` is deliberately not passed. It previously carried `connecting`,
           which disabled the leave button — so a connection that never completed
           left the candidate with no way out of the room at all, in the one
           state where they most need one. Leaving must never depend on the
           thing that is broken. */
        <Transport
          micOn={!v.muted}
          onToggleMic={v.toggleMute}
          onLeave={v.end}
          leaveTitle="End this voice interview?"
          leaveBody="Everything you have said so far is saved and will be submitted. You will not be able to rejoin."
        />
      }
    >
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8">
        <VoiceOrb phase={v.phase} muted={v.muted} />

        <p className="mt-4 font-display text-lg font-bold tracking-[-0.02em] text-ink">{personaName}</p>

        {/* The turn indicator. `aria-live` so a candidate who cannot see the orb
            is told when it is their turn, which for this format is not a
            nicety, it is the interview. */}
        <p
          aria-live="polite"
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-rule bg-surface px-4 py-1.5 text-sm font-semibold text-ink-body"
        >
          {connecting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {statusLabel}
        </p>

        {v.muted && (
          <p className="mt-3 text-xs font-medium text-warn">
            Your microphone is muted, the interviewer cannot hear you.
          </p>
        )}

        {v.reconnecting && (
          <p className="mt-3 max-w-sm text-center text-xs leading-relaxed text-ink-muted">
            Connection hiccup. Your interview is saved and will resume in a moment 
            you can stop talking until this clears.
          </p>
        )}

        {/* ── Live captions ───────────────────────────────────────────────
            ALWAYS ON. This was behind a toggle that defaulted to off, which made
            a spoken assessment unusable for anyone who is deaf or hard of
            hearing unless they first found and pressed a button, in a live call,
            while being assessed. Captions on a spoken interview are not a
            preference; they are the only way some candidates can take it at all.

            The rail auto-scrolls to the newest line, which is what actually
            fixes the "captions are lagging" symptom: the transport was already
            instant (VoiceClient forwards Gemini's streaming partials the frame
            they arrive, see `onCaption(..., false)`), but a fixed-height box
            that does not follow its own tail leaves the newest words below the
            fold, so the last thing the candidate can READ is always several
            seconds old. */}
        <CaptionRail captions={v.captions} personaName={personaName} />
      </div>
    </InterviewStage>
  )
}

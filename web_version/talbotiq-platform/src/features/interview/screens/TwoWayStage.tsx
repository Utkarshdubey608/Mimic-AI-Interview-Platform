import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Loader2, AlertTriangle, RefreshCw } from 'lucide-react'
import type { BrandingConfig } from '@shared/types'
import { sessionsApi, ApiError } from '@/lib/api'
import { useLiveKitCall } from '../useLiveKitCall'
import { classifyJoinFailure } from '../twowayJoinError'
import { LiveKitVideoTile } from '@/components/interview/LiveKitVideoTile'
import { InterviewStage, PhaseMark } from '../stage/InterviewStage'
import { MimicLockup } from '@/components/brand/MimicMark'
import { Transport, ConnectionMeter } from '../stage/Transport'
import { Completion } from './Completion'

interface Props {
  sessionId: string
  branding: BrandingConfig
}

const RETRY_MS = 4000
// A 'transient' join failure (backend momentarily unreachable — a dev restart
// or a prod deploy) retries silently, but only so many times: past this a
// genuinely broken backend surfaces the hard error instead of spinning forever.
// ~40s of retries at RETRY_MS. (A 'waiting-host' 409 retries indefinitely — the
// recruiter may take minutes — and is NOT bounded by this.)
const MAX_TRANSIENT_RETRIES = 10

/* The 56px circular call-control constants that used to live here are gone. They
   were this file's private copy of a control language that VoiceStage and
   LiveInterviewPage each also had their own copy of — three definitions of
   "mute", none of which agreed. All three now use <Transport>. */

/** Breathing ring — the lobby's "we're working on it" signal. */
function PulseRing({ accent, reduce, children }: { accent: string; reduce: boolean | null; children: ReactNode }) {
  return (
    <div className="relative flex h-24 w-24 items-center justify-center">
      {!reduce && [0, 1].map((i) => (
        <motion.span
          key={i}
          className="absolute h-20 w-20 rounded-full"
          style={{ background: `${accent}2E` }}
          animate={{ scale: [1, 1.7], opacity: [0.5, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: i * 1.1, ease: 'easeOut' }}
        />
      ))}
      <span className="relative flex h-16 w-16 items-center justify-center rounded-full border border-brand-border bg-brand-card text-white">
        {children}
      </span>
    </div>
  )
}

/** Candidate-facing full-page recovery card. */
function StageCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ground px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-rule bg-surface p-10 text-center shadow-lg">{children}</div>
    </div>
  )
}

/**
 * Candidate side of the live Two-way Interview. Joins the Daily room the
 * recruiter hosts (LiveInterviewPage, T6) with a non-owner/knocking token, so
 * Daily holds the candidate in a waiting room until the recruiter admits
 * them — `useDailyCall().join()`'s promise simply doesn't resolve (callState
 * stays 'joining') until that happens.
 *
 * Two distinct "waiting" reasons, both shown as the same full-screen lobby:
 *  - the recruiter hasn't opened the room yet (`sessionsApi.twowayJoin`
 *    404/409s with "has not started this interview yet" until their `twoway/
 *    host` call has run) — retried on an interval, not a hard error;
 *  - the room exists and we've knocked, but haven't been admitted yet.
 *
 * Full-screen dark room shell (AvatarStage) + circular controls (VoiceStage).
 * No client recording here — the recruiter's side records and uploads (see
 * useDailyCall's docstring); on end we just mark the session complete (no
 * recordingUrl) and hand off to the shared Completion screen.
 */
export function TwoWayStage({ sessionId, branding }: Props) {
  const reduce = useReducedMotion()
  const accent = branding.accentColor || '#8AA6F0'
  const dc = useLiveKitCall()

  const [joinError, setJoinError] = useState<string | null>(null) // hard (non-retryable) join failure
  const [waitingForHost, setWaitingForHost] = useState(true) // recruiter hasn't opened the room yet
  const [reconnecting, setReconnecting] = useState(false) // backend blip; retrying the join silently
  const [attempt, setAttempt] = useState(0) // bump to retry the whole flow after a hard error
  const [completed, setCompleted] = useState(false)

  const completingRef = useRef(false)
  // Consecutive 'transient' join failures in the current join cycle (reset on
  // any success or a clean 'waiting-host' response). Bounds the silent retry.
  const transientRetriesRef = useRef(0)
  // Tracks whether the interviewer's tile has ever shown up on this join
  // cycle, so a momentary drop (remote goes null again while still `joined`)
  // reads as "reconnecting" rather than the pre-admit "waiting to be let in"
  // copy below.
  const hadRemoteRef = useRef(false)

  const finish = useCallback(async () => {
    if (completingRef.current) return
    completingRef.current = true
    // Best-effort — the recruiter's own twoway/complete call (with the
    // recording) is the authoritative one; this just closes out the
    // candidate's session promptly if theirs is slow/fails.
    try { await sessionsApi.twowayComplete(sessionId) } catch { /* best-effort */ }
    setCompleted(true)
  }, [sessionId])

  // Acquire the room + a knocking token, then hand off to Daily.
  //
  // `cancelled` is a per-invocation local (captured in this effect's closure),
  // NOT a shared ref — under StrictMode's dev-only mount→cleanup→remount, a
  // shared ref reset at the top of the effect body would be clobbered by the
  // second invocation, un-cancelling the first invocation's in-flight
  // `twowayJoin` promise and orphaning its retry timer (same pattern as
  // AvatarStage's effect 1 above).
  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setJoinError(null)
    setWaitingForHost(true)
    setReconnecting(false)
    transientRetriesRef.current = 0
    hadRemoteRef.current = false

    const attemptJoin = async () => {
      try {
        const { roomUrl, token } = await sessionsApi.twowayJoin(sessionId)
        if (cancelled) return
        transientRetriesRef.current = 0
        setReconnecting(false)
        setWaitingForHost(false)
        await dc.join(roomUrl, token)
      } catch (e) {
        if (cancelled) return
        // dc.join() never throws (it surfaces call errors via dc.callState),
        // so anything caught here is a failed twowayJoin HTTP request. Classify
        // it: a definite client error is fatal; a recruiter-not-started 409 or a
        // transient backend blip stays in the lobby and retries on the interval.
        const status = e instanceof ApiError ? e.status : null
        const message = e instanceof Error ? e.message : ''
        const kind = classifyJoinFailure(status, message)

        if (kind === 'fatal') {
          setJoinError(message || 'Could not join the interview')
          return
        }
        if (kind === 'transient') {
          transientRetriesRef.current += 1
          if (transientRetriesRef.current > MAX_TRANSIENT_RETRIES) {
            setJoinError(message || 'We couldn’t reach the interview server. Please try again.')
            return
          }
          setReconnecting(true)
        } else {
          // 'waiting-host' — the server IS responding (just not started yet), so
          // the transient budget resets and we show the waiting-for-host copy.
          transientRetriesRef.current = 0
          setReconnecting(false)
        }
        retryTimer = setTimeout(() => { if (!cancelled) void attemptJoin() }, RETRY_MS)
      }
    }
    void attemptJoin()

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
    }
    // dc.join has a stable identity for the lifetime of this hook instance.
  }, [sessionId, attempt, dc.join])

  // The call ending — whether the candidate hit Leave, the recruiter ended
  // it, or the connection dropped — always lands on callState 'left'; either
  // way, complete the session (no recordingUrl; the recruiter uploads it).
  useEffect(() => {
    if (dc.callState === 'left') void finish()
  }, [dc.callState, finish])

  /* `handleEnd` and its `window.confirm` are gone: leaving is now confirmed by
     the product's own ConfirmDialog inside <Transport>, which is styled, labelled,
     focus-trapped and identical across every interview format. A native confirm()
     is unstyled, differs per browser, and can be suppressed outright on some
     mobile browsers — for the single most irreversible action a candidate has. */

  const remote = dc.participants[0] ?? null
  if (remote) hadRemoteRef.current = true

  /* ── finished ──
     Inside InterviewStage, not bare on the page: the completion screen keeps the
     same header, brand mark and help sheet as the rest of the journey, which is
     the whole point of having one stage. */
  if (completed) {
    return (
      <InterviewStage branding={branding} track="two_way">
        <Completion branding={branding} sessionId={sessionId} />
      </InterviewStage>
    )
  }

  /* ── hard error — join failed for a reason that won't resolve on its own ── */
  if (joinError) {
    return (
      <StageCard>
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-risk-rule bg-risk-bg text-risk">
          <AlertTriangle size={28} />
        </span>
        <h1 className="mt-5 font-display text-xl font-extrabold tracking-[-0.03em] text-ink">
          We couldn’t join your interview
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">{joinError}</p>
        <button
          onClick={() => setAttempt((a) => a + 1)}
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-md px-6 text-sm font-semibold text-white shadow-md transition-all duration-150 hover:-translate-y-px hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          style={{ background: accent }}
        >
          <RefreshCw size={15} /> Try joining again
        </button>
        <p className="mt-4 text-xs text-ink-muted">If this keeps happening, contact your recruiter.</p>
      </StageCard>
    )
  }

  /* ── Daily call error (device/connection) — surfaced from useDailyCall ── */
  if (dc.callState === 'error') {
    return (
      <StageCard>
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-risk-rule bg-risk-bg text-risk">
          <AlertTriangle size={28} />
        </span>
        <h1 className="mt-5 font-display text-xl font-extrabold tracking-[-0.03em] text-ink">
          The call hit a connection problem
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">
          {dc.error ?? 'We lost the connection to the interview room.'}
        </p>
        <button
          onClick={() => setAttempt((a) => a + 1)}
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-md px-6 text-sm font-semibold text-white shadow-md transition-all duration-150 hover:-translate-y-px hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          style={{ background: accent }}
        >
          <RefreshCw size={15} /> Reconnect
        </button>
        <p className="mt-4 text-xs text-ink-muted">Check your network, then try again, your session is still open.</p>
      </StageCard>
    )
  }

  /* ── wrapping up — callState just hit 'left' (our Leave, the recruiter's End,
        or a dropped connection); finish() is completing the session above ── */
  if (dc.callState === 'left') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-5 bg-brand-black px-6 text-center">
        <PulseRing accent={accent} reduce={reduce}>
          <Loader2 size={24} className="animate-spin" />
        </PulseRing>
        <div>
          <p className="font-display text-lg font-bold tracking-[-0.02em] text-white">Wrapping up your interview</p>
          <p className="mt-1.5 text-sm text-brand-gray">Saving your session, this only takes a moment.</p>
        </div>
      </div>
    )
  }

  /* ── lobby — waiting for the recruiter to start the room / admit the knock ── */
  if (waitingForHost || dc.callState !== 'joined' || !remote) {
    // Presentational copy derivation — same four cases as before, one shape.
    const lobby = reconnecting
      ? {
          chip: 'Reconnecting', // backend briefly unreachable (restart/deploy); retrying automatically
          title: 'Reconnecting…',
          body: 'We briefly lost the connection to the interview server, reconnecting automatically. No need to do anything.',
        }
      : waitingForHost
        ? {
            chip: 'Waiting room',
            title: 'Waiting for the interviewer to start the interview…',
            body: 'Your camera and mic are ready, you’ll be connected the moment the interviewer lets you in.',
          }
        : dc.callState === 'joined' && hadRemoteRef.current
          ? {
              chip: 'Reconnecting', // was live; the interviewer's tile just dropped momentarily
              title: 'Reconnecting…',
              body: 'We briefly lost the connection to the interview server, reconnecting automatically. No need to do anything.',
            }
          : {
              chip: 'Knocking',
              title: 'Waiting for the interviewer to admit you…',
              body: 'Your camera and mic are ready, you’ll be connected the moment the interviewer lets you in.',
            }

    return (
      <div className="flex h-screen flex-col overflow-hidden bg-brand-black">
        <header className="flex h-14 flex-shrink-0 items-center border-b border-brand-border bg-brand-card px-4">
          <MimicLockup size="sm" />
        </header>

        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
          <PulseRing accent={accent} reduce={reduce}>
            <Loader2 size={24} className="animate-spin" />
          </PulseRing>

          <div className="flex flex-col items-center gap-3">
            <span
              className="flex items-center gap-1.5 rounded-md border border-brand-border bg-white/5 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-gold-light"
              aria-live="polite"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-gold" />
              {lobby.chip}
            </span>
            <h1 className="max-w-md font-display text-xl font-extrabold leading-snug tracking-[-0.03em] text-white">
              {lobby.title}
            </h1>
            <p className="max-w-sm text-sm leading-relaxed text-brand-gray">{lobby.body}</p>
          </div>

          <p className="text-xs text-brand-gray/80">Keep this window open, you’ll join automatically.</p>
        </div>
      </div>
    )
  }

  /* ── the live room ──────────────────────────────────────────────────────
     Participant hierarchy: the interviewer holds the stage, the candidate's own
     camera is a small self-view in the corner. That asymmetry is deliberate —
     in a two-way interview the person you are talking to is the subject, and a
     symmetric grid makes a candidate watch themselves for half an hour.

     The self-view is bottom-RIGHT and inset from the transport tray, so it can
     never sit under the controls on a short viewport. */
  return (
    <InterviewStage
      branding={branding}
      track="two_way"
      layout="focus"
      phase={<PhaseMark phase="live" />}
      connection={<ConnectionMeter quality={remote ? 'good' : 'fair'} compact />}
      transport={
        <Transport
          micOn={!dc.muted}
          onToggleMic={dc.toggleMic}
          cameraOn={!dc.camOff}
          onToggleCamera={dc.toggleCam}
          onLeave={() => void dc.leave()}
          leaveTitle="Leave this interview?"
          leaveBody="The interviewer will see that you left, and you will not be able to rejoin."
          leaveLabel="Leave interview"
        />
      }
    >
      <div className="relative flex-1 p-4">
        <div className="mx-auto h-full max-w-4xl">
          <LiveKitVideoTile participant={remote} label="Interviewer" />
        </div>
        {dc.localParticipant && (
          <div className="absolute bottom-4 right-4 w-32 overflow-hidden rounded-lg border border-rule shadow-xl sm:right-6 sm:w-48">
            <LiveKitVideoTile participant={dc.localParticipant} label="You" />
          </div>
        )}
      </div>
    </InterviewStage>
  )
}

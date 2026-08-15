import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Mic, MicOff, Video, VideoOff, PhoneOff, Loader2, AlertTriangle, UserPlus, Users, RefreshCw } from 'lucide-react'
import { sessionsApi } from '@/lib/api'
import { useLiveKitCall } from '@/features/interview/useLiveKitCall'
import { LiveKitVideoTile } from '@/components/interview/LiveKitVideoTile'

/* ── Shared call-room atoms (one language across every live stage) ────────── */

/** 56px circular control. */
const CONTROL =
  'flex h-14 w-14 items-center justify-center rounded-full border transition-all duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-brand-black disabled:opacity-60'
const CONTROL_IDLE = 'border-brand-border bg-white/5 text-white hover:bg-white/10'
const CONTROL_OFF = 'border-danger/50 bg-danger/20 text-red-300 hover:bg-danger/30'

/** Breathing ring — the room's "we're working on it" signal. */
function PulseRing({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-24 w-24 items-center justify-center">
      <span className="absolute h-20 w-20 animate-pulse rounded-full bg-primary/20" />
      <span className="relative flex h-16 w-16 items-center justify-center rounded-full border border-brand-border bg-brand-card text-white">
        {children}
      </span>
    </div>
  )
}

/**
 * Recruiter's host screen for the live Two-way Interview (T6). Joins the Daily
 * room as OWNER (`sessionsApi.twowayHost`) — the candidate's `TwoWayStage`
 * (T5) knocks and waits until `admit(id)` here lets them in.
 *
 * Recording is client-side (`useDailyCall`'s single continuous `MediaRecorder`
 * wrapper, not Daily cloud recording — see that hook's docstring): the Record
 * control here just pauses/resumes the ONE recorder for the whole call, so no
 * segment is ever dropped. The final Blob is only produced once — by
 * `stopRecording()` in the finalize flow below — and uploaded to Firebase
 * Storage via the same `uploadAnswerVideo` helper the (candidate-facing) Video
 * Interview track uses (questionId `'two-way'` namespaces the object under
 * `interviews/{sessionId}/`).
 *
 * The call can end two ways, both funnelled through `finalize()`:
 *  - the recruiter clicks End (`handleEnd`) — confirms, then finalizes;
 *  - the call ends EXTERNALLY (`dc.callState` reaches `'left'` without
 *    `endingRef` already set) — e.g. the candidate completed first, or the
 *    connection dropped. Without this, the recruiter would be stranded on the
 *    "Starting the interview room…" spinner forever and lose any in-progress
 *    recording; the effect below catches it and finalizes exactly the same
 *    way, just without the confirm dialog.
 *
 * Dark full-screen room — no recruiter chrome (Nav) — mirroring the
 * AvatarStage/VoiceStage/TwoWayStage shell so the live call reads the same on
 * both sides of the table.
 */
export default function LiveInterviewPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const dc = useLiveKitCall()

  const [hostError, setHostError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0) // bump to retry after a hard error
  const [ending, setEnding] = useState(false) // "finalizing…" overlay

  const endingRef = useRef(false) // single-fire guard — don't double-complete

  // Acquire the room as OWNER, then hand off to Daily. `cancelled` is a
  // per-invocation local (captured in this effect's closure), NOT a shared
  // ref — mirrors TwoWayStage's join effect so React 18 StrictMode's dev-only
  // mount→cleanup→remount can't un-cancel a stale invocation's in-flight
  // `twowayHost` call.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setHostError(null)

    const run = async () => {
      try {
        const { roomUrl, token } = await sessionsApi.twowayHost(id)
        if (cancelled) return
        await dc.join(roomUrl, token)
      } catch (e) {
        if (cancelled) return
        setHostError(e instanceof Error ? e.message : 'Could not start the interview room')
      }
    }
    void run()

    return () => { cancelled = true }
    // dc.join has a stable identity for the lifetime of this hook instance.
  }, [id, attempt, dc.join])

  // Marks the session complete and navigates to the report. Recording is
  // SERVER-SIDE (LiveKit egress) — twowayComplete stops the egress and its
  // webhook transcribes + scores — so there's nothing to stop or upload from the
  // browser. Shared by the recruiter's own End (handleEnd) and the "call ended
  // externally" recovery effect below; only the confirm dialog differs.
  const finalize = useCallback(async () => {
    if (!id || endingRef.current) return
    endingRef.current = true
    setEnding(true)

    try {
      await sessionsApi.twowayComplete(id)
    } catch (e) {
      console.error('[twoway] complete failed', e)
      toast.error('Could not finalize the session — check Sessions and try again')
    }

    await dc.leave()
    navigate(`/sessions/${id}/report`)
  }, [id, dc, navigate])

  const handleEnd = useCallback(() => {
    if (!id || endingRef.current) return
    if (!window.confirm('End the interview now? The recording will be processed and the session will be marked complete.')) return
    void finalize()
  }, [id, finalize])

  // The call ended EXTERNALLY — not via our own End above. Most likely the
  // candidate completed/left first (a dropped connection or the room's own
  // expiry can also land here). Without this, callState !== 'joined' falls
  // through to the "Starting the interview room…" spinner below forever, and
  // any in-progress recording would be lost. finalize() the same way as a
  // manual End, just without the confirm dialog (the call is already gone).
  useEffect(() => {
    if (dc.callState === 'left' && !endingRef.current) void finalize()
  }, [dc.callState, finalize])

  const candidate = dc.participants[0] ?? null
  const waiting = dc.waitingParticipants

  /* ── missing :id (shouldn't happen given the route) ── */
  if (!id) return null

  /* ── hard error — couldn't open the room / join failed ── */
  if (hostError || dc.callState === 'error') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-brand-black px-6 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-danger/40 bg-danger/15 text-red-300">
          <AlertTriangle size={28} />
        </span>
        <div>
          <h1 className="font-display text-xl font-extrabold tracking-[-0.03em] text-white">
            We couldn’t start the interview room
          </h1>
          <p className="mx-auto mt-2.5 max-w-md text-sm leading-relaxed text-brand-gray">
            {hostError ?? dc.error ?? 'The call hit a connection problem.'}
          </p>
        </div>
        <button
          onClick={() => setAttempt((a) => a + 1)}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-primary-700 px-6 text-sm font-semibold text-white shadow-primary-sm transition-all duration-150 hover:-translate-y-px hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
        >
          <RefreshCw size={15} /> Try again
        </button>
        <p className="text-xs text-brand-gray/80">The candidate stays in the waiting room until the room opens.</p>
      </div>
    )
  }

  /* ── the call ended — our own End, or externally (candidate ended first /
        connection dropped) — finalize() above is uploading + completing +
        about to navigate to the report. A brief interim state, with an
        escape hatch in case finalize() is taking a while. ── */
  if (dc.callState === 'left') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-brand-black px-6 text-center">
        <PulseRing>
          <Loader2 size={24} className="animate-spin" />
        </PulseRing>
        <div>
          <p className="font-display text-lg font-bold tracking-[-0.02em] text-white">The interview has ended</p>
          <p className="mt-1.5 text-sm text-brand-gray">
            Finalizing the session…
          </p>
        </div>
        <button
          onClick={() => navigate(`/sessions/${id}/report`)}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-brand-border bg-white/5 px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
        >
          Go to report
        </button>
      </div>
    )
  }

  /* ── connecting — acquiring the room + joining as owner ── */
  if (dc.callState !== 'joined') {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-brand-black">
        <header className="flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-brand-card px-4">
          <span className="flex items-center gap-2.5 font-display font-bold tracking-[-0.02em] text-white">
            Live interview
            <span className="flex items-center gap-1.5 rounded-full border border-brand-border bg-white/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-gold-light">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-gold" /> Starting
            </span>
          </span>
          <span className="h-8 w-32 animate-pulse rounded-full bg-white/5" />
        </header>

        <div className="flex-1 p-4">
          <div className="mx-auto flex h-full max-w-4xl flex-col items-center justify-center gap-6 rounded-3xl border border-brand-border bg-brand-card/60 px-6 text-center">
            <PulseRing>
              <Loader2 size={24} className="animate-spin" />
            </PulseRing>
            <div>
              <p className="font-display text-lg font-bold tracking-[-0.02em] text-white" aria-live="polite">
                Starting the interview room
              </p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-brand-gray">
                Opening the room and connecting your camera and microphone. The candidate can knock as soon as it’s open.
              </p>
            </div>
          </div>
        </div>

        <div className="flex-shrink-0 border-t border-brand-border bg-brand-black">
          <div className="mx-auto flex max-w-3xl items-center justify-center gap-5 px-4 py-6">
            <span className="h-14 w-14 animate-pulse rounded-full bg-white/5" />
            <span className="h-14 w-14 animate-pulse rounded-full bg-white/5" />
            <span className="h-16 w-16 animate-pulse rounded-full bg-white/5" />
            <span className="h-14 w-14 animate-pulse rounded-full bg-white/5" />
          </div>
        </div>
      </div>
    )
  }

  /* ── the live room ── */
  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-brand-black">
      <header className="flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-brand-border bg-brand-card px-4">
        <span className="flex min-w-0 items-center gap-2.5 font-display font-bold tracking-[-0.02em] text-white">
          <span className="truncate">Live interview</span>
          <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full border border-brand-border bg-white/5 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-green-light">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-green-light" /> Live
          </span>
          <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full border border-danger/40 bg-danger/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-red-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" /> Rec
          </span>
        </span>

        <div className="flex flex-shrink-0 items-center gap-2">
          {waiting.map((w) => (
            <button
              key={w.id}
              onClick={() => void dc.admit(w.id)}
              className="inline-flex items-center gap-1.5 rounded-full bg-mint px-4 py-1.5 text-sm font-semibold text-neutral-900 shadow-mint-sm transition-all duration-150 hover:-translate-y-px hover:bg-mint-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-brand-card"
            >
              <UserPlus size={15} /> Admit {w.name || 'candidate'}
            </button>
          ))}
          <button
            onClick={handleEnd}
            disabled={ending}
            className="inline-flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/15 px-4 py-1.5 text-sm font-semibold text-red-300 transition-colors duration-150 hover:bg-danger/25 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-card"
          >
            {ending ? <Loader2 size={15} className="animate-spin" /> : <PhoneOff size={15} />}
            End interview
          </button>
        </div>
      </header>

      <div className="relative flex-1 p-4">
        <div className="mx-auto h-full max-w-4xl">
          {candidate ? (
            <LiveKitVideoTile participant={candidate} label="Candidate" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-brand-border bg-brand-card/50 px-6 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-brand-border bg-white/5 text-brand-gold">
                <Users size={24} />
              </span>
              <div>
                <p className="font-display text-base font-bold tracking-[-0.02em] text-white">
                  {waiting.length > 0 ? 'The candidate is in the waiting room' : 'Waiting for the candidate to join'}
                </p>
                <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-brand-gray">
                  {waiting.length > 0
                    ? 'Use Admit at the top of the room to let them in.'
                    : 'They’ll knock as soon as they open their interview link — keep this room open.'}
                </p>
              </div>
            </div>
          )}
        </div>
        {dc.localParticipant && (
          <div className="absolute bottom-4 right-6 w-40 overflow-hidden rounded-2xl shadow-xl sm:w-52">
            <LiveKitVideoTile participant={dc.localParticipant} label="You" />
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t border-brand-border bg-brand-black">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-5 px-4 py-6">
          <button
            onClick={dc.toggleMic}
            aria-pressed={dc.muted}
            className={`${CONTROL} ${dc.muted ? CONTROL_OFF : CONTROL_IDLE}`}
            aria-label={dc.muted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {dc.muted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
          <button
            onClick={handleEnd}
            disabled={ending}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-danger text-white shadow-lg transition-transform duration-150 hover:scale-105 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black"
            aria-label="End interview"
          >
            <PhoneOff size={24} />
          </button>
          <button
            onClick={dc.toggleCam}
            aria-pressed={dc.camOff}
            className={`${CONTROL} ${dc.camOff ? CONTROL_OFF : CONTROL_IDLE}`}
            aria-label={dc.camOff ? 'Turn camera on' : 'Turn camera off'}
          >
            {dc.camOff ? <VideoOff size={22} /> : <Video size={22} />}
          </button>
        </div>
      </div>

      {ending && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-brand-black/90 px-6 text-center backdrop-blur-sm">
          <PulseRing>
            <Loader2 size={24} className="animate-spin" />
          </PulseRing>
          <div>
            <p className="font-display text-lg font-bold tracking-[-0.02em] text-white" aria-live="polite">
              Finalizing the session…
            </p>
            <p className="mt-1.5 text-sm text-brand-gray">
              Don’t close this tab — we’ll open the report as soon as it’s saved.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

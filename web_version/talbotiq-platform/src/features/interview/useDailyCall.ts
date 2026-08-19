import { recorderOptions } from '@/lib/recorderCodec'
import { useCallback, useEffect, useRef, useState } from 'react'
import DailyIframe from '@daily-co/daily-js'
import type { DailyCall, DailyParticipant } from '@daily-co/daily-js'

export type CallState = 'idle' | 'joining' | 'joined' | 'left' | 'error'

export interface WaitingParticipant {
  id: string
  name: string
}

/**
 * Reusable Daily "call object" (headless — no iframe UI) wrapper for the
 * live two-way video call. Shared by the candidate room (T5) and the
 * recruiter room (T6): both just need join/leave, the remote+local
 * participant tracks, mic/cam toggles, the recruiter's waiting-room admit
 * flow, and (recruiter-side) a client MediaRecorder capture of the call to
 * upload afterwards (T6/T7) — Daily's own cloud recording is not used.
 *
 * Recording is a SINGLE continuous MediaRecorder for the whole call:
 * `startRecording()` creates it once; a mid-call toggle-off calls
 * `pauseRecording()` (keeps the same recorder + growing chunk buffer, just
 * paused) and a later `startRecording()` `resume()`s the SAME recorder rather
 * than starting a new one. Only `stopRecording()` (called once, at End)
 * actually finalizes it and returns the Blob spanning every pause/resume
 * segment — so toggling the Record button mid-call never drops an earlier
 * segment (which start/stop-a-new-recorder-each-time would).
 *
 * One call object per mount. `join()` creates it; `leave()` and unmount both
 * tear it down (idempotent — safe to call either more than once).
 *
 * Teardown (`leave()`/unmount) is async under the hood — `co.leave()` and
 * `co.destroy()` both take a beat — so `callRef.current` is only cleared
 * once that real work finishes, and the promise driving it is tracked in
 * `tearingDownRef`. `join()` awaits any in-flight teardown before creating a
 * new call object, so a rapid leave-then-rejoin (e.g. React 18 StrictMode's
 * dev double-invoke of `useEffect(() => { join(); return () => leave() })`)
 * can never end up with two live Daily call objects at once (Daily throws
 * "Duplicate DailyIframe/callObject" if it does).
 */
export function useDailyCall() {
  const callRef = useRef<DailyCall | null>(null)
  const joiningRef = useRef(false)
  const listenersOffRef = useRef<(() => void) | null>(null)
  // Set for the lifetime of an in-flight teardown (leave/unmount); resolves
  // once the old call object is actually gone. join() awaits this before
  // doing anything else, and the post-await-join continuation treats a
  // non-null value here as "a leave raced us — don't resurrect 'joined'".
  const tearingDownRef = useRef<Promise<void> | null>(null)

  const [callState, setCallState] = useState<CallState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<DailyParticipant[]>([])
  const [localParticipant, setLocalParticipant] = useState<DailyParticipant | null>(null)
  const [waitingParticipants, setWaitingParticipants] = useState<WaitingParticipant[]>([])
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  // Set while a stopRecording() is in flight (recorder mid-stop, `onstop`
  // not fired yet). Lets a second caller (e.g. teardown racing an explicit
  // stopRecording()) await the *same* stop instead of reassigning
  // `rec.onstop` out from under the first caller and losing its resolve.
  const stoppingRef = useRef<Promise<Blob | null> | null>(null)

  // co.participants() is the authoritative source — we just mirror it into
  // state (split local vs. remote) whenever Daily tells us something changed.
  const refreshParticipants = useCallback(() => {
    const co = callRef.current
    if (!co) return
    const all = co.participants()
    const remote: DailyParticipant[] = []
    let local: DailyParticipant | null = null
    Object.values(all).forEach((p) => {
      if (p.local) local = p
      else remote.push(p)
    })
    setParticipants(remote)
    setLocalParticipant(local)
    setMuted(!co.localAudio())
    setCamOff(!co.localVideo())
  }, [])

  const refreshWaiting = useCallback(() => {
    const co = callRef.current
    if (!co) return
    const all = co.waitingParticipants()
    setWaitingParticipants(Object.values(all).map((w) => ({ id: w.id, name: w.name })))
  }, [])

  // Stops the MediaRecorder — never the underlying persistentTracks, which
  // belong to Daily's call object and are still driving the live call.
  // Idempotent and race-safe: a second concurrent call (from teardown, say)
  // gets back the same in-flight promise instead of clobbering `onstop`.
  const stopRecording = useCallback((): Promise<Blob | null> => {
    if (stoppingRef.current) return stoppingRef.current
    const rec = recorderRef.current
    if (!rec) return Promise.resolve(null)

    // The recorder may already have auto-stopped (its underlying tracks ended
    // because the call itself ended before this was called — e.g. finalizing
    // after the OTHER party ended the call first). `.stop()` on an already-
    // inactive recorder throws; return the chunks captured up to that point
    // instead of losing them to that error.
    if (rec.state === 'inactive') {
      const chunks = recordedChunksRef.current
      recorderRef.current = null
      recordedChunksRef.current = []
      return Promise.resolve(chunks.length ? new Blob(chunks, { type: 'video/webm' }) : null)
    }

    const promise = new Promise<Blob | null>((resolve) => {
      rec.onstop = () => {
        // Snapshot before clearing anything — chunks are captured here so a
        // concurrent teardown can't empty recordedChunksRef out from under
        // this in-flight stop and turn a real recording into `null`.
        const chunks = recordedChunksRef.current
        recorderRef.current = null
        recordedChunksRef.current = []
        resolve(chunks.length ? new Blob(chunks, { type: 'video/webm' }) : null)
      }
      try {
        rec.stop()
      } catch {
        recorderRef.current = null
        resolve(null)
      }
    }).finally(() => {
      stoppingRef.current = null
    })

    stoppingRef.current = promise
    return promise
  }, [])

  // Single source of truth for tearing down the call object. Safe to call
  // more than once concurrently or sequentially — a second call while one is
  // already running just returns the same promise.
  const teardown = useCallback((): Promise<void> => {
    if (tearingDownRef.current) return tearingDownRef.current

    const co = callRef.current
    const run = async () => {
      // Let a recording that's already mid-stop resolve with its real chunks
      // before touching recorder state; if one is active but no stop was
      // ever requested, request one now. Either way we never yank chunks/
      // recorder out from under a pending stopRecording().
      if (stoppingRef.current) {
        try { await stoppingRef.current } catch { /* best-effort */ }
      } else if (recorderRef.current) {
        try { await stopRecording() } catch { /* best-effort */ }
      }

      listenersOffRef.current?.()
      listenersOffRef.current = null

      if (co) {
        try { await co.leave() } catch { /* best-effort */ }
        try { await co.destroy() } catch { /* best-effort */ }
      }

      // Only clear the ref once the real Daily teardown has finished. A
      // concurrent join() waits on tearingDownRef (below) before it looks at
      // callRef, so nothing can mistake "not yet destroyed" for "free to
      // create a new call object" — that race is what causes Daily's
      // "Duplicate DailyIframe/callObject" crash.
      callRef.current = null
    }

    const promise = run().finally(() => {
      tearingDownRef.current = null
    })
    tearingDownRef.current = promise
    return promise
  }, [stopRecording])

  const join = useCallback(async (roomUrl: string, token: string) => {
    // A prior leave()/unmount teardown may still be mid-flight (destroying
    // the old call object) — wait for it to actually finish before doing
    // anything else, so we never create a second call object while the
    // first one is still alive.
    if (tearingDownRef.current) {
      try { await tearingDownRef.current } catch { /* best-effort */ }
    }
    if (joiningRef.current || callRef.current) return // guard double-join
    joiningRef.current = true
    setError(null)
    setCallState('joining')
    let co: DailyCall | null = null
    try {
      co = DailyIframe.createCallObject({ subscribeToTracksAutomatically: true })
      callRef.current = co

      const onParticipantChange = () => refreshParticipants()
      const onWaitingChange = () => refreshWaiting()
      const onError = (ev: { errorMsg?: string }) => {
        setError(ev.errorMsg ?? 'Call error')
        setCallState('error')
      }
      const onLeftMeeting = () => setCallState((s) => (s === 'error' ? s : 'left'))

      co.on('participant-joined', onParticipantChange)
      co.on('participant-updated', onParticipantChange)
      co.on('participant-left', onParticipantChange)
      co.on('waiting-participant-added', onWaitingChange)
      co.on('waiting-participant-updated', onWaitingChange)
      co.on('waiting-participant-removed', onWaitingChange)
      co.on('error', onError)
      co.on('left-meeting', onLeftMeeting)

      listenersOffRef.current = () => {
        try {
          co!.off('participant-joined', onParticipantChange)
          co!.off('participant-updated', onParticipantChange)
          co!.off('participant-left', onParticipantChange)
          co!.off('waiting-participant-added', onWaitingChange)
          co!.off('waiting-participant-updated', onWaitingChange)
          co!.off('waiting-participant-removed', onWaitingChange)
          co!.off('error', onError)
          co!.off('left-meeting', onLeftMeeting)
        } catch { /* call object may already be destroyed */ }
      }

      await co.join({ url: roomUrl, token })

      // A concurrent leave()/teardown may have started (or already
      // finished) while we were awaiting the network join — if so, don't
      // resurrect 'joined' (or refresh state off a call object that's
      // mid-/post-destroy). Whoever is tearing down will land on 'left'.
      if (callRef.current !== co || tearingDownRef.current) return

      refreshParticipants()
      refreshWaiting()
      setCallState('joined')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join the call')
      setCallState('error')
      await teardown()
    } finally {
      joiningRef.current = false
    }
  }, [refreshParticipants, refreshWaiting, teardown])

  const leave = useCallback(async () => {
    await teardown()
    setParticipants([])
    setLocalParticipant(null)
    setWaitingParticipants([])
    setCallState('left')
  }, [teardown])

  const toggleMic = useCallback(() => {
    const co = callRef.current
    if (!co) return
    const nextEnabled = !co.localAudio()
    co.setLocalAudio(nextEnabled)
    setMuted(!nextEnabled)
  }, [])

  const toggleCam = useCallback(() => {
    const co = callRef.current
    if (!co) return
    const nextEnabled = !co.localVideo()
    co.setLocalVideo(nextEnabled)
    setCamOff(!nextEnabled)
  }, [])

  const admit = useCallback(async (id: string) => {
    const co = callRef.current
    if (!co) return
    try {
      // Installed @daily-co/daily-js types (0.91) declare
      // grantRequestedAccess as a boolean, not `{ level: 'full' }`.
      await co.updateWaitingParticipant(id, { grantRequestedAccess: true })
    } catch { /* best-effort — the waiting-participant-* events resync state */ }
  }, [])

  // Starts the (single, continuous) recording — or, if one is already active,
  // no-ops; if one exists but is PAUSED (a prior pauseRecording() toggle),
  // resumes that SAME recorder instead of creating a new one, so the buffer
  // accumulated so far is never discarded.
  const startRecording = useCallback(() => {
    const existing = recorderRef.current
    if (existing) {
      if (existing.state === 'paused') { try { existing.resume() } catch { /* best-effort */ } }
      return
    }
    const co = callRef.current
    if (!co) return
    const all = co.participants()
    const remote = Object.values(all).find((p) => !p.local) ?? null
    const local = all.local

    const tracks: MediaStreamTrack[] = []
    if (remote) {
      // Record the remote participant's video + audio, plus the local mic,
      // so the recruiter's own side of the conversation is captured too.
      const rv = remote.tracks.video.persistentTrack
      const ra = remote.tracks.audio.persistentTrack
      const la = local?.tracks.audio.persistentTrack
      if (rv) tracks.push(rv)
      if (ra) tracks.push(ra)
      if (la) tracks.push(la)
    } else {
      // Best-effort: no remote participant yet — record the local feed alone.
      // NOTE (known limitation, not fixed here): if recording is started
      // before the remote joins, that pre-join stretch stays local-only —
      // acceptable since the recruiter records after admitting.
      const lv = local?.tracks.video.persistentTrack
      const la = local?.tracks.audio.persistentTrack
      if (lv) tracks.push(lv)
      if (la) tracks.push(la)
    }
    if (!tracks.length) return // nothing playable to record yet

    try {
      const stream = new MediaStream(tracks)
      recordedChunksRef.current = []
      const rec = new MediaRecorder(stream, recorderOptions('video'))
      rec.ondataavailable = (e) => { if (e.data.size) recordedChunksRef.current.push(e.data) }
      rec.start()
      recorderRef.current = rec
    } catch {
      recorderRef.current = null // recording unsupported — call continues without it
    }
  }, [])

  // Pauses the active recorder WITHOUT finalizing it — the chunk buffer stays
  // put so a later startRecording() resumes the SAME recorder (no dropped
  // segment). Use this for a mid-call Record toggle-off; use stopRecording()
  // only when the recording is really over (End).
  const pauseRecording = useCallback(() => {
    const rec = recorderRef.current
    if (!rec || rec.state !== 'recording') return
    try { rec.pause() } catch { /* best-effort */ }
  }, [])

  // Full teardown on unmount — leave/destroy the call object, let any
  // in-flight recorder stop resolve cleanly, and detach listeners. Safe even
  // if leave() was already called (teardown is idempotent). Fire-and-forget
  // here (effect cleanups can't be async); the promise is still tracked via
  // tearingDownRef so a remount's join() waits for it.
  useEffect(() => () => { teardown() }, [teardown])

  return {
    join,
    leave,
    participants,
    localParticipant,
    toggleMic,
    toggleCam,
    muted,
    camOff,
    startRecording,
    pauseRecording,
    stopRecording,
    waitingParticipants,
    admit,
    callState,
    error,
  }
}

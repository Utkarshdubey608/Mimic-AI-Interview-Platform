import { useCallback, useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, type Participant, type RemoteParticipant } from 'livekit-client'

export type CallState = 'idle' | 'joining' | 'joined' | 'left' | 'error'

export interface WaitingParticipant {
  id: string
  name: string
}

/**
 * useLiveKitCall — DROP-IN replacement for useDailyCall.
 *
 * Exposes the SAME public surface the two-way screens already consume
 * (join / leave / participants / localParticipant / toggleMic / toggleCam /
 * muted / camOff / callState / error), so TwoWayStage (candidate) and
 * LiveInterviewPage (recruiter) swap the import with almost no other change.
 * Participants are livekit-client `Participant` objects — LiveKitVideoTile
 * attaches their tracks (same prop shape as DailyVideoTile).
 *
 * Two deliberate differences from useDailyCall, both because LiveKit does the
 * heavy lifting server-side:
 *  - NO client MediaRecorder. The recording is produced by LiveKit Egress on
 *    the server (backend starts it on twoway/host, stops it on twoway/complete),
 *    which kills the "recruiter tab crashed → recording lost" class of bugs and
 *    the browser upload cap. So there are no start/pause/stopRecording methods.
 *  - NO waiting room / knock-admit. LiveKit tokens are authorized when minted,
 *    so a candidate is in the room the moment they connect. `waitingParticipants`
 *    is always empty and `admit` is a no-op, kept only so the recruiter screen
 *    stays a pure import swap.
 *
 * One Room per mount: join() creates it; leave() and unmount tear it down
 * (both idempotent).
 */
export function useLiveKitCall() {
  const roomRef = useRef<Room | null>(null)
  const joiningRef = useRef(false)

  const [callState, setCallState] = useState<CallState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [participants, setParticipants] = useState<RemoteParticipant[]>([])
  const [localParticipant, setLocalParticipant] = useState<Participant | null>(null)
  const [muted, setMuted] = useState(false)
  const [camOff, setCamOff] = useState(false)
  const [screenSharing, setScreenSharing] = useState(false)

  // room state is the source of truth — mirror it into React state whenever
  // LiveKit tells us a participant or track changed.
  const refresh = useCallback(() => {
    const room = roomRef.current
    if (!room) return
    setParticipants(Array.from(room.remoteParticipants.values()))
    setLocalParticipant(room.localParticipant)
    setMuted(!room.localParticipant.isMicrophoneEnabled)
    setCamOff(!room.localParticipant.isCameraEnabled)
    setScreenSharing(room.localParticipant.isScreenShareEnabled)
  }, [])

  const join = useCallback(
    async (roomUrl: string, token: string, opts?: { mic?: boolean; cam?: boolean }) => {
      if (joiningRef.current || roomRef.current) return // guard double-join
      joiningRef.current = true
      setError(null)
      setCallState('joining')

      const room = new Room({ adaptiveStream: true, dynacast: true })
      roomRef.current = room

      const onChange = () => refresh()
      room
        .on(RoomEvent.ParticipantConnected, onChange)
        .on(RoomEvent.ParticipantDisconnected, onChange)
        .on(RoomEvent.TrackSubscribed, onChange)
        .on(RoomEvent.TrackUnsubscribed, onChange)
        .on(RoomEvent.TrackMuted, onChange)
        .on(RoomEvent.TrackUnmuted, onChange)
        .on(RoomEvent.LocalTrackPublished, onChange)
        .on(RoomEvent.LocalTrackUnpublished, onChange)
        .on(RoomEvent.Disconnected, () => setCallState((s) => (s === 'error' ? s : 'left')))

      try {
        await room.connect(roomUrl, token)
        await room.localParticipant.setMicrophoneEnabled(opts?.mic ?? true)
        await room.localParticipant.setCameraEnabled(opts?.cam ?? true)
        // A leave()/unmount may have raced the async connect — if the ref was
        // cleared (or points elsewhere) don't resurrect 'joined'.
        if (roomRef.current !== room) return
        refresh()
        setCallState('joined')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to join the call')
        setCallState('error')
        try { await room.disconnect() } catch { /* best-effort */ }
        if (roomRef.current === room) roomRef.current = null
      } finally {
        joiningRef.current = false
      }
    },
    [refresh],
  )

  const leave = useCallback(async () => {
    const room = roomRef.current
    roomRef.current = null
    if (room) { try { await room.disconnect() } catch { /* best-effort */ } }
    setParticipants([])
    setLocalParticipant(null)
    setCallState('left')
  }, [])

  const toggleMic = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const next = !room.localParticipant.isMicrophoneEnabled
    await room.localParticipant.setMicrophoneEnabled(next)
    setMuted(!next)
  }, [])

  const toggleCam = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const next = !room.localParticipant.isCameraEnabled
    await room.localParticipant.setCameraEnabled(next)
    setCamOff(!next)
  }, [])

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    const next = !room.localParticipant.isScreenShareEnabled
    // The browser's own "Stop sharing" ends the track; LocalTrackUnpublished
    // fires and our refresh() keeps this flag in sync either way.
    await room.localParticipant.setScreenShareEnabled(next)
    setScreenSharing(next)
  }, [])

  // Full teardown on unmount (effect cleanups can't be async — fire & forget).
  useEffect(() => () => { void roomRef.current?.disconnect(); roomRef.current = null }, [])

  // Removed-surface stubs (see docstring): no waiting room, no client recording.
  const waitingParticipants: WaitingParticipant[] = []
  const admit = useCallback(async (_id: string) => {}, [])

  return {
    join,
    leave,
    participants,
    localParticipant,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    muted,
    camOff,
    screenSharing,
    callState,
    error,
    waitingParticipants,
    admit,
  }
}

import { useEffect, useRef, useState } from 'react'
import { MicOff, VideoOff } from 'lucide-react'
import { Track, type Participant } from 'livekit-client'

interface Props {
  participant: Participant
  /** Force-mute this tile's audio playback (local tiles never play audio). */
  muted?: boolean
  label?: string
}

/**
 * LiveKit equivalent of DailyVideoTile — attaches a LiveKit participant's
 * camera (and, for remote tiles, mic) tracks to plain <video>/<audio>
 * elements. Same look/props as DailyVideoTile so TwoWayStage / LiveInterviewPage
 * swap the import with no layout change.
 */
export function LiveKitVideoTile({ participant, muted = false, label }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [camOff, setCamOff] = useState(true)
  const [micMuted, setMicMuted] = useState(true)
  const isLocal = participant.isLocal

  useEffect(() => {
    const sync = () => {
      const cam = participant.getTrackPublication(Track.Source.Camera)
      const mic = participant.getTrackPublication(Track.Source.Microphone)

      // video
      const vEl = videoRef.current
      if (vEl) {
        if (cam?.track && !cam.isMuted) { cam.track.attach(vEl); setCamOff(false) }
        else { vEl.srcObject = null; setCamOff(true) }
      }
      // audio — remote tiles only (never play your own mic back → echo)
      const aEl = audioRef.current
      if (aEl && !isLocal) {
        if (mic?.track && !mic.isMuted) mic.track.attach(aEl)
        else aEl.srcObject = null
      }
      setMicMuted(!mic || mic.isMuted)
    }

    sync()
    // Re-sync on the events that change a participant's tracks.
    participant
      .on('trackSubscribed', sync).on('trackUnsubscribed', sync)
      .on('trackMuted', sync).on('trackUnmuted', sync)
      .on('trackPublished', sync).on('localTrackPublished', sync)
      .on('localTrackUnpublished', sync)
    return () => {
      participant
        .off('trackSubscribed', sync).off('trackUnsubscribed', sync)
        .off('trackMuted', sync).off('trackUnmuted', sync)
        .off('trackPublished', sync).off('localTrackPublished', sync)
        .off('localTrackUnpublished', sync)
    }
  }, [participant, isLocal])

  const name = label ?? (participant.name || (isLocal ? 'You' : 'Guest'))

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-neutral-900">
      <video ref={videoRef} autoPlay muted={isLocal} playsInline className="h-full w-full object-cover" />
      {!isLocal && <audio ref={audioRef} autoPlay muted={muted} />}
      {camOff && (
        <div className="absolute inset-0 grid place-items-center text-neutral-500">
          <VideoOff className="h-8 w-8" />
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {micMuted && <MicOff className="h-3 w-3 text-red-400" />}
        {name}
      </div>
    </div>
  )
}

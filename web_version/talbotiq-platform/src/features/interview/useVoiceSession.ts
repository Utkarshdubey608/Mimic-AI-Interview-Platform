import { useCallback, useEffect, useRef, useState } from 'react'
import { VoiceClient } from '@/lib/voiceClient'
import { isSpeechRecognitionSupported } from '@/lib/speechRecognition'
import { applyLocal, applyRemote, type MergedCaption } from './captionMerge'
import type { VoicePhase, TimeOfDay } from '@shared/types'

export type { MergedCaption }

const localTimeOfDay = (): TimeOfDay => {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
}

/**
 * Drives a live voice interview: mic permission → Gemini Live over WebSocket →
 * audio round-trip. Exposes the call phase, live captions, and mute/end controls.
 *
 * ── Why captions are merged from two sources ─────────────────────────────
 * Gemini's `inputTranscription` is the authoritative record of what the
 * candidate said, and it is what the interview is scored from. It is also not
 * live: the server-side VAD waits for end-of-speech before emitting the
 * utterance in one block.
 *
 * That produced a bug worse than lag. Because the model begins its next turn as
 * soon as the candidate's turn closes, the candidate's transcript often arrived
 * AFTER the following question had already streamed in, and the old merge
 * appended it at the end of the list. The rail therefore showed the
 * conversation OUT OF ORDER:
 *
 *     YOU             .
 *     AI INTERVIEWER  …Can you elaborate on the optimisation techniques?
 *     YOU             Sure, let's start.        ← actually said before the question
 *
 * So the browser's own recogniser (`useLiveCaptions`) now opens the candidate's
 * line the instant they start speaking, which both makes the text appear
 * immediately AND fixes its position in the conversation. When Gemini's version
 * of that turn arrives it overwrites that same line in place instead of
 * appending a new one.
 *
 * The local text is display only and never leaves the browser; `voiceClient`
 * still POSTs only Gemini's finalised utterances to the transcript endpoint.
 */
export function useVoiceSession(sessionId: string) {
  const [serverPhase, setServerPhase] = useState<VoicePhase>('connecting')
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [captions, setCaptions] = useState<MergedCaption[]>([])
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [reconnecting, setReconnecting] = useState(false) // socket dropped, transparently retrying
  const [endedGraceful, setEndedGraceful] = useState(true) // false ⇒ interrupted, not a real finish
  const clientRef = useRef<VoiceClient | null>(null)
  const startedRef = useRef(false)
  const everSpokeRef = useRef(false) // agent audio has been audible at least once
  const [live, setLive] = useState(false) // the call is up: run the local recogniser

  const start = useCallback(async () => {
    if (startedRef.current) return
    startedRef.current = true
    setError(null)
    const client = new VoiceClient(sessionId, {
      onPhase: setServerPhase,
      onAudioPlaying: (p) => { if (p) everSpokeRef.current = true; setAudioPlaying(p) },
      onCaption: (role, text, final) => setCaptions((prev) => applyRemote(prev, role, text, final)),
      onReconnecting: (active) => setReconnecting(active),
      onEnded: (_reason, graceful) => {
        setReconnecting(false)
        setEndedGraceful(graceful !== false)
        setServerPhase('ended')
        setLive(false)
      },
      onError: (m) => setError(m),
    })
    clientRef.current = client
    try {
      await client.start(localTimeOfDay())
      setLive(true)
    } catch (e) {
      startedRef.current = false
      const err = e as DOMException
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
        setPermissionDenied(true)
        setError('Microphone access is required for a voice interview.')
      } else {
        setError(err?.message || 'Could not start the microphone.')
      }
      setServerPhase('error')
    }
  }, [sessionId])

  const toggleMute = useCallback(() => {
    setMuted((m) => { const next = !m; clientRef.current?.setMuted(next); return next })
  }, [])

  const end = useCallback(() => {
    clientRef.current?.end()
    setServerPhase('ended')
    setLive(false)
  }, [])

  // On unmount, tear down the mic/socket WITHOUT finalizing — only the explicit
  // End button (or the server's own wrap-up) ends the interview.
  useEffect(() => () => { clientRef.current?.dispose() }, [])

  /* ── Live captions ──────────────────────────────────────────────────────
     The instant half of the transcript is produced inside VoiceClient, not
     here. It runs the browser's own recogniser purely for display, pauses it
     while the interviewer's audio is playing so the microphone cannot caption
     the speakers, and emits the running line through the SAME `onCaption`
     channel as Google's authoritative text. That is what lets `applyRemote`
     replace the local line in place when Google's version lands, instead of
     appending it after whatever was said next.

     An earlier version of this hook ran a SECOND recogniser at this level. Two
     recognisers on one microphone caption every answer twice, so it is gone. */
  const captionsLive = isSpeechRecognitionSupported()

  // Ear-accurate phase: "speaking" only while agent audio is actually audible
  // (server phases lead local playback by the buffered duration). The moment the
  // audio drains, it's the candidate's turn — show "listening", never a stale
  // "speaking"/"one moment" that reads as lag.
  const phase: VoicePhase =
    serverPhase === 'connecting' || serverPhase === 'ended' || serverPhase === 'error'
      ? serverPhase
      : audioPlaying
        ? 'speaking'
        : serverPhase === 'greeting' && !everSpokeRef.current
          ? 'thinking' // greeting is still being generated — nothing audible yet
          : serverPhase === 'speaking' || serverPhase === 'greeting'
            ? 'listening'
            : serverPhase

  return {
    phase, captions, muted, error, permissionDenied, reconnecting, endedGraceful,
    captionsLive, start, toggleMute, end,
  }
}

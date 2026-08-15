import { useCallback, useEffect, useRef, useState } from 'react'
import { RekognitionService, aggregateFacialData } from '@/services/rekognitionService'
import type { FacialSessionSummary } from '@/types/rekognition.types'
import { getIdTokenOrNull } from '@/lib/firebase'
import { wsUrl } from '@/lib/apiOrigin'

/**
 * Owns ONE camera+mic stream for the whole Video Interview. Each answer is
 * transcribed LIVE off the shared stream's audio track via the Deepgram relay
 * (no blob recording, no video upload — see Task 2 of the live-transcript
 * rework). The same stream can also be tapped for facial-frame capture (Task 7).
 */
export function useAnswerRecorder() {
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rekogRef = useRef<RekognitionService | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const audioRecRef = useRef<MediaRecorder | null>(null)
  const transcriptRef = useRef('')            // accumulated finals for the current answer
  const [liveTranscript, setLiveTranscript] = useState('')
  const [transcriptConnected, setTranscriptConnected] = useState(false)
  // Bumped on every stop/unmount so a startTranscribing() setup that's still
  // awaiting the token/socket when a stop or unmount races it can detect it's
  // been superseded and back off instead of leaving an orphaned socket.
  const transcribeGenRef = useRef(0)

  const acquire = useCallback(async () => {
    if (streamRef.current) return streamRef.current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true })
      streamRef.current = stream
      setReady(true)
      return stream
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Camera/microphone access is required')
      throw e
    }
  }, [])

  const startTranscribing = useCallback(() => {
    const stream = streamRef.current
    if (!stream || wsRef.current) return
    const gen = ++transcribeGenRef.current
    transcriptRef.current = ''
    setLiveTranscript('')
    setRecording(true)                         // drives the aesthetic REC dot
    void (async () => {
      const token = await getIdTokenOrNull()
      if (gen !== transcribeGenRef.current) return                 // superseded during token fetch
      const ws = new WebSocket(wsUrl(`/api/interview/deepgram${token ? `?token=${encodeURIComponent(token)}` : ''}`))
      if (gen !== transcribeGenRef.current) { try { ws.close() } catch { /* noop */ } return }
      wsRef.current = ws
      ws.onopen = () => {
        if (gen !== transcribeGenRef.current) { try { ws.close() } catch { /* noop */ } return }
        setTranscriptConnected(true)
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
        const audioStream = new MediaStream(stream.getAudioTracks())
        const rec = new MediaRecorder(audioStream, { mimeType: mime })
        audioRecRef.current = rec
        rec.ondataavailable = (e) => { if (e.data.size && ws.readyState === WebSocket.OPEN) ws.send(e.data) }
        rec.start(250)
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type !== 'Results') return
          const text = (msg.channel?.alternatives?.[0]?.transcript ?? '').trim()
          if (!text) return
          if (msg.is_final || msg.speech_final) {
            transcriptRef.current = (transcriptRef.current + ' ' + text).trim()
            setLiveTranscript(transcriptRef.current)
          }
        } catch { /* ignore malformed */ }
      }
      ws.onerror = () => setTranscriptConnected(false)
      ws.onclose = () => setTranscriptConnected(false)
    })()
  }, [])

  const stopTranscribing = useCallback((): Promise<string> => {
    transcribeGenRef.current++                 // invalidate any in-flight startTranscribing setup
    setRecording(false)
    const rec = audioRecRef.current
    const ws = wsRef.current
    const finish = () => { try { ws?.close() } catch { /* noop */ }; wsRef.current = null; audioRecRef.current = null; return transcriptRef.current.trim() }
    return new Promise((resolve) => {
      if (!rec) { resolve(finish()); return }
      // Flush the final chunk, allow a short grace for a full relay round-trip
      // (browser → relay → Deepgram → relay → browser) for the last Results, then resolve.
      rec.onstop = () => setTimeout(() => resolve(finish()), 1200)
      try { rec.stop() } catch { resolve(finish()) }
    })
  }, [])

  // Release the camera on unmount (once — the whole interview shares this stream).
  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()) }, [])

  // Close the transcription socket/recorder on unmount too, so an abandoned
  // interview doesn't leak an open WebSocket or a running MediaRecorder. Also
  // bump the generation so a startTranscribing() setup racing unmount can't
  // reopen a socket after we've torn down.
  useEffect(() => () => {
    transcribeGenRef.current++
    try { audioRecRef.current?.stop() } catch { /* noop */ }
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  // Release the Rekognition capture on unmount too, so an abandoned interview
  // doesn't leak its setInterval + hidden video/canvas elements.
  useEffect(() => () => { rekogRef.current?.stopCapture(); rekogRef.current = null }, [])

  const attachPreview = useCallback((el: HTMLVideoElement | null) => {
    if (el && streamRef.current) el.srcObject = streamRef.current
  }, [])

  // Facial capture (Task 7) — taps the SAME shared stream via AWS Rekognition,
  // no second getUserMedia. Idempotent: a second startFacial call (e.g. from a
  // remounted VideoStage) is a no-op once rekogRef is set. Frames POST to the
  // candidate-authorized session route (not the recruiter-only avatar proxy),
  // so a Video-Interview candidate can actually reach it. Degrades gracefully:
  // when the server has no AWS creds, the route replies with a failed-frame
  // shape and FacialAnalysisPanel shows a clear "not captured" state.
  const startFacial = useCallback((sessionId: string, questionCount: number) => {
    const stream = streamRef.current
    if (!stream || rekogRef.current) return
    const svc = new RekognitionService(`/api/sessions/${sessionId}/facial-frame`)
    rekogRef.current = svc
    void svc.startCapture(stream)
    void questionCount
  }, [])

  const setFacialQuestion = useCallback((idx: number) => { rekogRef.current?.setCurrentQuestion(idx) }, [])

  const stopFacial = useCallback((questionCount: number): FacialSessionSummary | null => {
    const svc = rekogRef.current
    if (!svc) return null
    const frames = svc.stopCapture()
    rekogRef.current = null
    return frames.length ? aggregateFacialData(frames, questionCount) : null
  }, [])

  return {
    ready, recording, error, acquire, attachPreview, streamRef,
    startTranscribing, stopTranscribing, liveTranscript, transcriptConnected,
    startFacial, setFacialQuestion, stopFacial,
  }
}

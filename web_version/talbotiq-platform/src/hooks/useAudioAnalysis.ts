import { useEffect, useRef, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { audioStore } from '@/services/audioStore'
import { countFillers, calcWpm } from '@/services/deepgram'
import { wsUrl } from '@/lib/apiOrigin'
import { getIdTokenOrNull } from '@/lib/firebase'
import { createAudioCapture, type AudioCapture } from '@/services/audioCapture'
import { useAppStore } from '@/store/useAppStore'

/**
 * Single-mic unified audio analysis hook (hybrid credential model).
 *
 * Opens ONE getUserMedia stream and:
 *  - streams WebM/Opus chunks to our server-side Deepgram RELAY (/api/avatar/deepgram)
 *    for real-time transcription — the Deepgram key stays on the server.
 *  - records the same stream to a WebM blob (audioStore) for later batch analysis.
 *
 * NOTE: Hume live EVI streaming was removed — it required the Hume key inside a
 * browser WebSocket URL (violates the server-side-keys rule), and Hume's batch
 * Expression-Measurement API has been discontinued by the provider, so there is no
 * live emotion stream. Voice analytics (WPM / fillers / transcript) come from
 * Deepgram and remain fully functional.
 *
 * Public contract unchanged: { interimText, dgConnected, sealAndGetBlob }.
 *
 * PERF: `interimText` state updates fire several times per second while the
 * candidate speaks and re-render the host component — which sits next to the
 * live call iframe. No mounted consumer renders it today, so interim tracking
 * is opt-in via `opts.trackInterim`; question attribution (utteranceQRef) is
 * unaffected. The host is also no longer subscribed to the whole zustand store.
 */
export function useAudioAnalysis(enabled: boolean, opts?: { trackInterim?: boolean }) {
  const trackInterim = opts?.trackInterim === true
  const deepgramKey = useAppStore((s) => s.deepgramKey)
  // Store ACTIONS are stable — read them off the store object once, not via a
  // whole-store subscription that re-renders on every transcript/metric change.
  const store = useAppStore.getState()
  const [interimText, setInterimText] = useState('')
  const [dgConnected, setDgConnected] = useState(false)

  const captureRef      = useRef<AudioCapture | null>(null)
  const dgWsRef         = useRef<WebSocket | null>(null)
  const totalFillersRef = useRef(0)
  // Question index captured when an utterance STARTS (first interim), so a long
  // answer's tail isn't mis-attributed to the next question if the index advances
  // while Deepgram is still finalizing the last words.
  const utteranceQRef   = useRef<number | null>(null)
  // Buffer chunks captured before the socket opens so the FIRST chunk (the WebM
  // header) is never lost — without it Deepgram can't decode the stream.
  const dgQueueRef      = useRef<Blob[]>([])

  const sealAndGetBlob = useCallback(async (): Promise<Blob | null> => {
    try { await captureRef.current?.flushRecording() } catch { /* seal what we have */ }
    audioStore.seal()
    return audioStore.blob
  }, [])

  useEffect(() => {
    if (!enabled) return
    // deepgramKey is a non-secret 'server' sentinel when the backend has a
    // Deepgram key configured (see useAppStore). No key value is ever used here.
    // IMPORTANT: the mic RECORDING (for voice-emotion analysis) must run even
    // when Deepgram is unconfigured — only the live-transcription socket is
    // conditional on it.
    const deepgramConfigured = !!deepgramKey

    let cancelled = false
    let dgClosed = false
    totalFillersRef.current = 0
    dgQueueRef.current = []

    async function start() {
      // ── Deepgram via server relay — real-time transcription (optional) ───
      if (deepgramConfigured) try {
        const dgToken = await getIdTokenOrNull()
        const dgWs = new WebSocket(wsUrl(`/api/avatar/deepgram${dgToken ? `?token=${encodeURIComponent(dgToken)}` : ''}`))
        dgWs.binaryType = 'arraybuffer'
        dgWsRef.current = dgWs

        dgWs.onopen = () => {
          if (cancelled) { dgWs.close(); return }
          setDgConnected(true)
          store.setDeepgramConnected(true)
          const queued = dgQueueRef.current
          dgQueueRef.current = []
          for (const b of queued) if (dgWs.readyState === WebSocket.OPEN) dgWs.send(b)
          toast.success('Live transcription active', { id: 'dg-live', duration: 2500 })
        }

        dgWs.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data)
            if (msg.type === 'Results') {
              const text = (msg.channel?.alternatives?.[0]?.transcript ?? '').trim()
              if (!text) return
              if (msg.is_final) {
                if (trackInterim) setInterimText('')
                totalFillersRef.current += countFillers(text)
                const entry = {
                  role: 'candidate' as const,
                  text,
                  timestamp: Date.now(),
                  // Attribute to the question the utterance STARTED under.
                  questionIdx: utteranceQRef.current ?? useAppStore.getState().currentQuestionIdx,
                }
                utteranceQRef.current = null
                store.pushTranscriptEntry(entry)
                // Zustand set() is synchronous — the store already includes the
                // entry (spreading it in again double-counted its words in WPM).
                const wpm = calcWpm(useAppStore.getState().sessionTranscript)
                store.updateMetrics({
                  wpm: wpm > 0 ? wpm : useAppStore.getState().metrics.wpm,
                  fillers: totalFillersRef.current,
                })
              } else {
                if (utteranceQRef.current === null) utteranceQRef.current = useAppStore.getState().currentQuestionIdx
                if (trackInterim) setInterimText(text)
              }
            }
            if (msg.type === 'UtteranceEnd') { if (trackInterim) setInterimText(''); utteranceQRef.current = null }
          } catch { /* ignore malformed */ }
        }

        dgWs.onerror = () => { setDgConnected(false); store.setDeepgramConnected(false) }
        let closedShown = false
        dgWs.onclose = (ev) => {
          dgClosed = true
          dgQueueRef.current = [] // stop buffering — nothing will ever drain it
          if (cancelled) return
          setDgConnected(false)
          store.setDeepgramConnected(false)
          if (!closedShown && ev.code !== 1000) {
            closedShown = true
            console.warn('[AudioAnalysis] Deepgram relay closed:', ev.code, ev.reason)
            toast.error('Live transcription disconnected', { id: 'dg-error', duration: 4000 })
          }
        }
      } catch (dgErr) {
        console.error('[AudioAnalysis] Deepgram relay init failed:', dgErr)
      }

      // ── Single mic → capture → Deepgram chunks + batch recording ─────────
      try {
        audioStore.reset()
        const capture = createAudioCapture({
          sampleRate: 16000,
          recorderTimeslice: 1000,
          deepgramTimeslice: 250,
          onDeepgramChunk: (blob: Blob) => {
            if (!deepgramConfigured || dgClosed) return
            const dg = dgWsRef.current
            if (dg && dg.readyState === WebSocket.OPEN) dg.send(blob)
            else {
              // Pre-open buffer only — capped so a socket that never opens
              // can't grow the queue for the whole interview.
              dgQueueRef.current.push(blob)
              if (dgQueueRef.current.length > 48) dgQueueRef.current.shift()
            }
          },
          // No onPCMChunk: live EVI was removed, and omitting the consumer now
          // skips the whole AudioContext + AudioWorklet pipeline (per-call CPU).
          onRecordingChunk: (blob: Blob) => { audioStore.push(blob) },
        })
        captureRef.current = capture
        await capture.start()
        if (cancelled) { capture.stop(); captureRef.current = null; return }
        // Re-anchor question timestamps to the RECORDING start. The page pushes
        // the first timestamp at mount, but the recording only begins once the
        // user grants mic permission — without re-anchoring, every per-question
        // emotion window would be shifted late by that permission delay.
        const s = useAppStore.getState()
        s.resetQuestionTimestamps()
        s.pushQuestionTimestamp(Date.now())
      } catch (err) {
        console.error('[AudioAnalysis] audio capture failed:', err)
        const e = err as { name?: string }
        toast.error(
          e?.name === 'NotAllowedError'
            ? 'Mic access denied — allow microphone to enable transcription'
            : 'Microphone unavailable — transcription disabled',
          { id: 'mic-error', duration: 6000 },
        )
      }
    }

    start()

    return () => {
      cancelled = true
      setDgConnected(false)
      if (trackInterim) setInterimText('')
      store.setDeepgramConnected(false)
      store.setHumeStreamActive(false)
      captureRef.current?.stop()
      captureRef.current = null
      dgQueueRef.current = []
      dgWsRef.current?.close()
      dgWsRef.current = null
    }
  }, [enabled, deepgramKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { interimText, dgConnected, sealAndGetBlob }
}

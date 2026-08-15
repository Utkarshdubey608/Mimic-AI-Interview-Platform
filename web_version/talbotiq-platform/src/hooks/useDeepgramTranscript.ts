import { useEffect, useRef, useState } from 'react'
import { countFillers, calcWpm } from '@/services/deepgram'
import { getIdTokenOrNull } from '@/lib/firebase'
import { wsUrl } from '@/lib/apiOrigin'
import { useAppStore } from '@/store/useAppStore'

interface DgResult {
  type: string
  is_final: boolean
  speech_final: boolean
  channel?: {
    alternatives?: Array<{ transcript: string; confidence: number }>
  }
}

export function useDeepgramTranscript(enabled: boolean) {
  const store = useAppStore()
  const [interimText, setInterimText] = useState('')
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const totalFillersRef = useRef(0)

  useEffect(() => {
    if (!enabled || !store.deepgramKey) return
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream

        // Hybrid: connect to our server-side Deepgram relay. The API key stays on
        // the server (injected into the upstream Deepgram WS); we just stream the
        // MediaRecorder WebM/Opus chunks and the relay passes results straight back.
        const token = await getIdTokenOrNull()
        const ws = new WebSocket(wsUrl(`/api/avatar/deepgram${token ? `?token=${encodeURIComponent(token)}` : ''}`))
        wsRef.current = ws

        ws.onopen = () => {
          if (cancelled) { ws.close(); return }
          setConnected(true)

          // Use MediaRecorder to stream audio chunks
          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm'
          const recorder = new MediaRecorder(stream, { mimeType })
          recorderRef.current = recorder

          recorder.ondataavailable = (e) => {
            if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
              ws.send(e.data)
            }
          }
          recorder.start(250) // 250ms chunks for low latency
        }

        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data) as DgResult
            if (msg.type !== 'Results') return

            const text = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? ''
            if (!text) return

            if (msg.speech_final || (msg.is_final && !msg.speech_final)) {
              // Committed final entry
              setInterimText('')
              const fillers = countFillers(text)
              totalFillersRef.current += fillers

              const entry = {
                role: 'candidate' as const,
                text,
                timestamp: Date.now(),
                questionIdx: useAppStore.getState().currentQuestionIdx,
              }
              store.pushTranscriptEntry(entry)

              // Update real metrics from actual speech
              const allEntries = useAppStore.getState().sessionTranscript
              const allWithNew = [...allEntries, entry]
              const wpm = calcWpm(allWithNew)
              store.updateMetrics({
                wpm: wpm > 0 ? wpm : store.metrics.wpm,
                fillers: totalFillersRef.current,
              })
            } else {
              setInterimText(text)
            }
          } catch { /* ignore malformed */ }
        }

        ws.onerror = () => setConnected(false)
        ws.onclose = () => {
          if (!cancelled) setConnected(false)
        }
      } catch (err) {
        console.warn('[Deepgram] mic/ws error:', err)
        setConnected(false)
      }
    }

    start()

    return () => {
      cancelled = true
      setConnected(false)
      setInterimText('')
      recorderRef.current?.stop()
      recorderRef.current = null
      wsRef.current?.close()
      wsRef.current = null
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [enabled, store.deepgramKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { interimText, connected }
}

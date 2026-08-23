import { useEffect, useRef, useCallback } from 'react'
import { audioStore } from '@/services/audioStore'
import { useAppStore } from '@/store/useAppStore'

export function useHumeStream(enabled: boolean) {
  const store = useAppStore()
  const wsRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stop = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    recorderRef.current?.stop()
    recorderRef.current = null
    processorRef.current?.disconnect()
    processorRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    store.setHumeStreamActive(false)
  }, [store])

  useEffect(() => {
    if (!enabled || !store.humeKey) return

    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream

        // ── MediaRecorder (WebM blob for batch API) ────────────────────
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
        recorderRef.current = recorder
        audioStore.reset()
        recorder.ondataavailable = (e) => { if (e.data.size > 0) audioStore.push(e.data) }
        recorder.start(1000)

        // Live EVI streaming is intentionally OMITTED in the hybrid model — it
        // would require the Hume key inside the browser WebSocket URL. The
        // authoritative emotion data comes from the server-proxied BATCH job
        // (audio captured above via MediaRecorder → audioStore → /api/avatar/hume),
        // so the Results page is fully intact. Only the optional in-interview
        // live emotion bar is disabled; InterviewPage falls back gracefully.
        store.setHumeStreamActive(false)
      } catch (err) {
        console.warn('[HumeStream] mic/ws error:', err)
        store.setHumeStreamActive(false)
      }
    }

    start()

    return () => {
      cancelled = true
      stop()
    }
  }, [enabled, store.humeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return { stop }
}

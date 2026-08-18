import { useEffect, useRef, useState } from 'react'
import { Video, VideoOff } from 'lucide-react'

interface Props {
  active: boolean // true during the answer phase
  accentColor: string
}

/**
 * Video Avatar track — SCAFFOLD.
 *
 * Reuses the shared timing engine (prep/answer/auto-submit) and the same
 * submit/advance pipeline as the chat track. Recording is captured locally
 * via MediaRecorder; the avatar voice and upload are intentionally stubbed.
 *
 * TODO(video-avatar):
 *   - Speak the question via avatar TTS when the prep phase opens. This can
 *     plug into the repo's existing Tavus integration (src/services/tavus.ts)
 *     instead of a placeholder.
 *   - Upload the recorded Blob to storage and pass the resulting URL into the
 *     submit-answer call (SubmitAnswerRequest.videoUrl) so the recruiter view
 *     can play it back.
 */
export function CameraRecorder({ active, accentColor }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const [recording, setRecording] = useState(false)

  // Live preview for the whole stage.
  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      })
      .catch(() => {})
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Record only during the answer phase.
  useEffect(() => {
    const stream = streamRef.current
    if (!stream) return
    if (active && !recorderRef.current) {
      try {
        const rec = new MediaRecorder(stream)
        chunks.current = []
        rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
        rec.start()
        recorderRef.current = rec
        setRecording(true)
      } catch {
        /* recording unsupported — scaffold continues without it */
      }
    }
    if (!active && recorderRef.current) {
      recorderRef.current.stop()
      recorderRef.current = null
      setRecording(false)
      // TODO(video-avatar): upload Blob(chunks) and attach the URL on submit.
    }
  }, [active])

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-rule bg-brand-black shadow-sm">
      {/* Base layer — a designed "no signal" ground the live stream paints over,
          so a slow or blocked camera never reads as a broken black rectangle. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-brand-gray" aria-hidden="true">
        <VideoOff size={22} strokeWidth={1.75} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Waiting for camera</span>
      </div>

      <video ref={videoRef} autoPlay muted playsInline className="relative h-full w-full object-cover" />

      {recording ? (
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-white shadow-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-surface animate-pulse-live" aria-hidden="true" /> Recording
        </span>
      ) : (
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md border border-brand-border bg-brand-card/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-gold-light backdrop-blur-sm">
          <Video size={12} strokeWidth={2} aria-hidden="true" /> Preview
        </span>
      )}

      {!active && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3.5 bg-brand-black/70 px-6 text-center backdrop-blur-[2px]">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full border"
            style={{ borderColor: `${accentColor}66`, background: `${accentColor}24`, color: '#D7E0F5' }}
          >
            <Video size={20} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <p className="max-w-xs text-sm leading-relaxed text-brand-gold-light">
            The avatar asks the question during preparation.
            <span className="mt-1 block text-brand-gray">Recording starts automatically when the answer timer begins.</span>
          </p>
        </div>
      )}

      <span className="absolute bottom-2.5 right-3.5 font-mono text-[10px] uppercase tracking-[0.16em] text-brand-gray/60">
        scaffold
      </span>
    </div>
  )
}

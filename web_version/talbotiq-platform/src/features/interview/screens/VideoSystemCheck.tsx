import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Camera, Mic, Check, AlertTriangle, VideoOff, RefreshCw, ArrowRight } from 'lucide-react'
import type { BrandingConfig, TrackType } from '@shared/types'

interface Props {
  branding: BrandingConfig
  /** Tailors the copy below — a live human interviewer (two_way) vs. the AI avatar. */
  track?: TrackType
  onBegin: () => void
  busy?: boolean
}

/** Camera + mic permission and preview for the Video Avatar and Two-way tracks. */
export function VideoSystemCheck({ branding, track, onBegin, busy }: Props) {
  const reduce = useReducedMotion()
  const isTwoWay = track === 'two_way'
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<'idle' | 'granted' | 'denied'>('idle')

  const request = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setStatus('granted')
    } catch {
      setStatus('denied')
    }
  }

  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  const accent = branding.accentColor

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-border bg-white p-8 shadow-lg sm:p-10"
    >
      {/* Eyebrow deleted. An uppercase label above a heading is the one
          pattern no brief earns back, and on a candidate surface it was pure
          overhead: the heading below already carries the step. */}
      <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-neutral-900">
        Camera &amp; microphone
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-neutral-500">
        {isTwoWay
          ? 'You’ll join a live video call with your interviewer. We need access to your camera and mic to connect you.'
          : 'The AI avatar will ask each question aloud. We need access to your camera and mic to record your answers.'}
      </p>

      {/* Preview frame — dark stage so the self-view sits on brand ground. */}
      <div className="relative mt-7 aspect-video w-full overflow-hidden rounded-2xl border border-border bg-brand-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full scale-x-[-1] object-cover"
        />
        {status !== 'granted' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border border-brand-border bg-brand-card text-brand-gray">
              <VideoOff size={20} strokeWidth={1.75} />
            </span>
            <p className="text-xs font-medium text-brand-gray">
              {status === 'denied' ? 'Camera access is blocked' : 'Your preview appears here'}
            </p>
          </div>
        )}
        {status === 'granted' && (
          <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md border border-mint-border bg-mint-bg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-mint-ink">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint-ink" />
            Preview
          </span>
        )}
      </div>

      {status === 'idle' && (
        <>
          <button
            onClick={request}
            className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border-[1.5px] bg-white text-base font-semibold transition-all duration-150 hover:-translate-y-px hover:shadow-sm active:translate-y-0"
            style={{ borderColor: accent, color: accent }}
          >
            <Camera size={18} strokeWidth={1.75} /> Enable camera &amp; microphone
          </button>
          <p className="mt-2.5 text-center text-xs text-neutral-400">
            Your browser will ask for permission — nothing is recorded during this check.
          </p>
        </>
      )}

      {status === 'denied' && (
        <div className="mt-5 rounded-2xl border border-danger-border bg-danger-bg p-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 flex-shrink-0 text-danger" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-danger">Camera and microphone access was blocked</p>
              <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                Open your browser’s site permissions (the icon in the address bar), allow camera and
                microphone for this page, then try again.
              </p>
            </div>
          </div>
          <button
            onClick={request}
            className="mt-3.5 inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-white px-4 text-xs font-semibold text-danger ring-1 ring-inset ring-danger-border transition-colors duration-150 hover:bg-danger-bg"
          >
            <RefreshCw size={13} strokeWidth={2} /> Try again
          </button>
        </div>
      )}

      {status === 'granted' && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-success-border bg-success-bg px-3 py-1.5 text-xs font-semibold text-success">
            <Check size={13} strokeWidth={3} /> Camera ready
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-success-border bg-success-bg px-3 py-1.5 text-xs font-semibold text-success">
            <Check size={13} strokeWidth={3} /> Mic ready
          </span>
        </div>
      )}

      <button
        onClick={onBegin}
        disabled={status !== 'granted' || busy}
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md text-base font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: accent }}
      >
        {busy
          ? 'Connecting…'
          : <>{isTwoWay ? 'Join the call' : 'Start the interview'} <ArrowRight size={18} /></>}
      </button>
      {status !== 'granted' && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-neutral-400">
          <Mic size={13} strokeWidth={1.75} className="flex-shrink-0" />
          Enable your camera and mic above to continue.
        </p>
      )}
    </motion.div>
  )
}

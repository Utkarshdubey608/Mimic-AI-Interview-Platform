import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Camera, Mic, ShieldCheck, ArrowRight } from 'lucide-react'
import { cn } from '@/components/ui'
import type { BrandingConfig } from '@shared/types'

interface Props {
  branding: BrandingConfig
  onBegin: () => void
  busy?: boolean
}

/** "Before you begin" consent + device checklist, ported from the source's
 *  record.html gate. Enabling "Begin" requires acknowledging AI analysis. */
export function VideoIntro({ branding, onBegin, busy }: Props) {
  const reduce = useReducedMotion()
  const [consent, setConsent] = useState(false)
  const accent = branding.accentColor
  const checks = [
    { icon: Camera, label: 'Camera on', hint: 'Your webcam records each answer. Close other apps using the camera (Zoom, Teams, Meet).' },
    { icon: Mic, label: 'Microphone on', hint: 'Speak clearly, your spoken answer is transcribed and scored.' },
    { icon: ShieldCheck, label: 'Quiet, well-lit space', hint: 'You get 30s to prepare, then up to 2 minutes to answer each question.' },
  ]

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
        Before you begin
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-neutral-500">
        You’ll answer each question on camera. Here’s how it works.
      </p>

      <ul className="mt-7 space-y-3">
        {checks.map((c, i) => {
          const Icon = c.icon
          return (
            <li key={i} className="flex items-start gap-3.5 rounded-2xl border border-border bg-neutral-50 p-4">
              <span
                className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                style={{ background: accent + '14', color: accent }}
              >
                <Icon size={17} strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-800">{c.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">{c.hint}</p>
              </div>
            </li>
          )
        })}
      </ul>

      <label
        className={cn(
          'mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border-[1.5px] p-4 transition-colors duration-150',
          !consent && 'border-border bg-white hover:bg-neutral-50',
        )}
        style={consent ? { borderColor: accent, background: accent + '0A' } : undefined}
      >
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-neutral-300"
          style={{ accentColor: accent }}
        />
        <span className="text-sm font-medium leading-relaxed text-neutral-700">
          I understand my responses are recorded and analysed by AI, and reviewed by a human recruiter.
        </span>
      </label>

      <button
        onClick={onBegin}
        disabled={!consent || busy}
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md text-base font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: accent }}
      >
        {busy ? 'Starting…' : <>I consent, begin <ArrowRight size={18} /></>}
      </button>
      {!consent && (
        <p className="mt-3 text-center text-xs text-neutral-400">
          Confirm the note above to start your interview.
        </p>
      )}
    </motion.div>
  )
}

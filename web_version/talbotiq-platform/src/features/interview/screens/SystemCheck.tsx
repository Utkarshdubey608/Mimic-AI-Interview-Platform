import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Wifi, Volume2, ShieldCheck, Clock, ArrowRight } from 'lucide-react'
import { cn } from '@/components/ui'
import type { BrandingConfig, TrackType } from '@shared/types'
import { VideoSystemCheck } from './VideoSystemCheck'
import { VideoIntro } from './VideoIntro'

interface Props {
  branding: BrandingConfig
  track: TrackType
  onBegin: () => void
  busy?: boolean
}

export function SystemCheck({ branding, track, onBegin, busy }: Props) {
  const reduce = useReducedMotion()
  const [ready, setReady] = useState(false)

  if (track === 'video') {
    return <VideoIntro branding={branding} onBegin={onBegin} busy={busy} />
  }

  if (track === 'video_avatar' || track === 'two_way') {
    return <VideoSystemCheck branding={branding} track={track} onBegin={onBegin} busy={busy} />
  }

  const accent = branding.accentColor
  const checks = [
    { icon: Wifi, label: 'Stable internet connection', hint: 'A dropped connection won’t lose your progress, but a steady one is best.' },
    { icon: Volume2, label: 'Quiet, distraction-free space', hint: 'You won’t be able to pause once a question begins.' },
    { icon: ShieldCheck, label: 'Ready to focus', hint: 'Set aside enough uninterrupted time to finish in one sitting.' },
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
        Quick system check
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-neutral-500">
        Confirm you’re set up before the first question appears.
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
          'mt-6 flex cursor-pointer items-center gap-3 rounded-2xl border-[1.5px] p-4 transition-colors duration-150',
          !ready && 'border-border bg-white hover:bg-neutral-50',
        )}
        style={ready ? { borderColor: accent, background: accent + '0A' } : undefined}
      >
        <input
          type="checkbox"
          checked={ready}
          onChange={(e) => setReady(e.target.checked)}
          className="h-4 w-4 flex-shrink-0 rounded border-neutral-300"
          style={{ accentColor: accent }}
        />
        <span className="text-sm font-medium leading-relaxed text-neutral-700">
          I understand the rules and I’m ready to begin.
        </span>
      </label>

      <button
        onClick={onBegin}
        disabled={!ready || busy}
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md text-base font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: accent }}
      >
        {busy ? 'Starting…' : <>Start the interview <ArrowRight size={18} /></>}
      </button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-neutral-400">
        <Clock size={13} strokeWidth={1.75} className="flex-shrink-0" />
        Your timer starts with the first question.
      </p>
    </motion.div>
  )
}

import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { MessageSquareText, Video, AudioLines, Loader2, Check, ArrowRight } from 'lucide-react'
import { cn } from '@/components/ui'
import type { BrandingConfig, TrackType } from '@shared/types'

interface Props {
  branding: BrandingConfig
  defaultTrack: TrackType
  onChoose: (track: TrackType) => void
  busy?: boolean
}

const TRACKS: { id: TrackType; title: string; blurb: string; icon: typeof Video; tag?: string }[] = [
  { id: 'chat', title: 'Chat Interview', blurb: 'Answer each question by typing. Calm, focused, and fully keyboard-friendly.', icon: MessageSquareText },
  { id: 'voice', title: 'Voice Interview', blurb: 'A spoken conversation with an AI interviewer, just talk, like a phone call.', icon: AudioLines, tag: 'New' },
  { id: 'video_avatar', title: 'Video Avatar', blurb: 'An AI avatar asks each question and you respond on camera.', icon: Video, tag: 'Preview' },
]

export function TrackSelect({ branding, defaultTrack, onChoose, busy }: Props) {
  const reduce = useReducedMotion()
  const [selected, setSelected] = useState<TrackType>(defaultTrack)
  const accent = branding.accentColor

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="text-center">
      {/* Eyebrow deleted. An uppercase label above a heading is the one
          pattern no brief earns back, and on a candidate surface it was pure
          overhead: the heading below already carries the step. */}
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] text-neutral-900">
          Choose your format
        </h1>
        <p className="mx-auto mt-3 max-w-md text-balance leading-relaxed text-neutral-500">
          Every format asks the same questions on the same timer. Pick whichever feels most comfortable.
        </p>
      </div>

      <div className="mt-8 space-y-3" role="group" aria-label="Interview format">
        {TRACKS.map((t) => {
          const Icon = t.icon
          const active = selected === t.id
          return (
            <button
              key={t.id}
              onClick={() => setSelected(t.id)}
              aria-pressed={active}
              className={cn(
                'flex w-full items-start gap-4 rounded-2xl border-[1.5px] bg-white p-5 text-left transition-all duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                active ? 'shadow-md' : 'border-border hover:border-neutral-300 hover:shadow-sm',
              )}
              style={active ? { borderColor: accent, background: accent + '08' } : undefined}
            >
              <span
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl transition-colors duration-150"
                style={active
                  ? { background: accent, color: '#ffffff' }
                  : { background: accent + '14', color: accent }}
              >
                <Icon size={20} strokeWidth={1.75} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-base font-bold tracking-[-0.02em] text-neutral-900">{t.title}</span>
                  {t.tag && (
                    <span
                      className="rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: accent, borderColor: accent + '33', background: accent + '0D' }}
                    >
                      {t.tag}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-neutral-500">{t.blurb}</span>
              </span>

              {/* Selection indicator — accent fill when chosen. */}
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-[1.5px] text-white transition-colors duration-150',
                  !active && 'border-neutral-300',
                )}
                style={active ? { background: accent, borderColor: accent } : undefined}
              >
                {active && <Check size={12} strokeWidth={3} />}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-8 text-center">
        <button
          onClick={() => onChoose(selected)}
          disabled={busy}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-md px-8 text-base font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: accent }}
        >
          {busy
            ? <><Loader2 size={18} className="animate-spin" /> Setting up…</>
            : <>Continue <ArrowRight size={18} /></>}
        </button>
      </div>
    </motion.div>
  )
}

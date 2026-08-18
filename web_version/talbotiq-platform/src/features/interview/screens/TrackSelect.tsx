import { useState } from 'react'
import { MessageSquareText, Video, AudioLines, Check, ArrowRight } from 'lucide-react'
import { cn, Button } from '@/components/ui'
import { PreflightCard, type PreflightStep } from '../stage/Preflight'
import { exhibit } from '@/design/tokens'
import type { BrandingConfig, TrackType } from '@shared/types'

interface Props {
  branding: BrandingConfig
  defaultTrack: TrackType
  steps: PreflightStep[]
  onChoose: (track: TrackType) => void
  busy?: boolean
}

/**
 * Choosing a format.
 *
 * Shown only when the recruiter left the choice open. The copy leads with what
 * is the same across all three — the questions and the timer — because the thing
 * a candidate is actually worried about here is picking the "wrong" one and
 * being marked down for it.
 *
 * The plate on each option carries the format's exhibit colour, the same colour
 * the recruiter sees in their sessions index for this interview. That is the one
 * piece of visual vocabulary shared across both audiences, and using it here
 * costs nothing while making the two halves of the product visibly one system.
 */
const TRACKS: { id: TrackType; title: string; blurb: string; icon: typeof Video }[] = [
  {
    id: 'chat',
    title: 'Written',
    blurb: 'Type your answers. Calm, fully keyboard-driven, and the easiest to edit as you think.',
    icon: MessageSquareText,
  },
  {
    id: 'voice',
    title: 'Voice',
    blurb: 'A spoken conversation with an AI interviewer, like a phone call. Nothing to type.',
    icon: AudioLines,
  },
  {
    id: 'video_avatar',
    title: 'Video',
    blurb: 'An AI avatar asks each question and you answer on camera.',
    icon: Video,
  },
]

export function TrackSelect({ branding, defaultTrack, steps, onChoose, busy }: Props) {
  const [selected, setSelected] = useState<TrackType>(defaultTrack)

  return (
    <PreflightCard
      step="track"
      steps={steps}
      title="Choose how you'd like to interview"
      description="Every format asks the same questions on the same timer, and they are assessed the same way. Pick whichever you are most comfortable with."
      footer={
        <Button size="lg" onClick={() => onChoose(selected)} loading={busy} iconRight={<ArrowRight size={18} />}>
          Continue
        </Button>
      }
    >
      <div className="space-y-2.5" role="radiogroup" aria-label="Interview format">
        {TRACKS.map((t) => {
          const Icon = t.icon
          const active = selected === t.id
          const color = exhibit[t.id as keyof typeof exhibit]?.record
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSelected(t.id)}
              className={cn(
                'flex w-full items-start gap-4 rounded-lg border p-4 text-left',
                'transition-[border-color,background-color,box-shadow] duration-fast',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
                active
                  ? 'border-ink bg-surface-sunk shadow-sm'
                  : 'border-rule bg-surface hover:border-rule-strong',
              )}
            >
              <span
                className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-rule bg-surface"
                style={{ color }}
                aria-hidden="true"
              >
                <Icon size={19} strokeWidth={1.75} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="font-display text-base font-bold tracking-[-0.02em] text-ink">{t.title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-ink-muted">{t.blurb}</span>
              </span>

              {/* Selection is marked by a tick, not only by the tinted ground 
                  so it survives for someone who cannot separate the two. */}
              <span
                className={cn(
                  'mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border',
                  active ? 'border-ink bg-ink text-ink-inverse' : 'border-rule-input bg-surface',
                )}
                aria-hidden="true"
              >
                {active && <Check size={12} strokeWidth={3} />}
              </span>
            </button>
          )
        })}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-muted">
        You cannot change format once the interview begins, so pick the one you would
        rather be judged on. The hiring team sees the same answers either way.
      </p>
    </PreflightCard>
  )
}

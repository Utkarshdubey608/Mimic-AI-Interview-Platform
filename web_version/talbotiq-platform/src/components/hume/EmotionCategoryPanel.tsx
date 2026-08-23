import { Zap, Waves, Brain, Handshake, AlertTriangle, MinusCircle, type LucideIcon } from 'lucide-react'
import { palette, series, type Ground } from '@/design/tokens'
import { useWorkspaceGround } from '@/lib/workspaceGround'
import type { EmotionCategory } from '@/types/hume.types'

/* Six hues for six categories. This is a data encoding, not decoration, so
   colour is permitted — but the values come from the categorical `series` ramp
   rather than from literals, which is what lets the same six read correctly on
   paper and in a room. The index each category takes is repeated verbatim in
   EmotionHeatmap / EmotionTimeline / LiveEmotionBar so one category is one
   colour everywhere on the report.

   `disengagement` deliberately has no hue: "absent" is the one category that
   should recede, so it takes the muted ink of the current ground. */
const CATEGORY_SERIES: Record<EmotionCategory, number | null> = {
  positive_high: 2,
  positive_calm: 4,
  cognitive:     3,
  social:        5,
  negative:      1,
  disengagement: null,
}

function categoryColor(cat: EmotionCategory, ground: Ground): string {
  const i = CATEGORY_SERIES[cat]
  return i === null ? palette(ground).inkMuted : series[ground][i]
}

const METADATA: Record<EmotionCategory, { label: string; Icon: LucideIcon; description: string }> = {
  positive_high: { label: 'Energy & Enthusiasm',  Icon: Zap,           description: 'Excitement, pride, admiration' },
  positive_calm: { label: 'Calm & Contentment',   Icon: Waves,         description: 'Serenity, satisfaction, awe' },
  cognitive:     { label: 'Cognitive Engagement', Icon: Brain,         description: 'Concentration, curiosity, focus' },
  social:        { label: 'Social Presence',      Icon: Handshake,     description: 'Empathy, warmth, connection' },
  negative:      { label: 'Stress & Anxiety',     Icon: AlertTriangle, description: 'Anxiety, confusion, distress' },
  disengagement: { label: 'Disengagement',        Icon: MinusCircle,   description: 'Boredom, doubt, awkwardness' },
}

interface Props {
  categoryScores: Record<EmotionCategory, number>
}

export function EmotionCategoryPanel({ categoryScores }: Props) {
  const ground = useWorkspaceGround()
  const sorted = (Object.keys(categoryScores) as EmotionCategory[])
    .sort((a, b) => categoryScores[b] - categoryScores[a])

  return (
    <div className="grid grid-cols-2 gap-3">
      {sorted.map(cat => {
        const meta = METADATA[cat]
        const color = categoryColor(cat, ground)
        const pct = Math.round(categoryScores[cat] * 100)
        return (
          <div
            key={cat}
            className="rounded-xl bg-surface-sunk border border-rule p-3.5 flex flex-col gap-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex items-start gap-2 text-sm font-medium text-ink-body leading-snug">
                <meta.Icon size={15} strokeWidth={1.75} className="mt-0.5 flex-shrink-0" style={{ color }} aria-hidden="true" />
                {meta.label}
              </span>
              <span className="text-sm font-bold tabular-nums flex-shrink-0" style={{ color }}>
                {pct}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
            <p className="text-2xs text-ink-muted leading-relaxed">{meta.description}</p>
          </div>
        )
      })}
    </div>
  )
}

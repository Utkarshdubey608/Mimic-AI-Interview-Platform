import { Zap, Waves, Brain, Handshake, AlertTriangle, MinusCircle, type LucideIcon } from 'lucide-react'
import type { EmotionCategory } from '@/types/hume.types'

const METADATA: Record<EmotionCategory, { label: string; color: string; Icon: LucideIcon; description: string }> = {
  positive_high: { label: 'Energy & Enthusiasm',  color: '#1D3FA0', Icon: Zap,           description: 'Excitement, pride, admiration' },
  positive_calm: { label: 'Calm & Contentment',   color: '#3D5CB4', Icon: Waves,         description: 'Serenity, satisfaction, awe' },
  cognitive:     { label: 'Cognitive Engagement', color: '#BE185D', Icon: Brain,         description: 'Concentration, curiosity, focus' },
  social:        { label: 'Social Presence',      color: '#15803D', Icon: Handshake,     description: 'Empathy, warmth, connection' },
  negative:      { label: 'Stress & Anxiety',     color: '#B45309', Icon: AlertTriangle, description: 'Anxiety, confusion, distress' },
  disengagement: { label: 'Disengagement',        color: '#5C6879', Icon: MinusCircle,   description: 'Boredom, doubt, awkwardness' },
}

interface Props {
  categoryScores: Record<EmotionCategory, number>
}

export function EmotionCategoryPanel({ categoryScores }: Props) {
  const sorted = (Object.keys(categoryScores) as EmotionCategory[])
    .sort((a, b) => categoryScores[b] - categoryScores[a])

  return (
    <div className="grid grid-cols-2 gap-3">
      {sorted.map(cat => {
        const meta = METADATA[cat]
        const pct = Math.round(categoryScores[cat] * 100)
        return (
          <div
            key={cat}
            className="rounded-xl bg-hume-card border border-hume-border p-3.5 flex flex-col gap-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex items-start gap-2 text-sm font-medium text-neutral-700 leading-snug">
                <meta.Icon size={15} strokeWidth={1.75} className="mt-0.5 flex-shrink-0" style={{ color: meta.color }} aria-hidden="true" />
                {meta.label}
              </span>
              <span className="text-sm font-bold tabular-nums flex-shrink-0" style={{ color: meta.color }}>
                {pct}%
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-neutral-200 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, background: meta.color }}
              />
            </div>
            <p className="text-2xs text-neutral-500 leading-relaxed">{meta.description}</p>
          </div>
        )
      })}
    </div>
  )
}

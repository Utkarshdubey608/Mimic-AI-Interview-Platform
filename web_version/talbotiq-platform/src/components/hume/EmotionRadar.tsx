import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip,
} from 'recharts'
import type { EmotionCategory } from '@/types/hume.types'

const LABELS: Record<EmotionCategory, string> = {
  positive_high: 'Energy',
  positive_calm: 'Calm',
  cognitive: 'Focus',
  social: 'Social',
  negative: 'Stress',
  disengagement: 'Disengaged',
}

// Shared chart chrome — one grid colour, one tick colour, one tooltip shell
// across every emotion visualisation.
const GRID = '#E7E7EA'
const TICK = { fill: '#5B6067', fontSize: 11, fontFamily: 'Archivo, system-ui, sans-serif' }
const TOOLTIP_STYLE = {
  background: '#ffffff',
  border: '1px solid #E7E7EA',
  borderRadius: 10,
  color: '#0E1420',
  fontSize: 12,
  fontFamily: 'Archivo, system-ui, sans-serif',
  boxShadow: '0 8px 24px -4px rgb(14 20 32 / 0.10), 0 4px 10px -4px rgb(14 20 32 / 0.06)',
} as const

interface Props {
  categoryScores: Record<EmotionCategory, number>
  color?: string
}

export function EmotionRadar({ categoryScores, color = '#0B7A45' }: Props) {
  const data = (Object.keys(LABELS) as EmotionCategory[]).map(k => ({
    subject: LABELS[k],
    score: Math.round(categoryScores[k] * 100),
    fullMark: 100,
  }))

  return (
    <div className="w-full h-56">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data}>
          <PolarGrid stroke={GRID} />
          <PolarAngleAxis dataKey="subject" tick={TICK} />
          <Radar
            dataKey="score"
            stroke={color}
            fill={color}
            fillOpacity={0.16}
            strokeWidth={2}
          />
          <Tooltip
            cursor={{ stroke: GRID }}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: '#0E1420', fontWeight: 600 }}
            formatter={(v: number) => [`${v}%`, 'Score']}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

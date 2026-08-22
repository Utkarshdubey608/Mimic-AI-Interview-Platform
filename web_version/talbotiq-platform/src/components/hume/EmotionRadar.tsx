import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip,
} from 'recharts'
import { palette } from '@/design/tokens'
import { useWorkspaceGround } from '@/lib/workspaceGround'
import type { EmotionCategory } from '@/types/hume.types'

const LABELS: Record<EmotionCategory, string> = {
  positive_high: 'Energy',
  positive_calm: 'Calm',
  cognitive: 'Focus',
  social: 'Social',
  negative: 'Stress',
  disengagement: 'Disengaged',
}

interface Props {
  categoryScores: Record<EmotionCategory, number>
  color?: string
}

export function EmotionRadar({ categoryScores, color }: Props) {
  // Recharts takes literals, so the chrome is resolved from the typed token
  // mirror rather than read from CSS — one grid colour, one tick colour, one
  // tooltip shell, correct on either ground.
  const ground = useWorkspaceGround()
  const pal = palette(ground)
  const stroke = color ?? pal.ink

  const data = (Object.keys(LABELS) as EmotionCategory[]).map(k => ({
    subject: LABELS[k],
    score: Math.round(categoryScores[k] * 100),
    fullMark: 100,
  }))

  return (
    <div className="w-full h-56">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data}>
          <PolarGrid stroke={pal.rule} />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: pal.inkMuted, fontSize: 11, fontFamily: 'Archivo, system-ui, sans-serif' }}
          />
          <Radar
            dataKey="score"
            stroke={stroke}
            fill={stroke}
            fillOpacity={0.16}
            strokeWidth={2}
          />
          <Tooltip
            cursor={{ stroke: pal.rule }}
            contentStyle={{
              background: pal.surface,
              border: `1px solid ${pal.rule}`,
              borderRadius: 10,
              color: pal.ink,
              fontSize: 12,
              fontFamily: 'Archivo, system-ui, sans-serif',
              boxShadow: ground === 'room'
                ? '0 12px 28px -8px rgb(0 0 0 / 0.6)'
                : '0 8px 24px -4px rgb(14 20 32 / 0.10), 0 4px 10px -4px rgb(14 20 32 / 0.06)',
            }}
            labelStyle={{ color: pal.ink, fontWeight: 600 }}
            formatter={(v: number) => [`${v}%`, 'Score']}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

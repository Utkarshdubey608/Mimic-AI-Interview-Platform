import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { Activity } from 'lucide-react'
import { palette, series, type Ground } from '@/design/tokens'
import { useWorkspaceGround } from '@/lib/workspaceGround'
import type { EmotionSnapshot, EmotionCategory } from '@/types/hume.types'

/* Four of the six categories, plotted. The series indices match
   EmotionCategoryPanel and EmotionHeatmap so a line and its heat column are the
   same colour, and both follow the ground. */
const SERIES: { key: EmotionCategory; idx: number; label: string }[] = [
  { key: 'positive_high', idx: 2, label: 'Energy' },
  { key: 'positive_calm', idx: 4, label: 'Calm' },
  { key: 'cognitive',     idx: 3, label: 'Focus' },
  { key: 'negative',      idx: 1, label: 'Stress' },
]

/** Chart chrome for a ground. Recharts needs literals; these are the tokens. */
function chrome(ground: Ground) {
  const pal = palette(ground)
  return {
    pal,
    tooltip: {
      background: pal.surface,
      border: `1px solid ${pal.rule}`,
      borderRadius: 10,
      color: pal.ink,
      fontSize: 12,
      fontFamily: 'Archivo, system-ui, sans-serif',
      boxShadow: ground === 'room'
        ? '0 12px 28px -8px rgb(0 0 0 / 0.6)'
        : '0 8px 24px -4px rgb(14 20 32 / 0.10), 0 4px 10px -4px rgb(14 20 32 / 0.06)',
    },
  }
}

interface Props {
  timeline: EmotionSnapshot[]
  questionTimestamps?: number[]
}

export function EmotionTimeline({ timeline }: Props) {
  const ground = useWorkspaceGround()
  const { pal, tooltip } = chrome(ground)

  if (timeline.length === 0) {
    return (
      <div className="h-80 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-rule bg-surface-sunk">
        <span className="w-11 h-11 rounded-full bg-surface border border-rule text-ink-faint flex items-center justify-center">
          <Activity size={20} strokeWidth={1.75} />
        </span>
        <div className="text-center">
          <p className="text-sm font-semibold text-ink-body">No emotion timeline yet</p>
          <p className="text-xs text-ink-muted mt-1">Prosody predictions appear here once the audio analysis completes.</p>
        </div>
      </div>
    )
  }

  const origin = timeline[0]?.timestamp ?? 0
  const data = timeline.map(s => ({
    t: Math.round(s.timestamp - origin),
    ...Object.fromEntries(
      SERIES.map(sr => [sr.key, Math.round(s.categoryScores[sr.key] * 100)])
    ),
  }))

  // Dynamic Y ceiling so lines are spread across the full chart height
  const maxVal = Math.max(
    ...data.flatMap(d => SERIES.map(sr => (d as Record<string, number>)[sr.key] ?? 0)),
    10,
  )
  const yMax = Math.ceil((maxVal * 1.4) / 5) * 5

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 20, left: -4, bottom: 4 }}>
          <CartesianGrid stroke={pal.rule} strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="t"
            tick={{ fill: pal.inkMuted, fontSize: 11 }}
            tickFormatter={v => `${v}s`}
            axisLine={{ stroke: pal.rule }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: pal.inkMuted, fontSize: 11 }}
            domain={[0, yMax]}
            tickFormatter={v => `${v}%`}
            axisLine={false}
            tickLine={false}
            tickCount={6}
          />
          <Tooltip
            cursor={{ stroke: pal.rule }}
            contentStyle={tooltip}
            labelStyle={{ color: pal.ink, fontWeight: 600 }}
            formatter={(v: number, name: string) => {
              const s = SERIES.find(s => s.key === name)
              return [`${v}%`, s?.label ?? name]
            }}
            labelFormatter={v => `t = ${v}s`}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ paddingTop: 10, fontSize: 12 }}
            formatter={(value) => {
              const s = SERIES.find(s => s.key === value)
              return <span style={{ color: pal.inkBody, fontWeight: 500 }}>{s?.label ?? value}</span>
            }}
          />
          {SERIES.map(sr => {
            const stroke = series[ground][sr.idx]
            return (
              <Line
                key={sr.key}
                type="monotone"
                dataKey={sr.key}
                stroke={stroke}
                strokeWidth={2.25}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: stroke }}
              />
            )
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

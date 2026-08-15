import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { Activity } from 'lucide-react'
import type { EmotionSnapshot, EmotionCategory } from '@/types/hume.types'

// Brand series palette — violet leads, then indigo / magenta / amber. Distinct
// at a glance without leaving the Mimic spectrum.
const SERIES: { key: EmotionCategory; color: string; label: string }[] = [
  { key: 'positive_high', color: '#1D3FA0', label: 'Energy' },
  { key: 'positive_calm', color: '#3D5CB4', label: 'Calm' },
  { key: 'cognitive',     color: '#BE185D', label: 'Focus' },
  { key: 'negative',      color: '#B45309', label: 'Stress' },
]

const GRID = '#E3E6ED'

interface Props {
  timeline: EmotionSnapshot[]
  questionTimestamps?: number[]
}

export function EmotionTimeline({ timeline }: Props) {
  if (timeline.length === 0) {
    return (
      <div className="h-80 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-neutral-50">
        <span className="w-11 h-11 rounded-full bg-white border border-border text-neutral-400 flex items-center justify-center">
          <Activity size={20} strokeWidth={1.75} />
        </span>
        <div className="text-center">
          <p className="text-sm font-semibold text-neutral-700">No emotion timeline yet</p>
          <p className="text-xs text-neutral-500 mt-1">Prosody predictions appear here once the audio analysis completes.</p>
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
          <CartesianGrid stroke={GRID} strokeDasharray="4 4" vertical={false} />
          <XAxis
            dataKey="t"
            tick={{ fill: '#5C6879', fontSize: 11 }}
            tickFormatter={v => `${v}s`}
            axisLine={{ stroke: GRID }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#5C6879', fontSize: 11 }}
            domain={[0, yMax]}
            tickFormatter={v => `${v}%`}
            axisLine={false}
            tickLine={false}
            tickCount={6}
          />
          <Tooltip
            cursor={{ stroke: GRID }}
            contentStyle={{
              background: '#ffffff',
              border: '1px solid #E3E6ED',
              borderRadius: 10,
              color: '#0E1420',
              fontSize: 12,
              fontFamily: 'Figtree, system-ui, sans-serif',
              boxShadow: '0 8px 24px -4px rgb(27 11 59 / 0.10), 0 4px 10px -4px rgb(27 11 59 / 0.06)',
            }}
            labelStyle={{ color: '#0E1420', fontWeight: 600 }}
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
              return <span style={{ color: '#4A5566', fontWeight: 500 }}>{s?.label ?? value}</span>
            }}
          />
          {SERIES.map(sr => (
            <Line
              key={sr.key}
              type="monotone"
              dataKey={sr.key}
              stroke={sr.color}
              strokeWidth={2.25}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: sr.color }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

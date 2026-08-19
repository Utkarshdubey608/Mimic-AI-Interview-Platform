import { useAppStore } from '@/store/useAppStore'
import { buildCategoryScores } from '@/services/hume'

const CATEGORY_LABELS: Record<string, string> = {
  positive_high: 'Energy',
  positive_calm: 'Calm',
  cognitive: 'Focus',
  social: 'Social',
  negative: 'Stress',
  disengagement: 'Disengaged',
}

const CATEGORY_COLORS: Record<string, string> = {
  positive_high: '#0F766E',
  positive_calm: '#4338CA',
  cognitive: '#BE185D',
  social: '#15803D',
  negative: '#B45309',
  disengagement: '#5B6067',
}

export function LiveEmotionBar() {
  const { liveEmotions, humeStreamActive, metrics } = useAppStore()

  if (!humeStreamActive || liveEmotions.length === 0) {
    // Jitter fallback
    const bars = [
      { label: 'Confidence', value: metrics.confidence, color: '#0F766E' },
      { label: 'Stress', value: metrics.anxiety, color: '#B45309' },
      { label: 'Engagement', value: metrics.engagement, color: '#4338CA' },
    ]
    return (
      <div className="space-y-2">
        {bars.map(b => (
          <div key={b.label}>
            <div className="flex justify-between text-2xs text-hume-muted mb-1">
              <span>{b.label}</span>
              <span className="font-mono">{b.value}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-hume-border overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${b.value}%`, background: b.color }}
              />
            </div>
          </div>
        ))}
      </div>
    )
  }

  const cats = buildCategoryScores(liveEmotions)
  const entries = Object.entries(cats) as [string, number][]

  return (
    <div className="space-y-2 animate-slide-in-right">
      {entries.map(([cat, score]) => (
        <div key={cat}>
          <div className="flex justify-between text-2xs text-hume-muted mb-1">
            <span>{CATEGORY_LABELS[cat] ?? cat}</span>
            <span className="font-mono">{Math.round(score * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-hume-border overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.round(score * 100)}%`,
                background: CATEGORY_COLORS[cat] ?? '#4338CA',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

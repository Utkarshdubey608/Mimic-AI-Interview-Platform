import { palette, series, type Ground } from '@/design/tokens'
import { useWorkspaceGround } from '@/lib/workspaceGround'
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

/* Series indices match EmotionCategoryPanel / EmotionHeatmap / EmotionTimeline
   so a live bar and the same category on the report are one colour.
   `disengagement` recedes to muted ink rather than taking a hue. */
const CATEGORY_SERIES: Record<string, number | null> = {
  positive_high: 2,
  positive_calm: 4,
  cognitive:     3,
  social:        5,
  negative:      1,
  disengagement: null,
}

function categoryColor(cat: string, ground: Ground): string {
  // `?? null` covers both the deliberate no-hue category (disengagement) and an
  // unrecognised key — neither has an assigned hue, so both recede to muted ink.
  const i = CATEGORY_SERIES[cat] ?? null
  return i === null ? palette(ground).inkMuted : series[ground][i]
}

export function LiveEmotionBar() {
  const ground = useWorkspaceGround()
  const { liveEmotions, humeStreamActive, metrics } = useAppStore()

  if (!humeStreamActive || liveEmotions.length === 0) {
    // Jitter fallback
    const bars = [
      { label: 'Confidence', value: metrics.confidence, color: categoryColor('positive_high', ground) },
      { label: 'Stress', value: metrics.anxiety, color: categoryColor('negative', ground) },
      { label: 'Engagement', value: metrics.engagement, color: categoryColor('positive_calm', ground) },
    ]
    return (
      <div className="space-y-2">
        {bars.map(b => (
          <div key={b.label}>
            <div className="flex justify-between text-2xs text-ink-muted mb-1">
              <span>{b.label}</span>
              <span className="font-mono">{b.value}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
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
          <div className="flex justify-between text-2xs text-ink-muted mb-1">
            <span>{CATEGORY_LABELS[cat] ?? cat}</span>
            <span className="font-mono">{Math.round(score * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-hover overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.round(score * 100)}%`,
                background: categoryColor(cat, ground),
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

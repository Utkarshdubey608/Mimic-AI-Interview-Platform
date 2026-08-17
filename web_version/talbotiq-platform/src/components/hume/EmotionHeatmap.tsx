import type { QuestionEmotionSummary, EmotionCategory } from '@/types/hume.types'

const CATS: EmotionCategory[] = [
  'positive_high', 'positive_calm', 'cognitive', 'social', 'negative', 'disengagement',
]
const CAT_LABELS: Record<EmotionCategory, string> = {
  positive_high: 'Energy',
  positive_calm: 'Calm',
  cognitive:     'Focus',
  social:        'Social',
  negative:      'Stress',
  disengagement: 'Disengaged',
}

// One exhibit-ramp hue per column, tinted by intensity — the ramp always
// keeps ink-dark text legible on top.
const CAT_RGB: Record<EmotionCategory, [number, number, number]> = {
  positive_high: [15, 118, 110],   // #0F766E teal
  positive_calm: [67, 56, 202],    // #4338CA indigo
  cognitive:     [190, 24, 93],    // #BE185D magenta
  social:        [21, 128, 61],    // #15803D success
  negative:      [180, 83, 9],     // #B45309 warning
  disengagement: [91, 96, 103],    // #5B6067 neutral
}

function heatColor(score: number, cat: EmotionCategory): string {
  const t = Math.max(0, Math.min(1, score))
  const [r, g, b] = CAT_RGB[cat]
  return `rgba(${r},${g},${b},${(0.06 + t * 0.52).toFixed(3)})`
}

interface Props {
  perQuestion: QuestionEmotionSummary[]
}

export function EmotionHeatmap({ perQuestion }: Props) {
  if (perQuestion.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center rounded-xl border border-dashed border-border bg-neutral-50 text-sm text-neutral-500">
        No per-question emotion data for this session.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-neutral-50">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500 py-2.5 pl-4 pr-3 w-24">
              Question
            </th>
            {CATS.map(c => (
              <th key={c} className="text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-500 py-2.5 px-1.5">
                {CAT_LABELS[c]}
              </th>
            ))}
            <th className="w-2" />
          </tr>
        </thead>
        <tbody>
          {perQuestion.map((q, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="h-11 pl-4 pr-3 font-semibold text-neutral-700">Q{i + 1}</td>
              {CATS.map(cat => {
                const score = q.avgCategoryScores[cat]
                return (
                  <td key={cat} className="h-11 px-1.5 py-1">
                    <span
                      className="flex h-8 items-center justify-center rounded-lg font-semibold tabular-nums text-neutral-900"
                      style={{ background: heatColor(score, cat) }}
                    >
                      {Math.round(score * 100)}
                    </span>
                  </td>
                )
              })}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

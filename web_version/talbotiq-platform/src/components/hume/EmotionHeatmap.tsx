import { palette, series, type Ground } from '@/design/tokens'
import { useWorkspaceGround } from '@/lib/workspaceGround'
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

/* One categorical hue per column, tinted by intensity. Indices match
   EmotionCategoryPanel so a category is the same colour in every visualisation;
   `disengagement` recedes to muted ink rather than taking a hue. */
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

/** #RRGGBB → `rgba(r,g,b,a)`. The ramp is hex; a heat cell needs an alpha. */
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha.toFixed(3)})`
}

/**
 * Cell intensity, per ground.
 *
 * The cell carries a number in --ink, so the tint has to stay on the far side of
 * that ink at full strength. On paper the hues are dark and the ground is white,
 * so a strong tint still leaves ink legible. In a room the ramp inverts — the
 * hues are the LIGHT thing — so the same alpha would wash the cell up to meet
 * near-white text. The room ramp is therefore shallower: 0.10→0.44 instead of
 * 0.06→0.58, which holds every column above 6:1 against --ink.
 */
function heatColor(score: number, cat: EmotionCategory, ground: Ground): string {
  const t = Math.max(0, Math.min(1, score))
  const alpha = ground === 'room' ? 0.10 + t * 0.34 : 0.06 + t * 0.52
  return tint(categoryColor(cat, ground), alpha)
}

interface Props {
  perQuestion: QuestionEmotionSummary[]
}

export function EmotionHeatmap({ perQuestion }: Props) {
  const ground = useWorkspaceGround()

  if (perQuestion.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center rounded-xl border border-dashed border-rule bg-surface-sunk text-sm text-ink-muted">
        No per-question emotion data for this session.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-rule bg-surface-sunk">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-rule">
            <th className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted py-2.5 pl-4 pr-3 w-24">
              Question
            </th>
            {CATS.map(c => (
              <th key={c} className="text-center text-[11px] font-semibold uppercase tracking-wide text-ink-muted py-2.5 px-1.5">
                {CAT_LABELS[c]}
              </th>
            ))}
            <th className="w-2" />
          </tr>
        </thead>
        <tbody>
          {perQuestion.map((q, i) => (
            <tr key={i} className="border-b border-rule last:border-0">
              <td className="h-11 pl-4 pr-3 font-semibold text-ink-body">Q{i + 1}</td>
              {CATS.map(cat => {
                const score = q.avgCategoryScores[cat]
                return (
                  <td key={cat} className="h-11 px-1.5 py-1">
                    <span
                      className="flex h-8 items-center justify-center rounded-lg font-semibold tabular-nums text-ink"
                      style={{ background: heatColor(score, cat, ground) }}
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

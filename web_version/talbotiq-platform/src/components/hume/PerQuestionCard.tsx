import { series, type Ground } from '@/design/tokens'
import { useWorkspaceGround } from '@/lib/workspaceGround'
import type { QuestionEmotionSummary } from '@/types/hume.types'
import { EmotionRadar } from './EmotionRadar'

/* Dominant-emotion accent. Three signals — energised, calm, stressed — taken
   from the categorical `series` ramp at the same indices the emotion charts
   use, so a card's accent matches its own radar on either ground. Anything
   unmapped falls back to the "energised" seat. */
const ENERGISED = 2
const CALM = 4
const STRESSED = 1

const DOMINANT_SERIES: Record<string, number> = {
  Energy: ENERGISED, Excitement: ENERGISED, Enthusiasm: ENERGISED,
  Calm: CALM, Serenity: CALM, Contentment: CALM,
  Anxiety: STRESSED, Stress: STRESSED, Confusion: STRESSED,
}

function dominantColor(dominant: string, ground: Ground): string {
  return series[ground][DOMINANT_SERIES[dominant] ?? ENERGISED]
}

interface Props {
  summary: QuestionEmotionSummary
  index: number
}

export function PerQuestionCard({ summary, index }: Props) {
  const ground = useWorkspaceGround()
  const accent = dominantColor(summary.dominant, ground)

  return (
    <div className="rounded-2xl bg-surface-sunk border border-rule p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-1.5">
            Question {index + 1}
          </p>
          <p className="text-sm text-ink leading-relaxed line-clamp-2">
            {summary.questionText}
          </p>
        </div>
        <span
          className="shrink-0 px-2.5 py-1 rounded-full text-2xs font-bold uppercase tracking-wide border"
          style={{ background: `${accent}14`, color: accent, borderColor: `${accent}33` }}
        >
          {summary.dominant}
        </span>
      </div>

      <EmotionRadar categoryScores={summary.avgCategoryScores} color={accent} />

      <div className="flex flex-wrap gap-1.5">
        {summary.topEmotions.slice(0, 4).map(e => (
          <span
            key={e.name}
            className="px-2.5 py-0.5 rounded-full text-2xs font-medium bg-surface border border-rule text-ink-body"
          >
            {e.name} <span className="tabular-nums text-ink-muted">{Math.round(e.score * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

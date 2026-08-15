import type { QuestionEmotionSummary } from '@/types/hume.types'
import { EmotionRadar } from './EmotionRadar'

// Dominant-emotion accent, kept inside the brand spectrum: violet for energised,
// indigo for calm, amber for stress. Anything unmapped falls back to violet.
const DOMINANT_COLOR: Record<string, string> = {
  Energy: '#1D3FA0', Excitement: '#1D3FA0', Enthusiasm: '#1D3FA0',
  Calm: '#3D5CB4', Serenity: '#3D5CB4', Contentment: '#3D5CB4',
  Anxiety: '#B45309', Stress: '#B45309', Confusion: '#B45309',
}

interface Props {
  summary: QuestionEmotionSummary
  index: number
}

export function PerQuestionCard({ summary, index }: Props) {
  const dominantColor = DOMINANT_COLOR[summary.dominant] ?? '#1D3FA0'

  return (
    <div className="rounded-2xl bg-hume-card border border-hume-border p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500 mb-1.5">
            Question {index + 1}
          </p>
          <p className="text-sm text-neutral-800 leading-relaxed line-clamp-2">
            {summary.questionText}
          </p>
        </div>
        <span
          className="shrink-0 px-2.5 py-1 rounded-full text-2xs font-bold uppercase tracking-wide border"
          style={{ background: `${dominantColor}14`, color: dominantColor, borderColor: `${dominantColor}33` }}
        >
          {summary.dominant}
        </span>
      </div>

      <EmotionRadar categoryScores={summary.avgCategoryScores} color={dominantColor} />

      <div className="flex flex-wrap gap-1.5">
        {summary.topEmotions.slice(0, 4).map(e => (
          <span
            key={e.name}
            className="px-2.5 py-0.5 rounded-full text-2xs font-medium bg-white border border-border text-neutral-700"
          >
            {e.name} <span className="tabular-nums text-neutral-500">{Math.round(e.score * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  )
}

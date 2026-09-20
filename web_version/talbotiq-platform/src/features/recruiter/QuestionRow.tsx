import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Tag, Target, Trash2 } from 'lucide-react'
import { cn } from '@/components/ui'
import type { FixedQuestion } from '@shared/types'

/**
 * One editable question, draggable.
 *
 * Shared by the creation wizard and the question-set editor on purpose: a
 * recruiter writes the first draft of a question in the wizard and edits it a
 * week later on the editor page, and those must be the same three fields in the
 * same places. It used to be a private component inside QuestionSetsPage, which
 * is how the two would have drifted.
 *
 * `badge` is the only thing the wizard adds — a chip saying where the question
 * came from (a paste, a spreadsheet, a photo, the model), which the editor page
 * has no use for because by then every question is simply the recruiter's.
 */
export function SortableQuestion({
  q, index, onChange, onRemove, badge,
}: {
  q: FixedQuestion
  index: number
  onChange: (p: Partial<FixedQuestion>) => void
  onRemove: () => void
  badge?: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 10 : undefined }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex gap-3 rounded-xl border bg-surface p-3.5 shadow-xs transition-[border-color,box-shadow] duration-150',
        isDragging
          ? 'border-rule-strong shadow-lg'
          : 'border-border focus-within:border-rule hover:border-rule-strong hover:shadow-sm',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-1 cursor-grab touch-none self-start rounded-lg p-1 text-ink-disabled transition-colors duration-150 group-hover:text-ink-muted hover:bg-surface-hover active:cursor-grabbing"
        aria-label={`Drag to reorder question ${index + 1}`}
      >
        <GripVertical size={16} />
      </button>
      <span className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-bold tabular-nums text-ink">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {/* No height override — .textarea-base's 96px min-height fits the three
            lines a real résumé-generated question runs to. The old 64px cap
            clipped them mid-sentence. */}
        <textarea
          value={q.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Type the question the interviewer will ask…"
          aria-label={`Question ${index + 1} text`}
          className="textarea-base text-sm"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="relative">
            <Tag size={13} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={q.category ?? ''}
              onChange={(e) => onChange({ category: e.target.value })}
              placeholder="Category — groups questions in reports"
              aria-label={`Question ${index + 1} category`}
              className="input-base h-9 pl-8 text-xs"
            />
          </div>
          <div className="relative">
            <Target size={13} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={q.idealAnswerNotes ?? ''}
              onChange={(e) => onChange({ idealAnswerNotes: e.target.value })}
              placeholder="Ideal answer — guides AI scoring"
              aria-label={`Question ${index + 1} ideal answer notes`}
              className="input-base h-9 pl-8 text-xs"
            />
          </div>
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
        <button
          onClick={onRemove}
          className="self-end rounded-lg p-1.5 text-ink-faint transition-colors duration-150 hover:bg-danger-bg hover:text-danger"
          aria-label={`Remove question ${index + 1}`}
        >
          <Trash2 size={15} />
        </button>
        {badge}
      </div>
    </div>
  )
}

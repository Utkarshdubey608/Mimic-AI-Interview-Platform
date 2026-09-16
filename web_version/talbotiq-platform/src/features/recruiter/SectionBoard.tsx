import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronUp, ChevronDown, GripVertical, Copy, Trash2 } from 'lucide-react'
import { Button, Progress, Badge, cn } from '@/components/ui'
import type { McqQuestion, McqSection } from '@shared/types'
import { sectionTypeLabel } from './mcqSectionTypes'
import { PROTECTED_SECTION_IDS } from './mcqSections'

/**
 * The template's structure, at a glance — one card per section, in the
 * saved order. This is a KANBAN in the sense the product asked for
 * (draggable, reorderable cards that summarise what is inside), not a
 * multi-column swimlane board: a section has an ORDER, not a status, so a
 * single reorderable stack (the same `@dnd-kit/sortable` idiom
 * `SectionsPanel.tsx` already uses) is the right-sized shape.
 *
 * Deliberately thin. A card shows enough to navigate — type, progress, a
 * short preview — and nothing a recruiter would need to actually EDIT lives
 * here; that is what "Open section" and the drawer are for (see
 * `SectionEditorDrawer`). Cramming full question editing into the card is
 * exactly what the product spec warned against.
 */

function SectionCard({
  section, questions, index, total, onOpen, onMoveUp, onMoveDown, onRemove, onDuplicate,
}: {
  section: McqSection
  questions: McqQuestion[]
  index: number
  total: number
  onOpen: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
  onDuplicate: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id })
  const target = section.targetQuestionCount ?? 0
  const added = questions.length
  const remaining = Math.max(0, target - added)
  const isProtected = PROTECTED_SECTION_IDS.has(section.id)
  const name = section.name || 'Untitled section'

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'rounded-xl border bg-surface p-3.5',
        isDragging ? 'border-rule-strong shadow-md' : 'border-border',
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Drag handle AND a keyboard-reachable move-up/down pair below — drag
            must never be the only way to reorder (accessibility requirement). */}
        <button
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${name}`}
          className="mt-0.5 cursor-grab touch-none rounded p-1 text-ink-disabled hover:text-ink-muted active:cursor-grabbing"
        >
          <GripVertical size={15} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{sectionTypeLabel(section.sectionType, name)}</Badge>
            <span className="truncate text-sm font-semibold text-ink">{name}</span>
          </div>

          <div className="mt-2.5">
            {target > 0 ? (
              <Progress
                value={added}
                max={target}
                label={`${added} / ${target} question${target === 1 ? '' : 's'}${
                  remaining > 0 ? ` — ${remaining} remaining` : ''
                }`}
              />
            ) : (
              <p className="text-xs text-ink-muted">
                {added} question{added === 1 ? '' : 's'} — no target set
              </p>
            )}
          </div>

          {added > 0 && (
            <ul className="mt-2.5 space-y-1 text-xs text-ink-muted">
              {questions.slice(0, 3).map((q, i) => (
                <li key={q.id} className="truncate">
                  {i + 1}. {q.text.trim() || <span className="text-ink-faint">Nothing typed yet</span>}
                </li>
              ))}
              {added > 3 && <li className="text-ink-faint">+ {added - 3} more</li>}
            </ul>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={index === 0}
              aria-label={`Move ${name} up`}
              title="Move up"
              className="rounded p-1 text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronUp size={15} />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={index === total - 1}
              aria-label={`Move ${name} down`}
              title="Move down"
              className="rounded p-1 text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronDown size={15} />
            </button>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onDuplicate}
              aria-label={`Duplicate ${name}`}
              title="Duplicate section"
              className="rounded p-1.5 text-ink-faint transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <Copy size={14} />
            </button>
            {!isProtected && (
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${name}, freeing ${added} question${added === 1 ? '' : 's'}`}
                title={added > 0 ? `${added} question${added === 1 ? '' : 's'} will lose their section` : 'Remove section'}
                className="rounded p-1.5 text-ink-faint transition-colors hover:bg-danger-bg hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-border pt-2.5">
        <Button size="sm" variant="outline" onClick={onOpen} block>
          Open section
        </Button>
      </div>
    </div>
  )
}

export function SectionBoard({
  sections, questionsBySection, onReorder, onOpen, onRemove, onDuplicate,
}: {
  sections: McqSection[]
  /** sectionId → its questions, in paper order. */
  questionsBySection: Record<string, McqQuestion[]>
  onReorder: (sections: McqSection[]) => void
  onOpen: (sectionId: string) => void
  onRemove: (sectionId: string) => void
  onDuplicate: (sectionId: string) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const move = (from: number, to: number) => {
    if (to < 0 || to >= sections.length) return
    onReorder(arrayMove(sections, from, to))
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = sections.findIndex((s) => s.id === e.active.id)
    const to = sections.findIndex((s) => s.id === e.over!.id)
    onReorder(arrayMove(sections, from, to))
  }

  if (sections.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-rule-strong bg-surface-sunk px-4 py-6 text-center text-sm text-ink-muted">
        No sections yet. Add one to start building the assessment.
      </p>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2.5">
          {sections.map((section, i) => (
            <SectionCard
              key={section.id}
              section={section}
              questions={questionsBySection[section.id] ?? []}
              index={i}
              total={sections.length}
              onOpen={() => onOpen(section.id)}
              onMoveUp={() => move(i, i - 1)}
              onMoveDown={() => move(i, i + 1)}
              onRemove={() => onRemove(section.id)}
              onDuplicate={() => onDuplicate(section.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

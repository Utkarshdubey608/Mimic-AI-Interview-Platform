import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import { GripVertical, Plus, Trash2, BookOpen, ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { Button, cn } from '@/components/ui'
import type { McqSection } from '@shared/types'
import { PROTECTED_SECTION_IDS } from './mcqSections'

/**
 * The sections an assessment is built from.
 *
 * ── Why a library AND a free text field ──────────────────────────────────────
 * The prebuilt names are not a closed list, they are a starting point. A recruiter
 * hiring for a role nobody anticipated needs to type "Financial modelling" and get
 * a section, so the custom field is the primary path and the library is the
 * shortcut. Anything the library can produce, typing can produce too.
 *
 * ── Order is the array's order ────────────────────────────────────────────────
 * Reordering rewrites the list rather than editing a stored index. Two
 * representations of the same ordering drift, and an index that disagrees with the
 * array is a bug with no obvious right answer.
 *
 * ── Deleting is guarded, because it strands questions ─────────────────────────
 * Removing a section does not delete its questions; they lose their section and
 * fall to the end of the paper. That is recoverable, and deleting somebody's
 * questions because they renamed their mind about a heading would not be. The
 * count is shown on the button so the consequence is visible before the click.
 */

/** The shortcut list. Passage-bearing sections are seeded with the field open. */
const LIBRARY: { name: string; hint: string; passage?: boolean }[] = [
  { name: 'Aptitude', hint: 'Numerical and quantitative reasoning' },
  { name: 'Logical Reasoning', hint: 'Patterns, sequences, deduction' },
  { name: 'Verbal Ability', hint: 'Grammar, vocabulary, usage' },
  { name: 'English Comprehension', hint: 'A passage plus questions about it', passage: true },
  { name: 'Role-based', hint: 'Questions from the role and its topics' },
  { name: 'Debugging', hint: 'Read a faulty snippet, find the fault' },
  { name: 'Coding', hint: 'Read code, predict or choose the right implementation' },
]

function SortableSection({
  section, count, onChange, onRemove,
}: {
  section: McqSection
  count: number
  onChange: (patch: Partial<McqSection>) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: section.id })
  // `passage !== undefined`, not `Boolean(passage)`: a section seeded from the
  // library arrives with an EMPTY passage, which is present-but-unwritten. Testing
  // truthiness closed the field on exactly the sections that exist to have one.
  const [showPassage, setShowPassage] = useState(section.passage !== undefined)

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'rounded-xl border bg-surface p-3',
        isDragging ? 'border-rule-strong shadow-md' : 'border-border',
      )}
    >
      <div className="flex items-center gap-2">
        <button
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${section.name || 'section'}`}
          className="cursor-grab rounded p-1 text-ink-disabled hover:text-ink-muted"
        >
          <GripVertical size={15} />
        </button>
        <input
          value={section.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Name this part — Aptitude, Coding, …"
          aria-label="Section name"
          className="input-base h-9 flex-1 text-sm font-semibold"
        />
        <span className="whitespace-nowrap text-xs tabular-nums text-ink-faint">
          {count} question{count === 1 ? '' : 's'}
        </span>
        {PROTECTED_SECTION_IDS.has(section.id) ? (
          <span
            title="Every assessment always has this section — it can be renamed but not removed"
            className="rounded-lg p-1.5 text-ink-disabled"
          >
            <Lock size={13} />
          </span>
        ) : (
          <button
            onClick={onRemove}
            // The count is in the label so a screen reader hears the consequence too,
            // not only sighted users reading the number beside it.
            aria-label={`Remove ${section.name || 'section'}, freeing ${count} question${count === 1 ? '' : 's'}`}
            title={count > 0 ? `${count} question${count === 1 ? '' : 's'} will lose their section` : 'Remove section'}
            className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-danger-bg hover:text-danger"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <input
        value={section.instructions ?? ''}
        onChange={(e) => onChange({ instructions: e.target.value || undefined })}
        placeholder="Anything to tell them before this part starts (optional)"
        aria-label={`${section.name || 'Section'} instructions`}
        className="input-base mt-2 h-9 w-full text-xs"
      />

      {showPassage || section.passage !== undefined ? (
        <div className="mt-2">
          <label htmlFor={`passage-${section.id}`} className="field-label">
            Reading passage
          </label>
          <textarea
            id={`passage-${section.id}`}
            value={section.passage ?? ''}
            // Keeps the empty string rather than dropping to undefined, so clearing
            // the box does not yank the field out from under the cursor. The server
            // stores a passage only when it has content.
            onChange={(e) => onChange({ passage: e.target.value })}
            rows={4}
            placeholder="Paste the passage here. Every question in this section is about it."
            className="input-base w-full resize-y py-2 text-xs leading-relaxed"
          />
          <p className="mt-1 text-2xs text-ink-faint">
            One passage per section. Need a second passage? Add another section.
          </p>
        </div>
      ) : (
        <button
          onClick={() => setShowPassage(true)}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:underline"
        >
          <BookOpen size={12} /> Give them something to read first
        </button>
      )}
    </div>
  )
}

export function SectionsPanel({
  sections, questionCounts, onChange,
}: {
  sections: McqSection[]
  /** sectionId → how many questions sit in it, for the delete warning. */
  questionCounts: Record<string, number>
  onChange: (sections: McqSection[]) => void
}) {
  const [custom, setCustom] = useState('')
  const [open, setOpen] = useState(true)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const add = (name: string, passage = false) => {
    const trimmed = name.trim()
    if (!trimmed) return
    onChange([
      ...sections,
      {
        id: crypto.randomUUID(),
        name: trimmed,
        ...(passage ? { passage: '' } : {}),
      },
    ])
    setCustom('')
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = sections.findIndex((s) => s.id === e.active.id)
    const to = sections.findIndex((s) => s.id === e.over!.id)
    onChange(arrayMove(sections, from, to))
  }

  const taken = new Set(sections.map((s) => s.name.trim().toLowerCase()))

  return (
    /* Foldable, and open by default. On a long paper this panel sits between the
       recruiter and every question below it, and once the sections are set it has
       nothing left to say — but somebody who has never used the feature must be
       able to SEE it, so it does not start closed. */
    <section className="rounded-2xl border border-border bg-surface-sunk/60 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-ink-faint transition-colors hover:text-ink"
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <h2 className="font-display text-sm font-bold text-ink">Sections</h2>
        </button>
        <span className="rounded-full bg-surface-hover px-2 py-0.5 text-2xs font-semibold tabular-nums text-ink-muted">
          {sections.length === 0 ? 'none' : sections.length}
        </span>
        <p className="text-xs text-ink-muted">
          Split the test into parts. Candidates work through them in this order.
        </p>
      </div>

      {!open ? null : (
      <>
      {sections.length > 0 && (
        <div className="mt-3">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {sections.map((section) => (
                  <SortableSection
                    key={section.id}
                    section={section}
                    count={questionCounts[section.id] ?? 0}
                    onChange={(patch) =>
                      onChange(sections.map((s) => (s.id === section.id ? { ...s, ...patch } : s)))
                    }
                    onRemove={() => onChange(sections.filter((s) => s.id !== section.id))}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Typing is the PRIMARY path, so it comes first and is always visible. The
          library below is a shortcut for the common names, not the boundary of
          what a section may be. */}
      <div className="mt-3 flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(custom) } }}
          placeholder="Name a section — anything you want to test"
          aria-label="New section name"
          className="input-base h-9 flex-1 text-sm"
        />
        <Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={() => add(custom)} disabled={!custom.trim()}>
          Add
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {LIBRARY.map((entry) => {
          const already = taken.has(entry.name.toLowerCase())
          return (
            <button
              key={entry.name}
              onClick={() => add(entry.name, entry.passage)}
              disabled={already}
              title={already ? 'Already in this assessment' : entry.hint}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                already
                  ? 'cursor-not-allowed border-border bg-surface-hover text-ink-faint'
                  : 'border-rule bg-surface-hover text-ink hover:border-rule-strong',
              )}
            >
              {already ? entry.name : `+ ${entry.name}`}
            </button>
          )
        })}
      </div>

      </>
      )}
    </section>
  )
}

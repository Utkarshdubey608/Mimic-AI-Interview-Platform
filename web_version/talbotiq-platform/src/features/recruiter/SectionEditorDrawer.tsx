import { useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { ListPlus, Upload, Sparkles, RefreshCw } from 'lucide-react'
import { Drawer, Button, Input, Select, Textarea, Progress, Badge, cn } from '@/components/ui'
import { mcqSetsApi } from '@/lib/api'
import type { McqQuestion, McqSection, McqSectionType } from '@shared/types'
import { SortableMcq, blankQuestion } from './McqSetsPage'
import { SECTION_TYPES } from './mcqSectionTypes'
import { ImportReviewModal, type ImportReviewResult } from './ImportReviewModal'

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  imported: 'Imported',
  ai_generated: 'AI generated',
}

const SECTION_TYPE_OPTIONS = [
  ...SECTION_TYPES.map((t) => ({ value: t.id, label: t.label })),
  { value: 'custom', label: 'Custom' },
]

/**
 * The focused editor for ONE section — everything the board's card is too
 * small to hold. Target, progress, source breakdown, and the actions that
 * populate it (add / import / generate remaining), followed by the
 * section's own questions, reordered independently of every other section.
 *
 * `allQuestions`/`onQuestionsUpdate` operate on the FULL draft rather than a
 * scoped copy — a question can be moved OUT of this section via its own
 * "which section" dropdown (an existing capability, preserved unchanged),
 * and that has to be a real edit to the one draft the page holds, not a
 * local list this drawer would lose track of.
 */
export function SectionEditorDrawer({
  open, onClose, section, sections, allQuestions, setId, onSectionChange, onQuestionsUpdate, folded, onToggleFold,
}: {
  open: boolean
  onClose: () => void
  section: McqSection | null
  sections: McqSection[]
  allQuestions: McqQuestion[]
  setId: string
  onSectionChange: (patch: Partial<McqSection>) => void
  onQuestionsUpdate: (next: McqQuestion[]) => void
  folded: Set<string>
  onToggleFold: (id: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importResult, setImportResult] = useState<ImportReviewResult | null>(null)
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)

  const questions = useMemo(
    () => (section ? allQuestions.filter((q) => q.sectionId === section.id) : []),
    [allQuestions, section],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const updateQuestion = (id: string, patch: Partial<McqQuestion>) =>
    onQuestionsUpdate(allQuestions.map((q) => (q.id === id ? { ...q, ...patch } : q)))

  const removeQuestion = (id: string) => onQuestionsUpdate(allQuestions.filter((q) => q.id !== id))

  const appendQuestions = (newOnes: McqQuestion[]) => onQuestionsUpdate([...allQuestions, ...newOnes])

  const replaceQuestion = (id: string, replacement: McqQuestion) => {
    if (!section) return
    onQuestionsUpdate(
      allQuestions.map((q) => (q.id === id ? { ...replacement, sectionId: section.id } : q)),
    )
  }

  /** Reorders THIS section's questions while leaving every other question's
   *  absolute position untouched — the reordered subset is spliced back
   *  into the slots it already occupied, in its new relative order. */
  const reorderWithinSection = (from: number, to: number) => {
    if (!section) return
    const reordered = arrayMove(questions, from, to)
    let cursor = 0
    onQuestionsUpdate(
      allQuestions.map((q) => (q.sectionId === section.id ? reordered[cursor++] : q)),
    )
  }

  const importMutation = useMutation({
    mutationFn: (file: File) => mcqSetsApi.importIntoSection(setId, section!.id, file),
    onSuccess: (r) => setImportResult(r),
    onError: (e: Error) => toast.error(e.message),
  })

  const generateMutation = useMutation({
    mutationFn: (count?: number) => mcqSetsApi.generateForSection(setId, section!.id, count ? { count } : {}),
    onSuccess: (r) => {
      if (!section) return
      if (r.questions.length) appendQuestions(r.questions)
      if (r.passage && !section.passage) onSectionChange({ passage: r.passage })
      toast.success(
        `${r.delivered} question${r.delivered === 1 ? '' : 's'} added — check every answer before you save`,
      )
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const regenerateMutation = useMutation({
    mutationFn: (questionId: string) => mcqSetsApi.regenerateQuestion(setId, section!.id, questionId),
    onSuccess: (r, questionId) => {
      if (r.questions[0]) replaceQuestion(questionId, r.questions[0])
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setRegeneratingId(null),
  })

  if (!section) return null

  const target = section.targetQuestionCount ?? 0
  const added = questions.length
  const remaining = Math.max(0, target - added)

  const sourceCounts = questions.reduce<Record<string, number>>((acc, q) => {
    const key = q.source ?? 'manual'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = questions.findIndex((q) => q.id === e.active.id)
    const to = questions.findIndex((q) => q.id === e.over!.id)
    reorderWithinSection(from, to)
  }

  const addQuestion = () =>
    appendQuestions([{ ...blankQuestion(), sectionId: section.id, source: 'manual' }])

  const showPassageField = section.sectionType === 'reading_comprehension' || section.passage !== undefined

  return (
    // `ImportReviewModal` is a SIBLING of `Drawer`, not nested inside it — the
    // drawer's motion surface animates on `transform`, which would make a
    // `position: fixed` modal nested inside it position against THAT surface
    // instead of the viewport. Kept as a fragment for exactly that reason.
    <>
      <Drawer open={open} onClose={onClose} title={section.name || 'Untitled section'} width="max-w-2xl">
        <div className="space-y-4">
          <Input
            label="Section name"
            value={section.name}
            onChange={(e) => onSectionChange({ name: e.target.value })}
          />

          <div className="flex gap-3">
            <Select
              label="Type"
              value={section.sectionType ?? 'custom'}
              onChange={(e) => onSectionChange({ sectionType: e.target.value as McqSectionType })}
              options={SECTION_TYPE_OPTIONS}
              fieldClassName="flex-1"
            />
            <Input
              label="Target questions"
              type="number"
              min={0}
              max={200}
              value={target}
              onChange={(e) =>
                onSectionChange({ targetQuestionCount: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })
              }
              fieldClassName="w-36"
            />
          </div>

          <Input
            label="Instructions (optional)"
            value={section.instructions ?? ''}
            onChange={(e) => onSectionChange({ instructions: e.target.value || undefined })}
            placeholder="Anything to tell them before this part starts"
          />

          {showPassageField && (
            <Textarea
              label="Reading passage"
              value={section.passage ?? ''}
              onChange={(e) => onSectionChange({ passage: e.target.value })}
              rows={5}
              placeholder="Paste the passage here. Every question in this section is about it."
              hint="One passage per section — need a second one? Add another section."
            />
          )}

          <div className="rounded-lg border border-border bg-surface-sunk p-3">
            {target > 0 ? (
              <Progress
                value={added}
                max={target}
                label={`${added} / ${target} question${target === 1 ? '' : 's'}${
                  remaining > 0 ? ` — ${remaining} remaining` : ''
                }`}
              />
            ) : (
              <p className="text-xs text-ink-muted">{added} question{added === 1 ? '' : 's'} — no target set</p>
            )}
            {added > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(['manual', 'imported', 'ai_generated'] as const)
                  .filter((s) => sourceCounts[s])
                  .map((s) => (
                    <Badge key={s} variant="neutral">{SOURCE_LABEL[s]}: {sourceCounts[s]}</Badge>
                  ))}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon={<ListPlus size={15} />} onClick={addQuestion}>
              Add question
            </Button>
            <Button
              variant="outline"
              icon={<Upload size={15} />}
              loading={importMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              Import
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv,.xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) importMutation.mutate(file)
                e.target.value = ''
              }}
            />
            {(target === 0 || remaining > 0) && (
              <Button
                variant="outline"
                icon={<Sparkles size={15} />}
                loading={generateMutation.isPending}
                onClick={() => generateMutation.mutate(target > 0 ? undefined : 5)}
              >
                {target > 0 ? `Generate remaining ${remaining}` : 'Generate 5 with AI'}
              </Button>
            )}
          </div>

          {questions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-rule-strong bg-surface-sunk px-4 py-5 text-center text-sm text-ink-muted">
              No questions yet. Add one, import a file, or generate with AI.
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {questions.map((q, i) => (
                    <SortableMcq
                      key={q.id}
                      q={q}
                      index={i}
                      sections={sections}
                      folded={folded.has(q.id)}
                      onFold={() => onToggleFold(q.id)}
                      onChange={(patch) => updateQuestion(q.id, patch)}
                      onRemove={() => removeQuestion(q.id)}
                      extra={
                        q.source === 'ai_generated' ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            icon={<RefreshCw size={12} className={cn(regeneratingId === q.id && 'animate-spin')} />}
                            disabled={regeneratingId === q.id}
                            onClick={() => { setRegeneratingId(q.id); regenerateMutation.mutate(q.id) }}
                          >
                            Regenerate
                          </Button>
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </Drawer>

      <ImportReviewModal
        open={!!importResult}
        onClose={() => setImportResult(null)}
        result={importResult}
        onConfirm={(qs) => {
          appendQuestions(qs)
          setImportResult(null)
          toast.success(`${qs.length} question${qs.length === 1 ? '' : 's'} added — check every answer before you save`)
        }}
      />
    </>
  )
}

import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus, Copy, Trash2, Save, GripVertical, FileText, Sparkles, BookOpen, ListPlus,
  AlertTriangle, RefreshCw, Tag, Target,
} from 'lucide-react'
import { PageHeader, Card, Button, EmptyState, Skeleton, Badge, cn } from '@/components/ui'
import { questionSetsApi, describeFetchError } from '@/lib/api'
import { GenerateFromResumeModal } from './GenerateFromResumeModal'
import type { QuestionSet, FixedQuestion } from '@shared/types'

/* ── One editable question row ───────────────────────────────────────────── */
function SortableQuestion({
  q, index, onChange, onRemove,
}: { q: FixedQuestion; index: number; onChange: (p: Partial<FixedQuestion>) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 10 : undefined }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex gap-3 rounded-xl border bg-white p-3.5 shadow-xs transition-[border-color,box-shadow] duration-150',
        isDragging
          ? 'border-primary-300 shadow-lg'
          : 'border-border focus-within:border-primary-200 hover:border-neutral-300 hover:shadow-sm',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-1 cursor-grab touch-none self-start rounded-lg p-1 text-neutral-300 transition-colors duration-150 group-hover:text-neutral-500 hover:bg-neutral-100 active:cursor-grabbing"
        aria-label={`Drag to reorder question ${index + 1}`}
      >
        <GripVertical size={16} />
      </button>
      <span className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold tabular-nums text-primary-800">
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
            <Tag size={13} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={q.category ?? ''}
              onChange={(e) => onChange({ category: e.target.value })}
              placeholder="Category — groups questions in reports"
              aria-label={`Question ${index + 1} category`}
              className="input-base h-9 pl-8 text-xs"
            />
          </div>
          <div className="relative">
            <Target size={13} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
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
      <button
        onClick={onRemove}
        className="self-start rounded-lg p-1.5 text-neutral-400 transition-colors duration-150 hover:bg-danger-bg hover:text-danger"
        aria-label={`Remove question ${index + 1}`}
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

export default function QuestionSetsPage() {
  const qc = useQueryClient()
  const sets = useQuery({ queryKey: ['question-sets'], queryFn: questionSetsApi.list })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<QuestionSet | null>(null)
  const [genOpen, setGenOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Select first set by default; load the active set into the editable draft.
  useEffect(() => {
    if (!activeId && sets.data?.length) setActiveId(sets.data[0].id)
  }, [sets.data, activeId])
  useEffect(() => {
    const found = sets.data?.find((s) => s.id === activeId)
    if (found) setDraft(structuredClone(found))
  }, [activeId, sets.data])

  const create = useMutation({
    mutationFn: () => questionSetsApi.create({ name: 'New set', questions: [] }),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['question-sets'] }); setActiveId(s.id); toast.success('Set created') },
  })
  const duplicate = useMutation({
    mutationFn: (id: string) => questionSetsApi.duplicate(id),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['question-sets'] }); setActiveId(s.id); toast.success('Set duplicated') },
  })
  const remove = useMutation({
    mutationFn: (id: string) => questionSetsApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['question-sets'] }); setActiveId(null); setDraft(null); toast.success('Set deleted') },
  })
  const save = useMutation({
    mutationFn: () => questionSetsApi.update(draft!.id, { name: draft!.name, questions: draft!.questions }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['question-sets'] }); toast.success('Set saved') },
    onError: (e: Error) => toast.error(e.message),
  })

  const onDragEnd = (e: DragEndEvent) => {
    if (!draft || !e.over || e.active.id === e.over.id) return
    const from = draft.questions.findIndex((q) => q.id === e.active.id)
    const to = draft.questions.findIndex((q) => q.id === e.over!.id)
    setDraft({ ...draft, questions: arrayMove(draft.questions, from, to) })
  }
  const addQuestion = () =>
    setDraft({ ...draft!, questions: [...draft!.questions, { id: crypto.randomUUID(), text: '', category: '', idealAnswerNotes: '' }] })

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      <PageHeader
        kicker="AI Interview"
        title="Question Sets"
        description="Reusable fixed questions for interview templates. Drag to reorder; ideal-answer notes sharpen AI scoring."
      />

      <GenerateFromResumeModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        onSaved={(set) => { qc.invalidateQueries({ queryKey: ['question-sets'] }); setActiveId(set.id) }}
      />

      {sets.isLoading ? (
        <div className="grid gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
          <div>
            <div className="space-y-2">
              <Skeleton className="h-10 rounded-full" />
              <Skeleton className="h-10 rounded-full" />
            </div>
            <Skeleton className="mt-7 h-2.5 w-20 rounded-full" />
            <div className="mt-3 space-y-1.5">
              <Skeleton className="h-[50px]" />
              <Skeleton className="h-[50px]" />
              <Skeleton className="h-[50px]" />
              <Skeleton className="h-[50px]" />
            </div>
          </div>
          <Card className="p-5">
            <div className="-mx-5 flex items-center gap-2 border-b border-border px-5 pb-4">
              <Skeleton className="h-9 w-52 rounded-lg" />
              <Skeleton className="ml-auto h-8 w-24 rounded-full" />
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-[104px]" />
              <Skeleton className="h-[104px]" />
              <Skeleton className="h-[104px]" />
            </div>
          </Card>
        </div>
      ) : sets.isError ? (
        <Card className="p-0">
          <EmptyState
            icon={<AlertTriangle strokeWidth={1.75} />}
            title="Couldn't load question sets"
            description={describeFetchError(sets.error, "The request for your question sets didn't come back. Check your connection, then try again — nothing you've saved is lost.")}
            action={<Button size="sm" icon={<RefreshCw size={14} />} onClick={() => sets.refetch()}>Try again</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
          {/* ── set rail ─────────────────────────────────────────────────── */}
          <aside className="lg:sticky lg:top-[88px] lg:self-start">
            <div className="space-y-2">
              <Button className="w-full" icon={<Plus size={15} />} loading={create.isPending} onClick={() => create.mutate()}>New set</Button>
              <Button className="w-full" variant="outline" icon={<Sparkles size={15} />} onClick={() => setGenOpen(true)}>Generate from résumé</Button>
            </div>

            <div className="mt-7 flex items-baseline justify-between px-1">
              <span className="section-label">Your sets</span>
              <span className="text-xs font-semibold tabular-nums text-neutral-400">{(sets.data ?? []).length}</span>
            </div>

            {(sets.data ?? []).length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-5 text-center text-xs leading-relaxed text-neutral-500">
                No sets yet. Create one above, or build a set from a candidate’s résumé.
              </p>
            ) : (
              <div className="-mx-1 mt-3 space-y-1.5 px-1 lg:max-h-[calc(100vh-17rem)] lg:overflow-y-auto">
                {(sets.data ?? []).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    aria-current={activeId === s.id ? 'true' : undefined}
                    title={s.name}
                    className={cn(
                      'group flex w-full items-center gap-2.5 rounded-xl border p-3 text-left transition-all duration-150',
                      activeId === s.id
                        ? 'border-primary-300 bg-primary-50 shadow-xs'
                        : 'border-border bg-white hover:border-primary-200 hover:bg-primary-50/40',
                    )}
                  >
                    <FileText
                      size={15}
                      className={cn(
                        'flex-shrink-0 transition-colors duration-150',
                        activeId === s.id ? 'text-primary-700' : 'text-neutral-400 group-hover:text-primary-400',
                      )}
                    />
                    <span className={cn('min-w-0 flex-1 truncate text-sm', activeId === s.id ? 'font-semibold text-primary-800' : 'font-medium text-neutral-800')}>
                      {s.name}
                    </span>
                    <Badge variant={activeId === s.id ? 'info' : 'neutral'} className="tabular-nums">{s.questions.length}</Badge>
                  </button>
                ))}
              </div>
            )}
          </aside>

          {/* ── editor ───────────────────────────────────────────────────── */}
          {!draft ? (
            <Card className="p-0">
              <EmptyState
                icon={<BookOpen strokeWidth={1.75} />}
                title="No set selected"
                description="Choose a question set from the rail to edit it, or start a new one from scratch."
                action={<Button size="sm" icon={<Plus size={14} />} loading={create.isPending} onClick={() => create.mutate()}>New set</Button>}
              />
            </Card>
          ) : (
            <Card className="space-y-4 p-5">
              <div className="-mx-5 flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-border px-5 pb-4">
                <div className="min-w-[15rem] flex-1">
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    aria-label="Set name"
                    placeholder="Untitled set"
                    className="h-11 w-full rounded-xl border-[1.5px] border-transparent bg-transparent px-3 font-display text-lg font-bold tracking-[-0.02em] text-neutral-900 outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-neutral-400 hover:border-neutral-200 hover:bg-white focus:border-primary-700 focus:bg-white focus:shadow-[0_0_0_3px_rgba(11,122,69,0.12)]"
                  />
                  <p className="mt-1 px-3 text-xs text-neutral-500">
                    <span className="tabular-nums">{draft.questions.length}</span> question{draft.questions.length === 1 ? '' : 's'} · edits apply once you save
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5 pt-0.5">
                  <Button variant="ghost" size="sm" icon={<Copy size={14} />} loading={duplicate.isPending} onClick={() => duplicate.mutate(draft.id)}>Duplicate</Button>
                  <button onClick={() => { if (confirm(`Delete “${draft.name}”?`)) remove.mutate(draft.id) }} className="rounded-lg p-2 text-neutral-400 transition-colors duration-150 hover:bg-danger-bg hover:text-danger" aria-label="Delete set"><Trash2 size={15} /></button>
                  <Button size="sm" icon={<Save size={14} />} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
                </div>
              </div>

              {draft.questions.length === 0 ? (
                <EmptyState
                  icon={<ListPlus strokeWidth={1.75} />}
                  title="No questions yet"
                  description="Add the first question — the interviewer asks them in the order you set here."
                  action={<Button size="sm" icon={<Plus size={14} />} onClick={addQuestion}>Add question</Button>}
                />
              ) : (
                <>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={draft.questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {draft.questions.map((q, i) => (
                          <SortableQuestion
                            key={q.id}
                            q={q}
                            index={i}
                            onChange={(p) => setDraft({ ...draft, questions: draft.questions.map((x) => (x.id === q.id ? { ...x, ...p } : x)) })}
                            onRemove={() => setDraft({ ...draft, questions: draft.questions.filter((x) => x.id !== q.id) })}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                  <button
                    onClick={addQuestion}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-neutral-300 py-3 text-sm font-semibold text-neutral-500 transition-colors duration-150 hover:border-primary-300 hover:bg-primary-50/50 hover:text-primary-700"
                  >
                    <Plus size={15} />
                    Add question
                  </button>
                </>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

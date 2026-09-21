import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import {
  Plus, Copy, Trash2, Save, FileText, Sparkles, BookOpen, ListPlus,
  AlertTriangle, RefreshCw, Wand2,
} from 'lucide-react'
import { PageHeader, Card, Button, EmptyState, Skeleton, Badge, cn } from '@/components/ui'
import { questionSetsApi, describeFetchError } from '@/lib/api'
import { GenerateFromResumeModal } from './GenerateFromResumeModal'
import { SortableQuestion } from './QuestionRow'
import type { QuestionSet } from '@shared/types'

export default function QuestionSetsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
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

  /* Arriving back from the creation wizard, the set just built is the one the
     recruiter wants open — not whichever sorts first alphabetically. The state
     is cleared immediately so a refresh doesn't re-select it forever. */
  useEffect(() => {
    const justCreated = (location.state as { selectId?: string } | null)?.selectId
    if (!justCreated) return
    setActiveId(justCreated)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])
  useEffect(() => {
    const found = sets.data?.find((s) => s.id === activeId)
    if (found) setDraft(structuredClone(found))
  }, [activeId, sets.data])

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
              {/* The guided builder, not a blank row. Creating a set used to
                  drop an empty "New set" into the rail and leave the recruiter
                  staring at it; the wizard asks what they have — a paste, a
                  file, or nothing yet — and takes them from there. */}
              <Button className="w-full" icon={<Wand2 size={15} />} onClick={() => navigate('/question-sets/new')}>New set</Button>
              <Button className="w-full" variant="outline" icon={<Sparkles size={15} />} onClick={() => setGenOpen(true)}>Generate from résumé</Button>
            </div>

            <div className="mt-7 flex items-baseline justify-between px-1">
              <span className="section-label">Your sets</span>
              <span className="text-xs font-semibold tabular-nums text-ink-faint">{(sets.data ?? []).length}</span>
            </div>

            {(sets.data ?? []).length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-rule-strong bg-surface-sunk px-4 py-5 text-center text-xs leading-relaxed text-ink-muted">
                No sets yet. Build one above — paste questions from an LLM, import a file, or write them yourself — or generate a set from a candidate’s résumé.
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
                        ? 'border-rule-strong bg-surface-hover shadow-xs'
                        : 'border-border bg-surface hover:border-rule hover:bg-surface-hover/40',
                    )}
                  >
                    <FileText
                      size={15}
                      className={cn(
                        'flex-shrink-0 transition-colors duration-150',
                        activeId === s.id ? 'text-ink' : 'text-ink-faint group-hover:text-ink-faint',
                      )}
                    />
                    <span className={cn('min-w-0 flex-1 truncate text-sm', activeId === s.id ? 'font-semibold text-ink' : 'font-medium text-ink')}>
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
                action={<Button size="sm" icon={<Wand2 size={14} />} onClick={() => navigate('/question-sets/new')}>New set</Button>}
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
                    className="h-11 w-full rounded-xl border-[1.5px] border-transparent bg-transparent px-3 font-display text-lg font-bold tracking-[-0.02em] text-ink outline-none transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-ink-faint hover:border-rule hover:bg-surface focus:border-action focus:bg-surface focus:shadow-[0_0_0_3px_rgba(11,122,69,0.12)]"
                  />
                  <p className="mt-1 px-3 text-xs text-ink-muted">
                    <span className="tabular-nums">{draft.questions.length}</span> question{draft.questions.length === 1 ? '' : 's'} · edits apply once you save
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1.5 pt-0.5">
                  <Button variant="ghost" size="sm" icon={<Copy size={14} />} loading={duplicate.isPending} onClick={() => duplicate.mutate(draft.id)}>Duplicate</Button>
                  <button onClick={() => { if (confirm(`Delete “${draft.name}”?`)) remove.mutate(draft.id) }} className="rounded-lg p-2 text-ink-faint transition-colors duration-150 hover:bg-danger-bg hover:text-danger" aria-label="Delete set"><Trash2 size={15} /></button>
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-rule-strong py-3 text-sm font-semibold text-ink-muted transition-colors duration-150 hover:border-rule-strong hover:bg-surface-hover/50 hover:text-ink"
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

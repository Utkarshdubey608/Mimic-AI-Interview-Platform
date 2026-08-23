import { useEffect, useMemo, useState } from 'react'
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
  Plus, Copy, Trash2, Save, GripVertical, ListChecks, ListPlus, AlertTriangle, Sparkles,
  RefreshCw, Tag, Check, CircleDot, Lock, Code,
} from 'lucide-react'
import { PageHeader, Card, Button, EmptyState, Skeleton, Badge, cn } from '@/components/ui'
import { mcqSetsApi, describeFetchError } from '@/lib/api'
import type { McqQuestionSet, McqQuestion, McqOption, McqSection, McqPair } from '@shared/types'
import { SectionsPanel } from './SectionsPanel'
import { GenerateMcqModal } from './GenerateMcqModal'

/**
 * MCQ authoring — the manual path.
 *
 * Mirrors QuestionSetsPage deliberately: the same rail, the same New/Duplicate/
 * Save, the same drag-to-reorder, because a recruiter who can author one kind of
 * set should not have to learn a second editor. What is new is per-question
 * options and the marking of the correct one.
 *
 * ── The one thing this editor must get right ─────────────────────────────
 * A paper is only an assessment if it can distinguish candidates. Three ways to
 * author one that cannot, all of which the server refuses and all of which are
 * therefore shown HERE, before saving:
 *
 *   · fewer than two options — the question asks nothing;
 *   · nothing marked correct — every candidate scores zero;
 *   · everything marked correct — nobody is distinguished.
 *
 * They are surfaced inline as the recruiter types rather than as a save error,
 * because a 40-question paper that fails on question 31 is a bad way to find out.
 * The Save button states the count instead of silently refusing.
 *
 * ── What a candidate never sees ──────────────────────────────────────────
 * Everything on this page. The answer key lives in the recruiter's own
 * owner-scoped set and is compared server-side on submit; the candidate's payload
 * is built by an allow-list that has no field for it. The padlock next to
 * "Correct answer" says so, because a recruiter typing an answer key into a
 * browser is entitled to know where it goes.
 */

/* ── One option row ──────────────────────────────────────────────────────── */
function OptionRow({
  option, isMulti, checked, onToggle, onText, onRemove, canRemove, index, questionIndex,
}: {
  option: McqOption
  isMulti: boolean
  checked: boolean
  onToggle: () => void
  onText: (text: string) => void
  onRemove: () => void
  canRemove: boolean
  index: number
  questionIndex: number
}) {
  const letter = String.fromCharCode(65 + index)
  return (
    <div className="flex items-center gap-2.5">
      {/* Radio for single, checkbox for multi — the control itself tells the
          recruiter how many answers the question takes, so the rule is legible
          without reading a label. */}
      <button
        type="button"
        role={isMulti ? 'checkbox' : 'radio'}
        aria-checked={checked}
        aria-label={`Mark option ${letter} correct`}
        onClick={onToggle}
        className={cn(
          'flex h-6 w-6 flex-shrink-0 items-center justify-center border transition-colors duration-fast',
          isMulti ? 'rounded-md' : 'rounded-full',
          checked
            ? 'border-ok bg-ok text-white'
            : 'border-rule-input bg-surface text-transparent hover:border-ink-faint',
        )}
      >
        {checked ? <Check size={13} strokeWidth={3} /> : <CircleDot size={12} className="opacity-0" />}
      </button>
      <span className="w-4 flex-shrink-0 text-xs font-bold text-ink-faint">{letter}</span>
      <input
        value={option.text}
        onChange={(e) => onText(e.target.value)}
        placeholder={`Option ${letter}`}
        aria-label={`Question ${questionIndex + 1} option ${letter} text`}
        className="input-base h-9 flex-1 text-sm"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`Remove option ${letter}`}
        className="rounded-lg p-1.5 text-ink-faint transition-colors duration-150 hover:bg-danger-bg hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-faint"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

/** Why this question cannot be used, or null when it is fine. */
function faultOf(q: McqQuestion): string | null {
  if (!q.text.trim()) return 'Needs a question.'

  // TYPE-AWARE, and it has to be: a pairing has no options at all, so the option
  // rules below reported "needs at least two options" on a question that was
  // perfectly complete. The server had already learned this; the client had not,
  // and the two disagreeing is worse than either being wrong — the recruiter sees
  // a warning that saving then contradicts.
  if (q.type === 'match') {
    const rows = (q.pairs ?? []).filter((r) => r.left.trim() && r.right.trim())
    if (rows.length < 2) return 'Needs at least two complete pairs.'
    const answers = rows.map((r) => r.right.trim().toLowerCase())
    if (new Set(answers).size !== answers.length) {
      return 'Two rows match the same answer, so the pairing cannot be solved.'
    }
    return null
  }

  const usable = q.options.filter((o) => o.text.trim())
  if (usable.length < 2) return 'Needs at least two options.'
  const key = q.correctOptionIds.filter((id) => usable.some((o) => o.id === id))
  if (key.length === 0) return 'Mark the correct answer — otherwise everyone scores zero.'
  if (key.length === usable.length) return 'Every option is marked correct, so it cannot distinguish anyone.'
  return null
}

/* ── One editable question ───────────────────────────────────────────────── */
function SortableMcq({
  q, index, sections, onChange, onRemove,
}: {
  q: McqQuestion
  index: number
  sections: McqSection[]
  onChange: (p: Partial<McqQuestion>) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 10 : undefined }
  const isMulti = q.type === 'multi'
  const isMatch = q.type === 'match'
  const fault = faultOf(q)

  /* Pairing rows. Ids are minted per SIDE and never shared: if a prompt and its
     match had the same id, the answer would be readable from the field names
     however the columns were ordered. */
  const pairs = q.pairs ?? []
  const setPair = (promptId: string, patch: Partial<McqPair>) =>
    onChange({ pairs: pairs.map((r) => (r.promptId === promptId ? { ...r, ...patch } : r)) })
  const addPair = () =>
    onChange({
      pairs: [
        ...pairs,
        {
          promptId: crypto.randomUUID().slice(0, 8),
          matchId: crypto.randomUUID().slice(0, 8),
          left: '',
          right: '',
        },
      ],
    })
  const removePair = (promptId: string) =>
    onChange({ pairs: pairs.filter((r) => r.promptId !== promptId) })

  /* Switching type is destructive in one direction, so it is done explicitly.
     Going to a pairing seeds two empty rows (the minimum a pairing can ask) and
     leaves the options alone, so switching back does not lose them. */
  const setType = (next: McqQuestion['type']) => {
    if (next === 'match' && pairs.length === 0) {
      onChange({
        type: next,
        pairs: [0, 1].map(() => ({
          promptId: crypto.randomUUID().slice(0, 8),
          matchId: crypto.randomUUID().slice(0, 8),
          left: '',
          right: '',
        })),
      })
      return
    }
    onChange({ type: next })
  }

  const setOption = (id: string, text: string) =>
    onChange({ options: q.options.map((o) => (o.id === id ? { ...o, text } : o)) })

  const removeOption = (id: string) =>
    onChange({
      options: q.options.filter((o) => o.id !== id),
      // The key must never name an option that no longer exists, or the question
      // silently becomes unanswerable.
      correctOptionIds: q.correctOptionIds.filter((k) => k !== id),
    })

  const addOption = () =>
    onChange({ options: [...q.options, { id: crypto.randomUUID().slice(0, 8), text: '' }] })

  const toggle = (id: string) => {
    if (isMulti) {
      const next = q.correctOptionIds.includes(id)
        ? q.correctOptionIds.filter((k) => k !== id)
        : [...q.correctOptionIds, id]
      onChange({ correctOptionIds: next })
    } else {
      // Single-answer: choosing replaces rather than adds, so the key cannot end
      // up with two entries while the control still looks like a radio.
      onChange({ correctOptionIds: q.correctOptionIds[0] === id ? [] : [id] })
    }
  }

  const switchType = (type: 'single' | 'multi') =>
    onChange({
      type,
      // Narrowing to single keeps at most one answer; widening keeps what is there.
      correctOptionIds: type === 'single' ? q.correctOptionIds.slice(0, 1) : q.correctOptionIds,
    })

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex gap-3 rounded-xl border bg-surface p-3.5 shadow-xs transition-[border-color,box-shadow] duration-150',
        isDragging
          ? 'border-rule-strong shadow-lg'
          : fault
            ? 'border-warn-rule'
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

      <div className="min-w-0 flex-1 space-y-3">
        <textarea
          value={q.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Type the question…"
          aria-label={`Question ${index + 1} text`}
          className="textarea-base text-sm"
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {([
              { value: 'single', label: 'One answer' },
              { value: 'multi', label: 'Several' },
              { value: 'match', label: 'Match' },
            ] as const).map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => (t.value === 'match' ? setType('match') : switchType(t.value))}
                aria-pressed={q.type === t.value || (t.value === 'single' && !q.type)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors duration-fast',
                  (q.type ?? 'single') === t.value
                    ? 'bg-action text-action-ink'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="inline-flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
            <Lock size={10} /> Correct answer — never sent to the candidate
          </span>
        </div>

        {/* A snippet the question is ABOUT. This is how coding and debugging are
            assessed: the candidate reads code and answers a closed question about
            it, so scoring stays a comparison rather than an execution - no
            sandbox, no per-run cost, and the same result every time. */}
        {q.code === undefined ? (
          <button
            type="button"
            onClick={() => onChange({ code: '' })}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:underline"
          >
            <Code size={12} /> Add a code snippet
          </button>
        ) : (
          <div>
            <label htmlFor={`code-${q.id}`} className="field-label">
              Code snippet
            </label>
            <textarea
              id={`code-${q.id}`}
              value={q.code}
              onChange={(e) => onChange({ code: e.target.value })}
              onBlur={(e) => { if (!e.target.value.trim()) onChange({ code: undefined }) }}
              rows={5}
              spellCheck={false}
              placeholder={'def total(items):\n    return sum(items)'}
              className="input-base w-full resize-y py-2 font-mono text-xs leading-relaxed"
            />
          </div>
        )}

        {isMatch ? (
          /* Authored a ROW at a time, which is how a person thinks about a pairing
             - and the reason the server must never publish column B in this order:
             row-for-row is the answer. It shuffles the two columns independently
             and checks the result is not the pairing before sending it. */
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
              <span className="flex-1">Item</span>
              <span className="flex-1">Matches with</span>
              <span className="w-7" />
            </div>
            {pairs.map((row, i) => (
              <div key={row.promptId} className="flex items-center gap-2">
                <input
                  value={row.left}
                  onChange={(e) => setPair(row.promptId, { left: e.target.value })}
                  placeholder="Binary search"
                  aria-label={`Question ${index + 1} pair ${i + 1} item`}
                  className="input-base h-9 flex-1 text-xs"
                />
                <input
                  value={row.right}
                  onChange={(e) => setPair(row.promptId, { right: e.target.value })}
                  placeholder="O(log n)"
                  aria-label={`Question ${index + 1} pair ${i + 1} match`}
                  className="input-base h-9 flex-1 text-xs"
                />
                <button
                  onClick={() => removePair(row.promptId)}
                  disabled={pairs.length <= 2}
                  aria-label={`Remove pair ${i + 1}`}
                  title={pairs.length <= 2 ? 'A pairing needs at least two rows' : 'Remove row'}
                  className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-danger-bg hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-faint"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={addPair} disabled={pairs.length >= 10}>
              Add pair
            </Button>
          </div>
        ) : (
        <div className="space-y-2">
          {q.options.map((o, i) => (
            <OptionRow
              key={o.id}
              option={o}
              index={i}
              questionIndex={index}
              isMulti={isMulti}
              checked={q.correctOptionIds.includes(o.id)}
              onToggle={() => toggle(o.id)}
              onText={(text) => setOption(o.id, text)}
              onRemove={() => removeOption(o.id)}
              canRemove={q.options.length > 2}
            />
          ))}
        </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {/* Adding an option is meaningless on a pairing, which has rows instead. */}
          {!isMatch && (
            <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={addOption} disabled={q.options.length >= 10}>
              Add option
            </Button>
          )}
          <div className="relative min-w-[9rem] flex-1">
            <Tag size={13} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={q.topic ?? ''}
              onChange={(e) => onChange({ topic: e.target.value })}
              placeholder="Topic — groups the score breakdown"
              aria-label={`Question ${index + 1} topic`}
              className="input-base h-9 pl-8 text-xs"
            />
          </div>
          {/* Driven by the assessment's own sections, so the only sections on offer
              are ones that exist. "No section" stays a real choice: a paper without
              sections works exactly as it always did. */}
          <select
            value={q.sectionId ?? ''}
            onChange={(e) => onChange({ sectionId: e.target.value || undefined })}
            aria-label={`Question ${index + 1} section`}
            className="input-base h-9 w-40 text-xs"
          >
            <option value="">No section</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name || 'Untitled section'}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            value={q.points ?? 1}
            onChange={(e) => onChange({ points: Math.max(0, Number(e.target.value) || 0) })}
            aria-label={`Question ${index + 1} points`}
            className="input-base h-9 w-20 text-xs tabular-nums"
          />
        </div>

        {/* Shown as you author, not on save: a 40-question paper that fails on
            question 31 is a bad way to learn the rule. */}
        {fault && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
            <AlertTriangle size={13} /> {fault}
          </p>
        )}
      </div>

      <button
        onClick={onRemove}
        className="self-start rounded-lg p-1.5 text-ink-faint transition-colors duration-150 hover:bg-danger-bg hover:text-danger"
        aria-label={`Remove question ${index + 1}`}
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

const blankQuestion = (): McqQuestion => ({
  id: crypto.randomUUID(),
  text: '',
  type: 'single',
  options: [
    { id: crypto.randomUUID().slice(0, 8), text: '' },
    { id: crypto.randomUUID().slice(0, 8), text: '' },
  ],
  correctOptionIds: [],
})

export default function McqSetsPage() {
  const qc = useQueryClient()
  const sets = useQuery({ queryKey: ['mcq-sets'], queryFn: mcqSetsApi.list })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<McqQuestionSet | null>(null)
  const [genOpen, setGenOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    if (!activeId && sets.data?.length) setActiveId(sets.data[0].id)
  }, [sets.data, activeId])
  useEffect(() => {
    const found = sets.data?.find((s) => s.id === activeId)
    if (found) setDraft(structuredClone(found))
  }, [activeId, sets.data])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['mcq-sets'] })

  /* A new set starts with one blank question rather than none: the server
     refuses an empty set, so an empty new set would be unsaveable the moment it
     appeared. */
  const createGenerated = useMutation({
    mutationFn: (paper: { name: string; questions: McqQuestion[] }) => mcqSetsApi.create(paper),
    onSuccess: (s) => {
      invalidate(); setActiveId(s.id); setGenOpen(false)
      toast.success('Paper generated — review every answer before sending it')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const create = useMutation({
    mutationFn: () => mcqSetsApi.create({ name: 'New assessment', questions: [blankQuestion()] }),
    onSuccess: (s) => { invalidate(); setActiveId(s.id); toast.success('Assessment created') },
    onError: (e: Error) => toast.error(e.message),
  })
  const duplicate = useMutation({
    mutationFn: (id: string) => mcqSetsApi.duplicate(id),
    onSuccess: (s) => { invalidate(); setActiveId(s.id); toast.success('Set duplicated') },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => mcqSetsApi.remove(id),
    onSuccess: () => { invalidate(); setActiveId(null); setDraft(null); toast.success('Set deleted') },
    onError: (e: Error) => toast.error(e.message),
  })
  const save = useMutation({
    mutationFn: () =>
      mcqSetsApi.update(draft!.id, {
        name: draft!.name,
        sections: draft!.sections ?? [],
        questions: draft!.questions,
      }),
    onSuccess: () => { invalidate(); toast.success('Assessment saved') },
    onError: (e: Error) => toast.error(e.message),
  })

  /* How many questions sit in each section, so removing one can say what it will
     free rather than surprising the recruiter afterwards. */
  const sectionCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const q of draft?.questions ?? []) {
      if (q.sectionId) counts[q.sectionId] = (counts[q.sectionId] ?? 0) + 1
    }
    return counts
  }, [draft])

  const onDragEnd = (e: DragEndEvent) => {
    if (!draft || !e.over || e.active.id === e.over.id) return
    const from = draft.questions.findIndex((q) => q.id === e.active.id)
    const to = draft.questions.findIndex((q) => q.id === e.over!.id)
    setDraft({ ...draft, questions: arrayMove(draft.questions, from, to) })
  }

  const faults = draft?.questions.filter((q) => faultOf(q) !== null).length ?? 0
  const totalPoints = draft?.questions.reduce((sum, q) => sum + (q.points ?? 1), 0) ?? 0

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      <GenerateMcqModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        onGenerated={(name, questions) => createGenerated.mutate({ name, questions })}
      />

      <PageHeader
        kicker="AI Interview"
        title="Assessments"
        description="Sections of closed questions — multiple choice, several answers, or matching — scored the instant a candidate submits. No model, no waiting. The answer key stays on the server and never reaches a candidate's browser."
      />

      {sets.isLoading ? (
        <div className="grid gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
          <div className="space-y-2">
            <Skeleton className="h-10 rounded-full" />
            <Skeleton className="mt-7 h-2.5 w-20 rounded-full" />
            <Skeleton className="h-[50px]" />
            <Skeleton className="h-[50px]" />
          </div>
          <Card className="p-5">
            <Skeleton className="h-9 w-52 rounded-lg" />
            <div className="mt-4 space-y-2">
              <Skeleton className="h-[220px]" />
              <Skeleton className="h-[220px]" />
            </div>
          </Card>
        </div>
      ) : sets.isError ? (
        <Card className="p-0">
          <EmptyState
            icon={<AlertTriangle strokeWidth={1.75} />}
            title="Couldn't load your assessments"
            description={describeFetchError(sets.error, "The request for your assessments didn't come back. Check your connection, then try again — nothing you've saved is lost.")}
            action={<Button size="sm" icon={<RefreshCw size={14} />} onClick={() => sets.refetch()}>Try again</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-[88px] lg:self-start">
            <div className="space-y-2">
              <Button className="w-full" icon={<Plus size={15} />} loading={create.isPending} onClick={() => create.mutate()}>
                New assessment
              </Button>
              {/* Mode A. Generation writes a DRAFT and opens it here: the answer
                  key it produced is exactly the thing that must be read by a
                  person before anyone is scored against it. */}
              <Button
                className="w-full"
                variant="outline"
                icon={<Sparkles size={15} />}
                loading={createGenerated.isPending}
                onClick={() => setGenOpen(true)}
              >
                Generate with AI
              </Button>
            </div>

            <div className="mt-7 flex items-baseline justify-between px-1">
              <span className="section-label">Your assessments</span>
              <span className="text-xs font-semibold tabular-nums text-ink-faint">{(sets.data ?? []).length}</span>
            </div>

            {(sets.data ?? []).length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-rule-strong bg-surface-sunk px-4 py-5 text-center text-xs leading-relaxed text-ink-muted">
                No assessments yet. Create one above — these are yours alone, because they hold the answers.
              </p>
            ) : (
              <div className="-mx-1 mt-3 space-y-1.5 px-1 lg:max-h-[calc(100vh-17rem)] lg:overflow-y-auto">
                {(sets.data ?? []).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={cn(
                      'w-full rounded-xl border px-3.5 py-2.5 text-left transition-colors duration-150',
                      s.id === activeId
                        ? 'border-action bg-surface-hover/40 ring-1 ring-signal'
                        : 'border-border bg-surface hover:border-rule-strong',
                    )}
                  >
                    <span className="block truncate text-sm font-semibold text-ink">{s.name}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {s.questions.length} question{s.questions.length === 1 ? '' : 's'}
                      {s.ready === false && <span className="text-warn"> · unfinished</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </aside>

          {!draft ? (
            <Card className="p-0">
              <EmptyState
                icon={<ListChecks strokeWidth={1.75} />}
                title="No set selected"
                description="Pick a set on the left, or create one. Each question takes two or more options and at least one marked correct."
              />
            </Card>
          ) : (
            <Card className="p-5">
              <div className="-mx-5 flex flex-wrap items-center gap-2 border-b border-border px-5 pb-4">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  aria-label="Set name"
                  className="input-base h-9 max-w-xs text-sm font-semibold"
                />
                <Badge>{draft.questions.length} question{draft.questions.length === 1 ? '' : 's'}</Badge>
                <Badge>{totalPoints} point{totalPoints === 1 ? '' : 's'}</Badge>
                {faults > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-warn">
                    <AlertTriangle size={13} /> {faults} to finish before sending
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok">
                    <Check size={13} /> Ready to send
                  </span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="outline" icon={<Copy size={14} />} loading={duplicate.isPending} onClick={() => duplicate.mutate(draft.id)}>
                    Duplicate
                  </Button>
                  <Button size="sm" variant="outline" icon={<Trash2 size={14} />} loading={remove.isPending} onClick={() => remove.mutate(draft.id)}>
                    Delete
                  </Button>
                  {/* ALWAYS enabled. A draft is a legitimate state — nobody
                      authors a forty-question paper through a sequence of valid
                      ones — and disabling Save until every question was finished
                      meant a recruiter interrupted mid-paper lost the work. What
                      is unfinished is reported below and refused at SEND, not
                      here. */}
                  <Button
                    size="sm"
                    icon={<Save size={14} />}
                    loading={save.isPending}
                    onClick={() => save.mutate()}
                  >
                    Save
                  </Button>
                </div>
              </div>

              <div className="mt-4">
                <SectionsPanel
                  sections={draft.sections ?? []}
                  questionCounts={sectionCounts}
                  onChange={(sections) => setDraft({ ...draft, sections })}
                />
              </div>

              <div className="mt-4">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={draft.questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                      {draft.questions.map((q, i) => (
                        <SortableMcq
                          key={q.id}
                          q={q}
                          index={i}
                          sections={draft.sections ?? []}
                          onChange={(patch) =>
                            setDraft({
                              ...draft,
                              questions: draft.questions.map((x) => (x.id === q.id ? { ...x, ...patch } : x)),
                            })
                          }
                          onRemove={() => setDraft({ ...draft, questions: draft.questions.filter((x) => x.id !== q.id) })}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                <Button
                  className="mt-3"
                  variant="outline"
                  icon={<ListPlus size={15} />}
                  onClick={() => setDraft({ ...draft, questions: [...draft.questions, blankQuestion()] })}
                >
                  Add question
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

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
  RefreshCw, Tag, Check, CircleDot, Lock, Code, ChevronDown, ChevronRight, FoldVertical,
  UnfoldVertical, Image as ImageIcon,
} from 'lucide-react'
import {
  PageHeader, Page, Card, Button, ConfirmDialog, EmptyState, Skeleton, Badge, cn,
} from '@/components/ui'
import { mcqSetsApi, describeFetchError } from '@/lib/api'
import type { McqQuestionSet, McqQuestion, McqOption, McqSection, McqPair } from '@shared/types'
import { SectionsPanel } from './SectionsPanel'
import { GenerateMcqModal } from './GenerateMcqModal'
import { TemplateGalleryModal } from './TemplateGalleryModal'
import { NewAssessmentModal } from './NewAssessmentModal'
import { MCQ_TEMPLATES } from './mcqTemplates'
import { DIAGRAM_SECTION_ID, withDefaultSections } from './mcqSections'

/**
 * Assessment authoring — the manual path.
 *
 * Mirrors QuestionSetsPage deliberately: the same rail, the same New/Copy/
 * Save, the same drag-to-reorder, because a recruiter who can author one kind of
 * set should not have to learn a second editor. What is new is per-question
 * answers and the ticking of the right one.
 *
 * ── The wording is deliberately plain ────────────────────────────────────
 * This page used to say "closed questions", "options", "the answer key", "1 to
 * finish before sending". The people using it are recruiters, not exam boards.
 * Every label is now the sentence somebody would say out loud — "Pick one",
 * "Tick the right answer", "1 question needs finishing". The stored SHAPE is
 * untouched: a question still has `options` and `correctOptionIds`, and the
 * server sees exactly what it always did.
 *
 * ── The one thing this editor must get right ─────────────────────────────
 * A paper is only an assessment if it can distinguish candidates. Three ways to
 * author one that cannot, all of which the server refuses and all of which are
 * therefore shown HERE, before saving:
 *
 *   · fewer than two answers — the question asks nothing;
 *   · nothing ticked right — every candidate scores zero;
 *   · everything ticked right — nobody is distinguished.
 *
 * They are surfaced inline as the recruiter types rather than as a save error,
 * because a 40-question paper that fails on question 31 is a bad way to find out.
 * The header states the count instead of silently refusing.
 *
 * ── What a candidate never sees ──────────────────────────────────────────
 * Everything on this page. The right answers live in the recruiter's own
 * owner-scoped set and are compared server-side on submit; the candidate's payload
 * is built by an allow-list that has no field for them. The padlock above the
 * answers says so, because a recruiter ticking right answers into a browser is
 * entitled to know where they go.
 *
 * ── Long papers ──────────────────────────────────────────────────────────
 * Forty questions is a normal size and forty open cards is not a usable screen,
 * so a card folds to one line — its number, its text, its type and whether it is
 * finished — and the whole paper folds at once from the list header. Folding is
 * view state only and never touches the draft.
 */

/* ── One answer row ──────────────────────────────────────────────────────── */
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
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg border px-2 py-1.5 transition-colors duration-fast',
        // The right answer is now legible at a glance instead of only from the
        // state of a 24px control: on a ten-answer question, scanning ten radio
        // buttons for the filled one is work the row itself can do.
        checked ? 'border-ok-rule bg-ok-bg' : 'border-transparent hover:bg-surface-hover/50',
      )}
    >
      {/* Radio for single, checkbox for multi — the control itself tells the
          recruiter how many answers the question takes, so the rule is legible
          without reading a label. */}
      <button
        type="button"
        role={isMulti ? 'checkbox' : 'radio'}
        aria-checked={checked}
        aria-label={`Mark option ${letter} correct`}
        title={checked ? 'This is the right answer' : 'Tick this as the right answer'}
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
      <span className={cn('w-4 flex-shrink-0 text-xs font-bold', checked ? 'text-ok' : 'text-ink-faint')}>
        {letter}
      </span>
      <input
        value={option.text}
        onChange={(e) => onText(e.target.value)}
        placeholder={`Answer ${letter}`}
        aria-label={`Question ${questionIndex + 1} option ${letter} text`}
        className="input-base h-9 flex-1 text-sm"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`Remove option ${letter}`}
        title={canRemove ? 'Remove this answer' : 'A question needs at least two answers'}
        className="rounded-lg p-1.5 text-ink-faint transition-colors duration-150 hover:bg-danger-bg hover:text-danger disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-faint"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

/** Why this question cannot be used, or null when it is fine. */
function faultOf(q: McqQuestion): string | null {
  if (!q.text.trim()) return 'Type the question.'

  // TYPE-AWARE, and it has to be: a pairing has no answers at all, so the answer
  // rules below reported "needs at least two answers" on a question that was
  // perfectly complete. The server had already learned this; the client had not,
  // and the two disagreeing is worse than either being wrong — the recruiter sees
  // a warning that saving then contradicts.
  if (q.type === 'match') {
    const rows = (q.pairs ?? []).filter((r) => r.left.trim() && r.right.trim())
    if (rows.length < 2) return 'Fill in at least two pairs.'
    const answers = rows.map((r) => r.right.trim().toLowerCase())
    if (new Set(answers).size !== answers.length) {
      return 'Two rows have the same match, so this cannot be solved.'
    }
    return null
  }

  const usable = q.options.filter((o) => o.text.trim())
  if (usable.length < 2) return 'Add at least two answers to choose from.'
  const key = q.correctOptionIds.filter((id) => usable.some((o) => o.id === id))
  if (key.length === 0) return 'Tick the right answer, or everybody scores zero.'
  if (key.length === usable.length) return 'Every answer is ticked right, so everybody gets full marks.'
  return null
}

const TYPES = [
  { value: 'single', label: 'Pick one', hint: 'One right answer out of several' },
  { value: 'multi', label: 'Pick many', hint: 'More than one answer is right' },
  { value: 'match', label: 'Match pairs', hint: 'Line up each item with its match' },
] as const

const typeLabel = (t: McqQuestion['type'] | undefined) =>
  TYPES.find((x) => x.value === (t ?? 'single'))?.label ?? 'Pick one'

/* ── One editable question ───────────────────────────────────────────────── */
function SortableMcq({
  q, index, sections, folded, onFold, onChange, onRemove,
}: {
  q: McqQuestion
  index: number
  sections: McqSection[]
  folded: boolean
  onFold: () => void
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
     Going to a pairing seeds two empty rows (the fewest a pairing can ask) and
     leaves the answers alone, so switching back does not lose them. */
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
      // The right answers must never name one that no longer exists, or the
      // question silently becomes unanswerable.
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
      // Pick one: choosing replaces rather than adds, so the answer cannot end
      // up with two entries while the control still looks like a radio.
      onChange({ correctOptionIds: q.correctOptionIds[0] === id ? [] : [id] })
    }
  }

  const switchType = (type: 'single' | 'multi') =>
    onChange({
      type,
      // Narrowing to one keeps at most one answer; widening keeps what is there.
      correctOptionIds: type === 'single' ? q.correctOptionIds.slice(0, 1) : q.correctOptionIds,
    })

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group rounded-xl border bg-surface shadow-xs transition-[border-color,box-shadow] duration-150',
        isDragging
          ? 'border-rule-strong shadow-lg'
          : fault
            ? 'border-warn-rule'
            : 'border-border focus-within:border-rule hover:border-rule-strong hover:shadow-sm',
      )}
    >
      {/* ── the question's own header row ────────────────────────────────────
          Number, what kind of question it is, what it is worth, and the two
          controls that act on the whole card. Everything that used to be strewn
          through the body — the type switch, the naked points box — is here,
          which is what lets the body below be nothing but the question and its
          answers. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none rounded-lg p-1 text-ink-disabled transition-colors duration-150 group-hover:text-ink-muted hover:bg-surface-hover active:cursor-grabbing"
          aria-label={`Drag to reorder question ${index + 1}`}
        >
          <GripVertical size={16} />
        </button>
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-bold tabular-nums text-ink">
          {index + 1}
        </span>

        {folded ? (
          <button
            type="button"
            onClick={onFold}
            className="min-w-0 flex-1 truncate text-left text-sm text-ink-body hover:text-ink"
          >
            {q.text.trim() || <span className="text-ink-faint">Nothing typed yet</span>}
          </button>
        ) : (
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => (t.value === 'match' ? setType('match') : switchType(t.value))}
                aria-pressed={(q.type ?? 'single') === t.value}
                title={t.hint}
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
        )}

        <div className="ml-auto flex items-center gap-2">
          {folded && (
            <>
              <span className="hidden text-xs font-medium text-ink-muted sm:inline">{typeLabel(q.type)}</span>
              {fault && <AlertTriangle size={14} className="text-warn" aria-label="Not finished" />}
            </>
          )}
          {/* A bare number box next to two dropdowns taught nobody what it was.
              It now says what it is, in the place where the question's own
              properties live. */}
          <label className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
            Points
            <input
              type="number"
              min={0}
              value={q.points ?? 1}
              onChange={(e) => onChange({ points: Math.max(0, Number(e.target.value) || 0) })}
              aria-label={`Question ${index + 1} points`}
              className="input-base h-8 w-16 text-xs tabular-nums"
            />
          </label>
          <button
            type="button"
            onClick={onFold}
            aria-expanded={!folded}
            aria-label={folded ? `Open question ${index + 1}` : `Fold question ${index + 1}`}
            className="rounded-lg p-1.5 text-ink-faint transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
          >
            {folded ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            onClick={onRemove}
            className="rounded-lg p-1.5 text-ink-faint transition-colors duration-150 hover:bg-danger-bg hover:text-danger"
            aria-label={`Remove question ${index + 1}`}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {!folded && (
        <div className="min-w-0 space-y-3.5 p-3.5">
          <textarea
            value={q.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Type the question…"
            aria-label={`Question ${index + 1} text`}
            className="textarea-base text-sm"
          />

          {/* A snippet the question is ABOUT. This is how coding and debugging are
              assessed: the candidate reads code and answers a closed question about
              it, so scoring stays a comparison rather than an execution - no
              sandbox, no per-run cost, and the same result every time. */}
          {q.code === undefined ? (
            <button
              type="button"
              onClick={() => onChange({ code: '' })}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink hover:underline"
            >
              <Code size={12} /> Show them some code with this question
            </button>
          ) : (
            <div>
              <label htmlFor={`code-${q.id}`} className="field-label">
                Code they read
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

          {/* A generated diagram. Read-only — it is drawn from a path, not typed,
              so there is nothing here to edit beyond removing it. */}
          {q.imageDataUrl && (
            <div className="overflow-hidden rounded-lg border border-border">
              <img src={q.imageDataUrl} alt="Diagram for this question" className="block w-full max-w-sm" />
              <button
                type="button"
                onClick={() => onChange({ imageDataUrl: undefined })}
                className="w-full border-t border-border bg-surface-sunk px-3 py-1.5 text-left text-xs font-medium text-ink-muted hover:text-danger"
              >
                Remove diagram
              </button>
            </div>
          )}

          {isMatch ? (
            /* Authored a ROW at a time, which is how a person thinks about a pairing
               - and the reason the server must never publish column B in this order:
               row-for-row is the answer. It shuffles the two columns independently
               and checks the result is not the pairing before sending it. */
            <div className="space-y-2">
              <p className="text-xs text-ink-muted">
                Write each pair on its own row. Candidates see the two columns shuffled.
              </p>
              <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                <span className="flex-1">Item</span>
                <span className="flex-1">Goes with</span>
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
                Add a pair
              </Button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
                <Lock size={11} className="text-ink-faint" />
                {isMulti ? 'Tick every right answer' : 'Tick the right answer'} — candidates never see which.
              </p>
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
              {/* Adding an answer is meaningless on a pairing, which has rows instead. */}
              <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={addOption} disabled={q.options.length >= 10}>
                Add option
              </Button>
            </div>
          )}

          {/* The two properties nobody has to set, kept below a rule so they read
              as extras rather than as more of the question. */}
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
            <div className="min-w-[10rem] flex-1">
              <span className="field-label">Topic — optional</span>
              <div className="relative">
                <Tag size={13} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  value={q.topic ?? ''}
                  onChange={(e) => onChange({ topic: e.target.value })}
                  placeholder="e.g. SQL — splits up the score report"
                  aria-label={`Question ${index + 1} topic`}
                  className="input-base h-9 w-full pl-8 text-xs"
                />
              </div>
            </div>
            {/* Driven by the assessment's own sections, so the only sections on
                offer are ones that exist. "No section" stays a real choice for
                anything not moved into one — Diagram Questions is the one
                exception that's always there, for the image-based question type. */}
            <div className="w-44">
              <span className="field-label">Which section</span>
              <select
                value={q.sectionId ?? ''}
                onChange={(e) => onChange({ sectionId: e.target.value || undefined })}
                aria-label={`Question ${index + 1} section`}
                className="input-base h-9 w-full text-xs"
              >
                <option value="">No section</option>
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name || 'Untitled section'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Shown as you author, not on save: a 40-question paper that fails on
              question 31 is a bad way to learn the rule. */}
          {fault && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
              <AlertTriangle size={13} /> {fault}
            </p>
          )}
        </div>
      )}
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
  /** The last state the server acknowledged, so "unsaved" is a fact, not a guess. */
  const [saved, setSaved] = useState<string | null>(null)
  const [genOpen, setGenOpen] = useState(false)
  // A separate open flag from `genOpen`: that one always creates a brand-new set.
  // This one appends the generated questions onto the set already being edited —
  // what makes "3 written by hand, 2 generated, in one paper" actually possible
  // instead of generation always starting a second, separate assessment.
  const [genAppendOpen, setGenAppendOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** Folded question ids. View state only — it never reaches the draft. */
  const [folded, setFolded] = useState<Set<string>>(new Set())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    if (!activeId && sets.data?.length) setActiveId(sets.data[0].id)
  }, [sets.data, activeId])
  useEffect(() => {
    const found = sets.data?.find((s) => s.id === activeId)
    if (found) {
      // Every set is normalised to carry both default sections the moment it's
      // opened — a legacy set authored before sections existed (or before the
      // Diagram section did) gets them here rather than staying an exception the
      // rest of the editor has to keep special-casing.
      const normalised = { ...structuredClone(found), ...withDefaultSections(found) }
      setDraft(normalised)
      setSaved(JSON.stringify(normalised))
      setFolded(new Set())
    }
  }, [activeId, sets.data])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['mcq-sets'] })

  // Every new assessment — blank, AI-generated, or from a template — gets a
  // starter diagram question the moment it's created, not as a separate step
  // somebody has to remember. Free to do this eagerly: it's a deterministic
  // render, not a model call, so there's no cost or review reason to hold it
  // back until asked for.
  const withStarterDiagram = async (questions: McqQuestion[]): Promise<McqQuestion[]> => {
    try {
      const r = await mcqSetsApi.generateDiagramQuestions(2)
      return [...questions, ...r.questions.map((q) => ({ ...q, sectionId: DIAGRAM_SECTION_ID }))]
    } catch {
      // A failed diagram render must not block creating the assessment itself —
      // "Add diagram questions" in the editor is still there as a retry.
      return questions
    }
  }

  const createGenerated = useMutation({
    mutationFn: async (paper: { name: string; questions: McqQuestion[] }) =>
      mcqSetsApi.create({ ...paper, questions: await withStarterDiagram(paper.questions) }),
    onSuccess: (s) => {
      invalidate(); setActiveId(s.id); setGenOpen(false)
      toast.success('Written — check every answer before you send it')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  /* A new set starts with one blank question rather than none: the server
     refuses an empty set, so an empty new set would be unsaveable the moment it
     appeared. */
  const create = useMutation({
    mutationFn: async () =>
      mcqSetsApi.create({ name: 'New assessment', questions: await withStarterDiagram([blankQuestion()]) }),
    onSuccess: (s) => { invalidate(); setActiveId(s.id); setNewOpen(false); toast.success('Assessment created') },
    onError: (e: Error) => toast.error(e.message),
  })
  const createFromTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      const t = MCQ_TEMPLATES.find((x) => x.id === templateId)
      if (!t) throw new Error('Template not found')
      // Cloned questions get fresh ids: two sets built from the same template must
      // not silently share option/question ids if one is later duplicated.
      const cloned = t.questions.map((q) => {
        const idMap = new Map(q.options.map((o) => [o.id, crypto.randomUUID().slice(0, 8)]))
        return {
          ...q,
          id: crypto.randomUUID(),
          options: q.options.map((o) => ({ ...o, id: idMap.get(o.id)! })),
          correctOptionIds: q.correctOptionIds.map((id) => idMap.get(id)!),
        }
      })
      return mcqSetsApi.create({ name: `${t.role} — MCQ`, questions: await withStarterDiagram(cloned) })
    },
    onSuccess: (s) => { invalidate(); setActiveId(s.id); setTemplatesOpen(false); toast.success('Template added — review before you save') },
    onError: (e: Error) => toast.error(e.message),
  })
  const duplicate = useMutation({
    mutationFn: (id: string) => mcqSetsApi.duplicate(id),
    onSuccess: (s) => { invalidate(); setActiveId(s.id); toast.success('Copy made') },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => mcqSetsApi.remove(id),
    onSuccess: () => {
      invalidate(); setActiveId(null); setDraft(null); setSaved(null); setConfirmDelete(false)
      toast.success('Assessment deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const save = useMutation({
    mutationFn: () =>
      mcqSetsApi.update(draft!.id, {
        name: draft!.name,
        sections: draft!.sections ?? [],
        questions: draft!.questions,
      }),
    onSuccess: () => {
      if (draft) setSaved(JSON.stringify(draft))
      invalidate(); toast.success('Assessment saved')
    },
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

  const toggleFold = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const faults = draft?.questions.filter((q) => faultOf(q) !== null).length ?? 0
  const totalPoints = draft?.questions.reduce((sum, q) => sum + (q.points ?? 1), 0) ?? 0
  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== saved
  const allFolded = draft !== null && draft.questions.length > 0 && draft.questions.every((q) => folded.has(q.id))

  /* A question you just asked for arrives open, whatever the rest of the paper is
     doing — its id is new, so it is not in the folded set, and "Fold all" flips
     back to "Open all" of its own accord. */
  const addQuestion = () => {
    if (!draft) return
    setDraft({ ...draft, questions: [...draft.questions, blankQuestion()] })
  }

  // Generated questions land at the end of the CURRENT draft, unsaved — same as
  // "Add question" — so they sit alongside whatever was already written by hand,
  // get reviewed and edited like any other question, and go out in one Save.
  const appendGenerated = (_name: string, questions: McqQuestion[]) => {
    if (!draft) return
    setDraft({ ...draft, questions: [...draft.questions, ...questions] })
    setGenAppendOpen(false)
    toast.success(`${questions.length} question${questions.length === 1 ? '' : 's'} added — check every answer before you save`)
  }

  // Deterministic — no model call, so no review-before-save ceremony is needed:
  // the answer key is computed from the same path the diagram is drawn from,
  // never guessed by anything that could disagree with its own picture.
  const generateDiagrams = useMutation({
    mutationFn: (count: number) => mcqSetsApi.generateDiagramQuestions(count),
    onSuccess: (r) => {
      if (!draft) return
      const withSection = r.questions.map((q) => ({ ...q, sectionId: DIAGRAM_SECTION_ID }))
      setDraft({ ...draft, questions: [...draft.questions, ...withSection] })
      toast.success(`${r.questions.length} diagram question${r.questions.length === 1 ? '' : 's'} added to Diagram Questions`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Page>
      <GenerateMcqModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        onGenerated={(name, questions) => createGenerated.mutate({ name, questions })}
      />
      <GenerateMcqModal
        open={genAppendOpen}
        onClose={() => setGenAppendOpen(false)}
        onGenerated={appendGenerated}
      />
      <TemplateGalleryModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onPick={(id) => createFromTemplate.mutate(id)}
      />
      <NewAssessmentModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onBlank={() => create.mutate()}
        onGenerate={() => { setNewOpen(false); setGenOpen(true) }}
        onTemplate={() => { setNewOpen(false); setTemplatesOpen(true) }}
      />

      <PageHeader
        title="Assessments"
        description="Tests that mark themselves. Ask people to pick one answer, pick several, or match things up — they are scored the second they hit submit, with no AI and no waiting. The answers you tick stay with us and never reach a candidate's browser."
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
              <Button
                className="w-full"
                icon={<Plus size={15} />}
                loading={create.isPending || createGenerated.isPending || createFromTemplate.isPending}
                onClick={() => setNewOpen(true)}
              >
                New assessment
              </Button>
            </div>

            <div className="mt-7 flex items-baseline justify-between px-1">
              <span className="section-label">Your assessments</span>
              <span className="text-xs font-semibold tabular-nums text-ink-faint">{(sets.data ?? []).length}</span>
            </div>

            {(sets.data ?? []).length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-rule-strong bg-surface-sunk px-4 py-5 text-center text-xs leading-relaxed text-ink-muted">
                Nothing here yet. Make one above — only you can see these, because they hold the answers.
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
                      {s.ready === false && <span className="text-warn"> · not finished</span>}
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
                title="Nothing open yet"
                description="Pick one on the left, or make a new one. Each question needs two or more answers and at least one of them ticked as right."
                action={<Button size="sm" icon={<Plus size={14} />} onClick={() => setNewOpen(true)}>New assessment</Button>}
              />
            </Card>
          ) : (
            <Card className="p-0">
              {/* Sticky, because a forty-question paper is a long scroll and Save
                  used to disappear off the top of it the moment you started
                  working. The name, the running totals and what is left to finish
                  now stay on screen the whole time. */}
              <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 rounded-t-[inherit] border-b border-border bg-surface/95 px-4 py-3 backdrop-blur lg:top-4">
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  aria-label="Set name"
                  placeholder="Name this assessment"
                  className="input-base h-9 max-w-xs flex-1 text-sm font-semibold"
                />
                <Badge>{draft.questions.length} question{draft.questions.length === 1 ? '' : 's'}</Badge>
                <Badge>{totalPoints} point{totalPoints === 1 ? '' : 's'}</Badge>
                {faults > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-warn">
                    <AlertTriangle size={13} /> {faults} question{faults === 1 ? '' : 's'} to finish
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok">
                    <Check size={13} /> Ready to send
                  </span>
                )}
                {dirty && <Badge variant="warning">Unsaved</Badge>}

                <div className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="outline" icon={<Copy size={14} />} loading={duplicate.isPending} onClick={() => duplicate.mutate(draft.id)}>
                    Make a copy
                  </Button>
                  {/* Asked first. This used to delete a whole paper on one click,
                      with nothing between the pointer and an hour of work. */}
                  <Button size="sm" variant="outline" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)}>
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

              <div className="space-y-4 p-4">
                <SectionsPanel
                  sections={draft.sections ?? []}
                  questionCounts={sectionCounts}
                  onChange={(sections) => setDraft({ ...draft, sections })}
                />

                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="section-label">Questions</span>
                    <span className="text-xs font-semibold tabular-nums text-ink-faint">
                      {draft.questions.length}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      {draft.questions.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={allFolded ? <UnfoldVertical size={13} /> : <FoldVertical size={13} />}
                          onClick={() =>
                            setFolded(allFolded ? new Set() : new Set(draft.questions.map((q) => q.id)))
                          }
                        >
                          {allFolded ? 'Open all' : 'Fold all'}
                        </Button>
                      )}
                    </span>
                  </div>

                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={draft.questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {draft.questions.map((q, i) => (
                          <SortableMcq
                            key={q.id}
                            q={q}
                            index={i}
                            sections={draft.sections ?? []}
                            folded={folded.has(q.id)}
                            onFold={() => toggleFold(q.id)}
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

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      icon={<ListPlus size={15} />}
                      onClick={addQuestion}
                    >
                      Add question
                    </Button>
                    <Button
                      variant="outline"
                      icon={<Sparkles size={15} />}
                      onClick={() => setGenAppendOpen(true)}
                    >
                      Add AI-generated questions
                    </Button>
                    <Button
                      variant="outline"
                      icon={<ImageIcon size={15} />}
                      loading={generateDiagrams.isPending}
                      onClick={() => generateDiagrams.mutate(3)}
                    >
                      Add diagram questions
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => draft && remove.mutate(draft.id)}
        busy={remove.isPending}
        title="Delete this assessment?"
        confirmLabel="Delete it"
        body={
          <>
            <strong className="text-ink">{draft?.name || 'This assessment'}</strong> and all{' '}
            {draft?.questions.length ?? 0} of its questions will be gone for good. Anyone already
            sitting it keeps the copy they were sent.
          </>
        }
      />
    </Page>
  )
}

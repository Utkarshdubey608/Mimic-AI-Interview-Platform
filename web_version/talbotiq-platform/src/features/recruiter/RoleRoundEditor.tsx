import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GripVertical, Plus, Trash2, Copy, AlertCircle } from 'lucide-react'
import { Button, Input, Select, cn } from '@/components/ui'
import { questionSetsApi } from '@/lib/api'
import type { RoleRoundSpec, RoundKind, MixedConfig, QuestionSet } from '@shared/types'

/** Segmented pill group — one row of mutually exclusive choices. Mirrors the
 *  pattern in InviteWizard.tsx (kept local here rather than shared, since
 *  neither file exports it). */
function Segmented({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-full bg-surface-hover p-1" role="group" aria-label={label}>
      {children}
    </div>
  )
}
const segItem = (selected: boolean) => cn(
  'flex-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-semibold transition-all duration-150',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1',
  selected ? 'bg-action text-action-ink shadow-primary-sm' : 'text-ink-muted hover:text-ink',
)

/**
 * A `RoleRoundSpec` being edited client-side, keyed by a stable client id (not
 * persisted; `order` is derived on submit). Mirrors `RoundDraft` in
 * RoundBuilder.tsx for the OLDER `web_pipelines` system — deliberately a
 * separate type, since this one is shaped around `RoleRoundSpec`/`RoleConfig`.
 */
export interface RoleRoundDraft extends RoleRoundSpec {
  _id: string
}

const KIND_OPTIONS: { value: RoundKind; label: string }[] = [
  { value: 'resume', label: 'Résumé' },
  { value: 'chat', label: 'Chat' },
  { value: 'video', label: 'Video' },
  { value: 'voice', label: 'Voice' },
  { value: 'two_way', label: 'Two-way' },
]

type SourceKind = 'tailor' | 'set' | 'mixed'

let seq = 0
function makeId(): string {
  return `rr${Date.now()}-${seq++}`
}

function newDraft(order: number): RoleRoundDraft {
  return { _id: makeId(), order, title: `Round ${order + 1}`, kind: 'chat', config: { source: 'tailor' } }
}

export function defaultRoleRounds(): RoleRoundDraft[] {
  return [
    { ...newDraft(0), title: 'Screening' },
    { ...newDraft(1), title: 'Technical' },
  ]
}

/** Give each loaded `RoleRoundSpec` a fresh client id for the editor. */
export function toRoleRoundDrafts(rounds: RoleRoundSpec[]): RoleRoundDraft[] {
  return rounds.map((r) => ({ ...r, _id: makeId() }))
}

/** Strip client ids, reindex `order` 0..n, for the save payload. */
export function toRoleRoundSpecs(drafts: RoleRoundDraft[]): RoleRoundSpec[] {
  return drafts.map((d, order) => {
    const { _id, ...rest } = d
    return { ...rest, order }
  })
}

/**
 * A résumé round is a submission step, not a session with questions; a two-way
 * round is a live recruiter-led call. Neither has a scripted question source —
 * mirrors the backend's own exclusion in `resolve_question_source`.
 */
export function hasQuestionSource(kind: RoundKind): boolean {
  return kind !== 'two_way' && kind !== 'resume'
}

const DEFAULT_MIXED: MixedConfig = { totalQuestions: 8, fixedQuestionCount: 5, resumeQuestionCount: 3 }

/** Whether a round's own configuration is complete enough to save. */
export function roundConfigValid(draft: RoleRoundDraft): boolean {
  if (!hasQuestionSource(draft.kind)) return true
  const source = (draft.config.source as SourceKind | undefined) ?? 'tailor'
  if (source === 'tailor') return true
  if (source === 'set') return !!draft.config.questionSetId
  if (source === 'mixed') {
    const mc = draft.config.mixedConfig as MixedConfig | undefined
    if (!mc) return false
    const addsUp = mc.fixedQuestionCount >= 0 && mc.resumeQuestionCount >= 0
      && mc.fixedQuestionCount + mc.resumeQuestionCount === mc.totalQuestions
    const setOk = mc.fixedQuestionCount > 0 ? !!mc.questionSetId : true
    return addsUp && setOk
  }
  return false
}

/** Question-source config for one round: Adapt to résumé / Question set / Mixed. */
function RoundConfigFields({
  draft, onConfigChange, questionSets,
}: {
  draft: RoleRoundDraft
  onConfigChange: (config: Record<string, unknown>) => void
  questionSets: { isLoading: boolean; data?: QuestionSet[] }
}) {
  const source = (draft.config.source as SourceKind | undefined) ?? 'tailor'
  const questionSetId = (draft.config.questionSetId as string | undefined) ?? ''
  const mixed = (draft.config.mixedConfig as MixedConfig | undefined) ?? DEFAULT_MIXED

  const setSource = (s: SourceKind) => {
    if (s === 'tailor') onConfigChange({ source: 'tailor' })
    else if (s === 'set') onConfigChange({ source: 'set', questionSetId })
    else onConfigChange({ source: 'mixed', mixedConfig: mixed })
  }
  const setMixed = (patch: Partial<MixedConfig>) => onConfigChange({ source: 'mixed', mixedConfig: { ...mixed, ...patch } })

  const addsUp = mixed.fixedQuestionCount >= 0 && mixed.resumeQuestionCount >= 0
    && mixed.fixedQuestionCount + mixed.resumeQuestionCount === mixed.totalQuestions

  return (
    <div className="space-y-3 rounded-xl border border-rule bg-surface-sunk p-3.5">
      <div>
        <label className="field-label mb-1.5 block">Question source</label>
        <Segmented label="Question source">
          <button type="button" onClick={() => setSource('tailor')} aria-pressed={source === 'tailor'} className={segItem(source === 'tailor')}>Adapt to résumé</button>
          <button type="button" onClick={() => setSource('set')} aria-pressed={source === 'set'} className={segItem(source === 'set')}>Question set</button>
          <button type="button" onClick={() => setSource('mixed')} aria-pressed={source === 'mixed'} className={segItem(source === 'mixed')}>Mixed</button>
        </Segmented>
      </div>

      {source === 'set' && (
        <Select
          label="Question set"
          value={questionSetId}
          onChange={(e) => onConfigChange({ source: 'set', questionSetId: e.target.value })}
          placeholder={questionSets.isLoading ? 'Loading…' : 'Choose a question set'}
          options={(questionSets.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.questions.length})` }))}
        />
      )}

      {source === 'mixed' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2.5">
            <Input label="Total" type="number" min={1} max={25} value={mixed.totalQuestions}
              onChange={(e) => setMixed({ totalQuestions: Math.max(1, Number(e.target.value) || 0) })} />
            <Input label="Fixed" type="number" min={0} max={25} value={mixed.fixedQuestionCount}
              onChange={(e) => setMixed({ fixedQuestionCount: Math.max(0, Number(e.target.value) || 0) })} />
            <Input label="Résumé-based" type="number" min={0} max={25} value={mixed.resumeQuestionCount}
              onChange={(e) => setMixed({ resumeQuestionCount: Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          {!addsUp ? (
            <p className="flex items-start gap-2 rounded-lg border border-danger-border bg-danger-bg p-2.5 text-xs leading-relaxed text-danger">
              <AlertCircle size={13} className="mt-px flex-shrink-0" />
              Fixed ({mixed.fixedQuestionCount}) + résumé-based ({mixed.resumeQuestionCount}) must add up to the total ({mixed.totalQuestions}).
            </p>
          ) : (
            <p className="rounded-lg border border-rule bg-surface p-2.5 text-xs text-ink-muted">
              <span className="font-semibold text-ink">Question flow — </span>
              {mixed.fixedQuestionCount > 0 && <>1–{mixed.fixedQuestionCount} fixed{mixed.resumeQuestionCount > 0 ? ', ' : ''}</>}
              {mixed.resumeQuestionCount > 0 && <>{mixed.fixedQuestionCount + 1}–{mixed.totalQuestions} résumé-adapted</>}
              {mixed.fixedQuestionCount === 0 && mixed.resumeQuestionCount === 0 && 'No questions configured yet.'}
            </p>
          )}
          {mixed.fixedQuestionCount > 0 && (
            <Select
              label="Fixed portion — question set"
              value={mixed.questionSetId ?? ''}
              onChange={(e) => setMixed({ questionSetId: e.target.value || undefined })}
              placeholder={questionSets.isLoading ? 'Loading…' : 'Choose a question set'}
              options={(questionSets.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.questions.length})` }))}
              hint={`The first ${mixed.fixedQuestionCount} question${mixed.fixedQuestionCount === 1 ? '' : 's'} of the set become the fixed portion.`}
            />
          )}
        </div>
      )}
    </div>
  )
}

function RoundCard({
  draft, n, onChange, onRemove, onDuplicate, canRemove, questionSets,
}: {
  draft: RoleRoundDraft
  n: number
  onChange: (p: Partial<RoleRoundDraft>) => void
  onRemove: () => void
  onDuplicate: () => void
  canRemove: boolean
  questionSets: { isLoading: boolean; data?: QuestionSet[] }
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: draft._id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 10 : undefined }
  const kindLabel = KIND_OPTIONS.find((k) => k.value === draft.kind)?.label
  const valid = roundConfigValid(draft) && draft.title.trim().length > 0

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-2xl border bg-surface p-4 transition-shadow duration-150',
        isDragging ? 'border-rule-strong shadow-lg' : 'border-border shadow-xs',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-shrink-0 flex-col items-center gap-1.5 pt-0.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-hover text-sm font-bold tabular-nums text-ink">
            {n}
          </span>
          <button
            {...attributes} {...listeners}
            className="cursor-grab touch-none rounded-lg p-1 text-ink-disabled transition-colors duration-150 hover:bg-surface-hover hover:text-ink-muted active:cursor-grabbing"
            aria-label={`Drag to reorder round ${n}`}
          >
            <GripVertical size={15} />
          </button>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">Round {n}</span>
              {kindLabel && <span className="badge badge-info">{kindLabel}</span>}
              {!valid && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-danger">
                  <AlertCircle size={11} /> Incomplete
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button" onClick={onDuplicate} aria-label={`Duplicate round ${n}`}
                className="rounded-lg p-1.5 text-ink-faint transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
              >
                <Copy size={14} />
              </button>
              {canRemove && (
                <button
                  type="button" onClick={onRemove} aria-label={`Remove round ${n}`}
                  className="rounded-lg p-1.5 text-ink-faint transition-colors duration-150 hover:bg-danger-bg hover:text-danger"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>

          <Input
            label="Round title" value={draft.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="e.g. Technical"
          />
          <Select
            label="Mode" value={draft.kind} options={KIND_OPTIONS}
            onChange={(e) => {
              const kind = e.target.value as RoundKind
              onChange({ kind, config: hasQuestionSource(kind) ? { source: 'tailor' } : {} })
            }}
          />

          {hasQuestionSource(draft.kind) && (
            <RoundConfigFields
              draft={draft}
              onConfigChange={(config) => onChange({ config })}
              questionSets={questionSets}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function RoleRoundEditor({ rounds, onChange }: { rounds: RoleRoundDraft[]; onChange: (r: RoleRoundDraft[]) => void }) {
  const questionSets = useQuery({ queryKey: ['question-sets'], queryFn: questionSetsApi.list })
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = rounds.findIndex((r) => r._id === e.active.id)
    const to = rounds.findIndex((r) => r._id === e.over!.id)
    onChange(arrayMove(rounds, from, to))
  }
  const update = (id: string, p: Partial<RoleRoundDraft>) => onChange(rounds.map((r) => (r._id === id ? { ...r, ...p } : r)))
  const duplicate = (id: string) => {
    const idx = rounds.findIndex((r) => r._id === id)
    if (idx === -1) return
    const clone: RoleRoundDraft = { ...rounds[idx], _id: makeId(), title: `${rounds[idx].title} (copy)` }
    const next = [...rounds]
    next.splice(idx + 1, 0, clone)
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rounds.map((r) => r._id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {rounds.map((r, i) => (
              <RoundCard
                key={r._id}
                draft={r}
                n={i + 1}
                canRemove={rounds.length > 1}
                onChange={(p) => update(r._id, p)}
                onRemove={() => onChange(rounds.filter((x) => x._id !== r._id))}
                onDuplicate={() => duplicate(r._id)}
                questionSets={questionSets}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button variant="outline" size="sm" icon={<Plus size={15} />} onClick={() => onChange([...rounds, newDraft(rounds.length)])}>
        Add round
      </Button>
    </div>
  )
}

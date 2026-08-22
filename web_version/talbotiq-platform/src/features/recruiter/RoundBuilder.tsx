import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Select, cn } from '@/components/ui'
import type { RoundDef, TrackType } from '@shared/types'

/** A RoundDef being edited client-side, keyed by a stable client id (not persisted; `index` is derived on submit). */
export interface RoundDraft extends Omit<RoundDef, 'index'> { _id: string }

const ROUND_MODES: { value: TrackType; label: string }[] = [
  { value: 'chatbot', label: 'Chatbot' },
  { value: 'voice', label: 'Voice' },
  { value: 'video_avatar', label: 'Video Avatar' },
  { value: 'chat', label: 'Timed Q&A' },
  { value: 'video', label: 'Video Interview' },
]

let seq = 0
const newDraft = (name: string): RoundDraft => ({ _id: `r${Date.now()}-${seq++}`, name, mode: 'chatbot', source: 'tailor' })

export function defaultRounds(): RoundDraft[] {
  return [newDraft('Screening'), newDraft('Technical'), newDraft('Final')]
}

/** Strip client ids, reindex 0..n. */
export function toRoundDefs(drafts: RoundDraft[]): RoundDef[] {
  return drafts.map((d, index) => {
    const { _id, ...rest } = d
    return { ...rest, index }
  })
}

function RoundCard({ d, n, onChange, onRemove, canRemove }: {
  d: RoundDraft; n: number; onChange: (p: Partial<RoundDraft>) => void; onRemove: () => void; canRemove: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: d._id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 10 : undefined }
  const modeLabel = ROUND_MODES.find((m) => m.value === d.mode)?.label
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
        {/* Order rail */}
        <div className="flex flex-shrink-0 flex-col items-center gap-1.5 pt-0.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-hover text-sm font-bold tabular-nums text-ink">
            {n}
          </span>
          <button
            {...attributes} {...listeners}
            className="cursor-grab touch-none rounded-lg p-1 text-ink-disabled transition-colors duration-150 hover:bg-surface-hover hover:text-ink-muted active:cursor-grabbing"
            aria-label="Drag to reorder round"
          >
            <GripVertical size={15} />
          </button>
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">Round {n}</span>
              {modeLabel && <span className="badge badge-info">{modeLabel}</span>}
            </div>
            {canRemove && (
              <button
                type="button" onClick={onRemove} aria-label={`Remove round ${n}`}
                className="rounded-lg p-1.5 text-ink-faint transition-colors duration-150 hover:bg-danger-bg hover:text-danger"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
          <Input label="Round name" value={d.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Technical" />
          <Select label="Mode" value={d.mode} options={ROUND_MODES} onChange={(e) => onChange({ mode: e.target.value as TrackType })} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Advance rule" value={d.advanceRule?.kind ?? ''} options={[{ value: '', label: 'None' }, { value: 'threshold', label: 'Score ≥' }, { value: 'topN', label: 'Top N' }]}
              onChange={(e) => onChange({ advanceRule: e.target.value ? { kind: e.target.value as 'threshold' | 'topN', value: d.advanceRule?.value ?? (e.target.value === 'threshold' ? 60 : 5) } : undefined })} />
            {d.advanceRule && (
              <Input label="Value" type="number" value={d.advanceRule.value}
                onChange={(e) => onChange({ advanceRule: { kind: d.advanceRule!.kind, value: Number(e.target.value) || 0 } })} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function RoundBuilder({ rounds, onChange }: { rounds: RoundDraft[]; onChange: (r: RoundDraft[]) => void }) {
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
  const update = (id: string, p: Partial<RoundDraft>) => onChange(rounds.map((r) => (r._id === id ? { ...r, ...p } : r)))
  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rounds.map((r) => r._id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {rounds.map((r, i) => (
              <RoundCard key={r._id} d={r} n={i + 1} canRemove={rounds.length > 1}
                onChange={(p) => update(r._id, p)} onRemove={() => onChange(rounds.filter((x) => x._id !== r._id))} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Button variant="outline" size="sm" icon={<Plus size={15} />} onClick={() => onChange([...rounds, newDraft(`Round ${rounds.length + 1}`)])}>
        Add round
      </Button>
    </div>
  )
}

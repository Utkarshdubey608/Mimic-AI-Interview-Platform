import { useState } from 'react'
import { Modal, Button, Input, cn } from '@/components/ui'
import type { McqSectionType } from '@shared/types'
import { SECTION_TYPES, TARGET_COUNT_PRESETS } from './mcqSectionTypes'

/**
 * The recruiter picks a TYPE, a NAME, and a target question count — the
 * three things `mcqSections.ts`/`mcq_authoring.SECTION_TYPES` need to start
 * a section. Fast and small on purpose (product spec: "avoid a huge
 * complicated form") — everything else about a section (instructions, a
 * reading passage) is edited afterwards, in the section's own drawer.
 */
export function AddSectionModal({
  open, onClose, onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (section: { name: string; sectionType: McqSectionType; targetQuestionCount: number }) => void
}) {
  const [type, setType] = useState<McqSectionType>('custom')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [target, setTarget] = useState(10)
  const [customTarget, setCustomTarget] = useState('')

  const reset = () => {
    setType('custom'); setName(''); setNameTouched(false); setTarget(10); setCustomTarget('')
  }
  const close = () => { reset(); onClose() }

  const pick = (id: McqSectionType) => {
    setType(id)
    // Fill the name from the type as a convenience, but only while the
    // recruiter hasn't typed their own — once they touch the field, their
    // wording wins even if they then pick a different type.
    if (!nameTouched) setName(SECTION_TYPES.find((t) => t.id === id)?.label ?? '')
  }

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onAdd({ name: trimmed, sectionType: type, targetQuestionCount: Math.max(0, Math.min(200, target)) })
    close()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add section"
      width="max-w-lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={close}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={!name.trim()}>Add section</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="field-label">Section type</span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {SECTION_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => pick(t.id)}
                className={cn(
                  'rounded-lg border p-2.5 text-left transition-colors',
                  type === t.id
                    ? 'border-action bg-surface-hover/60 ring-1 ring-signal'
                    : 'border-border hover:border-rule-strong',
                )}
              >
                <span className="block text-sm font-semibold text-ink">{t.label}</span>
                <span className="mt-0.5 block text-xs text-ink-muted">{t.description}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => pick('custom')}
              className={cn(
                'rounded-lg border p-2.5 text-left transition-colors',
                type === 'custom'
                  ? 'border-action bg-surface-hover/60 ring-1 ring-signal'
                  : 'border-border hover:border-rule-strong',
              )}
            >
              <span className="block text-sm font-semibold text-ink">Custom</span>
              <span className="mt-0.5 block text-xs text-ink-muted">A section of your own</span>
            </button>
          </div>
        </div>

        <Input
          label="Section name"
          value={name}
          onChange={(e) => { setName(e.target.value); setNameTouched(true) }}
          placeholder="e.g. Aptitude"
        />

        <div>
          <div className="flex items-baseline justify-between">
            <span className="field-label mb-0">Target questions</span>
            <span className="text-xs text-ink-muted">You can change this later</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {TARGET_COUNT_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => { setTarget(n); setCustomTarget('') }}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                  target === n && !customTarget
                    ? 'border-action bg-action text-action-ink'
                    : 'border-rule bg-surface-hover text-ink hover:border-rule-strong',
                )}
              >
                {n}
              </button>
            ))}
            <input
              type="number"
              min={0}
              max={200}
              value={customTarget}
              onChange={(e) => {
                setCustomTarget(e.target.value)
                const n = Number(e.target.value)
                if (e.target.value && !Number.isNaN(n)) setTarget(Math.max(0, Math.min(200, n)))
              }}
              placeholder="Custom"
              aria-label="Custom target question count"
              className="input-base h-7 w-20 text-xs"
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}

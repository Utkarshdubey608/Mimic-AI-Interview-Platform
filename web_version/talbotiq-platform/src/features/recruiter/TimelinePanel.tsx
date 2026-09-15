import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Button, Select, cn } from '@/components/ui'
import { roundsApi, describeFetchError } from '@/lib/api'
import type { RoundKind } from '@shared/types'
import { DOT_TONE, KINDS } from './roundKinds'

/**
 * The pieces a rounds timeline is drawn from.
 *
 * This file used to own the whole surface — its own Card, its own queries, its own
 * mutations — and `RoundsModal` rendered it next to the decision. That split was the
 * problem the merge set out to fix: the stages and the decision are one thing read top
 * to bottom, and a recruiter deciding a round has to be able to see who is IN it.
 * Candidates live on the sessions list, which only `RoundsModal` has, so the stage
 * nodes cannot be assembled here.
 *
 * So this is now presentation and one small form. `RoundsModal` owns the data.
 */

/**
 * One step on the rail.
 *
 * The connecting line is a pseudo-element rather than an element, so the last node
 * hides it with `last:before:hidden` and nothing has to be told how many siblings it
 * has — a list that renders its own tail is a list that draws a line into nothing the
 * first time a caller appends to it.
 */
export function TimelineNode({
  tone, icon, title, chip, meta, actions, children,
}: {
  tone: keyof typeof DOT_TONE
  icon: React.ReactNode
  title: React.ReactNode
  chip?: React.ReactNode
  meta?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <li
      className={cn(
        'relative flex gap-3.5 pb-5 last:pb-0',
        'before:absolute before:left-[13px] before:top-8 before:bottom-0 before:w-px before:bg-rule',
        'last:before:hidden',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative z-10 mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border',
          DOT_TONE[tone],
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-ink">{title}</span>
          {chip}
          {actions ? <span className="ml-auto flex flex-shrink-0 gap-2">{actions}</span> : null}
        </div>
        {meta ? <div className="mt-0.5 text-xs leading-relaxed text-ink-muted">{meta}</div> : null}
        {children}
      </div>
    </li>
  )
}

/**
 * Adding a stage, inline on the rail.
 *
 * This was a Modal, and it could not stay one: `RoundsModal` renders this timeline
 * INSIDE itself, and framer-motion leaves a `transform` on the dialog panel it
 * animates. A transformed ancestor becomes the containing block for `position:
 * fixed`, so a nested modal would have been clipped to the panel it was trying to
 * cover — and two focus traps would have been fighting over the same Escape key.
 *
 * It also reads better: everything else on this rail expands in place, so this does
 * too.
 */
export function AddStageForm({
  testId, onCreated, onCancel,
}: {
  testId: string
  onCreated: () => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<RoundKind>('chat')
  const [closesAt, setClosesAt] = useState('')

  const create = useMutation({
    mutationFn: () =>
      roundsApi.create(testId, {
        title: title.trim(),
        kind,
        // Sent as an instant, not a date string: the server refuses anything it cannot
        // parse rather than dropping it, because a deadline that silently vanished
        // reads as a round that never closes.
        closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      }),
    onSuccess: () => {
      toast.success('Stage added.')
      setTitle('')
      setClosesAt('')
      onCreated()
    },
    onError: (e) => toast.error(describeFetchError(e, 'Could not add the stage.')),
  })

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-border bg-surface-sunk/50 p-3.5">
      <label className="block">
        <span className="field-label mb-1.5 block">Call it</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) create.mutate() }}
          placeholder="e.g. Technical screen"
          className="input-base"
          autoFocus
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="field-label mb-1.5 block">What happens in it</span>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as RoundKind)}
            options={KINDS.map((k) => ({ value: k.id, label: k.label }))}
          />
          <p className="mt-1 text-xs text-ink-muted">{KINDS.find((k) => k.id === kind)?.hint}</p>
        </label>

        <label className="block">
          <span className="field-label mb-1.5 block">
            Closes <span className="font-normal normal-case tracking-normal text-ink-faint">(optional)</span>
          </span>
          <input
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
            className="input-base"
          />
          <p className="mt-1 text-xs text-ink-muted">
            {/* The deadline is what a candidate's device actually gates on, once it is
                copied down onto their assignment. */}
            Leave it empty to keep it open until you end it yourself.
          </p>
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button
          size="sm"
          onClick={() => create.mutate()}
          loading={create.isPending}
          disabled={!title.trim() || create.isPending}
        >
          Add stage
        </Button>
      </div>
    </div>
  )
}

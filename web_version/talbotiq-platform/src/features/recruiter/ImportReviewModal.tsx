import { useEffect, useState } from 'react'
import { Modal, Button, Badge, cn } from '@/components/ui'
import type { McqQuestion } from '@shared/types'

export interface ImportReviewResult {
  valid: { row: number; question: McqQuestion }[]
  needsReview: { row: number; question: McqQuestion; reason: string }[]
  rejected: { row: number; reason: string; text?: string }[]
}

/**
 * The mandatory stop between "a file was uploaded" and "questions are in the
 * section" — nothing here is auto-imported. `valid` and `needsReview` rows
 * are both INCLUDED by default (checked) because saving is permissive here
 * too: a `needsReview` question (usually an unresolved correct answer) still
 * imports, still shows up in the section ready to be fixed like any other
 * draft question — the recruiter excludes a row only if they actually don't
 * want it, not merely because it isn't finished yet.
 */
export function ImportReviewModal({
  open, onClose, result, onConfirm,
}: {
  open: boolean
  onClose: () => void
  result: ImportReviewResult | null
  onConfirm: (questions: McqQuestion[]) => void
}) {
  const rows: { row: number; question: McqQuestion; reason?: string }[] = [
    ...(result?.valid ?? []),
    ...(result?.needsReview ?? []),
  ]
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  useEffect(() => { setExcluded(new Set()) }, [result])

  if (!result) return null

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const included = rows.filter((r) => !excluded.has(r.question.id))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Review imported questions"
      description={
        rows.length > 0
          ? `${rows.length} question${rows.length === 1 ? '' : 's'} extracted — review before adding them to the section.`
          : 'Nothing usable came back from that file.'
      }
      width="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => onConfirm(included.map((r) => r.question))} disabled={included.length === 0}>
            Add {included.length} question{included.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">{result.valid.length} valid</Badge>
          {result.needsReview.length > 0 && (
            <Badge variant="warning">{result.needsReview.length} need review</Badge>
          )}
          {result.rejected.length > 0 && <Badge variant="danger">{result.rejected.length} rejected</Badge>}
        </div>

        {rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((r) => {
              const isExcluded = excluded.has(r.question.id)
              const reason = r.reason
              return (
                <li
                  key={r.question.id}
                  className={cn(
                    'rounded-lg border p-3',
                    isExcluded ? 'border-border bg-surface-sunk opacity-60' : reason ? 'border-warn-rule bg-warn-bg/40' : 'border-border',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={!isExcluded}
                      onChange={() => toggle(r.question.id)}
                      aria-label={isExcluded ? `Include row ${r.row}` : `Exclude row ${r.row}`}
                      className="mt-1 h-4 w-4 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">
                        {r.question.text || <span className="text-ink-faint">No text</span>}
                      </p>
                      <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
                        {r.question.options.map((o) => (
                          <li
                            key={o.id}
                            className={r.question.correctOptionIds.includes(o.id) ? 'font-semibold text-ok' : undefined}
                          >
                            {o.text || <span className="italic text-ink-faint">blank</span>}
                          </li>
                        ))}
                      </ul>
                      {reason && <p className="mt-1.5 text-xs font-medium text-warn">{reason}</p>}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {result.rejected.length > 0 && (
          <div>
            <p className="section-label mb-1.5">Could not be imported</p>
            <ul className="space-y-1">
              {result.rejected.map((r) => (
                <li key={r.row} className="text-xs text-ink-muted">
                  Row {r.row}{r.text ? ` (${r.text})` : ''}: {r.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

import { LayoutTemplate, X } from 'lucide-react'
import { Button, cn } from '@/components/ui'
import { MCQ_TEMPLATES } from './mcqTemplates'

/**
 * A gallery of ready-made assessment starting points — the same idea as
 * picking a document template rather than starting from a blank page.
 *
 * Picking one hands the recruiter a real, editable, already-correct set of
 * questions in the normal editor — nothing here is final. It exists alongside
 * "New assessment" (blank) and "Generate with AI" (role + topics, AI-written)
 * as a third, zero-effort way in: no typing required at all.
 */
export function TemplateGalleryModal({
  open, onClose, onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (templateId: string) => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5" role="dialog" aria-modal="true" aria-labelledby="mcq-template-title">
      <button className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="mcq-template-title" className="flex items-center gap-2 text-lg font-bold text-ink">
              <LayoutTemplate size={18} className="text-ink-muted" />
              Start from a template
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              A ready-made set of real questions for a common role. Everything is
              editable afterwards — add, remove, or generate more into it.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-hover hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          {MCQ_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onPick(t.id)}
              className={cn(
                'rounded-xl border border-border bg-surface-sunk p-4 text-left transition-colors duration-150',
                'hover:border-rule-strong hover:bg-surface-hover/60',
              )}
            >
              <p className="text-sm font-bold text-ink">{t.role}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{t.blurb}</p>
              <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                {t.questions.length} questions
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

import { Sparkles, LayoutTemplate, FilePlus, X } from 'lucide-react'
import { cn } from '@/components/ui'

/**
 * The one entry point for starting an assessment. Three ways in, one door —
 * blank, AI-generated, or a template — rather than three competing buttons in
 * the rail that each looked like a separate feature.
 */
export function NewAssessmentModal({
  open, onClose, onBlank, onGenerate, onTemplate,
}: {
  open: boolean
  onClose: () => void
  onBlank: () => void
  onGenerate: () => void
  onTemplate: () => void
}) {
  if (!open) return null

  const options = [
    { icon: FilePlus, title: 'Create your own', blurb: 'Start blank and write every question by hand.', onClick: onBlank },
    { icon: Sparkles, title: 'Generate with AI', blurb: 'Give a role and topics — questions come back for you to review.', onClick: onGenerate },
    { icon: LayoutTemplate, title: 'Use a template', blurb: 'A ready-made set of real questions for a common role.', onClick: onTemplate },
  ] as const

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-5" role="dialog" aria-modal="true" aria-labelledby="new-mcq-title">
      <button className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <h2 id="new-mcq-title" className="text-lg font-bold text-ink">New assessment</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-hover hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 space-y-2.5">
          {options.map(({ icon: Icon, title, blurb, onClick }) => (
            <button
              key={title}
              onClick={onClick}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border border-border bg-surface-sunk p-4 text-left transition-colors duration-150',
                'hover:border-rule-strong hover:bg-surface-hover/60',
              )}
            >
              <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-surface-hover text-ink">
                <Icon size={17} strokeWidth={1.75} />
              </span>
              <span>
                <span className="block text-sm font-bold text-ink">{title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

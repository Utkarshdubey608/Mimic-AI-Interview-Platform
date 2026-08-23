import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Mail, Maximize2, X } from 'lucide-react'
import { Button, cn } from '@/components/ui'
import { renderTransitionEmail, type TransitionRenderVars } from '@shared/inviteEmail'
import type { EmailKind, InviteEmailTemplate } from '@shared/types'

const EMAIL_WIDTH = 600 // the fixed email layout width (matches the shell)

export type TransitionEmailKind = Exclude<EmailKind, 'invite'>

/** One From / To / Subject row of the email-client chrome (mirrors the invite preview). */
function HeaderRow({ label, value, strong, size = 'sm' }: { label: string; value: string; strong?: boolean; size?: 'sm' | 'lg' }) {
  return (
    <div className={cn('flex items-baseline gap-3', size === 'lg' ? 'py-1' : 'py-[3px]')}>
      <span className={cn(
        'flex-shrink-0 font-bold uppercase tracking-[0.08em] text-ink-faint',
        size === 'lg' ? 'w-16 text-[11px]' : 'w-14 text-[10px]',
      )}>
        {label}
      </span>
      <span className={cn(
        'min-w-0 flex-1 truncate',
        size === 'lg' ? 'text-sm' : 'text-xs',
        strong ? 'font-semibold text-ink' : 'text-ink-body',
      )}>
        {value}
      </span>
    </div>
  )
}

/**
 * Kind-aware sibling of `EmailPreview` (invite-only) for the transition emails —
 * advance / selected / rejection. Uses the SAME shared renderer
 * (`renderTransitionEmail`) as the server send path, so what the recruiter previews
 * is exactly what goes out. Only 'advance' carries a locked interview link + "exact
 * email" note (see `renderTransitionEmail`'s `includeLink`/`includeNote` flags); for
 * 'selected'/'rejection' no link/candidate email is needed, so the caller passes none.
 *
 * Mirrors `EmailPreview`'s email-client chrome: a toolbar, From / To / Subject header
 * rows, and the scaled inline render (CSS zoom keeps the fixed 600px email legible
 * without clipping), plus an Outlook-style "Full preview" reading pane.
 */
export function TransitionEmailPreview({
  draft,
  kind,
  vars,
  candidateEmail,
  origin,
}: {
  draft: InviteEmailTemplate
  kind: TransitionEmailKind
  vars: TransitionRenderVars
  candidateEmail?: string
  origin?: string
}) {
  const [full, setFull] = useState(false)

  // advance is the only kind whose render needs a link + candidate email; a sample
  // is used for both since the real per-candidate values don't exist until send time.
  const sampleEmail = candidateEmail || `${(vars.candidate_name || 'candidate').toLowerCase().replace(/[^a-z0-9]+/g, '.')}@example.com`
  const sampleLink = `${origin || 'https://app.talbotiq.com'}/take/sample-next-round`

  let subject = '(no subject)'
  let html = '<p style="padding:20px;font-family:Archivo,Arial,sans-serif;font-size:13px;color:#B3261E">Preview unavailable — check the subject and body for an unclosed token.</p>'
  try {
    const rendered = renderTransitionEmail(
      draft, kind, vars,
      kind === 'advance' ? { interviewLink: sampleLink, candidateEmail: sampleEmail } : {},
    )
    subject = rendered.subject || '(no subject)'
    html = rendered.html
  } catch { /* keep fallback */ }

  const fromLine = draft.sender.verifiedSenderEmail
    ? `${draft.sender.fromName || ''} <${draft.sender.verifiedSenderEmail}>`.trim()
    : `${draft.sender.fromName || 'Mimic'} (server default sender)`
  const toLine = kind === 'advance' ? sampleEmail : 'Each recipient listed above'

  // Scale the fixed-width email to fit the inline column (CSS zoom keeps layout height).
  const boxRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setScale(Math.min(1, (el.clientWidth - 2) / EMAIL_WIDTH))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xs">
        {/* Client chrome — toolbar */}
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-sunk px-4 py-2">
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
            <Mail size={13} className="text-ink" /> Email preview
          </span>
          <Button
            size="xs" variant="ghost" onClick={() => setFull(true)}
            icon={<Maximize2 size={13} />}
            className="text-ink hover:bg-surface-hover hover:text-ink"
          >
            Full preview
          </Button>
        </div>

        {/* Client chrome — message headers */}
        <div className="border-b border-border bg-surface px-4 py-2.5">
          <HeaderRow label="From" value={fromLine} />
          <HeaderRow label="To" value={toLine} />
          <HeaderRow label="Subject" value={subject} strong />
        </div>

        {/* Scaled-to-fit inline render — the whole email, never clipped. */}
        <div ref={boxRef} className="max-h-[420px] overflow-y-auto overflow-x-hidden bg-surface-hover">
          <div style={{ zoom: scale }} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>

      {full && (
        <FullPreview
          html={html}
          from={fromLine}
          to={toLine}
          subject={subject}
          onClose={() => setFull(false)}
        />
      )}
    </>
  )
}

/** Outlook-style reading pane: From / To / Subject header + the email at natural size. */
function FullPreview({
  html, from, to, subject, onClose,
}: { html: string; from: string; to: string; subject: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-900/40 backdrop-blur-[2px] animate-fade-in" onClick={onClose}>
      <div className="mx-auto my-4 flex h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}>
        {/* Email client header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-lg font-extrabold tracking-[-0.02em] text-ink">{subject}</h3>
            <div className="mt-2.5 border-t border-border pt-2.5">
              <HeaderRow label="From" value={from} size="lg" />
              <HeaderRow label="To" value={to} size="lg" />
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close preview"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors duration-150 hover:bg-surface-hover hover:text-ink-body">
            <X size={18} />
          </button>
        </div>
        {/* Rendered email body, natural size, on the reading-pane canvas */}
        <div className="flex-1 overflow-auto bg-surface-hover">
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  )
}

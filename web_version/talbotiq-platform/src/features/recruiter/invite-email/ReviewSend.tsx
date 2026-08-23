import { Users, ShieldCheck } from 'lucide-react'
import { renderTemplate, type InviteRenderVars } from '@shared/inviteEmail'
import type { InviteEmailTemplate } from '@shared/types'
import { useAuth } from '@/features/auth/AuthProvider'
import { EmailPreview } from './EmailPreview'
import { sampleName } from './InviteEmailStep'

/** Label / value row of the send summary. */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="flex-shrink-0 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{label}</dt>
      <dd className="min-w-0 truncate text-sm text-ink">{value}</dd>
    </div>
  )
}

/**
 * Step 5 — final review: the recipient list and the configured email side by side.
 * The actual send is triggered by the wizard footer's "Send invites" button.
 */
export function ReviewSend({
  candidates,
  draft,
  role,
  origin,
}: {
  candidates: { email: string; role: string }[]
  draft: InviteEmailTemplate
  role: string
  origin: string
}) {
  const { user, firebaseUser } = useAuth()
  const recruiterName = user?.displayName || firebaseUser?.displayName || firebaseUser?.email || 'A recruiter'
  const first = candidates[0]?.email || firebaseUser?.email || 'candidate@example.com'

  const vars: InviteRenderVars = {
    candidate_name: sampleName(first),
    role: candidates[0]?.role || role || 'the role',
    recruiter_name: recruiterName,
    company: draft.branding.companyName || 'Mimic',
    deadline: draft.deadlineText || '—',
  }
  const fromLine = draft.sender.verifiedSenderEmail
    ? `${draft.sender.fromName} <${draft.sender.verifiedSenderEmail}>`
    : `${draft.sender.fromName} (server default sender)`

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Recipients */}
      <div className="space-y-3">
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-surface-hover text-ink">
              <Users size={19} />
            </span>
            <div className="min-w-0">
              <p className="font-display text-base font-extrabold tracking-[-0.02em] text-ink">
                <span className="tabular-nums">{candidates.length}</span> recipient{candidates.length === 1 ? '' : 's'}
              </p>
              <p className="text-xs text-ink-muted">Ready to send — nothing goes out until you confirm.</p>
            </div>
          </div>
          <dl className="mt-4">
            <SummaryRow label="From" value={fromLine} />
            {draft.sender.replyTo && <SummaryRow label="Reply-to" value={draft.sender.replyTo} />}
            <SummaryRow label="Subject" value={renderTemplate(draft.subject, { ...vars })} />
          </dl>
        </div>

        <div className="max-h-[420px] overflow-y-auto overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-5">
              <tr className="border-b border-border bg-surface-sunk text-left text-[11px] font-bold uppercase tracking-wide text-ink-muted">
                <th className="w-10 px-4 py-2.5 text-right font-bold">#</th>
                <th className="px-4 py-2.5 font-bold">Email</th>
                <th className="px-4 py-2.5 font-bold">Role</th>
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm text-ink-faint">
                    No valid recipients yet — go back to Candidates to add some.
                  </td>
                </tr>
              ) : candidates.map((c, i) => (
                <tr key={c.email} className="h-11 border-b border-border last:border-0 transition-colors duration-150 hover:bg-surface-sunk">
                  <td className="px-4 text-right text-xs tabular-nums text-ink-faint">{i + 1}</td>
                  <td className="px-4 font-mono text-xs text-ink">{c.email}</td>
                  <td className="px-4 text-xs text-ink-muted">{c.role || role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-ink-muted">
          <ShieldCheck size={14} className="mt-0.5 flex-shrink-0 text-ink-faint" />
          Each recipient gets their own unique interview link tied to this exact email address.
        </p>
      </div>

      {/* Email preview (as the first recipient) */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <EmailPreview draft={draft} vars={vars} candidateEmail={first} origin={origin} />
      </div>
    </div>
  )
}

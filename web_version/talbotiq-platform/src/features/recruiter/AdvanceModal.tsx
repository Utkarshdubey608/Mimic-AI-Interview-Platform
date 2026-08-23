import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { AlertTriangle, Info, Send } from 'lucide-react'
import { Badge, Button, Input, Modal, Skeleton, Toggle, cn } from '@/components/ui'
import { RichTextEditor } from './invite-email/RichTextEditor'
import { TransitionEmailPreview, type TransitionEmailKind } from './TransitionEmailPreview'
import { inviteEmailTemplatesApi, pipelinesApi } from '@/lib/api'
import { getCandidateLinkOrigin } from '@/lib/candidateOrigin'
import { defaultTemplateFor, validateLockedTokens } from '@shared/inviteEmail'
import type { AdvanceResult, BoardCard, InviteEmailTemplate } from '@shared/types'

/** The three board transitions this modal drives — the invite (round-1) flow has its own wizard. */
export type AdvanceModalKind = TransitionEmailKind

interface AdvanceModalProps {
  open: boolean
  onClose: () => void
  pipelineId: string
  kind: AdvanceModalKind
  /** Destination round for 'advance'; ignored for 'selected'/'rejection'. */
  targetRoundIndex: number | null
  /** Display name of the destination (round name, "Selected", or "Not advancing"). */
  targetRoundName: string
  /** The recipients being moved. */
  candidates: BoardCard[]
  onDone: () => void
}

const KIND_TITLE: Record<AdvanceModalKind, (n: number, round: string) => string> = {
  advance: (n, round) => `Advance ${n} candidate${n === 1 ? '' : 's'} to ${round}`,
  selected: (n) => `Select ${n} candidate${n === 1 ? '' : 's'}`,
  rejection: (n) => `Move ${n} candidate${n === 1 ? '' : 's'} to Not advancing`,
}

const KIND_DESCRIPTION: Record<AdvanceModalKind, string> = {
  advance: 'Review the email that goes out, then confirm. Nothing moves until you do.',
  selected: 'Review the email that goes out, then confirm. Nothing moves until you do.',
  rejection: 'Emailing is optional here — candidates can be moved without being contacted.',
}

function seedDraft(kind: AdvanceModalKind): InviteEmailTemplate {
  return { ...defaultTemplateFor(kind), id: 'draft', recruiterId: '', createdAt: '', updatedAt: '' } as InviteEmailTemplate
}

/** Loading shape for the modal body — mirrors the recipients list + email editor. */
function AdvanceModalSkeleton() {
  return (
    <div className="space-y-5">
      <div>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-24 w-full" />
      </div>
      <div>
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-2 h-11 w-full" />
      </div>
      <div>
        <Skeleton className="h-3 w-14" />
        <Skeleton className="mt-2 h-40 w-full rounded-2xl" />
      </div>
    </div>
  )
}

/**
 * Confirm+preview modal for a pipeline-board transition (advance / selected /
 * rejection). Loads the recruiter's default template for `kind`, lets them edit the
 * subject/body and see a live preview — via the SAME `renderTransitionEmail` the
 * server uses to send, so what's previewed is exactly what goes out — lists the
 * recipients being moved, and only reaches the server once Confirm is pressed:
 * `pipelinesApi.advance` for advance/selected, `pipelinesApi.notAdvancing` for
 * rejection. The rejection email itself is OPT-IN and off by default — a recruiter
 * can move candidates to "Not advancing" without emailing them at all.
 */
export function AdvanceModal({
  open, onClose, pipelineId, kind, targetRoundIndex, targetRoundName, candidates, onDone,
}: AdvanceModalProps) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<InviteEmailTemplate | null>(null)
  const [sending, setSending] = useState(false)
  const [rejectOptIn, setRejectOptIn] = useState(false)
  const [results, setResults] = useState<AdvanceResult['results'] | null>(null)

  // (Re)load the recruiter's default template for this kind each time the modal opens.
  useEffect(() => {
    if (!open) return
    setDraft(null)
    setRejectOptIn(false)
    setResults(null)
    let cancelled = false
    inviteEmailTemplatesApi.list(kind)
      .then((list) => {
        if (cancelled) return
        const seed = list.find((t) => t.isDefault) ?? list[0]
        setDraft(seed ?? seedDraft(kind))
      })
      .catch(() => { if (!cancelled) setDraft(seedDraft(kind)) })
    return () => { cancelled = true }
  }, [open, kind])

  // advance requires the locked {{interview_link}} token; selected/rejection require
  // none (see requiredTokensFor), so `locked.ok` is always true for those two kinds.
  const locked = useMemo(
    () => (draft ? validateLockedTokens(draft.subject, draft.bodyHtml, kind) : { ok: true, missing: [] as string[] }),
    [draft, kind],
  )

  const sampleCandidate = candidates[0]
  const sampleVars = {
    candidate_name: sampleCandidate?.candidateName || sampleCandidate?.candidateEmail.split('@')[0] || 'there',
    role: '',
    recruiter_name: draft?.sender.fromName || 'Mimic',
    company: draft?.branding.companyName || 'Mimic',
    round_name: targetRoundName,
    score: sampleCandidate?.score != null ? String(sampleCandidate.score) : '',
  }

  // The email-editing UI (subject/body/preview) is always shown for advance/selected;
  // for rejection it only appears once the recruiter opts in (off by default).
  const showEmailEditor = kind !== 'rejection' || rejectOptIn
  const confirmDisabled = !draft || sending || (showEmailEditor && !locked.ok)
  const confirmLabel = kind === 'rejection' && !rejectOptIn ? 'Move without emailing' : 'Confirm & send'

  const confirm = async () => {
    if (!draft || confirmDisabled) return
    setSending(true)
    try {
      const ids = candidates.map((c) => c.pipelineCandidateId)
      const emailConfig: Partial<InviteEmailTemplate> = {
        name: draft.name, kind, sender: draft.sender, subject: draft.subject,
        bodyHtml: draft.bodyHtml, cta: draft.cta, branding: draft.branding,
      }
      const res: AdvanceResult = kind === 'rejection'
        ? await pipelinesApi.notAdvancing(pipelineId, { candidateIds: ids, sendRejection: rejectOptIn, emailConfig })
        : await pipelinesApi.advance(pipelineId, {
            candidateIds: ids,
            targetRoundIndex: targetRoundIndex ?? 0,
            emailConfig,
            origin: getCandidateLinkOrigin(),
            basis: 'confirm-modal',
          })

      setResults(res.results)
      qc.invalidateQueries({ queryKey: ['pipeline-board', pipelineId] })
      onDone()

      const failed = res.results.filter((r) => r.error).length
      if (failed > 0) {
        toast.error(`${failed} of ${res.results.length} email${res.results.length === 1 ? '' : 's'} failed to send`)
      } else {
        toast.success(kind === 'selected' ? 'Marked as selected' : kind === 'rejection' ? 'Moved to Not advancing' : `Advanced to ${targetRoundName}`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  const title = KIND_TITLE[kind](candidates.length, targetRoundName)
  const movedCount = results?.length ?? 0
  const sentCount = results?.filter((r) => r.sent).length ?? 0
  const failedCount = results?.filter((r) => r.error).length ?? 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={results ? 'Done — here’s what happened for each recipient.' : KIND_DESCRIPTION[kind]}
      width="max-w-3xl"
    >
      {!draft ? (
        <AdvanceModalSkeleton />
      ) : results ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="field-label mb-0">Results</span>
            <span className="text-xs font-medium tabular-nums text-neutral-500">
              {movedCount} moved · {sentCount} email{sentCount === 1 ? '' : 's'} sent
              {failedCount > 0 ? ` · ${failedCount} failed` : ''}
            </span>
          </div>

          {failedCount > 0 && (
            // The candidates WERE moved server-side; only email delivery failed.
            // Say so explicitly so a mail-server rejection doesn't look like the
            // whole action failed (and can't be un-done by mistake).
            <div className="flex items-start gap-2.5 rounded-xl border border-primary-200 bg-primary-50 px-3.5 py-3">
              <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-primary-700" />
              <p className="text-xs leading-relaxed text-neutral-700">
                <span className="font-bold text-neutral-900">Every candidate was moved.</span> Only the email delivery failed — the reason is listed per recipient below. That&rsquo;s a mail-server (Brevo) issue, not the advancement, so there is nothing to redo here.
              </p>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-neutral-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-neutral-500">
              <span>Recipient</span>
              <span>Outcome</span>
            </div>
            <ul className="max-h-64 divide-y divide-border overflow-auto">
              {results.map((r) => (
                <li key={r.pipelineCandidateId} className="flex flex-col gap-1 bg-white px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-xs text-neutral-700">{r.email}</span>
                    {r.sent
                      ? <Badge variant="success">Email sent</Badge>
                      : r.error
                        ? <Badge variant="warning">Moved · email failed</Badge>
                        : <Badge variant="neutral">Moved</Badge>}
                  </div>
                  {r.error && <p className="break-words text-[11px] leading-snug text-neutral-400">{r.error}</p>}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-end border-t border-border pt-4">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <section>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="field-label mb-0">Recipients</span>
              <Badge variant="neutral" className="tabular-nums">{candidates.length}</Badge>
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-neutral-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-neutral-500">
                <span>Candidate</span>
                <span>Score</span>
              </div>
              <ul className="max-h-40 divide-y divide-border overflow-auto">
                {candidates.map((c) => (
                  <li key={c.pipelineCandidateId} className="flex items-center justify-between gap-3 bg-white px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-neutral-900">{c.candidateName || c.candidateEmail}</span>
                      {c.candidateName && <span className="block truncate font-mono text-[11px] text-neutral-400">{c.candidateEmail}</span>}
                    </span>
                    {c.score != null
                      ? <span className="shrink-0 text-sm font-bold tabular-nums text-neutral-900">{c.score}</span>
                      : <span title="No score yet" className="shrink-0 text-xs font-medium text-neutral-300">—</span>}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {kind === 'rejection' && (
            <div className={cn(
              'rounded-2xl border px-4 transition-colors duration-150',
              rejectOptIn ? 'border-primary-200 bg-primary-50/70' : 'border-border bg-neutral-50',
            )}>
              <Toggle
                checked={rejectOptIn}
                onChange={setRejectOptIn}
                label="Send a rejection email"
                description="Off by default — candidates can be moved to Not advancing silently."
              />
            </div>
          )}

          {showEmailEditor && (
            <>
              <Input
                label="Subject"
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
              <div>
                <span className="field-label">Body</span>
                <RichTextEditor value={draft.bodyHtml} onChange={(html) => setDraft({ ...draft, bodyHtml: html })} />
              </div>
              {!locked.ok && (
                <div className="flex items-start gap-2.5 rounded-xl border border-warning-border bg-warning-bg px-3.5 py-3">
                  <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0 text-warning" />
                  <p className="text-xs leading-relaxed text-warning">
                    <span className="font-bold">Missing the required link.</span> Insert{' '}
                    <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">{'{{interview_link}}'}</code>{' '}
                    in the subject or body so the candidate can reach their next round.
                  </p>
                </div>
              )}
              <div>
                <span className="field-label">Preview</span>
                <TransitionEmailPreview draft={draft} kind={kind} vars={sampleVars} origin={getCandidateLinkOrigin()} />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              loading={sending}
              disabled={confirmDisabled}
              icon={showEmailEditor ? <Send size={14} /> : undefined}
              onClick={() => void confirm()}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

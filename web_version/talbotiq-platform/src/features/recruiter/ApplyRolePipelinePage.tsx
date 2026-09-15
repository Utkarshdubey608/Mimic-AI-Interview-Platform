import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowLeft, ArrowRight, Check, AlertCircle, AlertTriangle, Loader2, UploadCloud, Trash2,
  Copy, RefreshCw, CheckCircle2, Info,
} from 'lucide-react'
import { Button, Badge, Card, ErrorState, Skeleton, cn } from '@/components/ui'
import { invitesApi, roleConfigsApi, describeFetchError } from '@/lib/api'
import { getCandidateLinkOrigin } from '@/lib/candidateOrigin'
import { InviteEmailStep } from './invite-email/InviteEmailStep'
import { ReviewSend } from './invite-email/ReviewSend'
import { KINDS } from './roundKinds'
import { defaultInviteEmailTemplate, validateLockedTokens } from '@shared/inviteEmail'
import type { InviteEmailTemplate, CreateInvitesFromRolePipelineResult } from '@shared/types'

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim())

/**
 * Materialise a RoleConfig (Feature 1) into a real multi-round timeline for a batch
 * of candidates, and invite round 1. Deliberately NOT part of InviteWizard's
 * `setupType` state machine — a separate, additive entry point reached from
 * RolePipelinesPage's "Apply to candidates" button, so the existing single/multi
 * invite paths in InviteWizard stay completely untouched.
 *
 * The candidate-import block (dropzone, manual add, review table with the
 * "Detected category" column) and the success screen are intentionally close
 * copies of InviteWizard's own — duplicated rather than extracted, so this page
 * carries zero risk to that already-working file.
 */
export default function ApplyRolePipelinePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const pipeline = useQuery({
    queryKey: ['role-config', id],
    queryFn: () => roleConfigsApi.get(id as string),
    enabled: !!id,
  })
  const categories = useQuery({ queryKey: ['role-categories'], queryFn: roleConfigsApi.categories })
  const categoryLabel = (slug: string) => categories.data?.find((c) => c.slug === slug)?.displayName ?? slug

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [candidates, setCandidates] = useState<{ id: string; email: string; role: string; roleCategory?: string }[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [manualEmail, setManualEmail] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<CreateInvitesFromRolePipelineResult | null>(null)
  const [retrying, setRetrying] = useState<Set<string>>(new Set())

  const [emailDraft, setEmailDraft] = useState<InviteEmailTemplate>(() => ({
    id: 'draft',
    recruiterId: '',
    createdAt: '',
    updatedAt: '',
    ...defaultInviteEmailTemplate(),
  }))

  // A copied/shared link carries no deadline of its own — the deadline only ever
  // lived in the invite EMAIL's body. A recruiter sharing links directly (dry-run,
  // Slack, WhatsApp) was handing candidates a link with no sense of when it closes.
  // Appended here so copying a link copies what the recruiter already typed for it.
  const linkWithDeadline = (link: string) =>
    emailDraft.deadlineText?.trim() ? `${link} (Deadline: ${emailDraft.deadlineText.trim()})` : link

  const validCount = candidates.filter((c) => emailOk(c.email)).length
  const validCandidates = candidates
    .filter((c) => emailOk(c.email))
    .map((c) => ({ email: c.email.trim(), role: c.role.trim() || pipeline.data?.displayName || '', roleCategory: c.roleCategory }))
  const sampleEmail = validCandidates[0]?.email || 'candidate@example.com'
  const emailLocked = validateLockedTokens(emailDraft.subject, emailDraft.bodyHtml)
  const emailConfigPayload = (): Partial<InviteEmailTemplate> => ({
    name: emailDraft.name,
    sender: emailDraft.sender,
    subject: emailDraft.subject,
    bodyHtml: emailDraft.bodyHtml,
    cta: emailDraft.cta,
    branding: emailDraft.branding,
    deadlineText: emailDraft.deadlineText,
  })

  // Non-blocking: candidates whose detected category disagrees with this pipeline's
  // own category. Never fabricated, never auto-corrected — just surfaced, same as
  // the file-import `warnings[]` pattern.
  const mismatchCount = pipeline.data
    ? candidates.filter((c) => c.roleCategory && c.roleCategory !== pipeline.data!.roleCategory).length
    : 0

  const mergeRows = (incoming: { email: string; role: string; roleCategory?: string }[]) => {
    setCandidates((prev) => {
      const seen = new Set(prev.map((c) => c.email.trim().toLowerCase()))
      const add = incoming
        .filter((r) => r.email.trim() && !seen.has(r.email.trim().toLowerCase()))
        .map((r) => ({ id: crypto.randomUUID(), email: r.email.trim(), role: (r.role || pipeline.data?.displayName || '').trim(), roleCategory: r.roleCategory }))
      return [...prev, ...add]
    })
  }

  const onFile = async (f: File | null) => {
    setFileError(null); setWarnings([])
    if (!f) return
    setExtracting(true)
    try {
      const res = await invitesApi.extract(f, pipeline.data?.displayName || '')
      mergeRows(res.rows)
      setWarnings(res.warnings)
      if (!res.rows.length) setFileError('No email addresses found in that file.')
      else toast.success(`Found ${res.rows.length} email${res.rows.length === 1 ? '' : 's'}`)
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      setExtracting(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const addManual = () => {
    const e = manualEmail.trim()
    if (!e) return
    if (candidates.some((c) => c.email.toLowerCase() === e.toLowerCase())) { toast('That email is already in the list'); setManualEmail(''); return }
    setCandidates((prev) => [...prev, { id: crypto.randomUUID(), email: e, role: pipeline.data?.displayName || '' }])
    setManualEmail('')
  }

  const submit = async () => {
    if (!id || validCount === 0 || !emailLocked.ok) return
    setCreating(true)
    try {
      const res = await invitesApi.createFromRolePipeline({
        roleConfigId: id,
        candidates: validCandidates,
        origin: getCandidateLinkOrigin(),
        emailConfig: emailConfigPayload(),
        sendEmails: true,
      })
      setResult(res)
      toast.success(`${res.roundsCreated} round${res.roundsCreated === 1 ? '' : 's'} created — invited ${res.created.length} to Round 1`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not apply this pipeline')
    } finally {
      setCreating(false)
    }
  }

  const retryOne = async (rid: string) => {
    setRetrying((s) => new Set(s).add(rid))
    try {
      const r = await invitesApi.retry(rid, { role: pipeline.data?.displayName || '', origin: getCandidateLinkOrigin(), emailConfig: emailConfigPayload() })
      setResult((prev) => prev && ({
        ...prev,
        created: prev.created.map((c) => c.id === rid ? { ...c, sent: r.sent, status: r.status as CreateInvitesFromRolePipelineResult['created'][number]['status'], error: r.error } : c),
        emailed: prev.emailed + (r.sent ? 1 : 0),
      }))
      if (r.sent) toast.success(`Resent to ${r.email}`)
      else toast.error(r.error || 'Retry failed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Retry failed')
    } finally {
      setRetrying((s) => { const n = new Set(s); n.delete(rid); return n })
    }
  }

  if (pipeline.isLoading) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
    )
  }
  if (pipeline.isError) {
    return (
      <div className="mx-auto max-w-[900px] px-6 py-8">
        <Card className="p-0">
          <ErrorState
            title="Couldn't load this pipeline"
            detail={describeFetchError(pipeline.error, "It may have been deleted, or you don't have access to it.")}
            onRetry={() => void pipeline.refetch()}
          />
        </Card>
      </div>
    )
  }
  const rc = pipeline.data!

  return (
    <div className="mx-auto max-w-[900px] px-6 py-8">
      <button onClick={() => navigate('/candidates/role-pipelines')} className="mb-5 inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
        <ArrowLeft size={15} /> Back to role pipelines
      </button>

      <div className="mb-6">
        <span className="pill mb-2.5 inline-flex">Apply pipeline</span>
        <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-ink">{rc.displayName}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          {categoryLabel(rc.roleCategory)} · {rc.rounds.length} round{rc.rounds.length === 1 ? '' : 's'} — this materialises a real timeline
          for the candidates you add below and invites them to round 1 only.
        </p>
      </div>

      {!result && (
        <div className="mb-7 flex flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-surface px-4 py-3">
          {rc.rounds.map((r, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <Badge variant="neutral">{KINDS.find((k) => k.id === r.kind)?.label ?? r.kind} · {r.title}</Badge>
              {i < rc.rounds.length - 1 && <span className="text-ink-faint">→</span>}
            </span>
          ))}
          <button onClick={() => navigate(`/candidates/role-pipelines/${id}`)} className="ml-auto text-xs font-semibold text-action hover:underline">
            Edit this pipeline
          </button>
        </div>
      )}

      {result && (
        <div className="space-y-5">
          <div className="rounded-3xl border border-mint-border bg-mint-bg/70 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-mint text-mint-ink shadow-mint-sm"><CheckCircle2 size={28} /></div>
            <h2 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-ink">
              <span className="tabular-nums">{result.created.length}</span> invite{result.created.length === 1 ? '' : 's'} created
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-body">
              {result.dryRun
                ? 'Emails are in dry-run — nothing has been sent yet. Add the SMTP login and a verified sender to send for real.'
                : <><span className="font-semibold tabular-nums text-ink">{result.emailed}</span> invitation email{result.emailed === 1 ? '' : 's'} sent. Round 2 onward fills in as you advance candidates.</>}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="badge badge-neutral">Batch <span className="ml-1 font-mono">{result.testId.slice(0, 8)}</span></span>
              <span className="badge badge-neutral">{result.roundsCreated} round{result.roundsCreated === 1 ? '' : 's'} created</span>
              {result.dryRun && <span className="badge badge-warning">Dry run</span>}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-sunk text-left text-[11px] font-bold uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-2.5 font-bold">Candidate</th>
                  <th className="px-4 py-2.5 font-bold">Status</th>
                  <th className="px-4 py-2.5 font-bold">Invite link</th>
                  <th className="w-12 px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {result.created.map((c) => {
                  const failed = c.sent === false
                  const variant = c.status === 'delivered' ? 'success' : c.status === 'accepted' ? 'info' : failed ? 'danger' : 'neutral'
                  const label = c.status ?? (c.sent ? 'accepted' : 'pending')
                  return (
                    <tr key={c.id} className="h-12 border-b border-border last:border-0 transition-colors duration-150 hover:bg-surface-sunk">
                      <td className="px-4 text-ink">{c.email}</td>
                      <td className="px-4">
                        <span className="flex items-center gap-2">
                          <Badge variant={variant}>{label}</Badge>
                          {failed && (
                            <Button size="xs" variant="ghost" icon={<RefreshCw size={12} className={retrying.has(c.id) ? 'animate-spin' : ''} />}
                              onClick={() => void retryOne(c.id)} disabled={retrying.has(c.id)} title={c.error || 'Retry sending this invite'}>
                              Retry
                            </Button>
                          )}
                        </span>
                      </td>
                      <td className="px-4"><span className="block max-w-[300px] truncate font-mono text-xs text-ink-muted">{c.link}</span></td>
                      <td className="px-4 text-right">
                        <button onClick={() => { navigator.clipboard.writeText(linkWithDeadline(c.link)); toast.success('Link copied') }} className="rounded-lg p-1.5 text-ink-faint transition-colors duration-150 hover:bg-surface-hover hover:text-ink" aria-label={`Copy invite link for ${c.email}`}><Copy size={14} /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="secondary" icon={<Copy size={15} />} onClick={() => { navigator.clipboard.writeText(result.created.map((c) => `${c.email}: ${linkWithDeadline(c.link)}`).join('\n')); toast.success('All links copied') }}>Copy all links</Button>
            <Button onClick={() => navigate('/sessions')}>Done</Button>
          </div>
        </div>
      )}

      {!result && step === 1 && (
        <div className="space-y-8">
          <section>
            <div className="mb-4">
              <h2 className="font-display text-base font-extrabold tracking-[-0.02em] text-ink">Add candidates</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
                Upload a file of candidate emails — we extract each email and detect a role category — or add them manually.
              </p>
            </div>
            <div
              onClick={() => !extracting && fileInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFile(e.dataTransfer.files?.[0] ?? null) }}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-150',
                dragOver ? 'border-action bg-surface-hover' : 'border-border bg-surface-sunk hover:border-rule hover:bg-surface-hover/40',
                extracting && 'pointer-events-none opacity-70',
              )}
            >
              <span className={cn('flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors duration-150',
                dragOver ? 'border-rule bg-surface text-ink' : 'border-border bg-surface text-ink')}>
                {extracting ? <Loader2 size={22} className="animate-spin" /> : <UploadCloud size={22} />}
              </span>
              <span className="text-sm font-semibold text-ink">{extracting ? 'Reading your file…' : 'Drag a file here, or click to choose'}</span>
              <span className="text-xs text-ink-faint">CSV · Excel · PDF · DOCX · TXT — max 10 MB</span>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.tsv,.xlsx,.xls,.pdf,.docx,.txt,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf,text/plain"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {fileError && (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-danger-border bg-danger-bg p-3 text-sm leading-relaxed text-danger">
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                <span>{fileError} Check the file has an email column, then try again.</span>
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <input
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManual() } }}
                aria-label="Add a candidate email"
                placeholder="Or type an email: name@company.com"
                className="input-base flex-1"
              />
              <Button variant="secondary" onClick={addManual} disabled={!manualEmail.trim()}>Add email</Button>
            </div>
          </section>

          {warnings.length > 0 && (
            <div className="rounded-2xl border border-warning-border bg-warning-bg p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-warning">
                <AlertTriangle size={15} className="flex-shrink-0" />
                Check these rows from the file
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1 pl-1 text-sm leading-relaxed text-warning/90">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {mismatchCount > 0 && (
            <div className="flex items-start gap-2 rounded-2xl border border-warning-border bg-warning-bg p-4 text-sm text-warning">
              <Info size={15} className="mt-0.5 flex-shrink-0" />
              <span>
                {mismatchCount} of {candidates.length} candidate{candidates.length === 1 ? '' : 's'} look like a different role than this pipeline
                ({categoryLabel(rc.roleCategory)}). They'll still be invited into this pipeline's rounds — review the detected category below
                and correct it if that's wrong, or move them to a different pipeline instead.
              </span>
            </div>
          )}

          {candidates.length > 0 && (
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">
                  <span className="tabular-nums">{candidates.length}</span> candidate{candidates.length === 1 ? '' : 's'}
                  <span className="ml-2 text-xs font-normal text-ink-muted">
                    <span className="tabular-nums">{validCount}</span> valid{validCount !== candidates.length ? ` · ${candidates.length - validCount} to fix` : ''}
                  </span>
                </p>
                <div className="flex items-center gap-1">
                  {validCount !== candidates.length && (
                    <Button size="xs" variant="ghost" onClick={() => setCandidates((cs) => cs.filter((c) => emailOk(c.email)))}>Remove invalid</Button>
                  )}
                  <Button size="xs" variant="ghost" onClick={() => { setCandidates([]); setWarnings([]) }} className="hover:text-danger">Clear all</Button>
                </div>
              </div>

              <div className="max-h-[46vh] overflow-y-auto overflow-x-auto rounded-2xl border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-5">
                    <tr className="border-b border-border bg-surface-sunk text-left text-[11px] font-bold uppercase tracking-wide text-ink-muted">
                      <th className="w-12 px-4 py-2.5 font-bold"><span className="sr-only">Status</span></th>
                      <th className="px-4 py-2.5 font-bold">Email</th>
                      <th className="px-4 py-2.5 font-bold">Role</th>
                      <th className="px-4 py-2.5 font-bold">Detected category</th>
                      <th className="w-12 px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => {
                      const ok = emailOk(c.email)
                      const mismatched = c.roleCategory && c.roleCategory !== rc.roleCategory
                      return (
                        <tr key={c.id} className="h-12 border-b border-border last:border-0">
                          <td className="px-4">
                            <span
                              className={cn('flex h-6 w-6 items-center justify-center rounded-full border', ok ? 'border-success-border bg-success-bg text-success' : 'border-danger-border bg-danger-bg text-danger')}
                              title={ok ? 'Valid email' : 'Invalid email format'} aria-label={ok ? 'Valid email' : 'Invalid email format'}
                            >
                              {ok ? <Check size={12} strokeWidth={3} /> : <AlertCircle size={13} />}
                            </span>
                          </td>
                          <td className="px-4">
                            <input value={c.email} onChange={(e) => setCandidates((cs) => cs.map((x) => x.id === c.id ? { ...x, email: e.target.value } : x))}
                              aria-label="Candidate email"
                              className={cn('w-full rounded-lg border bg-surface px-2.5 py-1.5 font-mono text-xs text-ink transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-signal/20',
                                ok ? 'border-transparent hover:border-border focus:border-action' : 'border-danger bg-danger-bg/40')} />
                          </td>
                          <td className="px-4">
                            <input value={c.role} onChange={(e) => setCandidates((cs) => cs.map((x) => x.id === c.id ? { ...x, role: e.target.value } : x))}
                              aria-label="Candidate role"
                              placeholder={rc.displayName}
                              className="w-full rounded-lg border border-transparent bg-surface px-2.5 py-1.5 text-xs text-ink-body transition-colors duration-150 hover:border-border focus:border-action focus:outline-none focus:ring-2 focus:ring-signal/20" />
                          </td>
                          <td className="px-4">
                            <select
                              value={c.roleCategory || ''}
                              onChange={(e) => setCandidates((cs) => cs.map((x) => x.id === c.id ? { ...x, roleCategory: e.target.value || undefined } : x))}
                              aria-label="Role category"
                              className={cn('w-full rounded-lg border bg-surface px-2.5 py-1.5 text-xs transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-signal/20',
                                mismatched ? 'border-warning-border text-warning' : c.roleCategory && c.roleCategory !== 'other' ? 'border-transparent text-ink-body hover:border-border focus:border-action' : 'border-border text-ink-faint focus:border-action')}
                            >
                              <option value="">Not detected</option>
                              {categories.data?.map((cat) => (
                                <option key={cat.slug} value={cat.slug}>{cat.displayName}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 text-right">
                            <button onClick={() => setCandidates((cs) => cs.filter((x) => x.id !== c.id))} className="rounded-lg p-1.5 text-ink-disabled transition-colors duration-150 hover:bg-danger-bg hover:text-danger" aria-label={`Remove ${c.email || 'candidate'}`}><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
            <span className="text-xs text-ink-muted">{validCount === 0 ? 'Add at least one valid email address to continue.' : undefined}</span>
            <Button disabled={validCount === 0} onClick={() => setStep(2)}>Next: Invite email <ArrowRight size={15} /></Button>
          </div>
        </div>
      )}

      {!result && step === 2 && (
        <div className="space-y-8">
          <section>
            <div className="mb-4">
              <h2 className="font-display text-base font-extrabold tracking-[-0.02em] text-ink">Configure the invite email</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
                This email invites candidates to Round 1 — {rc.rounds[0]?.title ?? 'the first round'}. Later rounds are invited separately as you advance candidates.
              </p>
            </div>
            <InviteEmailStep draft={emailDraft} onChange={setEmailDraft} role={rc.displayName} sampleEmail={sampleEmail} origin={getCandidateLinkOrigin()} />
          </section>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
            <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(1)}>Back</Button>
            <span className="text-xs text-ink-muted">{!emailLocked.ok ? 'Add the interview link back into the email to continue.' : undefined}</span>
            <Button disabled={!emailLocked.ok} onClick={() => setStep(3)}>Next: Review <ArrowRight size={15} /></Button>
          </div>
        </div>
      )}

      {!result && step === 3 && (
        <div className="space-y-8">
          <section>
            <div className="mb-4">
              <h2 className="font-display text-base font-extrabold tracking-[-0.02em] text-ink">Review & send</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
                This creates {rc.rounds.length} round{rc.rounds.length === 1 ? '' : 's'} and invites everyone below to round 1 only.
              </p>
            </div>
            <ReviewSend candidates={validCandidates} draft={emailDraft} role={rc.displayName} origin={getCandidateLinkOrigin()} />
          </section>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
            <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(2)}>Back</Button>
            <span className="text-xs text-ink-muted">
              {validCount === 0 ? 'Add at least one valid recipient.' : !emailLocked.ok ? 'The invite email is missing the interview link.' : undefined}
            </span>
            <Button loading={creating} disabled={validCount === 0 || !emailLocked.ok} onClick={submit}>
              Apply pipeline & send {validCount > 0 ? `${validCount} ` : ''}invite{validCount === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

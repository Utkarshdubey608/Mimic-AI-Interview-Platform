import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { MessageSquare, Mic, Video, Clock, Clapperboard, Users, ArrowLeft, ArrowRight, Check, FileText, Layers, Plus, UploadCloud, Trash2, AlertTriangle, AlertCircle, Loader2, CheckCircle2, Copy, RefreshCw, Info, Target, Workflow, X, ListChecks,
} from 'lucide-react'
import { Button, Input, Skeleton, Badge, cn } from '@/components/ui'
import { mcqSetsApi, questionSetsApi, invitesApi, settingsApi, pipelinesApi } from '@/lib/api'
import { GenerateFromResumeModal } from './GenerateFromResumeModal'
import { InviteEmailStep } from './invite-email/InviteEmailStep'
import { ReviewSend } from './invite-email/ReviewSend'
import { RoundBuilder, defaultRounds, toRoundDefs, type RoundDraft } from './RoundBuilder'
import { defaultInviteEmailTemplate, validateLockedTokens } from '@shared/inviteEmail'
import { getCandidateLinkOrigin } from '@/lib/candidateOrigin'
import type { TrackType, QuestionStyle, DifficultyChoice, GeminiModel, QuestionSet, CreateInvitesResult, InviteEmailTemplate } from '@shared/types'
import { useAutopilotActions } from '@/features/guide/autopilot/registry'

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim())

/**
 * Invite-first recruiter wizard (bulk invite).
 *
 * New model: the recruiter never uploads a résumé. They pick the interview MODE
 * and the candidate ROLE, choose a question source (tailor-per-résumé or a saved
 * set), then invite candidates in bulk — each candidate uploads their own résumé
 * when they begin, and the interview auto-configures to these settings.
 *
 * Implemented: shell + Step 1 (mode + role) + Step 2 (question source + config).
 * Step 3 (candidates + send) and the final "create invites" submit are wired once
 * the Firestore `interviews` schema + Admin credentials + email provider are in place.
 */

type Mode = Extract<TrackType, 'chatbot' | 'voice' | 'video_avatar' | 'chat' | 'video' | 'two_way' | 'mcq'>
type Source = 'tailor' | 'set'

const MODES: { value: Mode; label: string; blurb: string; icon: React.ReactNode }[] = [
  { value: 'chatbot',      label: 'Chatbot',      blurb: 'Conversational, typed — ChatGPT-style.',   icon: <MessageSquare size={20} /> },
  { value: 'voice',        label: 'Voice',        blurb: 'Live spoken AI interviewer (Gemini Live).', icon: <Mic size={20} /> },
  { value: 'video_avatar', label: 'Video Avatar', blurb: 'Conversational AI video avatar (Tavus).',   icon: <Video size={20} /> },
  { value: 'chat',         label: 'Timed Q&A',    blurb: '30s prep + timed answers (HireVue-style).', icon: <Clock size={20} /> },
  { value: 'mcq',          label: 'Assessment',   blurb: 'Sections of closed questions, scored instantly.', icon: <ListChecks size={20} /> },
  { value: 'video',        label: 'Video Interview', blurb: 'Candidate records webcam answers per question.', icon: <Clapperboard size={20} /> },
  { value: 'two_way',      label: 'Two-way Interview', blurb: 'Live recruiter ↔ candidate video interview.', icon: <Users size={20} /> },
]

const STYLES: { value: QuestionStyle; label: string }[] = [
  { value: 'technical', label: 'Technical' },
  { value: 'non_technical', label: 'Non-technical' },
  { value: 'mix', label: 'Mix' },
]
const DIFFICULTIES: DifficultyChoice[] = ['easy', 'medium', 'hard', 'mixed']

const STEPS = [
  { n: 1, title: 'Basics', hint: 'Mode & role' },
  { n: 2, title: 'Questions', hint: 'Tailor or reuse' },
  { n: 3, title: 'Candidates', hint: 'Add recipients' },
  { n: 4, title: 'Invite email', hint: 'Configure & test' },
  { n: 5, title: 'Review', hint: 'Confirm & send' },
] as const

/** Config the interview auto-applies per candidate (persisted on the invite at submit). */
export interface TailorConfig {
  style: QuestionStyle
  techCount: number
  nonTechCount: number
  difficulty: DifficultyChoice
  domains: string[]
  model: GeminiModel
}

function Stepper({ step }: { step: number }) {
  const current = STEPS.find((s) => s.n === step)
  return (
    <div className="rounded-2xl border border-border bg-white px-5 py-4 shadow-xs">
      <ol className="flex items-center" aria-label={`Step ${step} of ${STEPS.length}`}>
        {STEPS.map((s, i) => {
          const done = step > s.n
          const active = step === s.n
          return (
            <li key={s.n} className={cn('flex items-center', i < STEPS.length - 1 && 'flex-1')}>
              <div className="flex items-center gap-2.5">
                <span
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums transition-all duration-200',
                    done ? 'bg-primary-700 text-white shadow-primary-sm'
                      : active ? 'bg-primary-700 text-white ring-4 ring-primary-100 shadow-primary-sm'
                      : 'border border-border bg-white text-neutral-400',
                  )}
                >
                  {done ? <Check size={15} strokeWidth={3} /> : s.n}
                </span>
                <div className="hidden sm:block">
                  <p className={cn('whitespace-nowrap text-[13px] font-semibold leading-tight', active ? 'text-neutral-900' : done ? 'text-neutral-700' : 'text-neutral-400')}>{s.title}</p>
                  <p className="hidden whitespace-nowrap text-[11px] leading-tight text-neutral-400 lg:block">{s.hint}</p>
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div className="mx-2.5 h-[2px] min-w-[14px] flex-1 overflow-hidden rounded-full bg-border sm:mx-3">
                  <div className={cn('h-full rounded-full bg-primary-700 transition-all duration-300', done ? 'w-full' : 'w-0')} />
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-xs font-medium text-neutral-500 sm:hidden">
        Step <span className="tabular-nums">{step}</span> of <span className="tabular-nums">{STEPS.length}</span> · {current?.title}
      </p>
    </div>
  )
}

/** Section heading inside a step — generous above, tight below. */
function StepSection({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-extrabold tracking-[-0.02em] text-neutral-900">{title}</h2>
          {hint && <p className="mt-1 max-w-2xl text-xs leading-relaxed text-neutral-500">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** The wizard's one selectable-card shape — used by every choice grid. */
function SelectCard({ selected, onClick, icon, title, blurb, children }: {
  selected: boolean; onClick: () => void; icon: React.ReactNode; title: string; blurb: string; children?: React.ReactNode
}) {
  return (
    <button
      type="button" onClick={onClick} aria-pressed={selected}
      className={cn(
        'relative flex items-start gap-3.5 rounded-2xl border bg-white p-4 pr-10 text-left transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2',
        selected
          ? 'border-primary-700 bg-primary-50/40 shadow-primary-sm ring-1 ring-primary-700'
          : 'border-border hover:border-primary-300 hover:shadow-sm',
      )}
    >
      <span className={cn(
        'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border transition-colors duration-150',
        selected
          ? 'border-neutral-900 bg-neutral-900 text-white'
          : 'border-border bg-neutral-50 text-neutral-500',
      )}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-neutral-900">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-neutral-500">{blurb}</span>
        {children}
      </span>
      {selected && (
        <span className="absolute right-3.5 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-primary-700 text-white">
          <Check size={12} strokeWidth={3} />
        </span>
      )}
    </button>
  )
}

/** Segmented pill group — one row of mutually exclusive choices (button semantics kept). */
function Segmented({ label, children, size = 'md' }: { label: string; children: React.ReactNode; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('flex rounded-full bg-neutral-100 p-1', size === 'sm' && 'p-0.5')} role="group" aria-label={label}>
      {children}
    </div>
  )
}
const segItem = (selected: boolean, size: 'sm' | 'md' = 'md') => cn(
  'flex-1 rounded-full font-semibold transition-all duration-150 whitespace-nowrap',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-1',
  size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
  selected ? 'bg-primary-700 text-white shadow-primary-sm' : 'text-neutral-500 hover:text-neutral-900',
)

/** Sticky footer row for every step: back/cancel on the left, hint + primary on the right. */
function StepFooter({ left, hint, right }: { left: React.ReactNode; hint?: string; right: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
      <div className="flex items-center gap-2">{left}</div>
      <div className="flex items-center gap-3">
        {hint && <p className="hidden text-xs text-neutral-400 sm:block">{hint}</p>}
        {right}
      </div>
    </div>
  )
}

/** §2 config panel — role is read-only (from Step 1); NO "question set name". */
function TailorConfigPanel({ role, cfg, setCfg }: { role: string; cfg: TailorConfig; setCfg: (c: TailorConfig) => void }) {
  const [domainDraft, setDomainDraft] = useState('')
  const total = cfg.style === 'mix' ? cfg.techCount + cfg.nonTechCount : cfg.style === 'technical' ? cfg.techCount : cfg.nonTechCount
  const addDomain = () => {
    const v = domainDraft.trim()
    if (v && !cfg.domains.includes(v)) setCfg({ ...cfg, domains: [...cfg.domains, v] })
    setDomainDraft('')
  }
  return (
    <div className="mt-4 rounded-2xl border border-border bg-white p-5 shadow-xs">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-bold leading-tight text-neutral-900">Tailoring settings</h3>
          <p className="mt-0.5 text-xs text-neutral-500">Applied to every candidate’s generated question set.</p>
        </div>
        <Badge variant={total >= 1 && total <= 25 ? 'info' : 'danger'}>
          <span className="tabular-nums">{total}</span> question{total === 1 ? '' : 's'}
        </Badge>
      </div>

      <div className="space-y-5">
        {/* role (read-only, from Step 1) */}
        <div>
          <label className="field-label mb-1.5 block">Role</label>
          <div className="flex h-11 items-center rounded-xl border border-border bg-neutral-50 px-3.5 text-sm text-neutral-700">
            <span className="truncate">{role}</span> <span className="ml-2 flex-shrink-0 text-xs text-neutral-400">(set in Step 1)</span>
          </div>
        </div>

        {/* style */}
        <div>
          <label className="field-label mb-1.5 block">Question style</label>
          <Segmented label="Question style">
            {STYLES.map((s) => (
              <button key={s.value} type="button" onClick={() => setCfg({ ...cfg, style: s.value })}
                aria-pressed={cfg.style === s.value} className={segItem(cfg.style === s.value)}>
                {s.label}
              </button>
            ))}
          </Segmented>
        </div>

        {/* counts */}
        {cfg.style === 'mix' ? (
          <div className="grid grid-cols-2 gap-4">
            <Input label="# Technical" type="number" min={0} max={25} value={cfg.techCount} onChange={(e) => setCfg({ ...cfg, techCount: Math.max(0, Number(e.target.value)) })} />
            <Input label="# Non-technical" type="number" min={0} max={25} value={cfg.nonTechCount} onChange={(e) => setCfg({ ...cfg, nonTechCount: Math.max(0, Number(e.target.value)) })} />
          </div>
        ) : (
          <Input label="Number of questions" type="number" min={1} max={25}
            value={cfg.style === 'technical' ? cfg.techCount : cfg.nonTechCount}
            onChange={(e) => { const v = Math.max(1, Number(e.target.value)); setCfg(cfg.style === 'technical' ? { ...cfg, techCount: v } : { ...cfg, nonTechCount: v }) }} />
        )}
        {(total < 1 || total > 25) && (
          <p className="flex items-start gap-2 rounded-xl border border-danger-border bg-danger-bg p-2.5 text-xs leading-relaxed text-danger">
            <AlertCircle size={14} className="mt-px flex-shrink-0" />
            Total questions must be between 1 and 25 — currently <span className="font-bold tabular-nums">{total}</span>. Adjust the counts above to continue.
          </p>
        )}

        {/* difficulty */}
        <div>
          <label className="field-label mb-1.5 block">Difficulty</label>
          <Segmented label="Difficulty">
            {DIFFICULTIES.map((d) => (
              <button key={d} type="button" onClick={() => setCfg({ ...cfg, difficulty: d })}
                aria-pressed={cfg.difficulty === d} className={cn(segItem(cfg.difficulty === d, 'sm'), 'capitalize')}>
                {d}
              </button>
            ))}
          </Segmented>
        </div>

        {/* domains (focus topics) */}
        <div>
          <label className="field-label mb-1.5 block">Domains <span className="font-normal normal-case tracking-normal text-neutral-400">(optional focus areas)</span></label>
          <div className="flex gap-2">
            <input value={domainDraft} onChange={(e) => setDomainDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDomain() } }}
              aria-label="Add a focus domain"
              placeholder="e.g. Distributed systems, SQL, System design" className="input-base flex-1" />
            <Button variant="secondary" onClick={addDomain} disabled={!domainDraft.trim()}>Add</Button>
          </div>
          {cfg.domains.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {cfg.domains.map((d) => (
                <span key={d} className="inline-flex items-center gap-1.5 rounded-full border border-primary-100 bg-primary-50 py-1 pl-3 pr-2 text-xs font-medium text-primary-700">
                  {d}
                  <button onClick={() => setCfg({ ...cfg, domains: cfg.domains.filter((x) => x !== d) })} aria-label={`Remove ${d}`} className="rounded-full p-0.5 text-primary-400 transition-colors duration-150 hover:bg-primary-100 hover:text-primary-700"><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* model */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-neutral-50 px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-neutral-500">Model</p>
            <p className="mt-0.5 text-xs text-neutral-400">Flash is faster; Pro reasons deeper.</p>
          </div>
          <Segmented label="Model" size="sm">
            {(['gemini-2.5-flash', 'gemini-2.5-pro'] as GeminiModel[]).map((m) => (
              <button key={m} type="button" onClick={() => setCfg({ ...cfg, model: m })}
                aria-pressed={cfg.model === m} className={segItem(cfg.model === m, 'sm')}>
                {m.replace('gemini-2.5-', '')}
              </button>
            ))}
          </Segmented>
        </div>
      </div>
    </div>
  )
}

export default function InviteWizard() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const [step, setStep] = useState(1)

  // Step 1 — mode is preselected when returning from the avatar Setup page.
  const [mode, setMode] = useState<Mode | ''>(
    (location.state as { mode?: Mode } | null)?.mode ?? '',
  )
  const [role, setRole] = useState('')
  // Single interview (default, unchanged behavior) vs. an ordered set of rounds
  // (multi) — round modes are chosen per-round in Step 2, not here.
  const [setupType, setSetupType] = useState<'single' | 'multi'>('single')
  // Video Avatar requires an APPLIED avatar setup (configured once, applies to
  // every candidate in the batch) — gate the mode card on it.
  const avatarApplied = useQuery({ queryKey: ['avatar-settings'], queryFn: settingsApi.avatarStatus })

  // Step 2
  const [source, setSource] = useState<Source | ''>('')
  const [cfg, setCfg] = useState<TailorConfig>({ style: 'mix', techCount: 5, nonTechCount: 3, difficulty: 'mixed', domains: [], model: 'gemini-2.5-flash' })
  const [selectedSetId, setSelectedSetId] = useState('')
  const [selectedMcqSetId, setSelectedMcqSetId] = useState('')
  const [genOpen, setGenOpen] = useState(false)
  // Step 2 (multi) — the ordered rounds being authored; modes/config are per-round.
  const [rounds, setRounds] = useState<RoundDraft[]>(defaultRounds())

  // Step 3
  const [candidates, setCandidates] = useState<{ id: string; email: string; role: string }[]>([])
  const [manualEmail, setManualEmail] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [extracting, setExtracting] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<CreateInvitesResult | null>(null)
  const [retrying, setRetrying] = useState<Set<string>>(new Set())

  // Step 4 — the invite email config (a full template draft; server ignores the
  // synthetic id/owner/timestamps). Preloaded with the sensible default; the recruiter
  // can load/save their own saved templates in the step itself.
  const [emailDraft, setEmailDraft] = useState<InviteEmailTemplate>(() => ({
    id: 'draft',
    recruiterId: '',
    createdAt: '',
    updatedAt: '',
    ...defaultInviteEmailTemplate(),
  }))

  const sets = useQuery({ queryKey: ['question-sets'], queryFn: questionSetsApi.list, enabled: step === 2 && mode !== 'two_way' })
  // MCQ papers are a separate, owner-scoped collection — see mcqSetsApi.
  const mcqSets = useQuery({ queryKey: ['mcq-sets'], queryFn: mcqSetsApi.list, enabled: step === 2 && mode === 'mcq' })

  const validCount = candidates.filter((c) => emailOk(c.email)).length
  const validCandidates = candidates.filter((c) => emailOk(c.email)).map((c) => ({ email: c.email.trim(), role: c.role.trim() || role }))
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

  const mergeRows = (incoming: { email: string; role: string }[]) => {
    setCandidates((prev) => {
      const seen = new Set(prev.map((c) => c.email.trim().toLowerCase()))
      const add = incoming
        .filter((r) => r.email.trim() && !seen.has(r.email.trim().toLowerCase()))
        .map((r) => ({ id: crypto.randomUUID(), email: r.email.trim(), role: (r.role || role).trim() }))
      return [...prev, ...add]
    })
  }

  const onFile = async (f: File | null) => {
    setFileError(null); setWarnings([])
    if (!f) return
    setExtracting(true)
    try {
      const before = candidates.length
      const result = await invitesApi.extract(f, role)
      mergeRows(result.rows)
      setWarnings(result.warnings)
      if (!result.rows.length) setFileError('No email addresses found in that file.')
      else toast.success(`Found ${result.rows.length} email${result.rows.length === 1 ? '' : 's'}`)
      void before
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
    setCandidates((prev) => [...prev, { id: crypto.randomUUID(), email: e, role }])
    setManualEmail('')
  }

  const submit = async () => {
    if (setupType === 'multi') {
      if (validCount === 0 || !step2ValidMulti) return
      if (!emailLocked.ok) { toast.error(`The invite email is missing the interview link (${emailLocked.missing.join(', ')})`); return }
      setCreating(true)
      try {
        const pipeline = await pipelinesApi.create({ role: role.trim(), rounds: toRoundDefs(rounds) })
        const res = await pipelinesApi.inviteRound1(pipeline.id, {
          candidates: validCandidates,
          origin: getCandidateLinkOrigin(),
          emailConfig: emailConfigPayload(),
          sendEmails: true,
        })
        setResult({
          testId: pipeline.id,
          created: res.created,
          emailed: res.emailed,
          dryRun: res.dryRun,
        } as CreateInvitesResult)
        toast.success(`Pipeline created — invited ${res.created.length} to Round 1`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not create the pipeline')
      } finally {
        setCreating(false)
      }
      return
    }
    // Two-way Interview has no scripted question source (live recruiter-led
    // call) — every other mode requires one.
    if (!mode || (mode !== 'two_way' && mode !== 'mcq' && !source) || validCount === 0) return
    if (mode === 'mcq' && !selectedMcqSetId) { toast.error('Pick an MCQ set first'); return }
    if (!emailLocked.ok) { toast.error(`The invite email is missing the interview link (${emailLocked.missing.join(', ')})`); return }
    setCreating(true)
    try {
      const res = await invitesApi.create({
        mode: mode as Mode,
        role: role.trim(),
        // Neither two-way nor MCQ has a question SOURCE to send: one has no scripted
        // questions at all, the other references a pre-authored paper by id.
        ...(mode !== 'two_way' && mode !== 'mcq' ? { source: source as Source } : {}),
        ...(mode === 'mcq' ? { mcqSetId: selectedMcqSetId } : {}),
        config: source === 'tailor' ? { style: cfg.style, techCount: cfg.techCount, nonTechCount: cfg.nonTechCount, difficulty: cfg.difficulty, domains: cfg.domains, model: cfg.model } : undefined,
        questionSetId: source === 'set' ? selectedSetId : undefined,
        candidates: validCandidates,
        origin: getCandidateLinkOrigin(),
        emailConfig: emailConfigPayload(),
        sendEmails: true,
      })
      setResult(res)
      toast.success(`Created ${res.created.length} invite${res.created.length === 1 ? '' : 's'}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create invites')
    } finally {
      setCreating(false)
    }
  }

  const retryOne = async (id: string) => {
    setRetrying((s) => new Set(s).add(id))
    try {
      const r = await invitesApi.retry(id, { role: role.trim(), origin: getCandidateLinkOrigin(), emailConfig: emailConfigPayload() })
      setResult((prev) => prev && ({
        ...prev,
        emailed: prev.emailed + (r.sent ? 1 : 0),
        created: prev.created.map((c) => c.id === id ? { ...c, sent: r.sent, status: r.status as CreateInvitesResult['created'][number]['status'], error: r.error } : c),
      }))
      if (r.sent) toast.success(`Resent to ${r.email}`)
      else toast.error(r.error || 'Retry failed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Retry failed')
    } finally {
      setRetrying((s) => { const n = new Set(s); n.delete(id); return n })
    }
  }

  // ── Autopilot instrumentation (additive; no existing behavior changes) ──
  // Autopilot reads the LATEST wizard state through this ref (registered once).
  const apStateRef = useRef({ step, setupType, mode, role, source, selectedSetId, candidates, cfg, step1Valid: false, step2Valid: false, step2ValidMulti: false, validCount: 0, emailLockedOk: false })
  // (.current is refreshed BELOW, after the validity flags are computed each render)

  // Add a candidate by explicit email/role (Autopilot path; mirrors addManual's dedupe).
  const addCandidateDirect = (email: string, r: string) => {
    const e = email.trim().toLowerCase()
    if (!e) return
    setCandidates((cs) => (cs.some((c) => c.email.toLowerCase() === e) ? cs : [...cs, { id: crypto.randomUUID(), email: email.trim(), role: (r || role).trim() }]))
  }
  // Advance only if the current step is valid (else no-op; Autopilot re-reads state and asks).
  const guardedNext = () => {
    // Read validity from the live ref — NOT the render closure (the action defs are
    // registered once, so a closure read would be frozen at first-render values).
    // Mirrors the REAL wizard's per-step Next gating exactly, so Autopilot can
    // never skip past Candidates with 0 recipients or a broken invite email.
    const s = apStateRef.current
    const ok =
      s.step === 1 ? s.step1Valid
      : s.step === 2 ? (s.setupType === 'multi' ? s.step2ValidMulti : s.step2Valid)
      : s.step === 3 ? s.validCount > 0
      : s.step === 4 ? s.emailLockedOk
      : true
    if (ok) setStep((n) => Math.min(n + 1, STEPS.length))
  }

  // Route the memoized action defs through this ref so they always invoke the
  // CURRENT render's handlers — a stale guardedNext saw step1Valid=false forever
  // (silent nextStep no-op), and a stale submit() would send first-render state.
  const apFnsRef = useRef({ guardedNext, addCandidateDirect, submit })
  apFnsRef.current = { guardedNext, addCandidateDirect, submit }

  const apActions = useMemo(() => ({
    setInterviewType: { description: 'Choose Single Interview or Multiple Rounds', params: [{ name: 'type', type: 'enum' as const, enum: ['single', 'multi'], required: true }], run: (a: any) => setSetupType(a.type) },
    selectMode: { description: 'Select the interview mode', params: [{ name: 'mode', type: 'enum' as const, enum: MODES.map((m) => m.value), required: true }], run: (a: any) => setMode(a.mode) },
    setRole: { description: 'Set the candidate role/title', params: [{ name: 'role', type: 'string' as const, required: true }], run: (a: any) => setRole(a.role) },
    setQuestionSource: { description: 'Choose question source: tailor (adaptive) or set (a saved question set)', params: [{ name: 'source', type: 'enum' as const, enum: ['tailor', 'set'], required: true }], run: (a: any) => setSource(a.source) },
    selectQuestionSet: { description: 'Pick a saved question set by id', params: [{ name: 'id', type: 'string' as const, required: true }], run: (a: any) => setSelectedSetId(a.id) },
    addCandidate: { description: 'Add a candidate by email', params: [{ name: 'email', type: 'string' as const, required: true }, { name: 'role', type: 'string' as const }], run: (a: any) => apFnsRef.current.addCandidateDirect(a.email, a.role) },
    nextStep: { description: 'Advance to the next step (only if the current step is complete)', params: [], run: () => apFnsRef.current.guardedNext() },
    backStep: { description: 'Go back one step', params: [], run: () => setStep((n) => Math.max(1, n - 1)) },
    createInvites: { description: 'Create and SEND the invites for the added candidates', sideEffect: true, params: [], run: () => { void apFnsRef.current.submit() } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  // Memoized so `useAutopilotActions` registers ONCE (getState reads the live ref,
  // so a stable identity still returns current values — no per-render re-register).
  const apGetState = useCallback(() => {
    const s = apStateRef.current
    return {
      step: s.step, interviewType: s.setupType, mode: s.mode, role: s.role,
      questionSource: s.source, questionSetId: s.selectedSetId,
      candidateCount: s.candidates.length, candidates: s.candidates.map((c) => c.email),
      stepName: ['', 'Basics', 'Questions', 'Candidates', 'Invite email', 'Review'][s.step] ?? '',
      // Hard signal for the agent: the current step's required fields are done —
      // when true, its next move should be setup.nextStep (no permission-asking).
      stepComplete: s.step === 1 ? s.step1Valid
        : s.step === 2 ? (s.setupType === 'multi' ? s.step2ValidMulti : s.step2Valid)
        : s.step === 3 ? s.validCount > 0
        : s.step === 4 ? s.emailLockedOk
        : true,
    }
  }, [])
  const apOpts = useMemo(() => ({ getState: apGetState }), [apGetState])
  useAutopilotActions('setup', apActions, apOpts)

  const step1Valid = setupType === 'single'
    ? !!mode && role.trim().length >= 2
    : role.trim().length >= 2 // multi: mode is per-round (chosen in Step 2)
  const tailorTotal = cfg.style === 'mix' ? cfg.techCount + cfg.nonTechCount : cfg.style === 'technical' ? cfg.techCount : cfg.nonTechCount
  // Two-way Interview has no scripted question source to pick — it's a live
  // recruiter-led call, so Step 2 has nothing to require here.
  const step2Valid = mode === 'two_way'
    ? true
    // MCQ has no résumé-tailored path: the paper is authored in advance, with its
    // answers, so the only thing to choose is which paper.
    : mode === 'mcq' ? !!selectedMcqSetId
    : source === 'tailor' ? tailorTotal >= 1 && tailorTotal <= 25 : source === 'set' ? !!selectedSetId : false
  const step2ValidMulti = rounds.length >= 1 && rounds.every((r) => r.name.trim().length >= 1 && !!r.mode)

  // Refresh the Autopilot state ref AFTER the validity flags exist — every render.
  apStateRef.current = { step, setupType, mode, role, source, selectedSetId, candidates, cfg, step1Valid, step2Valid, step2ValidMulti, validCount, emailLockedOk: emailLocked.ok }

  return (
    <div className="mx-auto max-w-[900px] px-6 py-8">
      <button onClick={() => navigate('/sessions')} className="mb-5 inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-neutral-500 transition-colors duration-150 hover:text-neutral-900">
        <ArrowLeft size={15} /> Back to sessions
      </button>

      <div className="mb-6">
        <span className="pill mb-2.5 inline-flex">Invite candidates</span>
        <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-neutral-900">Set up an interview & invite</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-500">
          Configure the interview once, add your recipients, then send every invitation from one place.
        </p>
      </div>

      {!result && (
        <div className="mb-7">
          <Stepper step={step} />
        </div>
      )}

      {!result && step <= 3 && (
        <div className="mb-7 flex items-start gap-3 rounded-2xl border border-primary-100 bg-primary-50/60 p-4 text-sm text-neutral-600">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700"><Info size={15} /></span>
          <p className="leading-relaxed">
            You don’t upload résumés here. Configure the interview once, then invite candidates by email —
            <span className="font-medium text-neutral-800"> each candidate uploads their own résumé when they begin</span>, and the interview auto-configures to these settings.
          </p>
        </div>
      )}

      {/* ── Success ── */}
      {result && (
        <div className="space-y-5">
          <div className="rounded-3xl border border-mint-border bg-mint-bg/70 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-mint text-mint-ink shadow-mint-sm"><CheckCircle2 size={28} /></div>
            <h2 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-neutral-900">
              <span className="tabular-nums">{result.created.length}</span> invite{result.created.length === 1 ? '' : 's'} created
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-600">
              {result.dryRun
                ? 'Emails are in dry-run — nothing has been sent yet. Add the SMTP login and a verified sender to send for real.'
                : <><span className="font-semibold tabular-nums text-neutral-800">{result.emailed}</span> invitation email{result.emailed === 1 ? '' : 's'} sent. Candidates can start as soon as they open their link.</>}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="badge badge-neutral">Batch <span className="ml-1 font-mono">{result.testId.slice(0, 8)}</span></span>
              {result.dryRun && <span className="badge badge-warning">Dry run</span>}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-neutral-50 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-500">
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
                    <tr key={c.id} className="h-12 border-b border-border last:border-0 transition-colors duration-150 hover:bg-neutral-50">
                      <td className="px-4 text-neutral-800">{c.email}</td>
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
                      <td className="px-4"><span className="block max-w-[300px] truncate font-mono text-xs text-neutral-500">{c.link}</span></td>
                      <td className="px-4 text-right">
                        <button onClick={() => { navigator.clipboard.writeText(c.link); toast.success('Link copied') }} className="rounded-lg p-1.5 text-neutral-400 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-800" aria-label={`Copy invite link for ${c.email}`}><Copy size={14} /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button variant="secondary" icon={<Copy size={15} />} onClick={() => { navigator.clipboard.writeText(result.created.map((c) => `${c.email}: ${c.link}`).join('\n')); toast.success('All links copied') }}>Copy all links</Button>
            <Button onClick={() => navigate('/sessions')}>Done</Button>
          </div>
        </div>
      )}

      {/* ── Step 1 ── */}
      {!result && step === 1 && (
        <div className="space-y-8">
          <StepSection title="Interview type" hint="One interview, or an ordered set of rounds.">
            <div className="grid max-w-lg grid-cols-1 gap-3 sm:grid-cols-2">
              {(['single', 'multi'] as const).map((t) => (
                <SelectCard
                  key={t}
                  selected={setupType === t}
                  onClick={() => setSetupType(t)}
                  icon={t === 'single' ? <Target size={20} /> : <Workflow size={20} />}
                  title={t === 'single' ? 'Single Interview' : 'Multiple Rounds'}
                  blurb={t === 'single' ? 'One interview per candidate (default).' : 'Screening → … → Final, with advancement.'}
                />
              ))}
            </div>
          </StepSection>

          {setupType === 'single' && (
            <StepSection title="Interview mode" hint="How the interview is conducted.">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {MODES.map((m) => (
                  <SelectCard
                    key={m.value}
                    selected={mode === m.value}
                    onClick={() => {
                      // Video Avatar needs an applied avatar setup first — send the
                      // recruiter to the Setup page, then return here with the mode
                      // preselected once they've applied it.
                      if (m.value === 'video_avatar' && !avatarApplied.data?.configured) {
                        toast('Configure your AI avatar once — it then applies to every candidate in this batch.')
                        navigate('/setup', { state: { returnTo: '/sessions/new' } })
                        return
                      }
                      setMode(m.value)
                    }}
                    icon={m.icon}
                    title={m.label}
                    blurb={m.blurb}
                  >
                    {m.value === 'video_avatar' && mode === m.value && avatarApplied.data?.configured && (
                      <span className="mt-2 flex items-center gap-1 text-xs font-medium text-primary-700">
                        <Check size={12} strokeWidth={3} className="flex-shrink-0" /> Uses your applied avatar —{' '}
                        <span role="link" tabIndex={0} className="cursor-pointer font-semibold underline underline-offset-2"
                          onClick={(e) => { e.stopPropagation(); navigate('/setup', { state: { returnTo: '/sessions/new' } }) }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); navigate('/setup', { state: { returnTo: '/sessions/new' } }) } }}>
                          edit avatar setup
                        </span>
                      </span>
                    )}
                  </SelectCard>
                ))}
              </div>
            </StepSection>
          )}

          <section>
            <div className="mb-4">
              <label htmlFor="role" className="block font-display text-base font-extrabold tracking-[-0.02em] text-neutral-900">Candidate role</label>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-neutral-500">The position you’re interviewing for. Every invite in this batch uses it (you can override per candidate in Step 3).</p>
            </div>
            <input id="role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Senior Backend Engineer" className="input-base max-w-md" autoFocus />
          </section>

          <StepFooter
            left={<Button variant="ghost" onClick={() => navigate('/sessions')}>Cancel</Button>}
            hint={step1Valid ? undefined : setupType === 'single' ? 'Pick a mode and name the role to continue.' : 'Name the role to continue.'}
            right={<Button disabled={!step1Valid} onClick={() => setStep(2)}>Next: Questions <ArrowRight size={15} /></Button>}
          />
        </div>
      )}

      {/* ── Step 2: question source (single) / round builder (multi) ── */}
      {!result && step === 2 && (
        <div className="space-y-8">
          {setupType === 'multi' ? (
            <>
              <StepSection title="Rounds" hint="The order candidates advance through. Each round has its own mode and advancement rule.">
                <RoundBuilder rounds={rounds} onChange={setRounds} />
              </StepSection>
              <StepFooter
                left={<Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(1)}>Back</Button>}
                hint={step2ValidMulti ? undefined : 'Give every round a name and a mode to continue.'}
                right={<Button disabled={!step2ValidMulti} onClick={() => setStep(3)}>Next: Candidates <ArrowRight size={15} /></Button>}
              />
            </>
          ) : (
            <>
              {mode === 'mcq' ? (
                /* MCQ: one choice, which paper. There is no résumé-tailored path
                   here because a multiple-choice question needs its options and its
                   correct answer authored in advance — generated-per-candidate
                   options would have no key to score against. */
                <div>
                  <StepSection
                    title="Choose the MCQ paper"
                    hint="Authored in MCQ sets, with the answers. Scored the moment a candidate submits — no model, no waiting."
                  >
                    {mcqSets.isLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-[62px]" />
                        <Skeleton className="h-[62px]" />
                      </div>
                    ) : (mcqSets.data ?? []).length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 px-5 py-6 text-center">
                        <p className="text-sm font-semibold text-neutral-900">No MCQ sets yet</p>
                        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-neutral-500">
                          Build one in MCQ sets — questions, options and the correct answer — then it appears here.
                        </p>
                        <Button className="mt-3" size="sm" variant="outline" onClick={() => navigate('/mcq-sets')}>
                          Go to MCQ sets
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(mcqSets.data ?? []).map((set) => {
                          const sel = selectedMcqSetId === set.id
                          const points = set.questions.reduce((sum, q) => sum + (q.points ?? 1), 0)
                          return (
                            <button
                              key={set.id}
                              type="button"
                              onClick={() => setSelectedMcqSetId(set.id)}
                              className={cn(
                                'flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-colors duration-150',
                                sel
                                  ? 'border-primary-700 bg-primary-50/40 ring-1 ring-primary-700'
                                  : 'border-border bg-white hover:border-neutral-300',
                              )}
                            >
                              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                                <ListChecks size={17} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold text-neutral-900">{set.name}</span>
                                <span className="mt-0.5 block text-xs text-neutral-500">
                                  {set.questions.length} question{set.questions.length === 1 ? '' : 's'} · {points} point{points === 1 ? '' : 's'}
                                </span>
                              </span>
                              {sel && <Check size={16} className="flex-shrink-0 text-primary-700" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </StepSection>
                </div>
              ) : mode === 'two_way' ? (
                <div className="flex items-start gap-3.5 rounded-2xl border border-border bg-white p-5 shadow-xs">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><Users size={20} /></span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-neutral-900">No scripted questions to configure</p>
                    <p className="mt-1 text-sm leading-relaxed text-neutral-500">
                      Two-way Interview is a live recruiter-led video call — there’s no résumé-tailored or saved
                      question set to pick here. Continue to invite candidates.
                    </p>
                  </div>
                </div>
              ) : (
                <StepSection title="Question source" hint="Generate a bespoke set per candidate, or reuse one you’ve already built.">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <SelectCard
                      selected={source === 'tailor'}
                      onClick={() => setSource('tailor')}
                      icon={<FileText size={20} />}
                      title="Tailor questions to each résumé"
                      blurb="Each candidate uploads their own résumé when they begin. We generate a unique set tailored to that person’s background and your settings — so every candidate gets bespoke questions."
                    />
                    <SelectCard
                      selected={source === 'set'}
                      onClick={() => setSource('set')}
                      icon={<Layers size={20} />}
                      title="Your question sets"
                      blurb="Reuse a question set you’ve saved. Build sets from a sample résumé or by configuring them manually — your sets are private to your account."
                    />
                  </div>

                  {/* Tailor config */}
                  {source === 'tailor' && <TailorConfigPanel role={role} cfg={cfg} setCfg={setCfg} />}

                  {/* Set picker */}
                  {source === 'set' && (
                    <div className="mt-4 rounded-2xl border border-border bg-white p-5 shadow-xs">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold leading-tight text-neutral-900">Choose a question set</h3>
                          <p className="mt-0.5 text-xs text-neutral-500">Every candidate in this batch answers the same questions.</p>
                        </div>
                        <Button size="xs" variant="secondary" icon={<Plus size={13} />} onClick={() => setGenOpen(true)}>Create new set</Button>
                      </div>
                      {sets.isLoading ? (
                        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
                      ) : !sets.data?.length ? (
                        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-neutral-50 px-6 py-8 text-center">
                          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-primary-100 bg-primary-50 text-primary-700"><Layers size={20} /></span>
                          <div>
                            <p className="text-sm font-bold text-neutral-900">No question sets yet</p>
                            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-neutral-500">Build one from a sample résumé or configure it manually — it stays private to your account.</p>
                          </div>
                          <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setGenOpen(true)}>Create a question set</Button>
                        </div>
                      ) : (
                        <div className="max-h-[40vh] space-y-2 overflow-y-auto">
                          {sets.data.map((s: QuestionSet) => {
                            const sel = selectedSetId === s.id
                            return (
                              <button key={s.id} type="button" onClick={() => setSelectedSetId(s.id)} aria-pressed={sel}
                                className={cn('flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150',
                                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-1',
                                  sel ? 'border-primary-700 bg-primary-50 ring-1 ring-primary-700' : 'border-border hover:border-primary-300 hover:bg-neutral-50')}>
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold text-neutral-900">{s.name}</span>
                                  <span className="mt-0.5 block text-xs text-neutral-500"><span className="tabular-nums">{s.questions.length}</span> question{s.questions.length !== 1 ? 's' : ''}</span>
                                </span>
                                <span className={cn('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors duration-150', sel ? 'bg-primary-700 text-white' : 'border border-border')}>
                                  {sel && <Check size={12} strokeWidth={3} />}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </StepSection>
              )}

              <StepFooter
                left={<Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(1)}>Back</Button>}
                hint={step2Valid ? undefined : mode === 'mcq' ? 'Pick an MCQ paper to continue.' : !source ? 'Choose a question source to continue.' : source === 'set' ? 'Pick a question set to continue.' : 'Set a question count between 1 and 25 to continue.'}
                right={<Button disabled={!step2Valid} onClick={() => setStep(3)}>Next: Candidates <ArrowRight size={15} /></Button>}
              />

              {mode !== 'two_way' && (
                <GenerateFromResumeModal
                  open={genOpen}
                  onClose={() => setGenOpen(false)}
                  defaultRole={role}
                  onSaved={(set) => { qc.invalidateQueries({ queryKey: ['question-sets'] }); setSelectedSetId(set.id); setGenOpen(false) }}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* ── Step 3: candidates ── */}
      {!result && step === 3 && (
        <div className="space-y-8">
          <StepSection
            title="Add candidates"
            hint="Upload a file of candidate emails (CSV, Excel, PDF, DOCX, or text) — we extract each email and role — or add them manually. Review everything below before inviting."
          >
            <div
              onClick={() => !extracting && fileInput.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void onFile(e.dataTransfer.files?.[0] ?? null) }}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed p-8 text-center transition-all duration-150',
                dragOver
                  ? 'border-primary-700 bg-primary-50'
                  : 'border-border bg-neutral-50 hover:border-primary-200 hover:bg-primary-50/40',
                extracting && 'pointer-events-none opacity-70',
              )}
            >
              <span className={cn('flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors duration-150',
                dragOver ? 'border-primary-200 bg-white text-primary-700' : 'border-border bg-white text-primary-700')}>
                {extracting ? <Loader2 size={22} className="animate-spin" /> : <UploadCloud size={22} />}
              </span>
              <span className="text-sm font-semibold text-neutral-800">{extracting ? 'Reading your file…' : 'Drag a file here, or click to choose'}</span>
              <span className="text-xs text-neutral-400">CSV · Excel · PDF · DOCX · TXT — max 10 MB</span>
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
          </StepSection>

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

          {candidates.length > 0 && (
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-neutral-900">
                  <span className="tabular-nums">{candidates.length}</span> candidate{candidates.length === 1 ? '' : 's'}
                  <span className="ml-2 text-xs font-normal text-neutral-500">
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

              <div className="max-h-[46vh] overflow-y-auto overflow-x-auto rounded-2xl border border-border bg-white">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-5">
                    <tr className="border-b border-border bg-neutral-50 text-left text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                      <th className="w-12 px-4 py-2.5 font-bold"><span className="sr-only">Status</span></th>
                      <th className="px-4 py-2.5 font-bold">Email</th>
                      <th className="px-4 py-2.5 font-bold">Role</th>
                      <th className="w-12 px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => {
                      const ok = emailOk(c.email)
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
                              className={cn('w-full rounded-lg border bg-white px-2.5 py-1.5 font-mono text-xs text-neutral-800 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary-700/20',
                                ok ? 'border-transparent hover:border-border focus:border-primary-700' : 'border-danger bg-danger-bg/40')} />
                          </td>
                          <td className="px-4">
                            <input value={c.role} onChange={(e) => setCandidates((cs) => cs.map((x) => x.id === c.id ? { ...x, role: e.target.value } : x))}
                              aria-label="Candidate role"
                              placeholder={role}
                              className="w-full rounded-lg border border-transparent bg-white px-2.5 py-1.5 text-xs text-neutral-700 transition-colors duration-150 hover:border-border focus:border-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-700/20" />
                          </td>
                          <td className="px-4 text-right">
                            <button onClick={() => setCandidates((cs) => cs.filter((x) => x.id !== c.id))} className="rounded-lg p-1.5 text-neutral-300 transition-colors duration-150 hover:bg-danger-bg hover:text-danger" aria-label={`Remove ${c.email || 'candidate'}`}><Trash2 size={14} /></button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <StepFooter
            left={<Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(2)}>Back</Button>}
            hint={validCount > 0 ? undefined : 'Add at least one valid email address to continue.'}
            right={<Button disabled={validCount === 0} onClick={() => setStep(4)}>Next: Invite email <ArrowRight size={15} /></Button>}
          />
        </div>
      )}

      {/* ── Step 4: invite email ── */}
      {!result && step === 4 && (
        <div className="space-y-8">
          <StepSection
            title="Configure the invite email"
            hint="Set the sender, subject, message, button, and branding — then preview and send yourself a test. Each candidate’s unique interview link and the “use this exact email” note are added automatically and can’t be removed."
          >
            <InviteEmailStep
              draft={emailDraft}
              onChange={setEmailDraft}
              role={role}
              sampleEmail={sampleEmail}
              origin={getCandidateLinkOrigin()}
            />
          </StepSection>

          <StepFooter
            left={<Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(3)}>Back</Button>}
            hint={emailLocked.ok ? undefined : 'Add the interview link back into the email to continue.'}
            right={<Button disabled={!emailLocked.ok} onClick={() => setStep(5)}>Next: Review <ArrowRight size={15} /></Button>}
          />
        </div>
      )}

      {/* ── Step 5: review & send ── */}
      {!result && step === 5 && (
        <div className="space-y-8">
          <StepSection title="Review & send" hint="Confirm the recipients and the email below, then send. Invitations go out immediately.">
            <ReviewSend candidates={validCandidates} draft={emailDraft} role={role} origin={getCandidateLinkOrigin()} />
          </StepSection>

          <StepFooter
            left={<Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(4)}>Back</Button>}
            hint={validCount === 0 ? 'Add at least one valid recipient in the Candidates step.' : !emailLocked.ok ? 'The invite email is missing the interview link.' : undefined}
            right={
              <Button loading={creating} disabled={validCount === 0 || !emailLocked.ok} onClick={submit}>
                Send {validCount > 0 ? `${validCount} ` : ''}invite{validCount === 1 ? '' : 's'}
              </Button>
            }
          />
        </div>
      )}
    </div>
  )
}

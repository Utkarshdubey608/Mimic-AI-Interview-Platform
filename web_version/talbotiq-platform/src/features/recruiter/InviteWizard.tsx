import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  // COD-OFF: Code2 (the Coding mode icon)
  MessageSquare, Mic, Video, Clock, Clapperboard, Users, ArrowLeft, ArrowRight, Check, FileText, Layers, Plus, UploadCloud, Trash2, AlertTriangle, AlertCircle, Loader2, CheckCircle2, Copy, RefreshCw, Info, Target, Workflow, X, ListChecks,
} from 'lucide-react'
import { Button, Input, Skeleton, Badge, cn } from '@/components/ui'
import { WizardStepper, StepSection, SelectCard, StepFooter, type WizardStep } from './wizard-ui'
// COD-OFF: `codingApi` — restore with the commented-out codingProblems query below.
import { mcqSetsApi, questionSetsApi, invitesApi, settingsApi, pipelinesApi, essayPromptsApi, roleConfigsApi } from '@/lib/api'
import { getCandidateLinkOrigin } from '@/lib/candidateOrigin'
import { GenerateFromResumeModal } from './GenerateFromResumeModal'
import { InviteEmailStep } from './invite-email/InviteEmailStep'
import { ReviewSend } from './invite-email/ReviewSend'
import { RoundBuilder, defaultRounds, toRoundDefs, type RoundDraft } from './RoundBuilder'
import { defaultInviteEmailTemplate, validateLockedTokens } from '@shared/inviteEmail'
import type { TrackType, QuestionStyle, DifficultyChoice, GeminiModel, QuestionSet, CreateInvitesResult, InviteEmailTemplate, InterviewDevice } from '@shared/types'
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

type Mode = Extract<TrackType, 'chatbot' | 'voice' | 'video_avatar' | 'chat' | 'video' | 'two_way' | 'mcq' | 'coding' | 'essay'>
type Source = 'tailor' | 'set' | 'mixed'

const MODES: { value: Mode; label: string; blurb: string; icon: React.ReactNode }[] = [
  { value: 'chatbot',      label: 'Chatbot',      blurb: 'Conversational, typed — ChatGPT-style.',   icon: <MessageSquare size={20} /> },
  { value: 'voice',        label: 'Voice',        blurb: 'Live spoken AI interviewer (Gemini Live).', icon: <Mic size={20} /> },
  { value: 'video_avatar', label: 'Video Avatar', blurb: 'Conversational AI video avatar (Tavus).',   icon: <Video size={20} /> },
  { value: 'chat',         label: 'Timed Q&A',    blurb: '30s prep + timed answers (HireVue-style).', icon: <Clock size={20} /> },
  { value: 'mcq',          label: 'Assessment',   blurb: 'Sections of closed questions, scored instantly.', icon: <ListChecks size={20} /> },
  // COD-OFF: { value: 'coding', label: 'Coding', blurb: 'Solve problems in an editor, run against tests.', icon: <Code2 size={20} /> },
  { value: 'video',        label: 'Video Interview', blurb: 'Candidate records webcam answers per question.', icon: <Clapperboard size={20} /> },
  { value: 'two_way',      label: 'Two-way Interview', blurb: 'Live recruiter ↔ candidate video interview.', icon: <Users size={20} /> },
  { value: 'essay',        label: 'Essay Writing', blurb: 'One long written answer, marked against your notes.', icon: <FileText size={20} /> },
]

const STYLES: { value: QuestionStyle; label: string }[] = [
  { value: 'technical', label: 'Technical' },
  { value: 'non_technical', label: 'Non-technical' },
  { value: 'mix', label: 'Mix' },
]
const DIFFICULTIES: DifficultyChoice[] = ['easy', 'medium', 'hard', 'mixed']

const STEPS: readonly WizardStep[] = [
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

/** Segmented pill group — one row of mutually exclusive choices (button semantics kept). */
function Segmented({ label, children, size = 'md' }: { label: string; children: React.ReactNode; size?: 'sm' | 'md' }) {
  return (
    <div className={cn('flex rounded-full bg-surface-hover p-1', size === 'sm' && 'p-0.5')} role="group" aria-label={label}>
      {children}
    </div>
  )
}
const segItem = (selected: boolean, size: 'sm' | 'md' = 'md') => cn(
  'flex-1 rounded-full font-semibold transition-all duration-150 whitespace-nowrap',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1',
  size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
  selected ? 'bg-action text-action-ink shadow-primary-sm' : 'text-ink-muted hover:text-ink',
)

/**
 * Which clients a candidate may take the interview on.
 *
 * Multi-select rather than a single choice, because the useful restrictions are
 * "apps only" and "browser only" as much as any one device.
 *
 * Deselecting everything is not offered: the last remaining device cannot be turned
 * off. An interview nobody can take is never what the recruiter meant, and the state
 * is easier to prevent than to explain.
 */
const DEVICE_OPTIONS: { id: InterviewDevice; label: string; hint: string }[] = [
  { id: 'web',     label: 'Web browser', hint: 'Any computer or phone browser' },
  { id: 'mobile',  label: 'Mobile app',  hint: 'The Mimic app on a phone' },
  { id: 'desktop', label: 'Desktop app', hint: 'The Mimic app on a computer' },
]

function DevicePicker({
  value,
  onChange,
}: {
  value: InterviewDevice[]
  onChange: (next: InterviewDevice[]) => void
}) {
  const toggle = (id: InterviewDevice) => {
    const next = value.includes(id) ? value.filter((d) => d !== id) : [...value, id]
    if (next.length === 0) return   // never leave an interview nobody can take
    onChange(next)
  }

  const unrestricted = value.length === DEVICE_OPTIONS.length

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {DEVICE_OPTIONS.map((option) => {
          const on = value.includes(option.id)
          const isLast = on && value.length === 1
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => toggle(option.id)}
              aria-pressed={on}
              // The last one on cannot be turned off, and saying so beats a click
              // that silently does nothing.
              title={isLast ? 'At least one device has to stay selected' : undefined}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-left transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                on
                  ? 'border-action-edge bg-action-soft'
                  : 'border-border bg-surface hover:border-rule-strong',
                isLast && 'cursor-not-allowed',
              )}
            >
              {/* A REAL CHECKBOX MARK, drawn in both states.
                  Colour alone was carrying this and it could not: selected was a
                  near-black hairline on #F1F3F7 against an unselected light-grey
                  hairline on white, and with all three on — the default — the row
                  read as three identical cards. Reported as being unable to tell
                  what was selected, which it was.
                  Drawn EMPTY when off rather than appearing only when on, because
                  this is a multi-select: an absent tick has to be distinguishable
                  from a control that has no tick at all. */}
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 grid h-4 w-4 flex-shrink-0 place-items-center rounded border transition-colors duration-150',
                  on ? 'border-action-edge bg-action text-action-ink' : 'border-rule-strong bg-surface',
                )}
              >
                {on && <Check size={11} strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-sm font-semibold', on ? 'text-action-edge' : 'text-ink-body')}>
                  {option.label}
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">{option.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        {unrestricted
          ? 'No restriction — candidates can use whichever they have.'
          : `Candidates will be told to use ${value.length === 1 ? 'this' : 'one of these'} if they open another.`}
      </p>
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
    <div className="mt-4 rounded-2xl border border-border bg-surface p-5 shadow-xs">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-bold leading-tight text-ink">Tailoring settings</h3>
          <p className="mt-0.5 text-xs text-ink-muted">Applied to every candidate’s generated question set.</p>
        </div>
        <Badge variant={total >= 1 && total <= 25 ? 'info' : 'danger'}>
          <span className="tabular-nums">{total}</span> question{total === 1 ? '' : 's'}
        </Badge>
      </div>

      <div className="space-y-5">
        {/* role (read-only, from Step 1) */}
        <div>
          <label className="field-label mb-1.5 block">Role</label>
          <div className="flex h-11 items-center rounded-xl border border-border bg-surface-sunk px-3.5 text-sm text-ink-body">
            <span className="truncate">{role}</span> <span className="ml-2 flex-shrink-0 text-xs text-ink-faint">(set in Step 1)</span>
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
          <label className="field-label mb-1.5 block">Domains <span className="font-normal normal-case tracking-normal text-ink-faint">(optional focus areas)</span></label>
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
                <span key={d} className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-surface-hover py-1 pl-3 pr-2 text-xs font-medium text-ink">
                  {d}
                  <button onClick={() => setCfg({ ...cfg, domains: cfg.domains.filter((x) => x !== d) })} aria-label={`Remove ${d}`} className="rounded-full p-0.5 text-ink-faint transition-colors duration-150 hover:bg-surface-hover hover:text-ink"><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* model */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-sunk px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-ink-muted">Model</p>
            <p className="mt-0.5 text-xs text-ink-faint">Flash is faster; Pro reasons deeper.</p>
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

/** The saved-question-set picker. Shared by `source === 'set'` and Mixed mode's
 *  "use a question set" fixed-question option — one picker, one selection, reused. */
function QuestionSetPicker({ sets, selectedSetId, onSelect, onCreateNew, hint }: {
  sets: { isLoading: boolean; data?: QuestionSet[] }
  selectedSetId: string
  onSelect: (id: string) => void
  onCreateNew: () => void
  hint: string
}) {
  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface p-5 shadow-xs">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-bold leading-tight text-ink">Choose a question set</h3>
          <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>
        </div>
        <Button size="xs" variant="secondary" icon={<Plus size={13} />} onClick={onCreateNew}>Create new set</Button>
      </div>
      {sets.isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : !sets.data?.length ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-surface-sunk px-6 py-8 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-rule bg-surface-hover text-ink"><Layers size={20} /></span>
          <div>
            <p className="text-sm font-bold text-ink">No question sets yet</p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-ink-muted">Build one from a sample résumé or configure it manually — it stays private to your account.</p>
          </div>
          <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={onCreateNew}>Create a question set</Button>
        </div>
      ) : (
        <div className="max-h-[40vh] space-y-2 overflow-y-auto">
          {sets.data.map((s) => {
            const sel = selectedSetId === s.id
            return (
              <button key={s.id} type="button" onClick={() => onSelect(s.id)} aria-pressed={sel}
                className={cn('flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1',
                  sel ? 'border-action bg-surface-hover ring-1 ring-signal' : 'border-border hover:border-rule-strong hover:bg-surface-sunk')}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{s.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted"><span className="tabular-nums">{s.questions.length}</span> question{s.questions.length !== 1 ? 's' : ''}</span>
                </span>
                <span className={cn('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full transition-colors duration-150', sel ? 'bg-action text-action-ink' : 'border border-border')}>
                  {sel && <Check size={12} strokeWidth={3} />}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Mixed mode's configuration (Feature 3): Total / Fixed / Résumé-based counts, the
 * fixed portion sourced from either a saved question set or ad hoc questions typed on
 * the spot, and a read-only "question flow" preview so the split is never a surprise.
 */
function MixedConfigPanel({
  total, fixed, resume, onTotal, onFixed, onResume,
  fixedSource, onFixedSource, questions, onQuestions,
  sets, selectedSetId, onSelectSet, onCreateSet,
}: {
  total: number; fixed: number; resume: number
  onTotal: (n: number) => void; onFixed: (n: number) => void; onResume: (n: number) => void
  fixedSource: 'set' | 'adhoc'; onFixedSource: (s: 'set' | 'adhoc') => void
  questions: string[]; onQuestions: (q: string[]) => void
  sets: { isLoading: boolean; data?: QuestionSet[] }; selectedSetId: string; onSelectSet: (id: string) => void; onCreateSet: () => void
}) {
  const addsUp = fixed >= 0 && resume >= 0 && fixed + resume === total
  const filledQuestions = questions.filter((q) => q.trim()).length
  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
        <div className="mb-4 border-b border-border pb-4">
          <h3 className="text-sm font-bold leading-tight text-ink">Mixed configuration</h3>
          <p className="mt-0.5 text-xs text-ink-muted">Fixed questions first, then résumé-adapted questions — every candidate gets the same fixed portion, plus questions unique to their own background.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input label="Total questions" type="number" min={1} max={25} value={total} onChange={(e) => onTotal(Math.max(1, Number(e.target.value) || 0))} />
          <Input label="Fixed questions" type="number" min={0} max={25} value={fixed} onChange={(e) => onFixed(Math.max(0, Number(e.target.value) || 0))} />
          <Input label="Résumé-based questions" type="number" min={0} max={25} value={resume} onChange={(e) => onResume(Math.max(0, Number(e.target.value) || 0))} />
        </div>
        {!addsUp && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-danger-border bg-danger-bg p-2.5 text-xs leading-relaxed text-danger">
            <AlertCircle size={14} className="mt-px flex-shrink-0" />
            Fixed ({fixed}) + résumé-based ({resume}) must add up to the total ({total}).
          </p>
        )}
        {addsUp && (
          <div className="mt-3 rounded-xl border border-rule bg-surface-sunk p-3 text-xs text-ink-muted">
            <span className="font-semibold text-ink">Question flow — </span>
            {fixed > 0 && <>1–{fixed} fixed{resume > 0 ? ', ' : ''}</>}
            {resume > 0 && <>{fixed + 1}–{total} résumé-adapted</>}
            {fixed === 0 && resume === 0 && 'No questions configured yet.'}
          </div>
        )}
      </div>

      {fixed > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
          <h3 className="mb-3 text-sm font-bold leading-tight text-ink">Fixed questions ({fixed})</h3>
          <Segmented label="Fixed question source">
            <button type="button" onClick={() => onFixedSource('set')} aria-pressed={fixedSource === 'set'} className={segItem(fixedSource === 'set')}>Use a question set</button>
            <button type="button" onClick={() => onFixedSource('adhoc')} aria-pressed={fixedSource === 'adhoc'} className={segItem(fixedSource === 'adhoc')}>Create questions now</button>
          </Segmented>

          {fixedSource === 'set' ? (
            <QuestionSetPicker sets={sets} selectedSetId={selectedSetId} onSelect={onSelectSet} onCreateNew={onCreateSet}
              hint={`The first ${fixed} question${fixed === 1 ? '' : 's'} of the set become the fixed portion.`} />
          ) : (
            <div className="mt-4 space-y-2">
              {questions.map((q, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-surface-hover text-xs font-bold tabular-nums text-ink-muted">{i + 1}</span>
                  <input value={q} onChange={(e) => { const next = [...questions]; next[i] = e.target.value; onQuestions(next) }}
                    placeholder={`Fixed question ${i + 1}`} aria-label={`Fixed question ${i + 1}`} className="input-base flex-1" />
                  <button type="button" onClick={() => onQuestions(questions.filter((_, x) => x !== i))} disabled={questions.length <= 1}
                    className="rounded-lg p-1.5 text-ink-disabled transition-colors duration-150 hover:bg-danger-bg hover:text-danger disabled:opacity-40" aria-label={`Remove question ${i + 1}`}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <Button size="xs" variant="outline" icon={<Plus size={13} />} onClick={() => onQuestions([...questions, ''])}>Add question</Button>
              {filledQuestions !== fixed && (
                <p className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg p-2.5 text-xs leading-relaxed text-warning">
                  <AlertTriangle size={14} className="mt-px flex-shrink-0" />
                  {filledQuestions} of {fixed} fixed question{fixed === 1 ? '' : 's'} written — fill in the rest to continue.
                </p>
              )}
            </div>
          )}
        </div>
      )}
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
  /* Which clients a candidate may take this on. All three selected IS unrestricted,
     which is also what the server stores — so this starts unrestricted and the
     recruiter narrows it only if the interview genuinely needs a particular client. */
  const [devices, setDevices] = useState<InterviewDevice[]>(['web', 'mobile', 'desktop'])
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
  // Mixed mode (Feature 3): a Question-Set-or-ad-hoc FIXED portion (reuses
  // `selectedSetId` above when sourced from a set) followed by a résumé-adapted
  // portion. Total is the source of truth the recruiter edits; the split is what
  // the server actually validates (fixed + resume === total).
  const [mixedTotal, setMixedTotal] = useState(8)
  const [mixedFixed, setMixedFixed] = useState(5)
  const [mixedResume, setMixedResume] = useState(3)
  const [mixedFixedSource, setMixedFixedSource] = useState<'set' | 'adhoc'>('set')
  const [mixedQuestions, setMixedQuestions] = useState<string[]>([''])
  const [selectedMcqSetId, setSelectedMcqSetId] = useState('')
  // COD-OFF: a LIST, not one id — a coding assessment is normally two or three
  // problems, and order is the order a candidate works through them.
  // const [selectedCodingIds, setSelectedCodingIds] = useState<string[]>([])
  const [selectedEssayId, setSelectedEssayId] = useState<string>('')
  const [genOpen, setGenOpen] = useState(false)
  // Step 2 (multi) — the ordered rounds being authored; modes/config are per-round.
  const [rounds, setRounds] = useState<RoundDraft[]>(defaultRounds())

  // Step 3
  const [candidates, setCandidates] = useState<{ id: string; email: string; role: string; roleCategory?: string }[]>([])
  const roleCategories = useQuery({ queryKey: ['role-categories'], queryFn: roleConfigsApi.categories, enabled: step === 3 })
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
  // COD-OFF: coding problems are owner-scoped like MCQ papers, and for the same
  // reason — a problem carries its hidden tests and their expected outputs.
  // const codingProblems = useQuery({ queryKey: ['coding-problems'], queryFn: codingApi.list, enabled: step === 2 && mode === 'coding' })
  const essayPrompts = useQuery({ queryKey: ['essay-prompts'], queryFn: essayPromptsApi.list, enabled: step === 2 && mode === 'essay' })

  // A copied/shared link carries no deadline of its own — the deadline only ever
  // lived in the invite EMAIL's body. A recruiter sharing links directly (dry-run,
  // Slack, WhatsApp) was handing candidates a link with no sense of when it closes.
  // Appended here so copying a link copies what the recruiter already typed for it.
  const linkWithDeadline = (link: string) =>
    emailDraft.deadlineText?.trim() ? `${link} (Deadline: ${emailDraft.deadlineText.trim()})` : link

  const validCount = candidates.filter((c) => emailOk(c.email)).length
  const validCandidates = candidates.filter((c) => emailOk(c.email)).map((c) => ({ email: c.email.trim(), role: c.role.trim() || role, roleCategory: c.roleCategory }))
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

  const mergeRows = (incoming: { email: string; role: string; roleCategory?: string }[]) => {
    setCandidates((prev) => {
      const seen = new Set(prev.map((c) => c.email.trim().toLowerCase()))
      const add = incoming
        .filter((r) => r.email.trim() && !seen.has(r.email.trim().toLowerCase()))
        .map((r) => ({ id: crypto.randomUUID(), email: r.email.trim(), role: (r.role || role).trim(), roleCategory: r.roleCategory }))
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
    // Essay belongs with two-way, MCQ and coding: none of them has a question
    // SOURCE. Leaving it out meant this guard fired on every essay invite and hit
    // a bare `return` — no request, no toast, a Send button that did nothing.
    if (!mode || (mode !== 'two_way' && mode !== 'mcq' && mode !== 'coding' && mode !== 'essay' && !source) || validCount === 0) return
    if (mode === 'mcq' && !selectedMcqSetId) { toast.error('Pick an MCQ set first'); return }
    // COD-OFF: if (mode === 'coding' && selectedCodingIds.length === 0) { toast.error('Pick at least one coding problem'); return }
    if (mode === 'essay' && !selectedEssayId) { toast.error('Pick an essay prompt'); return }
    if (!emailLocked.ok) { toast.error(`The invite email is missing the interview link (${emailLocked.missing.join(', ')})`); return }
    setCreating(true)
    try {
      const res = await invitesApi.create({
        mode: mode as Mode,
        role: role.trim(),
        // Neither two-way nor MCQ has a question SOURCE to send: one has no scripted
        // questions at all, the other references a pre-authored paper by id.
        ...(mode !== 'two_way' && mode !== 'mcq' && mode !== 'coding' && mode !== 'essay' ? { source: source as Source } : {}),
        ...(mode === 'mcq' ? { mcqSetId: selectedMcqSetId } : {}),
        // COD-OFF: ...(mode === 'coding' ? { codingProblemIds: selectedCodingIds } : {}),
        ...(mode === 'essay' ? { essayPromptId: selectedEssayId } : {}),
        config: source === 'tailor' ? { style: cfg.style, techCount: cfg.techCount, nonTechCount: cfg.nonTechCount, difficulty: cfg.difficulty, domains: cfg.domains, model: cfg.model } : undefined,
        questionSetId: source === 'set' ? selectedSetId : undefined,
        ...(source === 'mixed' ? {
          mixedConfig: {
            totalQuestions: mixedTotal,
            fixedQuestionCount: mixedFixed,
            resumeQuestionCount: mixedResume,
            ...(mixedFixedSource === 'set' ? { questionSetId: selectedSetId } : {}),
          },
          ...(mixedFixedSource === 'adhoc' ? { fixedQuestions: mixedQuestions.map((q) => q.trim()).filter(Boolean) } : {}),
        } : {}),
        candidates: validCandidates,
        // Omitted when unrestricted, so the common case sends nothing and the
        // document carries no field. The server normalises either way.
        ...(devices.length > 0 && devices.length < 3 ? { allowedDevices: devices } : {}),
        origin: window.location.origin,
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
    setQuestionSource: { description: 'Choose question source: tailor (adaptive), set (a saved question set), or mixed (fixed + résumé-adapted)', params: [{ name: 'source', type: 'enum' as const, enum: ['tailor', 'set', 'mixed'], required: true }], run: (a: any) => setSource(a.source) },
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
    // COD-OFF: : mode === 'coding' ? selectedCodingIds.length > 0
    : mode === 'essay' ? !!selectedEssayId
    : source === 'tailor' ? tailorTotal >= 1 && tailorTotal <= 25
    : source === 'set' ? !!selectedSetId
    : source === 'mixed' ? (
        mixedFixed >= 0 && mixedResume >= 0 && mixedFixed + mixedResume === mixedTotal
        && (mixedFixedSource === 'set' ? !!selectedSetId : mixedQuestions.filter((q) => q.trim()).length === mixedFixed)
      )
    : false
  const step2ValidMulti = rounds.length >= 1 && rounds.every((r) => r.name.trim().length >= 1 && !!r.mode)

  // Refresh the Autopilot state ref AFTER the validity flags exist — every render.
  apStateRef.current = { step, setupType, mode, role, source, selectedSetId, candidates, cfg, step1Valid, step2Valid, step2ValidMulti, validCount, emailLockedOk: emailLocked.ok }

  return (
    <div className="mx-auto max-w-[900px] px-6 py-8">
      <button onClick={() => navigate('/sessions')} className="mb-5 inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-ink-muted transition-colors duration-150 hover:text-ink">
        <ArrowLeft size={15} /> Back to sessions
      </button>

      <div className="mb-6">
        <span className="pill mb-2.5 inline-flex">Invite candidates</span>
        <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-ink">Set up an interview & invite</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          Configure the interview once, add your recipients, then send every invitation from one place.
        </p>
      </div>

      {!result && (
        <div className="mb-7">
          <WizardStepper steps={STEPS} step={step} />
        </div>
      )}

      {!result && step <= 3 && (
        <div className="mb-7 flex items-start gap-3 rounded-2xl border border-rule bg-surface-hover/60 p-4 text-sm text-ink-body">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-surface-hover text-ink"><Info size={15} /></span>
          <p className="leading-relaxed">
            You don’t upload résumés here. Configure the interview once, then invite candidates by email —
            <span className="font-medium text-ink"> each candidate uploads their own résumé when they begin</span>, and the interview auto-configures to these settings.
          </p>
        </div>
      )}

      {/* ── Success ── */}
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
                : <><span className="font-semibold tabular-nums text-ink">{result.emailed}</span> invitation email{result.emailed === 1 ? '' : 's'} sent. Candidates can start as soon as they open their link.</>}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="badge badge-neutral">Batch <span className="ml-1 font-mono">{result.testId.slice(0, 8)}</span></span>
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
                      <span className="mt-2 flex items-center gap-1 text-xs font-medium text-ink">
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
              <label htmlFor="role" className="block font-display text-base font-extrabold tracking-[-0.02em] text-ink">Candidate role</label>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">The position you’re interviewing for. Every invite in this batch uses it (you can override per candidate in Step 3).</p>
            </div>
            <input id="role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Senior Backend Engineer" className="input-base max-w-md" autoFocus />
          </section>
{/* 
          <section>
            <div className="mb-4">
              <span className="block font-display text-base font-extrabold tracking-[-0.02em] text-neutral-900">Where they can take it</span>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-neutral-500">
                All three by default. Narrow it when the interview genuinely needs one — a
                coding screen that wants a keyboard, or a field role done on a phone.
              </p>
            </div>
            <DevicePicker value={devices} onChange={setDevices} />
          </section>
 */}
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
              {
              /* ── Coding interviews are switched off in the web app ──────────
                 Nothing below is deleted. To bring coding back: uncomment this
                 arm, the `coding` entry in MODES, `selectedCodingIds`, the
                 `codingProblems` query, the four `mode === 'coding'` guards
                 flagged COD-OFF, the /coding-problems route in App.tsx and its
                 Nav.tsx entry. The candidate-side CodingStage is untouched, so
                 an interview already sent still runs and still scores.

              mode === 'coding' ? (
                // Coding: which problems. No résumé-tailored path, for the same
                // reason MCQ has none — a problem needs its test cases and their
                // expected outputs authored in advance, and generated-per-candidate
                // tests would have nothing to grade against.
                <div>
                  <StepSection
                    title="Choose the coding problems"
                    hint="Authored in Coding problems, with their hidden tests. Graded by a sandboxed judge the moment a candidate submits."
                  >
                    {codingProblems.isLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-[62px]" />
                        <Skeleton className="h-[62px]" />
                      </div>
                    ) : (codingProblems.data ?? []).length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-rule-strong bg-surface-sunk px-5 py-6 text-center">
                        <p className="text-sm font-semibold text-ink">No coding problems yet</p>
                        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-ink-muted">
                          Write one in Coding problems — a statement, a visible sample and the hidden
                          tests it is graded on — then it appears here.
                        </p>
                        <Button className="mt-3" size="sm" variant="outline" onClick={() => navigate('/coding-problems')}>
                          Go to coding problems
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(codingProblems.data ?? []).map((problem) => {
                          const sel = selectedCodingIds.includes(problem.id)
                          //A problem with faults is shown but not selectable. The
                             // server refuses it at send time anyway; saying so here
                             // names which problem and why, instead of failing the
                             // whole batch at the last step.
                          const blocked = problem.faults.length > 0
                          return (
                            <button
                              key={problem.id}
                              type="button"
                              disabled={blocked}
                              onClick={() =>
                                setSelectedCodingIds((ids) =>
                                  sel ? ids.filter((x) => x !== problem.id) : [...ids, problem.id],
                                )
                              }
                              className={cn(
                                'flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-colors duration-150',
                                blocked && 'cursor-not-allowed opacity-60',
                                sel
                                  ? 'border-action bg-surface-hover/40 ring-1 ring-signal'
                                  : 'border-border bg-surface hover:border-rule-strong',
                              )}
                            >
                              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-hover text-ink">
                                <Code2 size={17} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold text-ink">{problem.title || 'Untitled problem'}</span>
                                <span className="mt-0.5 block text-xs text-ink-muted">
                                  {blocked
                                    ? problem.faults[0]
                                    : `${problem.difficulty} · ${problem.testCount} test${problem.testCount === 1 ? '' : 's'} · ${problem.allowedLanguages.length} language${problem.allowedLanguages.length === 1 ? '' : 's'}`}
                                </span>
                              </span>
                              {sel && <Check size={16} className="flex-shrink-0 text-ink" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </StepSection>
                </div>
              ) :
              */
              mode === 'essay' ? (
                /* Essay: one prompt. No résumé-tailored path for the same reason
                   MCQ has none — the rubric and the limits are authored in advance,
                   and a prompt generated per candidate could not be marked against
                   a scheme the recruiter had actually reviewed. */
                <div>
                  <StepSection
                    title="Choose the essay question"
                    hint="Written in Essay questions, with its word limits and time limit. Marked against your notes once it is handed in."
                  >
                    {essayPrompts.isLoading ? (
                      <div className="space-y-2">
                        <Skeleton className="h-[62px]" />
                        <Skeleton className="h-[62px]" />
                      </div>
                    ) : (essayPrompts.data ?? []).length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-rule-strong bg-surface-sunk px-5 py-6 text-center">
                        <p className="text-sm font-semibold text-ink">No essay prompts yet</p>
                        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-ink-muted">
                          Write one in Essay questions — the question, its word limits and how long the
                          candidate has — then it appears here.
                        </p>
                        <Button className="mt-3" size="sm" variant="outline" onClick={() => navigate('/essay-prompts')}>
                          Go to essay prompts
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(essayPrompts.data ?? []).map((prompt) => {
                          const sel = selectedEssayId === prompt.id
                          /* A prompt with faults is shown but not selectable, and
                             says why — the server refuses it at send time anyway,
                             and naming the reason here beats failing at the last
                             step. */
                          const blocked = prompt.faults.length > 0
                          return (
                            <button
                              key={prompt.id}
                              type="button"
                              disabled={blocked}
                              onClick={() => setSelectedEssayId(sel ? '' : prompt.id)}
                              className={cn(
                                'flex w-full items-center gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-colors duration-150',
                                blocked && 'cursor-not-allowed opacity-60',
                                sel
                                  ? 'border-action bg-surface-hover/40 ring-1 ring-signal'
                                  : 'border-border bg-surface hover:border-rule-strong',
                              )}
                            >
                              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-hover text-ink">
                                <FileText size={17} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold text-ink">{prompt.title || 'Untitled prompt'}</span>
                                <span className="mt-0.5 block text-xs text-ink-muted">
                                  {blocked
                                    ? prompt.faults[0]
                                    : `${prompt.promptType} · ${prompt.minWords || 0}–${prompt.maxWords || '∞'} words · ${Math.round((prompt.timeLimitSeconds || 0) / 60)} min`}
                                </span>
                              </span>
                              {sel && <Check size={16} className="flex-shrink-0 text-ink" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </StepSection>
                </div>
              ) : mode === 'mcq' ? (
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
                      <div className="rounded-2xl border border-dashed border-rule-strong bg-surface-sunk px-5 py-6 text-center">
                        <p className="text-sm font-semibold text-ink">No MCQ sets yet</p>
                        <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-ink-muted">
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
                                  ? 'border-action bg-surface-hover/40 ring-1 ring-signal'
                                  : 'border-border bg-surface hover:border-rule-strong',
                              )}
                            >
                              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-surface-hover text-ink">
                                <ListChecks size={17} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold text-ink">{set.name}</span>
                                <span className="mt-0.5 block text-xs text-ink-muted">
                                  {set.questions.length} question{set.questions.length === 1 ? '' : 's'} · {points} point{points === 1 ? '' : 's'}
                                </span>
                              </span>
                              {sel && <Check size={16} className="flex-shrink-0 text-ink" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </StepSection>
                </div>
              ) : mode === 'two_way' ? (
                <div className="flex items-start gap-3.5 rounded-2xl border border-border bg-surface p-5 shadow-xs">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-surface-hover text-ink"><Users size={20} /></span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink">No scripted questions to configure</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                      Two-way Interview is a live recruiter-led video call — there’s no résumé-tailored or saved
                      question set to pick here. Continue to invite candidates.
                    </p>
                  </div>
                </div>
              ) : (
                <StepSection title="Question source" hint="Generate a bespoke set per candidate, reuse one you’ve already built, or combine both.">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <SelectCard
                      selected={source === 'tailor'}
                      onClick={() => setSource('tailor')}
                      icon={<FileText size={20} />}
                      title="Adapt to résumé"
                      blurb="Each candidate uploads their own résumé when they begin. We generate a unique set tailored to that person’s background and your settings — so every candidate gets bespoke questions."
                    />
                    <SelectCard
                      selected={source === 'set'}
                      onClick={() => setSource('set')}
                      icon={<Layers size={20} />}
                      title="Question set"
                      blurb="Reuse a question set you’ve saved. Build sets from a sample résumé or by configuring them manually — your sets are private to your account."
                    />
                    <SelectCard
                      selected={source === 'mixed'}
                      onClick={() => setSource('mixed')}
                      icon={<Workflow size={20} />}
                      title="Mixed"
                      blurb="Combine fixed questions with resume-adapted questions — a shared screen for everyone, plus questions unique to each candidate."
                    />
                  </div>

                  {/* Tailor config */}
                  {source === 'tailor' && <TailorConfigPanel role={role} cfg={cfg} setCfg={setCfg} />}

                  {/* Set picker */}
                  {source === 'set' && (
                    <QuestionSetPicker sets={sets} selectedSetId={selectedSetId} onSelect={setSelectedSetId} onCreateNew={() => setGenOpen(true)}
                      hint="Every candidate in this batch answers the same questions." />
                  )}

                  {/* Mixed config */}
                  {source === 'mixed' && (
                    <MixedConfigPanel
                      total={mixedTotal} fixed={mixedFixed} resume={mixedResume}
                      onTotal={setMixedTotal} onFixed={setMixedFixed} onResume={setMixedResume}
                      fixedSource={mixedFixedSource} onFixedSource={setMixedFixedSource}
                      questions={mixedQuestions} onQuestions={setMixedQuestions}
                      sets={sets} selectedSetId={selectedSetId} onSelectSet={setSelectedSetId} onCreateSet={() => setGenOpen(true)}
                    />
                  )}
                </StepSection>
              )}

              <StepFooter
                left={<Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => setStep(1)}>Back</Button>}
                hint={step2Valid ? undefined
                  : mode === 'mcq' ? 'Pick an MCQ paper to continue.'
                  // COD-OFF: : mode === 'coding' ? 'Pick at least one coding problem to continue.'
                  : mode === 'essay' ? 'Pick an essay prompt to continue.'
                  : !source ? 'Choose a question source to continue.'
                  : source === 'set' ? 'Pick a question set to continue.'
                  : source === 'mixed' ? 'Make the fixed and résumé-based counts add up to the total, and finish the fixed questions, to continue.'
                  : 'Set a question count between 1 and 25 to continue.'}
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
                  ? 'border-action bg-surface-hover'
                  : 'border-border bg-surface-sunk hover:border-rule hover:bg-surface-hover/40',
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
                              placeholder={role}
                              className="w-full rounded-lg border border-transparent bg-surface px-2.5 py-1.5 text-xs text-ink-body transition-colors duration-150 hover:border-border focus:border-action focus:outline-none focus:ring-2 focus:ring-signal/20" />
                          </td>
                          <td className="px-4">
                            <select
                              value={c.roleCategory || ''}
                              onChange={(e) => setCandidates((cs) => cs.map((x) => x.id === c.id ? { ...x, roleCategory: e.target.value || undefined } : x))}
                              aria-label="Role category"
                              className={cn('w-full rounded-lg border bg-surface px-2.5 py-1.5 text-xs transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-signal/20',
                                c.roleCategory && c.roleCategory !== 'other' ? 'border-transparent text-ink-body hover:border-border focus:border-action' : 'border-border text-ink-faint focus:border-action')}
                            >
                              <option value="">Not detected</option>
                              {roleCategories.data?.map((cat) => (
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

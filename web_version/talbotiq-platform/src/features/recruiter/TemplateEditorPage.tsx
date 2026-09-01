import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ArrowLeft, Plus, Trash2, Save, Sparkles, Play, AlertTriangle, ChevronRight, RefreshCw } from 'lucide-react'
import {
  PageHeader, Card, Button, Input, Select, Toggle, Textarea, SectionTitle, Badge, Divider, Skeleton, EmptyState, cn,
} from '@/components/ui'
import { templatesApi, questionSetsApi, voicesApi } from '@/lib/api'
import { GenerateFromResumeModal } from './GenerateFromResumeModal'
import { CircularCountdown } from '@/features/interview/components/CircularCountdown'
import { playPcmSample } from '@/lib/voiceClient'
import type { InterviewTemplate, KpiDefinition, AdaptiveConfig, ConversationTimingConfig, ChatbotTimerConfig, VoiceConfig, InterviewMode, DifficultyChoice, QuestionStyle } from '@shared/types'

const num = (v: string, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const DEF_ADAPTIVE: AdaptiveConfig = {
  role: '', difficulty: 'mixed', style: 'mix', numberOfQuestions: 5, technicalCount: 3, nonTechnicalCount: 2,
  focusTopics: [], allowFollowUps: false, maxFollowUpsPerQuestion: 1, interviewerTone: 'friendly and professional', language: 'English',
}
const DEF_CONV: ConversationTimingConfig = {
  thinkingSeconds: 30, perQuestionSeconds: 120, allowSkipThinking: true, allowEarlySubmit: true, warningThresholdSeconds: 15,
}
const DEF_TIMER: ChatbotTimerConfig = {
  enabled: true, perQuestionSeconds: 120, timeFollowUps: true, followUpSeconds: 90,
  includeThinkingPhase: false, thinkingSeconds: 20, warningThresholdSeconds: 15,
  allowEarlySubmit: true, autoSubmitOnExpiry: true,
}

/** Human label per interview track — used by the candidate-facing preview. */
const TRACK_LABEL: Record<InterviewTemplate['track'], string> = {
  chat: 'Chat',
  chatbot: 'Chatbot',
  voice: 'Voice',
  video_avatar: 'Video avatar',
  video: 'Video',
  two_way: 'Two-way',
  mcq: 'MCQ',
  coding: 'Coding',
  essay: 'Essay Writing Test',
}

function normalizedWeights(kpis: KpiDefinition[]) {
  const enabled = kpis.filter((k) => k.enabled && k.weight > 0)
  const total = enabled.reduce((s, k) => s + k.weight, 0)
  return (k: KpiDefinition) =>
    k.enabled && total > 0 ? Math.round((k.weight / total) * 100) : 0
}

/* ── presentational building blocks ─────────────────────────────────────── */

/** One settings group: a labelled rule, then a calm white panel. */
function FormSection({ title, description, className, children }: {
  title: string; description?: React.ReactNode; className?: string; children: React.ReactNode
}) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <Card className={cn('p-6', className)}>
        {description && <p className="text-sm leading-relaxed text-ink-muted">{description}</p>}
        {children}
      </Card>
    </section>
  )
}

/** Inline advisory — names the problem and where to fix it. */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-xs font-medium leading-relaxed text-warning">
      <AlertTriangle size={14} strokeWidth={2} className="mt-px flex-shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Column header inside the candidate preview panel. */
function PreviewLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{children}</span>
}

/** A step chip in the per-question flow strip. */
function FlowStep({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return accent
    ? <span className="rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: accent }}>{children}</span>
    : <span className="rounded-full bg-surface-hover px-2.5 py-1 text-xs font-medium text-ink-body">{children}</span>
}

/** One rubric row: enable switch · label + description · weight · normalized share. */
function KpiRow({ kpi, pct, onPatch, onRemove }: {
  kpi: KpiDefinition
  pct: number
  onPatch: (p: Partial<KpiDefinition>) => void
  onRemove: () => void
}) {
  return (
    <div className={cn(
      'flex items-start gap-3 rounded-xl border border-border p-3 transition-colors duration-150',
      kpi.enabled ? 'bg-surface' : 'bg-surface-sunk',
    )}>
      <span className="flex h-9 flex-shrink-0 items-center">
        <button
          onClick={() => onPatch({ enabled: !kpi.enabled })}
          role="switch" aria-checked={kpi.enabled}
          aria-label={`${kpi.enabled ? 'Disable' : 'Enable'} ${kpi.label || 'KPI'}`}
          className={cn(
            'relative h-[22px] w-10 rounded-full transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1',
            kpi.enabled ? 'bg-action' : 'bg-surface-hover',
          )}
        >
          <span className={cn('absolute top-[3px] h-4 w-4 rounded-full bg-surface shadow-sm transition-all duration-200', kpi.enabled ? 'left-[22px]' : 'left-[3px]')} />
        </button>
      </span>

      <div className={cn('min-w-0 flex-1 space-y-2 transition-opacity duration-150', kpi.enabled ? '' : 'opacity-60')}>
        <input
          value={kpi.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder="KPI name"
          className="input-base h-9 text-sm font-semibold"
          aria-label="KPI label"
        />
        <input
          value={kpi.description}
          onChange={(e) => onPatch({ description: e.target.value })}
          placeholder="What a strong answer looks like — guides AI scoring"
          className="input-base h-9 text-xs text-ink-muted"
          aria-label="KPI description"
        />
      </div>

      <span className="flex h-9 flex-shrink-0 items-center gap-2">
        <input
          type="number" min={0} value={kpi.weight}
          onChange={(e) => onPatch({ weight: num(e.target.value, 1) })}
          className="input-base h-9 w-16 px-2 text-center text-sm font-semibold tabular-nums"
          aria-label={`Weight for ${kpi.label || 'KPI'}`}
        />
        <span className={cn(
          'w-11 text-right text-sm font-bold tabular-nums transition-colors duration-150',
          kpi.enabled ? 'text-ink' : 'text-ink-faint',
        )}>
          {pct}%
        </span>
      </span>

      <span className="flex h-9 flex-shrink-0 items-center">
        <button
          onClick={onRemove}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition-colors duration-150 hover:bg-danger-bg hover:text-danger"
          aria-label={`Remove ${kpi.label || 'KPI'}`}
        >
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  )
}

export default function TemplateEditorPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const query = useQuery({ queryKey: ['template', id], queryFn: () => templatesApi.get(id) })
  const sets = useQuery({ queryKey: ['question-sets'], queryFn: questionSetsApi.list })
  const voiceCat = useQuery({ queryKey: ['voices'], queryFn: voicesApi.catalog })
  const [t, setT] = useState<InterviewTemplate | null>(null)
  const [genOpen, setGenOpen] = useState(false)
  const [previewing, setPreviewing] = useState<string | null>(null)

  useEffect(() => { if (query.data) setT(query.data) }, [query.data])

  const save = useMutation({
    mutationFn: () => templatesApi.update(id, t!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      qc.invalidateQueries({ queryKey: ['template', id] })
      toast.success('Template saved')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const pctOf = useMemo(() => (t ? normalizedWeights(t.rubric.kpis) : () => 0), [t])

  const backLink = (
    <button
      onClick={() => navigate('/templates')}
      className="mb-3 inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
    >
      <ArrowLeft size={15} /> Templates
    </button>
  )

  if (query.isError && !t) {
    return (
      <div className="max-w-[1440px] mx-auto px-6 py-8">
        {backLink}
        <Card className="p-0">
          <EmptyState
            icon={<AlertTriangle strokeWidth={1.75} />}
            title="Couldn't load this template"
            description="It may have been deleted, or the connection dropped before it finished loading."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => query.refetch()}>Retry</Button>
                <Button size="sm" variant="secondary" onClick={() => navigate('/templates')}>Back to templates</Button>
              </div>
            }
          />
        </Card>
      </div>
    )
  }

  if (query.isLoading || !t) {
    return (
      <div className="max-w-[1440px] mx-auto px-6 py-8">
        <Skeleton className="mb-4 h-4 w-24" />
        <div className="mb-9 flex items-start justify-between gap-6">
          <div className="space-y-3">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-8 w-72" />
          </div>
          <Skeleton className="h-10 w-40 rounded-full" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:gap-8">
          <div className="space-y-8">
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      </div>
    )
  }

  const patch = (p: Partial<InterviewTemplate>) => setT({ ...t, ...p })
  const patchTiming = (p: Partial<InterviewTemplate['timing']>) => setT({ ...t, timing: { ...t.timing, ...p } })
  const patchBranding = (p: Partial<InterviewTemplate['branding']>) => setT({ ...t, branding: { ...t.branding, ...p } })
  const patchIntegrity = (p: Partial<InterviewTemplate['integrity']>) => setT({ ...t, integrity: { ...t.integrity, ...p } })
  const patchAdaptive = (p: Partial<AdaptiveConfig>) => setT({ ...t, adaptive: { ...DEF_ADAPTIVE, ...(t.adaptive ?? {}), role: t.role, ...p } })
  const patchConvTiming = (p: Partial<ConversationTimingConfig>) => setT({ ...t, conversationTiming: { ...DEF_CONV, ...(t.conversationTiming ?? {}), ...p } })
  const patchChatbotTimer = (p: Partial<ChatbotTimerConfig>) => setT({ ...t, chatbotTimer: { ...DEF_TIMER, ...(t.chatbotTimer ?? {}), ...p } })
  // Per-question override for a specific fixed-set question. Blank clears it (falls back to perQuestionSeconds).
  const patchOverride = (qid: string, seconds?: number) => {
    const next = { ...(t.chatbotTimer?.perQuestionOverrides ?? {}) }
    if (seconds == null || Number.isNaN(seconds)) delete next[qid]
    else next[qid] = seconds
    patchChatbotTimer({ perQuestionOverrides: next })
  }
  const DEF_VOICE: VoiceConfig = { engine: 'gemini_live', personaId: 'friendly_hr', voiceId: 'Aoede', allowBargeIn: true, language: 'en-US' }
  const patchVoice = (p: Partial<VoiceConfig>) => setT({ ...t, voice: { ...DEF_VOICE, ...(t.voice ?? {}), ...p } })
  const previewVoice = async (voiceId: string) => {
    setPreviewing(voiceId)
    try { const r = await voicesApi.sample(voiceId); await playPcmSample(r.audio) }
    catch { /* ignore preview errors */ }
    finally { setPreviewing(null) }
  }
  const patchKpi = (kid: string, p: Partial<KpiDefinition>) =>
    setT({ ...t, rubric: { ...t.rubric, kpis: t.rubric.kpis.map((k) => (k.id === kid ? { ...k, ...p } : k)) } })
  const addKpi = () =>
    setT({ ...t, rubric: { ...t.rubric, kpis: [...t.rubric.kpis, { id: crypto.randomUUID(), label: 'New KPI', description: '', weight: 1, enabled: true }] } })
  const removeKpi = (kid: string) =>
    setT({ ...t, rubric: { ...t.rubric, kpis: t.rubric.kpis.filter((k) => k.id !== kid) } })

  const isVoice = t.track === 'voice'
  const conversational = t.track === 'chatbot' || t.track === 'video_avatar' || isVoice
  const selectedSet = sets.data?.find((s) => s.id === t.fixedQuestionSetId)
  const adaptiveCount = conversational ? (t.adaptive?.numberOfQuestions ?? 5) : (t.timing.numberOfQuestions ?? 0)
  const questionCount = t.questionSource === 'fixed' ? selectedSet?.questions.length ?? 0 : adaptiveCount
  const perQ =
    conversational
      ? t.chatbotTimer?.enabled
        ? (t.chatbotTimer.perQuestionSeconds) + (t.chatbotTimer.includeThinkingPhase ? (t.chatbotTimer.thinkingSeconds ?? 0) : 0)
        : t.mode === 'timed'
          ? (t.conversationTiming?.thinkingSeconds ?? 30) + (t.conversationTiming?.perQuestionSeconds ?? 120)
          : 90
      : t.timing.prepSeconds + t.timing.answerSeconds
  const totalMin = Math.round((questionCount * perQ) / 60)
  const enabledKpis = t.rubric.kpis.filter((k) => k.enabled)
  const accent = t.branding.accentColor

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      {backLink}
      <PageHeader
        kicker="Template"
        title={t.name || 'Untitled template'}
        description={[t.role, t.seniority].filter(Boolean).join(' · ') || undefined}
        action={<Button icon={<Save size={16} />} loading={save.isPending} onClick={() => save.mutate()}>Save template</Button>}
      />

      <GenerateFromResumeModal
        open={genOpen}
        onClose={() => setGenOpen(false)}
        defaultRole={t.role}
        onSaved={(set) => {
          qc.invalidateQueries({ queryKey: ['question-sets'] })
          setT((prev) => (prev ? { ...prev, questionSource: 'fixed', fixedQuestionSetId: set.id } : prev))
          toast.success('New set selected — click Save template to keep it')
        }}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:gap-8">
        {/* ── form ── */}
        <div className="space-y-10">
          <FormSection title="Basics" className="space-y-4">
            <Input label="Template name" value={t.name} onChange={(e) => patch({ name: e.target.value })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Role" value={t.role} onChange={(e) => patch({ role: e.target.value })} />
              <Input label="Seniority" value={t.seniority ?? ''} onChange={(e) => patch({ seniority: e.target.value })} placeholder="e.g. Mid, Senior" />
            </div>
            <Select
              label="Track"
              value={t.track}
              onChange={(e) => patch({ track: e.target.value as InterviewTemplate['track'] })}
              options={[
                { value: 'chat', label: 'Chat — one question at a time (timed slots)' },
                { value: 'chatbot', label: 'Chatbot — conversational (ChatGPT-style)' },
                { value: 'voice', label: 'Voice — live spoken AI interviewer' },
                { value: 'video_avatar', label: 'Video Avatar (scaffold)' },
              ]}
            />
          </FormSection>

          <FormSection title="Questions" className="space-y-4">
            <Select
              label="Question source"
              value={t.questionSource}
              onChange={(e) => patch({ questionSource: e.target.value as InterviewTemplate['questionSource'] })}
              options={[{ value: 'fixed', label: 'Fixed — pick a saved question set' }, { value: 'adaptive', label: 'Adaptive — generated from résumé (Gemini)' }]}
            />
            {t.questionSource === 'fixed' ? (
              <div className="space-y-3">
                <Select
                  label="Question set"
                  value={t.fixedQuestionSetId ?? ''}
                  onChange={(e) => patch({ fixedQuestionSetId: e.target.value })}
                  options={[{ value: '', label: '— select a set —' }, ...(sets.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.questions.length})` }))]}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" size="sm" icon={<Sparkles size={14} />} onClick={() => setGenOpen(true)}>
                    Generate set from résumé
                  </Button>
                  <span className="text-xs text-ink-muted">Gemini drafts a set from a candidate&rsquo;s PDF résumé.</span>
                </div>
              </div>
            ) : conversational ? (
              <div className="rounded-xl border border-border bg-surface-sunk p-4 text-sm leading-relaxed text-ink-body">
                Questions are generated live from the résumé. Set{' '}
                <b className="font-semibold text-ink">style, difficulty, and count</b> under{' '}
                <b className="font-semibold text-ink">Conversation</b> below.
              </div>
            ) : (
              <Input
                label="Number of questions"
                type="number"
                value={t.timing.numberOfQuestions ?? 5}
                onChange={(e) => patchTiming({ numberOfQuestions: num(e.target.value, 5) })}
                hint="Tailored questions generated from the candidate's résumé at session start."
              />
            )}
          </FormSection>

          {conversational && (
            <FormSection title="Conversation" className="space-y-4">
              {!isVoice && (
                <Select
                  label="Mode"
                  value={t.mode ?? 'conversational'}
                  onChange={(e) => patch({ mode: e.target.value as InterviewMode })}
                  options={[
                    { value: 'conversational', label: 'Conversational — relaxed, no timers' },
                    { value: 'timed', label: 'Timed — proctored thinking + answer limits' },
                  ]}
                />
              )}
              {t.questionSource === 'adaptive' ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                      label="Question style"
                      value={t.adaptive?.style ?? 'mix'}
                      onChange={(e) => patchAdaptive({ style: e.target.value as QuestionStyle })}
                      options={[
                        { value: 'technical', label: 'Technical' },
                        { value: 'non_technical', label: 'Non-technical' },
                        { value: 'mix', label: 'Mixed' },
                      ]}
                    />
                    <Select
                      label="Difficulty"
                      value={t.adaptive?.difficulty ?? 'mixed'}
                      onChange={(e) => patchAdaptive({ difficulty: e.target.value as DifficultyChoice })}
                      options={['easy', 'medium', 'hard', 'mixed'].map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) }))}
                    />
                  </div>
                  {(t.adaptive?.style ?? 'mix') === 'mix' ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input
                        label="Technical questions"
                        type="number"
                        value={t.adaptive?.technicalCount ?? 3}
                        onChange={(e) => {
                          const tc = num(e.target.value, 3)
                          patchAdaptive({ technicalCount: tc, numberOfQuestions: tc + (t.adaptive?.nonTechnicalCount ?? 2) })
                        }}
                      />
                      <Input
                        label="Non-technical questions"
                        type="number"
                        value={t.adaptive?.nonTechnicalCount ?? 2}
                        onChange={(e) => {
                          const nc = num(e.target.value, 2)
                          patchAdaptive({ nonTechnicalCount: nc, numberOfQuestions: (t.adaptive?.technicalCount ?? 3) + nc })
                        }}
                      />
                    </div>
                  ) : (
                    <Input label="Number of questions" type="number" value={t.adaptive?.numberOfQuestions ?? 5} onChange={(e) => patchAdaptive({ numberOfQuestions: num(e.target.value, 5) })} />
                  )}
                  <Input
                    label="Focus topics (comma-separated)"
                    value={(t.adaptive?.focusTopics ?? []).join(', ')}
                    onChange={(e) => patchAdaptive({ focusTopics: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    placeholder="system design, Kafka, leadership"
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Interviewer tone" value={t.adaptive?.interviewerTone ?? ''} onChange={(e) => patchAdaptive({ interviewerTone: e.target.value })} placeholder="friendly and professional" />
                    <Input label="Language" value={t.adaptive?.language ?? ''} onChange={(e) => patchAdaptive({ language: e.target.value })} placeholder="English" />
                  </div>
                  <Divider className="my-1" />
                  <Toggle label="Allow follow-up questions" description="Off by default — the interview asks exactly the number of questions above. Turn on to let the interviewer drill into answers." checked={t.adaptive?.allowFollowUps ?? false} onChange={(v) => patchAdaptive({ allowFollowUps: v })} />
                  {(t.adaptive?.allowFollowUps ?? false) && (
                    <Input label="Max follow-ups per question" type="number" value={t.adaptive?.maxFollowUpsPerQuestion ?? 1} onChange={(e) => patchAdaptive({ maxFollowUpsPerQuestion: num(e.target.value, 1) })} />
                  )}
                </>
              ) : (
                <Toggle label="Allow follow-ups on the fixed set" description="Ask AI follow-ups between saved questions." checked={t.fixedAllowFollowUps ?? false} onChange={(v) => patch({ fixedAllowFollowUps: v })} />
              )}
              {t.mode === 'timed' && (
                <>
                  <Divider className="my-1" />
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Input label="Thinking (s)" type="number" value={t.conversationTiming?.thinkingSeconds ?? 30} onChange={(e) => patchConvTiming({ thinkingSeconds: num(e.target.value, 30) })} />
                    <Input label="Answer (s)" type="number" value={t.conversationTiming?.perQuestionSeconds ?? 120} onChange={(e) => patchConvTiming({ perQuestionSeconds: num(e.target.value, 120) })} />
                    <Input label="Warning at (s)" type="number" value={t.conversationTiming?.warningThresholdSeconds ?? 15} onChange={(e) => patchConvTiming({ warningThresholdSeconds: num(e.target.value, 15) })} />
                  </div>
                  <Toggle label="Allow skipping thinking time" checked={t.conversationTiming?.allowSkipThinking ?? true} onChange={(v) => patchConvTiming({ allowSkipThinking: v })} />
                  <Toggle label="Allow early submit" checked={t.conversationTiming?.allowEarlySubmit ?? true} onChange={(v) => patchConvTiming({ allowEarlySubmit: v })} />
                </>
              )}
            </FormSection>
          )}

          {isVoice && (
            <FormSection title="Voice & persona" className="space-y-4">
              <Select
                label="Engine"
                value={t.voice?.engine ?? 'gemini_live'}
                onChange={(e) => patchVoice({ engine: e.target.value as VoiceConfig['engine'] })}
                options={[
                  { value: 'gemini_live', label: 'Gemini Live — native audio (recommended)' },
                  { value: 'pipeline', label: 'STT → Gemini → TTS (coming soon)' },
                ]}
              />
              <Select
                label="Persona"
                value={t.voice?.personaId ?? 'friendly_hr'}
                onChange={(e) => {
                  const p = voiceCat.data?.personas.find((x) => x.id === e.target.value)
                  patchVoice({ personaId: e.target.value, voiceId: p?.defaultVoiceId ?? t.voice?.voiceId ?? 'Aoede' })
                }}
                options={(voiceCat.data?.personas ?? []).map((p) => ({ value: p.id, label: p.name }))}
              />
              <p className="-mt-1 text-sm leading-relaxed text-ink-muted">
                {voiceCat.data?.personas.find((p) => p.id === (t.voice?.personaId ?? 'friendly_hr'))?.description}
              </p>

              <div>
                <p className="field-label">Voice</p>
                {!voiceCat.data ? (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[60px] rounded-xl" />)}
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {voiceCat.data.voices.map((voice) => {
                      const active = (t.voice?.voiceId ?? 'Aoede') === voice.id
                      return (
                        <div
                          key={voice.id}
                          className={cn(
                            'flex items-center gap-2 rounded-xl border-[1.5px] bg-surface p-2.5 transition-[border-color,box-shadow] duration-150',
                            active ? 'shadow-sm' : 'border-border hover:border-rule',
                          )}
                          style={active ? { borderColor: accent } : undefined}
                        >
                          <button className="min-w-0 flex-1 text-left" onClick={() => patchVoice({ voiceId: voice.id })} aria-pressed={active}>
                            <span className="block truncate text-sm font-semibold text-ink">{voice.label}</span>
                            <span className="block truncate text-[11px] text-ink-faint">
                              {[voice.gender, voice.description].filter(Boolean).join(' · ')}
                            </span>
                          </button>
                          <button
                            onClick={() => previewVoice(voice.id)}
                            disabled={previewing !== null}
                            className="ml-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white shadow-xs transition-opacity duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 disabled:opacity-40"
                            style={{ background: accent }}
                            aria-label={`Preview ${voice.label}`}
                          >
                            {previewing === voice.id ? <span className="h-3 w-3 animate-pulse rounded-full bg-white" /> : <Play size={14} />}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <Divider className="my-1" />
              <Toggle label="Allow barge-in" description="Let the candidate interrupt the interviewer by speaking." checked={t.voice?.allowBargeIn ?? true} onChange={(v) => patchVoice({ allowBargeIn: v })} />
              <Input label="Language" value={t.voice?.language ?? 'en-US'} onChange={(e) => patchVoice({ language: e.target.value })} placeholder="en-US" />
            </FormSection>
          )}

          {conversational && !isVoice && (
            <FormSection title="Per-question timer" className="space-y-4">
              <Toggle
                label="Enable a per-question countdown"
                description="Optional overlay: each question (and, optionally, each follow-up) gets its own answer countdown. Off = a relaxed conversation with no timers. The clock only runs while the candidate is answering — never during the greeting, the “are you ready?” step, the “Thinking…” pause, or wrap-up."
                checked={t.chatbotTimer?.enabled ?? false}
                onChange={(v) => patchChatbotTimer({ enabled: v })}
              />
              {(t.chatbotTimer?.enabled ?? false) && (
                <>
                  <Divider className="my-1" />
                  <div className="grid gap-5 md:grid-cols-[1fr_auto]">
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Input label="Answer time per question (s)" type="number" value={t.chatbotTimer?.perQuestionSeconds ?? 120} onChange={(e) => patchChatbotTimer({ perQuestionSeconds: num(e.target.value, 120) })} />
                        <Input label="Warning at (s)" type="number" value={t.chatbotTimer?.warningThresholdSeconds ?? 15} onChange={(e) => patchChatbotTimer({ warningThresholdSeconds: num(e.target.value, 15) })} />
                      </div>
                      <Toggle label="Allow early submit" description="Candidate can submit before the timer ends." checked={t.chatbotTimer?.allowEarlySubmit ?? true} onChange={(v) => patchChatbotTimer({ allowEarlySubmit: v })} />
                      <Toggle label="Auto-submit at 0" description="When time runs out, submit whatever is typed and move on." checked={t.chatbotTimer?.autoSubmitOnExpiry ?? true} onChange={(v) => patchChatbotTimer({ autoSubmitOnExpiry: v })} />
                      <Divider className="my-1" />
                      <Toggle label="Time follow-up questions too" checked={t.chatbotTimer?.timeFollowUps ?? true} onChange={(v) => patchChatbotTimer({ timeFollowUps: v })} />
                      {(t.chatbotTimer?.timeFollowUps ?? true) && (
                        <Input label="Follow-up time (s, blank = same as questions)" type="number" value={t.chatbotTimer?.followUpSeconds ?? ''} onChange={(e) => patchChatbotTimer({ followUpSeconds: e.target.value ? num(e.target.value, 90) : undefined })} placeholder={`${t.chatbotTimer?.perQuestionSeconds ?? 120}`} />
                      )}
                      <Divider className="my-1" />
                      <Toggle label="Add a short prep sub-timer before answering" description="Locks the composer for a brief “prepare” countdown before the answer clock starts." checked={t.chatbotTimer?.includeThinkingPhase ?? false} onChange={(v) => patchChatbotTimer({ includeThinkingPhase: v })} />
                      {(t.chatbotTimer?.includeThinkingPhase ?? false) && (
                        <Input label="Prep time (s)" type="number" value={t.chatbotTimer?.thinkingSeconds ?? 20} onChange={(e) => patchChatbotTimer({ thinkingSeconds: num(e.target.value, 20) })} />
                      )}
                    </div>
                    {/* Live preview of the ring the candidate will see. */}
                    <div className="flex flex-col items-center justify-start gap-3 rounded-2xl border border-border bg-surface-sunk p-5 md:w-[212px]">
                      <PreviewLabel>Live preview</PreviewLabel>
                      <CircularCountdown
                        remaining={t.chatbotTimer?.perQuestionSeconds ?? 120}
                        total={t.chatbotTimer?.perQuestionSeconds ?? 120}
                        phase="answer"
                        warningThreshold={t.chatbotTimer?.warningThresholdSeconds ?? 15}
                        accentColor={accent}
                        size={120}
                      />
                      <span className="text-center text-xs leading-relaxed text-ink-muted">Shown only while the candidate is answering</span>
                    </div>
                  </div>
                  {/* Optional per-question overrides — only meaningful for a fixed set, where
                      each question has a stable id the override can be keyed to. */}
                  {t.questionSource === 'fixed' && (
                    <>
                      <Divider className="my-1" />
                      <div>
                        <p className="text-sm font-semibold text-ink">Per-question overrides <span className="font-medium text-ink-faint">(optional)</span></p>
                        <p className="mb-3 mt-0.5 text-xs leading-relaxed text-ink-muted">
                          Give specific questions a different answer time. Leave blank to use the default of {t.chatbotTimer?.perQuestionSeconds ?? 120}s.
                        </p>
                        {selectedSet ? (
                          <div className="overflow-hidden rounded-xl border border-border">
                            <div className="flex items-center gap-3 border-b border-border bg-surface-sunk px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                              <span className="min-w-0 flex-1">Question</span>
                              <span className="w-[92px] flex-shrink-0 text-right">Answer time</span>
                            </div>
                            {selectedSet.questions.map((q, i) => (
                              <div key={q.id} className="flex h-12 items-center gap-3 border-b border-border px-3 last:border-b-0">
                                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-hover text-[11px] font-bold tabular-nums text-ink">
                                  {i + 1}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-xs text-ink-body" title={q.text}>{q.text}</span>
                                <span className="flex w-[92px] flex-shrink-0 items-center justify-end gap-1.5">
                                  <input
                                    type="number"
                                    min={5}
                                    value={t.chatbotTimer?.perQuestionOverrides?.[q.id] ?? ''}
                                    onChange={(e) => patchOverride(q.id, e.target.value ? num(e.target.value, t.chatbotTimer?.perQuestionSeconds ?? 120) : undefined)}
                                    placeholder={`${t.chatbotTimer?.perQuestionSeconds ?? 120}`}
                                    className="input-base h-8 w-[68px] px-2 text-center text-sm tabular-nums"
                                    aria-label={`Answer seconds for question ${i + 1}`}
                                  />
                                  <span className="text-xs text-ink-faint">s</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Notice>Select a fixed question set under <b>Questions</b> to set per-question overrides.</Notice>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}
            </FormSection>
          )}

          {t.track === 'chat' && (
            <FormSection
              title="Timing"
              description={<>These per-question limits also apply when a candidate takes this interview as the conversational <b className="font-semibold text-ink-body">Chatbot</b> track — the answer countdown carries over.</>}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <Input label="Prep (s)" type="number" value={t.timing.prepSeconds} onChange={(e) => patchTiming({ prepSeconds: num(e.target.value, 30) })} />
                <Input label="Answer (s)" type="number" value={t.timing.answerSeconds} onChange={(e) => patchTiming({ answerSeconds: num(e.target.value, 120) })} />
                <Input label="Warning at (s)" type="number" value={t.timing.warningThresholdSeconds} onChange={(e) => patchTiming({ warningThresholdSeconds: num(e.target.value, 15) })} />
              </div>
              <Divider className="my-1" />
              <Toggle label="Allow skipping preparation" description="Candidate can start answering before prep ends." checked={t.timing.allowSkipPrep} onChange={(v) => patchTiming({ allowSkipPrep: v })} />
              <Toggle label="Allow early submit" description="Candidate can submit before the answer timer ends." checked={t.timing.allowEarlySubmit} onChange={(v) => patchTiming({ allowEarlySubmit: v })} />
              <Input label="Overall time cap (s, optional)" type="number" value={t.timing.totalTimeCapSeconds ?? ''} onChange={(e) => patchTiming({ totalTimeCapSeconds: e.target.value ? num(e.target.value, 0) : undefined })} placeholder="No cap" />
            </FormSection>
          )}

          <FormSection
            title="Scoring rubric"
            description="Toggle the KPIs the AI scores against, edit their wording, and set relative weights — weights are normalized to 100% automatically."
            className="space-y-3"
          >
            <div className="flex items-center gap-3 px-3 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <span className="w-10 flex-shrink-0">On</span>
              <span className="min-w-0 flex-1">KPI</span>
              <span className="flex flex-shrink-0 items-center gap-2">
                <span className="w-16 text-center">Weight</span>
                <span className="w-11 text-right">Share</span>
              </span>
              <span className="w-8 flex-shrink-0" aria-hidden />
            </div>

            {t.rubric.kpis.map((k) => (
              <KpiRow
                key={k.id}
                kpi={k}
                pct={pctOf(k)}
                onPatch={(p) => patchKpi(k.id, p)}
                onRemove={() => removeKpi(k.id)}
              />
            ))}

            {t.rubric.kpis.length === 0 && (
              <p className="rounded-xl border border-dashed border-rule-strong bg-surface-sunk px-4 py-6 text-center text-sm text-ink-muted">
                No KPIs yet — add one to tell the AI what to score.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <Button variant="outline" size="sm" icon={<Plus size={14} />} onClick={addKpi}>Add custom KPI</Button>
              <span className="text-xs text-ink-muted">
                <b className="font-bold tabular-nums text-ink-body">{enabledKpis.length}</b> of{' '}
                <b className="font-bold tabular-nums text-ink-body">{t.rubric.kpis.length}</b> KPIs scored
              </span>
            </div>
          </FormSection>

          <FormSection title="Branding" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Company name" value={t.branding.companyName} onChange={(e) => patchBranding({ companyName: e.target.value })} />
              <div className="flex flex-col gap-1.5">
                <label className="field-label">Accent color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={t.branding.accentColor}
                    onChange={(e) => patchBranding({ accentColor: e.target.value })}
                    className="h-11 w-12 flex-shrink-0 cursor-pointer rounded-xl border-[1.5px] border-rule-strong bg-surface p-1"
                    aria-label="Accent color picker"
                  />
                  <input
                    value={t.branding.accentColor}
                    onChange={(e) => patchBranding({ accentColor: e.target.value })}
                    className="input-base font-mono text-sm uppercase"
                    aria-label="Accent color hex"
                  />
                </div>
              </div>
            </div>
            <Input label="Logo URL (optional)" value={t.branding.logoUrl ?? ''} onChange={(e) => patchBranding({ logoUrl: e.target.value })} placeholder="https://…" />
            <Textarea label="Welcome message" value={t.branding.welcomeMessage ?? ''} onChange={(e) => patchBranding({ welcomeMessage: e.target.value })} className="h-20" />
          </FormSection>

          <FormSection title="Integrity" className="space-y-1">
            <Toggle label="Enforce fullscreen" description="Ask the candidate to stay in fullscreen during the interview." checked={t.integrity.enforceFullscreen} onChange={(v) => patchIntegrity({ enforceFullscreen: v })} />
            <Toggle label="Detect tab switching" description="Count window blur / tab changes and warn the candidate." checked={t.integrity.detectTabSwitch} onChange={(v) => patchIntegrity({ detectTabSwitch: v })} />
            <Toggle label="Disable paste in answers" checked={t.integrity.disablePasteInAnswers} onChange={(v) => patchIntegrity({ disablePasteInAnswers: v })} />
            <Toggle label="Disable copy" checked={t.integrity.disableCopy} onChange={(v) => patchIntegrity({ disableCopy: v })} />
            <Toggle label="Log integrity events" description="Surface events in the recruiter report." checked={t.integrity.logEvents} onChange={(v) => patchIntegrity({ logEvents: v })} />
            <div className="pt-3">
              <Input label="Max tab-switch warnings" type="number" value={t.integrity.maxTabSwitchWarnings} onChange={(e) => patchIntegrity({ maxTabSwitchWarnings: num(e.target.value, 3) })} />
            </div>
          </FormSection>
        </div>

        {/* ── live preview ── */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <SectionTitle>Live preview</SectionTitle>
          <Card className="overflow-hidden rounded-2xl p-0 shadow-lg">
            <div className="flex items-center gap-2 border-b border-border bg-surface-sunk px-5 py-3">
              <span className="live-dot" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">What the candidate sees</span>
            </div>

            <div className="space-y-6 p-5">
              <div>
                <PreviewLabel>Branding</PreviewLabel>
                <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-border bg-surface p-3">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: accent }}>
                    {t.branding.companyName.charAt(0) || 'T'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{t.branding.companyName}</span>
                  <Badge variant={t.track === 'chat' ? 'neutral' : 'info'}>{TRACK_LABEL[t.track] ?? 'Chat'}</Badge>
                </div>
              </div>

              <div>
                <PreviewLabel>Per-question flow</PreviewLabel>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {conversational ? (
                    t.mode === 'timed' ? (
                      <>
                        <FlowStep>Think {t.conversationTiming?.thinkingSeconds ?? 30}s</FlowStep>
                        <ChevronRight size={12} className="flex-shrink-0 text-ink-disabled" aria-hidden />
                        <FlowStep accent={accent}>Answer {t.conversationTiming?.perQuestionSeconds ?? 120}s</FlowStep>
                        <ChevronRight size={12} className="flex-shrink-0 text-ink-disabled" aria-hidden />
                        <FlowStep>{t.adaptive?.allowFollowUps ? 'Follow-ups' : 'Next'}</FlowStep>
                      </>
                    ) : (
                      <>
                        <FlowStep accent={accent}>Conversational</FlowStep>
                        <ChevronRight size={12} className="flex-shrink-0 text-ink-disabled" aria-hidden />
                        <FlowStep>{t.adaptive?.allowFollowUps ? `up to ${t.adaptive?.maxFollowUpsPerQuestion ?? 1} follow-up(s)/Q` : 'no follow-ups'}</FlowStep>
                      </>
                    )
                  ) : (
                    <>
                      <FlowStep>Prep {t.timing.prepSeconds}s</FlowStep>
                      <ChevronRight size={12} className="flex-shrink-0 text-ink-disabled" aria-hidden />
                      <FlowStep accent={accent}>Answer {t.timing.answerSeconds}s</FlowStep>
                      <ChevronRight size={12} className="flex-shrink-0 text-ink-disabled" aria-hidden />
                      <FlowStep>Auto-submit</FlowStep>
                    </>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-border bg-surface-sunk px-3 py-2.5">
                    <p className="font-display text-xl font-extrabold leading-none tracking-[-0.02em] text-ink tabular-nums">{questionCount || '—'}</p>
                    <p className="mt-1.5 text-[11px] font-medium text-ink-muted">questions</p>
                  </div>
                  <div className="rounded-xl border border-border bg-surface-sunk px-3 py-2.5">
                    <p className="font-display text-xl font-extrabold leading-none tracking-[-0.02em] text-ink tabular-nums">~{totalMin || '—'}</p>
                    <p className="mt-1.5 text-[11px] font-medium text-ink-muted">minutes total</p>
                  </div>
                </div>

                {t.questionSource === 'fixed' && !selectedSet && (
                  <div className="mt-3">
                    <Notice>No question set selected — sessions can&rsquo;t start until you pick one under <b>Questions</b>.</Notice>
                  </div>
                )}
              </div>

              <div>
                <PreviewLabel>Rubric weights</PreviewLabel>
                {enabledKpis.length ? (
                  <div className="mt-2.5 space-y-2">
                    {enabledKpis.map((k) => (
                      <div key={k.id} className="flex items-center gap-2.5">
                        <span className="w-24 truncate text-xs font-medium text-ink-body" title={k.label}>{k.label}</span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-hover">
                          <span className="block h-full rounded-full bg-brand-field transition-[width] duration-200" style={{ width: `${pctOf(k)}%` }} />
                        </span>
                        <span className="w-9 text-right text-[11px] font-bold tabular-nums text-ink-body">{pctOf(k)}%</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 rounded-xl border border-dashed border-rule-strong bg-surface-sunk px-3 py-3 text-xs leading-relaxed text-ink-muted">
                    No KPIs enabled — answers won&rsquo;t receive a weighted score.
                  </p>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

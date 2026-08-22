import { useState, useEffect, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useReplicas, usePersonas, useCreateConversation } from '@/hooks/useTavus'
import { settingsApi } from '@/lib/api'
import { avatarInterviewContext, avatarGreetingText, localTimeOfDay } from '@shared/speech'
import { useAppStore } from '@/store/useAppStore'
import type { Draft } from '@/store/useAppStore'
import { Button, Card, Input, Textarea, Select, Toggle, Slider, JsonPreview, Modal, Skeleton } from '@/components/ui'
import { AlertCircle, Archive, Bot, Check, Database, Info, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { ReplicaPicker } from '@/components/tavus/ReplicaPicker'
import { formatDistanceToNow } from 'date-fns'
import type { CreateConversationInput, SupportedLanguage, PipelineMode } from '@/types/tavus.types'

// Tavus requires full language names — NOT ISO codes
const LANGS: { value: SupportedLanguage; label: string }[] = [
  { value: 'English',    label: 'English' },
  { value: 'Spanish',    label: 'Spanish' },
  { value: 'French',     label: 'French' },
  { value: 'German',     label: 'German' },
  { value: 'Italian',    label: 'Italian' },
  { value: 'Portuguese', label: 'Portuguese' },
  { value: 'Japanese',   label: 'Japanese' },
  { value: 'Korean',     label: 'Korean' },
  { value: 'Chinese',    label: 'Chinese' },
  { value: 'Hindi',      label: 'Hindi' },
  { value: 'Arabic',     label: 'Arabic' },
]
const PIPELINES: { value: PipelineMode; label: string }[] = [
  { value: 'full', label: 'Full — audio + video' }, { value: 'echo', label: 'Echo — test mode' },
  { value: 'no_audio', label: 'No audio' }, { value: 'video_only', label: 'Video only' },
]

/* ── Shared card header — icon plate, title, optional note + aside ──────────── */
function CardHead({ icon, title, description, aside, accent }: {
  icon: ReactNode; title: string; description?: string; aside?: ReactNode; accent?: boolean
}) {
  return (
    // The ruled cover head, not an icon plate. `icon` and `accent` are retained
    // for the call sites and deliberately not rendered: the plate carried no
    // information the title did not already carry, and a page of identical
    // icon+heading+text blocks gives the eye no structure to scan. `aside` moves
    // INTO the head, where status belongs — right of the label, where the eye
    // lands after reading it.
    <>
      <div className="record-head flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5 py-2.5">
        <h3 className="font-display text-[14px] font-bold text-ink">{title}</h3>
        {aside && <span className="flex flex-shrink-0 items-center gap-2">{aside}</span>}
      </div>
      {description && (
        <p className="border-b border-border px-5 py-3 text-xs leading-relaxed text-ink-muted measure">
          {description}
        </p>
      )}
    </>
  )
}

/* ── One row of the sidebar's field glossary ────────────────────────────────── */
const QUICK_REFERENCE: { field: string; meaning: string }[] = [
  { field: 'conversational_context', meaning: 'The system prompt handed to the Tavus LLM.' },
  { field: 'custom_greeting',        meaning: 'The avatar’s very first words on the call.' },
  { field: 'apply_conversation_override', meaning: 'Must be true before text can be injected live.' },
  { field: 'recording_s3_*',         meaning: 'Only needed when recording is enabled.' },
]

type F = import('@/store/useAppStore').DraftForm
const DEF: F = {
  replica_id: '', persona_id: '', ai_name: '', conversation_name: '', conversational_context: '', custom_greeting: '',
  callback_url: '', max_call_duration: 900, participant_left_timeout: 60, participant_absent_timeout: 300,
  enable_recording: false, enable_transcription: true, apply_conversation_override: false,
  apply_greenscreen: false, background_url: '', language: 'English', pipeline_mode: 'full',
  recording_s3_bucket_name: '', recording_s3_bucket_region: '', aws_assume_role_arn: '',
}

export default function SetupPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const store = useAppStore()
  const { data: replicas } = useReplicas()
  const { data: personas } = usePersonas()
  const create = useCreateConversation()
  const [f, setF] = useState<F>({ ...DEF, replica_id: store.defaultReplicaId, persona_id: store.defaultPersonaId })
  const [modal, setModal] = useState(false)
  // Prefilled when the recruiter arrives here by picking "Conversational AI"
  // in the new-session modal on the Sessions page (returnTo brings them back
  // after applying).
  const navState = location.state as { candidateName?: string; returnTo?: string } | null
  const [name, setName] = useState(navState?.candidateName ?? '')
  // Server-applied avatar config (drives ALL candidate Video Avatar interviews).
  const avatarApplied = useQuery({ queryKey: ['avatar-settings'], queryFn: settingsApi.avatarStatus })
  const [applying, setApplying] = useState(false)
  const [draftModal, setDraftModal] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [errorModal, setErrorModal] = useState<{ open: boolean; message: string }>({ open: false, message: '' })

  useEffect(() => { if (store.defaultReplicaId && !f.replica_id) setF(p => ({ ...p, replica_id: store.defaultReplicaId })) }, [store.defaultReplicaId])
  const set = <K extends keyof F>(k: K, v: F[K]) => setF(p => ({ ...p, [k]: v }))

  const allReplicas = replicas ?? []
  const customReplicas = allReplicas.filter(r => r.replica_type !== 'stock')
  const stockReplicas  = allReplicas.filter(r => r.replica_type === 'stock')

  const perOpts = [{ value: '', label: 'None' }, ...(personas ?? []).map(p => ({ value: p.persona_id, label: p.persona_name }))]

  // Build clean payload — only include non-empty optional fields to avoid 400s.
  // The spoken parts (context + greeting) come from the SHARED voice/persona
  // standard (shared/speech.ts) — the same warm greet → ready-check → varied
  // thanks → warm wrap-up flow the Voice Interview and candidate avatar use,
  // with questions stripped of formatting so nothing markdown-ish is spoken.
  function buildPayload(candidateName: string): CreateConversationInput {
    const qList = store.questions.filter(Boolean)
    const tod = localTimeOfDay()

    const ctx = avatarInterviewContext({
      personaText: f.conversational_context,
      candidateName,
      aiName: f.ai_name,
      questions: qList,
      timeOfDay: tod,
    })
    const greeting = avatarGreetingText({
      custom: f.custom_greeting,
      candidateName,
      aiName: f.ai_name,
      timeOfDay: tod,
    })

    const body: CreateConversationInput = {
      replica_id: f.replica_id,
      conversation_name: `TalbotIQ — ${candidateName}`,
      conversational_context: ctx,
      custom_greeting: greeting,
    }

    // Only add persona_id if explicitly chosen
    if (f.persona_id) body.persona_id = f.persona_id
    if (f.callback_url) body.callback_url = f.callback_url

    // Build properties — send only what's needed, never send pipeline_mode (causes 400 on some plans)
    const props: CreateConversationInput['properties'] = {
      max_call_duration: f.max_call_duration,
      participant_left_timeout: f.participant_left_timeout,
      enable_recording: f.enable_recording,
      enable_transcription: f.enable_transcription,
    }
    // Language: only send if not the default, and always as a full name
    if (f.language && f.language !== 'English') props.language = f.language
    if (f.participant_absent_timeout !== 300) props.participant_absent_timeout = f.participant_absent_timeout
    if (f.apply_conversation_override) props.apply_conversation_override = true
    if (f.apply_greenscreen) { props.apply_greenscreen = true; if (f.background_url) props.background_url = f.background_url }
    if (f.recording_s3_bucket_name) props.recording_s3_bucket_name = f.recording_s3_bucket_name
    if (f.recording_s3_bucket_region) props.recording_s3_bucket_region = f.recording_s3_bucket_region
    if (f.aws_assume_role_arn) props.aws_assume_role_arn = f.aws_assume_role_arn
    body.properties = props

    return body
  }

  // For the live JSON preview panel only
  const payload = buildPayload(name || 'Candidate')

  function resetHumeState() {
    store.setHumeJobId(null)
    store.setHumeJobStatus(null)
    store.setHumeResult(null)
    store.resetQuestionTimestamps()
    store.setLiveEmotions([])
    store.setHumeStreamActive(false)
    store.clearSessionTranscript()
    // Reset transcript-derived metrics so Results page never shows stale defaults
    store.updateMetrics({ wpm: 0, fillers: 0 })
  }

  function launchDemoMode() {
    resetHumeState()
    store.setCurrentConversation({
      conversation_id: `demo-${Date.now()}`,
      conversation_name: `TalbotIQ — ${name || 'Candidate'}`,
      status: 'active', conversation_url: '',
      replica_id: '', created_at: new Date().toISOString(),
    })
    store.setInterviewActive(true)
    store.setCurrentQuestionIdx(0)
    setErrorModal({ open: false, message: '' })
    setModal(false)
    toast('Running in Demo Mode — no avatar video')
    navigate('/interview')
  }

  /**
   * "Apply to Candidate Interviews" — saves this configuration SERVER-side.
   * Every candidate who takes a Conversational AI (Video Avatar) interview gets
   * THIS avatar: the server creates their Tavus conversation from it, with the
   * session's own questions and the candidate's name. Candidates never see a key.
   */
  async function applyToCandidates() {
    if (!f.replica_id) { toast.error('Pick a replica — candidates need a live avatar.'); return }
    if (!store.tavusKey && !avatarApplied.data?.hasKey) {
      toast.error('Add your Tavus API key in Settings first.')
      return
    }
    setApplying(true)
    try {
      await settingsApi.applyAvatar({
        replicaId: f.replica_id,
        personaId: f.persona_id || undefined,
        aiName: f.ai_name || undefined,
        conversationName: f.conversation_name || undefined,
        conversationalContext: f.conversational_context || undefined,
        customGreeting: f.custom_greeting || undefined,
        language: f.language || undefined,
        maxCallDuration: f.max_call_duration,
        enableRecording: f.enable_recording || undefined,
        callbackUrl: f.callback_url || undefined,
        fallbackQuestions: store.questions.filter(Boolean),
        tavusKey: store.tavusKey || undefined,
      })
      qc.invalidateQueries({ queryKey: ['avatar-settings'] })
      toast.success('Applied — every Conversational AI candidate interview now uses this avatar.')
      if (navState?.returnTo) navigate(navState.returnTo, { state: { mode: 'video_avatar' } })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not apply the avatar settings')
    } finally {
      setApplying(false)
    }
  }

  function confirmLaunch() {
    if (!name.trim()) { toast.error('Enter a display name'); return }

    // No replica — demo mode
    if (!f.replica_id) { launchDemoMode(); return }

    const p = buildPayload(name)
    create.mutate(p, {
      onSuccess: (conv) => {
        resetHumeState()
        store.setCurrentConversation(conv)
        store.setInterviewActive(true)
        store.setCurrentQuestionIdx(0)
        setModal(false)
        toast.success('Session created!')
        navigate('/interview')
      },
      onError: (e: any) => {
        const msg = e.message ?? 'Failed to create conversation'
        console.error('Tavus error payload:', JSON.stringify(p, null, 2))
        setModal(false)
        setErrorModal({ open: true, message: msg })
      },
    })
  }

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      {/* ── Hero — two-line display treatment ───────────────────────────────── */}
      <header className="mb-10">
        <span className="pill inline-flex">AI Avatar Screening</span>

        <h1 className="mt-4 font-display font-extrabold tracking-[-0.03em] leading-[0.95]">
          <span className="block text-[26px] text-ink-faint sm:text-4xl">Configure your{' '}</span>
          <span className="mt-1 block text-[38px] text-ink sm:text-5xl">Interview Session</span>
        </h1>

        <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted">
          Set up the avatar, its voice, and the call properties — then
          <span className="font-semibold text-ink-body"> apply it to candidate interviews</span>.
          Every candidate who takes a Conversational AI interview meets this avatar: it greets
          them by name and asks their session’s questions.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={applyToCandidates} loading={applying}>
            Apply to Candidate Interviews
          </Button>
          <Button variant="secondary" onClick={() => setModal(true)} loading={create.isPending}>
            Launch Test Session
          </Button>
          <Button variant="ghost" onClick={() => { setDraftName(''); setDraftModal(true) }}>Save Draft</Button>
        </div>

        {/* Applied-status chip row */}
        {avatarApplied.data?.configured ? (
          <div className="mt-5 inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-full border border-success-border bg-success-bg px-4 py-2">
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-success">
              <span className="live-dot" />
              Live for candidate interviews
            </span>
            {avatarApplied.data.replicaId ? (
              <>
                <span className="h-3.5 w-px bg-success-border" aria-hidden="true" />
                <span className="font-mono text-[11px] text-ink-body">{avatarApplied.data.replicaId}</span>
              </>
            ) : null}
            {avatarApplied.data.updatedAt ? (
              <>
                <span className="h-3.5 w-px bg-success-border" aria-hidden="true" />
                <span className="text-[11px] text-ink-muted">
                  updated {formatDistanceToNow(new Date(avatarApplied.data.updatedAt), { addSuffix: true })}
                </span>
              </>
            ) : null}
          </div>
        ) : avatarApplied.isSuccess ? (
          <div className="mt-5 inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-full border border-warning-border bg-warning-bg px-4 py-2">
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-warning">
              <AlertCircle size={13} strokeWidth={2.25} aria-hidden="true" />
              No avatar applied yet
            </span>
            <span className="h-3.5 w-px bg-warning-border" aria-hidden="true" />
            <span className="text-[11px] text-ink-body">Conversational AI interviews can’t start until you apply one.</span>
          </div>
        ) : avatarApplied.isError ? (
          <div className="mt-5 inline-flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-full border border-border bg-surface-hover px-4 py-2">
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink-body">
              <AlertCircle size={13} strokeWidth={2.25} aria-hidden="true" />
              Couldn’t read the applied-avatar status
            </span>
            <span className="h-3.5 w-px bg-rule-strong" aria-hidden="true" />
            <span className="text-[11px] text-ink-muted">Applying still saves your configuration.</span>
          </div>
        ) : (
          <Skeleton className="mt-5 h-9 w-72 rounded-full" />
        )}
      </header>

      {/* ── Saved drafts ─────────────────────────────────────────────────────── */}
      {store.drafts.length > 0 && (
        <Card className="mb-6 divide-y divide-border">
          <CardHead
            icon={<Archive size={15} strokeWidth={2} aria-hidden="true" />}
            title="Saved drafts"
            description="Load a saved configuration back into the form below."
            aside={<span className="badge badge-neutral tabular-nums">{store.drafts.length}</span>}
          />
          <div className="grid grid-cols-1 gap-3 px-6 py-5 sm:grid-cols-2 lg:grid-cols-3">
            {store.drafts.map((d: Draft) => (
              <div key={d.id} className="group relative">
                <button
                  type="button"
                  onClick={() => { setF({ ...DEF, ...d.form }); store.setQuestions(d.questions); toast.success(`Loaded "${d.name}"`) }}
                  className="w-full rounded-xl border border-border bg-surface p-3.5 pr-11 text-left transition-colors duration-150 hover:border-rule-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1"
                >
                  <p className="truncate text-sm font-semibold text-ink">{d.name}</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    <span className="tabular-nums">{d.questions.filter(Boolean).length}</span> question{d.questions.filter(Boolean).length !== 1 ? 's' : ''}
                    {' · saved '}{formatDistanceToNow(new Date(d.savedAt), { addSuffix: true })}
                  </p>
                  {d.form.replica_id && <p className="mt-1 truncate font-mono text-[11px] text-ink">{d.form.replica_id}</p>}
                </button>
                <button
                  onClick={e => { e.stopPropagation(); store.deleteDraft(d.id); toast('Draft deleted') }}
                  className="absolute right-2 top-2 rounded-full p-1.5 text-ink-faint opacity-0 transition-all duration-150 hover:bg-danger-bg hover:text-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 group-hover:opacity-100"
                  title="Delete draft"
                  aria-label={`Delete draft ${d.name}`}
                >
                  <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        {/* ── Left: form ── */}
        <div className="space-y-5">

          {/* Tavus config */}
          <Card className="divide-y divide-border">
            <CardHead
              accent
              icon={<Bot size={15} strokeWidth={2} aria-hidden="true" />}
              title="Avatar & persona"
              description="The face, voice identity, and opening words candidates meet."
            />
            <div className="grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-2">
              {/* Replica — picker + manual ID entry */}
              <div className="flex flex-col gap-2">
                <ReplicaPicker
                  label="Replica (optional)"
                  replicas={allReplicas}
                  value={f.replica_id}
                  onChange={id => set('replica_id', id)}
                  includeNone
                  noneLabel={allReplicas.length ? 'None (demo mode)' : 'None — no replicas found'}
                  loading={!replicas}
                />

                <div className="flex items-center gap-2.5 pt-0.5">
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-faint">or paste an ID</span>
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                </div>

                <div className="relative">
                  <input
                    type="text"
                    value={f.replica_id}
                    onChange={e => set('replica_id', e.target.value.trim())}
                    placeholder="e.g. r5f0577fc829"
                    aria-label="Replica ID"
                    className="input-base pr-9 font-mono text-sm"
                  />
                  {f.replica_id && (
                    <button
                      type="button"
                      onClick={() => set('replica_id', '')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink-faint transition-colors duration-150 hover:bg-surface-hover hover:text-ink-body"
                      title="Clear replica ID"
                      aria-label="Clear replica ID"
                    ><X size={14} strokeWidth={2.25} aria-hidden="true" /></button>
                  )}
                </div>

                <p className="text-xs leading-relaxed text-ink-faint">
                  {f.replica_id
                    ? <span className="inline-flex items-center gap-1.5 font-medium text-ink"><Check size={12} strokeWidth={2.75} aria-hidden="true" /> Replica set · <span className="font-mono">{f.replica_id}</span></span>
                    : allReplicas.length
                      ? <><span className="tabular-nums">{customReplicas.length}</span> custom · <span className="tabular-nums">{stockReplicas.length}</span> stock available</>
                      : 'No replicas loaded — add your Tavus API key in Settings.'}
                </p>
              </div>

              <Select label="Persona" options={perOpts} value={f.persona_id} onChange={e => set('persona_id', e.target.value)} hint="Optional — inherits replica defaults if unset" />
              <Input label="AI Interviewer Name" value={f.ai_name} onChange={e => set('ai_name', e.target.value)} placeholder="e.g. Maya" hint="The avatar introduces itself with this name (default: Alex)" />
              <Input label="Conversation Name" value={f.conversation_name} onChange={e => set('conversation_name', e.target.value)} placeholder="e.g. Senior Engineer Screen" hint="Base name in Tavus; the candidate's name is appended" />
              <div className="sm:col-span-2"><Textarea label="Conversational Context" value={f.conversational_context} onChange={e => set('conversational_context', e.target.value)} placeholder="You are Alex, a Senior Talent Specialist at TalbotIQ. Ask each question clearly and wait for the candidate's full response before proceeding. Maintain a warm, professional tone throughout." className="min-h-[100px]" hint="This is the system prompt sent to the Tavus LLM" /></div>
              <div className="sm:col-span-2"><Input label="Custom Greeting" value={f.custom_greeting} onChange={e => set('custom_greeting', e.target.value)} placeholder="Hello! Welcome to your TalbotIQ interview. I'm excited to learn more about you today." hint="The very first thing the avatar says when the session starts" /></div>
              <div className="sm:col-span-2"><Input label="Callback URL" value={f.callback_url} onChange={e => set('callback_url', e.target.value)} placeholder="https://api.yourcompany.com/tavus-events" hint="Receives all conversation webhook events" /></div>
            </div>
          </Card>

          {/* Questions */}
          {/* Questions are NOT configured here — they come from the invite flow:
              tailored per candidate from their résumé, or a chosen question set.
              The server injects them into each candidate's Tavus conversation. */}
          <Card className="px-6 py-5">
            <div className="flex items-start gap-3 text-sm text-ink-muted">
              <span className="mt-0.5 flex-shrink-0 text-ink-muted">
                <Info size={15} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <p className="leading-relaxed">
                <span className="font-semibold text-ink-body">Interview questions are set when you invite candidates</span> — tailored to each
                candidate's résumé or taken from your question set, chosen in{' '}
                <span className="font-medium text-ink-body">Sessions → Invite candidates</span>. This page only configures the avatar
                (face, persona, greeting, call properties); each candidate's questions are injected into the avatar's script automatically.
              </p>
            </div>
          </Card>

          {/* Session properties */}
          <Card className="divide-y divide-border">
            <CardHead
              icon={<SlidersHorizontal size={15} strokeWidth={2} aria-hidden="true" />}
              title="Session properties"
              description="Every value here maps to the Tavus conversation properties object."
            />
            <div className="space-y-5 px-6 py-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Select label="Language" options={LANGS.map(l => ({ value: l.value, label: l.label }))} value={f.language} onChange={e => set('language', e.target.value as SupportedLanguage)} />
                <Select label="Pipeline Mode" options={PIPELINES.map(p => ({ value: p.value, label: p.label }))} value={f.pipeline_mode} onChange={e => set('pipeline_mode', e.target.value as PipelineMode)} />
              </div>
              <Slider label="Max Call Duration" min={60} max={7200} step={60} value={f.max_call_duration} onChange={v => set('max_call_duration', v)} formatValue={v => `${Math.floor(v / 60)} min`} />
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Input label="Participant Left Timeout (s)" type="number" value={f.participant_left_timeout} onChange={e => set('participant_left_timeout', Number(e.target.value))} hint="Wait this long after the candidate drops before ending." />
                <Input label="Absent Timeout (s)" type="number" value={f.participant_absent_timeout} onChange={e => set('participant_absent_timeout', Number(e.target.value))} hint="Wait this long for a candidate who never joins." />
              </div>
            </div>
            <div className="divide-y divide-border px-6">
              <Toggle checked={f.enable_transcription} onChange={v => set('enable_transcription', v)} label="Enable Transcription" description="Real-time transcription of candidate speech via Tavus" />
              <Toggle checked={f.enable_recording} onChange={v => set('enable_recording', v)} label="Enable Recording" description="Save the full session video to storage" />
              <Toggle checked={f.apply_conversation_override} onChange={v => set('apply_conversation_override', v)} label="Conversation Override" description="Allow real-time text injection during the call" />
              <Toggle checked={f.apply_greenscreen} onChange={v => set('apply_greenscreen', v)} label="Virtual Background" description="Replace avatar background with a custom image" />
            </div>
            {f.apply_greenscreen && (
              <div className="px-6 py-5">
                <Input label="Background Image URL" value={f.background_url} onChange={e => set('background_url', e.target.value)} placeholder="https://cdn.example.com/office-background.jpg" hint="A 16:9 image works best behind the avatar." />
              </div>
            )}
          </Card>

          {/* S3 Storage — revealed when recording is on */}
          {f.enable_recording && (
            <Card className="divide-y divide-border animate-slide-up">
              <CardHead
                icon={<Database size={15} strokeWidth={2} aria-hidden="true" />}
                title="S3 recording storage"
                description="Where finished session recordings are written."
                aside={<span className="badge badge-info">Recording on</span>}
              />
              <div className="space-y-5 px-6 py-5">
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <Input label="Bucket Name" value={f.recording_s3_bucket_name} onChange={e => set('recording_s3_bucket_name', e.target.value)} placeholder="my-talbotiq-recordings" />
                  <Input label="Region" value={f.recording_s3_bucket_region} onChange={e => set('recording_s3_bucket_region', e.target.value)} placeholder="us-east-1" />
                </div>
                <Input label="AWS Assume Role ARN" value={f.aws_assume_role_arn} onChange={e => set('aws_assume_role_arn', e.target.value)} placeholder="arn:aws:iam::123456789012:role/TavusRecordingRole" hint="Tavus assumes this role to write into your bucket." />
              </div>
            </Card>
          )}
        </div>

        {/* ── Right: live request preview ── */}
        <aside className="sticky top-20 hidden h-fit flex-col gap-5 xl:flex">
          <JsonPreview data={payload} title="Request Preview" method="POST" endpoint="/v2/conversations" />
          <Card className="p-5">
            <p className="section-label">Field glossary</p>
            <dl className="mt-4 space-y-3.5">
              {QUICK_REFERENCE.map(({ field, meaning }) => (
                <div key={field}>
                  <dt className="font-mono text-[11px] font-medium text-ink">{field}</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-ink-muted">{meaning}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </aside>
      </div>

      {/* ── Save Draft modal ─────────────────────────────────────────────────── */}
      <Modal open={draftModal} onClose={() => setDraftModal(false)} title="Save draft" description="Name this configuration so you can load it again later." width="max-w-md">
        <Input label="Draft Name *" value={draftName} onChange={e => setDraftName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && draftName.trim()) {
              store.saveDraft(draftName.trim(), f, store.questions)
              toast.success(`Draft "${draftName.trim()}" saved`)
              setDraftModal(false)
            }
          }}
          placeholder="e.g. Senior Engineer Screen" hint="Press Enter to save." autoFocus />
        <div className="mt-7 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDraftModal(false)}>Cancel</Button>
          <Button onClick={() => {
            if (!draftName.trim()) { toast.error('Enter a draft name'); return }
            store.saveDraft(draftName.trim(), f, store.questions)
            toast.success(`Draft "${draftName.trim()}" saved`)
            setDraftModal(false)
          }}>Save draft</Button>
        </div>
      </Modal>

      {/* ── Launch modal ─────────────────────────────────────────────────────── */}
      <Modal open={modal} onClose={() => setModal(false)} title="Confirm test session" description="Enter the candidate's name — the avatar greets them by it." width="max-w-md">
        <Input label="Candidate Name *" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') confirmLaunch() }} placeholder="e.g. Arjun Kumar" hint={f.replica_id ? undefined : 'No replica selected — this will run in Demo Mode, without avatar video.'} autoFocus />
        <div className="mt-7 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={confirmLaunch} loading={create.isPending}>Launch interview</Button>
        </div>
      </Modal>

      {/* ── Tavus error — demo mode stays the hero recovery ──────────────────── */}
      <Modal open={errorModal.open} onClose={() => setErrorModal({ open: false, message: '' })} width="max-w-md">
        <div className="mb-5 flex items-start gap-4">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-danger-border bg-danger-bg text-danger">
            <AlertCircle size={18} strokeWidth={2.25} aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-lg font-bold leading-tight text-ink">Tavus could not create the session</h3>
            <p className="mt-1 text-sm text-ink-muted">Your configuration is safe — nothing was lost.</p>
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-danger-border bg-danger-bg px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-danger/70">What Tavus returned</p>
          <p className="mt-1 text-sm font-medium text-danger">{errorModal.message}</p>
        </div>

        {/credit/i.test(errorModal.message) && (
          <div className="mb-5 space-y-1 rounded-xl border border-warning-border bg-warning-bg px-4 py-3 text-sm">
            <p className="font-semibold text-warning">Your Tavus account is out of conversational credits.</p>
            <p className="text-ink-body">To resume live avatar interviews, buy more credits at <span className="font-mono text-xs">tavus.io → Billing</span>.</p>
          </div>
        )}

        {/* Actions — demo-mode fallback stays the hero recovery */}
        <div className="flex flex-col gap-3">
          <Button size="lg" onClick={launchDemoMode} className="w-full">
            Continue in Demo Mode (no avatar)
          </Button>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setErrorModal({ open: false, message: '' }); setModal(true) }}>
              Try again
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => setErrorModal({ open: false, message: '' })}>
              Dismiss
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

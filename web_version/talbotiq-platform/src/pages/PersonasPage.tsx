import { useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import {
  AlertTriangle, Bot, Camera, Cpu, Ear, Eye, Pencil, Plus, RefreshCw, SquareUser, Trash2, Volume2, X,
} from 'lucide-react'
import { usePersonas, useCreatePersona, useUpdatePersona, useDeletePersona, useReplicas } from '@/hooks/useTavus'
import { Button, Card, Modal, Input, Textarea, Select, Toggle, Slider, JsonPreview, SectionTitle, EmptyState, Badge, PageHeader } from '@/components/ui'
import { cn } from '@/components/ui'
import { ReplicaPicker } from '@/components/tavus/ReplicaPicker'
import type { CreatePersonaInput, PersonaLayers, EmotionTag } from '@/types/tavus.types'

const EMOTIONS: EmotionTag[] = ['anger', 'positivity', 'surprise', 'sadness', 'curiosity']
const LLM_OPTS = [
  { value: 'gpt-4o', label: 'GPT-4o' }, { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' }, { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { value: 'custom', label: 'Custom endpoint' },
]
const TTS_OPTS = [{ value: 'tavus', label: 'Tavus (default)' }, { value: 'cartesia', label: 'Cartesia' }, { value: 'eleven_labs', label: 'ElevenLabs' }]
const STT_OPTS = [{ value: 'tavus', label: 'Tavus (default)' }, { value: 'deepgram', label: 'Deepgram' }, { value: 'custom', label: 'Custom' }]

const defaultLayers = (): PersonaLayers => ({
  llm: { model: 'gpt-4o', max_tokens: 1024, temperature: 0.7 },
  tts: { tts_engine: 'tavus', voice_settings: { speed: 1.0, emotion: ['positivity'] } },
  stt: { stt_engine: 'tavus', participant_pause_sensitivity: 0.5, smart_turn_detection: true },
  perception: { ambient_awareness_queries: [] }, vqa: { enable_camera: false },
})

type FormState = Omit<CreatePersonaInput, 'layers'> & { layers: PersonaLayers }

/* ── Layer heading — SectionTitle with a layer glyph ────────────────────────── */
function LayerTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <SectionTitle className="mb-1">
      <span className="inline-flex items-center gap-2 align-middle">
        {icon}
        {children}
      </span>
    </SectionTitle>
  )
}

/* ── Small capability chip on a persona card ────────────────────────────────── */
function LayerChip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600">
      <span className="text-neutral-400">{icon}</span>
      {children}
    </span>
  )
}

/* ── Grouped, bordered well for optional sub-settings ───────────────────────── */
function SubPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-neutral-50 p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">{title}</p>
      {children}
    </div>
  )
}

/* ── Loading placeholder that mirrors the real persona card ─────────────────── */
function PersonaCardSkeleton() {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3.5 w-3/5 animate-pulse rounded bg-neutral-100" />
          <div className="h-2.5 w-2/5 animate-pulse rounded bg-neutral-100" />
        </div>
        <div className="h-5 w-16 flex-shrink-0 animate-pulse rounded-full bg-neutral-100" />
      </div>
      <div className="space-y-2 py-1">
        <div className="h-2.5 w-full animate-pulse rounded bg-neutral-100" />
        <div className="h-2.5 w-11/12 animate-pulse rounded bg-neutral-100" />
        <div className="h-2.5 w-2/3 animate-pulse rounded bg-neutral-100" />
      </div>
      <div className="mt-auto flex gap-2 border-t border-border pt-3">
        <div className="h-8 w-20 animate-pulse rounded-full bg-neutral-100" />
        <div className="h-8 w-20 animate-pulse rounded-full bg-neutral-100" />
      </div>
    </Card>
  )
}

export default function PersonasPage() {
  const { data: personas, isLoading, isError, error, refetch, isFetching } = usePersonas()
  const { data: replicas } = useReplicas()
  const create = useCreatePersona(); const update = useUpdatePersona(); const del = useDeletePersona()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({ persona_name: '', system_prompt: '', context: '', default_replica_id: '', layers: defaultLayers() })

  const setF = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(p => ({ ...p, [k]: v }))
  const setLayer = <S extends keyof PersonaLayers>(s: S, patch: Partial<NonNullable<PersonaLayers[S]>>) =>
    setForm(p => ({ ...p, layers: { ...p.layers, [s]: { ...(p.layers[s] ?? {}), ...patch } } }))

  function openCreate() { setForm({ persona_name: '', system_prompt: '', context: '', default_replica_id: '', layers: defaultLayers() }); setEditing(null); setShowForm(true) }
  function openEdit(id: string) {
    const p = personas?.find(x => x.persona_id === id); if (!p) return
    setForm({ persona_name: p.persona_name, system_prompt: p.system_prompt, context: p.context ?? '', default_replica_id: p.default_replica_id ?? '', layers: p.layers ?? defaultLayers() })
    setEditing(id); setShowForm(true)
  }

  function submit() {
    const base = { persona_name: form.persona_name, system_prompt: form.system_prompt, layers: form.layers }
    // Create (POST): omit empty optionals to avoid 400s. Edit (PATCH): send them
    // explicitly (even as '') so clearing the default replica / context persists —
    // a missing key in a PATCH leaves the old value untouched.
    const payload: CreatePersonaInput = editing
      ? { ...base, context: form.context, default_replica_id: form.default_replica_id }
      : { ...base, ...(form.context && { context: form.context }), ...(form.default_replica_id && { default_replica_id: form.default_replica_id }) }
    const opts = { onSuccess: () => { toast.success(editing ? 'Persona updated' : 'Persona created'); setShowForm(false) }, onError: (e: any) => toast.error(e.message) }
    editing ? update.mutate({ id: editing, data: payload }, opts) : create.mutate(payload, opts)
  }

  const L = form.layers; const llm = L.llm ?? {}; const tts = L.tts ?? {}
  const stt = L.stt ?? {}; const perception = L.perception ?? {}; const vqa = L.vqa ?? {}
  const queries = perception.ambient_awareness_queries ?? []

  const formActions = (
    <>
      <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
      <Button onClick={submit} loading={create.isPending || update.isPending}>{editing ? 'Save changes' : 'Create persona'}</Button>
    </>
  )

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      <PageHeader
        kicker="AI behaviour"
        title="Personas"
        description="Configure how your AI avatar thinks (LLM), speaks (TTS), listens (STT), and perceives the room."
        action={<Button icon={<Plus size={15} strokeWidth={2.5} aria-hidden="true" />} onClick={openCreate}>New persona</Button>}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <PersonaCardSkeleton key={i} />)}
        </div>
      ) : isError ? (
        <EmptyState
          icon={<AlertTriangle strokeWidth={1.75} aria-hidden="true" />}
          title="Couldn't load your personas"
          description={error instanceof Error && error.message ? error.message : 'The Tavus persona list did not load. Check your API key in Settings, then try again.'}
          action={
            <Button variant="outline" loading={isFetching} icon={<RefreshCw size={14} strokeWidth={2.25} aria-hidden="true" />} onClick={() => refetch()}>
              Try again
            </Button>
          }
        />
      ) : !personas?.length ? (
        <EmptyState
          icon={<Bot strokeWidth={1.75} aria-hidden="true" />}
          title="No personas yet"
          description="A persona defines how your AI avatar thinks, speaks, and listens during an interview. Create one to get started."
          action={<Button icon={<Plus size={15} strokeWidth={2.5} aria-hidden="true" />} onClick={openCreate}>Create first persona</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {personas.map(p => {
            const ttsEngine = p.layers?.tts?.tts_engine
            const sttEngine = p.layers?.stt?.stt_engine
            const camera = p.layers?.vqa?.enable_camera
            return (
              <Card key={p.persona_id} hover className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-900">{p.persona_name}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-neutral-400">{p.persona_id}</p>
                  </div>
                  {p.layers?.llm?.model && <Badge variant="info" className="flex-shrink-0">{p.layers.llm.model}</Badge>}
                </div>

                <p className="line-clamp-3 flex-1 text-xs leading-relaxed text-neutral-500">{p.system_prompt}</p>

                {(ttsEngine || sttEngine || camera) && (
                  <div className="flex flex-wrap gap-1.5">
                    {ttsEngine && <LayerChip icon={<Volume2 size={11} strokeWidth={2} aria-hidden="true" />}>{ttsEngine}</LayerChip>}
                    {sttEngine && <LayerChip icon={<Ear size={11} strokeWidth={2} aria-hidden="true" />}>{sttEngine}</LayerChip>}
                    {camera && <LayerChip icon={<Camera size={11} strokeWidth={2} aria-hidden="true" />}>camera on</LayerChip>}
                  </div>
                )}

                <div className="mt-auto flex gap-2 border-t border-border pt-3">
                  <Button variant="ghost" size="sm" icon={<Pencil size={12} strokeWidth={2.25} aria-hidden="true" />} onClick={() => openEdit(p.persona_id)}>Edit</Button>
                  <Button variant="danger" size="sm" icon={<Trash2 size={12} strokeWidth={2.25} aria-hidden="true" />} onClick={() => del.mutate(p.persona_id, { onSuccess: () => toast.success('Deleted'), onError: (e: any) => toast.error(e.message) })}>Delete</Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Form modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? 'Edit persona' : 'Create persona'} description="Every field maps directly to the Tavus personas API." width="max-w-5xl">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
          {/* Layer stack */}
          <div className="max-h-[64vh] space-y-9 overflow-y-auto pr-3">

            <section className="space-y-4">
              <LayerTitle icon={<SquareUser size={13} strokeWidth={2.25} aria-hidden="true" />}>Identity</LayerTitle>
              <Input label="Persona Name *" value={form.persona_name} onChange={e => setF('persona_name', e.target.value)} placeholder="e.g. Alex — Senior Interviewer" />
              <ReplicaPicker label="Default Replica" replicas={replicas ?? []} value={form.default_replica_id ?? ''} onChange={id => setF('default_replica_id', id)} includeNone noneLabel="None — inherit at call time" loading={!replicas} hint="Used whenever a conversation doesn't name its own replica." />
              <Textarea label="System Prompt *" value={form.system_prompt} onChange={e => setF('system_prompt', e.target.value)} charLimit={4096} placeholder="You are Alex, a professional interviewer at TalbotIQ. Ask each question clearly and wait for the candidate's full response before proceeding. Maintain a warm, encouraging tone." className="min-h-[110px]" />
              <Textarea label="Context" value={form.context} onChange={e => setF('context', e.target.value)} placeholder="Additional context the avatar should know about the role, company, or candidate…" />
            </section>

            <section className="space-y-4">
              <LayerTitle icon={<Cpu size={13} strokeWidth={2.25} aria-hidden="true" />}>LLM layer</LayerTitle>
              <Select label="Model" options={LLM_OPTS} value={llm.model ?? 'gpt-4o'} onChange={e => setLayer('llm', { model: e.target.value as any })} />
              {llm.model === 'custom' && (
                <SubPanel title="Custom endpoint">
                  <Input label="Base URL" value={llm.base_url ?? ''} onChange={e => setLayer('llm', { base_url: e.target.value })} placeholder="https://api.example.com/v1" />
                  <Input label="API Key" value={llm.api_key ?? ''} onChange={e => setLayer('llm', { api_key: e.target.value })} placeholder="sk-…" />
                </SubPanel>
              )}
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Input label="Max Tokens" type="number" min={1} max={4096} value={llm.max_tokens ?? 1024} onChange={e => setLayer('llm', { max_tokens: Number(e.target.value) })} hint="Upper bound on each avatar reply." />
                <Slider label="Temperature" min={0} max={2} step={0.05} value={llm.temperature ?? 0.7} onChange={v => setLayer('llm', { temperature: v })} formatValue={v => v.toFixed(2)} hint="0 = deterministic · 2 = creative" />
              </div>
            </section>

            <section className="space-y-4">
              <LayerTitle icon={<Volume2 size={13} strokeWidth={2.25} aria-hidden="true" />}>TTS layer</LayerTitle>
              <Select label="TTS Engine" options={TTS_OPTS} value={tts.tts_engine ?? 'tavus'} onChange={e => setLayer('tts', { tts_engine: e.target.value as any })} />
              {tts.tts_engine !== 'tavus' && (
                <SubPanel title="External voice credentials">
                  <Input label="TTS API Key" value={tts.api_key ?? ''} onChange={e => setLayer('tts', { api_key: e.target.value })} placeholder="ElevenLabs / Cartesia key" />
                  <Input label="External Voice ID" value={tts.external_voice_id ?? ''} onChange={e => setLayer('tts', { external_voice_id: e.target.value })} placeholder="voice_xxxxxxxx" />
                </SubPanel>
              )}
              <Slider label="Speaking Speed" min={0.5} max={2} step={0.05} value={tts.voice_settings?.speed ?? 1.0} onChange={v => setLayer('tts', { voice_settings: { ...(tts.voice_settings ?? {}), speed: v } })} formatValue={v => `${v.toFixed(2)}×`} />
              <div className="flex flex-col gap-2">
                <span className="field-label">Voice Emotions</span>
                <div className="flex flex-wrap gap-2">
                  {EMOTIONS.map(tag => {
                    const active = (tts.voice_settings?.emotion ?? []).includes(tag)
                    return (
                      <button key={tag} type="button" aria-pressed={active}
                        onClick={() => { const cur = tts.voice_settings?.emotion ?? []; const next = active ? cur.filter(t => t !== tag) : [...cur, tag]; setLayer('tts', { voice_settings: { ...(tts.voice_settings ?? {}), emotion: next } }) }}
                        className={cn(
                          'inline-flex h-8 items-center rounded-full border px-3.5 text-xs font-semibold capitalize',
                          'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-1',
                          active
                            ? 'border-primary-700 bg-primary-700 text-white'
                            : 'border-border bg-white text-neutral-500 hover:border-primary-300 hover:text-primary-700',
                        )}>
                        {tag}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-neutral-400">Colours the avatar's delivery. Select as many as fit the role.</p>
              </div>
            </section>

            <section className="space-y-4">
              <LayerTitle icon={<Ear size={13} strokeWidth={2.25} aria-hidden="true" />}>STT layer</LayerTitle>
              <Select label="STT Engine" options={STT_OPTS} value={stt.stt_engine ?? 'tavus'} onChange={e => setLayer('stt', { stt_engine: e.target.value as any })} />
              <Slider label="Pause Sensitivity" min={0} max={1} step={0.05} value={stt.participant_pause_sensitivity ?? 0.5} onChange={v => setLayer('stt', { participant_pause_sensitivity: v })} hint="Low (0.00) · Medium (0.50) · High (1.00)" />
              <div className="rounded-xl border border-border bg-neutral-50 px-4">
                <Toggle checked={stt.smart_turn_detection ?? true} onChange={v => setLayer('stt', { smart_turn_detection: v })} label="Smart Turn Detection" description="Detects natural speech pauses to know when the avatar should respond" />
              </div>
            </section>

            <section className="space-y-4">
              <LayerTitle icon={<Eye size={13} strokeWidth={2.25} aria-hidden="true" />}>Perception layer</LayerTitle>
              <div className="flex flex-col gap-2">
                <span className="field-label">Ambient Awareness Queries</span>
                {queries.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-xs leading-relaxed text-neutral-400">
                    None yet — add a question the avatar quietly keeps checking during the call, such as room noise or lighting.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {queries.map((q, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input value={q} onChange={e => { const arr = [...(perception.ambient_awareness_queries ?? [])]; arr[i] = e.target.value; setLayer('perception', { ambient_awareness_queries: arr }) }}
                          className="input-base flex-1" placeholder="e.g. Is the candidate in a quiet environment?" />
                        <button type="button"
                          onClick={() => { const arr = [...(perception.ambient_awareness_queries ?? [])]; arr.splice(i, 1); setLayer('perception', { ambient_awareness_queries: arr }) }}
                          aria-label={`Remove ambient awareness query ${i + 1}`}
                          title="Remove query"
                          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors duration-150 hover:bg-danger-bg hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40">
                          <X size={15} strokeWidth={2.25} aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <Button type="button" variant="outline" size="xs" icon={<Plus size={13} strokeWidth={2.5} aria-hidden="true" />}
                    onClick={() => setLayer('perception', { ambient_awareness_queries: [...(perception.ambient_awareness_queries ?? []), ''] })}>
                    Add query
                  </Button>
                </div>
              </div>
              <Input label="Perception Model" value={perception.perception_model ?? ''} onChange={e => setLayer('perception', { perception_model: e.target.value })} placeholder="Optional custom model ID" hint="Leave blank to use the Tavus default." />
            </section>

            <section className="space-y-4">
              <LayerTitle icon={<Camera size={13} strokeWidth={2.25} aria-hidden="true" />}>VQA layer</LayerTitle>
              <div className="rounded-xl border border-border bg-neutral-50 px-4">
                <Toggle checked={vqa.enable_camera ?? false} onChange={v => setLayer('vqa', { enable_camera: v })} label="Enable Camera (VQA)" description="Allow the avatar to see and respond to the candidate's visual environment" />
              </div>
            </section>
          </div>

          {/* JSON Preview */}
          <div className="hidden lg:flex flex-col gap-5">
            <JsonPreview data={{ persona_name: form.persona_name, system_prompt: form.system_prompt, context: form.context, default_replica_id: form.default_replica_id, layers: form.layers }} title="API Preview" method={editing ? 'PATCH' : 'POST'} endpoint="/v2/personas" />
            <div className="flex justify-end gap-3">{formActions}</div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t border-border pt-5 lg:hidden">{formActions}</div>
      </Modal>
    </div>
  )
}

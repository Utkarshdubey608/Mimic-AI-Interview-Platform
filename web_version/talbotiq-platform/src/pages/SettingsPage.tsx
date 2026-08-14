import { useEffect, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { PlugZap, Server, SlidersHorizontal, Video, Webhook, XCircle } from 'lucide-react'
import { Button, Card, Toggle, PageHeader, Input, cn } from '@/components/ui'
import { useAppStore } from '@/store/useAppStore'
import { tavus } from '@/services/tavus'
import { settingsApi } from '@/lib/api'
import { httpBase } from '@/lib/apiOrigin'
import { GeminiKeyCard } from '@/features/recruiter/GeminiKeyCard'

/**
 * Settings — AI Avatar Screening credentials, hybrid model.
 *
 * • Tavus key: a real runtime key entered here (never compiled into the bundle).
 * • Gemini: configured via the shared GeminiKeyCard (server-side) — the same key
 *   powers both recruiter scoring and the avatar ATS analysis. (Frozen module,
 *   reused read-only.)
 * • Deepgram / Hume / AWS Rekognition: SERVER-side secrets set via the server
 *   environment (see .env.example). Shown here as read-only status — no key ever
 *   entered or tested from the browser.
 */
const SERVER_KEYS = [
  { key: 'deepgram',    label: 'Deepgram Nova-3',  env: 'DEEPGRAM_API_KEY',                      hint: 'Live transcription, speaking pace & filler analysis' },
  { key: 'hume',        label: 'Hume AI',          env: 'HUME_API_KEY',                          hint: 'Voice prosody & emotional-intelligence (batch)' },
  { key: 'rekognition', label: 'AWS Rekognition',  env: 'AWS_ACCESS_KEY_ID / SECRET / REGION',   hint: 'Facial expression & engagement analysis' },
] as const

type StatusMap = { deepgram: boolean; hume: boolean; gemini: boolean; rekognition: boolean }

/* ─── local presentational pieces ────────────────────────────────────────── */

/** One panel head: icon plate, title, a single calm line of context. */
function PanelHead({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3.5 px-6 py-5">
      <span className="mt-px flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-primary-100 bg-primary-50 text-primary-700" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="font-display text-[15px] font-bold leading-tight tracking-[-0.02em] text-neutral-900">{title}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">{children}</p>
      </div>
    </div>
  )
}

/** Live result of the last connection test. */
function ConnChip({ state }: { state: 'idle' | 'testing' | 'ok' | 'fail' }) {
  if (state === 'ok')      return <span className="badge badge-success"><span className="live-dot" />Connected</span>
  if (state === 'fail')    return <span className="badge badge-danger"><XCircle size={11} aria-hidden />Failed</span>
  if (state === 'testing') return <span className="badge badge-neutral animate-pulse">Testing…</span>
  return null
}

export default function SettingsPage() {
  const store = useAppStore()
  const [tavusKey, setTavusKeyLocal] = useState('')
  const [showTavus, setShowTavus] = useState(false)
  const [webhook, setWebhook] = useState('')
  const [connState, setConnState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [status, setStatus] = useState<StatusMap | null>(null)
  const [whiteLabelMode, setWhiteLabelMode] = useState(false)
  const [gdprAuto, setGdprAuto] = useState(true)
  const [multiLang, setMultiLang] = useState(false)

  useEffect(() => {
    setTavusKeyLocal(store.tavusKey)
    setWebhook(store.webhookUrl)
    fetch(`${httpBase()}/avatar/status`).then(r => (r.ok ? r.json() : null)).then(setStatus).catch(() => setStatus(null))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The browser holds no Tavus key anymore — every call goes through the
  // backend proxy, which attaches the SERVER-side key. So "Test connection"
  // exercises the key currently saved on the server (Save first to test a
  // freshly pasted key).
  async function testConnection() {
    setConnState('testing')
    try {
      const reps = await tavus.listReplicas()
      setConnState('ok')
      toast.success(`Connected — ${Array.isArray(reps) ? reps.length : 0} replica(s) found`)
    } catch (e) {
      setConnState('fail')
      toast.error((e as Error).message ?? 'Connection failed')
    }
  }

  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    store.setTavusKey(tavusKey)
    store.setWebhookUrl(webhook)
    // Server (single source of truth): applies the key EVERYWHERE at once —
    // candidate avatar interviews, the recruiter dashboard's proxied calls,
    // and any previously-applied Setup config.
    try {
      await settingsApi.saveTavusKey(tavusKey.trim())
      toast.success('Settings saved — Tavus key applied everywhere')
    } catch (e) {
      toast.error(`Server sync failed: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <PageHeader
        kicker="Platform Config"
        title="Settings"
        description="Manage API credentials, webhook endpoints, and platform behaviour."
        action={<Button onClick={() => void save()} loading={saving}>Save settings</Button>}
      />

      <div className="space-y-5">
        {/* Tavus (runtime key) */}
        <Card className="divide-y divide-border">
          <PanelHead icon={<Video size={17} />} title="Tavus — Avatar">
            The single source of truth for your Tavus key — saving applies it everywhere at once (this browser,
            candidate interviews, and any applied avatar config). Never compiled into the app bundle.
          </PanelHead>
          <div className="space-y-5 px-6 py-5">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="tavus-api-key" className="field-label mb-0">Tavus API Key</label>
                <ConnChip state={connState} />
              </div>
              <div className="relative">
                <input
                  id="tavus-api-key"
                  type={showTavus ? 'text' : 'password'}
                  value={tavusKey}
                  onChange={e => setTavusKeyLocal(e.target.value)}
                  placeholder="ta_xxxxxxxxxxxxxxxxxxxxxxxx"
                  className="input-base pr-16 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowTavus(s => !s)}
                  aria-label={showTavus ? 'Hide the Tavus API key' : 'Show the Tavus API key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2.5 py-1 text-[11px] font-semibold text-neutral-500 transition-colors duration-150 hover:bg-neutral-100 hover:text-neutral-800"
                >
                  {showTavus ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="mt-2 text-xs text-neutral-500">Required — find it at tavus.io → Settings → API Keys.</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={testConnection} loading={connState === 'testing'} icon={<PlugZap size={14} />}>
                Test connection
              </Button>
              {connState === 'fail' && (
                <p className="text-xs text-danger">Tavus rejected the saved key or was unreachable — save a valid key, then test again.</p>
              )}
              {connState === 'ok' && (
                <p className="text-xs text-neutral-500">Server key verified — avatar calls are ready.</p>
              )}
            </div>
          </div>
        </Card>

        {/* Gemini — shared server key (frozen recruiter module, reused) */}
        <GeminiKeyCard />

        {/* Server-managed analysis providers (hybrid — keys live in server env) */}
        <Card className="divide-y divide-border">
          <PanelHead icon={<Server size={17} />} title="Analysis providers — server-side">
            These keys stay on the server (set in its environment) and are proxied via{' '}
            <span className="font-mono text-neutral-600">/api/avatar/*</span> — never exposed to the browser.
          </PanelHead>
          <ul className="divide-y divide-border">
            {SERVER_KEYS.map(f => {
              const configured = !!status?.[f.key as keyof StatusMap]
              return (
                <li key={f.key} className="flex items-start justify-between gap-4 px-6 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-neutral-900">{f.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">{f.hint}</p>
                    {!configured && (
                      <p className="mt-1.5 text-[11px] text-neutral-400">
                        Set <span className="font-mono text-neutral-500">{f.env}</span> in the server environment.
                      </p>
                    )}
                  </div>
                  <span className={cn('badge flex-shrink-0', configured ? 'badge-success' : 'badge-neutral', status === null && 'animate-pulse')}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', configured ? 'bg-success' : 'bg-neutral-300')} aria-hidden />
                    {status === null ? 'Checking…' : configured ? 'Configured' : 'Not set'}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>

        {/* Webhook */}
        <Card className="divide-y divide-border">
          <PanelHead icon={<Webhook size={17} />} title="Webhook delivery">
            Receives real-time conversation events from Tavus.
          </PanelHead>
          <div className="px-6 py-5">
            <Input
              label="Webhook URL"
              type="url"
              value={webhook}
              onChange={e => setWebhook(e.target.value)}
              placeholder="https://api.yourcompany.com/webhook/tavus"
              hint="Delivers conversation.started, conversation.ended, transcription, participant events, and errors."
            />
          </div>
        </Card>

        {/* Multi-tenant */}
        <Card className="divide-y divide-border">
          <PanelHead icon={<SlidersHorizontal size={17} />} title="Platform behaviour">
            Multi-tenant and compliance configuration.
          </PanelHead>
          <div className="divide-y divide-border px-6 py-2">
            <Toggle checked={whiteLabelMode} onChange={setWhiteLabelMode} label="White-label mode" description="Remove TalbotIQ branding from candidate-facing screens" />
            <Toggle checked={gdprAuto} onChange={setGdprAuto} label="GDPR auto-purge" description="Automatically delete video and biometric data after 30 days" />
            <Toggle checked={multiLang} onChange={setMultiLang} label="Multi-language avatar" description="Enable multilingual question delivery via Tavus" />
          </div>
        </Card>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <Button onClick={save} loading={saving}>Save settings</Button>
        <Button variant="secondary" onClick={() => { if (confirm('Reset Tavus key and local preferences?')) { localStorage.removeItem('talbotiq-store'); location.reload() } }}>
          Reset to defaults
        </Button>
        <p className="ml-auto hidden text-xs text-neutral-400 sm:block">Saving syncs the Tavus key to the server.</p>
      </div>
    </div>
  )
}

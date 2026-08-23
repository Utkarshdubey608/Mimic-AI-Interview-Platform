import { useEffect, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { PlugZap, Server, SlidersHorizontal, Video, Webhook, XCircle } from 'lucide-react'
import { Button, Card, Toggle, PageHeader, Input, cn } from '@/components/ui'
import { useAppStore } from '@/store/useAppStore'
import { tavus } from '@/services/tavus'
import { settingsApi } from '@/lib/api'
import type { AvatarSettingsStatus } from '@shared/types'
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

/**
 * Whether this deployment has Tavus configured. Read-only, like GeminiKeyCard.
 *
 * `hasKey` is the SERVER's answer. There is deliberately no client-side check: the
 * old one read a key held in the browser, which meant the page could report
 * "connected" for a credential the server had never seen.
 */
function TavusStatusCard() {
  const [status, setStatus] = useState<AvatarSettingsStatus | null>(null)

  useEffect(() => {
    settingsApi.avatarStatus().then(setStatus).catch(() => {})
  }, [])

  const configured = !!status?.hasKey

  return (
    <Card className="divide-y divide-border">
      <PanelHead icon={<Video size={17} />} title="Tavus — Avatar">
        Configured on the server. Drives the video-avatar interview track.
      </PanelHead>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <span
          className={
            configured
              ? 'badge badge-success'
              : 'inline-flex items-center gap-1.5 rounded-md border border-border bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-500'
          }
        >
          {configured ? <span className="live-dot" /> : null}
          {configured ? 'Configured' : 'Not configured'}
        </span>
        <p className="text-xs text-neutral-500">
          {configured
            ? 'Set in the deployment environment.'
            : 'Contact your administrator — this is set in the deployment environment.'}
        </p>
      </div>
    </Card>
  )
}

/**
 * One section of the bundle, introduced by its ruled cover head.
 *
 * This used to be a 9x9 tinted icon plate beside the title, repeated down the
 * page. The plate carried no information — the icon was decorative and the title
 * already said the thing — and a page of identical icon+heading+text blocks has
 * no scannable structure: every section looked exactly as important as every
 * other. The ruled head is the world's own device and does the job the plate was
 * pretending to do.
 *
 * `icon` is retained and deliberately NOT rendered, so the four call sites keep
 * typechecking; drop it as they are touched. Do not reinstate the plate.
 */
function PanelHead({ title, children }: { icon?: ReactNode; title: string; children: ReactNode }) {
  return (
    <>
      <div className="record-head px-5 py-2.5">
        <h2 className="font-display text-[14px] font-bold text-neutral-900">{title}</h2>
      </div>
      <p className="border-b border-border px-5 py-3 text-xs leading-relaxed text-neutral-500 measure">
        {children}
      </p>
    </>
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
    setWebhook(store.webhookUrl)
    // Through httpBase(): a bare '/api/…' path misses the auth interceptor and
    // resolves against the frontend's own origin on a deployed build. Failure
    // still degrades to a null status panel, exactly as before.
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

  /// Saves the webhook URL, which is the only thing left here a person can set.
  ///
  /// The Tavus key that used to be saved alongside it is gone: credentials come from
  /// the deployment environment, and there is no route that accepts one from a
  /// browser. See GeminiKeyCard for the argument.
  async function save() {
    setSaving(true)
    try {
      store.setWebhookUrl(webhook)
      toast.success('Settings saved')
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
        {/* Tavus status — READ-ONLY.
            This was a box for a Tavus API key, with a "test connection" button and a
            save that applied it "everywhere at once". It was one of three ways to
            write a vendor credential from a browser (the others being the Gemini card
            and a `tavusKey` smuggled through the avatar-apply route), each letting one
            recruiter change what runs every other recruiter's candidate interviews.
            All three are gone server-side; this reports what the deployment has. */}
        <TavusStatusCard />

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
            <Toggle checked={whiteLabelMode} onChange={setWhiteLabelMode} label="White-label mode" description="Remove Mimic branding from candidate-facing screens" />
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

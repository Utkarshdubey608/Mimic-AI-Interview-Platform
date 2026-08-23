import { useEffect, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import toast from 'react-hot-toast'
import { pageVariants } from '@/design/motion'
import { Button, Card, Toggle, PageHeader, Input, cn } from '@/components/ui'
import { useAppStore } from '@/store/useAppStore'
import { settingsApi } from '@/lib/api'
import type { AvatarSettingsStatus } from '@shared/types'
import { httpBase } from '@/lib/apiOrigin'
import { GeminiKeyCard } from '@/features/recruiter/GeminiKeyCard'
import { SchemePicker } from '@/features/theme/SchemePicker'

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
    <Card className="divide-y divide-rule overflow-hidden">
      <PanelHead title="Tavus — Avatar">
        Configured on the server. Drives the video-avatar interview track.
      </PanelHead>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <span
          className={
            configured
              ? 'badge badge-success'
              : 'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-sunk px-2.5 py-1 text-xs font-semibold text-ink-muted'
          }
        >
          {configured ? <span className="live-dot" /> : null}
          {configured ? 'Configured' : 'Not configured'}
        </span>
        <p className="text-xs text-ink-muted">
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
 * Head and note are ONE child of the card on purpose. The card divides its
 * children with `divide-y`, and `.record-head` already draws its own hairline
 * below, so returning a fragment stacked two 1px rules into a 2px one under
 * every head on the page.
 */
function PanelHead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="record-head px-5 py-2.5">
        <h2 className="font-display text-[14px] font-bold text-ink">{title}</h2>
      </div>
      <p className="px-5 py-3 text-xs leading-relaxed text-ink-muted measure">
        {children}
      </p>
    </div>
  )
}

/* ── What used to be here ──────────────────────────────────────────────────
   A `ConnChip` and a `testConnection` that called the Tavus API directly, plus
   the two pieces of state behind the key field. All four were already dead on
   arrival: the rebrand removed the key input and the Test connection button —
   credentials come from the deployment environment now, and no route accepts one
   from a browser — but left the scaffolding standing, which is eight unused
   symbols and a failing lint gate. Removed rather than silenced, because none of
   it can be reached and there is nothing left for it to talk to. The argument for
   the removal itself is in GeminiKeyCard. */

export default function SettingsPage() {
  const reduce = useReducedMotion() ?? false
  const store = useAppStore()
  const [webhook, setWebhook] = useState('')
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
    <motion.div
      variants={pageVariants(reduce)}
      initial="initial"
      animate="animate"
      className="max-w-2xl mx-auto px-6 py-8"
    >
      <PageHeader
        title="Settings"
        description="Manage API credentials, webhook endpoints, and platform behaviour."
        action={<Button onClick={() => void save()} loading={saving}>Save settings</Button>}
      />

      <div className="space-y-6">
        {/* APPEARANCE, first. Everything below it is a credential or a provider —
            things a recruiter reads once and rarely touches. This is the one card
            on the page anybody actually comes here to change, so it is the one at
            the top. */}
        <Card className="divide-y divide-rule overflow-hidden">
          <PanelHead title="Appearance">
            Applies to this browser only, for every screen you see — the entry, the candidate
            lobby and the workspace. Nothing here is sent to the server, and it changes
            nothing for anybody else on the team.
          </PanelHead>
          <div className="px-5 py-5">
            <SchemePicker />
          </div>
        </Card>

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
        <Card className="divide-y divide-rule overflow-hidden">
          <PanelHead title="Analysis providers — server-side">
            These keys stay on the server (set in its environment) and are proxied via{' '}
            <span className="font-mono text-ink-body">/api/avatar/*</span> — never exposed to the browser.
          </PanelHead>
          <ul className="divide-y divide-rule">
            {SERVER_KEYS.map(f => {
              const configured = !!status?.[f.key as keyof StatusMap]
              return (
                <li key={f.key} className="flex items-start justify-between gap-4 px-6 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{f.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{f.hint}</p>
                    {!configured && (
                      <p className="mt-1.5 text-[11px] text-ink-faint">
                        Set <span className="font-mono text-ink-muted">{f.env}</span> in the server environment.
                      </p>
                    )}
                  </div>
                  <span className={cn('badge flex-shrink-0', configured ? 'badge-success' : 'badge-neutral', status === null && 'animate-pulse')}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', configured ? 'bg-ok' : 'bg-ink-disabled')} aria-hidden />
                    {status === null ? 'Checking…' : configured ? 'Configured' : 'Not set'}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>

        {/* Webhook */}
        <Card className="divide-y divide-rule overflow-hidden">
          <PanelHead title="Webhook delivery">
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
        <Card className="divide-y divide-rule overflow-hidden">
          <PanelHead title="Platform behaviour">
            Multi-tenant and compliance configuration.
          </PanelHead>
          <div className="divide-y divide-rule px-6 py-2">
            <Toggle checked={whiteLabelMode} onChange={setWhiteLabelMode} label="White-label mode" description="Remove Mimic branding from candidate-facing screens" />
            <Toggle checked={gdprAuto} onChange={setGdprAuto} label="GDPR auto-purge" description="Automatically delete video and biometric data after 30 days" />
            <Toggle checked={multiLang} onChange={setMultiLang} label="Multi-language avatar" description="Enable multilingual question delivery via Tavus" />
          </div>
        </Card>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-rule pt-6">
        <Button onClick={save} loading={saving}>Save settings</Button>
        <Button variant="secondary" onClick={() => { if (confirm('Reset Tavus key and local preferences?')) { localStorage.removeItem('talbotiq-store'); location.reload() } }}>
          Reset to defaults
        </Button>
        <p className="ml-auto hidden text-xs text-ink-faint sm:block">Saving syncs the Tavus key to the server.</p>
      </div>
    </motion.div>
  )
}

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui'
import { settingsApi } from '@/lib/api'
import type { AppSettingsStatus } from '@shared/types'

/**
 * Whether this deployment has Gemini configured, and on which model. Read-only.
 *
 * **This used to be a box you typed an API key into**, with a model picker beside it.
 * Both are gone, and neither was a small thing:
 *
 * * The key was stored in `web_settings` and used to score every candidate interview
 *   on the deployment — so any one authenticated recruiter could change the credential
 *   everyone else's hiring ran on, from a browser. That is precisely what "credentials
 *   never reach the browser" exists to prevent.
 * * The model was the same shape of problem in miniature: a global value, changed from
 *   a browser, deciding how other people's candidates were scored.
 *
 * The mobile client has never had either, and its Settings screen says why —
 * `settings/sections/service_status_section.dart`: a recruiter needs the answer to
 * "is it me, or is this not set up?", and nothing beyond that. It also makes the point
 * this component now has to honour: **never suggest adding a key**, because there is
 * nowhere to add one and saying otherwise sends someone looking for a screen that does
 * not exist.
 *
 * Configuration lives in the deployment environment. See `backend/.env.example`.
 */
export function GeminiKeyCard() {
  const [status, setStatus] = useState<AppSettingsStatus | null>(null)

  useEffect(() => {
    settingsApi.status().then(setStatus).catch(() => {})
  }, [])

  const configured = !!status?.geminiKeySet

  return (
    <Card className="divide-y divide-border">
      <div className="record-head px-5 py-2.5">
        <h2 className="font-display text-[14px] font-bold text-ink">
          Gemini — scoring &amp; question generation
        </h2>
      </div>
      <p className="border-b border-border px-5 py-3 text-xs leading-relaxed text-ink-muted measure">
        Configured on the server. Interview scoring, question generation and résumé
        screening all run through it.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
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
          {/* The model is shown because it is the one thing a recruiter might need to
              quote when a score looks off. It is not a control. */}
          {configured && status?.model ? (
            <span className="ml-2 text-xs text-ink-muted">
              model <span className="font-mono">{status.model}</span>
            </span>
          ) : null}
        </div>

        <p className="text-xs text-ink-muted">
          {configured
            ? 'Set in the deployment environment.'
            : /* Says who can fix it, and does NOT imply the recruiter can. */
              'Contact your administrator — this is set in the deployment environment.'}
        </p>
      </div>
    </Card>
  )
}

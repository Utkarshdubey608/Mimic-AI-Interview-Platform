import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {  } from 'lucide-react'
import { Card, Button, cn } from '@/components/ui'
import { settingsApi } from '@/lib/api'
import type { AppSettingsStatus, GeminiModel } from '@shared/types'

/**
 * Server-backed Gemini key management. Unlike the other (browser-local) keys
 * on this page, the Gemini key is stored on the server and never returned to
 * the client — we only ever show a masked hint.
 */
export function GeminiKeyCard() {
  const [status, setStatus] = useState<AppSettingsStatus | null>(null)
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [model, setModel] = useState<GeminiModel>('gemini-2.5-flash')
  const [busy, setBusy] = useState(false)

  const refresh = () => settingsApi.status().then(setStatus).catch(() => {})
  useEffect(() => { refresh() }, [])
  useEffect(() => { if (status?.model) setModel(status.model as GeminiModel) }, [status?.model])

  const save = async () => {
    if (!value.trim()) { toast.error('Enter a Gemini API key'); return }
    setBusy(true)
    try {
      setStatus(await settingsApi.saveGeminiKey(value.trim(), model))
      setValue('')
      toast.success('Gemini key saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    try {
      setStatus(await settingsApi.clearGeminiKey())
      toast.success('Saved Gemini key removed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="divide-y divide-border">
      {/* The ruled cover head — the same device as the sibling Settings panels.
          This panel kept its icon plate when the others lost theirs, which read
          as one section arbitrarily outranking its neighbours. */}
      <div className="record-head px-5 py-2.5">
        <h2 className="font-display text-[14px] font-bold text-ink">Gemini — AI interview</h2>
      </div>
      <p className="px-5 py-3 text-xs leading-relaxed text-ink-muted measure">
        Used server-side for résumé question generation &amp; scoring. Stored on the server, never sent back to the browser.
      </p>

      <div className="space-y-5 px-6 py-5">
        {/* Status line — masked key stays monospaced so it can be compared at a glance. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <span className="field-label mb-0">Status</span>
          {status?.geminiKeySet ? (
            <>
              <span className="badge badge-success"><span className="live-dot" />Active</span>
              <span className="font-mono text-xs text-ink-body">{status.geminiKeyMasked}</span>
              <span className="text-xs text-ink-faint">·</span>
              <span className="text-xs text-ink-muted">{status.source} · <span className="font-mono">{status.model}</span></span>
            </>
          ) : (
            <span className="badge badge-warning">Not configured — using heuristic fallback</span>
          )}
        </div>

        <div>
          <label htmlFor="gemini-api-key" className="field-label">{status?.geminiKeySet ? 'Replace key' : 'API key'}</label>
          <div className="relative">
            <input
              id="gemini-api-key"
              type={show ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="AIza…"
              className="input-base pr-16 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Hide the Gemini API key' : 'Show the Gemini API key'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2.5 py-1 text-[11px] font-semibold text-ink-muted transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">Get one at aistudio.google.com → API keys. Keys start with “AIza”.</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-hover p-1" role="group" aria-label="Gemini model">
            {(['gemini-2.5-flash', 'gemini-2.5-pro'] as GeminiModel[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModel(m)}
                aria-pressed={model === m}
                className={cn(
                  'rounded-md px-3 py-1 text-xs font-semibold capitalize transition-colors duration-150',
                  model === m ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink',
                )}
              >
                {m.replace('gemini-2.5-', '')}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {status?.source === 'saved' && (
              <Button variant="secondary" size="sm" onClick={clear} disabled={busy}>Remove key</Button>
            )}
            <Button size="sm" loading={busy} onClick={save}>Save key</Button>
          </div>
        </div>
      </div>
    </Card>
  )
}

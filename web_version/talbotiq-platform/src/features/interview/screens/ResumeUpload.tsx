import { useState } from 'react'
import { UploadCloud, FileText, AlertTriangle, ArrowRight } from 'lucide-react'
import { cn, Button, Input } from '@/components/ui'
import { PreflightCard, type PreflightStep } from '../stage/Preflight'
import type { BrandingConfig } from '@shared/types'

interface Props {
  branding: BrandingConfig
  steps: PreflightStep[]
  busy?: boolean
  onUpload: (file: File, fullName: string) => Promise<void> | void
}

function fmtSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Name, then résumé.
 *
 * Both are asked here because both are used by the interviewer itself: the name
 * is how the avatar addresses the candidate, and the résumé is the background
 * the questions are drawn from. That is stated plainly on the screen — someone
 * handing over a CV to an automated system is entitled to know what it will be
 * used for before they upload it, not after.
 */
export function ResumeUpload({ steps, busy, onUpload }: Props) {
  const [fullName, setFullName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const nameOk = fullName.trim().length >= 2
  const ready = nameOk && !!file

  const submit = async () => {
    if (!ready) return
    setError(null)
    try {
      await onUpload(file!, fullName.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    }
  }

  return (
    <PreflightCard
      step="resume"
      steps={steps}
      title="Tell us about you"
      description={`Your interviewer will address you by name, and your questions will be drawn from your own experience rather than from a generic list.`}
      footer={
        <>
          <Button size="lg" block onClick={submit} disabled={!ready} loading={busy} iconRight={!busy ? <ArrowRight size={18} /> : undefined}>
            {busy ? 'Preparing your questions…' : 'Continue'}
          </Button>
          {/* One line that names the ONE thing still missing. A disabled button
              with no explanation is the most common dead end in a form. */}
          {!busy && !ready && (
            <p className="mt-2.5 text-center text-xs text-ink-muted">
              {!nameOk ? 'Enter your full name to continue.' : 'Choose your résumé file to continue.'}
            </p>
          )}
        </>
      }
    >
      <div className="space-y-6">
        <Input
          label="Your full name"
          value={fullName}
          onChange={(e) => { setFullName(e.target.value); setError(null) }}
          placeholder="e.g. Arjun Kumar"
          autoFocus
          autoComplete="name"
          hint="The interviewer uses this to address you during the interview."
        />

        <div>
          <p className="field-label">Your résumé</p>
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 text-center',
              'transition-colors duration-fast',
              file ? 'border-rule bg-surface-sunk' : 'border-rule-strong bg-surface-sunk hover:border-signal',
            )}
          >
            <input
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,text/plain"
              className="sr-only"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null) }}
            />
            {file ? (
              <span className="flex w-full items-center gap-3 rounded-md border border-rule bg-surface px-4 py-3 text-left">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-rule bg-surface-sunk text-ink-body" aria-hidden="true">
                  <FileText size={17} strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{file.name}</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {fmtSize(file.size)} · Click to choose a different file
                  </span>
                </span>
              </span>
            ) : (
              <span className="flex flex-col items-center gap-2 py-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-md border border-rule bg-surface text-ink-muted" aria-hidden="true">
                  <UploadCloud size={21} strokeWidth={1.75} />
                </span>
                <span className="text-sm font-semibold text-ink-body">Click to choose a file</span>
                <span className="text-xs text-ink-muted">PDF · DOCX · TXT · max 8 MB</span>
              </span>
            )}
          </label>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            Used to tailor your questions and shared only with the hiring team.
          </p>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-md border border-risk-rule bg-risk-bg p-3.5 text-sm text-risk">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>{error}, check the file and try again.</span>
          </div>
        )}

        {busy && (
          <div className="rounded-lg border border-rule bg-surface-sunk p-4" role="status">
            {/* An indeterminate bar, honestly indeterminate: it does not pretend
                to know a percentage of a job whose length we cannot predict. */}
            <div className="h-1 w-full overflow-hidden rounded-sm bg-rule" aria-hidden="true">
              <div className="h-full w-1/3 animate-sheen rounded-sm bg-ink" />
            </div>
            <p className="mt-3 text-center text-xs leading-relaxed text-ink-muted">
              Reading your résumé and tailoring your questions, this usually takes a few seconds.
            </p>
          </div>
        )}
      </div>
    </PreflightCard>
  )
}

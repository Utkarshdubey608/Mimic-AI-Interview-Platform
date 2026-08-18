import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { UploadCloud, FileText, Loader2, AlertTriangle } from 'lucide-react'
import type { BrandingConfig } from '@shared/types'

interface Props {
  branding: BrandingConfig
  busy?: boolean
  onUpload: (file: File, fullName: string) => Promise<void> | void
}

function fmtSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Pre-interview step: FIRST the candidate tells us their full name (the AI
 * interviewer addresses them by it throughout the interview), THEN they upload
 * the résumé their questions are tailored to.
 */
export function ResumeUpload({ branding, busy, onUpload }: Props) {
  const reduce = useReducedMotion()
  const [fullName, setFullName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const nameOk = fullName.trim().length >= 2

  const submit = async () => {
    if (!file || !nameOk) return
    setError(null)
    try {
      await onUpload(file, fullName.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    }
  }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-border bg-white p-8 shadow-lg sm:p-10"
    >
      {/* Eyebrow deleted. An uppercase label above a heading is the one
          pattern no brief earns back, and on a candidate surface it was pure
          overhead: the heading below already carries the step. */}
      <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-neutral-900">Tell us about you</h1>
      <p className="mt-2.5 text-sm leading-relaxed text-neutral-500">
        Your interviewer will address you by name, and your questions will be tailored to your experience.
      </p>

      {/* 1 — full name (asked BEFORE the résumé) */}
      <div className="mt-7">
        <label htmlFor="candidate-full-name" className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <span
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold tabular-nums"
            style={{ background: branding.accentColor + '14', color: branding.accentColor }}
          >
            1
          </span>
          Your full name
        </label>
        <input
          id="candidate-full-name"
          type="text"
          value={fullName}
          onChange={(e) => { setFullName(e.target.value); setError(null) }}
          placeholder="e.g. Arjun Kumar"
          autoFocus
          autoComplete="name"
          className="input-base"
        />
        <p className="mt-1.5 text-xs text-neutral-400">The AI interviewer uses this to address you during the interview.</p>
      </div>

      {/* 2 — résumé */}
      <div className="mt-6">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-800">
          <span
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold tabular-nums"
            style={{ background: branding.accentColor + '14', color: branding.accentColor }}
          >
            2
          </span>
          Your résumé
        </p>
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-6 text-center transition-colors duration-150 hover:border-primary-300 hover:bg-primary-50/40"
        >
          <input
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,text/plain"
            className="hidden"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null) }}
          />
          {file ? (
            <span className="flex w-full items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-left shadow-xs">
              <span
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                style={{ background: branding.accentColor + '14', color: branding.accentColor }}
              >
                <FileText size={17} strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-neutral-800">{file.name}</span>
                <span className="mt-0.5 block text-xs text-neutral-400">{fmtSize(file.size)} · Click to choose a different file</span>
              </span>
            </span>
          ) : (
            <span className="flex flex-col items-center gap-2 py-2">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                <UploadCloud size={22} strokeWidth={1.75} />
              </span>
              <span className="text-sm font-semibold text-neutral-700">Click to choose a file</span>
              <span className="text-xs text-neutral-400">PDF · DOCX · TXT (max 8 MB)</span>
            </span>
          )}
        </label>
      </div>

      {error && (
        <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-danger-border bg-danger-bg p-3.5 text-sm text-danger">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}, check the file and try again.</span>
        </div>
      )}

      {busy && (
        <div className="mt-6 rounded-2xl border border-border bg-neutral-50 p-4" role="status">
          <div className="h-1 w-full overflow-hidden rounded-md bg-neutral-200" aria-hidden="true">
            <div
              className="h-full w-full animate-pulse rounded-full"
              style={{ background: `linear-gradient(90deg, ${branding.accentColor}33 0%, ${branding.accentColor} 50%, ${branding.accentColor}33 100%)` }}
            />
          </div>
          <p className="mt-3 text-center text-xs leading-relaxed text-neutral-500">
            Reading your résumé and tailoring your questions, this usually takes a few seconds.
          </p>
        </div>
      )}

      <button
        onClick={submit}
        disabled={!file || !nameOk || busy}
        className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md text-base font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-px hover:shadow-md active:translate-y-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: branding.accentColor }}
      >
        {busy ? <><Loader2 size={18} className="animate-spin" /> Preparing your questions…</> : 'Continue'}
      </button>
      {!nameOk && file && (
        <p className="mt-2.5 text-center text-xs text-neutral-400">Enter your full name above to continue.</p>
      )}
      {nameOk && !file && !busy && (
        <p className="mt-2.5 text-center text-xs text-neutral-400">Choose your résumé file above to continue.</p>
      )}
    </motion.div>
  )
}

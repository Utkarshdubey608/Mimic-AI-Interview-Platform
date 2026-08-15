import type { ReactNode } from 'react'
import type { BrandingConfig } from '@shared/types'

interface Props {
  branding: BrandingConfig
  /** When provided, renders a thin accent progress bar + question counter. */
  progress?: { current: number; total: number }
  live?: boolean
  children: ReactNode
}

/** Chrome-minimal candidate layout: brand bar + centered stage. */
export function InterviewShell({ branding, progress, live, children }: Props) {
  const pct = progress && progress.total > 0
    ? Math.max(0, Math.min(100, (progress.current / progress.total) * 100))
    : null

  return (
    <div className="min-h-screen bg-background font-sans flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt="" className="h-7 w-7 flex-shrink-0 rounded-lg border border-border bg-white object-contain" />
            ) : (
              <span
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[11px] font-extrabold uppercase text-white shadow-xs"
                style={{ background: branding.accentColor }}
              >
                {branding.companyName.charAt(0)}
              </span>
            )}
            <span className="truncate font-display text-sm font-bold tracking-[-0.01em] text-neutral-800">
              {branding.companyName}
            </span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2.5">
            {progress && progress.total > 0 && (
              <span className="rounded-md border border-border bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-neutral-600">
                Question <span className="text-neutral-900">{progress.current}</span>{' '}
                <span className="text-neutral-400">of {progress.total}</span>
              </span>
            )}
            {live && (
              <span className="flex items-center gap-1.5 rounded-md border border-mint-border bg-mint-bg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-mint-ink">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mint-ink" />
                Live
              </span>
            )}
          </div>
        </div>
        {pct !== null && (
          <div
            className="h-[3px] w-full bg-neutral-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress!.total}
            aria-valuenow={progress!.current}
            aria-label={`Question ${progress!.current} of ${progress!.total}`}
          >
            <div
              className="h-full rounded-r-full transition-all duration-300 ease-out"
              style={{ width: `${pct}%`, background: branding.accentColor }}
            />
          </div>
        )}
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:py-12">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  )
}

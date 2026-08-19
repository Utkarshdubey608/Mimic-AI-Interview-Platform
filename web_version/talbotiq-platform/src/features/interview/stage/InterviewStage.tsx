import React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { LifeBuoy, ShieldCheck, X } from 'lucide-react'
import { cn, Button } from '@/components/ui'
import { AmbientField } from '@/components/shell/AmbientField'
import { MimicLockup } from '@/components/brand/MimicMark'
import type { BrandingConfig, TrackType } from '@shared/types'

/**
 * MIMIC — the Interview Stage.
 *
 * ONE shell for all seven interview modes.
 *
 * Before this, `InterviewShell` was used by exactly two of the seven: timed Q&A
 * and recorded video. Chatbot and voice bypassed it as light full screens;
 * avatar and two-way bypassed it as dark full screens. A candidate moving
 * between formats was looking at different applications, and the four screens
 * that bypassed the shell also lost its progress rail, its brand identity, and
 * its `role="progressbar"` — so the accessibility of the interview depended on
 * which format a recruiter happened to pick.
 *
 * ── The four things a candidate must always be able to see ────────────────
 * These are the shell's entire reason to exist, and no mode may omit them:
 *
 *   1. WHERE THEY ARE      the company, the format, the phase
 *   2. WHAT HAPPENS NEXT   progress through the interview, and what follows it
 *   3. HOW LONG IS LEFT    a timer that is calm at rest and unmissable near zero
 *   4. HOW TO GET HELP     support and the integrity terms, always one click away
 *
 * ── Why the ground varies, and why that is not an inconsistency ───────────
 * The ground follows WHAT IS AT THE CENTRE OF THE STAGE:
 *
 *   room (dark)     when the subject is a face or a voice — recorded video, the
 *                   avatar, a two-way call, a live voice interview. The video
 *                   feed or the voice orb should be the brightest thing on
 *                   screen, and a white page around a video is a light box in a
 *                   dark room.
 *
 *   record (light)  when the subject is TEXT the candidate reads and writes —
 *                   timed Q&A, the chatbot. Someone composing prose for thirty
 *                   minutes should not do it as light-on-dark; it is measurably
 *                   worse for sustained reading.
 *
 * A session's track is fixed, so no candidate ever sees the ground change
 * underneath them. Both grounds are the same system — same type, same spacing,
 * same motion, same controls — so the two read as one product, which is exactly
 * what the split is for.
 */

export type StagePhase = 'prep' | 'answer' | 'connecting' | 'live' | 'submitting' | 'complete'

/** Which ground a track's stage is painted on. See the note above. */
export function groundForTrack(track: TrackType): 'record' | 'room' {
  return track === 'chat' || track === 'chatbot' ? 'record' : 'room'
}

interface StageProps {
  branding: BrandingConfig
  track: TrackType
  /** Question N of M. Omitted for conversational formats that have no fixed count. */
  progress?: { current: number; total: number }
  /** The phase strip. Omitted before the interview starts. */
  phase?: React.ReactNode
  /** The timer. Right-aligned in the header, mono and tabular. */
  timer?: React.ReactNode
  /** Live-call controls, pinned to the foot and never overlapped. */
  transport?: React.ReactNode
  /** Connection quality, shown in the header for realtime formats. */
  connection?: React.ReactNode
  /**
   * `focus` removes the outer padding and lets the child own the full stage —
   * for a video room. `page` centres a readable column — for reading and writing.
   */
  layout?: 'page' | 'focus'
  /** Overrides the automatic ground. Used by the pre-flight, which is always light. */
  ground?: 'record' | 'room'
  children: React.ReactNode
}

export function InterviewStage({
  branding, track, progress, phase, timer, transport, connection,
  layout = 'page', ground, children,
}: StageProps) {
  const g = ground ?? groundForTrack(track)
  const [helpOpen, setHelpOpen] = React.useState(false)

  const pct = progress && progress.total > 0
    ? Math.max(0, Math.min(100, (progress.current / progress.total) * 100))
    : null

  return (
    <div
      data-ground={g}
      className="relative flex min-h-screen flex-col bg-ground text-ink"
    >
      {/* Atmosphere. In a room it is a single dim wash; on the record ground it
          is a static whisper at the top edge. Never more than that on a stage 
          a candidate is thinking, and peripheral movement costs them. */}
      <AmbientField variant={g === 'room' ? 'room' : 'record'} />

      {/* A skip link, because the first thing a keyboard user hits on every
          question is otherwise the header. */}
      <a
        href="#interview-main"
        className="sr-only-focusable absolute left-4 top-4 z-hud rounded-md bg-surface px-3 py-2 text-sm font-semibold text-ink shadow-lg"
      >
        Skip to the interview
      </a>

      {/* ═══ Header ═══════════════════════════════════════════════════════ */}
      <header className="relative z-sticky flex-shrink-0 border-b border-rule bg-surface/80 backdrop-blur-md">
        <div className={cn('mx-auto flex h-14 items-center justify-between gap-4 px-4 sm:px-5', layout === 'page' ? 'max-w-4xl' : 'w-full')}>
          {/* Identity, the PRODUCT, not the employer.
              This showed the tenant's initial on their accent colour beside
              their company name. Two problems: the initial on an arbitrary hex
              was the least legible element in the header, and a candidate has no
              use for a logo in a corner, they already know who invited them.
              What they benefit from is knowing which system they are in, so
              that a support request has a name in it.

              The employer is named where it carries weight instead: the welcome
              copy, the completion screen, and the help sheet's statement of who
              can see their answers. */}
          <MimicLockup size="sm" />

          <div className="flex flex-shrink-0 items-center gap-2">
            {connection}
            {progress && progress.total > 0 && (
              <span className="hidden rounded-md border border-rule bg-surface-sunk px-2.5 py-1 text-xs font-semibold nums text-ink-body sm:inline-flex">
                <span className="text-ink-muted">Question&nbsp;</span>
                {progress.current}
                <span className="text-ink-muted">&nbsp;of {progress.total}</span>
              </span>
            )}
            {phase}
            {timer}
            <Button
              variant="ghost" size="sm" iconOnly
              aria-label="Help and interview terms"
              onClick={() => setHelpOpen(true)}
              icon={<LifeBuoy size={16} strokeWidth={1.75} />}
            />
          </div>
        </div>

        {/* Progress rail. A real progressbar with a real value, this is how a
            screen-reader user knows how far through the interview they are. */}
        {pct !== null && (
          <div
            className="h-[3px] w-full bg-surface-sunk"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress!.total}
            aria-valuenow={progress!.current}
            aria-label={`Question ${progress!.current} of ${progress!.total}`}
          >
            {/* Ink, not blue. The rail is the most persistent coloured element
                on the interview stage, it sits above every question for the
                whole session, so it is the one place a stray accent does the
                most damage to an ink-and-paper surface. */}
            <div
              className="h-full bg-ink transition-[width] duration-slow ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </header>

      {/* ═══ Stage ════════════════════════════════════════════════════════ */}
      <main
        id="interview-main"
        tabIndex={-1}
        className={cn(
          'relative z-raised flex flex-1 outline-none',
          layout === 'page'
            ? 'items-start justify-center px-4 py-8 sm:px-5 sm:py-10'
            : 'min-h-0 flex-col',
        )}
      >
        {layout === 'page' ? <div className="w-full max-w-2xl">{children}</div> : children}
      </main>

      {/* ═══ Transport ════════════════════════════════════════════════════
          A dedicated region rather than a floating overlay. A `fixed` control
          tray over a scrolling stage always ends up covering something, most
          often the last line of the question. */}
      {transport && (
        <footer className="relative z-hud flex-shrink-0 border-t border-rule bg-surface/90 backdrop-blur-md">
          {transport}
        </footer>
      )}

      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} branding={branding} track={track} />
    </div>
  )
}

/* The tenant "company mark" that used to live here — their initial rendered on
   `branding.accentColor` — is gone with the header that used it. The tenant
   accent no longer paints anything in the candidate experience: it is an
   arbitrary hex with no contrast guarantee, and every place that leaned on it
   now uses the system's own ink. */

/* ═══ Phase indicator ══════════════════════════════════════════════════════ */

export function PhaseMark({ phase }: { phase: StagePhase }) {
  const map: Record<StagePhase, { label: string; cls: string; dot?: boolean }> = {
    prep:       { label: 'Preparation', cls: 'border-rule bg-surface-sunk text-ink-muted' },
    answer:     { label: 'Answering',   cls: 'border-live/40 bg-live-bg text-live', dot: true },
    connecting: { label: 'Connecting',  cls: 'border-warn-rule bg-warn-bg text-warn' },
    live:       { label: 'Live',        cls: 'border-live/40 bg-live-bg text-live', dot: true },
    submitting: { label: 'Submitting',  cls: 'border-rule bg-surface-sunk text-ink-muted' },
    complete:   { label: 'Complete',    cls: 'border-ok-rule bg-ok-bg text-ok' },
  }
  const m = map[phase]
  return (
    // aria-live so a phase change is ANNOUNCED. A candidate who cannot see the
    // screen must not discover that the answer window opened by noticing that
    // the timer sounds different.
    <span
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1',
        'text-2xs font-bold uppercase tracking-[0.08em]',
        m.cls,
      )}
    >
      {m.dot && <span className="live-dot" aria-hidden="true" />}
      {m.label}
    </span>
  )
}

/* ═══ Timer ════════════════════════════════════════════════════════════════
   Calm at rest, unmissable near zero — and never colour alone.

   At the warning threshold it does three things at once: turns to the risk
   tone, adds the word "left", and announces itself. The word is what carries
   the meaning for a candidate who cannot distinguish the colour, and the
   announcement is what carries it for one who cannot see the screen at all. */

export function StageTimer({
  seconds, warning, label = 'Time remaining',
}: {
  seconds: number
  warning?: boolean
  label?: string
}) {
  const m = Math.floor(Math.max(0, seconds) / 60)
  const s = Math.max(0, seconds) % 60
  const text = `${m}:${String(s).padStart(2, '0')}`

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-sm font-medium nums',
        warning ? 'border-risk-rule bg-risk-bg text-risk' : 'border-rule bg-surface-sunk text-ink-body',
      )}
    >
      <span className="sr-only">{label}: </span>
      {text}
      {warning && <span className="text-2xs font-sans font-bold uppercase tracking-wide">left</span>}
      {/* Announced only at the threshold, and only once per crossing, a timer
          that announces every second is unusable with a screen reader. */}
      {warning && (
        <span role="status" className="sr-only">
          {seconds} seconds remaining. Your answer submits automatically at zero.
        </span>
      )}
    </span>
  )
}

/* ═══ Help ═════════════════════════════════════════════════════════════════
   Support and the integrity terms in one place, reachable from every mode.

   The integrity terms live HERE rather than in a banner across the stage on
   purpose. A candidate is entitled to know exactly what is monitored, and to be
   able to re-read it at any moment — but a permanent "you are being watched"
   strip above the question changes what the interview feels like, and it makes
   the product read as a surveillance tool rather than as an assessment. Stated
   plainly, once, up front, and available on demand is the respectful version. */

function HelpSheet({
  open, onClose, branding, track,
}: {
  open: boolean
  onClose: () => void
  branding: BrandingConfig
  track: TrackType
}) {
  const reduce = useReducedMotion() ?? false
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const raf = requestAnimationFrame(() => ref.current?.focus())
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const monitored: string[] = [
    'Whether this tab loses focus while a question is open',
    ...(track === 'chat' ? ['Text pasted into an answer box'] : []),
    ...(track === 'video' || track === 'video_avatar' || track === 'two_way'
      ? ['Your camera and microphone, for the duration of the interview only']
      : []),
    ...(track === 'voice' ? ['Your microphone, for the duration of the interview only'] : []),
  ]

  return (
    <div className="fixed inset-0 z-modal flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-[var(--scrim)]" onClick={onClose} aria-hidden="true" />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Help and interview terms"
        tabIndex={-1}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-xl border border-rule bg-surface p-6 shadow-xl outline-none sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-display text-lg font-bold text-ink">Help</h2>
          <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose} icon={<X size={16} />} />
        </div>

        <section className="mt-5">
          <h3 className="section-label">If something goes wrong</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-body">
            Your progress is saved as you go. If your connection drops or you close
            this tab by accident, reopen your invite link and you will return to
            where you were, you will not lose submitted answers.
          </p>
        </section>

        <section className="mt-5 border-t border-rule pt-5">
          <h3 className="section-label">What is recorded</h3>
          <ul className="mt-2 space-y-1.5">
            {monitored.map((m) => (
              <li key={m} className="flex items-start gap-2 text-sm leading-relaxed text-ink-body">
                <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-ink-faint" aria-hidden="true" />
                {m}
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
            <ShieldCheck size={14} strokeWidth={1.75} className="mt-px flex-shrink-0" aria-hidden="true" />
            This is visible only to the hiring team. It is not
            shared with other employers, and it is not used to train models.
          </p>
        </section>

        <section className="mt-5 border-t border-rule pt-5">
          <h3 className="section-label">Still stuck</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-body">
            Reply to the email that contained your invite. The hiring team can
            reset your session or send a fresh link.
          </p>
        </section>
      </motion.div>
    </div>
  )
}

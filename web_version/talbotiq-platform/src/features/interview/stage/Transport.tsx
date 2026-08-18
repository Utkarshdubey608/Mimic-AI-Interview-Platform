import React from 'react'
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, PhoneOff, Wifi, WifiOff, Loader2,
} from 'lucide-react'
import { cn, Button, ConfirmDialog } from '@/components/ui'

/**
 * MIMIC — live-call transport and connection state.
 *
 * Shared by every realtime format: voice, avatar, two-way, and the recruiter's
 * host room. Before this each of them drew its own control row, which is why
 * "mute" looked different in three places and why only one of them confirmed
 * before ending a call.
 *
 * ── Three rules ───────────────────────────────────────────────────────────
 *
 * 1. A CONTROL'S STATE IS NEVER ONLY ITS COLOUR. Muted is a different GLYPH
 *    (MicOff, not a red Mic), a different label, and `aria-pressed`. Someone who
 *    cannot distinguish the tint must still be able to tell, at a glance,
 *    whether they are broadcasting.
 *
 * 2. LEAVING IS CONFIRMED, ALWAYS. Ending an interview is irreversible for the
 *    candidate — they cannot rejoin and re-answer. A misclick on a control row
 *    they are using for the first time must not end their assessment.
 *
 * 3. THE TRAY IS A REGION, NOT AN OVERLAY. It lives in the stage's footer slot
 *    rather than floating over the content, because a fixed tray over a
 *    scrolling stage always ends up covering the bottom of the thing being read.
 */

/* ═══ Connection ═══════════════════════════════════════════════════════════ */

export type ConnectionQuality = 'connecting' | 'good' | 'fair' | 'poor' | 'lost'

const QUALITY: Record<ConnectionQuality, { label: string; bars: number; cls: string }> = {
  connecting: { label: 'Connecting',        bars: 0, cls: 'border-rule bg-surface-sunk text-ink-muted' },
  good:       { label: 'Connection good',   bars: 3, cls: 'border-rule bg-surface-sunk text-ink-muted' },
  fair:       { label: 'Connection fair',   bars: 2, cls: 'border-warn-rule bg-warn-bg text-warn' },
  poor:       { label: 'Connection weak',   bars: 1, cls: 'border-warn-rule bg-warn-bg text-warn' },
  lost:       { label: 'Reconnecting',      bars: 0, cls: 'border-risk-rule bg-risk-bg text-risk' },
}

/**
 * Connection quality, stated in words as well as bars.
 *
 * A good connection is deliberately quiet — it uses the neutral tone, not a
 * green one. Marking "everything is fine" with a colour spends the candidate's
 * attention on a non-event and leaves nowhere to escalate to.
 */
export function ConnectionMeter({ quality, compact }: { quality: ConnectionQuality; compact?: boolean }) {
  const q = QUALITY[quality]
  const Icon = quality === 'lost' ? WifiOff : Wifi

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-2xs font-semibold', q.cls)}
      // Only degradations interrupt. A meter that announces every recovery is
      // noise during an interview.
      role={quality === 'poor' || quality === 'lost' ? 'status' : undefined}
    >
      {quality === 'connecting' ? (
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
      ) : (
        <Icon size={13} strokeWidth={2} aria-hidden="true" />
      )}
      <span className={cn(compact && 'sr-only')}>{q.label}</span>
    </span>
  )
}

/* ═══ Transport ════════════════════════════════════════════════════════════ */

interface TransportProps {
  micOn?: boolean
  onToggleMic?: () => void
  cameraOn?: boolean
  onToggleCamera?: () => void
  screenOn?: boolean
  onToggleScreen?: () => void
  onLeave: () => void
  /** What ending does, in the candidate's terms. Shown in the confirmation. */
  leaveTitle?: string
  leaveBody?: React.ReactNode
  leaveLabel?: string
  busy?: boolean
  /** Extra controls — captions, transcript, settings. */
  children?: React.ReactNode
}

export function Transport({
  micOn, onToggleMic, cameraOn, onToggleCamera, screenOn, onToggleScreen,
  onLeave, leaveTitle = 'End this interview?', leaveBody, leaveLabel = 'End interview',
  busy, children,
}: TransportProps) {
  const [confirming, setConfirming] = React.useState(false)

  return (
    <>
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-center gap-2 px-4 py-3 sm:justify-between sm:px-5">
        <div className="flex items-center gap-2">
          {onToggleMic && (
            <TransportButton
              on={micOn ?? false}
              onClick={onToggleMic}
              onIcon={<Mic size={17} strokeWidth={1.75} />}
              offIcon={<MicOff size={17} strokeWidth={1.75} />}
              onLabel="Mute microphone"
              offLabel="Unmute microphone"
              onText="Mic on"
              offText="Muted"
            />
          )}
          {onToggleCamera && (
            <TransportButton
              on={cameraOn ?? false}
              onClick={onToggleCamera}
              onIcon={<Video size={17} strokeWidth={1.75} />}
              offIcon={<VideoOff size={17} strokeWidth={1.75} />}
              onLabel="Turn camera off"
              offLabel="Turn camera on"
              onText="Camera on"
              offText="Camera off"
            />
          )}
          {onToggleScreen && (
            <TransportButton
              on={screenOn ?? false}
              onClick={onToggleScreen}
              onIcon={<MonitorUp size={17} strokeWidth={1.75} />}
              offIcon={<MonitorUp size={17} strokeWidth={1.75} />}
              onLabel="Stop sharing your screen"
              offLabel="Share your screen"
              onText="Sharing"
              offText="Share"
            />
          )}
          {children}
        </div>

        <Button
          variant="danger"
          size="md"
          onClick={() => setConfirming(true)}
          disabled={busy}
          icon={<PhoneOff size={16} strokeWidth={2} />}
        >
          {leaveLabel}
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); onLeave() }}
        title={leaveTitle}
        confirmLabel={leaveLabel}
        busy={busy}
        body={
          leaveBody ?? (
            <>
              Your answers so far are saved and will be submitted. You will not be
              able to rejoin this interview or change what you have already said.
            </>
          )
        }
      />
    </>
  )
}

/**
 * One transport control.
 *
 * The two states differ by glyph, by label, by `aria-pressed` and by the word
 * printed under it on wide screens — four encodings, only one of which is
 * colour. Off is marked with the risk tone because "you are not broadcasting"
 * is the state that costs the candidate something if they do not notice it.
 */
function TransportButton({
  on, onClick, onIcon, offIcon, onLabel, offLabel, onText, offText,
}: {
  on: boolean
  onClick: () => void
  onIcon: React.ReactNode
  offIcon: React.ReactNode
  onLabel: string
  offLabel: string
  onText: string
  offText: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? onLabel : offLabel}
      className={cn(
        'inline-flex h-10 min-w-[2.5rem] items-center gap-2 rounded-md border px-3',
        'text-xs font-semibold transition-colors duration-fast',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        on
          ? 'border-rule bg-surface text-ink-body hover:bg-surface-hover'
          : 'border-risk-rule bg-risk-bg text-risk hover:brightness-105',
      )}
    >
      <span aria-hidden="true">{on ? onIcon : offIcon}</span>
      <span className="hidden sm:inline">{on ? onText : offText}</span>
    </button>
  )
}

/* ═══ Reconnect ════════════════════════════════════════════════════════════
   The state a live interview spends its worst moments in.

   It is a full overlay rather than a banner on purpose: when the connection is
   gone the candidate must NOT keep talking into a dead microphone, and a strip
   at the top of the screen does not stop them. It states what happened, that
   their progress is safe, and what it is doing about it — in that order, because
   "is my interview ruined" is the question they actually have. */

export function ReconnectOverlay({
  quality, attempt, onRetry, onLeave,
}: {
  quality: ConnectionQuality
  attempt?: number
  onRetry?: () => void
  onLeave?: () => void
}) {
  if (quality !== 'lost') return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Connection lost"
      className="absolute inset-0 z-hud flex items-center justify-center bg-[var(--scrim)] px-5 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-xl border border-rule bg-surface p-6 text-center shadow-xl">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-md border border-warn-rule bg-warn-bg text-warn" aria-hidden="true">
          <WifiOff size={20} strokeWidth={1.75} />
        </span>
        <h2 className="mt-4 font-display text-lg font-bold text-ink">Connection lost</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Everything you have answered so far is saved. We are reconnecting you
          {attempt ? <>, attempt <span className="font-mono nums">{attempt}</span></> : null}.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          {onRetry && <Button size="md" block onClick={onRetry}>Reconnect now</Button>}
          {onLeave && (
            <Button variant="ghost" size="sm" block onClick={onLeave}>
              Leave and finish later
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

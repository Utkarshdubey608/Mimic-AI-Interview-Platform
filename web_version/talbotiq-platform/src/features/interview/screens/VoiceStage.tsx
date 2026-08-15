import { useState, type ReactNode } from 'react'
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, PhoneOff, Loader2, AlertTriangle, CheckCircle2, Captions, Radio, ShieldCheck } from 'lucide-react'
import type { BrandingConfig, VoicePhase } from '@shared/types'
import { useVoiceSession } from '../useVoiceSession'

interface Props {
  sessionId: string
  branding: BrandingConfig
  personaName?: string
}

const PHASE_LABEL: Record<VoicePhase, string> = {
  connecting: 'Connecting…',
  greeting: 'Interviewer is speaking',
  speaking: 'Interviewer is speaking',
  listening: 'Listening…',
  thinking: 'One moment…',
  ended: 'Interview complete',
  error: 'Something went wrong',
}

/* ── Shared call-room atoms ───────────────────────────────────────────────── */

/** 56px circular control — the call-room control shape used across every stage. */
const CONTROL =
  'flex h-14 w-14 items-center justify-center rounded-full border transition-all duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-white disabled:opacity-40 disabled:cursor-not-allowed'
const CONTROL_IDLE = 'border-border bg-white text-neutral-700 hover:bg-neutral-50'
const CONTROL_OFF = 'border-danger-border bg-danger-bg text-danger hover:bg-danger-bg/70'

/** Candidate-facing full-page card — one shape for the gate, the sign-off and errors. */
function StageCard({ children, reduce }: { children: ReactNode; reduce: boolean | null }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md rounded-3xl border border-border bg-white p-10 text-center shadow-lg"
      >
        {children}
      </motion.div>
    </div>
  )
}

/** Reactive orb: expands/ripples while the agent speaks, gently pulses while listening. */
function Orb({ phase, accent, reduce }: { phase: VoicePhase; accent: string; reduce: boolean | null }) {
  const speaking = phase === 'speaking' || phase === 'greeting'
  const listening = phase === 'listening'
  // Mint INK, not the pale mint that used to sit here: this stage is light now,
  // and #7FD4AE on white is barely a shape.
  const color = listening ? '#0F766E' : accent
  return (
    <div className="relative flex h-56 w-56 items-center justify-center">
      {!reduce && (speaking || listening) && [0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{ background: `${color}22`, width: 140, height: 140 }}
          animate={{ scale: [1, 1.9], opacity: [0.45, 0] }}
          transition={{ duration: speaking ? 1.8 : 2.4, repeat: Infinity, delay: i * (speaking ? 0.6 : 0.8), ease: 'easeOut' }}
        />
      ))}
      <motion.div
        className="relative flex h-32 w-32 items-center justify-center rounded-full shadow-xl ring-1 ring-inset ring-black/5"
        style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
        animate={reduce ? undefined : speaking ? { scale: [1, 1.06, 1] } : listening ? { scale: [1, 1.03, 1] } : { scale: 1 }}
        transition={{ duration: speaking ? 0.9 : 1.6, repeat: Infinity }}
      >
        <Radio size={38} className="text-white/90" />
      </motion.div>
    </div>
  )
}

export function VoiceStage({ sessionId, branding, personaName = 'AI Interviewer' }: Props) {
  const reduce = useReducedMotion()
  const v = useVoiceSession(sessionId)
  /* Registrar ink, not the lifted blue.
   *
   * This used to fall back to #8AA6F0 with the note "dark stage: 7.72:1, not
   * registrar ink at 1.99:1" — correct while the call ran on a black stage. The
   * stage is white now, which inverts that arithmetic exactly: #8AA6F0 drops to
   * about 2:1 on white, and #1D3FA0 rises to about 9.5:1. Same reasoning, other
   * background. */
  const accent = branding.accentColor || '#1D3FA0'
  const [showCaptions, setShowCaptions] = useState(false)
  const [gestured, setGestured] = useState(false)

  // Start gate — getUserMedia needs a user gesture, and it sets a calm tone.
  if (!gestured) {
    return (
      <StageCard reduce={reduce}>
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: `${accent}14`, color: accent }}>
          <Mic size={30} />
        </div>
        <span className="pill mb-4 inline-flex">Voice interview</span>
        <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-neutral-900">
          Voice interview with {branding.companyName}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-neutral-500">
          You’ll have a spoken conversation with {personaName}. Find a quiet spot — when you’re ready, we’ll ask for your
          microphone and begin.
        </p>
        <button
          onClick={() => { setGestured(true); void v.start() }}
          className="mt-7 inline-flex h-12 items-center gap-2 rounded-md px-8 text-base font-semibold text-white shadow-md transition-all duration-150 hover:-translate-y-px hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
          style={{ background: accent }}
        >
          <Mic size={18} /> Start voice interview
        </button>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-neutral-400">
          <ShieldCheck size={14} className="flex-shrink-0" />
          Your microphone is only active while the interview is running.
        </p>
      </StageCard>
    )
  }

  if (v.phase === 'ended') {
    return (
      <StageCard reduce={reduce}>
        {v.endedGraceful ? (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: `${accent}14`, color: accent }}>
              <CheckCircle2 size={30} />
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-neutral-900">All done, thank you!</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-neutral-500">
              Your voice interview with {branding.companyName} is complete. You can close this window; the hiring team will
              be in touch about next steps.
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-warning-border bg-warning-bg text-warning">
              <AlertTriangle size={28} />
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-neutral-900">Interview interrupted</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-neutral-500">
              The connection dropped before the interview finished, so it ended early. Please reach out to the{' '}
              {branding.companyName} hiring team and we’ll help you complete it.
            </p>
          </>
        )}
      </StageCard>
    )
  }

  if (v.phase === 'error') {
    return (
      <StageCard reduce={reduce}>
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-danger-border bg-danger-bg text-danger">
          <AlertTriangle size={28} />
        </div>
        <h1 className="font-display text-xl font-extrabold tracking-[-0.03em] text-neutral-900">
          {v.permissionDenied ? 'Microphone access is blocked' : 'We lost the connection'}
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-neutral-500">{v.error}</p>
        <div className="mt-6 rounded-2xl border border-border bg-neutral-50 p-4 text-left">
          <p className="section-label">How to continue</p>
          <p className="mt-2 text-sm leading-relaxed text-neutral-700">
            {v.permissionDenied
              ? 'Allow microphone access from the icon in your browser’s address bar, then reload this page to start again.'
              : 'Check your internet connection and reload this page. If it keeps happening, contact the hiring team who sent your invitation.'}
          </p>
        </div>
      </StageCard>
    )
  }

  const connecting = v.phase === 'connecting'
  const pending = connecting || v.reconnecting
  const statusLabel = v.reconnecting ? 'Reconnecting…' : PHASE_LABEL[v.phase]

  return (
    /* A LIGHT call stage.
       This screen was the one dark surface in the candidate's whole journey —
       the gate before it, the sign-off after it and every other track are all
       on paper. It now uses the same tokens they do, so a candidate does not
       drop into a black room for one round and back out again. */
    <div className="flex min-h-screen flex-col bg-background">
      {/* header */}
      <header className="flex h-14 flex-shrink-0 items-center border-b border-border bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4">
          <span className="truncate font-display font-bold tracking-[-0.02em] text-neutral-900">{branding.companyName}</span>
          <span
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${pending ? 'border-warning-border bg-warning-bg text-warning' : 'border-success-border bg-success-bg text-success'}`}
            aria-live="polite"
          >
            <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${pending ? 'bg-warning' : 'bg-success'}`} />
            {v.reconnecting ? 'Reconnecting' : connecting ? 'Connecting' : 'Live'}
          </span>
        </div>
      </header>

      {/* stage */}
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <Orb phase={v.phase} accent={accent} reduce={reduce} />
        <p className="mt-3 font-display text-lg font-bold tracking-[-0.02em] text-neutral-900">{personaName}</p>
        <p
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-white px-4 py-1.5 text-xs font-semibold text-neutral-700"
          aria-live="polite"
        >
          {connecting && <Loader2 size={13} className="animate-spin" />}
          {statusLabel}
        </p>
        {v.reconnecting && (
          <p className="mt-3 max-w-sm text-center text-xs leading-relaxed text-neutral-500">
            Connection hiccup — your interview is saved and will resume in a moment.
          </p>
        )}

        {/* captions */}
        {showCaptions && (
          <div className="mt-8 w-full max-w-xl rounded-2xl border border-border bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <Captions size={13} className="text-neutral-500" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">Live captions</span>
            </div>
            <div className="max-h-48 overflow-y-auto p-4 text-sm">
              {v.captions.length === 0 ? (
                <p className="py-3 text-center text-neutral-500">Captions will appear here as the conversation goes on.</p>
              ) : (
                <div className="space-y-3">
                  <AnimatePresence initial={false}>
                    {v.captions.slice(-12).map((c, i) => (
                      <motion.p
                        key={i}
                        initial={reduce ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className={c.role === 'candidate' ? 'text-right leading-relaxed text-neutral-900' : 'text-left leading-relaxed text-neutral-600'}
                      >
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${c.role === 'candidate' ? 'text-neutral-900' : 'text-primary'}`}>
                          {c.role === 'candidate' ? 'You' : personaName}
                        </span>
                        <br />
                        {c.text}
                      </motion.p>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* controls */}
      <div className="flex-shrink-0 border-t border-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-center gap-5 px-4 py-6">
          <button
            onClick={v.toggleMute}
            disabled={connecting}
            aria-pressed={v.muted}
            className={`${CONTROL} ${v.muted ? CONTROL_OFF : CONTROL_IDLE}`}
            aria-label={v.muted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {v.muted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
          <button
            onClick={v.end}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-danger text-white shadow-lg transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            aria-label="End interview"
          >
            <PhoneOff size={24} />
          </button>
          <button
            onClick={() => setShowCaptions((s) => !s)}
            aria-pressed={showCaptions}
            className={`${CONTROL} ${showCaptions ? 'text-white' : CONTROL_IDLE}`}
            style={showCaptions ? { background: accent, borderColor: accent } : undefined}
            aria-label={showCaptions ? 'Hide captions' : 'Show captions'}
          >
            <Captions size={22} />
          </button>
        </div>
      </div>
    </div>
  )
}

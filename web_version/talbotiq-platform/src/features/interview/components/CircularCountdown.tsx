import { useReducedMotion } from 'framer-motion'
import { cn } from '@/components/ui'
import type { InterviewPhase } from '@shared/types'

interface Props {
  remaining: number // fractional seconds
  total: number
  phase: InterviewPhase
  warningThreshold: number
  accentColor: string
  size?: number // outer diameter in px (default 140); pass a smaller value for a compact ring
}

function fmt(s: number) {
  const sec = Math.max(0, Math.ceil(s))
  const m = Math.floor(sec / 60)
  const r = sec % 60
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : String(r)
}

/** Accessible circular countdown. The ring is decorative; the live region announces time. */
export function CircularCountdown({ remaining, total, phase, warningThreshold, accentColor, size = 140 }: Props) {
  const reduce = useReducedMotion()
  const stroke = Math.max(4, Math.round(size * 0.05))
  // Hairline track under a bolder progress arc — the ring reads as a gauge,
  // not a donut. Geometry (R, C, frac) is unchanged.
  const trackStroke = Math.max(2, stroke - 2)
  const R = size / 2 - stroke - 8
  const C = 2 * Math.PI * R
  const frac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0
  const compact = size < 110

  // Color: prep is calm (accent); answer shifts success → warning → danger as time runs out.
  let color = accentColor
  const warning = phase === 'answer' && remaining <= warningThreshold
  if (phase === 'answer') {
    if (remaining <= warningThreshold) color = '#dc2626'      // danger token
    else if (remaining <= total * 0.4) color = '#B45309'      // warning token
    else color = '#15803D'                                    // success token
  }

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true" focusable="false">
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="#E3E6ED" strokeWidth={trackStroke} />
        <circle
          cx={size / 2} cy={size / 2} r={R} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          style={{ transition: reduce ? 'none' : 'stroke-dashoffset 0.25s linear, stroke 0.4s ease' }}
        />
      </svg>
      <div
        className={cn(
          'absolute inset-0 flex flex-col items-center justify-center',
          warning && !reduce && 'animate-pulse',
        )}
      >
        <span className="font-display font-extrabold tabular-nums leading-none tracking-[-0.02em]" style={{ color, fontSize: Math.round(size * 0.24) }}>
          {fmt(remaining)}
        </span>
        {!compact && (
          <span className="mt-2 text-[10px] font-bold uppercase leading-none tracking-[0.16em] text-ink-muted">
            {phase === 'prep' ? 'Prepare' : 'Answer'}
          </span>
        )}
      </div>
      {/* Screen-reader-friendly, non-spammy announcement */}
      <span className="sr-only" aria-live="polite">
        {phase === 'prep' ? 'Preparation' : 'Answering'}: {fmt(remaining)} remaining
      </span>
    </div>
  )
}

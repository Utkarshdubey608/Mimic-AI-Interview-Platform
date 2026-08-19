import { useReducedMotion } from 'framer-motion'
import { useSpringValue } from '../motion/useSpringValue'
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

/** Linear blend between two hex colours, so no step is ever visible. */
function mix(from: string, to: string, t: number): string {
  const k = Math.max(0, Math.min(1, t))
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]
  const [r1, g1, b1] = parse(from)
  const [r2, g2, b2] = parse(to)
  const c = (a: number, b: number) => Math.round(a + (b - a) * k)
  return `rgb(${c(r1, r2)}, ${c(g1, g2)}, ${c(b1, b2)})`
}

const CALM = '#15803D'
const WARM = '#B45309'
const URGENT = '#B3261E'

/**
 * Time as a physical quantity, not an alarm.
 *
 * Three things changed, and each was a defect:
 *
 *  1. THE RING STUTTERED. The authoritative value arrives from the server every
 *     five seconds, and the CSS transition restarted on each poll, so the arc
 *     twitched. The GEOMETRY is now spring-smoothed from its presentation
 *     value — but only the geometry. The digits still render the real
 *     `remaining`, and `secondsLeft` and auto-submit never touch this
 *     component. Presentation smoothing is fine; authority is not ours
 *     (invariant 2).
 *
 *  2. IT PULSED. `animate-pulse` fired below the warning threshold: a looping
 *     CSS oscillation of the kind §14 warns against, running at exactly the
 *     moment a candidate is most stressed. Escalation is now material — the
 *     ring THICKENS as time runs out. Nothing blinks.
 *
 *  3. IT JUMPED COLOUR. Green → amber → red were hard swaps at thresholds,
 *     abrupt brightness changes (§14 again). The blend is continuous, so a
 *     candidate perceives time draining rather than an alarm tripping.
 */
export function CircularCountdown({ remaining, total, phase, warningThreshold, accentColor, size = 140 }: Props) {
  const reduce = useReducedMotion()
  const compact = size < 110

  const rawFrac = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0
  // response 0.4 is the value Apple ships for a reposition: quick enough to
  // track a real countdown, slow enough to absorb a five-second step.
  const frac = useSpringValue(rawFrac, { damping: 1, response: 0.4, immediate: !!reduce })

  // 0 → calm, 1 → urgent. Continuous, so escalation has no steps in it.
  const urgency = phase === 'answer' && total > 0
    ? Math.max(0, Math.min(1, 1 - remaining / Math.max(warningThreshold * 2, 1)))
    : 0

  // Weight carries the escalation, not brightness: the arc gains up to 60% more
  // stroke, which reads in peripheral vision without flashing at anyone.
  const baseStroke = Math.max(4, Math.round(size * 0.05))
  const stroke = baseStroke * (1 + 0.6 * urgency)
  const trackStroke = Math.max(2, baseStroke - 2)
  const R = size / 2 - baseStroke * 1.6 - 8
  const C = 2 * Math.PI * R

  const color = phase === 'answer'
    ? (urgency < 0.5 ? mix(CALM, WARM, urgency * 2) : mix(WARM, URGENT, (urgency - 0.5) * 2))
    : accentColor

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true" focusable="false">
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="#E7E7EA" strokeWidth={trackStroke} />
        <circle
          cx={size / 2} cy={size / 2} r={R} fill="none" stroke={color}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          // No CSS transition here: the spring owns this value, and a
          // transition layered on top would fight it and restore the stutter.
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="font-semibold tabular-nums leading-none"
          style={{ color, fontSize: Math.round(size * 0.24), letterSpacing: '-0.02em' }}
        >
          {/* The real value, never the smoothed one. */}
          {fmt(remaining)}
        </span>
        {!compact && (
          <span className="mt-2 text-[10px] font-bold uppercase leading-none tracking-[0.16em] text-ink-muted">
            {phase === 'prep' ? 'Prepare' : 'Answer'}
          </span>
        )}
      </div>

      {/* The ring is decorative; this carries the time, without spamming. */}
      <span className="sr-only" aria-live="polite">
        {phase === 'prep' ? 'Preparation' : 'Answering'}: {fmt(remaining)} remaining
      </span>
    </div>
  )
}

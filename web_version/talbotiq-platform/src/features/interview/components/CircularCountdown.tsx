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

/**
 * Linear blend between two TOKENS, so no step is ever visible.
 *
 * Mixed in CSS rather than in JavaScript, and that is the whole point. The ramp
 * used to interpolate three hardcoded hexes — #15803D, #B45309, #B3261E — which
 * are the light surface's colours. A candidate interview runs on
 * `data-ground="room"`, a near-black ground where all three are dark on dark:
 * the countdown numeral was rendering at roughly 3:1 against the very ground it
 * sits on, and in the prepare phase it was invisible outright.
 *
 * `color-mix` defers the blend to the browser, which resolves the tokens in
 * whatever ground the component happens to be mounted in — #15803D on the
 * record page and #5CC98A in the room, from one expression.
 */
function mix(from: string, to: string, t: number): string {
  const k = Math.max(0, Math.min(1, t))
  return `color-mix(in srgb, ${to} ${(k * 100).toFixed(1)}%, ${from})`
}

/** The ramp, as tokens. Each resolves per ground — see the note on `mix`. */
const CALM = 'var(--ok)'
const WARM = 'var(--warn)'
const URGENT = 'var(--risk)'

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

  /**
   * Preparation is not urgent, so it takes the ground's own accent rather than
   * the ramp.
   *
   * NOT `accentColor`, which is the recruiter's brand colour. That defaults to
   * ink (#0E1420) and a candidate interview runs on a near-black ground, so the
   * numeral was drawing itself in the ground colour — invisible, which is
   * exactly what it looked like. `--accent` resolves to the on-dark blue in the
   * room and to the brand blue on the record page. The recruiter's colour still
   * brands the header and the primary actions, where it sits on a surface light
   * enough to carry it.
   */
  const color = phase === 'answer'
    ? (urgency < 0.5 ? mix(CALM, WARM, urgency * 2) : mix(WARM, URGENT, (urgency - 0.5) * 2))
    : 'var(--accent)'

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true" focusable="false">
        {/* The unspent part of the ring. `--rule` rather than a fixed #E7E7EA:
            that grey is a hairline on white and a bright band on the room's
            near-black ground, where it drew more attention than the arc. */}
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="var(--rule)" strokeWidth={trackStroke} />
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

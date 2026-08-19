import { useEffect, useRef, useState } from 'react'

/**
 * A single number, spring-smoothed, animated from its PRESENTATION value.
 *
 * The presentation-value part is the whole point (§3): when the target changes
 * mid-flight the spring keeps its current position and velocity and re-aims,
 * so it can be interrupted and reversed without the jump you get from
 * restarting at the logical value.
 *
 * Written on rAF rather than a CSS transition because the callers are things a
 * CSS transition cannot serve: a countdown whose authoritative value arrives in
 * 5-second steps, and motion whose rate has to follow a live stream (§11).
 *
 * Critically damped by default. Overshoot on a value that merely changed —
 * rather than one a finger threw — reads as wrong (§4).
 */
export interface SpringOptions {
  /** 1.0 = critically damped, no overshoot. Below 1 bounces. */
  damping?: number
  /** Seconds to approach the target. Not a duration: a spring has none. */
  response?: number
  /** Skip the spring entirely — for prefers-reduced-motion. */
  immediate?: boolean
}

export function useSpringValue(target: number, options: SpringOptions = {}): number {
  const { damping = 1, response = 0.4, immediate = false } = options

  const [presented, setPresented] = useState(target)
  const valueRef = useRef(target)
  const velocityRef = useRef(0)
  const targetRef = useRef(target)
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef<number | null>(null)

  targetRef.current = target

  useEffect(() => {
    if (immediate) {
      valueRef.current = target
      velocityRef.current = 0
      setPresented(target)
      return
    }

    // Apple's two designer parameters mapped onto a damped harmonic oscillator:
    // response is the natural period, damping is the ratio.
    const omega = (2 * Math.PI) / Math.max(0.05, response)
    const zeta = Math.max(0, damping)

    const step = (now: number) => {
      const last = lastRef.current ?? now
      // Clamp dt: a backgrounded tab returns with a huge delta and the spring
      // would explode across the screen on the frame the candidate comes back.
      const dt = Math.min(0.064, (now - last) / 1000)
      lastRef.current = now

      const x = valueRef.current - targetRef.current
      const v = velocityRef.current
      const accel = -omega * omega * x - 2 * zeta * omega * v

      velocityRef.current = v + accel * dt
      valueRef.current = valueRef.current + velocityRef.current * dt

      // Settle: below both thresholds it is at rest, and continuing to burn
      // frames on a value nobody can see is the kind of thing that quietly
      // costs a candidate's battery for an hour.
      if (Math.abs(valueRef.current - targetRef.current) < 0.0005 && Math.abs(velocityRef.current) < 0.0005) {
        valueRef.current = targetRef.current
        velocityRef.current = 0
        setPresented(targetRef.current)
        rafRef.current = null
        lastRef.current = null
        return
      }

      setPresented(valueRef.current)
      rafRef.current = requestAnimationFrame(step)
    }

    if (rafRef.current === null) {
      lastRef.current = null
      rafRef.current = requestAnimationFrame(step)
    }

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastRef.current = null
    }
  }, [target, damping, response, immediate])

  return immediate ? target : presented
}

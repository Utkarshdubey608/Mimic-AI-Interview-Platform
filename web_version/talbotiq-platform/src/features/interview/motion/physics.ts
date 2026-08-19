/**
 * The two functions Apple's fluid-interface work actually turns on.
 *
 * Pure, so the numbers are provable. Both come from the *Designing Fluid
 * Interfaces* sample code, and both are easy to get subtly wrong from memory —
 * `project()` in particular is an exponential decay, NOT the physics-textbook
 * v²/(2a) form, and using the textbook version makes every flick land short.
 */

/**
 * Where a flick would come to rest, given its release velocity (px/s).
 *
 * This is what makes a small gesture produce a big, predictable output (§6):
 * you snap to the target nearest the PROJECTED point, not the nearest point to
 * where the finger happened to leave the glass.
 *
 * @param decelerationRate 0.998 is the normal scroll feel; 0.99 is snappier.
 */
export function project(initialVelocity: number, decelerationRate = 0.998): number {
  return ((initialVelocity / 1000) * decelerationRate) / (1 - decelerationRate)
}

/**
 * Progressive resistance past a boundary (§9).
 *
 * A hard stop reads as frozen. Continuous resistance reads as "responsive, but
 * there is nothing more here" — the further past the bound, the less the
 * element follows, asymptotically.
 *
 * @param overshoot how far past the bound the pointer has travelled
 * @param dimension the size of the dragged surface, which sets the scale
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot))
}

/** Clamp with rubber-banding outside [min, max] rather than a hard stop. */
export function withRubberband(value: number, min: number, max: number, dimension: number): number {
  if (value < min) return min - rubberband(min - value, dimension)
  if (value > max) return max + rubberband(value - max, dimension)
  return value
}

/**
 * Pick the snap point nearest a projected endpoint.
 *
 * Deliberately takes the projection, not the release position — see project().
 */
export function nearestSnap(projected: number, snapPoints: number[]): number {
  if (snapPoints.length === 0) return projected
  return snapPoints.reduce((best, p) =>
    Math.abs(p - projected) < Math.abs(best - projected) ? p : best,
  )
}

/**
 * Velocity from a short position history, in px/s.
 *
 * A history rather than the last two events (§2): a single pointermove pair is
 * noisy, and at release the noise is exactly what gets handed to the spring.
 */
export interface Sample {
  value: number
  time: number
}

export function velocityFrom(samples: Sample[], windowMs = 100): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  // Walk back to the oldest sample still inside the window.
  let first = samples[0]
  for (let i = samples.length - 1; i >= 0; i--) {
    if (last.time - samples[i].time > windowMs) break
    first = samples[i]
  }
  const dt = last.time - first.time
  if (dt <= 0) return 0
  return ((last.value - first.value) / dt) * 1000
}

/**
 * Press feedback that happens on pointer-DOWN (§1).
 *
 * Waiting for click means waiting for release, and the gap between the two is
 * exactly where "this app is dead" comes from. This applies the transform
 * directly rather than via a class, so it lands on the same frame as the
 * pointer event and cannot be delayed by a stylesheet recalc.
 *
 * The haptic fires on that same frame (§13 Harmony). It is deliberately NOT on
 * every press — only the caller that passes `haptic` gets one, because feedback
 * everywhere trains people to ignore it (§13 Utility).
 */

const PRESSED = 'scale(0.97)'

export interface PressOptions {
  /** A short tick on commit. Reserve for send/commit, never for navigation. */
  haptic?: boolean
  /** Scale to press to. 0.97 is the house value; smaller reads as a bigger button. */
  scale?: number
}

export function pressHandlers(options: PressOptions = {}) {
  const pressed = options.scale ? `scale(${options.scale})` : PRESSED

  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      const el = e.currentTarget
      el.style.transform = pressed
      // Same frame as the visual, or the illusion breaks (§13).
      if (options.haptic && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(8) } catch { /* unsupported is fine */ }
      }
    },
    // Release AND cancel both restore, so dragging off a button never strands
    // it pressed — and dragging back is still allowed to commit (§10).
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => { e.currentTarget.style.transform = '' },
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => { e.currentTarget.style.transform = '' },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => { e.currentTarget.style.transform = '' },
  }
}

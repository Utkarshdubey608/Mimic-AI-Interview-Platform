/**
 * The shared gate for the WebGL enhancement layers.
 *
 * Both the ink trail and the lattice field are hidden by CSS under
 * `prefers-reduced-motion`, `prefers-reduced-transparency` and
 * `prefers-contrast: more`. Hidden is not the same as absent: a
 * `display:none` canvas still holds a GL context and its render loop still
 * runs, so a visitor who asked for less was paying full price for something
 * they could not see. This is the same list, enforced in JS, so those layers
 * are never constructed at all.
 *
 * `wide` exists because a shader in the first viewport is worth least exactly
 * where it costs most. The home page's LCP is the worst number on the site and
 * it is worst on a phone, so the heavier layers do not arm on narrow screens.
 *
 * Watched live rather than read once: someone toggling an OS setting
 * mid-session should see the page respond, not on the next reload.
 */

/** Below this the heavier layers stay off. A laptop, not a phone. */
export const WIDE_MIN = 1024

export type GateFlags = {
  /** Every accessibility preference that hides these layers is unset. */
  allowed: boolean
  /** …and the viewport is wide enough to be worth the GPU. */
  wide: boolean
  /** A real pointer, so a cursor-driven layer has something to follow. */
  finePointer: boolean
  /**
   * ANY pointing device, coarse included — a finger counts.
   *
   * `finePointer` was the only pointer flag, and every trail was gated on it,
   * which meant the ink simply did not exist on a phone. That is defensible for a
   * layer that follows a cursor around an idle page and indefensible for one that
   * follows a finger: a touch drag is a pointer path, it just has a beginning and
   * an end. The trails read this; anything that genuinely needs a hover state
   * still reads `finePointer`.
   */
  anyPointer: boolean
}

const QUERIES = [
  '(prefers-reduced-motion: reduce)',
  '(prefers-reduced-transparency: reduce)',
  '(prefers-contrast: more)',
] as const

export function readGate(): GateFlags {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { allowed: false, wide: false, finePointer: false, anyPointer: false }
  }
  const blocked = QUERIES.some((q) => window.matchMedia(q).matches)
  return {
    allowed: !blocked,
    wide: window.innerWidth >= WIDE_MIN,
    finePointer: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    anyPointer: window.matchMedia('(any-pointer: fine), (any-pointer: coarse)').matches,
  }
}

/**
 * Calls `onChange` whenever any gate input changes. Returns the teardown.
 * `resize` is included because `wide` depends on it, and a window dragged
 * narrower should stop paying for the layer.
 */
export function watchGate(onChange: () => void): () => void {
  const lists = [...QUERIES, '(hover: hover) and (pointer: fine)',
    '(any-pointer: fine), (any-pointer: coarse)'].map((q) => window.matchMedia(q))
  for (const l of lists) l.addEventListener('change', onChange)
  window.addEventListener('resize', onChange, { passive: true })
  return () => {
    for (const l of lists) l.removeEventListener('change', onChange)
    window.removeEventListener('resize', onChange)
  }
}

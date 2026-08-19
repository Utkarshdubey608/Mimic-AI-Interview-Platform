/**
 * MIMIC — motion layer.
 *
 * One place that decides how anything in this product moves, so "cinematic" is a
 * property of the system rather than a per-component improvisation.
 *
 * Three rules, and they are not stylistic:
 *
 *   1. MOTION IS TRANSFORM AND OPACITY. Nothing animates width, height, top,
 *      left, or any property that triggers layout. A candidate answering a
 *      question on a mid-range laptop while a WebRTC call encodes video has no
 *      main-thread budget to spare.
 *
 *   2. MOTION CARRIES MEANING OR IT DOES NOT HAPPEN. A page transition tells you
 *      you moved. A stage change tells you the interview advanced. A focus ring
 *      tells you where you are. Ambient drift tells you the system is live. If a
 *      motion answers none of those, it is decoration and it is cut.
 *
 *   3. REDUCED MOTION IS A REAL MODE, NOT A DEGRADED ONE. Under
 *      `prefers-reduced-motion: reduce` the product still gives feedback — it
 *      just gives it instantly, through colour and opacity, instead of through
 *      travel. Every variant below has a still counterpart. State feedback is
 *      never removed, only its travel is.
 */
import type { Transition, Variants } from 'framer-motion'

/* ── Durations ────────────────────────────────────────────────────────────
   Mirrors --dur-* in tokens.css. Seconds, because framer-motion wants seconds
   and a unit mismatch here is a classic source of a 240-second animation. */
export const duration = {
  instant: 0.09,
  fast: 0.15,
  base: 0.24,
  slow: 0.42,
  /** Stage entrances and interview-state changes only. Nothing else earns it. */
  cinematic: 0.72,
} as const

/* ── Easings ──────────────────────────────────────────────────────────────
   Three curves, and each has a job.

   `out` is the default: an exponential ease-out starts fast and settles, which
   is what makes an interface feel responsive rather than sluggish — the element
   has already committed to the move by the time you perceive it.

   `turn` is the authored reveal, used where something is EXPOSED rather than
   faded in: a cited transcript line, a stage advancing, a drawer opening.

   `inOut` is symmetric, so it is the only one that belongs on a loop. */
export const ease = {
  out: [0.16, 1, 0.3, 1],
  turn: [0.32, 0.72, 0, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const

/* ── Springs ──────────────────────────────────────────────────────────────
   For anything a person drags or that should feel physical: pipeline cards,
   drawers, the transport tray. Tuned to settle without visible bounce — this
   is an enterprise product, not a toy. */
export const spring = {
  /** Default UI spring: settles in ~300ms, no perceptible overshoot. */
  ui: { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 },
  /** Larger surfaces (drawers, sheets) need more mass or they snap. */
  surface: { type: 'spring', stiffness: 300, damping: 34, mass: 1.1 },
  /** Drag response — stiff, so the object tracks the pointer honestly. */
  drag: { type: 'spring', stiffness: 700, damping: 45, mass: 0.7 },
} satisfies Record<string, Transition>

/* ── Transitions ──────────────────────────────────────────────────────────── */
export const transition = {
  fast: { duration: duration.fast, ease: ease.out },
  base: { duration: duration.base, ease: ease.out },
  slow: { duration: duration.slow, ease: ease.out },
  turn: { duration: duration.slow, ease: ease.turn },
  cinematic: { duration: duration.cinematic, ease: ease.turn },
} satisfies Record<string, Transition>

/**
 * Build the variant set for a surface, given the user's motion preference.
 *
 * Every factory below takes `reduce` rather than reading the media query itself.
 * That is deliberate: the hook must be called by the component (React rules),
 * and threading the boolean makes it impossible to ship a variant that silently
 * ignores the preference — the parameter is required.
 */

/** A page or stage arriving. Travel on the y axis only; never a scale. */
export function pageVariants(reduce: boolean): Variants {
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 10 },
    animate: {
      opacity: 1,
      y: 0,
      transition: reduce ? { duration: duration.fast } : transition.base,
    },
    exit: {
      opacity: 0,
      ...(reduce ? {} : { y: -6 }),
      transition: { duration: duration.fast, ease: ease.out },
    },
  }
}

/**
 * A staged reveal: children arrive in sequence rather than all at once, which is
 * what makes a dense screen read as composed instead of dumped.
 *
 * The stagger is capped at 6 children's worth of delay. An un-capped stagger on
 * a 40-row table means the last row arrives two seconds late, which reads as a
 * performance problem rather than as craft.
 */
export function staggerVariants(reduce: boolean, step = 0.045): Variants {
  return {
    initial: {},
    animate: {
      transition: reduce ? { staggerChildren: 0 } : { staggerChildren: step, delayChildren: 0.02 },
    },
  }
}

export function staggerChild(reduce: boolean): Variants {
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: {
      opacity: 1,
      y: 0,
      transition: reduce ? { duration: duration.fast } : transition.base,
    },
  }
}

/**
 * The authored reveal — content EXPOSED rather than faded in, via clip-path.
 *
 * This is the product's one signature move, and it is reserved for the moment a
 * piece of evidence is shown: a cited transcript line, a score's rationale, a
 * question appearing on the interview stage. Using it anywhere else spends the
 * signature and it stops meaning anything.
 */
export function revealVariants(reduce: boolean): Variants {
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, clipPath: 'inset(0 0 100% 0)' },
    animate: {
      opacity: 1,
      clipPath: 'inset(0 0 0% 0)',
      transition: reduce ? { duration: duration.fast } : transition.turn,
    },
    exit: { opacity: 0, transition: { duration: duration.fast } },
  }
}

/** Overlays: modal, drawer, popover. The scrim and the surface move together. */
export function overlayVariants(reduce: boolean): Variants {
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, scale: 0.985, y: 6 },
    animate: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: reduce ? { duration: duration.fast } : spring.surface,
    },
    exit: {
      opacity: 0,
      ...(reduce ? {} : { scale: 0.99 }),
      transition: { duration: duration.fast, ease: ease.out },
    },
  }
}

export function scrimVariants(): Variants {
  // No reduce branch: a scrim only ever changes opacity, which is not motion.
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: duration.base } },
    exit: { opacity: 0, transition: { duration: duration.fast } },
  }
}

/**
 * A drawer entering from an edge. `from` is the edge it is anchored to.
 *
 * The three edges are spelled out rather than built from a computed `[axis]`
 * key: framer-motion's `Variants` type treats an arbitrary string key as a CSS
 * custom property, so a computed axis silently loses all type checking on the
 * transition. Three explicit branches keep it honest.
 */
export function drawerVariants(reduce: boolean, from: 'right' | 'left' | 'bottom' = 'right'): Variants {
  const enter = reduce ? { duration: duration.fast } : spring.surface
  const leave = { duration: duration.base, ease: ease.out }

  if (reduce) {
    // No travel: the drawer cross-fades in place.
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: enter },
      exit: { opacity: 0, transition: leave },
    }
  }

  if (from === 'bottom') {
    return {
      initial: { opacity: 1, y: '100%' },
      animate: { opacity: 1, y: 0, transition: enter },
      exit: { y: '100%', transition: leave },
    }
  }

  const off = from === 'left' ? '-100%' : '100%'
  return {
    initial: { opacity: 1, x: off },
    animate: { opacity: 1, x: 0, transition: enter },
    exit: { x: off, transition: leave },
  }
}

/**
 * Interview-stage phase change — preparation → answering → submitted.
 *
 * The slowest transition in the product, and the only place `cinematic` is
 * used, because it is the one moment where a candidate genuinely needs a beat to
 * register that the rules just changed. Under reduced motion it becomes an
 * instant cross-fade; the phase is also announced to assistive technology by the
 * stage itself, so nobody depends on the animation to know what happened.
 */
export function stageVariants(reduce: boolean): Variants {
  return {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 16, filter: 'blur(4px)' },
    animate: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: reduce ? { duration: duration.base } : transition.cinematic,
    },
    exit: {
      opacity: 0,
      ...(reduce ? {} : { y: -12, filter: 'blur(4px)' }),
      transition: { duration: duration.base, ease: ease.out },
    },
  }
}

/**
 * Ambient loops — the background field, the voice orb's idle breathing.
 *
 * Returns `null` under reduced motion so the caller can skip rendering the
 * animated layer altogether rather than animating it to a standstill. Animating
 * an element for zero visual result still costs a composited layer every frame,
 * and on the interview stage that budget belongs to the video encoder.
 */
export function ambientLoop(reduce: boolean, seconds: number): Transition | null {
  if (reduce) return null
  return { duration: seconds, ease: ease.inOut, repeat: Infinity, repeatType: 'mirror' }
}

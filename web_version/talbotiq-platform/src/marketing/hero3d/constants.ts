/**
 * Hero scene constants — the cinematic first viewport on the home page.
 *
 * Deliberately three-free, like `features/intro/constants.ts`, so the arming
 * shell can read budgets and decide whether to load the scene at all without
 * pulling three.js into the marketing entry chunk. That trap is documented in
 * Field.tsx and it is real: one value import of a three-touching module put a
 * 306 kB shader in the marketing chunk.
 *
 * Colours are NOT declared here. They are read off the DOM at arm time from
 * `--mm-ink`, `--mm-ai` and `--mm-on-ink-accent`, the same way Field.tsx reads
 * its ramp, so the scene cannot drift from the stylesheet. A palette hardcoded
 * in a shader is a second source of truth for the brand.
 */

export type HeroTier = 'high' | 'med'

/**
 * Camera poses. The signal structure sits at the origin; the footage plane sits
 * just behind it at z ≈ -0.6 so glass panels in front can refract it.
 *
 * `open` is where the film starts — pushed back and wide, so the assemble reads
 * as depth arriving rather than as objects fading up. `resolved` is the
 * composition the sequence lands on and STAYS on. There is no third pose and no
 * loop: a camera that keeps moving after it has arrived is the single clearest
 * tell of a scene built to impress rather than to be looked at.
 */
export const HERO_CAMERA = {
  open:     { position: [0, 0.25, 7.4], lookAt: [0, 0, -0.4], fov: 46 },
  resolved: { position: [0, 0.12, 5.15], lookAt: [0, -0.02, -0.2], fov: 38 },
} as const

/**
 * Beats, in seconds. The whole sequence is 2.9s and the copy has started
 * arriving by 1.15s — the brief asks for cinematic within three seconds, and a
 * visitor who has to wait three seconds to read a headline has been made to
 * watch a loading screen with good lighting.
 *
 *   rise     scene fades up from near-black, ambient only
 *   assemble panels/ribbons/orbs travel in and settle
 *   resolve  the signal structure locks; bloom breathes once
 *   copy     eyebrow → heading → body → actions, staggered (DOM, not WebGL)
 *   rest     everything settles into the idle state and the timeline ends
 */
export const HERO_BEATS = {
  rise: 0,
  assemble: 0.42,
  resolve: 1.32,
  copy: 1.15,
  rest: 2.9,
} as const

/** Depth of field, world units from camera. */
export const HERO_DOF = {
  openFocus: 8.6,
  openBokeh: 5.2,
  /* Focus lands ON the footage plane, so the evidence is the sharp thing in the
     frame and the decoration is what blurs. That is the whole hierarchy of this
     hero in one number. */
  restFocus: 5.35,
  restBokeh: 2.1,
} as const

export const HERO_POST = {
  /* Halved from the first pass. Bloom is what turned the panels into fog: it
     spreads every bright pixel into its neighbours, so a scene that is merely
     bright becomes a scene that is milky. */
  bloomRest: 0.28,
  bloomResolve: 0.8,
  vignette: { offset: 0.32, darkness: 0.78 },
  grain: 0.035,
} as const

/**
 * Per-tier budgets. `med` is what a mobile or low-core machine gets if it gets
 * the scene at all — and by default it does not (see HeroStage: phones keep the
 * static composition, because the home page's LCP is already the worst number
 * on the site and a shader in the first viewport makes it worse).
 */
export const HERO_COUNTS: Record<HeroTier, {
  dpr: number
  /** Translucent interface panels orbiting the signal. */
  panels: number
  /** Flowing data ribbons. */
  ribbons: number
  /** Points in the ambient drift field. */
  motes: number
  /** Ink fluid simulation resolution, per side. */
  inkRes: number
  /** Bars in the waveform fragment ring. */
  bars: number
}> = {
  high: { dpr: 1.75, panels: 7, ribbons: 3, motes: 900, inkRes: 256, bars: 34 },
  med:  { dpr: 1.25, panels: 4, ribbons: 2, motes: 380, inkRes: 128, bars: 22 },
}

/**
 * The product's three real machine states, in the product's real order. The
 * hero rail (HeroIntelligence) already cycles these; the 3D scene now reads the
 * SAME signal, so the lighting and the structure are describing the mechanism
 * rather than performing next to it.
 */
export type SignalState = 'listening' | 'thinking' | 'scoring'
export const SIGNAL_ORDER: readonly SignalState[] = ['listening', 'thinking', 'scoring']
/** Matches HeroIntelligence's DWELL exactly, so rail and scene never drift. */
export const SIGNAL_DWELL: Record<SignalState, number> = {
  listening: 3200,
  thinking: 1700,
  scoring: 2600,
}

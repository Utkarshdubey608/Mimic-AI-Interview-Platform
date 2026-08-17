/**
 * Tunable constants + configurable defaults for the MIMIC AI intro.
 * Colours track the dark brand tokens in tailwind.config.js
 * (brand.black / brand.gold / brand.green) — a violet-dark world since the
 * 2026-08 rebrand onto the parent company's identity.
 */

export type IntroTier = 'high' | 'med' | 'low'
export type HeroMaterialPreset = 'chrome' | 'glass' | 'brushed-metal' | 'emissive'

/** Public configuration surface, overridable via <MimicIntro> props. */
export type IntroConfig = {
  tagline: string
  heroText: string
  heroMaterial: HeroMaterialPreset
  /** Brand accent (light sweep, rim light, lens flare, DOM chrome). */
  accentColor: string
  /** Base card count at the "high" tier; med/low scale down from COUNTS. */
  tileCount?: number
  /** Force a specific quality tier (else auto-detected). */
  tierOverride?: IntroTier
}

export const DEFAULT_CONFIG: IntroConfig = {
  tagline: 'The Future of Interviews',
  heroText: 'MIMIC AI',
  heroMaterial: 'chrome', // polished metal reads most "Marvel/Fortune-500"
  // brand.gold — the token name is legacy; its value is the violet accent the
  // rest of the product uses, so the light sweep, rim light and lens flare land
  // in the same world as the app the film hands off to.
  accentColor: '#F2F3F5',
}

/** sessionStorage gate — the film plays once per browser session. */
export const SESSION_KEY = 'mimic-intro-played'

/** Studio palette. */
export const PALETTE = {
  void: '#050506',
  studio: '#0a0b0d',
  floor: '#040405',
  rimCool: '#cdd9e6',
  rimWarm: '#fff1de',
  key: '#fff6ea',
} as const

/**
 * Timeline beats, in seconds. ~6.6s and fully skippable — fast build, weighty
 * hit, graceful settle (Marvel-title energy).
 *   rush     — real replica faces rush the camera in 3D (motion-blurred flip-through)
 *   converge — the faces decelerate and fly into the wordmark's letterforms
 *   hit      — the polished-metal wordmark slams in: light sweep + lens flare + bloom
 *   tagline  — "The Future of Interviews." resolves beneath
 *   settle   — micro-settle
 *   end      — handoff to the app
 */
export const BEATS = {
  rush: 0,
  converge: 2.2,
  hit: 3.8,
  tagline: 4.7,
  settle: 5.7,
  end: 6.6,
} as const
export type BeatLabel = keyof typeof BEATS

/** Fast-forward duration when the viewer skips. */
export const SKIP_TWEEN = 0.8

/** Camera poses (position + look target + vertical-FOV). Wordmark at origin, +Z. */
export const CAMERA = {
  /** Looking down the corridor as faces stream toward camera. */
  rush: { position: [0, 0.3, 14], lookAt: [0, 0, -18], fov: 60 },
  /** Hero framing for the converge / hit. */
  hero: { position: [0, 0.6, 18], lookAt: [0, 0.12, 0], fov: 34 },
  /** Final settle pose handed to the app. */
  settle: { position: [0, 0.45, 16.5], lookAt: [0, 0.08, 0], fov: 32 },
} as const

/** Depth-of-field distances (world units from camera) per phase. */
export const DOF = {
  // Focus sits exactly on the settled grid wall (camera ~z15, wall z3.5 → ~11.5
  // units) so the HD faces are pin-sharp during the hold; only far incoming
  // cards blur. Low bokeh keeps everything near the wall crisp.
  rushFocus: 11.5,
  rushBokeh: 0.5,
  heroFocus: 18,
  heroBokeh: 5.5,
} as const

/** Bloom / aberration / sweep / flare key values. */
export const POST = {
  bloomRest: 0.7,
  bloomHit: 2.2,
  aberrationRest: 0.0,
  aberrationSpike: 0.004,
  vignette: { offset: 0.3, darkness: 0.92 },
  grain: 0.05,
} as const

/**
 * Layout of the assembled wordmark plane (z≈0) + the rush spread, world units.
 */
export const LAYOUT = {
  /** Half-extent of the assembled wordmark on the z=0 plane. */
  letterHalfWidth: 8.4,
  letterHalfHeight: 1.9,
  /** Where cards start (deep field scatter) before they rush in. */
  rushSpreadX: 15,
  rushSpreadY: 9,
  rushZNear: -8,
  rushZFar: -64,
  /** The tidy front-facing grid wall the cards settle into (readable HD hold). */
  gridHalfW: 9.6,
  gridHalfH: 4.2,
  gridZ: 3.5,
  /** Vertical center of the grid wall (camera looks slightly down). */
  gridCenterY: -0.4,
  /** Card aspect (w/h) and on-wall height (world units). */
  cardAspect: 4 / 3,
} as const

/** Per-tier scene budgets. Fewer, larger cards → the faces read as crisp HD
 *  framed portraits (not a fog of tiny tiles). */
export const COUNTS: Record<IntroTier, { tiles: number; dpr: number }> = {
  high: { tiles: 60, dpr: 2 },
  med: { tiles: 44, dpr: 1.5 },
  low: { tiles: 28, dpr: 1 },
}

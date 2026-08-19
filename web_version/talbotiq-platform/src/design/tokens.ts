/**
 * MIMIC — typed token mirror.
 *
 * Most of the product consumes tokens through CSS custom properties, which is
 * correct: the browser resolves them, and a subtree that opts into the dark
 * ground gets the whole palette swapped for free.
 *
 * But three kinds of consumer cannot read CSS:
 *
 *   - Recharts and any SVG that needs a literal `fill`/`stroke`
 *   - Canvas 2D (the voice waveform, the face-framing overlay)
 *   - WebGL / three.js materials in the intro and Avatar Studio
 *
 * Before this file each of those hardcoded its own hex, which is why an audit
 * found ~200 colour literals in TSX and why the analysis panels did not re-skin
 * with the rest of the product. This module is the one legal source for them.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * If you are writing a `className`, use the Tailwind token or the CSS variable.
 * Import from here ONLY when the value must cross into a canvas, a chart prop or
 * a GL material. A `style={{ color: tokens.record.ink }}` in a component is this
 * file being misused — the CSS variable already does that, and it does it in a
 * way that follows the ground.
 */

/** Which ground a surface is painted on. Mirrors `data-ground` in the DOM. */
export type Ground = 'record' | 'room'

/** The six interview formats. Kept in sync with `TrackType` in shared/types. */
export type TrackKey = 'chat' | 'chatbot' | 'voice' | 'video_avatar' | 'video' | 'two_way'

/* ── The exhibit ramp ──────────────────────────────────────────────────────
   Format coding, the one place saturation is allowed. Two values per format
   because the same tab has to stay legible as ink on paper and as light in a
   dark room. Both are contrast-verified — see scripts/contrast-audit.mjs. */
export const exhibit: Record<TrackKey, { record: string; room: string; label: string }> = {
  chat:         { record: '#B45309', room: '#E9A23B', label: 'Timed Q&A' },
  chatbot:      { record: '#0F766E', room: '#45C7B8', label: 'Conversational' },
  voice:        { record: '#4338CA', room: '#9B8CFF', label: 'Voice' },
  video_avatar: { record: '#BE185D', room: '#F97BB0', label: 'Avatar' },
  video:        { record: '#15803D', room: '#5CC98A', label: 'Video' },
  two_way:      { record: '#0369A1', room: '#5BB3E8', label: 'Two-way' },
}

/** The exhibit colour for a track on a given ground, with a safe fallback. */
export function trackColor(track: string, ground: Ground = 'record'): string {
  const e = exhibit[track as TrackKey]
  if (!e) return ground === 'room' ? '#93A0B4' : '#5C6879'
  return e[ground]
}

export function trackLabel(track: string): string {
  return exhibit[track as TrackKey]?.label ?? track
}

/* ── The two grounds ──────────────────────────────────────────────────────
   Every value here is the literal that tokens.css declares for the same name.
   They are duplicated rather than read at runtime because a chart needs the
   value during render, before layout, when getComputedStyle would force a
   reflow on every data point. The contrast audit parses tokens.css and this
   file is checked against it, so the duplication cannot drift silently. */
const record = {
  ground: '#EEF0F4',
  groundSunk: '#E6E9F0',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunk: '#F8F9FB',
  rule: '#E3E6ED',
  ruleStrong: '#CBD1DC',
  ink: '#0E1420',
  inkBody: '#3A4454',
  inkMuted: '#5C6879',
  inkFaint: '#626B79',
  action: '#0E1420',
  accent: '#1D3FA0',
  accentSoft: '#E2E8F6',
  intel: '#3A4454',
  live: '#0F766E',
  ok: '#15803D',
  warn: '#8A4308',
  risk: '#B3261E',
} as const

const room = {
  ground: '#0B0F18',
  groundSunk: '#070A11',
  surface: '#131A27',
  surfaceRaised: '#1A2333',
  surfaceSunk: '#0E141F',
  rule: '#232D3F',
  ruleStrong: '#33415A',
  ink: '#EDF1F8',
  inkBody: '#C6D0E0',
  inkMuted: '#93A0B4',
  inkFaint: '#7D8AA0',
  action: '#EDF1F8',
  accent: '#8AA6F0',
  accentSoft: '#1B2842',
  intel: '#C6D0E0',
  live: '#4FD1B0',
  ok: '#5CC98A',
  warn: '#E9A23B',
  risk: '#FF8A80',
} as const

export const tokens = { record, room } as const

/** The palette for a ground. Pass this into a chart theme, not individual hexes. */
export function palette(ground: Ground) {
  return ground === 'room' ? room : record
}

/* ── Categorical series colour ─────────────────────────────────────────────
   For analytics series that are NOT interview formats. Ordered so that the
   first four are distinguishable under the three common forms of colour vision
   deficiency, and so that no two adjacent entries are close in luminance —
   which is what keeps a chart readable when it is printed, exported to PDF, or
   viewed by someone who cannot separate the hues at all.

   A chart must still carry a second encoding (direct label, shape, or pattern).
   Colour alone is never allowed to be the only signal. */
export const series = {
  record: ['#1D3FA0', '#B45309', '#0F766E', '#BE185D', '#4338CA', '#15803D', '#0369A1', '#0E1420'],
  room:   ['#8AA6F0', '#E9A23B', '#45C7B8', '#F97BB0', '#9B8CFF', '#5CC98A', '#5BB3E8', '#D4A574'],
} as const

/** Sequential ramp, for heatmaps and density. Light → dark on the record ground. */
export const sequential = {
  record: ['#F1F4FB', '#E2E8F6', '#C6D2ED', '#9AAEDF', '#6480C6', '#3D5CB4', '#1D3FA0', '#152E76'],
  room:   ['#131A27', '#1B2842', '#24365C', '#2F4A7D', '#3D5CB4', '#6480C6', '#8AA6F0', '#B8C9F7'],
} as const

/**
 * Diverging ramp for anything measured AGAINST a benchmark — a score relative to
 * a role's bar, a stage's pass rate against the pipeline average. Anchored at a
 * neutral midpoint so "at the benchmark" is visibly distinct from both
 * directions rather than being an arbitrary point on a gradient.
 */
export const diverging = {
  record: ['#B3261E', '#D4726B', '#E8B4B0', '#E3E6ED', '#A9D4BC', '#5AAE7F', '#15803D'],
  room:   ['#FF8A80', '#D4726B', '#8C4A45', '#33415A', '#3F8563', '#4FA87C', '#5CC98A'],
} as const

/* ── Tenant accent ─────────────────────────────────────────────────────────
   A tenant's accent colour is an arbitrary hex we do not control, which makes
   it the one value in the product with no contrast guarantee. It must therefore
   never carry text, never fill a large surface, and never be tinted by string
   concatenation (`accent + '14'`) — all three of which the candidate screens
   used to do.

   Where it IS used — a small identity mark — this decides what colour can
   legibly sit on top of it, by measuring rather than assuming. */

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return 0
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = parseInt(full.slice(i, i + 2), 16) / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Ink or paper, whichever is legible on the given background.
 *
 * The 0.179 threshold is where black and white contrast equally against a
 * colour (both at 4.5:1), so picking the side of it maximises contrast rather
 * than guessing from a hue.
 */
export function readableOn(background: string): '#0B0F18' | '#FFFFFF' {
  return luminance(background) > 0.179 ? '#0B0F18' : '#FFFFFF'
}

/* ── Non-colour status encoding ────────────────────────────────────────────
   Binding rule from the design system: colour is never the only carrier of
   status. Every status has a glyph and a word as well, and this map is what
   guarantees the three stay in step across tables, badges, charts and exports.

   `glyph` is a text character rather than an icon component so it survives into
   a PDF export, a plain-text email and a screen reader's output. */
export type StatusKey = 'ok' | 'warn' | 'risk' | 'neutral' | 'live' | 'intel'

export const status: Record<StatusKey, { glyph: string; word: string; tone: string }> = {
  ok:      { glyph: '✓', word: 'Pass',     tone: 'ok' },
  warn:    { glyph: '!', word: 'Review',   tone: 'warn' },
  risk:    { glyph: '×', word: 'Flagged',  tone: 'risk' },
  neutral: { glyph: '–', word: 'Pending',  tone: 'neutral' },
  live:    { glyph: '●', word: 'Live',     tone: 'live' },
  intel:   { glyph: '◆', word: 'AI',       tone: 'intel' },
}

/**
 * The colour schemes a workspace can choose.
 *
 * ── WHY EACH SCHEME IS THREE COLOURS AND NOT ONE ──────────────────────────
 * A pastel is a FILL. It works behind dark text on a button, a chip, a bar. It
 * cannot be text: peach on white is about 1.6:1, which is not a contrast failure
 * so much as an invisible link. But the two roles a scheme has to fill are
 * exactly those two — the primary action is a large fill with a label on it, and
 * the secondary is a rail and a chart series that also has to work as link text.
 * So every scheme carries:
 *
 *   fill  the pastel itself, for anything with area
 *   on    what goes ON that fill — near-black, because every pastel here is light
 *   text  a deep version of the same hue, for when the colour IS the text
 *
 * `text` is per ground: a hue dark enough to read on paper is too dark to read in
 * a dark room, so each has a record value and a room value. That is the same
 * shape the `exhibit` ramp in tokens.ts already uses for the six interview
 * formats, and for the same reason.
 *
 * ── WHAT GATES THIS ────────────────────────────────────────────────────────
 * scripts/contrast-audit.mjs reads tokens.css and cannot see a runtime choice, so
 * these pairs are gated by schemes.test.ts instead — every `on` against its own
 * `fill`, every `text` against both grounds' surfaces. A scheme that cannot be
 * read does not ship, whoever picks it.
 *
 * ── THE ADDITION ───────────────────────────────────────────────────────────
 * `slate` is not one of the six. It is the product's own restraint — ink for the
 * action, registrar blue for the accent — kept as the first option and the
 * default. Without it there is no way back: picking a scheme would otherwise be a
 * one-way door out of the design the rest of the system was built around, and
 * "put it back how it was" is the first thing anyone asks for after trying six
 * colours.
 */

/** Which role a scheme is filling. Both are chosen independently. */
export type SchemeRole = 'primary' | 'secondary'

export type SchemeKey =
  | 'slate' | 'peach' | 'lavender' | 'mint' | 'sky' | 'butter' | 'clay'

export type Scheme = {
  key: SchemeKey
  label: string
  /** Large fills: the primary button, the featured card, a bar, a chip. */
  fill: { record: string; room: string }
  /** What is legible ON that fill. */
  on: { record: string; room: string }
  /** The hue used AS text — links, an accent label, a figure. Per ground. */
  text: { record: string; room: string }
}

export const SCHEMES: readonly Scheme[] = [
  {
    /* The system's own. Ink on paper, near-white in the room, registrar blue for
       the accent — the values tokens.css already declares. */
    key: 'slate', label: 'Default',
    fill: { record: '#0E1420', room: '#EDF1F8' },
    on:   { record: '#FFFFFF', room: '#0B0F18' },
    text: { record: '#152E76', room: '#8AA6F0' },
  },
  {
    key: 'peach', label: 'Peach',
    fill: { record: '#F3C6A3', room: '#F0BE96' },
    on:   { record: '#3A1F09', room: '#3A1F09' },
    text: { record: '#8A4A16', room: '#EFAF77' },
  },
  {
    key: 'lavender', label: 'Lavender',
    fill: { record: '#C9BEEF', room: '#C3B6EE' },
    on:   { record: '#221641', room: '#221641' },
    text: { record: '#54409E', room: '#BFACF6' },
  },
  {
    key: 'mint', label: 'Mint',
    fill: { record: '#A8DCC0', room: '#9CD7B6' },
    on:   { record: '#0F2E1E', room: '#0F2E1E' },
    text: { record: '#1B6440', room: '#79D4A3' },
  },
  {
    key: 'sky', label: 'Sky',
    fill: { record: '#BFD9F2', room: '#B3D3F0' },
    on:   { record: '#0F2743', room: '#0F2743' },
    text: { record: '#1C4C85', room: '#92C0EB' },
  },
  {
    key: 'butter', label: 'Butter',
    /* Yellower than it started. At #EFDCA0 it sat 19° from Peach, which the hue
       check in schemes.test.ts reads as the same colour twice on a settings page
       that offers them as two choices. */
    fill: { record: '#F0DE96', room: '#ECD889' },
    on:   { record: '#332703', room: '#332703' },
    text: { record: '#72540F', room: '#DEC77A' },
  },
  {
    key: 'clay', label: 'Clay',
    /* Rosier than it started, for the same reason in the other direction: at
       #E2A79B it was 16° from Peach. Clay is the dusty red of the six, so the hue
       it needed was the one it was named for. */
    fill: { record: '#E0A19A', room: '#DD988F' },
    on:   { record: '#3A1512', room: '#3A1512' },
    text: { record: '#8E3B31', room: '#E39A8B' },
  },
]

export const schemeByKey = (key: string): Scheme =>
  SCHEMES.find((s) => s.key === key) ?? SCHEMES[0]

/**
 * One step of hover, in the direction that ground allows.
 *
 * Toward black on paper and toward white in the room. Not a matter of taste: a
 * pastel on a white page cannot usefully get lighter, and on an ink page it cannot
 * usefully get darker, so the same shift would be invisible in one of the two.
 * `color-mix` keeps this to one declared colour per scheme instead of two.
 */
const shade = (hex: string, ground: 'record' | 'room'): string =>
  `color-mix(in srgb, ${hex} 88%, ${ground === 'record' ? 'black' : 'white'})`

/**
 * The CSS custom properties a chosen pair writes, for one ground.
 *
 * Deliberately eight properties and not more. `--action` and its two companions are
 * the primary action wherever it appears — the button, the selected tab, the
 * featured card — and `--accent` and its two are the rail, the link and the chart
 * series. Everything else in the palette is ground and ink, which a colour scheme
 * has no business touching: a workspace picking Peach is choosing an accent, not
 * asking for peach body text.
 */
export function schemeVars(
  primary: Scheme,
  secondary: Scheme,
  ground: 'record' | 'room',
): Record<string, string> {
  return {
    '--action': primary.fill[ground],
    '--action-hover': shade(primary.fill[ground], ground),
    '--on-action': primary.on[ground],
    /* The control's EDGE, and it is not decoration. A pastel fill cannot reach
       3:1 against a white page — peach on white is 1.57:1, which is arithmetic,
       not a badly chosen peach — and WCAG 1.4.11 asks for the boundary of a
       control to be discernible, not its fill. So the boundary is drawn, in the
       deep tone of the same hue, and gated at 3:1 in schemes.test.ts. For the
       default scheme this equals the fill, so the border is there and invisible
       and nothing about the current design changes. */
    '--action-edge': primary.key === 'slate' ? primary.fill[ground] : primary.text[ground],
    '--accent': secondary.fill[ground],
    '--accent-hover': shade(secondary.fill[ground], ground),
    '--accent-ink': secondary.text[ground],
    '--accent-edge': secondary.key === 'slate' ? secondary.fill[ground] : secondary.text[ground],
  }
}

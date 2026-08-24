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
 * The pale wash of a scheme colour — a selected row, a chosen card, a soft chip.
 *
 * Mixed toward the ground's own surface, not toward white, or the room's washes
 * would come out pale and glaring against a dark panel. The strengths differ for
 * the same reason the tint strengths differ in tokens.css: a pastel through white
 * shows at 18%, while through #101724 it needs 26% before it reads as anything at
 * all.
 */
const wash = (hex: string, ground: 'record' | 'room'): string =>
  ground === 'record'
    ? `color-mix(in srgb, ${hex} 18%, #FFFFFF)`
    : `color-mix(in srgb, ${hex} 26%, #101724)`

/**
 * The CSS custom properties a chosen pair writes, for one ground.
 *
 * This used to be eight properties, with a note saying "deliberately eight and not
 * more" — the action, the accent, and their companions. That was too little, and
 * the reason is worth keeping: the eight are all INTERACTIVE. Everything a reader
 * actually looks at is the ground behind the cards, a table header, the row under
 * the cursor, a hairline — and every one of those was a fixed cool neutral. So
 * picking Peach repainted a button and a tick, and left the rest of the screen
 * exactly as it was. Reported as the palette being "only there for name sake", and
 * that was a fair description of eight properties on a page made of a hundred.
 *
 * Three things are added, and the first is the one that does the work.
 *
 *  · `--tint` is the chosen primary, handed to tokens.css, which decides which
 *    neutrals take the hue and how strongly. One property here, the whole design
 *    decision there, next to the values being tinted. `transparent` for the
 *    default scheme, which collapses every mix in that file to its base literal —
 *    so a workspace that has never picked a colour renders the bytes it did
 *    before. Ink is never tinted; see the long note in tokens.css.
 *
 *  · `--accent-soft` was CONSUMED but never WRITTEN. tokens.css aliases it to the
 *    registrar blue's soft tone and Tailwind exposes it as `signal-soft`, so a
 *    workspace on Peach got peach rails and pale BLUE washes behind them. It is
 *    written per scheme now.
 *
 *  · `--action-soft` is new: the same pale wash for the primary. It is what a
 *    selected row, a chosen card and a subtle chip want, and its absence is why
 *    those reached for the fixed `primary-50` literal instead.
 *
 * What is still refused: ink, `--surface`, and the semantic colours. A Mint
 * palette must not turn an error message green, so ok/warn/risk are untouched —
 * they carry meaning, not taste.
 */
export function schemeVars(
  primary: Scheme,
  secondary: Scheme,
  ground: 'record' | 'room',
): Record<string, string> {
  const out: Record<string, string> = {}

  /* THE DEFAULT EMITS NOTHING FOR ITS ROLE, and that is the mechanism rather than
     an optimisation.

     `slate` means "the values tokens.css already ships". Writing them out here
     instead would mean two files holding the same literals, and they had already
     drifted: this function wrote `--accent: secondary.fill[ground]`, and slate's
     fill is INK — so choosing Default for the secondary role set the accent to
     #0E1420 when tokens.css says #1D3FA0, and this file's own header says slate is
     "ink for the action, registrar blue for the accent". The documentation was
     right and the code was wrong, quietly, for every workspace that never picked a
     colour. It surfaced when the focus ring was pointed at `--accent`: default
     focus rings went from registrar blue to ink.

     Omitting the property cannot drift. `apply()` rewrites the whole stylesheet on
     every change, so an omitted key is REMOVED and the tokens.css declaration
     underneath simply applies again — no literal to keep in step, and no cycle
     from declaring `--accent: var(--accent)`.

     Per ROLE, not per call: primary Default with secondary Peach has to leave the
     action alone and still write the accent. */
  if (primary.key !== 'slate') {
    out['--action'] = primary.fill[ground]
    out['--action-hover'] = shade(primary.fill[ground], ground)
    out['--on-action'] = primary.on[ground]
    /* The control's EDGE, and it is not decoration. A pastel fill cannot reach
       3:1 against a white page — peach on white is 1.57:1, which is arithmetic,
       not a badly chosen peach — and WCAG 1.4.11 asks for the boundary of a
       control to be discernible, not its fill. So the boundary is drawn, in the
       deep tone of the same hue, and gated at 3:1 in schemes.test.ts. */
    out['--action-edge'] = primary.text[ground]
    /* The pale wash behind a selected row, a chosen card, a soft chip. Its absence
       is why those reached for the fixed `primary-50` literal, which no palette
       could ever reach. Gated against body text in schemes.test.ts, because a
       selected row carries a label. */
    out['--action-soft'] = wash(primary.fill[ground], ground)
  }

  if (secondary.key !== 'slate') {
    out['--accent'] = secondary.fill[ground]
    out['--accent-hover'] = shade(secondary.fill[ground], ground)
    out['--accent-ink'] = secondary.text[ground]
    out['--accent-edge'] = secondary.text[ground]
    /* `--accent-soft` was CONSUMED and never WRITTEN: tokens.css aliases it to the
       registrar blue's soft tone and Tailwind exposes it as `signal-soft`, so a
       workspace on Peach got peach rails with pale BLUE washes behind them. */
    out['--accent-soft'] = wash(secondary.fill[ground], ground)
  }

  /* Handed to tokens.css, which owns WHAT gets tinted and by how much. One
     property here, the whole design decision there, next to the values being
     tinted. Always written, including as `transparent`, so the stylesheet states
     the default rather than relying on the reader to know that an absent tint and
     no tint are the same thing. */
  /* The SCALAR, and it is what actually switches tinting on. See the note in
     tokens.css: `transparent` at a non-zero percentage returns the base colour at
     a reduced ALPHA, not the base colour — so the default has to multiply the
     percentage by zero rather than rely on a transparent tint being a no-op.
     Emitted only when a colour is chosen; omitted, tokens.css's own 0 applies. */
  if (primary.key !== 'slate') out['--tint-k'] = '1'

  out['--tint'] = primary.key === 'slate'
    ? 'transparent'
    : ground === 'record'
      ? primary.fill[ground]
      /* DARKENED for the room, and this is the difference between a tinted room
         and an unreadable one. Every scheme here is a LIGHT pastel, so mixing one
         straight into a near-black ground raises that ground's luminance while the
         room's text stays light: measured, an 18% peach through `--surface-hover`
         took the quietest text from 4.1:1 to 2.85:1. Taking the hue 45% toward
         black first keeps the ground dark and still colours it, which moved the
         safe strength from 8% to 27% with the same hue on screen. */
      : `color-mix(in srgb, ${primary.fill[ground]} 45%, black)`

  return out
}

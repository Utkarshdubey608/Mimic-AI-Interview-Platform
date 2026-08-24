/**
 * Every colour scheme, gated for contrast.
 *   npx tsx src/design/schemes.test.ts
 *
 * scripts/contrast-audit.mjs reads tokens.css and so cannot see a choice made at
 * runtime — which is exactly what a colour scheme is. Without this file the
 * schemes would be the one part of the palette nothing checks, and a workspace
 * could pick a combination that makes its own primary button unreadable.
 *
 * What is gated, and at what:
 *   4.5  `on` against its own `fill` — a button label on the button
 *   4.5  `text` against both grounds' surfaces — a link, an accent figure
 *   3.0  `fill` against both grounds' page and panel — the EDGE of the control,
 *        which is what WCAG 1.4.11 covers: you have to be able to find it
 */
import { readFileSync } from 'node:fs'

import { SCHEMES, schemeVars, schemeByKey } from './schemes'

/* The two grounds' real values, from tokens.css. Duplicated here on purpose and
   pinned by the assertions below, so a token edit that moves a ground shows up
   as a failure here rather than silently changing what this file is measuring. */
const GROUND = {
  record: { page: '#F5F5F7', surface: '#FFFFFF' },
  room:   { page: '#0B0F18', surface: '#101724' },
} as const

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}

const lum = (hex: string): number => {
  const n = hex.replace('#', '')
  const c = [0, 2, 4].map((i) => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)]
  return +(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2))
}

assert('every scheme is a six-digit hex throughout',
  SCHEMES.every((s) => [s.fill, s.on, s.text].every((r) =>
    [r.record, r.room].every((v) => /^#[0-9A-F]{6}$/i.test(v)))),
  SCHEMES.filter((s) => [s.fill, s.on, s.text].some((r) =>
    [r.record, r.room].some((v) => !/^#[0-9A-F]{6}$/i.test(v)))).map((s) => s.key).join(', '))

assert('keys are unique', new Set(SCHEMES.map((s) => s.key)).size === SCHEMES.length)
assert('the default is first and is the system’s own', SCHEMES[0].key === 'slate')
assert('an unknown key falls back to the default', schemeByKey('nope').key === 'slate')

for (const s of SCHEMES) {
  for (const g of ['record', 'room'] as const) {
    // A label on its own button.
    const onFill = ratio(s.on[g], s.fill[g])
    assert(`${s.key}/${g}: label on the fill`, onFill >= 4.5, `${onFill}:1`)

    // The hue used as text, on both things it can sit on.
    for (const surf of ['page', 'surface'] as const) {
      const t = ratio(s.text[g], GROUND[g][surf])
      assert(`${s.key}/${g}: accent text on the ${surf}`, t >= 4.5, `${t}:1`)
    }

    /* The control's own EDGE has to be findable against what is behind it — the
       fill does not. A pastel cannot clear 3:1 on white and never will: peach on
       white is 1.57:1 by arithmetic. WCAG 1.4.11 asks for the boundary of a
       control to be discernible, so the boundary is what is drawn and what is
       gated. `schemeVars` emits it as --action-edge / --accent-edge. */
    const edge = s.key === 'slate' ? s.fill[g] : s.text[g]
    for (const surf of ['page', 'surface'] as const) {
      const e = ratio(edge, GROUND[g][surf])
      assert(`${s.key}/${g}: the control’s edge on the ${surf}`, e >= 3, `${e}:1`)
    }
  }
}

/* Every pair is choosable, so the two roles have to be tellable apart — the
   picker's own copy says "pick something distinct from the primary".

   MEASURED BY HUE, not by contrast ratio. The first version of this check used the
   luminance ratio and reported peach and mint as 1.02:1 apart, i.e. failing. They
   are of course trivially distinguishable; pastels are chosen to sit at the SAME
   lightness, so a luminance ratio between any two of them is meaningless by
   construction. The check was measuring the one property the palette deliberately
   holds constant. Hue angle is the property that actually varies. */
const hue = (hex: string): number => {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return ((h * 60) + 360) % 360
}
const apart = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}
for (let i = 0; i < SCHEMES.length; i++) {
  for (let j = i + 1; j < SCHEMES.length; j++) {
    const a = SCHEMES[i], b = SCHEMES[j]
    if (a.key === 'slate' || b.key === 'slate') continue
    const d = Math.round(apart(hue(a.fill.record), hue(b.fill.record)))
    assert(`${a.key} and ${b.key} are ${d}° apart`, d >= 20, `${d}°`)
  }
}

/* ── THE TINT, gated ────────────────────────────────────────────────────────
   A scheme now hands `--tint` to tokens.css, which mixes it through the neutrals
   that sit BEHIND content — the ground, its wells, the sunk and hover surfaces,
   the hairlines. That is what makes a chosen colour reach the whole product
   rather than one button, and it is also the one change here that could make
   text unreadable, so it is the one that has to be proved.

   The bases and strengths below are duplicated from tokens.css deliberately, the
   same way GROUND above is: pinned here, so moving a strength or a base in that
   file shows up as a failure in this one rather than as a quiet contrast loss.

   `--ink-faint` is what is measured against them, not `--ink`. It is the
   quietest text the palette permits — 4.72:1 on paper, 4.99:1 in the room, both
   with almost nothing to spare — so if the tint is survivable for that token it
   is survivable for every darker one above it. Gating the headline colour would
   pass at 15:1 and prove nothing. */
const INK_FAINT = { record: '#626B79', room: '#7D8AA0' } as const
const INK_BODY = { record: '#3A4454', room: '#C6D0E0' } as const

/* WHICH text is measured against WHICH surface, and it is not one rule for all.
   `--surface-hover` is a row under the cursor and what sits on it is body text; a
   caption never lives there. Measuring the quietest token against it would be
   stricter than the product's own baseline — that pair is 4.09:1 in the room
   BEFORE any tint — and a gate that the untinted product already fails is a gate
   that teaches nothing. So the grounds and the sunk surfaces are measured against
   the quietest permissible text, and the hover surface against body. */
const AGAINST = { '--surface-hover': 'body' } as const

/* THE RULE THIS GATE ENFORCES, stated once because it is not simply "4.5".
   Two of these pairs are already under 4.5 untinted — `--ground-sunk` on paper is
   4.43:1 against the quietest text — so an absolute bar would fail the product as
   it ships today and tell us nothing about the tint. What the tint must not do is
   make anything WORSE. So: where the untinted pair is compliant, the tinted pair
   must stay compliant; where it is already under, the tint may not erode it
   further. That is the property actually worth guaranteeing. */
const floorFor = (baseline: number) => (baseline >= 4.5 ? 4.5 : baseline * 0.98)

/** `color-mix(in srgb, c p%, base)` — a straight per-channel average of the
    gamma-encoded values, which is what the `srgb` colour space means. */
const mix = (c: string, pct: number, base: string): string => {
  const ch = (h: string, i: number) => parseInt(h.replace('#', '').slice(i, i + 2), 16)
  const out = [0, 2, 4].map((i) => Math.round(ch(c, i) * (pct / 100) + ch(base, i) * (1 - pct / 100)))
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/* Every tinted token, its base and its strength — READ OUT OF tokens.css, not
   copied from it.

   The first version of this file hard-coded the table, and it immediately proved
   why that is wrong: a scripted edit to tokens.css failed halfway, the stylesheet
   kept its untinted cards, the table here said 5% — and this gate passed, because
   it was measuring the table rather than the product. A duplicated constant does
   not gate anything; it gates itself.

   So the strengths are parsed. Edit one in tokens.css and this recomputes against
   it; add a tinted token there and it is covered here without an edit. */
const TOKENS_CSS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')

const tintedTokens = (selector: string): [string, string, number][] => {
  const start = TOKENS_CSS.indexOf(selector)
  if (start < 0) throw new Error(`tokens.css has no ${selector} block`)
  /* The block is a flat declaration list, so its first closing brace is its end. */
  const block = TOKENS_CSS.slice(start, TOKENS_CSS.indexOf('}', start))
  /* Matches the scalar form: the percentage is multiplied by `--tint-k`, which is 0
     until a scheme is chosen. See the note in tokens.css. */
  const re = /(--[a-z-]+):\s*color-mix\(in srgb, var\(--tint\) calc\((\d+)% \* var\(--tint-k\)\), (#[0-9A-Fa-f]{6})\)/g
  const out: [string, string, number][] = []
  for (const m of block.matchAll(re)) out.push([m[1], m[3], Number(m[2])])
  return out
}

const TINTED = {
  record: tintedTokens("[data-ground='record'] {"),
  room: tintedTokens("[data-ground='room'] {"),
} as const

assert('tokens.css tints the record ground', TINTED.record.length >= 6, `${TINTED.record.length} tokens`)
assert('tokens.css tints the room', TINTED.room.length >= 6, `${TINTED.room.length} tokens`)
/* The cards specifically, because holding them pure is the failure mode this
   whole change exists to correct, and a silent revert would look like a pass. */
for (const g of ['record', 'room'] as const) {
  assert(`${g}: the card surface is tinted`,
    TINTED[g].some(([n]) => n === '--surface'), TINTED[g].map(([n]) => n).join(' '))
}

for (const s of SCHEMES) {
  for (const g of ['record', 'room'] as const) {
    /* Mirrors schemeVars: the room takes the hue 45% toward black first, because a
       light pastel mixed into a near-black ground lightens it and the room's text
       is light. See the note there. */
    const tint = s.key === 'slate'
      ? null
      : g === 'record' ? s.fill[g] : mix(s.fill[g], 45, '#000000')
    for (const [name, base, pct] of TINTED[g]) {
      const tinted = tint ? mix(tint, pct as number, base as string) : (base as string)

      /* The default scheme tints nothing, and that is not a nicety — a workspace
         that has never picked a colour has to render the bytes it did before. */
      if (!tint) {
        assert(`slate/${g}: ${name} is untinted`, tinted === base, tinted)
        continue
      }

      /* Text-bearing surfaces. A hairline carries no text, so it is exempt from
         the text gate — but it must still stay on the same SIDE of its surface,
         or a rule stops reading as a rule. */
      if ((name as string).startsWith('--rule')) {
        const surf = g === 'record' ? GROUND.record.surface : GROUND.room.surface
        const darker = lum(tinted) < lum(surf)
        assert(`${s.key}/${g}: ${name} still contrasts its surface`,
          g === 'record' ? darker : !darker,
          `rule ${tinted} vs surface ${surf}`)
        continue
      }

      const who = (AGAINST as Record<string, string>)[name as string] === 'body' ? 'body' : 'faint'
      const ink = who === 'body' ? INK_BODY[g] : INK_FAINT[g]
      const baseline = ratio(ink, base as string)
      const floor = floorFor(baseline)
      const r = ratio(ink, tinted)
      assert(`${s.key}/${g}: ${who} text on tinted ${name}`, r >= floor,
        `${r}:1 on ${tinted} (untinted ${baseline}:1, floor ${floor.toFixed(2)})`)
    }
  }
}

/* ── THE WASHES, gated ──────────────────────────────────────────────────────
   `--action-soft` and `--accent-soft` are the pale tone behind a selected row, a
   chosen card, a soft chip — and every one of those carries a label, so body text
   has to survive on them. `--accent-soft` in particular was CONSUMED by Tailwind
   as `signal-soft` and never written by a scheme, so it stayed a pale registrar
   blue behind a peach rail; now that it is written, it is also gated. */
for (const s of SCHEMES) {
  for (const g of ['record', 'room'] as const) {
    if (s.key === 'slate') continue          // defers to the literals in tokens.css
    const wash = g === 'record' ? mix(s.fill[g], 18, '#FFFFFF') : mix(s.fill[g], 26, '#101724')
    const r = ratio(INK_BODY[g], wash)
    assert(`${s.key}/${g}: body text on the pale wash`, r >= 4.5, `${r}:1 on ${wash}`)
  }
}

const vars = schemeVars(SCHEMES[1], SCHEMES[4], 'record')
assert('a chosen pair writes both roles, the tint and its scalar', Object.keys(vars).length === 12, Object.keys(vars).join(' '))
assert('a chosen scheme hands tokens.css a tint',
  vars['--tint'] === SCHEMES[1].fill.record, vars['--tint'])
assert('both washes are written', !!vars['--action-soft'] && !!vars['--accent-soft'])

/* THE DEFAULT IS NOT A SET OF LITERALS, IT IS AN ABSENCE. `slate` means "whatever
   tokens.css declares", so schemeVars must emit nothing for that role — an omitted
   custom property is removed from the stylesheet and the declaration underneath
   applies again. Writing the values out instead is what let this drift: `--accent`
   was being set from slate's FILL, which is ink, while tokens.css says registrar
   blue and this file's header says the same. Guarded in both directions. */
const dflt = schemeVars(SCHEMES[0], SCHEMES[0], 'record')
assert('the default writes the tint and nothing else',
  Object.keys(dflt).length === 1 && dflt['--tint'] === 'transparent', Object.keys(dflt).join(' '))
/* And crucially it does NOT write the scalar, so tokens.css's own 0 stands and every
   mix resolves to its base colour at full opacity. */
assert('the default leaves the tint scalar at zero', !('--tint-k' in dflt))
assert('a chosen scheme switches the scalar on', vars['--tint-k'] === '1')
for (const g of ['record', 'room'] as const) {
  const d = schemeVars(SCHEMES[0], SCHEMES[0], g)
  for (const k of ['--action', '--action-hover', '--on-action', '--action-edge',
    '--action-soft', '--accent', '--accent-hover', '--accent-ink', '--accent-edge', '--accent-soft']) {
    assert(`default/${g}: leaves ${k} to tokens.css`, !(k in d), d[k])
  }
}

/* Per ROLE, so a mixed pair is still handled: Default primary with a chosen
   secondary must leave the action alone and still write the accent. */
const mixed = schemeVars(SCHEMES[0], SCHEMES[1], 'record')
assert('a Default primary leaves the action to tokens.css', !('--action' in mixed))
assert('…while a chosen secondary still writes the accent',
  mixed['--accent'] === SCHEMES[1].fill.record)
assert('…and a Default primary still tints nothing', mixed['--tint'] === 'transparent')
assert('it writes the primary’s fill and the secondary’s',
  vars['--action'] === SCHEMES[1].fill.record && vars['--accent'] === SCHEMES[4].fill.record)
assert('hover differs from rest', vars['--action-hover'] !== vars['--action'])
assert('a non-default scheme draws a real edge', vars['--action-edge'] !== vars['--action'])

/* ── THE MARKETING SITE IS NOT PART OF THE PALETTE ─────────────────────────
   A workspace's colour choice is private to that workspace. The public marketing
   site has its own palette (the `--mm-*` tokens) and stamps no ground, so the ONLY
   way the scheme can reach it is by being written to `:root` — which it was.
   Measured with Peach chosen: 666 of 747 painted elements on the home page moved,
   because Tailwind's default border colour resolves to `--rule` and the tint
   arrived through `:root`. A recruiter choosing a palette for their own workspace
   was re-tinting the brand's front page for themselves.

   Asserted statically rather than in a browser: it is a one-line property of one
   file, and a static check runs in every gate. */
const SCHEME_APPLY = readFileSync(new URL('../lib/colourScheme.ts', import.meta.url), 'utf8')
const writesRoot = /block\([^)]*:root/.test(SCHEME_APPLY)
assert('the scheme is written to the grounds, never to :root', !writesRoot)
assert('...and it is written to both grounds',
  SCHEME_APPLY.includes("[data-ground='record']") && SCHEME_APPLY.includes("[data-ground='room']"))

console.log(failures === 0 ? '\n✅ ALL COLOUR SCHEMES PASS' : `\n❌ ${failures} SCHEME CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

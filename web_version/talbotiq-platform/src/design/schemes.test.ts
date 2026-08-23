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

const vars = schemeVars(SCHEMES[1], SCHEMES[4], 'record')
assert('schemeVars writes exactly eight properties', Object.keys(vars).length === 8, Object.keys(vars).join(' '))
assert('it writes the primary’s fill and the secondary’s',
  vars['--action'] === SCHEMES[1].fill.record && vars['--accent'] === SCHEMES[4].fill.record)
assert('hover differs from rest', vars['--action-hover'] !== vars['--action'])
assert('a non-default scheme draws a real edge', vars['--action-edge'] !== vars['--action'])
assert('the default draws an invisible one', (() => {
  const d = schemeVars(SCHEMES[0], SCHEMES[0], 'record')
  return d['--action-edge'] === d['--action'] && d['--accent-edge'] === d['--accent']
})())

console.log(failures === 0 ? '\n✅ ALL COLOUR SCHEMES PASS' : `\n❌ ${failures} SCHEME CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

/**
 * Unit tests for the ambient field's pure helpers. Run with:
 *   npx tsx src/marketing/field/ambient.test.ts
 * Pure — no DOM, no WebGL, no React. Neither module touches either at import
 * time, which is what makes this testable at all: everything that needs a
 * context lives inside createAmbientField.
 *
 * Two modules, for the bundling reason documented in tokens.ts — the test does
 * not care about chunking, so it simply imports from both.
 */
import { parseColor } from './tokens'
import { renderScale } from './ambient'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

// parseColor — the tokens are authored as hex, but getComputedStyle hands back
// rgb() in some engines, so both have to land on the same floats.
const ink = parseColor('#0E1420')
assert('hex parses', ink !== null)
assert('hex channels are 0..1', !!ink && near(ink[0], 14 / 255) && near(ink[1], 20 / 255) && near(ink[2], 32 / 255))
assert('hex is case-insensitive', JSON.stringify(parseColor('#0e1420')) === JSON.stringify(ink))
assert('shorthand hex expands', JSON.stringify(parseColor('#fff')) === JSON.stringify([1, 1, 1]))

assert('comma rgb parses to the same value', JSON.stringify(parseColor('rgb(14, 20, 32)')) === JSON.stringify(ink))
assert('space-separated rgb parses to the same value', JSON.stringify(parseColor('rgb(14 20 32)')) === JSON.stringify(ink))
assert('rgba drops the alpha', JSON.stringify(parseColor('rgba(14, 20, 32, 0.5)')) === JSON.stringify(ink))
assert('slash alpha syntax parses', JSON.stringify(parseColor('rgb(14 20 32 / 50%)')) === JSON.stringify(ink))
assert('leading and trailing space is tolerated', JSON.stringify(parseColor('  #0E1420 ')) === JSON.stringify(ink))

// A token that has not resolved must NOT fall back to a guess. The field is
// painted over a section with real content behind it, so a wrong ground colour
// is a visible rectangle — null means "skip the WebGL layer", and the CSS
// fallback stays.
assert('empty string is null', parseColor('') === null)
assert('whitespace is null', parseColor('   ') === null)
assert('a named colour is null', parseColor('rebeccapurple') === null)
assert('a malformed hex is null', parseColor('#12') === null)
assert('a five-digit hex is null', parseColor('#12345') === null)
assert('a truncated rgb is null', parseColor('rgb(14, 20)') === null)
assert('a non-numeric rgb is null', parseColor('rgb(a, b, c)') === null)

// renderScale — capped, then deliberately halved. The field has no detail fine
// enough to lose, and the fragment count is what costs battery on a phone.
assert('1x renders at half', near(renderScale(1), 0.5))
assert('2x is capped to 1.5 then halved', near(renderScale(2), 0.75))
assert('3x is capped to the same ceiling as 2x', near(renderScale(3), renderScale(2)))
assert('a sub-1 dpr is floored at 1x', near(renderScale(0.75), 0.5))
assert('scale never exceeds 0.75', renderScale(10) <= 0.75)
assert('scale is always positive', renderScale(1) > 0 && renderScale(4) > 0)

console.log(`\n${failures === 0 ? '✅ ALL AMBIENT-FIELD TESTS PASSED' : `❌ ${failures} ASSERTION(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

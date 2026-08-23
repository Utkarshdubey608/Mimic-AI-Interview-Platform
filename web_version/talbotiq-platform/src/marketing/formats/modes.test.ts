/**
 * The showcase's panel list. Pure — no DOM, no React.
 *   npx tsx src/marketing/formats/modes.test.ts
 *
 * MODES is derived from two places that can drift apart: TRACKS supplies the
 * copy, HREF supplies the destination. A seventh format added to TRACKS with no
 * HREF entry renders a panel whose button goes to `undefined` — a broken link no
 * route test can see, because that link exists only here.
 */
import { MODES, noFilmReason } from './modes'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ', ' + extra : ''}`)
  if (!cond) failures++
}

assert('six modes', MODES.length === 6, `got ${MODES.length}`)

const missing = MODES.filter((m) => !m.href)
assert('every mode resolves to a platform page', missing.length === 0, missing.map((m) => m.name).join(', '))
assert('every href is a platform route', MODES.every((m) => m.href?.startsWith('/platform/')))
assert('hrefs are unique', new Set(MODES.map((m) => m.href)).size === MODES.length)
assert('names are unique', new Set(MODES.map((m) => m.name)).size === MODES.length)
assert('every mode has a description', MODES.every((m) => m.desc.length > 40))
assert('every mode has meta', MODES.every((m) => m.meta.length > 0))

for (const m of MODES.filter((x) => x.video)) {
  assert(`${m.name} footage has alt text`, m.video!.alt.length > 60)
  assert(`${m.name} footage has a caption`, m.video!.caption.length > 20)
  assert(`${m.name} footage is a webm path`, m.video!.src.endsWith('.webm'))
}
for (const m of MODES.filter((x) => !x.video)) {
  assert(`${m.name} explains why there is no footage`, noFilmReason(m.href).length > 40)
}

const twoWay = MODES.find((m) => m.href.includes('live-two-way'))
assert('live two-way carries no footage', twoWay?.video === null)

console.log(failures === 0 ? '\n✅ ALL FORMAT MODE TESTS PASSED' : `\n❌ ${failures} FORMAT MODE TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

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

/* The order is a decision, so it is worth a test: it is the one property of this
   list a refactor can quietly reverse. */
assert('the deck opens on video and ends on the live call',
  MODES.map((m) => m.name).join(' | ')
  === 'AI video avatar | Voice screening | Assessments | Conversational chat | Timed Q&A | Live two-way call',
  MODES.map((m) => m.name).join(' | '))

/* Two-way's footage is the file named after the avatar, because that file IS the
   live call — see TRIMMED in modes.ts. Pinned here so that nobody "corrects" the
   path back to a mode-two_way.webm that does not exist, and so that the head of
   the file, which is the candidate's face check, stays skipped. */
const twoWay = MODES.find((m) => m.href.includes('live-two-way'))
assert('live two-way carries footage', !!twoWay?.video)
assert('and it is the file the live call is actually in',
  twoWay?.video?.src === '/mimic-shots/mode-video_avatar.webm', twoWay?.video?.src)
assert('and it starts after the face check', (twoWay?.video?.startAt ?? 0) >= 3,
  String(twoWay?.video?.startAt))
assert('every startAt is inside the file', MODES.every((m) => (m.video?.startAt ?? 0) < 27))

const mcq = MODES.find((m) => m.href.includes('assessments'))
assert('assessments has its recording now', !!mcq?.video)
assert('and it is its own file', mcq?.video?.src === '/mimic-shots/mode-mcq.webm', mcq?.video?.src)
assert('every one of the six has footage', MODES.every((m) => !!m.video),
  MODES.filter((m) => !m.video).map((m) => m.name).join(', '))

console.log(failures === 0 ? '\n✅ ALL FORMAT MODE TESTS PASSED' : `\n❌ ${failures} FORMAT MODE TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

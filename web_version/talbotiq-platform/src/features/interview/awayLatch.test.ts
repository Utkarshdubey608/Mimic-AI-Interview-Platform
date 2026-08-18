/**
 * Cross-engine away detection. Run with:
 *   npx tsx src/features/interview/awayLatch.test.ts
 */
import { initialLatch, nextLatch, type AwaySignal, type LatchState } from './awayLatch'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}

/** Replays a sequence and returns how many reports it produced. */
function reports(seq: [AwaySignal, boolean][]): number {
  let state: LatchState = initialLatch
  let n = 0
  for (const [signal, hasFocus] of seq) {
    const r = nextLatch(state, signal, hasFocus)
    state = r.state
    if (r.report) n++
  }
  return n
}

console.log('\n=== each engine reports a switch, once ===')
assert('Chrome: visibilitychange alone', reports([['hidden', false]]) === 1)
assert('Safari to another app: blur alone', reports([['blur', false]]) === 1)
assert('bfcache / navigation away: pagehide', reports([['pagehide', false]]) === 1)

console.log('\n=== Chrome fires BOTH — that is one switch, not two ===')
assert('blur + hidden together', reports([['blur', false], ['hidden', false]]) === 1)
assert('hidden + blur, other order', reports([['hidden', false], ['blur', false]]) === 1)
assert(
  'and all three at once',
  reports([['blur', false], ['hidden', false], ['pagehide', false]]) === 1,
)

console.log('\n=== leaving twice is two switches ===')
assert(
  'away, back, away',
  reports([['hidden', false], ['visible', false], ['hidden', false]]) === 2,
)
assert(
  'focus also ends an away period',
  reports([['blur', false], ['focus', true], ['blur', false]]) === 2,
)

console.log('\n=== clicking the video iframe is NOT leaving ===')
// The avatar, two-way and voice modes embed the call. Blur fires; the document
// keeps focus. Flagging this would punish a candidate for using the interview.
assert('blur while the document keeps focus', reports([['blur', true]]) === 0)
assert(
  'and it does not latch, so a real switch after it still counts',
  reports([['blur', true], ['hidden', false]]) === 1,
)
assert(
  'repeated iframe clicks stay silent',
  reports([['blur', true], ['blur', true], ['blur', true]]) === 0,
)

console.log('\n=== returning without having left is harmless ===')
assert('focus first', reports([['focus', true]]) === 0)
assert('visible first', reports([['visible', true]]) === 0)

console.log(failures === 0 ? '\nAll away-latch assertions passed\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)

/**
 * Every state a candidate can land in has copy that names the problem and the fix.
 * Run with:  npx tsx src/features/interview/systemcheck/guidance.test.ts
 */
import { guidanceFor, type CheckState } from './guidance'
import type { BrowserFamily } from './capabilities'
import type { CheckId } from './requirements'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}

const IDS: CheckId[] = ['browser', 'mic', 'camera', 'speaker', 'connectivity']
const STATES: CheckState[] = ['unsupported', 'not-asked', 'requesting', 'listening', 'denied', 'granted-no-signal', 'passed']
const FAMILIES: BrowserFamily[] = ['chrome', 'edge', 'firefox', 'safari', 'samsung', 'unknown']

console.log('\n=== no state is ever left without copy ===')
for (const id of IDS) {
  for (const state of STATES) {
    const g = guidanceFor(id, state, 'chrome', false)
    assert(`${id}/${state} has a title`, g.title.trim().length > 0)
    assert(`${id}/${state} has detail`, g.detail.trim().length > 0)
  }
}

console.log('\n=== denied tells them how to un-block, per browser ===')
for (const family of FAMILIES) {
  const g = guidanceFor('mic', 'denied', family, false)
  assert(`${family} denial has steps`, g.steps.length > 0)
}

console.log('\n=== a webview is called out before anything else ===')
const wv = guidanceFor('mic', 'denied', 'chrome', true)
assert('webview guidance mentions opening in a browser', /browser/i.test(wv.detail))
assert('webview guidance has steps', wv.steps.length > 0)

console.log('\n=== granted-but-no-signal is NOT the same message as denied ===')
const denied = guidanceFor('mic', 'denied', 'chrome', false)
const noSignal = guidanceFor('mic', 'granted-no-signal', 'chrome', false)
assert('the two differ', denied.title !== noSignal.title)
assert("no-signal says we cannot hear", /hear/i.test(noSignal.title + noSignal.detail))
const camNoSignal = guidanceFor('camera', 'granted-no-signal', 'chrome', false)
assert("camera no-signal says we cannot see", /see/i.test(camNoSignal.title + camNoSignal.detail))
assert('no-signal offers fixes', noSignal.steps.length > 0)

console.log('\n=== listening is neither of those two ===')
const listening = guidanceFor('mic', 'listening', 'chrome', false)
assert('listening does not claim to be waiting for permission', !/permission/i.test(listening.title + listening.detail))
assert('listening does not accuse them of being inaudible', !/can.?t hear/i.test(listening.title + listening.detail))
assert('listening asks them to speak', /say something|speak|out loud/i.test(listening.title + listening.detail))

console.log('\n=== unsupported names a browser to switch to ===')
const un = guidanceFor('mic', 'unsupported', 'unknown', false)
assert('suggests Chrome/Edge/Safari', /chrome|edge|safari/i.test(un.detail + un.steps.join(' ')))

console.log(failures === 0 ? '\nAll guidance assertions passed\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)

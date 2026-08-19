/**
 * The physics the candidate surface's gestures are built on. Run with:
 *   npx tsx src/features/interview/motion/physics.test.ts
 */
import { nearestSnap, project, rubberband, velocityFrom, withRubberband } from './physics'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}
function near(label: string, actual: number, expected: number, tol = 0.5) {
  const ok = Math.abs(actual - expected) <= tol
  assert(label, ok, ok ? '' : `got ${actual.toFixed(2)}, want ~${expected}`)
}

console.log('\n=== project: exponential decay, not the textbook formula ===')
assert('no velocity, no travel', project(0) === 0)
// v/1000 * d/(1-d) with d=0.998 → v * 0.499
near('1000 px/s projects ~499px', project(1000), 499)
near('direction is preserved', project(-1000), -499)
assert('a faster flick travels further', project(2000) > project(1000))
// The textbook v²/(2·decel) form would be quadratic; this must stay linear in v.
near('linear in velocity, not quadratic', project(2000), 2 * project(1000), 0.01)
assert('a snappier rate travels less', Math.abs(project(1000, 0.99)) < Math.abs(project(1000, 0.998)))

console.log('\n=== rubberband: progressive resistance, never a hard stop ===')
assert('no overshoot, no resistance', rubberband(0, 400) === 0)
assert('some overshoot always moves something', rubberband(10, 400) > 0)
assert('but always less than the overshoot itself', rubberband(100, 400) < 100)
assert(
  'resistance grows: doubling the pull gives less than double the travel',
  rubberband(200, 400) < 2 * rubberband(100, 400),
)
assert('it is asymptotic, never unbounded', rubberband(100000, 400) < 400)
assert('a zero dimension cannot divide by zero', rubberband(50, 0) === 0)

console.log('\n=== withRubberband: free inside bounds, resisted outside ===')
assert('inside the bounds it is 1:1', withRubberband(50, 0, 100, 400) === 50)
assert('at the bound exactly, untouched', withRubberband(100, 0, 100, 400) === 100)
assert('past the top it exceeds but resists', withRubberband(200, 0, 100, 400) > 100 && withRubberband(200, 0, 100, 400) < 200)
assert('below the bottom, likewise', withRubberband(-100, 0, 100, 400) < 0 && withRubberband(-100, 0, 100, 400) > -100)

console.log('\n=== nearestSnap: chosen from the PROJECTION ===')
assert('nearest wins', nearestSnap(80, [0, 100]) === 100)
assert('and on the other side', nearestSnap(20, [0, 100]) === 0)
assert('no snap points is a no-op', nearestSnap(42, []) === 42)
// The point of the whole exercise: a slow drag that ends low still lands high
// if it was thrown hard, because the projection, not the position, decides.
const released = 30
const thrown = released + project(400)
assert('a hard flick from a low point still lands high', nearestSnap(thrown, [0, 100]) === 100)
const nudged = released + project(20)
assert('a gentle nudge from the same point falls back', nearestSnap(nudged, [0, 100]) === 0)

console.log('\n=== velocityFrom: a history, not the last two points ===')
assert('one sample cannot have velocity', velocityFrom([{ value: 0, time: 0 }]) === 0)
assert('no samples either', velocityFrom([]) === 0)
near(
  '100px over 100ms is 1000px/s',
  velocityFrom([{ value: 0, time: 0 }, { value: 100, time: 100 }]),
  1000,
)
assert(
  'a zero time delta cannot divide by zero',
  velocityFrom([{ value: 0, time: 5 }, { value: 100, time: 5 }]) === 0,
)
// Noise on the final pair must not dominate the handoff.
const noisy = [
  { value: 0, time: 0 }, { value: 25, time: 25 }, { value: 50, time: 50 },
  { value: 75, time: 75 }, { value: 99, time: 100 },
]
near('a steady drag reads steady despite jitter', velocityFrom(noisy), 990, 20)
// Samples older than the window are excluded, so a pause before release reads
// as a stop rather than inheriting speed from before the pause.
const paused = [
  { value: 0, time: 0 }, { value: 500, time: 50 },
  { value: 502, time: 400 }, { value: 503, time: 450 },
]
assert('a pause before release kills the throw', Math.abs(velocityFrom(paused)) < 100)

console.log(failures === 0 ? '\nAll physics assertions passed\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)

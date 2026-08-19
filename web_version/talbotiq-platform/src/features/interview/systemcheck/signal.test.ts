/**
 * The rules that decide whether we actually heard and saw the candidate.
 * Run with:  npx tsx src/features/interview/systemcheck/signal.test.ts
 */
import {
  CAMERA, FACE, MIC, cameraVerdict, faceVerdict, lumaDelta, micVerdict, rmsOf, toDbfs,
} from './signal'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}

console.log('\n=== RMS and dBFS ===')
assert('silence is zero RMS', rmsOf(new Float32Array(128)) === 0)
assert('silence is -Infinity dBFS', toDbfs(0) === -Infinity)
assert('full scale is 0 dBFS', Math.abs(toDbfs(1)) < 1e-9)
const half = new Float32Array(128).fill(0.5)
assert('constant 0.5 → RMS 0.5', Math.abs(rmsOf(half) - 0.5) < 1e-9)
assert('0.5 is about -6 dBFS', Math.abs(toDbfs(0.5) + 6.02) < 0.05)
assert('the floor is -50 dBFS', MIC.floorDbfs === -50)

console.log('\n=== mic: passes only on repeated real energy ===')
const t0 = 1_000_000
assert('nothing yet → listening', micVerdict([], t0, t0 + 500) === 'listening')
assert('one loud frame is not enough', micVerdict([t0 + 100], t0, t0 + 200) === 'listening')
assert(
  `${MIC.framesToPass} frames in the window → passed`,
  micVerdict([t0, t0 + 10, t0 + 20, t0 + 30, t0 + 40], t0, t0 + 50) === 'passed',
)
assert(
  'frames older than the window do not count',
  micVerdict([t0, t0 + 1, t0 + 2, t0 + 3, t0 + 4], t0, t0 + MIC.windowMs + 5_000) === 'listening',
)
assert(
  'silence past the timeout → no-signal',
  micVerdict([], t0, t0 + MIC.silenceFailMs + 1) === 'no-signal',
)
assert(
  'a candidate still trying is never failed',
  micVerdict([t0 + 7_000], t0, t0 + MIC.silenceFailMs + 1) === 'listening',
)

console.log('\n=== camera: temporal variance, not brightness ===')
const identical = new Uint8ClampedArray(32 * 32 * 4).fill(120)
assert('identical frames → zero delta', lumaDelta(identical, identical) === 0)
const black = new Uint8ClampedArray(32 * 32 * 4) // all zeroes
assert('two black frames → zero delta', lumaDelta(black, black) === 0)
const noisy = new Uint8ClampedArray(32 * 32 * 4)
for (let i = 0; i < noisy.length; i += 4) {
  const v = 120 + (i % 8) - 4
  noisy[i] = v; noisy[i + 1] = v; noisy[i + 2] = v; noisy[i + 3] = 255
}
assert('sensor-like noise clears the floor', lumaDelta(identical, noisy) > CAMERA.deltaFloor)
// A dim room must PASS: low absolute brightness, but the frames still differ.
const dim = new Uint8ClampedArray(32 * 32 * 4)
const dimMoved = new Uint8ClampedArray(32 * 32 * 4)
for (let i = 0; i < dim.length; i += 4) {
  dim[i] = 12; dim[i + 1] = 12; dim[i + 2] = 12; dim[i + 3] = 255
  dimMoved[i] = 14; dimMoved[i + 1] = 14; dimMoved[i + 2] = 14; dimMoved[i + 3] = 255
}
assert('a DIM but live frame pair clears the floor', lumaDelta(dim, dimMoved) > CAMERA.deltaFloor)

const c0 = 2_000_000
assert('no samples yet → sampling', cameraVerdict([], c0, c0 + 100) === 'sampling')
assert('one good pair is not enough', cameraVerdict([5], c0, c0 + 300) === 'sampling')
assert(
  `${CAMERA.samplePairs} live pairs → passed`,
  cameraVerdict([5, 6, 7], c0, c0 + 800) === 'passed',
)
assert(
  'a frozen feed fails after the timeout',
  cameraVerdict([0, 0, 0, 0], c0, c0 + CAMERA.timeoutMs + 1) === 'frozen',
)
assert(
  'no frames at all fails after the timeout',
  cameraVerdict([], c0, c0 + CAMERA.timeoutMs + 1) === 'frozen',
)

console.log('\n=== face presence: a person is there, not who they are ===')
const f0 = 3_000_000
assert('nothing yet', faceVerdict([], f0, f0 + 100) === 'searching')
assert('one detection is not enough', faceVerdict([1], f0, f0 + 200) === 'searching')
assert(`${FACE.detectionsToPass} in a row passes`, faceVerdict([1, 1, 1], f0, f0 + 900) === 'passed')
assert('a flicker to zero breaks the run', faceVerdict([1, 0, 1], f0, f0 + 900) === 'searching')
assert(
  'nobody there by the timeout',
  faceVerdict([0, 0, 0, 0], f0, f0 + FACE.timeoutMs + 1) === 'absent',
)
assert(
  'a room full of people is a DIFFERENT problem',
  faceVerdict([2, 2, 3, 2], f0, f0 + FACE.timeoutMs + 1) === 'crowded',
)
assert(
  'someone who arrives late still passes',
  faceVerdict([0, 0, 1, 1, 1], f0, f0 + 4_000) === 'passed',
)

console.log(failures === 0 ? '\nAll signal assertions passed\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)

# Pre-Interview System Check — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No candidate reaches an interview question with a microphone we never heard or a camera we never saw — a mode-driven System Check verifies live signal (not permission grants) and gates the Start button on it.

**Architecture:** Pure decision logic in four testable modules (`requirements`, `capabilities`, `signal`, `guidance`), one hook per device owning its stream lifecycle, one composing hook that derives the gate, and one screen. The pure cores follow the established `src/lib/apiOrigin.ts` pattern — logic exported for tests, so pass/fail rules are provable without a DOM. Replaces `screens/SystemCheck.tsx` and `screens/VideoSystemCheck.tsx`.

**Tech Stack:** Vite + React 18 + TypeScript, Web Audio (`AnalyserNode`, `OscillatorNode`), `MediaDevices`, `RTCPeerConnection`, Canvas 2D, Tailwind, `lucide-react`, `framer-motion`. Tests: standalone `*.test.ts` run by `tsx` (repo convention — there is **no** vitest/jest), plus Playwright as a new devDependency for browser-level verification.

**Spec:** `docs/superpowers/specs/2026-08-18-system-check-design.md`

## Global Constraints

- **Branch first.** All work on `feature/system-check` cut from `development`. Never commit to `development` directly.
- **Zero backend changes.** No new endpoints, no contract changes. The only network calls are a public STUN probe and `GET {apiBase}/health`. `/api/*` is the frozen Flutter contract shared with mobile and desktop — do not touch it, `/api/web/*`, auth, or interview logic (`useInterviewClock`, `QuestionStage`, the conversational engines).
- **Props contract preserved:** `SystemCheckScreen` takes exactly `{ branding: BrandingConfig, track: TrackType, busy?: boolean, onBegin: () => void }` and calls `onBegin` only when every required check has passed. `TakeInterviewPage` keeps deciding what starting *means*.
- **Never pass on permission alone.** A check passes on measured signal, or (speaker only) explicit candidate confirmation.
- **Thresholds, verbatim:** mic floor `-50` dBFS, `5` qualifying frames, `10_000` ms window, `8_000` ms silence timeout. Camera delta floor `0.6`, `3` sample pairs, `8_000` ms timeout, sample rate `250` ms, canvas `32×32`. Connectivity `5_000` ms ICE timeout.
- **Six tracks, exhaustive:** `'chat' | 'chatbot' | 'video_avatar' | 'voice' | 'video' | 'two_way'`. Use `Record<TrackType, …>` so a seventh track is a compile error.
- **Quality gates per task:** `npm run build` (tsc + vite build) and `npm test` both pass before each commit.
- **Streams must be stopped** on unmount, on device change, and on re-test. No camera light left on.

---

## File Structure

**New — all under `src/features/interview/systemcheck/`**

| File | Responsibility |
|---|---|
| `requirements.ts` | Pure. `TrackType` → which checks that mode requires. |
| `capabilities.ts` | Pure. What this browser supports, which browser it is, is it a webview. |
| `signal.ts` | Pure. RMS/dBFS maths and the mic + camera pass/fail verdicts. |
| `guidance.ts` | Pure. (check, state, browser) → the sentence the candidate reads. |
| `useMicCheck.ts` | Mic stream, `AnalyserNode`, live level, verdict. |
| `useCameraCheck.ts` | Camera stream, preview element, frame-liveness sampling. |
| `useSpeakerCheck.ts` | Test tone + candidate confirmation. |
| `useConnectivityCheck.ts` | ICE gathering + `/health` reachability. |
| `useSystemCheck.ts` | Composes checks against requirements; derives `canStart`. |
| `SystemCheckScreen.tsx` | The UI. |
| `LevelMeter.tsx` | Mic level bar. |
| `DevicePicker.tsx` | Labelled device `<select>` + re-test. |
| `*.test.ts` | One per pure module (4 test files). |

**Modified**
- `src/features/interview/TakeInterviewPage.tsx` — import and render `SystemCheckScreen`.
- `package.json` — add `@playwright/test` devDependency + `test:e2e` script.

**Deleted**
- `src/features/interview/screens/SystemCheck.tsx`
- `src/features/interview/screens/VideoSystemCheck.tsx`

**Retained:** `src/features/interview/screens/VideoIntro.tsx` — content, not a check. `SystemCheckScreen` renders it for the `video` track after checks pass.

---

### Task 0: Branch

- [ ] **Step 1: Cut the branch**

```bash
cd web_version/talbotiq-platform
git checkout development
git checkout -b feature/system-check
```

- [ ] **Step 2: Confirm a clean baseline**

Run: `npm test`
Expected: `✅ All test files passed`

---

### Task 1: Per-mode requirements

**Files:**
- Create: `src/features/interview/systemcheck/requirements.ts`
- Test: `src/features/interview/systemcheck/requirements.test.ts`

**Interfaces:**
- Consumes: `TrackType` from `@shared/types`.
- Produces: `type CheckId = 'browser' | 'mic' | 'camera' | 'speaker' | 'connectivity'`; `requirementsFor(track: TrackType): CheckId[]`; `requires(track: TrackType, id: CheckId): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Which checks each mode demands. Run with:
 *   npx tsx src/features/interview/systemcheck/requirements.test.ts
 */
import { requirementsFor, requires, type CheckId } from './requirements'
import type { TrackType } from '@shared/types'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}
function same(label: string, actual: CheckId[], expected: CheckId[]) {
  const a = [...actual].sort().join(',')
  const b = [...expected].sort().join(',')
  assert(label, a === b, a === b ? '' : `got [${a}], want [${b}]`)
}

const EXPECTED: Record<TrackType, CheckId[]> = {
  chat:         ['browser'],
  chatbot:      ['browser'],
  voice:        ['browser', 'mic', 'speaker'],
  video_avatar: ['browser', 'mic', 'camera', 'speaker'],
  video:        ['browser', 'mic', 'camera'],
  two_way:      ['browser', 'mic', 'camera', 'speaker', 'connectivity'],
}

console.log('\n=== every track has an explicit requirement list ===')
for (const track of Object.keys(EXPECTED) as TrackType[]) {
  same(track, requirementsFor(track), EXPECTED[track])
}

console.log('\n=== typed modes never demand hardware ===')
for (const track of ['chat', 'chatbot'] as TrackType[]) {
  assert(`${track} needs no mic`, !requires(track, 'mic'))
  assert(`${track} needs no camera`, !requires(track, 'camera'))
}

console.log('\n=== browser support is required everywhere ===')
for (const track of Object.keys(EXPECTED) as TrackType[]) {
  assert(`${track} requires browser`, requires(track, 'browser'))
}

console.log('\n=== only two-way probes connectivity ===')
assert('two_way probes', requires('two_way', 'connectivity'))
assert('video_avatar does not', !requires('video_avatar', 'connectivity'))

console.log(failures === 0 ? '\nAll requirement assertions passed\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/tsx/dist/cli.mjs src/features/interview/systemcheck/requirements.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `./requirements`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * What each interview mode actually needs verified before it may start.
 *
 * A table, not a chain of `||` comparisons. The bug this feature exists to kill
 * came from a predicate that enumerated five of six tracks and quietly omitted
 * the sixth; `Record<TrackType, …>` makes that a compile error instead.
 *
 * Typed modes ask for nothing hardware-critical: the timed question stage does
 * not use `useFacialCapture` (only VideoStage and the avatar-screening page do),
 * so there is no hidden proctoring dependency on `chat`.
 */
import type { TrackType } from '@shared/types'

export type CheckId = 'browser' | 'mic' | 'camera' | 'speaker' | 'connectivity'

const BY_TRACK: Record<TrackType, CheckId[]> = {
  chat:         ['browser'],
  chatbot:      ['browser'],
  // Spoken: the candidate must hear the interviewer, so output is confirmed too.
  voice:        ['browser', 'mic', 'speaker'],
  video_avatar: ['browser', 'mic', 'camera', 'speaker'],
  // Recorded answers — questions are on screen, so no speaker requirement.
  video:        ['browser', 'mic', 'camera'],
  // A live call fails in ways device access cannot predict; hence connectivity.
  two_way:      ['browser', 'mic', 'camera', 'speaker', 'connectivity'],
}

export function requirementsFor(track: TrackType): CheckId[] {
  return BY_TRACK[track] ?? ['browser']
}

export function requires(track: TrackType, id: CheckId): boolean {
  return requirementsFor(track).includes(id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/tsx/dist/cli.mjs src/features/interview/systemcheck/requirements.test.ts`
Expected: PASS — `All requirement assertions passed`

- [ ] **Step 5: Commit**

```bash
git add src/features/interview/systemcheck/requirements.ts src/features/interview/systemcheck/requirements.test.ts
git commit -m "feat(systemcheck): per-mode requirement table"
```

---

### Task 2: Browser capability + webview detection

**Files:**
- Create: `src/features/interview/systemcheck/capabilities.ts`
- Test: `src/features/interview/systemcheck/capabilities.test.ts`

**Interfaces:**
- Produces: `type BrowserFamily = 'chrome' | 'edge' | 'firefox' | 'safari' | 'samsung' | 'unknown'`; `interface Environment { userAgent: string; secureContext: boolean; hasGetUserMedia: boolean; hasAudioContext: boolean; hasRTCPeerConnection: boolean; hasMediaRecorder: boolean }`; `interface Capabilities { family: BrowserFamily; isWebview: boolean; secureContext: boolean; canCaptureMedia: boolean; canAnalyseAudio: boolean; canUseWebRTC: boolean; canRecord: boolean }`; `detect(env: Environment): Capabilities`; `readEnvironment(): Environment`; `missingFor(caps: Capabilities, ids: CheckId[]): CheckId[]`.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Browser classification and capability detection. Pure — a synthetic
 * Environment goes in, a Capabilities record comes out. Run with:
 *   npx tsx src/features/interview/systemcheck/capabilities.test.ts
 */
import { detect, missingFor, type Environment } from './capabilities'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}

const FULL: Environment = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  secureContext: true,
  hasGetUserMedia: true,
  hasAudioContext: true,
  hasRTCPeerConnection: true,
  hasMediaRecorder: true,
}
const env = (o: Partial<Environment>): Environment => ({ ...FULL, ...o })

console.log('\n=== browser family ===')
const FAMILIES: [string, string][] = [
  ['Chrome/131.0.0.0 Safari/537.36', 'chrome'],
  ['Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', 'edge'],
  ['Gecko/20100101 Firefox/133.0', 'firefox'],
  ['Version/17.6 Safari/605.1.15', 'safari'],
  ['SamsungBrowser/23.0 Chrome/115.0.0.0 Safari/537.36', 'samsung'],
  ['SomeUnknownAgent/1.0', 'unknown'],
]
for (const [ua, want] of FAMILIES) {
  const got = detect(env({ userAgent: ua })).family
  assert(`${want} from "${ua.slice(0, 28)}…"`, got === want, got === want ? '' : `got ${got}`)
}

console.log('\n=== in-app webviews are the big real-world failure ===')
const WEBVIEWS = [
  'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/450.0]',
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Instagram 300.0',
  'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Chrome/131.0.0.0',
  'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Slack/24.1',
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 LinkedInApp/1.0',
]
for (const ua of WEBVIEWS) {
  assert(`webview: ${ua.slice(28, 60)}…`, detect(env({ userAgent: ua })).isWebview)
}
assert('a real Chrome is not a webview', !detect(FULL).isWebview)
assert('a real Safari is not a webview', !detect(env({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6) AppleWebKit/605.1.15 Version/17.6 Mobile/15E148 Safari/604.1',
})).isWebview)

console.log('\n=== capability flags follow the environment ===')
assert('no getUserMedia → cannot capture', !detect(env({ hasGetUserMedia: false })).canCaptureMedia)
assert('insecure context → cannot capture', !detect(env({ secureContext: false })).canCaptureMedia)
assert('no AudioContext → cannot analyse', !detect(env({ hasAudioContext: false })).canAnalyseAudio)
assert('no RTCPeerConnection → no WebRTC', !detect(env({ hasRTCPeerConnection: false })).canUseWebRTC)
assert('no MediaRecorder → cannot record', !detect(env({ hasMediaRecorder: false })).canRecord)
assert('full environment is fully capable', detect(FULL).canCaptureMedia && detect(FULL).canRecord)

console.log('\n=== missingFor names the blocked checks ===')
const noMedia = detect(env({ hasGetUserMedia: false }))
assert('mic blocked without capture', missingFor(noMedia, ['mic']).includes('mic'))
assert('camera blocked without capture', missingFor(noMedia, ['camera']).includes('camera'))
assert('browser check itself never "missing"', !missingFor(noMedia, ['browser']).includes('browser'))
assert('nothing missing on a full environment', missingFor(detect(FULL), ['mic', 'camera', 'speaker', 'connectivity']).length === 0)

console.log(failures === 0 ? '\nAll capability assertions passed\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/tsx/dist/cli.mjs src/features/interview/systemcheck/capabilities.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `./capabilities`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * What this browser can do, and what it is.
 *
 * Written against an injected `Environment` rather than reading globals, so every
 * branch is testable from a user-agent string — the alternative is discovering a
 * detection bug from a candidate who could not start their interview.
 */
import type { CheckId } from './requirements'

export type BrowserFamily = 'chrome' | 'edge' | 'firefox' | 'safari' | 'samsung' | 'unknown'

export interface Environment {
  userAgent: string
  secureContext: boolean
  hasGetUserMedia: boolean
  hasAudioContext: boolean
  hasRTCPeerConnection: boolean
  hasMediaRecorder: boolean
}

export interface Capabilities {
  family: BrowserFamily
  isWebview: boolean
  secureContext: boolean
  canCaptureMedia: boolean
  canAnalyseAudio: boolean
  canUseWebRTC: boolean
  canRecord: boolean
}

/**
 * In-app browser markers. This is the single highest-yield detection here: a large
 * share of "permission denied" reports are candidates opening the invite inside
 * Gmail, Slack, LinkedIn or Instagram, whose embedded browsers block media without
 * a meaningful prompt. Order matters only for readability; any match is enough.
 */
const WEBVIEW_MARKERS: RegExp[] = [
  /FBAN|FBAV|FB_IAB/i,     // Facebook / Messenger
  /Instagram/i,
  /LinkedInApp/i,
  /\bSlack\//i,
  /WhatsApp/i,
  /\bLine\//i,
  /\bTwitter|TwitterAndroid/i,
  /GSA\//i,                // Google Search App
  /;\s*wv[;)]/i,           // Android System WebView
]

function familyOf(ua: string): BrowserFamily {
  if (/SamsungBrowser\//i.test(ua)) return 'samsung'
  if (/\bEdg(?:e|A|iOS)?\//i.test(ua)) return 'edge'
  if (/Firefox\/|FxiOS\//i.test(ua)) return 'firefox'
  if (/Chrome\/|CriOS\//i.test(ua)) return 'chrome'
  // Safari only after Chrome/Edge: every Chromium UA also contains "Safari".
  if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return 'safari'
  return 'unknown'
}

export function detect(env: Environment): Capabilities {
  const ua = env.userAgent || ''
  // Media capture needs BOTH the API and a secure context — Chrome hides
  // mediaDevices entirely on plain http, which surfaces as a confusing
  // "unsupported browser" unless the two are reported together.
  const canCaptureMedia = env.hasGetUserMedia && env.secureContext
  return {
    family: familyOf(ua),
    isWebview: WEBVIEW_MARKERS.some((re) => re.test(ua)),
    secureContext: env.secureContext,
    canCaptureMedia,
    canAnalyseAudio: canCaptureMedia && env.hasAudioContext,
    canUseWebRTC: env.hasRTCPeerConnection,
    canRecord: canCaptureMedia && env.hasMediaRecorder,
  }
}

/** Reads the real browser. The only impure function in this module. */
export function readEnvironment(): Environment {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const win = typeof window === 'undefined' ? undefined : window
  return {
    userAgent: nav?.userAgent ?? '',
    secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : false,
    hasGetUserMedia: typeof nav?.mediaDevices?.getUserMedia === 'function',
    hasAudioContext: !!(win && ('AudioContext' in win || 'webkitAudioContext' in win)),
    hasRTCPeerConnection: !!(win && 'RTCPeerConnection' in win),
    hasMediaRecorder: !!(win && 'MediaRecorder' in win),
  }
}

/** Which of the required checks this browser cannot even attempt. */
export function missingFor(caps: Capabilities, ids: CheckId[]): CheckId[] {
  return ids.filter((id) => {
    if (id === 'mic') return !caps.canAnalyseAudio
    if (id === 'camera') return !caps.canCaptureMedia
    if (id === 'speaker') return !caps.canAnalyseAudio
    if (id === 'connectivity') return !caps.canUseWebRTC
    return false // 'browser' is the report, never the casualty
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/tsx/dist/cli.mjs src/features/interview/systemcheck/capabilities.test.ts`
Expected: PASS — `All capability assertions passed`

- [ ] **Step 5: Commit**

```bash
git add src/features/interview/systemcheck/capabilities.ts src/features/interview/systemcheck/capabilities.test.ts
git commit -m "feat(systemcheck): browser capability and in-app webview detection"
```

---

### Task 3: Signal verdicts — the core rules

**Files:**
- Create: `src/features/interview/systemcheck/signal.ts`
- Test: `src/features/interview/systemcheck/signal.test.ts`

**Interfaces:**
- Produces: `MIC` and `CAMERA` threshold constants; `rmsOf(buffer: Float32Array): number`; `toDbfs(rms: number): number`; `type MicVerdict = 'listening' | 'passed' | 'no-signal'`; `micVerdict(qualifyingAt: number[], startedAt: number, now: number): MicVerdict`; `lumaDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number`; `type CameraVerdict = 'sampling' | 'passed' | 'frozen'`; `cameraVerdict(deltas: number[], startedAt: number, now: number): CameraVerdict`.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * The rules that decide whether we actually heard and saw the candidate.
 * Run with:  npx tsx src/features/interview/systemcheck/signal.test.ts
 */
import {
  CAMERA, MIC, cameraVerdict, lumaDelta, micVerdict, rmsOf, toDbfs,
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

console.log(failures === 0 ? '\nAll signal assertions passed\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/tsx/dist/cli.mjs src/features/interview/systemcheck/signal.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `./signal`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * The rules that decide whether we actually heard and saw the candidate.
 *
 * Pure on purpose. These thresholds are the whole feature — a permission grant
 * proves nothing, and getting these numbers wrong either lets a broken device
 * through or blocks a working one. Both failures are expensive on a hiring
 * surface, so they are pinned by tests rather than tuned in a component.
 */

export const MIC = {
  /** Below this is room tone, not a voice. */
  floorDbfs: -50,
  /** Several frames, so a chair creak or a single click cannot pass the check. */
  framesToPass: 5,
  /** Qualifying frames only count if they are recent. */
  windowMs: 10_000,
  /** Total silence for this long is a real failure, not impatience. */
  silenceFailMs: 8_000,
} as const

export const CAMERA = {
  /**
   * Just above zero, deliberately. The question is "did these two frames differ
   * at all", not "is the picture bright". A real sensor always produces noise;
   * a frozen, disconnected or synthetic-black feed produces identical bytes.
   * A brightness threshold would fail a candidate sitting in a dim room.
   */
  deltaFloor: 0.6,
  samplePairs: 3,
  timeoutMs: 8_000,
  sampleEveryMs: 250,
  canvasSize: 32,
} as const

export function rmsOf(buffer: Float32Array): number {
  if (buffer.length === 0) return 0
  let sum = 0
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
  return Math.sqrt(sum / buffer.length)
}

export function toDbfs(rms: number): number {
  return rms <= 0 ? -Infinity : 20 * Math.log10(rms)
}

export type MicVerdict = 'listening' | 'passed' | 'no-signal'

/**
 * `qualifyingAt` holds the timestamps of frames whose level cleared the floor.
 * Note the failure rule: a candidate who has produced ANY signal is never failed
 * on the timeout — they are mid-sentence, not broken.
 */
export function micVerdict(qualifyingAt: number[], startedAt: number, now: number): MicVerdict {
  const recent = qualifyingAt.filter((t) => now - t <= MIC.windowMs)
  if (recent.length >= MIC.framesToPass) return 'passed'
  if (qualifyingAt.length === 0 && now - startedAt >= MIC.silenceFailMs) return 'no-signal'
  return 'listening'
}

/** Mean absolute luma difference between two RGBA frames of equal size. */
export function lumaDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let sum = 0
  let pixels = 0
  for (let i = 0; i < n; i += 4) {
    const la = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]
    const lb = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]
    sum += Math.abs(la - lb)
    pixels++
  }
  return pixels === 0 ? 0 : sum / pixels
}

export type CameraVerdict = 'sampling' | 'passed' | 'frozen'

export function cameraVerdict(deltas: number[], startedAt: number, now: number): CameraVerdict {
  const live = deltas.filter((d) => d > CAMERA.deltaFloor).length
  if (live >= CAMERA.samplePairs) return 'passed'
  if (now - startedAt >= CAMERA.timeoutMs) return 'frozen'
  return 'sampling'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/tsx/dist/cli.mjs src/features/interview/systemcheck/signal.test.ts`
Expected: PASS — `All signal assertions passed`

- [ ] **Step 5: Commit**

```bash
git add src/features/interview/systemcheck/signal.ts src/features/interview/systemcheck/signal.test.ts
git commit -m "feat(systemcheck): mic and camera signal verdicts"
```

---

### Task 4: Candidate-facing guidance

**Files:**
- Create: `src/features/interview/systemcheck/guidance.ts`
- Test: `src/features/interview/systemcheck/guidance.test.ts`

**Interfaces:**
- Consumes: `CheckId` from `./requirements`, `BrowserFamily` from `./capabilities`.
- Produces: `type CheckState = 'unsupported' | 'not-asked' | 'requesting' | 'denied' | 'granted-no-signal' | 'passed'`; `interface Guidance { title: string; detail: string; steps: string[] }`; `guidanceFor(id: CheckId, state: CheckState, family: BrowserFamily, isWebview: boolean): Guidance`.

- [ ] **Step 1: Write the failing test**

```ts
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

console.log('\n=== unsupported names a browser to switch to ===')
const un = guidanceFor('mic', 'unsupported', 'unknown', false)
assert('suggests Chrome/Edge/Safari', /chrome|edge|safari/i.test(un.detail + un.steps.join(' ')))

console.log(failures === 0 ? '\nAll guidance assertions passed\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/tsx/dist/cli.mjs src/features/interview/systemcheck/guidance.test.ts`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `./guidance`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * What the candidate reads. A pure function of (check, state, browser), so every
 * branch is exercised by a test instead of discovered by someone who could not
 * start their interview.
 *
 * The distinction this module exists to preserve: `denied` and
 * `granted-no-signal` are different problems with different fixes. The screen
 * being replaced showed the same message for both.
 */
import type { BrowserFamily } from './capabilities'
import type { CheckId } from './requirements'

/**
 * `listening` is separate from `requesting` on purpose. Permission is settled and
 * the meter is already moving; telling the candidate we are "waiting for
 * permission" at that moment would be a lie, and telling them we "can't hear
 * you" before the window has elapsed would be a false accusation.
 */
export type CheckState =
  | 'unsupported' | 'not-asked' | 'requesting' | 'listening' | 'denied' | 'granted-no-signal' | 'passed'

export interface Guidance {
  title: string
  detail: string
  steps: string[]
}

const DEVICE_WORD: Record<CheckId, string> = {
  browser: 'browser',
  mic: 'microphone',
  camera: 'camera',
  speaker: 'speakers',
  connectivity: 'connection',
}

/** Where each browser hides its site-permission controls. */
const UNBLOCK: Record<BrowserFamily, string[]> = {
  chrome: [
    'Click the icon at the left of the address bar.',
    'Set Camera and Microphone to Allow.',
    'Reload this page, then press Re-test.',
  ],
  edge: [
    'Click the padlock at the left of the address bar.',
    'Set Camera and Microphone to Allow.',
    'Reload this page, then press Re-test.',
  ],
  firefox: [
    'Click the padlock at the left of the address bar.',
    'Remove the blocked Camera or Microphone entry.',
    'Reload this page, then press Re-test.',
  ],
  safari: [
    'Open Safari → Settings for This Website.',
    'Set Camera and Microphone to Allow.',
    'Reload this page, then press Re-test.',
  ],
  samsung: [
    'Tap the padlock at the left of the address bar.',
    'Open Permissions and allow Camera and Microphone.',
    'Reload this page, then press Re-test.',
  ],
  unknown: [
    'Open your browser settings for this site.',
    'Allow Camera and Microphone access.',
    'Reload this page, then press Re-test.',
  ],
}

const WEBVIEW_STEPS = [
  'Tap the ⋯ or share menu in this window.',
  'Choose "Open in browser" (Chrome, Safari or Edge).',
  'If there is no such option, copy the link and paste it into a browser.',
]

const NO_SIGNAL: Partial<Record<CheckId, Guidance>> = {
  mic: {
    title: "We can't hear you",
    detail:
      'Your microphone is allowed, but no sound is reaching us. That usually means it is muted or the wrong input is selected.',
    steps: [
      'Check for a mute switch on your headset, and unmute your system microphone.',
      'If you have more than one microphone, pick another from the list and try again.',
      'Unplug and replug a USB or wired headset, then press Re-test.',
    ],
  },
  camera: {
    title: "We can't see you",
    detail:
      'Your camera is allowed, but no live picture is coming through. Another app may be holding it, or the lens may be covered.',
    steps: [
      'Close Zoom, Teams, Meet or any other app that may be using the camera.',
      'Remove any lens cover or privacy shutter.',
      'If you have more than one camera, pick another from the list, then press Re-test.',
    ],
  },
}

export function guidanceFor(
  id: CheckId,
  state: CheckState,
  family: BrowserFamily,
  isWebview: boolean,
): Guidance {
  const thing = DEVICE_WORD[id]

  // A webview outranks everything: un-blocking instructions are useless when the
  // container will not grant media at all.
  if (isWebview && (state === 'denied' || state === 'unsupported' || state === 'granted-no-signal')) {
    return {
      title: 'Please open this in a real browser',
      detail:
        'You are viewing this inside an app’s built-in browser, which usually blocks the camera and microphone. Opening the same link in Chrome, Safari or Edge will fix it.',
      steps: WEBVIEW_STEPS,
    }
  }

  switch (state) {
    case 'unsupported':
      return {
        title: `This browser can’t use your ${thing}`,
        detail:
          'Your current browser is missing something this interview needs. The latest Chrome, Edge or Safari will work.',
        steps: [
          'Copy this page’s link.',
          'Open Chrome, Edge or Safari and paste it in.',
          'Make sure the address starts with https.',
        ],
      }
    case 'not-asked':
      return {
        title: `Check your ${thing}`,
        detail:
          id === 'speaker'
            ? 'We’ll play a short sound so you know you’ll hear the interviewer.'
            : `Your browser will ask for permission. We only use your ${thing} during this interview.`,
        steps: [],
      }
    case 'requesting':
      return {
        title: `Waiting for permission`,
        detail: `Choose Allow in the browser prompt to let us test your ${thing}.`,
        steps: ['The prompt usually appears near the address bar.'],
      }
    case 'listening':
      return id === 'mic'
        ? {
            title: 'Say something',
            detail: 'Read this line out loud. The bar below should move as you speak.',
            steps: [],
          }
        : id === 'camera'
          ? { title: 'Looking for a picture', detail: 'Checking that your camera is sending a live image.', steps: [] }
          : { title: 'Testing', detail: `Checking your ${thing}.`, steps: [] }
    case 'denied':
      return {
        title: `Your ${thing} is blocked`,
        detail: `This browser is refusing access to your ${thing}, so we can’t test it.`,
        steps: UNBLOCK[family],
      }
    case 'granted-no-signal':
      return (
        NO_SIGNAL[id] ?? {
          title: `Your ${thing} isn’t responding`,
          detail: `Access was allowed, but we couldn’t get a working signal from your ${thing}.`,
          steps: ['Check the device is connected and try again.'],
        }
      )
    case 'passed':
      return {
        title: `Your ${thing} is working`,
        detail:
          id === 'mic'
            ? 'We can hear you clearly.'
            : id === 'camera'
              ? 'We can see you.'
              : `Your ${thing} is ready.`,
        steps: [],
      }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/tsx/dist/cli.mjs src/features/interview/systemcheck/guidance.test.ts`
Expected: PASS — `All guidance assertions passed`

- [ ] **Step 5: Commit**

```bash
git add src/features/interview/systemcheck/guidance.ts src/features/interview/systemcheck/guidance.test.ts
git commit -m "feat(systemcheck): candidate guidance for every check state"
```

---

### Task 5: Microphone check hook

**Files:**
- Create: `src/features/interview/systemcheck/useMicCheck.ts`

**Interfaces:**
- Consumes: `MIC`, `micVerdict`, `rmsOf`, `toDbfs` from `./signal`; `CheckState` from `./guidance`.
- Produces: `interface MicCheck { state: CheckState; level: number; devices: MediaDeviceInfo[]; deviceId: string | null; start(): void; retest(): void; selectDevice(id: string): void; stop(): void }`; `useMicCheck(enabled: boolean): MicCheck`.

- [ ] **Step 1: Write the implementation**

There is no unit test for this hook — its logic lives in `signal.ts` (already tested) and the rest is browser plumbing, covered by the Playwright suite in Task 10. Keep it thin for exactly that reason.

```ts
/**
 * Microphone verification: open a stream, measure it, and only pass when real
 * audio energy arrives. A resolved getUserMedia is NOT a working microphone —
 * muted hardware and wrong default inputs both resolve happily.
 *
 * All decision-making is delegated to signal.ts. This hook owns the stream,
 * the AnalyserNode and the animation frame, and nothing else.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CheckState } from './guidance'
import { MIC, micVerdict, rmsOf, toDbfs } from './signal'

export interface MicCheck {
  state: CheckState
  /** 0..1, for the meter. */
  level: number
  devices: MediaDeviceInfo[]
  deviceId: string | null
  start: () => void
  retest: () => void
  selectDevice: (id: string) => void
  stop: () => void
}

export function useMicCheck(enabled: boolean): MicCheck {
  const [state, setState] = useState<CheckState>('not-asked')
  const [level, setLevel] = useState(0)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const qualifyingRef = useRef<number[]>([])

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    setLevel(0)
  }, [])

  const start = useCallback(async () => {
    stop()
    qualifyingRef.current = []
    setState('requesting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      })
    } catch {
      // Every failure mode here — dismissed prompt, policy block, no device —
      // is actionable in the same way, and the candidate cannot tell them apart.
      setState('denied')
      return
    }
    streamRef.current = stream

    // Labels are empty until a grant exists, so enumerate only now.
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((d) => d.kind === 'audioinput'))
      if (!deviceId) setDeviceId(stream.getAudioTracks()[0]?.getSettings().deviceId ?? null)
    } catch { /* a picker is a nicety; its absence must not fail the check */ }

    const Ctor: typeof AudioContext =
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? AudioContext
    const ctx = new Ctor()
    ctxRef.current = ctx
    // Safari and Chrome both start suspended without a gesture; the candidate
    // pressed a button to get here, so this resolves.
    await ctx.resume().catch(() => {})

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buffer = new Float32Array(analyser.fftSize)
    const startedAt = performance.now()
    setState('listening')

    const tick = () => {
      analyser.getFloatTimeDomainData(buffer)
      const rms = rmsOf(buffer)
      setLevel(Math.min(1, rms * 8)) // headroom so normal speech fills the meter
      const now = performance.now()
      if (toDbfs(rms) > MIC.floorDbfs) qualifyingRef.current.push(now)

      const verdict = micVerdict(qualifyingRef.current, startedAt, now)
      if (verdict === 'passed') { setState('passed'); return }
      // Keep polling even after 'no-signal': the candidate may unmute and speak,
      // and the check must clear itself when they do rather than stay accusing.
      setState(verdict === 'no-signal' ? 'granted-no-signal' : 'listening')
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [deviceId, stop])

  const retest = useCallback(() => { void start() }, [start])

  const selectDevice = useCallback((id: string) => {
    setDeviceId(id)
    qualifyingRef.current = []
  }, [])

  // Re-open whenever the chosen device changes, and tear down on unmount so no
  // microphone stays live behind the interview.
  useEffect(() => {
    if (enabled) void start()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, deviceId])

  return { state, level, devices, deviceId, start: () => void start(), retest, selectDevice, stop }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/features/interview/systemcheck/useMicCheck.ts
git commit -m "feat(systemcheck): microphone verification via measured level"
```

---

### Task 6: Camera check hook

**Files:**
- Create: `src/features/interview/systemcheck/useCameraCheck.ts`

**Interfaces:**
- Consumes: `CAMERA`, `cameraVerdict`, `lumaDelta` from `./signal`; `CheckState` from `./guidance`.
- Produces: `interface CameraCheck { state: CheckState; videoRef: React.RefObject<HTMLVideoElement>; devices: MediaDeviceInfo[]; deviceId: string | null; retest(): void; selectDevice(id: string): void; stop(): void }`; `useCameraCheck(enabled: boolean): CameraCheck`.

- [ ] **Step 1: Write the implementation**

```ts
/**
 * Camera verification: pass only when live frames are genuinely arriving.
 *
 * Liveness is measured as CHANGE BETWEEN FRAMES, never brightness. A candidate
 * in a dim room is fine and must pass; a bright frozen frame is broken and must
 * fail. A real sensor always produces noise, so successive frames never match
 * exactly — a frozen, disconnected or synthetic-black feed produces identical
 * bytes. See signal.ts for the thresholds.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CheckState } from './guidance'
import { CAMERA, cameraVerdict, lumaDelta } from './signal'

export interface CameraCheck {
  state: CheckState
  videoRef: React.RefObject<HTMLVideoElement>
  devices: MediaDeviceInfo[]
  deviceId: string | null
  retest: () => void
  selectDevice: (id: string) => void
  stop: () => void
}

export function useCameraCheck(enabled: boolean): CameraCheck {
  const [state, setState] = useState<CheckState>('not-asked')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const start = useCallback(async () => {
    stop()
    setState('requesting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      })
    } catch {
      setState('denied')
      return
    }
    streamRef.current = stream

    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((d) => d.kind === 'videoinput'))
      if (!deviceId) setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? null)
    } catch { /* picker optional */ }

    const video = videoRef.current
    if (!video) { setState('granted-no-signal'); return }
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    await video.play().catch(() => {})

    const canvas = document.createElement('canvas')
    canvas.width = CAMERA.canvasSize
    canvas.height = CAMERA.canvasSize
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) { setState('granted-no-signal'); return }

    const startedAt = performance.now()
    const deltas: number[] = []
    let previous: Uint8ClampedArray | null = null
    setState('listening')

    timerRef.current = setInterval(() => {
      const el = videoRef.current
      const ready = !!el && el.videoWidth > 0 && el.readyState >= 2 // HAVE_CURRENT_DATA
      if (ready) {
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        if (previous) deltas.push(lumaDelta(previous, frame))
        previous = new Uint8ClampedArray(frame)
      }

      const verdict = cameraVerdict(deltas, startedAt, performance.now())
      if (verdict === 'passed') {
        setState('passed')
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
      } else if (verdict === 'frozen') {
        setState('granted-no-signal')
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
      }
    }, CAMERA.sampleEveryMs)
  }, [deviceId, stop])

  const retest = useCallback(() => { void start() }, [start])
  const selectDevice = useCallback((id: string) => setDeviceId(id), [])

  useEffect(() => {
    if (enabled) void start()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, deviceId])

  return { state, videoRef, devices, deviceId, retest, selectDevice, stop }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/features/interview/systemcheck/useCameraCheck.ts
git commit -m "feat(systemcheck): camera verification via inter-frame liveness"
```

---

### Task 7: Speaker and connectivity checks

**Files:**
- Create: `src/features/interview/systemcheck/useSpeakerCheck.ts`
- Create: `src/features/interview/systemcheck/useConnectivityCheck.ts`

**Interfaces:**
- Produces: `interface SpeakerCheck { state: CheckState; playing: boolean; playTone(): void; confirm(): void; deny(): void }`; `useSpeakerCheck(): SpeakerCheck`. And `interface ConnectivityCheck { state: CheckState; retest(): void }`; `useConnectivityCheck(enabled: boolean): ConnectivityCheck`.

- [ ] **Step 1: Write the speaker hook**

```ts
/**
 * Output verification — the honest exception.
 *
 * There is no reliable way to detect that a human heard a sound. Every other
 * check here passes on measurement; this one passes on the candidate saying so,
 * and the UI states that plainly rather than implying we tested it.
 */
import { useCallback, useRef, useState } from 'react'
import type { CheckState } from './guidance'

export interface SpeakerCheck {
  state: CheckState
  playing: boolean
  playTone: () => void
  confirm: () => void
  deny: () => void
}

const TONE_HZ = 440
const TONE_MS = 1200

export function useSpeakerCheck(): SpeakerCheck {
  const [state, setState] = useState<CheckState>('not-asked')
  const [playing, setPlaying] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)

  const playTone = useCallback(async () => {
    const Ctor: typeof AudioContext =
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? AudioContext
    const ctx = ctxRef.current ?? new Ctor()
    ctxRef.current = ctx
    await ctx.resume().catch(() => {})

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = TONE_HZ
    // Ramped, not switched: an abrupt start clicks, and a click through
    // headphones at volume is unpleasant on a surface meant to calm people.
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05)
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + TONE_MS / 1000)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + TONE_MS / 1000)
    setPlaying(true)
    setState('requesting')
    window.setTimeout(() => setPlaying(false), TONE_MS)
  }, [])

  const confirm = useCallback(() => setState('passed'), [])
  const deny = useCallback(() => setState('granted-no-signal'), [])

  return { state, playing, playTone: () => void playTone(), confirm, deny }
}
```

- [ ] **Step 2: Write the connectivity hook**

```ts
/**
 * Two-way connectivity probe.
 *
 * A live call fails in ways device access never predicts: UDP blocked by a
 * corporate network, no NAT traversal, an unreachable API. Gathering a
 * server-reflexive ICE candidate proves the path a real call needs, and it needs
 * no LiveKit credential — which matters, because those are not currently set on
 * the deployed backend.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { httpBase } from '@/lib/apiOrigin'
import type { CheckState } from './guidance'

export interface ConnectivityCheck {
  state: CheckState
  retest: () => void
}

const ICE_TIMEOUT_MS = 5_000
const STUN = 'stun:stun.l.google.com:19302'

export function useConnectivityCheck(enabled: boolean): ConnectivityCheck {
  const [state, setState] = useState<CheckState>('not-asked')
  const pcRef = useRef<RTCPeerConnection | null>(null)

  const run = useCallback(async () => {
    pcRef.current?.close()
    pcRef.current = null
    setState('requesting')

    if (typeof RTCPeerConnection === 'undefined') { setState('unsupported'); return }

    const reachable = fetch(`${httpBase().replace(/\/api\/web$/, '')}/health`, { method: 'GET' })
      .then((r) => r.ok)
      .catch(() => false)

    const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN }] })
    pcRef.current = pc
    const gotReflexive = new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), ICE_TIMEOUT_MS)
      pc.onicecandidate = (e) => {
        if (e.candidate && e.candidate.candidate.includes('typ srflx')) {
          window.clearTimeout(timer)
          resolve(true)
        }
      }
    })
    // A data channel is required or no candidates are gathered at all.
    pc.createDataChannel('probe')
    await pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {})

    const [srflx, ok] = await Promise.all([gotReflexive, reachable])
    pc.close()
    pcRef.current = null
    setState(srflx && ok ? 'passed' : 'granted-no-signal')
  }, [])

  useEffect(() => {
    if (enabled) void run()
    return () => { pcRef.current?.close(); pcRef.current = null }
  }, [enabled, run])

  return { state, retest: () => void run() }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/features/interview/systemcheck/useSpeakerCheck.ts src/features/interview/systemcheck/useConnectivityCheck.ts
git commit -m "feat(systemcheck): speaker tone confirmation and two-way connectivity probe"
```

---

### Task 8: Compose the checks and derive the gate

**Files:**
- Create: `src/features/interview/systemcheck/useSystemCheck.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: `interface CheckView { id: CheckId; state: CheckState; guidance: Guidance }`; `interface SystemCheck { checks: CheckView[]; canStart: boolean; outstanding: CheckId[]; caps: Capabilities; mic: MicCheck; camera: CameraCheck; speaker: SpeakerCheck; connectivity: ConnectivityCheck }`; `useSystemCheck(track: TrackType): SystemCheck`.

- [ ] **Step 1: Write the implementation**

```ts
/**
 * Composes the individual checks against the mode's requirements and derives the
 * one value that matters: whether the candidate may start.
 *
 * `canStart` is computed from the requirement table, never hand-maintained per
 * mode — that is what stops an ungated path from shipping for one track.
 */
import { useEffect, useMemo, useState } from 'react'
import type { TrackType } from '@shared/types'
import { detect, readEnvironment, missingFor, type Capabilities } from './capabilities'
import { guidanceFor, type CheckState, type Guidance } from './guidance'
import { requirementsFor, type CheckId } from './requirements'
import { useCameraCheck, type CameraCheck } from './useCameraCheck'
import { useConnectivityCheck, type ConnectivityCheck } from './useConnectivityCheck'
import { useMicCheck, type MicCheck } from './useMicCheck'
import { useSpeakerCheck, type SpeakerCheck } from './useSpeakerCheck'

export interface CheckView {
  id: CheckId
  state: CheckState
  guidance: Guidance
}

export interface SystemCheck {
  checks: CheckView[]
  canStart: boolean
  outstanding: CheckId[]
  caps: Capabilities
  mic: MicCheck
  camera: CameraCheck
  speaker: SpeakerCheck
  connectivity: ConnectivityCheck
}

export function useSystemCheck(track: TrackType): SystemCheck {
  const caps = useMemo(() => detect(readEnvironment()), [])
  const required = useMemo(() => requirementsFor(track), [track])
  const blocked = useMemo(() => missingFor(caps, required), [caps, required])

  // Hooks must run unconditionally; `enabled` decides whether they open hardware.
  const wants = (id: CheckId) => required.includes(id) && !blocked.includes(id)
  const mic = useMicCheck(wants('mic'))
  const camera = useCameraCheck(wants('camera'))
  const speaker = useSpeakerCheck()
  const connectivity = useConnectivityCheck(wants('connectivity'))

  // A webview only matters when the mode needs hardware. Blocking a typed
  // interview because the candidate opened the link in Gmail would reject
  // someone whose setup is genuinely fine — a false block is worse here than
  // the failure it would prevent.
  const needsMedia = required.includes('mic') || required.includes('camera')

  const stateOf = (id: CheckId): CheckState => {
    if (blocked.includes(id)) return 'unsupported'
    switch (id) {
      case 'browser':
        if (!caps.secureContext) return 'unsupported'
        return caps.isWebview && needsMedia ? 'unsupported' : 'passed'
      case 'mic': return mic.state
      case 'camera': return camera.state
      case 'speaker': return speaker.state
      case 'connectivity': return connectivity.state
    }
  }

  const checks: CheckView[] = required.map((id) => {
    const state = stateOf(id)
    return { id, state, guidance: guidanceFor(id, state, caps.family, caps.isWebview) }
  })

  const outstanding = checks.filter((c) => c.state !== 'passed').map((c) => c.id)

  // Mid-check recovery: a candidate who un-blocks a permission in browser
  // settings should see the check clear without reloading the page.
  useEffect(() => {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions
    if (!perms?.query) return
    const names = ['microphone', 'camera'] as unknown as PermissionName[]
    const handles: PermissionStatus[] = []
    void Promise.all(
      names.map((name) =>
        perms
          .query({ name })
          .then((status) => {
            status.onchange = () => {
              if (status.state === 'granted') {
                if (name === ('microphone' as unknown as PermissionName)) mic.retest()
                else camera.retest()
              }
            }
            handles.push(status)
          })
          .catch(() => {}),
      ),
    )
    return () => { handles.forEach((h) => { h.onchange = null }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    checks,
    canStart: outstanding.length === 0,
    outstanding,
    caps,
    mic,
    camera,
    speaker,
    connectivity,
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add src/features/interview/systemcheck/useSystemCheck.ts
git commit -m "feat(systemcheck): compose checks and derive the start gate"
```

---

### Task 9: The screen, and wiring it in

**Files:**
- Create: `src/features/interview/systemcheck/LevelMeter.tsx`
- Create: `src/features/interview/systemcheck/DevicePicker.tsx`
- Create: `src/features/interview/systemcheck/SystemCheckScreen.tsx`
- Modify: `src/features/interview/TakeInterviewPage.tsx` (the `systemcheck` branch and its import)
- Delete: `src/features/interview/screens/SystemCheck.tsx`, `src/features/interview/screens/VideoSystemCheck.tsx`

- [ ] **Step 1: LevelMeter**

```tsx
/** The mic's evidence: a bar that moves when the candidate speaks. */
interface Props { level: number; accent: string; active: boolean }

export function LevelMeter({ level, accent, active }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100)
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-neutral-200"
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Microphone level"
    >
      <div
        className="h-full rounded-full transition-[width] duration-75"
        style={{ width: `${pct}%`, background: active ? accent : '#d4d4d4' }}
      />
    </div>
  )
}
```

- [ ] **Step 2: DevicePicker**

```tsx
/** Shown only when the candidate actually has a choice to make. */
interface Props {
  label: string
  devices: MediaDeviceInfo[]
  value: string | null
  onChange: (id: string) => void
}

export function DevicePicker({ label, devices, value, onChange }: Props) {
  if (devices.length < 2) return null
  return (
    <label className="mt-3 block text-xs text-neutral-500">
      {label}
      <select
        className="mt-1 w-full rounded-lg border border-border bg-white p-2 text-sm text-neutral-900"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  )
}
```

- [ ] **Step 3: SystemCheckScreen**

```tsx
/**
 * The pre-interview gate. Replaces screens/SystemCheck.tsx (three reassurance
 * checkboxes) and screens/VideoSystemCheck.tsx (getUserMedia → 'granted').
 *
 * Start stays disabled until every check the MODE requires reports `passed` —
 * derived from the requirement table, so it cannot drift per mode.
 */
import { motion, useReducedMotion } from 'framer-motion'
import { AlertTriangle, ArrowRight, Check, Loader2, RefreshCw, Volume2 } from 'lucide-react'
import type { BrandingConfig, TrackType } from '@shared/types'
import { VideoIntro } from '../screens/VideoIntro'
import { DevicePicker } from './DevicePicker'
import { LevelMeter } from './LevelMeter'
import { useSystemCheck } from './useSystemCheck'

interface Props {
  branding: BrandingConfig
  track: TrackType
  busy?: boolean
  onBegin: () => void
}

const LABEL: Record<string, string> = {
  browser: 'Browser',
  mic: 'Microphone',
  camera: 'Camera',
  speaker: 'Sound',
  connectivity: 'Connection',
}

export function SystemCheckScreen({ branding, track, busy, onBegin }: Props) {
  const reduce = useReducedMotion()
  const sc = useSystemCheck(track)
  const accent = branding.accentColor

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl border border-border bg-white p-8 shadow-lg sm:p-10"
    >
      <h1 className="font-display text-2xl font-extrabold tracking-[-0.03em] text-neutral-900">
        Quick system check
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-neutral-500">
        We’ll make sure everything works before your first question.
      </p>

      <ul className="mt-7 space-y-3">
        {sc.checks.map((c) => {
          const failed = c.state === 'denied' || c.state === 'granted-no-signal' || c.state === 'unsupported'
          const passed = c.state === 'passed'
          return (
            <li
              key={c.id}
              data-check={c.id}
              data-state={c.state}
              className="rounded-2xl border border-border bg-neutral-50 p-4"
            >
              <div className="flex items-start gap-3.5">
                <span
                  className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: passed ? accent : failed ? '#fee2e2' : accent + '14',
                    color: passed ? '#fff' : failed ? '#b91c1c' : accent,
                  }}
                >
                  {passed ? <Check size={17} strokeWidth={3} />
                    : failed ? <AlertTriangle size={17} strokeWidth={1.75} />
                    : <Loader2 size={17} className="animate-spin" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-neutral-900">
                    {LABEL[c.id]} — {c.guidance.title}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-500">{c.guidance.detail}</p>

                  {c.id === 'mic' && (
                    <div className="mt-3">
                      <LevelMeter level={sc.mic.level} accent={accent} active={!passed} />
                      <DevicePicker
                        label="Microphone"
                        devices={sc.mic.devices}
                        value={sc.mic.deviceId}
                        onChange={sc.mic.selectDevice}
                      />
                    </div>
                  )}

                  {c.id === 'camera' && (
                    <div className="mt-3">
                      <video
                        ref={sc.camera.videoRef}
                        data-testid="camera-preview"
                        className="aspect-video w-full max-w-xs rounded-xl bg-neutral-900 object-cover"
                        muted
                        playsInline
                      />
                      <DevicePicker
                        label="Camera"
                        devices={sc.camera.devices}
                        value={sc.camera.deviceId}
                        onChange={sc.camera.selectDevice}
                      />
                    </div>
                  )}

                  {c.id === 'speaker' && !passed && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={sc.speaker.playTone}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-xs font-semibold text-neutral-700"
                      >
                        <Volume2 size={14} /> Play test sound
                      </button>
                      <button
                        data-testid="speaker-confirm"
                        onClick={sc.speaker.confirm}
                        className="inline-flex h-9 items-center rounded-md px-3 text-xs font-semibold text-white"
                        style={{ background: accent }}
                      >
                        I heard it
                      </button>
                      <button
                        onClick={sc.speaker.deny}
                        className="inline-flex h-9 items-center rounded-md border border-border bg-white px-3 text-xs font-semibold text-neutral-700"
                      >
                        I heard nothing
                      </button>
                    </div>
                  )}

                  {c.guidance.steps.length > 0 && (
                    <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-neutral-500">
                      {c.guidance.steps.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                  )}

                  {failed && c.id !== 'speaker' && (
                    <button
                      data-testid={`retest-${c.id}`}
                      onClick={() => {
                        if (c.id === 'mic') sc.mic.retest()
                        else if (c.id === 'camera') sc.camera.retest()
                        else if (c.id === 'connectivity') sc.connectivity.retest()
                      }}
                      className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-white px-3 text-xs font-semibold text-neutral-700"
                    >
                      <RefreshCw size={14} /> Re-test
                    </button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {track === 'video' && sc.canStart && <VideoIntro branding={branding} onBegin={onBegin} busy={busy} />}

      {!(track === 'video' && sc.canStart) && (
        <>
          <button
            data-testid="start-interview"
            onClick={onBegin}
            disabled={!sc.canStart || busy}
            className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 rounded-md text-base font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: accent }}
          >
            {busy ? <><Loader2 size={18} className="animate-spin" /> Starting…</>
              : <>Start the interview <ArrowRight size={18} /></>}
          </button>
          {!sc.canStart && (
            <p className="mt-2.5 text-center text-xs text-neutral-400">
              Still to check: {sc.outstanding.map((id) => LABEL[id]).join(', ')}.
            </p>
          )}
        </>
      )}
    </motion.div>
  )
}
```

- [ ] **Step 4: Wire it into TakeInterviewPage**

Replace the `SystemCheck` import with:

```tsx
import { SystemCheckScreen } from './systemcheck/SystemCheckScreen'
```

and the `systemcheck` branch's element with:

```tsx
<SystemCheckScreen
  key="check"
  branding={branding}
  track={s.track}
  busy={clock.busy}
  onBegin={() => {
    integrity.enterFullscreen()
    if (conversational) setChatbotStarted(true)
    else clock.begin()
  }}
/>
```

- [ ] **Step 5: Delete the superseded screens**

```bash
git rm src/features/interview/screens/SystemCheck.tsx src/features/interview/screens/VideoSystemCheck.tsx
```

- [ ] **Step 6: Build and test**

Run: `npm run build && npm test`
Expected: build exit 0; `✅ All test files passed`

- [ ] **Step 7: Commit**

```bash
git add -A src/features/interview
git commit -m "feat(systemcheck): mode-driven check screen, gating Start on verified signal"
```

---

### Task 10: Playwright verification

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/systemcheck.spec.ts`
- Create: `e2e/fixtures/silence.wav` (generated, see Step 2)
- Modify: `package.json` (devDependency + `test:e2e` script)

- [ ] **Step 1: Install Playwright**

```bash
npm i -D @playwright/test
npx playwright install chromium
```

Add to `package.json` scripts:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 2: Generate the silent WAV that stages "granted but no signal"**

```bash
node -e "const f=require('fs');const s=44100*3,b=Buffer.alloc(44+s*2);b.write('RIFF',0);b.writeUInt32LE(36+s*2,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(44100,24);b.writeUInt32LE(88200,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(s*2,40);f.mkdirSync('e2e/fixtures',{recursive:true});f.writeFileSync('e2e/fixtures/silence.wav',b)"
```

- [ ] **Step 3: Write playwright.config.ts**

```ts
import { defineConfig, devices } from '@playwright/test'

/**
 * Chromium's fake-media flags are the only way to stage the case that matters:
 * permission granted, device present, and no signal arriving. A real camera and
 * microphone cannot be made to fail on demand in CI.
 */
const FAKE_MEDIA = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
]

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  webServer: {
    command: 'npm run dev:client',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: { baseURL: 'http://localhost:3001', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: FAKE_MEDIA } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], launchOptions: { args: FAKE_MEDIA } },
    },
  ],
})
```

- [ ] **Step 4: Write the spec**

```ts
import { expect, test, type Page } from '@playwright/test'

/**
 * The System Check, per mode and per failure state.
 *
 * The assertion that carries the feature is the same in every case: Start is
 * disabled until the checks that mode requires have actually passed.
 */
const MODES = ['chat', 'chatbot', 'voice', 'video_avatar', 'video', 'two_way'] as const

/** Renders the screen in isolation via the dev harness route. */
async function openCheck(page: Page, track: string) {
  await page.goto(`/__systemcheck?track=${track}`)
}

const start = (page: Page) => page.getByTestId('start-interview')
const check = (page: Page, id: string) => page.locator(`[data-check="${id}"]`)

test.describe('hardware-free modes', () => {
  for (const track of ['chat', 'chatbot']) {
    test(`${track} asks for no hardware and starts`, async ({ page }) => {
      await openCheck(page, track)
      await expect(check(page, 'mic')).toHaveCount(0)
      await expect(check(page, 'camera')).toHaveCount(0)
      await expect(start(page)).toBeEnabled()
      await page.screenshot({ path: `e2e/shots/${track}-ready.png` })
    })
  }
})

test.describe('working hardware', () => {
  for (const track of ['voice', 'video_avatar', 'video', 'two_way']) {
    test(`${track} passes with fake devices`, async ({ page }) => {
      await openCheck(page, track)
      await expect(check(page, 'mic')).toHaveAttribute('data-state', 'passed')
      if (track !== 'voice') {
        await expect(check(page, 'camera')).toHaveAttribute('data-state', 'passed')
      }
      if (await page.getByTestId('speaker-confirm').count()) {
        await page.getByTestId('speaker-confirm').click()
      }
      await expect(start(page)).toBeEnabled()
      await page.screenshot({ path: `e2e/shots/${track}-pass.png` })
    })
  }
})

test.describe('denied', () => {
  test('blocked permissions keep Start disabled and explain the fix', async ({ page, context }) => {
    await context.clearPermissions()
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('Permission denied', 'NotAllowedError'))
    })
    await openCheck(page, 'video_avatar')
    await expect(check(page, 'mic')).toHaveAttribute('data-state', 'denied')
    await expect(start(page)).toBeDisabled()
    await expect(page.getByText(/blocked/i).first()).toBeVisible()
    await page.screenshot({ path: 'e2e/shots/denied.png' })
  })
})

test.describe('granted but no signal', () => {
  test.use({ launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--use-file-for-fake-audio-capture=e2e/fixtures/silence.wav',
    ],
  } })

  test('a silent microphone fails with "can\'t hear you"', async ({ page }) => {
    await openCheck(page, 'voice')
    await expect(check(page, 'mic')).toHaveAttribute('data-state', 'granted-no-signal', { timeout: 20_000 })
    await expect(page.getByText(/can.?t hear you/i)).toBeVisible()
    await expect(start(page)).toBeDisabled()
    await page.screenshot({ path: 'e2e/shots/no-signal.png' })
  })
})

test.describe('in-app webview', () => {
  const GMAIL_WEBVIEW =
    'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36'

  test.use({ userAgent: GMAIL_WEBVIEW })

  test('a media mode is told to open a real browser', async ({ page }) => {
    await openCheck(page, 'voice')
    await expect(check(page, 'browser')).toHaveAttribute('data-state', 'unsupported')
    await expect(page.getByText(/open this in a real browser/i)).toBeVisible()
    await expect(start(page)).toBeDisabled()
    await page.screenshot({ path: 'e2e/shots/webview-blocked.png' })
  })

  test('a TYPED mode is not blocked — it needs no hardware', async ({ page }) => {
    await openCheck(page, 'chat')
    await expect(start(page)).toBeEnabled()
    await page.screenshot({ path: 'e2e/shots/webview-typed-ok.png' })
  })
})

test.describe('unsupported', () => {
  test('a browser without mediaDevices is told to switch', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    })
    await openCheck(page, 'voice')
    await expect(check(page, 'mic')).toHaveAttribute('data-state', 'unsupported')
    await expect(page.getByText(/chrome|edge|safari/i).first()).toBeVisible()
    await expect(start(page)).toBeDisabled()
    await page.screenshot({ path: 'e2e/shots/unsupported.png' })
  })
})
```

- [ ] **Step 5: Add the dev-only harness route**

The spec above needs to reach the screen without a live invite. Routes live in
`src/App.tsx` — add this immediately after the existing
`<Route path="/take/:sessionId" element={<TakeInterviewPage />} />` at line 101,
guarded so it never ships in production:

```tsx
{import.meta.env.DEV && (
  <Route path="/__systemcheck" element={<SystemCheckHarness />} />
)}
```

```tsx
// src/features/interview/systemcheck/SystemCheckHarness.tsx — DEV ONLY
import { useSearchParams } from 'react-router-dom'
import type { TrackType } from '@shared/types'
import { SystemCheckScreen } from './SystemCheckScreen'

/** Renders the check for one track with no session, so Playwright can drive it. */
export function SystemCheckHarness() {
  const [params] = useSearchParams()
  const track = (params.get('track') ?? 'voice') as TrackType
  return (
    <div className="mx-auto max-w-2xl p-6">
      <SystemCheckScreen
        branding={{ companyName: 'TalbotIQ', accentColor: '#0E1420' }}
        track={track}
        onBegin={() => { /* harness: starting is out of scope here */ }}
      />
    </div>
  )
}
```

- [ ] **Step 6: Run the suite**

Run: `npm run test:e2e`
Expected: all projects pass. Iterate on real failures — if a threshold in `signal.ts` proves wrong against Chromium's fake devices, change the constant AND its test in `signal.test.ts`, never the assertion in the spec.

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts e2e package.json package-lock.json src/features/interview/systemcheck/SystemCheckHarness.tsx
git commit -m "test(systemcheck): Playwright coverage for pass, deny, no-signal and unsupported"
```

- [ ] **Step 8: Add e2e artefacts to .gitignore**

```
e2e/shots/
playwright-report/
test-results/
```

```bash
git add .gitignore && git commit -m "chore: ignore Playwright artefacts"
```

---

## Done when

- [ ] `npm run build` and `npm test` pass.
- [ ] `npm run test:e2e` passes on both desktop and mobile projects.
- [ ] Start is provably disabled in the denied, no-signal and unsupported screenshots.
- [ ] No camera indicator remains lit after navigating away from the check.
- [ ] `git diff development --stat` shows changes only under `src/features/interview/`, `e2e/`, `playwright.config.ts`, `package.json`, `.gitignore`, and `docs/superpowers/`.

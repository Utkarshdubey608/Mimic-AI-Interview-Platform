# Pre-Interview System Check — Design

**Status:** approved 2026-08-18, ready for an implementation plan.

**Goal:** No candidate reaches a question with a microphone we never heard or a camera
we never saw. A required System Check runs before every interview mode, verifies live
signal rather than trusting a permission grant, and refuses to unlock **Start** until
every check the mode actually needs has passed.

**Scope:** the candidate-side React app only. **Zero backend changes.** No new
endpoints, no contract changes, nothing that can reach the Flutter mobile app or the
desktop build that share `/api/*`. The only network calls are a public STUN probe and a
reachability `GET` against the existing unauthenticated `/health`.

---

## Why this exists

`getUserMedia` resolving is not evidence that hardware works. A muted microphone, a
wrong default input, a lens cap, a camera held by another application, a webview that
grants then silently delivers nothing — every one of these resolves successfully and
reports `granted`. The current code takes exactly that bait:

- `screens/VideoSystemCheck.tsx` calls
  `getUserMedia({ video: true, audio: true })` and reduces the outcome to
  `'idle' | 'granted' | 'denied'`. No level, no frames, no devices, no compatibility.
- `screens/SystemCheck.tsx` — the screen the **Voice** track uses — is three
  reassurance checkboxes ("quiet space", "ready to focus") and a button. The Voice
  track has **no microphone verification of any kind** today.

Both are replaced by one mode-driven screen.

---

## Constraints

- **Frozen:** `/api/*` is the Flutter contract and is not touched. Neither is
  `/api/web/*`, the backend, auth, or any interview logic (`useInterviewClock`,
  `QuestionStage`, the conversational engines).
- **Shared backend:** web, mobile and desktop consume one API. This feature adds
  nothing to it, so there is no coordination cost and no mobile release implied.
- **Capacitor is scaffold only.** `capacitor.config.ts` says so in its own header;
  there are no `@capacitor/*` dependencies and no `android/` project. The check must
  behave correctly in a mobile browser and inside a webview, and must be verified at
  mobile viewports — but native OS permission APIs are out of scope, and no claim is
  made about an APK that cannot be built here.
- **LiveKit credentials are absent from Cloud Run** (`LIVEKIT_URL`, `LIVEKIT_API_KEY`,
  `LIVEKIT_API_SECRET`). The Two-way probe therefore tests transport capability
  generically and needs no credential.
- **Repo test convention:** standalone `*.test.ts` scripts run through `tsx` by
  `scripts/verify-deploy.mjs`. There is no vitest/jest. Playwright is added as the
  first browser-test framework, alongside — not replacing — that runner.
- **Quality gates per task:** `npm run build` (tsc + vite build) and `npm test` pass
  before each commit.

---

## Architecture

Pure decision logic, thin hooks around the browser APIs, one screen. The pure cores are
exported for tests, matching the established `src/lib/apiOrigin.ts` pattern — the pass
and fail rules are the part most worth pinning down, and they must be testable without
a DOM. Putting them inside a component is how the current screen came to trust
`granted`.

```
src/features/interview/systemcheck/
  capabilities.ts          pure — what this browser can do, and what it is
  capabilities.test.ts
  requirements.ts          pure — TrackType → the checks that mode requires
  requirements.test.ts
  signal.ts                pure — the pass/fail rules and their thresholds
  signal.test.ts
  guidance.ts              pure — state + browser → the sentence the candidate reads
  guidance.test.ts
  useMicCheck.ts           stream lifecycle, AnalyserNode, live level
  useCameraCheck.ts        stream lifecycle, preview element, frame liveness
  useSpeakerCheck.ts       oscillator tone, candidate confirmation
  useConnectivityCheck.ts  ICE gathering + /health reachability
  useSystemCheck.ts        composes the above against requirements; owns the gate
  SystemCheckScreen.tsx    the UI
  LevelMeter.tsx           the mic meter
  DevicePicker.tsx         labelled device select + re-test
```

Deleted: `screens/SystemCheck.tsx`, `screens/VideoSystemCheck.tsx`. `screens/VideoIntro.tsx`
is retained — it is content, not a check — and rendered after the check passes for the
`video` track.

`TakeInterviewPage` changes by one line: the `systemcheck` step renders
`SystemCheckScreen`. The pre-step machine in `preStep.ts` is unchanged, and the existing
props contract is preserved exactly — `SystemCheckScreen` takes the same
`{ branding, track, busy, onBegin }` and calls `onBegin` only once every required check
has passed. `TakeInterviewPage` keeps deciding what starting means (fullscreen, then
`setChatbotStarted` for conversational tracks or `clock.begin()` for timed ones); the
check decides only *whether* the candidate may start. That split is what keeps this
change out of interview logic.

---

## Per-mode requirements

Driven by `requirements.ts` so the gate cannot drift per mode, and exhaustive over
`TrackType` via `Record<TrackType, Requirement[]>` — adding a seventh track without
classifying it is a compile error.

| Mode | Browser | Mic | Camera | Speaker | Connectivity | Also |
|---|:--:|:--:|:--:|:--:|:--:|---|
| `chatbot` | ✓ | | | | | |
| `chat` (Timed Q&A) | ✓ | | | | | |
| `voice` | ✓ | ✓ | | ✓ | | AudioContext |
| `video_avatar` | ✓ | ✓ | ✓ | ✓ | | WebRTC |
| `video` | ✓ | ✓ | ✓ | | | MediaRecorder |
| `two_way` | ✓ | ✓ | ✓ | ✓ | ✓ | WebRTC |

Typed modes ask for no hardware. Verified: the timed question stage does not use
`useFacialCapture` — only `VideoStage` and the separate avatar-screening page do — so
there is no hidden proctoring requirement on `chat`.

---

## What "verified" means

### Microphone — measured energy

After `getUserMedia({ audio })`, the track feeds an `AnalyserNode`. Each animation
frame computes RMS over the time-domain buffer and converts to dBFS.

- **Pass:** level clears **−50 dBFS** on **≥ 5 frames** within a rolling **10s** window.
  Several frames, not one, so a chair creak or a single click cannot pass the check.
- **Fail (`granted-no-signal`):** 8s elapsed with nothing above the floor →
  *"We can't hear you."* Guidance covers system mute, hardware mute switches, the wrong
  input device, and replugging.
- The meter is live throughout, so the candidate can see the check responding to their
  voice. It is the evidence, not decoration.

### Camera — temporal variance, not brightness

Brightness is the wrong test. A candidate in a dim room is fine and must pass; a bright
frozen frame is broken and must fail. So liveness is measured as **change between
successive frames**: each sampled frame is drawn to a 32×32 canvas and compared to the
previous one. A real sensor always produces noise, so consecutive frames never match
exactly. A frozen, disconnected, or synthetically black feed produces identical bytes.

- **Pass:** `videoWidth > 0`, `readyState ≥ HAVE_CURRENT_DATA`, and mean absolute
  inter-frame delta above a small floor across ≥ 3 sample pairs.
- **Fail:** dimensions never arrive, or frames are byte-identical →
  *"We can't see you"*, with guidance on other apps holding the camera, lens covers, and
  device selection.
- Sampling runs at ~4 Hz for ~3s, then stops. It does not run during the interview.

### Speaker — the honest exception

Output cannot be measured. For spoken modes a short tone plays through an
`OscillatorNode` and the candidate confirms they heard it. This is the only check that
passes on a person's word, and the UI says so plainly rather than implying a
measurement. Applies to `voice`, `video_avatar`, `two_way`.

### Connectivity — Two-way only

`RTCPeerConnection` with a public STUN server, gathering ICE. Requires at least one
**server-reflexive** candidate within 5s, which proves UDP egress and NAT traversal
actually work — the failure a live call hits that device checks never catch. Plus a
`GET /health` reachability check. Needs no LiveKit credential, so it works today.

### Devices

`enumerateDevices()` after the grant (labels are empty before it). Where more than one
input exists the candidate gets a picker; changing it tears down the old stream, opens
the new one, and re-runs that check only. Covers granted-but-wrong-device, which is
otherwise indistinguishable from broken hardware.

---

## Compatibility and guidance

`capabilities.ts` reports, as pure data from an injected `Navigator`-shaped object so it
is testable: secure context, `mediaDevices.getUserMedia`, `AudioContext`,
`RTCPeerConnection`, `MediaRecorder` + a usable mime type, browser family and version,
and whether this is an in-app webview.

**Webview detection matters most.** A large share of real-world permission failures are
candidates opening the invite from Gmail, Slack, LinkedIn, Instagram or WhatsApp, whose
embedded browsers block media without a meaningful prompt. Detected via UA markers
(`FBAN`/`FBAV`, `Instagram`, `Line`, `WhatsApp`, `Slack`, Android `; wv`) and, on iOS,
a WebKit build without Safari's UA signature. The remedy is one sentence: open the link
in a real browser — with a copy-link button, because a webview often will not let them
navigate out.

Guidance is a pure function of (check, state, browser), so every branch is unit-tested
rather than discovered in production:

| State | Meaning | What the candidate sees |
|---|---|---|
| `unsupported` | Capability missing | Which browser to switch to, and why |
| `not-asked` | No prompt yet | What is about to be asked, and why |
| `requesting` | Prompt open | Where the prompt is, per browser |
| `listening` | Permission settled, measuring | "Say something" + a live meter |
| `denied` | Explicitly blocked | Browser-specific steps to un-block, then re-test |
| `granted-no-signal` | Working device never produced signal | The specific "can't hear/see you" fix list |
| `passed` | Verified | Live meter or preview, and a check mark |

`denied` and `granted-no-signal` are distinct states with distinct copy. Conflating them
is the current bug. `listening` is separate from both for the same reason: while the
meter is already moving, "waiting for permission" is untrue and "we can't hear you" is a
false accusation.

**A webview only blocks modes that need hardware.** Chatbot and Timed Q&A require no
camera or microphone, so a candidate who opens the link inside Gmail can take those
interviews normally. Blocking them would reject someone whose setup is genuinely fine —
on a hiring surface a false block costs more than the failure it prevents.

---

## The gate

`useSystemCheck` derives `canStart` as: every requirement for this track reports
`passed`. Start renders disabled until then, with a line naming what is still
outstanding. Because the requirement list is data, a mode cannot accidentally ship an
ungated path.

Recovery is first-class: `navigator.permissions.query()` is subscribed where supported,
so a candidate who fixes a block in browser settings sees the check clear without a
reload; every check has a **Re-test**; and streams are stopped on unmount and on device
change, so no camera light is left on after the screen.

---

## Testing

**Pure (tsx runner, existing convention).** Thresholds and windows in `signal.ts`;
`requirements.ts` exhaustive over `TrackType`; browser/webview classification over a
table of real UA strings; every guidance branch reachable and non-empty.

**Playwright (new devDependency).** `playwright.config.ts` plus a candidate-flow spec.
Chromium's `--use-fake-device-for-media-stream` supplies synthetic media;
`--use-file-for-fake-audio-capture` with a silent WAV produces the granted-but-no-signal
case that cannot otherwise be staged; permissions are denied through the CDP permission
API; unsupported is staged by stubbing `navigator.mediaDevices` before load. Matrix:
six modes × {working, denied, no-signal, unsupported}, at desktop and mobile viewports,
asserting the disabled state of Start and screenshotting each state.

---

## Out of scope

Native Capacitor permission APIs (no wired target). Changing the LiveKit env gap. Any
backend, contract, auth or interview-logic change. Bandwidth or echo measurement —
neither reliably predicts an interview failure, and both invite false negatives that
would block candidates who are actually fine.

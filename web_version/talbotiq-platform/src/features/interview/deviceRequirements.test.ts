/** Run: npx tsx src/features/interview/deviceRequirements.test.ts */
import {
  canProceed, evaluateCapabilities, mediaConstraintsFor, needsMedia, requirementsFor, stagesFor,
  type BrowserEnv,
} from './deviceRequirements'
import type { TrackType } from '@shared/types'

let failures = 0
function assert(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failures++
}

const ALL: TrackType[] = ['chat', 'chatbot', 'voice', 'video', 'video_avatar', 'two_way']

const GOOD: BrowserEnv = {
  isSecureContext: true, hasGetUserMedia: true, hasWebSocket: true,
  hasWebRTC: true, hasSpeechRecognition: true,
}

/* ── THE PRIVACY RULE ───────────────────────────────────────────────────────
   A text-only or voice-only interview must never reach for the camera. This is
   the single most important assertion in this file.                         */
{
  for (const t of ['chat', 'chatbot', 'voice'] as TrackType[]) {
    assert(`${t} NEVER requests a camera`, requirementsFor(t).camera === false)
    const c = mediaConstraintsFor(t)
    assert(`${t} constraints do not include video`, c === null || c.video === false)
  }
  assert('chat asks for no media at all', mediaConstraintsFor('chat') === null)
  assert('chatbot asks for no media at all', mediaConstraintsFor('chatbot') === null)
}

/* ── Voice gets the microphone test it never had ────────────────────────── */
{
  const v = requirementsFor('voice')
  assert('voice requires a microphone', v.microphone === true)
  assert('voice does not require a camera', v.camera === false)
  const c = mediaConstraintsFor('voice')
  assert('voice asks for audio only', !!c && c.audio === true && c.video === false)
}

/* ── Camera tracks get camera and mic ───────────────────────────────────── */
{
  for (const t of ['video', 'video_avatar', 'two_way'] as TrackType[]) {
    const r = requirementsFor(t)
    assert(`${t} requires a camera`, r.camera === true)
    assert(`${t} requires a microphone`, r.microphone === true)
    const c = mediaConstraintsFor(t)
    assert(`${t} asks for audio and video`, !!c && c.audio === true && c.video === true)
  }
}

/* ── Face framing wherever a camera is used ─────────────────────────────────
   Recorded video was initially excluded on the reasoning that there is no live
   counterpart to frame against. That was backwards: it is the track with NOBODY
   watching, so no interviewer can tell the candidate they are out of frame or
   backlit. They find out when a recruiter plays the recording back, which is far
   too late. Every camera track now gets the aid.                            */
{
  assert('video_avatar uses face framing', requirementsFor('video_avatar').faceFraming === true)
  assert('two_way uses face framing', requirementsFor('two_way').faceFraming === true)
  assert('recorded video uses face framing', requirementsFor('video').faceFraming === true)
  assert('every camera track offers framing',
    ALL.every((t) => !requirementsFor(t).camera || requirementsFor(t).faceFraming))
  // And never where there is no camera at all.
  assert('chat does not', requirementsFor('chat').faceFraming === false)
  assert('chatbot does not', requirementsFor('chatbot').faceFraming === false)
  assert('voice does not', requirementsFor('voice').faceFraming === false)
  assert('framing never appears without a camera',
    ALL.every((t) => !requirementsFor(t).faceFraming || requirementsFor(t).camera))
}

/* ── The check runs as a SEQUENCE, one device per screen ────────────────── */
{
  assert('chat has no device stages at all', stagesFor('chat').length === 0)
  assert('chatbot has no device stages at all', stagesFor('chatbot').length === 0)

  const voice = stagesFor('voice')
  assert('voice: browser then microphone then consent',
    voice.join('>') === 'browser>microphone>consent')
  assert('voice never reaches a camera stage', !voice.includes('camera'))

  const video = stagesFor('video')
  assert('recorded video: browser, mic, camera, framing, consent',
    video.join('>') === 'browser>microphone>camera>face>consent')

  const avatar = stagesFor('video_avatar')
  assert('avatar: browser, mic, camera, framing, consent',
    avatar.join('>') === 'browser>microphone>camera>face>consent')

  for (const t of ALL) {
    const s = stagesFor(t)
    assert(`${t}: framing never precedes the camera`,
      !s.includes('face') || s.indexOf('face') > s.indexOf('camera'))
    assert(`${t}: consent is last when present`,
      !s.includes('consent') || s[s.length - 1] === 'consent')
    assert(`${t}: no stage appears twice`, new Set(s).size === s.length)
  }
}

/* ── needsMedia agrees with the constraints ─────────────────────────────── */
{
  for (const t of ALL) {
    assert(`${t}: needsMedia matches constraints`,
      needsMedia(t) === (mediaConstraintsFor(t) !== null))
  }
}

/* ── Capability checks are scoped to the track ──────────────────────────────
   A written interview must not be told its browser lacks WebRTC.           */
{
  const chat = evaluateCapabilities('chat', GOOD)
  assert('chat reports no capability checks at all', chat.length === 0)

  const voice = evaluateCapabilities('voice', GOOD)
  const ids = voice.map((c) => c.id)
  assert('voice checks secure context', ids.includes('secureContext'))
  assert('voice checks getUserMedia', ids.includes('getUserMedia'))
  assert('voice checks the live connection', ids.includes('websocket'))
  assert('voice checks captions', ids.includes('speech'))

  const video = evaluateCapabilities('video', GOOD)
  assert('recorded video does not check WebRTC', !video.map((c) => c.id).includes('webrtc'))
  assert('two_way DOES check WebRTC', evaluateCapabilities('two_way', GOOD).map((c) => c.id).includes('webrtc'))
}

/* ── Advisory failures never block, required ones do ────────────────────── */
{
  const noSpeech: BrowserEnv = { ...GOOD, hasSpeechRecognition: false }
  const caps = evaluateCapabilities('voice', noSpeech)
  const speech = caps.find((c) => c.id === 'speech')!
  assert('captions check fails when unsupported', speech.ok === false)
  assert('captions are advisory, not required', speech.required === false)
  assert('a missing speech API does NOT block the interview', canProceed(caps) === true)

  const insecure: BrowserEnv = { ...GOOD, isSecureContext: false }
  const blocked = evaluateCapabilities('voice', insecure)
  assert('an insecure page DOES block', canProceed(blocked) === false)

  const noRtc: BrowserEnv = { ...GOOD, hasWebRTC: false }
  assert('no WebRTC blocks a live call', canProceed(evaluateCapabilities('two_way', noRtc)) === false)
  assert('no WebRTC does NOT block recorded video', canProceed(evaluateCapabilities('video', noRtc)) === true)
}

/* ── A healthy browser passes every track ───────────────────────────────── */
{
  for (const t of ALL) {
    assert(`${t} proceeds on a healthy browser`, canProceed(evaluateCapabilities(t, GOOD)) === true)
  }
}

/* ── Every remedy tells the candidate what to DO, with no em dashes ────── */
{
  const every = ALL.flatMap((t) => evaluateCapabilities(t, {
    isSecureContext: false, hasGetUserMedia: false, hasWebSocket: false,
    hasWebRTC: false, hasSpeechRecognition: false,
  }))
  assert('every failing check has a remedy', every.every((c) => c.remedy.length > 20))
  assert('no em dash in any remedy', !every.some((c) => c.remedy.includes('—')))
  assert('no em dash in any label', !every.some((c) => c.label.includes('—')))
}

/* ── Consent is required wherever anything is recorded ──────────────────────
   Consent previously lived only inside VideoIntro, so replacing that one screen
   would have silently dropped it from a recorded interview. It is asserted here
   so it can never go missing with a screen again. Note that VOICE now requires
   it too: a voice interview is recorded and transcribed, and it never asked.  */
{
  for (const t of ['voice', 'video', 'video_avatar', 'two_way'] as TrackType[]) {
    assert(`${t} requires recording consent`, requirementsFor(t).recordingConsent === true)
  }
  assert('chat needs no recording consent', requirementsFor('chat').recordingConsent === false)
  assert('chatbot needs no recording consent', requirementsFor('chatbot').recordingConsent === false)
  assert('anything that captures media also asks consent',
    ALL.every((t) => !needsMedia(t) || requirementsFor(t).recordingConsent))
}

console.log(`\n${failures === 0 ? '✅ ALL DEVICE-REQUIREMENT TESTS PASSED' : `❌ ${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

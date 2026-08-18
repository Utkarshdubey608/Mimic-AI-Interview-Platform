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

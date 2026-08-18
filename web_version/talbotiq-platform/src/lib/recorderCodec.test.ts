/**
 * Codec selection. Run with:  npx tsx src/lib/recorderCodec.test.ts
 *
 * MediaRecorder does not exist in node, so these drive the module through a
 * stub — which is the point: the Safari case cannot be reproduced in Chromium,
 * and it is the case that was broken.
 */
import * as mod from './recorderCodec'
let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}

// A stand-in for whichever browser we are pretending to be. Cast through
// unknown because we are deliberately supplying a partial MediaRecorder: the
// module only ever calls isTypeSupported, and a full constructor stub would be
// noise.
const g = globalThis as unknown as Record<string, unknown>

function withBrowser(supported: string[] | null, fn: () => void) {
  const previous = g.MediaRecorder
  g.MediaRecorder = supported === null
    ? {} // present, but no isTypeSupported (old WebKit)
    : { isTypeSupported: (t: string) => supported.includes(t) }
  try { fn() } finally { g.MediaRecorder = previous }
}


console.log('\n=== Chrome: WebM/VP9 ===')
withBrowser(['video/webm;codecs=vp9,opus', 'video/webm', 'audio/webm;codecs=opus'], () => {
  assert('video picks vp9', mod.pickVideoMimeType() === 'video/webm;codecs=vp9,opus')
  assert('audio picks opus', mod.pickAudioMimeType() === 'audio/webm;codecs=opus')
})

console.log('\n=== Safari: no WebM at all — the bug ===')
withBrowser(['video/mp4;codecs=avc1', 'video/mp4', 'audio/mp4'], () => {
  const v = mod.pickVideoMimeType()
  const a = mod.pickAudioMimeType()
  assert('video never resolves to webm', !!v && !v.includes('webm'), `got ${v}`)
  assert('video picks mp4', v === 'video/mp4;codecs=avc1', `got ${v}`)
  assert('audio never resolves to webm', !!a && !a.includes('webm'), `got ${a}`)
  assert('audio picks mp4', a === 'audio/mp4', `got ${a}`)
})

console.log('\n=== Firefox: webm, no vp9 recorder ===')
withBrowser(['video/webm', 'audio/webm', 'audio/ogg;codecs=opus'], () => {
  assert('video falls back to plain webm', mod.pickVideoMimeType() === 'video/webm')
  assert('audio falls back to plain webm', mod.pickAudioMimeType() === 'audio/webm')
})

console.log('\n=== nothing supported → undefined, never a bad guess ===')
withBrowser([], () => {
  assert('video undefined', mod.pickVideoMimeType() === undefined)
  assert('options are empty, so the browser chooses', Object.keys(mod.recorderOptions('video')).length === 0)
})
withBrowser(null, () => {
  assert('no isTypeSupported → undefined', mod.pickVideoMimeType() === undefined)
})

console.log('\n=== extensions follow the container ===')
assert('mp4', mod.extensionFor('video/mp4;codecs=avc1') === 'mp4')
assert('webm', mod.extensionFor('video/webm;codecs=vp9,opus') === 'webm')
assert('ogg', mod.extensionFor('audio/ogg;codecs=opus') === 'ogg')
assert('undefined defaults to webm', mod.extensionFor(undefined) === 'webm')

console.log(failures === 0 ? '\nAll codec assertions passed\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)

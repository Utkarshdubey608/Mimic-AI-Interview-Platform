/**
 * The asset contract for the per-format demo videos. Pure — no DOM, no React.
 *   npx tsx src/features/marketing/demoAssets.test.ts
 */
import { DEMO_TRACKS, DEMO_COPY, RECORDED_TRACKS, hasDemo, demoVideoSrc, demoPosterSrc } from './demoAssets'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ', ' + extra : ''}`)
  if (!cond) failures++
}

// The five advertised formats, and ONLY those. The sixth track (`video`) is
// deliberately unadvertised — see MimicSite.tsx and audit-marketing-claims.ts.
assert('exactly five demo tracks', DEMO_TRACKS.length === 5, `got ${DEMO_TRACKS.length}`)
assert('recorded video is not advertised', !(DEMO_TRACKS as readonly string[]).includes('video'))
for (const t of ['chatbot', 'voice', 'video_avatar', 'two_way', 'chat'] as const) {
  assert(`${t} is present`, (DEMO_TRACKS as readonly string[]).includes(t))
}

// Paths are derived from the track key, so the recorder and the site cannot drift.
assert('video path', demoVideoSrc('voice') === '/mimic-shots/mode-voice.webm')
assert('poster path', demoPosterSrc('voice') === '/mimic-shots/mode-voice-poster.webp')
assert('underscored key survives', demoVideoSrc('video_avatar') === '/mimic-shots/mode-video_avatar.webm')

// Every track carries copy; alt text has to describe the footage, not label it.
for (const t of DEMO_TRACKS) {
  assert(`${t} has a caption`, DEMO_COPY[t].caption.length > 20)
  assert(`${t} has real alt text`, DEMO_COPY[t].alt.length > 60)
  assert(`${t} alt is not a filename`, !DEMO_COPY[t].alt.includes('.webm'))
}

// Paths must be unique, or two cards would show the same clip.
const paths = new Set(DEMO_TRACKS.map(demoVideoSrc))
assert('every track has a distinct video', paths.size === DEMO_TRACKS.length)

// A format with no footage must degrade to its static card, never to a broken
// player — so the recorded list has to be a real subset of the advertised one,
// and hasDemo has to agree with it.
assert('recorded tracks are all advertised tracks',
  RECORDED_TRACKS.every((t) => (DEMO_TRACKS as readonly string[]).includes(t)),
  RECORDED_TRACKS.join(', '))
assert('at least one format is recorded', RECORDED_TRACKS.length > 0)
// Keep in step with the DemoVideo in MimicSite's hero. An unrecorded hero is
// the one missing-footage case that does NOT degrade to a static card — it
// paints an empty player above the fold.
const HERO_TRACK = 'video_avatar'
assert(`the hero format (${HERO_TRACK}) is recorded`, hasDemo(HERO_TRACK))
for (const t of DEMO_TRACKS) {
  assert(`hasDemo(${t}) matches the recorded list`,
    hasDemo(t) === (RECORDED_TRACKS as readonly string[]).includes(t))
}

// The disclosure chip is a claim about provenance, so an empty or whitespace
// override would silently drop the label rather than correct it.
for (const t of DEMO_TRACKS) {
  const d = DEMO_COPY[t].disclosure
  assert(`${t} disclosure is absent or meaningful`, d === undefined || d.trim().length > 3, d ?? '(default)')
}

console.log(`\n${failures === 0 ? '✅ ALL DEMO-ASSET TESTS PASSED' : `❌ ${failures} ASSERTION(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

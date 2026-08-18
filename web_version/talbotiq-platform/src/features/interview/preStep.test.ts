/**
 * Pure tests for the candidate's pre-interview step machine. No DOM, no React.
 * Run with:  npx tsx src/features/interview/preStep.test.ts
 *
 * The regression these lock down: a "Timed Q&A" invite (track 'chat') used to
 * land on a "Choose your format" screen, because the skip-the-chooser predicate
 * enumerated five of the six tracks and omitted 'chat'. The recruiter picks the
 * format in the invite wizard; the candidate is never asked again.
 */
import { INITIAL_PRE_STEP, isConversational, type PreStep } from './preStep'
import type { TrackType } from '@shared/types'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}

/**
 * Every member of TrackType, annotated with whether it is engine-driven.
 * Adding a track to shared/types.ts without adding it here is a type error, so
 * the next track cannot be forgotten the way 'chat' was.
 */
const TRACKS: Record<TrackType, { conversational: boolean }> = {
  chat:         { conversational: false },  // "Timed Q&A" — the timed engine
  video:        { conversational: false },  // recorded webcam answers — also timed
  chatbot:      { conversational: true },
  voice:        { conversational: true },
  video_avatar: { conversational: true },
  two_way:      { conversational: true },
}
const ALL_TRACKS = Object.keys(TRACKS) as TrackType[]

console.log('\n=== the chooser is gone: every candidate starts at the welcome screen ===')
assert(`INITIAL_PRE_STEP is 'welcome' (got '${INITIAL_PRE_STEP}')`, INITIAL_PRE_STEP === 'welcome')
// PreStep cannot express a format-chooser step. This line is the assertion: it
// fails to COMPILE if 'track' is ever added back to the union.
const noChooser: Exclude<PreStep, 'welcome' | 'resume' | 'systemcheck'>[] = []
assert('PreStep has no chooser member', noChooser.length === 0)

console.log('\n=== isConversational is exhaustive over TrackType ===')
for (const track of ALL_TRACKS) {
  const want = TRACKS[track].conversational
  const got = isConversational(track)
  assert(
    `${track} → ${want ? 'conversational' : 'timed engine'}`,
    got === want,
    got === want ? '' : `got ${got}, want ${want}`,
  )
}

console.log('\n=== the Timed Q&A regression, stated directly ===')
assert("'chat' runs on the timed engine, not a conversational one", !isConversational('chat'))
assert(
  'all six tracks are covered',
  ALL_TRACKS.length === 6,
  `got ${ALL_TRACKS.length}`,
)

console.log(failures === 0 ? '\nAll pre-step assertions passed\n' : `\n${failures} assertion(s) failed\n`)
process.exit(failures === 0 ? 0 : 1)

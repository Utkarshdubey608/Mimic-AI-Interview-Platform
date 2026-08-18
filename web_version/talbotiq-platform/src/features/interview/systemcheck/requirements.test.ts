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

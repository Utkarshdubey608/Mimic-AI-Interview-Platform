/**
 * Run with:  npx tsx src/lib/humanizeDashes.test.ts
 * Mirrors backend/tests/web/test_web_dashes.py so written and generated copy
 * cannot drift apart.
 */
import { humanizeDashes } from './humanizeDashes'

let failures = 0
function eq(label: string, actual: string, expected: string) {
  const ok = actual === expected
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got "${actual}"`}`)
  if (!ok) failures++
}

console.log('\n=== dash-style punctuation goes ===')
eq('em dash', humanizeDashes('Tell me — briefly — about Kafka.'), 'Tell me, briefly, about Kafka.')
eq('en dash', humanizeDashes('A – B'), 'A, B')
eq('spaced hyphen', humanizeDashes('Tell me - briefly - about Kafka.'), 'Tell me, briefly, about Kafka.')
eq(
  'the real welcome message from the screenshot',
  humanizeDashes('answer naturally — there are no trick questions.'),
  'answer naturally, there are no trick questions.',
)

console.log('\n=== real hyphens survive ===')
for (const w of ['auto-submits', 'back-end', 'e-commerce', 'Anne-Marie', 'ai-video-avatar', 'real-time', '3-5']) {
  eq(w, humanizeDashes(`Describe your ${w} work.`), `Describe your ${w} work.`)
}

console.log('\n=== tidy-up ===')
eq('no double commas', humanizeDashes('a — , b'), 'a, b')
eq('no comma before a stop', humanizeDashes('done — .'), 'done.')
eq('empty is safe', humanizeDashes(''), '')
eq('null is safe', humanizeDashes(null), '')

console.log(failures === 0 ? '\nAll dash assertions passed\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)

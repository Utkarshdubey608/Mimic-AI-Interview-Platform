/** Run: npx tsx src/features/interview/captionMerge.test.ts */
import { applyLocal, applyRemote, type MergedCaption } from './captionMerge'

let failures = 0
function assert(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failures++
}

const shape = (c: MergedCaption[]) => c.map((x) => `${x.role}:${x.text}`).join(' | ')

/* ── The reported bug, reproduced exactly ─────────────────────────────────
   The candidate says "Sure, let's start." The interviewer's next question
   streams in and finishes. ONLY THEN does Gemini emit the candidate's
   transcript. Before the fix this appended at the end, so the rail read:
     YOU / AI INTERVIEWER / YOU   with the candidate's line after the question
   it was actually answering.                                              */
{
  let c: MergedCaption[] = []

  // 1. The local recogniser opens the candidate's line WHILE they speak.
  c = applyLocal(c, 'sure')
  c = applyLocal(c, "sure let's")
  c = applyLocal(c, "sure let's start")
  assert('local text appears immediately', shape(c) === "candidate:sure let's start")
  assert('local line is marked local', c[0].local === true)

  // 2. The interviewer's next question streams in and completes.
  c = applyRemote(c, 'interviewer', 'In your Employer, Worker', false)
  c = applyRemote(c, 'interviewer', 'In your Employer, Worker Registration System…', true)
  assert('question lands AFTER the candidate line',
    shape(c) === "candidate:sure let's start | interviewer:In your Employer, Worker Registration System…")

  // 3. Gemini finally emits the candidate's authoritative transcript — LATE.
  c = applyRemote(c, 'candidate', "Sure, let's start.", true)

  assert('late transcript overwrites in place, does NOT append',
    shape(c) === "candidate:Sure, let's start. | interviewer:In your Employer, Worker Registration System…")
  assert('conversation stays in the order it was spoken', c[0].role === 'candidate')
  assert('no duplicate candidate line', c.filter((x) => x.role === 'candidate').length === 1)
  assert('confirmed line is no longer marked local', c[0].local === false)
  assert('confirmed line is final', c[0].final === true)
}

/* ── Authoritative text replaces the local guess, not appends beside it ─── */
{
  let c: MergedCaption[] = []
  c = applyLocal(c, 'i optimized sequel queries')          // local mishears
  c = applyRemote(c, 'candidate', 'I optimised SQL queries.', true)
  assert('Gemini wording wins over the local guess',
    shape(c) === 'candidate:I optimised SQL queries.')
  assert('exactly one line, not two', c.length === 1)
}

/* ── Two candidate utterances confirmed out of order stay in order ──────── */
{
  let c: MergedCaption[] = []
  c = applyLocal(c, 'first thing')
  c = applyRemote(c, 'interviewer', 'Go on.', true)
  c = applyLocal(c, 'second thing')
  // Gemini confirms the FIRST utterance now.
  c = applyRemote(c, 'candidate', 'First thing.', true)
  assert('oldest unconfirmed slot is claimed first',
    shape(c) === 'candidate:First thing. | interviewer:Go on. | candidate:second thing')
  c = applyRemote(c, 'candidate', 'Second thing.', true)
  assert('second confirmation fills the second slot',
    shape(c) === 'candidate:First thing. | interviewer:Go on. | candidate:Second thing.')
}

/* ── A new utterance after an interviewer turn opens a NEW line ─────────── */
{
  let c: MergedCaption[] = []
  c = applyLocal(c, 'yes')
  c = applyRemote(c, 'candidate', 'Yes.', true)
  c = applyRemote(c, 'interviewer', 'Great, next question.', true)
  c = applyLocal(c, 'well i think')
  assert('a fresh utterance is its own line',
    shape(c) === 'candidate:Yes. | interviewer:Great, next question. | candidate:well i think')
  assert('four turns total', c.length === 3)
}

/* ── Interviewer partials extend, never duplicate ───────────────────────── */
{
  let c: MergedCaption[] = []
  c = applyRemote(c, 'interviewer', 'Hello', false)
  c = applyRemote(c, 'interviewer', 'Hello there', false)
  c = applyRemote(c, 'interviewer', 'Hello there, ready?', true)
  assert('interviewer partials collapse to one line', c.length === 1)
  assert('interviewer final text is the last one', c[0].text === 'Hello there, ready?')
}

/* ── Idempotence: identical local text must not churn React state ───────── */
{
  let c: MergedCaption[] = []
  c = applyLocal(c, 'hello')
  const same = applyLocal(c, 'hello')
  assert('unchanged local text returns the SAME array reference', same === c)
  const empty = applyLocal(c, '')
  assert('empty local text is a no-op', empty === c)
}

/* ── Gemini arriving with no local line at all (no Web Speech API) ──────── */
{
  let c: MergedCaption[] = []
  c = applyRemote(c, 'interviewer', 'Question one.', true)
  c = applyRemote(c, 'candidate', 'My answer.', true)
  assert('degrades to plain append when there is no local recogniser',
    shape(c) === 'interviewer:Question one. | candidate:My answer.')
}

console.log(`\n${failures === 0 ? '✅ ALL CAPTION-MERGE TESTS PASSED' : `❌ ${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

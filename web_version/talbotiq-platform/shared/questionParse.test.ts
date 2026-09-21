/**
 * Deterministic unit tests for the question importer. Run with:
 *   npx tsx shared/questionParse.test.ts
 * Pure functions — no network, no Gemini, no Firestore.
 *
 * Every fixture below is a shape a real paste actually arrives in. The point of
 * the module is that a recruiter never has to reformat anything, so the tests
 * are written as "this is what ChatGPT gave them" rather than as unit cases.
 */
import { parseQuestionsFromText, questionsFromRows, cleanText, llmPromptFor } from './questionParse'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}
const eq = (label: string, actual: unknown, expected: unknown) =>
  assert(label, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}`)

console.log('\n=== cleanText ===')
eq('strips markdown emphasis', cleanText('**What is `useMemo`?**'), 'What is useMemo?')
eq('collapses whitespace', cleanText('  What   is\tthis? '), 'What is this?')
eq('strips wrapping quotes', cleanText('“Tell me about a failure.”'), 'Tell me about a failure.')

console.log('\n=== parseQuestionsFromText — numbered (the ChatGPT default) ===')
{
  const qs = parseQuestionsFromText(`Here are 3 interview questions for a backend engineer:

1. Walk me through how you'd design a rate limiter.
2. What trade-offs did you hit with Kafka at your last job?
3. Tell me about a production incident you owned.

Hope this helps!`)
  eq('drops the preamble and the sign-off', qs.length, 3)
  eq('strips the number', qs[0].text, "Walk me through how you'd design a rate limiter.")
  eq('keeps the last one', qs[2].text, 'Tell me about a production incident you owned.')
}

console.log('\n=== parseQuestionsFromText — the other five numbering dialects ===')
{
  const qs = parseQuestionsFromText(`1) First question here?
(2) Second question here?
3 - Third question here?
Q4. Fourth question here?
Q: Fifth question here?
Question 6 — Sixth question here?`)
  eq('all six shapes recognised', qs.length, 6)
  eq('(n) stripped', qs[1].text, 'Second question here?')
  eq('Q: stripped', qs[4].text, 'Fifth question here?')
  eq('Question n — stripped', qs[5].text, 'Sixth question here?')
}

console.log('\n=== parseQuestionsFromText — bullets + headings become categories ===')
{
  const qs = parseQuestionsFromText(`## Technical Questions
- How does a database index work?
- When would you denormalise?

**Behavioural questions:**
* Tell me about a disagreement with a manager.`)
  eq('three questions', qs.length, 3)
  eq('heading → category', qs[0].category, 'Technical')
  eq('category carries down the section', qs[1].category, 'Technical')
  eq('second heading switches category', qs[2].category, 'Behavioural')
  eq('bullet stripped', qs[2].text, 'Tell me about a disagreement with a manager.')
}

console.log('\n=== parseQuestionsFromText — metadata lines attach upward ===')
{
  const qs = parseQuestionsFromText(`1. How would you shard this table?
Category: Databases
Ideal answer: names a shard key, mentions hot partitions and resharding cost.

2. Why did you leave your last role?
A: looks for a concrete, non-blaming reason.`)
  eq('two questions, not six', qs.length, 2)
  eq('explicit category wins', qs[0].category, 'Databases')
  eq('ideal answer captured', qs[0].idealAnswerNotes, 'names a shard key, mentions hot partitions and resharding cost.')
  eq('A: is scoring notes, not a question', qs[1].idealAnswerNotes, 'looks for a concrete, non-blaming reason.')
}

console.log('\n=== parseQuestionsFromText — wrapped lines vs. unmarked lists ===')
{
  const wrapped = parseQuestionsFromText(`What is the difference between
optimistic and pessimistic locking?`)
  eq('an unfinished line continues', wrapped.length, 1)
  eq('joined with a single space', wrapped[0].text, 'What is the difference between optimistic and pessimistic locking?')

  const list = parseQuestionsFromText(`What is your greatest strength?
What is your greatest weakness?
Why this company?`)
  eq('finished lines stay separate', list.length, 3)
}

console.log('\n=== parseQuestionsFromText — junk in, nothing out ===')
{
  eq('empty string', parseQuestionsFromText(''), [])
  eq('whitespace only', parseQuestionsFromText('   \n\n  '), [])
  eq('too short to be a question', parseQuestionsFromText('N/A\n---\n42'), [])
  const dupes = parseQuestionsFromText('1. Why SQL over NoSQL here?\n2. Why SQL over NoSQL here?')
  eq('duplicates removed', dupes.length, 1)
}

console.log('\n=== questionsFromRows — Excel / CSV with a header ===')
{
  const r = questionsFromRows([
    ['Ideal answer', 'Question', 'Topic'],
    ['mentions idempotency', 'How do you make a webhook safe to retry?', 'APIs'],
    ['', '  2. What is a dead letter queue?  ', 'Queues'],
    ['', '', ''],
  ])
  eq('columns mapped by name, in any order', r.questions.length, 2)
  eq('headered', r.headered, true)
  eq('question column found', r.questions[0].text, 'How do you make a webhook safe to retry?')
  eq('notes column found', r.questions[0].idealAnswerNotes, 'mentions idempotency')
  eq('category column found', r.questions[1].category, 'Queues')
  eq('numbering inside a cell stripped', r.questions[1].text, 'What is a dead letter queue?')
  eq('no warnings for a clean headered sheet', r.warnings, [])
}

console.log('\n=== questionsFromRows — no header row ===')
{
  const r = questionsFromRows([
    ['Tell me about a system you designed end to end.', 'Design'],
    ['How do you decide what to test?', 'Quality'],
  ])
  eq('still imports', r.questions.length, 2)
  eq('not headered', r.headered, false)
  eq('short second column read as category', r.questions[0].category, 'Design')
  assert('warns that the column was guessed', r.warnings.some((w) => w.includes('No “Question” header')))
}

console.log('\n=== questionsFromRows — empty sheet ===')
{
  const r = questionsFromRows([])
  eq('no questions', r.questions.length, 0)
  assert('says so', r.warnings.length > 0)
}

console.log('\n=== llmPromptFor ===')
{
  const p = llmPromptFor({ count: 8, role: 'Data Analyst', difficulty: 'hard' })
  assert('asks for the count', p.includes('Write 8 interview questions'))
  assert('names the role', p.includes('for a Data Analyst role'))
  assert('pins the difficulty', p.includes('hard difficulty'))
  assert('specifies the parseable shape', p.includes('Category:') && p.includes('Ideal answer:'))
  // The prompt is only useful if what it asks for is what the parser reads.
  const round = parseQuestionsFromText(`1. What does a p95 latency of 400ms tell you?
Category: Analytics
Ideal answer: distinguishes tail from average.`)
  eq('round-trips through the parser', round.length, 1)
  eq('…with its category', round[0].category, 'Analytics')
}

console.log(failures === 0 ? '\nAll question-import tests passed.\n' : `\n${failures} FAILURE(S)\n`)
process.exit(failures === 0 ? 0 : 1)

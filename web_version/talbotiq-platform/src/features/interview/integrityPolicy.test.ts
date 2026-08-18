/** Run: npx tsx src/features/interview/integrityPolicy.test.ts */
import { completionCallFor, decideIntegrity, integrityCopy } from './integrityPolicy'
import type { TrackType } from '@shared/types'

let failures = 0
function assert(label: string, cond: boolean) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failures++
}

/* ── The escalation, with the default limit of 3 ────────────────────────── */
{
  const a = decideIntegrity(1, 3)
  assert('first switch warns', a.action === 'warn')
  assert('first switch leaves 2', a.action === 'warn' && a.remaining === 2)

  const b = decideIntegrity(2, 3)
  assert('second switch warns', b.action === 'warn')
  assert('second switch leaves 1', b.action === 'warn' && b.remaining === 1)

  const c = decideIntegrity(3, 3)
  assert('third switch TERMINATES', c.action === 'terminate')

  const d = decideIntegrity(4, 3)
  assert('past the limit still terminates, never wraps to warn', d.action === 'terminate')
}

/* ── No limit configured means nothing is enforced ──────────────────────────
   The recruiter has to opt in. Enforcing a limit nobody set would end
   interviews on a setting the recruiter never chose.                       */
{
  assert('undefined max is ignored', decideIntegrity(5, undefined).action === 'ignore')
  assert('zero max is ignored', decideIntegrity(5, 0).action === 'ignore')
  assert('negative max is ignored', decideIntegrity(5, -1).action === 'ignore')
  assert('undefined count is ignored', decideIntegrity(undefined, 3).action === 'ignore')
}

/* ── A limit of 1 terminates on the very first departure ────────────────── */
{
  const one = decideIntegrity(1, 1)
  assert('max of 1 terminates immediately', one.action === 'terminate')
}

/* ── Every track ends through the right endpoint ────────────────────────────
   Calling the timed engine's complete() on an avatar interview would leave the
   Tavus room running while the UI claimed the interview was over.          */
{
  const cases: Array<[TrackType, string]> = [
    ['chat', 'complete'],
    ['chatbot', 'complete'],
    ['voice', 'complete'],
    ['video', 'complete'],
    ['video_avatar', 'avatarComplete'],
    ['two_way', 'twowayComplete'],
  ]
  for (const [track, expected] of cases) {
    assert(`${track} completes via ${expected}`, completionCallFor(track) === expected)
  }
  assert('all six tracks are covered', cases.length === 6)
}

/* ── Copy: says what happened, what it cost, and what happens next ──────── */
{
  const warn = integrityCopy('tab_switch', decideIntegrity(1, 3))
  assert('warn names the action', warn.body.includes('switched away'))
  assert('warn states what remains', warn.body.includes('2 left'))
  assert('warn can be continued', warn.confirm === 'Continue interview')

  const last = integrityCopy('tab_switch', decideIntegrity(2, 3))
  assert('final warning is singular and explicit', last.body.includes('One more'))

  const dead = integrityCopy('tab_switch', decideIntegrity(3, 3))
  assert('termination says the interview ended', dead.title === 'Your interview has ended')
  assert('termination says answers were submitted', dead.body.includes('submitted'))
  assert('termination offers no way to continue', dead.confirm === 'Close')

  const fs = integrityCopy('fullscreen_exit', decideIntegrity(1, 3))
  assert('fullscreen wording differs from tab wording', fs.body.includes('left fullscreen'))
}

/* ── No em dashes anywhere in candidate-facing copy ─────────────────────────
   The user banned them explicitly.                                          */
{
  const strings: string[] = []
  for (const kind of ['tab_switch', 'fullscreen_exit'] as const) {
    for (const used of [1, 2, 3]) {
      const c = integrityCopy(kind, decideIntegrity(used, 3))
      strings.push(c.title, c.body, c.confirm)
    }
  }
  assert('no em dash in any integrity copy', !strings.some((s) => s.includes('—')))
  assert('no en dash in any integrity copy', !strings.some((s) => s.includes('–')))
}

console.log(`\n${failures === 0 ? '✅ ALL INTEGRITY-POLICY TESTS PASSED' : `❌ ${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

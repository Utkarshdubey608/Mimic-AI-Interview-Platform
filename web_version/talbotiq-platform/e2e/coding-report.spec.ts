import { test, expect, type Page } from '@playwright/test'

/**
 * The recruiter's coding report, driven in a real browser.
 *
 * WHY THIS EXISTS. Two of the three failure modes this screen can have are
 * invisible to a unit test:
 *
 *   · IT NEVER RENDERS. A coding assessment is scored by arithmetic on the
 *     judge's verdicts, so `reports/{id}` is never written for it. The page used
 *     to gate everything on that document, which for this track meant "Scoring in
 *     progress" forever and a refetch every 2.5 seconds until the tab closed. The
 *     backend contract was correct throughout.
 *   · IT SHOWS THE WRONG THING TO THE WRONG PERSON. A recruiter must see every
 *     hidden test's verdict — it is their own paper. The candidate must not. Both
 *     halves are assertions about pixels.
 *
 * The API is mocked. This asserts the SCREEN's behaviour; the composition of the
 * block is already covered by backend/tests/web/test_web_coding_report.py.
 *
 * It runs at /__report/:id, a dev-only harness route outside the identity gate,
 * because a Playwright run has no Firebase session and stubbing auth would put a
 * bypass into the path production uses.
 */

const CODE = 'def solve():\n    a, b = map(int, input().split())\n    print(a + b)'

/** A graded assessment: one problem passed, one attempted and failing, one untouched. */
const REPORT = {
  session: {
    id: 's-coding',
    candidate: { name: 'Ada Lovelace', email: 'ada@example.test' },
    templateName: 'Backend screen',
    track: 'coding',
    status: 'completed',
    createdAt: '2026-08-27T04:00:00+00:00',
    completedAt: '2026-08-27T04:52:00+00:00',
    questions: [],
    integrityEvents: [{ type: 'tab_switch', at: '2026-08-27T04:30:00+00:00' }],
    tabSwitchCount: 2,
  },
  rubric: { kpis: [] },
  report: null,
  coding: {
    score: 13,
    maxScore: 30,
    percent: 43.3,
    attempted: 2,
    slowestCaseMs: 412,
    languages: ['python', 'java'],
    submittedAt: '2026-08-27T04:52:00+00:00',
    problems: [
      {
        id: 'p1',
        title: 'Sum of Two Integers',
        difficulty: 'easy',
        timeLimitMs: 2000,
        memoryMb: 128,
        attempted: true,
        maxScore: 10,
        caseCount: 3,
        score: 10,
        percent: 100,
        passed: 3,
        total: 3,
        language: 'python',
        code: CODE,
        compileFailed: false,
        at: '2026-08-27T04:20:00+00:00',
        cases: [
          { id: 'c1', hidden: false, status: 'accepted', passed: true, points: 2, awarded: 2, timeMs: 11, memoryKb: 3200 },
          { id: 'c2', hidden: true, status: 'accepted', passed: true, points: 4, awarded: 4, timeMs: 14, memoryKb: 3400 },
          { id: 'c3', hidden: true, status: 'accepted', passed: true, points: 4, awarded: 4, timeMs: 19, memoryKb: 3600 },
        ],
      },
      {
        id: 'p2',
        title: 'Longest Balanced Window',
        difficulty: 'hard',
        timeLimitMs: 3000,
        memoryMb: 256,
        attempted: true,
        maxScore: 10,
        caseCount: 3,
        score: 3,
        percent: 30,
        passed: 1,
        total: 3,
        language: 'java',
        code: 'class Main { }',
        compileFailed: false,
        at: '2026-08-27T04:44:00+00:00',
        cases: [
          { id: 'd1', hidden: false, status: 'accepted', passed: true, points: 3, awarded: 3, timeMs: 88, memoryKb: 30000 },
          { id: 'd2', hidden: true, status: 'wrong_answer', passed: false, points: 3, awarded: 0, timeMs: 91, memoryKb: 30500 },
          { id: 'd3', hidden: true, status: 'time_limit', passed: false, points: 4, awarded: 0, timeMs: 412, memoryKb: 31000 },
        ],
      },
      {
        id: 'p3',
        title: 'Median of Two Sorted Arrays',
        difficulty: 'hard',
        attempted: false,
        maxScore: 10,
        caseCount: 4,
        score: null,
        percent: null,
        passed: null,
        total: null,
        language: null,
        code: null,
        cases: [],
        draft: '# started, never submitted\ndef median(a, b):',
      },
    ],
  },
}

async function mockReport(page: Page, body: unknown = REPORT) {
  await page.route('**/api/web/sessions/**/report', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  )
}

test.describe('the coding report', () => {
  test('renders without a model-written report, instead of waiting for one forever', async ({ page }) => {
    await mockReport(page)
    await page.goto('/__report/s-coding')

    // The regression: this text is what the page showed for the whole life of a
    // coding session, because `report` is null and always will be.
    await expect(page.getByText(/Scoring in progress/i)).toHaveCount(0)

    await expect(page.getByRole('heading', { name: 'Ada Lovelace' })).toBeVisible()
    // Two distinct things, hence the roles: the track label in the masthead and
    // the panel that holds the breakdown.
    await expect(page.getByText('Coding Assessment', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Coding assessment' })).toBeVisible()
    // The gauge carries the judge's own percentage, rounded.
    await expect(page.getByText('43', { exact: true })).toBeVisible()
    await expect(page.getByText('13 / 30')).toBeVisible()
  })

  test('shows every problem, including the one nobody submitted', async ({ page }) => {
    await mockReport(page)
    await page.goto('/__report/s-coding')

    await expect(page.getByRole('heading', { name: 'Sum of Two Integers' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Longest Balanced Window' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Median of Two Sorted Arrays' })).toBeVisible()
    await expect(page.getByText('Not submitted')).toBeVisible()
    await expect(page.getByText('Left in the editor, never submitted')).toBeVisible()
    await expect(page.getByText('def median(a, b):')).toBeVisible()
  })

  test('gives the recruiter every hidden verdict, in words as well as colour', async ({ page }) => {
    await mockReport(page)
    await page.goto('/__report/s-coding')

    const failing = page.locator('table').nth(1)
    // Three rows, two of them hidden, each naming WHY it failed. A candidate's
    // view of the same submission reports hidden failures with no reason at all.
    await expect(failing.getByText('Hidden')).toHaveCount(2)
    await expect(failing.getByText('Wrong answer')).toBeVisible()
    await expect(failing.getByText('Time limit')).toBeVisible()
    await expect(failing.getByText('412 ms')).toBeVisible()
  })

  test('keeps the submitted program collapsed until it is asked for', async ({ page }) => {
    await mockReport(page)
    await page.goto('/__report/s-coding')

    await expect(page.getByText('a, b = map(int, input().split())')).toHaveCount(0)
    await page.getByRole('button', { name: /Submitted program/i }).first().click()
    await expect(page.getByText('a, b = map(int, input().split())')).toBeVisible()
  })

  test('says so when the candidate is still working', async ({ page }) => {
    await mockReport(page, {
      ...REPORT,
      session: { ...REPORT.session, status: 'in_progress', completedAt: undefined },
    })
    await page.goto('/__report/s-coding')

    await expect(page.getByText('Still in progress')).toBeVisible()
    // And the totals are still shown, rather than hidden behind a spinner: a
    // recruiter watching a live assessment wants the partial answer.
    await expect(page.getByText('13 / 30')).toBeVisible()
  })

  test('an assessment with no problems reads as empty, not as broken', async ({ page }) => {
    await mockReport(page, {
      ...REPORT,
      coding: { ...REPORT.coding, problems: [], attempted: 0, score: 0, maxScore: 0, percent: 0, slowestCaseMs: null, languages: [] },
    })
    await page.goto('/__report/s-coding')

    await expect(page.getByText('No problems in this assessment')).toBeVisible()
    await expect(page.getByText(/Couldn’t load this report/i)).toHaveCount(0)
  })
})

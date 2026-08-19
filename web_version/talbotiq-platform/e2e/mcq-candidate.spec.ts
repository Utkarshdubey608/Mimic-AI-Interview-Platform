import { test, expect, type Page } from '@playwright/test'

/**
 * The candidate's MCQ paper, driven in a real browser.
 *
 * WHY THIS EXISTS SEPARATELY from the authoring spec: this is the IRREVERSIBLE
 * path. A recruiter who mis-edits a paper opens it again. A candidate sits the
 * assessment once and is scored on what happens in this component, and the
 * failures that matter here are not wrong values — they are:
 *
 *   · a reload that loses twenty answers;
 *   · a Submit that drops the answer typed a moment before it;
 *   · an answer key readable in the page.
 *
 * The first two are behaviour over time and only exist in a browser. The whole
 * authoring suite could pass while any of them was true.
 *
 * Runs at /__mcq-take, a dev-only harness outside the identity gate.
 */

const PAPER = {
  sessionId: 'e2e-session',
  status: 'in_progress',
  answers: {},
  submittedAt: null,
  questions: [
    {
      id: 'q1',
      text: 'What does EC2 stand for?',
      type: 'single',
      points: 1,
      options: [
        { id: 'a', text: 'Elastic Compute Cloud' },
        { id: 'b', text: 'Elastic Container Cloud' },
        { id: 'c', text: 'Encrypted Compute Cluster' },
      ],
    },
    {
      id: 'q2',
      text: 'Which of these are AWS services?',
      type: 'multi',
      points: 1,
      options: [
        { id: 'a', text: 'S3' },
        { id: 'b', text: 'IAM' },
        { id: 'c', text: 'Azure Blob Storage' },
      ],
    },
  ],
}

type Server = { answers: Record<string, string[]>; submitted: boolean; saves: number }

/**
 * A server that REMEMBERS, which is the point.
 *
 * A mock that always returns the same empty paper cannot show whether answers
 * survive a reload — the behaviour this spec exists to prove. So saves mutate
 * state and the next GET reflects it, exactly as the real one does.
 */
async function mockServer(page: Page, server: Server) {
  await page.route('**/api/web/sessions/**/mcq**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (url.pathname.endsWith('/mcq/answers')) {
      server.saves += 1
      server.answers = request.postDataJSON().answers ?? {}
      return json({ ok: true, saved: Object.keys(server.answers).length })
    }
    if (url.pathname.endsWith('/mcq/submit')) {
      const late = request.postDataJSON()?.answers
      if (late) server.answers = late
      server.submitted = true
      return json({ ...PAPER, status: 'completed', answers: server.answers, submittedAt: '2026-08-19T12:00:00Z', result: null })
    }
    return json({ ...PAPER, answers: server.answers, submittedAt: server.submitted ? 'x' : null })
  })
}

const fresh = (): Server => ({ answers: {}, submitted: false, saves: 0 })

test.describe('the candidate MCQ paper', () => {
  test('one question at a time, and both directions', async ({ page }) => {
    /* A paper you cannot revisit is a memory test. */
    await mockServer(page, fresh())
    await page.goto('/__mcq-take')

    await expect(page.getByText('Question 1 of 2')).toBeVisible()
    await expect(page.getByText('What does EC2 stand for?')).toBeVisible()
    await expect(page.getByText('Which of these are AWS services?')).toHaveCount(0)

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByText('Question 2 of 2')).toBeVisible()

    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByText('Question 1 of 2')).toBeVisible()
  })

  test('the control matches how many answers the question takes', async ({ page }) => {
    await mockServer(page, fresh())
    await page.goto('/__mcq-take')

    // Single-answer: radios, and choosing a second replaces the first.
    await expect(page.getByRole('radio')).toHaveCount(3)
    await page.getByRole('radio', { name: /Elastic Compute Cloud/ }).click()
    await page.getByRole('radio', { name: /Elastic Container Cloud/ }).click()
    await expect(page.getByRole('radio', { name: /Elastic Compute Cloud/ })).not.toBeChecked()

    // Multi-select: checkboxes, and both stay chosen.
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('checkbox')).toHaveCount(3)
    await page.getByRole('checkbox', { name: /S3/ }).click()
    await page.getByRole('checkbox', { name: /IAM/ }).click()
    await expect(page.getByRole('checkbox', { name: /S3/ })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: /IAM/ })).toBeChecked()
  })

  test('a reload does not cost the candidate their answers', async ({ page }) => {
    /* THE ONE THAT MATTERS MOST. Losing twenty answers to a dropped connection
       or a closed laptop lid is the worst thing this screen could do to somebody's
       application, and it is invisible to every test that does not reload. */
    const server = fresh()
    await mockServer(page, server)
    await page.goto('/__mcq-take')

    await page.getByRole('radio', { name: /Elastic Compute Cloud/ }).click()
    await expect(page.getByText('Answers saved')).toBeVisible()
    expect(server.answers).toEqual({ q1: ['a'] })

    await page.reload()
    await expect(page.getByRole('radio', { name: /Elastic Compute Cloud/ })).toBeChecked()
  })

  test('the answer chosen a moment before Submit still counts', async ({ page }) => {
    /* Answering the last question and pressing Submit immediately must not lose it
       to a debounce that never fired — which is why submit resends everything
       rather than trusting the last auto-save. Asserted by clicking Submit with no
       pause at all. */
    const server = fresh()
    await mockServer(page, server)
    await page.goto('/__mcq-take')

    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('checkbox', { name: /S3/ }).click()
    await page.getByRole('button', { name: 'Submit assessment' }).click()

    await expect.poll(() => server.submitted).toBe(true)
    expect(server.answers).toEqual({ q2: ['a'] })
  })

  test('progress counts what is answered, not where you are', async ({ page }) => {
    /* It tells a candidate what is LEFT, not how far they have scrolled. */
    await mockServer(page, fresh())
    await page.goto('/__mcq-take')

    await expect(page.getByText('0 of 2 answered')).toBeVisible()
    await page.getByRole('radio', { name: /Elastic Compute Cloud/ }).click()
    await expect(page.getByText('1 of 2 answered')).toBeVisible()

    // Moving on without answering must not inflate it.
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByText('1 of 2 answered')).toBeVisible()
  })

  test('an incomplete paper is flagged before submitting, not after', async ({ page }) => {
    await mockServer(page, fresh())
    await page.goto('/__mcq-take')

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByText(/2 questions still unanswered/)).toBeVisible()
  })

  test('submitting ends on the shared completion screen', async ({ page }) => {
    /* All seven modes end the same way; MCQ must not say goodbye differently. */
    await mockServer(page, fresh())
    await page.goto('/__mcq-take')

    await page.getByRole('radio', { name: /Elastic Compute Cloud/ }).click()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByRole('button', { name: 'Submit assessment' }).click()

    await expect(page.getByText('All done, thank you.')).toBeVisible()
  })

  test('nothing in the page reveals which option is correct', async ({ page }) => {
    /* The mock deliberately returns the paper WITHOUT a key, as the server does —
       so this asserts the client never invents, requests or renders one. The
       server's half is asserted against the real payload in
       backend/tests/web/test_web_mcq_journey.py. */
    await mockServer(page, fresh())
    await page.goto('/__mcq-take')
    // Wait for the paper to actually render. Reading page.content() straight after
    // goto asserted against an empty shell and passed for the wrong reason — the
    // first version of this test could not have failed.
    await expect(page.getByText('What does EC2 stand for?')).toBeVisible()

    const html = await page.content()
    expect(html).not.toContain('correctOptionIds')
    expect(html).not.toContain('correct":true')

    // And no styling betrays it either: every option renders identically until
    // chosen, so the right answer cannot be spotted in the DOM.
    const classes = await page
      .getByRole('radio')
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).className))
    expect(new Set(classes).size).toBe(1)
  })
})

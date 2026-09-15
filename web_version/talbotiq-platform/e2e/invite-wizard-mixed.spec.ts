import { test, expect, type Page } from '@playwright/test'

/**
 * Mixed interview mode, driven through the real InviteWizard in a browser.
 *
 * WHY THIS EXISTS. Mixed mode's backend contract (fixed+résumé counts, ad-hoc
 * fixed questions) is thoroughly covered by
 * backend/tests/web/test_interview_invite_resolve_question_source.py and the new
 * HTTP-layer tests in test_web_invites_mode_source_validation.py — but until this
 * spec, nothing had ever driven the actual WIZARD through Mixed mode end to end.
 * That gap is exactly how a real bug shipped invisibly: the wizard sends ad-hoc
 * `fixedQuestions` as a sibling of `mixedConfig`, and the backend used to read it
 * from *inside* `mixed_config` — so every ad-hoc Mixed invite was rejected with
 * "N fixed question(s) are required," and no test caught it because the backend's
 * own unit test called the resolver directly with an already-nested (wrong) shape.
 * This spec asserts the actual request body the wizard produces, so a similar
 * frontend/backend shape mismatch cannot hide again.
 *
 * The API is mocked, not hit — this asserts the SCREEN's behaviour and the
 * request it builds; the server's own validation is covered by the backend
 * suite. Runs at /__invite-wizard, a dev-only harness route outside the
 * identity gate, same reasoning as /__mcq.
 */

async function mockApi(page: Page, opts: { onCreateInvites: (body: any) => void }) {
  await page.route('**/api/web/settings/avatar', (route) =>
    route.fulfill({ json: { configured: false, hasKey: false } }))

  await page.route('**/api/web/question-sets', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] })
    return route.continue()
  })

  await page.route('**/api/web/role-configs/categories', (route) =>
    route.fulfill({ json: [{ slug: 'sde', displayName: 'SDE / Software Engineering' }] }))

  await page.route('**/api/web/invites', (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = route.request().postDataJSON()
    opts.onCreateInvites(body)
    route.fulfill({
      status: 201,
      json: {
        testId: 'test-1',
        created: [{ id: 'i1', email: body.candidates?.[0]?.email ?? 'cand@example.test', link: 'https://example.test/take/i1', sent: true, status: 'accepted' }],
        emailed: 1,
        dryRun: false,
      },
    })
  })
}

test('Mixed mode sends the exact fixed/résumé split and ad-hoc questions the recruiter typed', async ({ page }) => {
  let captured: any = null
  await mockApi(page, { onCreateInvites: (body) => { captured = body } })

  await page.goto('/__invite-wizard')

  // Step 1 — single interview, Timed Q&A, a role (required to advance).
  await page.getByRole('button', { name: /^Single Interview/ }).click()
  await page.getByRole('button', { name: /Timed Q&A/ }).click()
  await page.getByLabel('Candidate role').fill('Software Engineer')
  await page.getByRole('button', { name: /^Next/ }).click()

  // Step 2 — Mixed source, ad-hoc fixed questions.
  await page.getByRole('button', { name: /^Mixed/ }).click()
  await page.getByLabel('Total questions').fill('8')
  await page.getByLabel('Fixed questions').fill('5')
  await page.getByLabel('Résumé-based questions').fill('3')
  await expect(page.getByText(/must add up to the total/)).toHaveCount(0)

  await page.getByRole('button', { name: 'Create questions now' }).click()
  const fixedQuestions = [
    'Explain polymorphism.',
    'Explain REST.',
    'What is indexing?',
    'Explain caching.',
    'Describe a race condition.',
  ]
  for (let i = 0; i < fixedQuestions.length; i++) {
    if (i > 0) await page.getByRole('button', { name: 'Add question' }).click()
    await page.getByLabel(`Fixed question ${i + 1}`).fill(fixedQuestions[i])
  }
  await page.getByRole('button', { name: /^Next/ }).click()

  // Step 3 — one manual candidate, no file upload needed for this assertion.
  await page.getByLabel('Add a candidate email').fill('candidate@example.test')
  await page.getByRole('button', { name: 'Add email' }).click()
  await page.getByRole('button', { name: /^Next/ }).click()

  // Step 4 — invite email: the default template already satisfies the locked-token
  // check, nothing to fill in.
  await page.getByRole('button', { name: /^Next: Review/ }).click()

  // Step 5 — send.
  await page.getByRole('button', { name: /^Send/ }).click()

  await expect(page.getByText(/invite.* created/)).toBeVisible()

  expect(captured).toBeTruthy()
  expect(captured.mode).toBe('chat')
  expect(captured.source).toBe('mixed')
  expect(captured.mixedConfig).toEqual({ totalQuestions: 8, fixedQuestionCount: 5, resumeQuestionCount: 3 })
  expect(captured.fixedQuestions).toEqual(fixedQuestions)
  expect(captured.candidates).toEqual([{ email: 'candidate@example.test', role: 'Software Engineer' }])
})

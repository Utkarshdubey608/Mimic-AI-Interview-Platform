import { test, expect, type Page } from '@playwright/test'

/**
 * The question-set creation wizard, driven in a real browser.
 *
 * WHY THIS EXISTS. The parser is covered exhaustively by
 * shared/questionParse.test.ts, and the routes are thin. What no unit test can
 * see is the thing this screen exists to fix: whether a recruiter arriving with
 * a block of text, a spreadsheet, or nothing at all ends up with a saved set —
 * and whether the four steps gate on what they should. Specifically:
 *
 *   · Next on Step 1 must be DISABLED until the set has a name (the old screen
 *     created "New set" records nobody could find later);
 *   · a paste must show its parsed count BEFORE anything is added, because the
 *     preview is the only chance to spot a formatting problem;
 *   · an import and a paste must land in the SAME draft rather than replacing
 *     each other;
 *   · Save must send the questions in the order shown, since that is the order
 *     the interview asks them in.
 *
 * The API is mocked: this asserts the screen, not the server. It runs at
 * /__question-set-wizard, the dev-only harness route, for the same reason the
 * MCQ spec does — a Playwright run has no Firebase session.
 */

type Created = { name: string; questions: { text: string; category?: string; idealAnswerNotes?: string }[] }

/** Mock every call the wizard makes. Returns what the page tried to save. */
async function mockApi(page: Page, opts: { geminiKeySet?: boolean } = {}) {
  const state: { created: Created | null; generateMoreCount: number; existingSent: string[] } = {
    created: null, generateMoreCount: 0, existingSent: [],
  }

  await page.route('**/api/web/settings', (r) =>
    r.fulfill({ json: { geminiKeySet: opts.geminiKeySet ?? true, source: 'saved', model: 'gemini-2.5-flash' } }))

  await page.route('**/api/web/question-sets/extract', (r) =>
    r.fulfill({
      json: {
        source: 'spreadsheet',
        warnings: ['No “Question” header was found, so column A was read as the questions. Check them below before saving.'],
        questions: [
          { text: 'How do you make a webhook safe to retry?', category: 'APIs', idealAnswerNotes: 'mentions idempotency' },
          { text: 'What is a dead letter queue for?', category: 'Queues' },
        ],
      },
    }))

  await page.route('**/api/web/question-sets/generate-more', async (r) => {
    const body = r.request().postDataJSON() as { count: number; existing: string[] }
    state.generateMoreCount = body.count
    state.existingSent = body.existing
    await r.fulfill({
      json: { questions: Array.from({ length: body.count }, (_, i) => ({ text: `Model-written question ${i + 1}?`, category: 'Generated' })) },
    })
  })

  // POST /api/web/question-sets (create) — the only write the wizard makes.
  await page.route(/\/api\/web\/question-sets$/, async (r) => {
    if (r.request().method() !== 'POST') return r.fulfill({ json: [] })
    state.created = r.request().postDataJSON() as Created
    await r.fulfill({ status: 201, json: { id: 'set-1', ...state.created, createdAt: '', updatedAt: '' } })
  })

  return state
}

const openWizard = async (page: Page) => {
  await page.goto('/__question-set-wizard')
  await expect(page.getByRole('heading', { name: 'Build a question set' })).toBeVisible()
}

/** Step 1 → Step 2, filling in the name and count. */
async function fillBasics(page: Page, name: string, count: number) {
  await page.getByLabel('Set name').fill(name)
  await page.getByLabel('How many questions').fill(String(count))
  await page.getByRole('button', { name: /Next: Source/ }).click()
}

test.describe('question-set wizard', () => {
  test('Step 1 will not advance without a name', async ({ page }) => {
    await mockApi(page)
    await openWizard(page)

    const next = page.getByRole('button', { name: /Next: Source/ })
    await expect(next).toBeDisabled()
    // Rendered twice by the shared footer — beside the button on a desktop,
    // wrapped below it on a phone. Either way the recruiter must SEE why.
    await expect(page.getByText('Name the set to continue.').filter({ visible: true })).toBeVisible()

    await page.getByLabel('Set name').fill('Backend — first round')
    await expect(next).toBeEnabled()
  })

  test('pastes an LLM reply, previews what it found, and saves it in order', async ({ page }) => {
    const state = await mockApi(page)
    await openWizard(page)
    await fillBasics(page, 'Backend — first round', 3)

    await page.getByRole('button', { name: /Paste from an LLM/ }).click()

    await page.getByLabel('Paste questions here').fill(
      'Here are 3 questions for a backend engineer:\n\n' +
      '1. Walk me through how you would design a rate limiter.\n' +
      'Category: System design\n' +
      'Ideal answer: names a token bucket.\n' +
      '2. What trade-offs did you hit with Kafka?\n' +
      '3. Tell me about an incident you owned.\n',
    )

    // The preview counts BEFORE anything is added — the whole point of it.
    await expect(page.getByText('3 questions found.')).toBeVisible()
    // Scoped to the preview list: the same sentence is also in the textarea.
    await expect(page.getByRole('list').getByText('Walk me through how you would design a rate limiter.')).toBeVisible()

    await page.getByRole('button', { name: /Add 3 to the set/ }).click()

    // Adding jumps to review, where the parsed metadata survived the trip.
    await expect(page.getByText('3 of 3 questions')).toBeVisible()
    await expect(page.getByLabel('Question 1 category')).toHaveValue('System design')
    await expect(page.getByLabel('Question 1 ideal answer notes')).toHaveValue('names a token bucket.')

    await page.getByRole('button', { name: 'Save question set' }).click()
    await expect.poll(() => state.created?.questions.length).toBe(3)
    expect(state.created?.name).toBe('Backend — first round')
    expect(state.created?.questions[0].text).toBe('Walk me through how you would design a rate limiter.')
    expect(state.created?.questions[2].text).toBe('Tell me about an incident you owned.')
  })

  test('an import adds to the draft instead of replacing it, and its warnings are shown', async ({ page }) => {
    const state = await mockApi(page)
    await openWizard(page)
    await fillBasics(page, 'Mixed sources', 6)

    // First a paste…
    await page.getByRole('button', { name: /Paste from an LLM/ }).click()
    await page.getByLabel('Paste questions here').fill('1. Why did you leave your last role?')
    await page.getByRole('button', { name: /Add 1 to the set/ }).click()
    await expect(page.getByText('1 of 6 questions')).toBeVisible()

    // …then a spreadsheet, from the review step's own shortcut.
    await page.getByRole('button', { name: 'Import a file' }).click()
    await page.setInputFiles('input[type=file]', {
      name: 'bank.csv', mimeType: 'text/csv', buffer: Buffer.from('Question\nHow do you make a webhook safe to retry?\n'),
    })

    await expect(page.getByText('3 of 6 questions')).toBeVisible()
    await expect(page.getByText(/No “Question” header was found/)).toBeVisible()
    await expect(page.getByText('Pasted').first()).toBeVisible()
    await expect(page.getByText('Spreadsheet').first()).toBeVisible()

    await page.getByRole('button', { name: 'Save question set' }).click()
    await expect.poll(() => state.created?.questions.length).toBe(3)
  })

  test('"write the remaining" asks for exactly the gap and sends the draft along', async ({ page }) => {
    const state = await mockApi(page)
    await openWizard(page)
    await fillBasics(page, 'Half written', 5)

    await page.getByRole('button', { name: /Paste from an LLM/ }).click()
    await page.getByLabel('Paste questions here').fill('1. Why SQL over NoSQL here?\n2. How do you decide what to test?')
    await page.getByRole('button', { name: /Add 2 to the set/ }).click()

    await expect(page.getByText('3 still to go.')).toBeVisible()
    await page.getByRole('button', { name: /Write the remaining 3/ }).click()

    await expect(page.getByText('5 of 5 questions')).toBeVisible()
    expect(state.generateMoreCount).toBe(3)
    expect(state.existingSent).toEqual(['Why SQL over NoSQL here?', 'How do you decide what to test?'])
    await expect(page.getByText('Written by AI').first()).toBeVisible()
  })

  test('with no Gemini key, generation is offered but disabled and explained', async ({ page }) => {
    await mockApi(page, { geminiKeySet: false })
    await openWizard(page)
    await fillBasics(page, 'No key here', 4)

    await page.getByRole('button', { name: /Paste from an LLM/ }).click()
    await page.getByLabel('Paste questions here').fill('1. What is your greatest strength?')
    await page.getByRole('button', { name: /Add 1 to the set/ }).click()

    await expect(page.getByRole('button', { name: /Write the remaining 3/ })).toBeDisabled()
    await expect(page.getByText(/Writing questions for you needs a Gemini API key/)).toBeVisible()
    // The manual and paste paths are unaffected — that is the point of saying so.
    await expect(page.getByRole('button', { name: 'Save question set' })).toBeEnabled()
  })

  test('writing manually seeds the rows the recruiter asked for', async ({ page }) => {
    await mockApi(page)
    await openWizard(page)
    await fillBasics(page, 'Typed by hand', 4)

    await page.getByRole('button', { name: /Write them myself/ }).click()
    await expect(page.getByLabel('Question 4 text')).toBeVisible()
    await expect(page.getByLabel('Question 5 text')).toHaveCount(0)

    // An empty draft cannot continue; one filled row can.
    await expect(page.getByRole('button', { name: /Next: Review/ })).toBeDisabled()
    await page.getByLabel('Question 1 text').fill('Tell me about a system you designed.')
    await expect(page.getByRole('button', { name: /Next: Review/ })).toBeEnabled()
  })

  test('the guided tour walks forward and back, and moves the wizard with it', async ({ page }) => {
    await mockApi(page)
    await openWizard(page)

    await page.getByRole('button', { name: 'Show me how' }).click()
    const tour = page.getByRole('dialog', { name: 'Guided tour' })
    await expect(tour).toBeVisible()
    await expect(tour.getByText('1 of 13')).toBeVisible()

    // Forward to the step about the three sources — the wizard follows.
    for (let i = 0; i < 4; i++) await tour.getByRole('button', { name: /Next/ }).click()
    await expect(tour.getByText('Three ways in')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Where do the questions come from?' })).toBeVisible()

    // Excel imports are covered, and reaching them opens the upload interface.
    await tour.getByRole('button', { name: /Next/ }).click()   // paste
    await tour.getByRole('button', { name: /Next/ }).click()   // prompt
    await tour.getByRole('button', { name: /Next/ }).click()   // upload
    await tour.getByRole('button', { name: /Next/ }).click()   // excel
    await expect(tour.getByText('Excel and CSV imports')).toBeVisible()
    await expect(page.getByText(/A header row of/)).toBeVisible()

    await tour.getByRole('button', { name: /Back/ }).click()
    await expect(tour.getByText('Photos, PDFs and Word files')).toBeVisible()

    // The chapter list jumps straight to a topic.
    await tour.getByRole('button', { name: 'Show all steps' }).click()
    await tour.getByRole('button', { name: /Saving the set/ }).click()
    await expect(tour.getByText('13 of 13')).toBeVisible()

    // Closing returns the recruiter to where they were before the tour moved them.
    await tour.getByRole('button', { name: /Finish/ }).click()
    await expect(tour).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Name and size' })).toBeVisible()
  })
})

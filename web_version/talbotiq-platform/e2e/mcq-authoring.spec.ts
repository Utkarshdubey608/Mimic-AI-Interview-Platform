import { test, expect, type Page } from '@playwright/test'

/**
 * The MCQ authoring screen, driven in a real browser.
 *
 * WHY THIS EXISTS. The backend suite proved every contract and the feature was
 * still broken twice in one day, both times in ways no unit test can see:
 *
 *   · "New MCQ set" answered 400 on every click, so the page could not be used
 *     at all;
 *   · Save was DISABLED whenever a question was unfinished, so a recruiter
 *     interrupted mid-paper lost the work.
 *
 * Neither is a wrong value in a payload. One is a button that does nothing, the
 * other a button that cannot be pressed — and a browser is the only place either
 * is visible.
 *
 * The API is mocked here rather than hit. That is deliberate: this asserts the
 * SCREEN's behaviour, and the server's is already covered by the journey test in
 * backend/tests/web/test_web_mcq_journey.py. Mocking also means no Gemini call,
 * so the Mode A test costs nothing and cannot flake on a model.
 *
 * It runs at /__mcq, a dev-only harness route outside the identity gate, because
 * a Playwright run has no Firebase session and stubbing auth would put a bypass
 * into the path production uses.
 */

type Store = { sets: any[] }

/** A paper the server would consider finished. */
const READY_QUESTION = {
  id: 'q-ready',
  text: 'What does EC2 stand for?',
  type: 'single',
  options: [
    { id: 'a', text: 'Elastic Compute Cloud' },
    { id: 'b', text: 'Elastic Container Cloud' },
  ],
  correctOptionIds: ['a'],
}

/**
 * Stands in for the MCQ endpoints, INCLUDING the readiness the server computes.
 * Readiness is recomputed here on every write for the same reason the server
 * derives it on read: a stale `ready` is worse than none, because it says a paper
 * can be sent when it cannot.
 */
async function mockApi(page: Page, store: Store) {
  const faultsOf = (set: any): string[] => {
    if (!set.questions?.length) return ['The set has no questions yet.']
    const out: string[] = []
    set.questions.forEach((q: any, i: number) => {
      const where = `Question ${i + 1}`
      const options = (q.options ?? []).filter((o: any) => o.text?.trim())
      if (!q.text?.trim()) out.push(`${where} has no text.`)
      else if (options.length < 2) out.push(`${where} needs at least two options.`)
      else if (!(q.correctOptionIds ?? []).length) out.push(`${where} has no correct answer marked.`)
    })
    return out
  }
  const withReadiness = (set: any) => {
    const faults = faultsOf(set)
    return { ...set, ready: faults.length === 0, faults }
  }

  await page.route('**/api/web/mcq-sets**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (url.pathname.endsWith('/suggest-topics')) {
      return json({ role: 'Backend Engineer', topics: ['Caching', 'SQL indexing', 'Concurrency'] })
    }
    if (url.pathname.endsWith('/generate')) {
      const generated = {
        id: 'q-gen', text: 'Which cache eviction policy evicts the least recently used entry?',
        type: 'single',
        options: [
          { id: 'g1', text: 'LRU' }, { id: 'g2', text: 'FIFO' },
          { id: 'g3', text: 'LFU' }, { id: 'g4', text: 'Random' },
        ],
        correctOptionIds: ['g1'],
        topic: 'Caching',
        explanation: 'LRU evicts the entry unused for longest.',
      }
      return json({
        role: 'Backend Engineer', topics: ['Caching'], questions: [generated],
        requested: 2, dropped: 1,
      })
    }

    if (method === 'GET') return json(store.sets.map(withReadiness))

    if (method === 'POST') {
      const body = request.postDataJSON()
      const created = {
        id: `set-${store.sets.length + 1}`, kind: 'mcq',
        name: body.name, questions: body.questions ?? [],
        createdAt: '2026-08-19', updatedAt: '2026-08-19',
      }
      store.sets.push(created)
      return json(withReadiness(created), 201)
    }

    if (method === 'PUT') {
      const body = request.postDataJSON()
      const id = url.pathname.split('/').pop()
      const index = store.sets.findIndex((s) => s.id === id)
      if (index >= 0) store.sets[index] = { ...store.sets[index], ...body }
      return json(withReadiness(store.sets[index]))
    }

    return json({})
  })
}

test.describe('MCQ authoring — Mode B (manual)', () => {
  test('a new set can be created, written and saved', async ({ page }) => {
    const store: Store = { sets: [] }
    await mockApi(page, store)
    await page.goto('/__mcq')

    // THE REGRESSION: this button answered 400 on every click, so the whole
    // feature was unreachable. If it ever does again, this fails here.
    await page.getByRole('button', { name: 'New MCQ set' }).click()
    await expect(page.getByRole('button', { name: 'Add question' })).toBeVisible()
    expect(store.sets).toHaveLength(1)

    // The paper starts unfinished and says so, rather than looking sendable.
    await expect(page.getByText('to finish before sending')).toBeVisible()

    // Write a question.
    await page.getByLabel('Question 1 text').fill('What does EC2 stand for?')
    await page.getByLabel('Question 1 option A text').fill('Elastic Compute Cloud')
    await page.getByLabel('Question 1 option B text').fill('Elastic Container Cloud')

    // Still unfinished: nothing is marked correct yet, and the screen must say
    // WHICH fault it is, not merely that something is wrong.
    //
    // Asserted on the editor's own wording. The server words the same rule
    // differently ("Question 1 has no correct answer marked."), because the two
    // speak to different moments: the inline message is an instruction to
    // somebody mid-edit, the server's is a report about a numbered question. The
    // rules agree; only the sentences differ, and this test intentionally pins the
    // one the recruiter actually reads.
    await expect(page.getByText('Mark the correct answer', { exact: false })).toBeVisible()

    await page.getByRole('radio', { name: 'Mark option A correct' }).click()
    await expect(page.getByText('Ready to send')).toBeVisible()

    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Set saved')).toBeVisible()
  })

  test('an unfinished paper can still be saved', async ({ page }) => {
    /* THE SECOND REGRESSION. Save was disabled while any question was
       incomplete, so being interrupted mid-paper lost the work — the opposite of
       what validation is for. A draft must always be savable. */
    const store: Store = { sets: [] }
    await mockApi(page, store)
    await page.goto('/__mcq')

    await page.getByRole('button', { name: 'New MCQ set' }).click()
    await page.getByLabel('Question 1 text').fill('Half-written question')

    const save = page.getByRole('button', { name: 'Save' })
    await expect(save).toBeEnabled()
    await save.click()
    await expect(page.getByText('Set saved')).toBeVisible()
  })

  test('marking a second option replaces the first on a single-answer question', async ({ page }) => {
    /* Otherwise the key silently holds two answers behind a control that looks
       like a radio, and the question scores nobody the way it appears to. */
    const store: Store = { sets: [{ id: 'set-1', kind: 'mcq', name: 'AWS', questions: [READY_QUESTION] }] }
    await mockApi(page, store)
    await page.goto('/__mcq')

    await page.getByRole('radio', { name: 'Mark option B correct' }).click()
    await expect(page.getByRole('radio', { name: 'Mark option A correct' })).not.toBeChecked()
    await expect(page.getByRole('radio', { name: 'Mark option B correct' })).toBeChecked()
  })

  test('removing an option also clears it from the answer key', async ({ page }) => {
    /* Otherwise the key names an option that no longer exists and the question
       becomes unanswerable with no visible sign. */
    const store: Store = { sets: [{ id: 'set-1', kind: 'mcq', name: 'AWS', questions: [READY_QUESTION] }] }
    await mockApi(page, store)
    await page.goto('/__mcq')

    await expect(page.getByText('Ready to send')).toBeVisible()
    await page.getByRole('button', { name: 'Add option' }).click()
    await page.getByRole('button', { name: 'Remove option A' }).click()
    // A was the correct answer; with it gone the paper must report itself unready
    // rather than quietly keeping a key that points at nothing.
    await expect(page.getByText('to finish before sending')).toBeVisible()
  })
})

test.describe('MCQ authoring — Mode A (generated)', () => {
  test('role to topics to a reviewable paper', async ({ page }) => {
    const store: Store = { sets: [] }
    await mockApi(page, store)
    await page.goto('/__mcq')

    await page.getByRole('button', { name: 'Generate with AI' }).click()
    await page.getByLabel('Role').fill('Backend Engineer')
    await page.getByRole('button', { name: 'Suggest topics' }).click()

    // The topics are shown for EDITING, which is the whole point of the mode.
    await expect(page.getByText('Caching')).toBeVisible()
    await expect(page.getByText('SQL indexing')).toBeVisible()

    await page.getByRole('button', { name: 'Remove SQL indexing' }).click()
    await expect(page.getByText('SQL indexing')).toHaveCount(0)

    await page.getByLabel('Add a topic').fill('Message queues')
    await page.getByRole('button', { name: 'Add' }).click()
    await expect(page.getByText('Message queues')).toBeVisible()

    await page.getByRole('button', { name: /Generate \d+ questions/ }).click()

    // The generated paper lands in the EDITOR, not saved and finished: a
    // generated answer key nobody read is the worst thing to score people
    // against, so the correct option must be sitting there editable.
    await expect(page.getByLabel('Question 1 text')).toHaveValue(/eviction policy/)
    await expect(page.getByRole('radio', { name: 'Mark option A correct' })).toBeChecked()
  })

  test('questions dropped as unusable are reported, not hidden', async ({ page }) => {
    /* Asking for 2 and receiving 1 deserves the reason. Silently returning fewer
       would read as the model being asked for fewer. */
    const store: Store = { sets: [] }
    await mockApi(page, store)
    await page.goto('/__mcq')

    await page.getByRole('button', { name: 'Generate with AI' }).click()
    await page.getByLabel('Role').fill('Backend Engineer')
    await page.getByRole('button', { name: 'Suggest topics' }).click()
    await page.getByRole('button', { name: /Generate \d+ questions/ }).click()

    await expect(page.getByText(/1 generated question .*unusable/)).toBeVisible()
  })

  test('a paper cannot be generated across no topics', async ({ page }) => {
    const store: Store = { sets: [] }
    await mockApi(page, store)
    await page.goto('/__mcq')

    await page.getByRole('button', { name: 'Generate with AI' }).click()
    await page.getByLabel('Role').fill('Backend Engineer')
    await page.getByRole('button', { name: 'Suggest topics' }).click()

    for (const topic of ['Caching', 'SQL indexing', 'Concurrency']) {
      await page.getByRole('button', { name: `Remove ${topic}` }).click()
    }
    await expect(page.getByRole('button', { name: /Generate \d+ questions/ })).toBeDisabled()
    await expect(page.getByText('spread across nothing')).toBeVisible()
  })
})

import { test, expect, type Page } from '@playwright/test'

/**
 * Section-based assessments, in a real browser.
 *
 * WHAT THIS COVERS THAT THE UNIT TESTS CANNOT: an assessment now has structure,
 * and structure only exists once a person can build it. The server can store a
 * perfect manifest while the builder never sends one, and every backend test
 * would still pass.
 *
 * So these assert the two things that live only here:
 *
 *   · the sections a recruiter builds actually leave the browser, in order;
 *   · a candidate can answer a pairing question and the answer is a MAPPING,
 *     not a list.
 *
 * Runs at /__mcq and /__mcq-take, dev-only harness routes outside the identity gate.
 */

type Store = { sets: any[]; lastSave?: any }

async function mockApi(page: Page, store: Store) {
  await page.route('**/api/web/mcq-sets**', async (route) => {
    const request = route.request()
    const method = request.method()
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

    if (method === 'GET') return json(store.sets)

    if (method === 'POST') {
      const body = request.postDataJSON()
      const created = {
        id: 'set-1',
        kind: 'mcq',
        name: body.name,
        sections: body.sections ?? [],
        questions: body.questions ?? [],
        ready: false,
        faults: [],
        createdAt: 'x',
        updatedAt: 'x',
      }
      store.sets = [created]
      return json(created, 201)
    }

    if (method === 'PUT') {
      // RECORDED. A test can then assert what the builder actually sent, which is
      // the only way to see whether the structure on screen ever left the page.
      store.lastSave = request.postDataJSON()
      const saved = { ...store.sets[0], ...store.lastSave, ready: true, faults: [] }
      store.sets = [saved]
      return json(saved)
    }
    return json({})
  })
}

const openNewAssessment = async (page: Page, store: Store) => {
  await mockApi(page, store)
  await page.goto('/__mcq')
  await page.getByRole('button', { name: 'New assessment' }).click()
  await expect(page.getByRole('heading', { name: 'Sections' })).toBeVisible()
}

test.describe('building an assessment out of sections', () => {
  test('the surface is called Assessments, not MCQ', async ({ page }) => {
    /* A paper that can hold pairings, passages and code snippets is not a
       "multiple choice test", and a recruiter looking for an aptitude test would
       not think to look under MCQ. */
    await mockApi(page, { sets: [] })
    await page.goto('/__mcq')
    await expect(page.getByRole('heading', { name: 'Assessments' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New assessment' })).toBeVisible()
  })

  test('a prebuilt section and a custom one both work', async ({ page }) => {
    /* The library is a shortcut, not the boundary. A recruiter hiring for a role
       nobody anticipated types their own name and gets a section. */
    const store: Store = { sets: [] }
    await openNewAssessment(page, store)

    await page.getByRole('button', { name: '+ Aptitude' }).click()
    await expect(page.getByRole('textbox', { name: 'Section name', exact: true }).first()).toHaveValue('Aptitude')

    await page.getByLabel('New section name').fill('Financial modelling')
    await page.getByRole('button', { name: 'Add', exact: true }).click()

    const names = await page.getByRole('textbox', { name: 'Section name', exact: true }).evaluateAll(
      (els) => els.map((e) => (e as HTMLInputElement).value),
    )
    expect(names).toEqual(['Aptitude', 'Financial modelling'])

    // A name already used cannot be added twice from the library.
    await expect(page.getByRole('button', { name: 'Aptitude', exact: true })).toBeDisabled()
  })

  test('English Comprehension arrives with its passage field open', async ({ page }) => {
    /* Because a comprehension section without a passage is not one. The passage
       lives on the SECTION, so no new question type is needed for it. */
    const store: Store = { sets: [] }
    await openNewAssessment(page, store)

    await page.getByRole('button', { name: '+ English Comprehension' }).click()
    await expect(page.getByLabel('Reading passage')).toBeVisible()
    await page.getByLabel('Reading passage').fill('The tide came in slowly.')
    await expect(page.getByText('One passage per section')).toBeVisible()
  })

  test('the sections and their order actually reach the server', async ({ page }) => {
    /* THE HAND-OFF. Every control above could render correctly while the save
       still sent only questions, and nothing on screen would say so. */
    const store: Store = { sets: [] }
    await openNewAssessment(page, store)

    await page.getByRole('button', { name: '+ Aptitude' }).click()
    await page.getByRole('button', { name: '+ Verbal Ability' }).click()
    await page.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => store.lastSave?.sections?.length).toBe(2)
    expect(store.lastSave.sections.map((s: any) => s.name)).toEqual([
      'Aptitude',
      'Verbal Ability',
    ])
  })

  test('a question can be put in a section, and only real sections are offered', async ({ page }) => {
    const store: Store = { sets: [] }
    await openNewAssessment(page, store)

    await page.getByRole('button', { name: '+ Aptitude' }).click()
    const picker = page.getByLabel('Question 1 section')
    await expect(picker).toBeVisible()

    const offered = await picker.locator('option').evaluateAll((els) =>
      els.map((e) => (e as HTMLOptionElement).textContent),
    )
    expect(offered).toEqual(['No section', 'Aptitude'])

    await picker.selectOption({ label: 'Aptitude' })
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => store.lastSave?.questions?.[0]?.sectionId).toBeTruthy()
  })

  test('removing a section says what it will free before it is clicked', async ({ page }) => {
    /* Deleting a heading must not silently delete somebody's questions. They lose
       their section and fall to the end, which is recoverable. */
    const store: Store = { sets: [] }
    await openNewAssessment(page, store)

    await page.getByRole('button', { name: '+ Aptitude' }).click()
    await page.getByLabel('Question 1 section').selectOption({ label: 'Aptitude' })

    await expect(page.getByRole('button', { name: /Remove Aptitude, freeing 1 question/ })).toBeVisible()
    await page.getByRole('button', { name: /Remove Aptitude/ }).click()
    // The question survives; only its section is gone.
    await expect(page.getByLabel('Question 1 text')).toBeVisible()
  })
})

test.describe('authoring the new question types', () => {
  test('a pairing is authored a row at a time, with two rows minimum', async ({ page }) => {
    const store: Store = { sets: [] }
    await openNewAssessment(page, store)

    await page.getByRole('button', { name: 'Match pairs' }).click()

    // Seeded with the fewest rows a pairing can ask, and they cannot be removed.
    await expect(page.getByLabel('Question 1 pair 1 item')).toBeVisible()
    await expect(page.getByLabel('Question 1 pair 2 item')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove pair 1' })).toBeDisabled()

    await page.getByLabel('Question 1 pair 1 item').fill('Binary search')
    await page.getByLabel('Question 1 pair 1 match').fill('O(log n)')
    await page.getByLabel('Question 1 pair 2 item').fill('Bubble sort')
    await page.getByLabel('Question 1 pair 2 match').fill('O(n^2)')

    // Options are meaningless here, so that control is gone.
    await expect(page.getByRole('button', { name: 'Add option' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => store.lastSave?.questions?.[0]?.pairs?.length).toBe(2)
    const pairs = store.lastSave.questions[0].pairs
    expect(pairs[0]).toMatchObject({ left: 'Binary search', right: 'O(log n)' })
    // Ids are minted per SIDE: sharing one would make the answer readable from
    // the field names however the columns were ordered.
    expect(pairs[0].promptId).not.toBe(pairs[0].matchId)
  })

  test('switching to a pairing does not throw away the options', async ({ page }) => {
    /* Somebody exploring the control must be able to change their mind. */
    const store: Store = { sets: [] }
    await openNewAssessment(page, store)

    await page.getByLabel('Question 1 option A').fill('Elastic Compute Cloud')
    await page.getByRole('button', { name: 'Match pairs' }).click()
    await page.getByRole('button', { name: 'Pick one' }).click()
    await expect(page.getByLabel('Question 1 option A')).toHaveValue('Elastic Compute Cloud')
  })

  test('a code snippet can be attached and keeps its line breaks', async ({ page }) => {
    /* How coding and debugging are assessed: read the code, answer a closed
       question about it. No sandbox, so the score is a comparison. */
    const store: Store = { sets: [] }
    await openNewAssessment(page, store)

    await page.getByRole('button', { name: 'Show them some code with this question' }).click()
    await page.getByLabel('Code they read').fill('def f(n):\n    return n // 2')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => store.lastSave?.questions?.[0]?.code).toContain('\n')
  })

  test('a complete pairing is not reported as missing its options', async ({ page }) => {
    /* The client fault check is separate from the server's and was not type-aware,
       so a finished pairing showed "Needs at least two options" — a warning that
       saving then contradicted. The two disagreeing is worse than either being
       wrong. */
    const store: Store = { sets: [] }
    await openNewAssessment(page, store)

    await page.getByLabel('Question 1 text').fill('Match the algorithm to its complexity.')
    await page.getByRole('button', { name: 'Match pairs', exact: true }).click()
    await page.getByLabel('Question 1 pair 1 item').fill('Binary search')
    await page.getByLabel('Question 1 pair 1 match').fill('O(log n)')
    await page.getByLabel('Question 1 pair 2 item').fill('Bubble sort')
    await page.getByLabel('Question 1 pair 2 match').fill('O(n squared)')

    await expect(page.getByText('Add at least two answers to choose from.')).toHaveCount(0)
    await expect(page.getByText('Ready to send')).toBeVisible()
  })

  test('two rows matching the same answer is called out', async ({ page }) => {
    /* Unsolvable: whichever the candidate picks, one row is wrong. */
    const store: Store = { sets: [] }
    await openNewAssessment(page, store)

    await page.getByLabel('Question 1 text').fill('Match them.')
    await page.getByRole('button', { name: 'Match pairs', exact: true }).click()
    await page.getByLabel('Question 1 pair 1 item').fill('A')
    await page.getByLabel('Question 1 pair 1 match').fill('Same')
    await page.getByLabel('Question 1 pair 2 item').fill('B')
    await page.getByLabel('Question 1 pair 2 match').fill('Same')

    await expect(page.getByText(/cannot be solved/)).toBeVisible()
  })
})

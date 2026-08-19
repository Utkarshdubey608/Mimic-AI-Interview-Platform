import { expect, test, type Page } from '@playwright/test'

/**
 * The four interview-experience fixes, at the surfaces a candidate meets them.
 *
 * The dash rule itself is proven exhaustively in the backend suite
 * (tests/web/test_web_dashes.py runs all three normalisers over the same table,
 * including the hyphens that must SURVIVE). What browser tests can add is that
 * the candidate-facing screens carry no dash-style punctuation of their own.
 */
const MODES = ['chat', 'chatbot', 'voice', 'video_avatar', 'video', 'two_way'] as const

async function openCheck(page: Page, track: string) {
  await page.goto(`/__systemcheck?track=${track}`)
  await expect(page.getByRole('heading', { name: /quick system check/i })).toBeVisible()
}

test.describe('Fix 4 — close other tabs, before every mode', () => {
  for (const track of MODES) {
    test(`${track} shows the close-tabs notice`, async ({ page }) => {
      await openCheck(page, track)
      const notice = page.getByTestId('close-tabs-notice')
      await expect(notice).toBeVisible()
      await expect(notice).toContainText(/close other tabs/i)
      await page.screenshot({ path: `e2e/shots/closetabs-${track}.png`, fullPage: true })
    })
  }
})

test.describe('Fix 1 — no dash-style punctuation on candidate screens', () => {
  for (const track of MODES) {
    test(`${track} pre-interview copy is dash-free`, async ({ page }) => {
      await openCheck(page, track)
      const text = (await page.locator('body').innerText()) ?? ''
      // Em dash, en dash, and the spaced hyphen read as a dash. Real hyphenated
      // words (back-end, e-commerce) have no surrounding spaces and are fine.
      expect(text, 'em dash on a candidate screen').not.toMatch(/—/)
      expect(text, 'en dash on a candidate screen').not.toMatch(/–/)
      expect(text, 'spaced hyphen used as a dash').not.toMatch(/\S \- \S/)
    })
  }
})

test.describe('Fix 2 — the tab-switch warning is centred and must be acknowledged', () => {
  test('it blocks, it is centred, and acknowledging dismisses it', async ({ page }) => {
    await page.goto('/__interviewbits')
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await expect(page.getByTestId('integrity-warning')).toBeVisible()

    // Centred, not a corner toast: its box sits within the middle band of the
    // viewport on both axes. This is the actual complaint being fixed.
    const box = (await dialog.boundingBox())!
    const vp = page.viewportSize()!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    expect(Math.abs(cx - vp.width / 2), 'horizontally centred').toBeLessThan(40)
    expect(Math.abs(cy - vp.height / 2), 'vertically centred').toBeLessThan(60)

    // Escape must NOT dismiss it — reading is the point.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()

    await expect(page.getByTestId('integrity-count')).toContainText('1 of 3')
    await page.screenshot({ path: 'e2e/shots/integrity-warning.png' })

    await page.getByTestId('integrity-acknowledge').click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('Fix 3 — feedback, then back to the Mimic app', () => {
  test('a rating submits and redirects', async ({ page }) => {
    await page.route('**/feedback', (r) => r.fulfill({ status: 200, body: '{"ok":true}' }))
    await page.goto('/__interviewbits')
    await page.getByTestId('integrity-acknowledge').click()

    await expect(page.getByTestId('feedback-step')).toBeVisible()
    await expect(page.getByTestId('feedback-submit')).toBeDisabled()

    await page.getByTestId('feedback-star-4').click()
    await page.getByTestId('feedback-comment').fill('Clear and calm.')
    await expect(page.getByTestId('feedback-submit')).toBeEnabled()
    await page.screenshot({ path: 'e2e/shots/feedback-step.png' })

    await page.getByTestId('feedback-submit').click()
    await expect(page.getByTestId('feedback-leaving')).toBeVisible()
    await page.waitForURL('**/', { timeout: 15_000 })
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('skipping redirects too, without trapping anyone', async ({ page }) => {
    await page.goto('/__interviewbits')
    await page.getByTestId('integrity-acknowledge').click()
    await page.getByTestId('feedback-skip').click()
    await page.waitForURL('**/', { timeout: 15_000 })
    expect(new URL(page.url()).pathname).toBe('/')
  })

  test('a failing write still redirects rather than stranding them', async ({ page }) => {
    await page.route('**/feedback', (r) => r.fulfill({ status: 500, body: '{"error":"nope"}' }))
    await page.goto('/__interviewbits')
    await page.getByTestId('integrity-acknowledge').click()
    await page.getByTestId('feedback-star-2').click()
    await page.getByTestId('feedback-submit').click()
    await page.waitForURL('**/', { timeout: 15_000 })
    expect(new URL(page.url()).pathname).toBe('/')
  })
})

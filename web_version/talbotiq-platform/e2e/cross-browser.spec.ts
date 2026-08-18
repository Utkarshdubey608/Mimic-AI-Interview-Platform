import { expect, test, type Page } from '@playwright/test'

/**
 * The engine matrix. Runs on Chromium, WebKit (Safari's engine) and Gecko.
 *
 * Nothing here uses Chromium's fake-media flags, because WebKit and Firefox do
 * not have them — and the point of this file is the behaviour those engines get
 * wrong, not the behaviour Chromium already gets right.
 */

test.describe('the login page has no intro animation', () => {
  test('sign-in is the first thing painted', async ({ page }) => {
    const started = Date.now()
    await page.goto('/login')
    // No WebGL splash on top: the form is reachable straight away.
    //
    // The timeout is generous on purpose. This asserts that nothing COVERS the
    // form, not how fast a dev server under a full parallel matrix can serve it
    // — Firefox measured 2.5s to 7.8s across runs purely from contention, and
    // failing on that would be a flake dressed up as a performance budget.
    await expect(page.locator('form, input[type="email"]').first()).toBeVisible({ timeout: 30_000 })
    const canvases = await page.locator('canvas').count()
    expect(canvases, 'no intro canvas over the login form').toBe(0)
    await expect(page.getByText(/the future of interviews/i)).toHaveCount(0)
    console.log(`  login interactive in ${Date.now() - started}ms on ${test.info().project.name}`)
    await page.screenshot({ path: `e2e/shots/login-${test.info().project.name}.png`, fullPage: true })
  })
})

test.describe('tab-switch detection — the Safari/macOS bug', () => {
  /**
   * Events are dispatched rather than provoked by bringToFront(), because a
   * HEADLESS browser has no real window focus to lose — bringToFront() fires
   * nothing on any engine, so provoking it would test the harness, not the fix.
   *
   * Dispatching exercises what actually broke: whether THIS engine has the blur
   * and pagehide listeners attached and reconciled. Confirming that Safari on a
   * real Mac emits blur where it withheld visibilitychange still needs one
   * manual pass; that is called out in the PR.
   */
  async function leaveVia(page: Page, event: 'blur' | 'pagehide', documentKeepsFocus = false) {
    await page.evaluate(
      ([name, keepsFocus]) => {
        Object.defineProperty(document, 'hasFocus', {
          configurable: true,
          value: () => keepsFocus,
        })
        window.dispatchEvent(new Event(name as string))
      },
      [event, documentKeepsFocus] as const,
    )
  }

  test('a window blur is registered as leaving', async ({ page }) => {
    await page.goto('/__interviewbits')
    await page.getByTestId('integrity-acknowledge').click()
    await expect(page.getByTestId('detector-state')).toHaveAttribute('data-away', 'no')

    await leaveVia(page, 'blur')

    await expect(
      page.getByTestId('detector-state'),
      `${test.info().project.name} must register a blur as a switch`,
    ).toHaveAttribute('data-away', 'yes', { timeout: 5_000 })
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.screenshot({ path: `e2e/shots/tabswitch-${test.info().project.name}.png` })
  })

  test('pagehide is registered too', async ({ page }) => {
    await page.goto('/__interviewbits')
    await page.getByTestId('integrity-acknowledge').click()
    await leaveVia(page, 'pagehide')
    await expect(page.getByTestId('detector-state')).toHaveAttribute('data-away', 'yes', { timeout: 5_000 })
  })

  test('clicking the embedded call iframe is NOT leaving', async ({ page }) => {
    await page.goto('/__interviewbits')
    await page.getByTestId('integrity-acknowledge').click()

    // Blur fires, but the document keeps focus: the candidate clicked into
    // their own interview, and flagging that would punish them for using it.
    await leaveVia(page, 'blur', true)
    await page.waitForTimeout(400)

    await expect(page.getByTestId('detector-state')).toHaveAttribute('data-away', 'no')
    await expect(page.getByRole('alertdialog')).toBeHidden()
  })
})

test.describe('the System Check runs on this engine', () => {
  test('it renders and reports per-check state', async ({ page }: { page: Page }) => {
    await page.goto('/__systemcheck?track=chat')
    await expect(page.getByRole('heading', { name: /quick system check/i })).toBeVisible()
    await expect(page.getByTestId('close-tabs-notice')).toBeVisible()
    // A typed mode needs no hardware, so every engine should reach a startable state.
    await expect(page.getByTestId('start-interview')).toBeEnabled()
    await page.screenshot({ path: `e2e/shots/syscheck-${test.info().project.name}.png`, fullPage: true })
  })
})

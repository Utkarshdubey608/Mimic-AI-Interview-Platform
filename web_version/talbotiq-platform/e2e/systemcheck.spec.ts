import { expect, test, type Page } from '@playwright/test'

/**
 * The System Check, per mode and per failure state.
 *
 * The assertion that carries the feature is the same in every case: Start is
 * disabled until the checks that mode requires have actually passed.
 */

async function openCheck(page: Page, track: string) {
  await page.goto(`/__systemcheck?track=${track}`)
  await expect(page.getByRole('heading', { name: /quick system check/i })).toBeVisible()
}

const start = (page: Page) => page.getByTestId('start-interview')
const check = (page: Page, id: string) => page.locator(`[data-check="${id}"]`)

test.describe('hardware-free modes', () => {
  for (const track of ['chat', 'chatbot']) {
    test(`${track} asks for no hardware and starts`, async ({ page }) => {
      await openCheck(page, track)
      await expect(check(page, 'mic')).toHaveCount(0)
      await expect(check(page, 'camera')).toHaveCount(0)
      await expect(start(page)).toBeEnabled()
      await page.screenshot({ path: `e2e/shots/${track}-ready.png`, fullPage: true })
    })
  }
})

test.describe('working hardware', () => {
  for (const track of ['voice', 'video_avatar', 'video', 'two_way']) {
    test(`${track} passes with fake devices`, async ({ page }) => {
      await openCheck(page, track)
      await expect(check(page, 'mic')).toHaveAttribute('data-state', 'passed', { timeout: 20_000 })
      if (track !== 'voice') {
        await expect(check(page, 'camera')).toHaveAttribute('data-state', 'passed', { timeout: 20_000 })
      }
      if (await page.getByTestId('speaker-confirm').count()) {
        await page.getByTestId('speaker-confirm').click()
      }
      await page.screenshot({ path: `e2e/shots/${track}-pass.png`, fullPage: true })
    })
  }
})

test.describe('denied', () => {
  test('blocked permissions keep Start disabled and explain the fix', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      })
    })
    await openCheck(page, 'video_avatar')
    await expect(check(page, 'mic')).toHaveAttribute('data-state', 'denied')
    await expect(start(page)).toBeDisabled()
    await expect(page.getByText(/is blocked/i).first()).toBeVisible()
    await expect(page.getByTestId('retest-mic')).toBeVisible()
    await page.screenshot({ path: 'e2e/shots/denied.png', fullPage: true })
  })
})

// The granted-but-no-signal case needs different Chromium flags, and Playwright
// will not accept launchOptions inside a describe (it forces a new worker), so it
// lives in its own file + project: see e2e/no-signal.spec.ts.

test.describe('in-app webview', () => {
  const GMAIL_WEBVIEW =
    'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36'

  test.use({ userAgent: GMAIL_WEBVIEW })

  test('a media mode is told to open a real browser', async ({ page }) => {
    await openCheck(page, 'voice')
    await expect(check(page, 'browser')).toHaveAttribute('data-state', 'unsupported')
    await expect(page.getByText(/open this in a real browser/i)).toBeVisible()
    await expect(start(page)).toBeDisabled()
    await page.screenshot({ path: 'e2e/shots/webview-blocked.png', fullPage: true })
  })

  test('a TYPED mode is not blocked — it needs no hardware', async ({ page }) => {
    await openCheck(page, 'chat')
    await expect(start(page)).toBeEnabled()
    await page.screenshot({ path: 'e2e/shots/webview-typed-ok.png', fullPage: true })
  })
})

test.describe('unsupported', () => {
  test('a browser without mediaDevices is told to switch', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    })
    await openCheck(page, 'voice')
    await expect(check(page, 'mic')).toHaveAttribute('data-state', 'unsupported')
    await expect(page.getByText(/chrome|edge|safari/i).first()).toBeVisible()
    await expect(start(page)).toBeDisabled()
    await page.screenshot({ path: 'e2e/shots/unsupported.png', fullPage: true })
  })
})

import { expect, test } from '@playwright/test'

/**
 * The case this whole feature exists for: permission granted, a device present,
 * and no signal arriving. Chromium is fed a silent WAV as its fake microphone,
 * which is the only way to stage a working-but-inaudible mic deterministically —
 * see the `no-signal` project in playwright.config.ts for the flags.
 *
 * Separate file because Playwright will not take launchOptions inside a describe.
 */
test('a silent microphone fails with "can\'t hear you", and Start stays locked', async ({ page }) => {
  await page.goto('/__systemcheck?track=voice')
  await expect(page.getByRole('heading', { name: /quick system check/i })).toBeVisible()

  const mic = page.locator('[data-check="mic"]')
  // Permission resolves immediately; the failure only emerges after the silence
  // window elapses, which is precisely the bug a naive check cannot see.
  await expect(mic).toHaveAttribute('data-state', 'granted-no-signal', { timeout: 25_000 })
  await expect(page.getByText(/can.?t hear you/i)).toBeVisible()
  await expect(page.getByTestId('start-interview')).toBeDisabled()
  await page.screenshot({ path: 'e2e/shots/no-signal.png', fullPage: true })
})

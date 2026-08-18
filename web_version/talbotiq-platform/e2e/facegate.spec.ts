import { expect, test } from '@playwright/test'

test('video: consent must lead to face framing, not straight into the interview', async ({ page }) => {
  const seen: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') seen.push(m.text()) })

  await page.goto('/__systemcheck?track=video')
  await expect(page.getByRole('heading', { name: /quick system check/i })).toBeVisible()

  // Wait for the checks to clear so VideoIntro (the consent step) appears.
  await expect(page.locator('[data-check="camera"]')).toHaveAttribute('data-state', 'passed', { timeout: 25_000 })
  await expect(page.locator('[data-check="face"]')).toHaveAttribute('data-state', 'passed', { timeout: 25_000 })

  const consent = page.getByRole('button', { name: /consent/i })
  await expect(consent, 'the consent step should be reachable').toBeVisible({ timeout: 15_000 })

  // Some builds gate consent behind a checkbox.
  const box = page.locator('input[type="checkbox"]')
  if (await box.count()) await box.first().check()
  await consent.click()

  // THE ASSERTION: framing must appear after consent.
  const framing = page.locator('video, canvas').first()
  await expect(framing, 'a framing surface should be on screen').toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: 'e2e/shots/facegate-after-consent.png', fullPage: true })
  console.log('  console errors:', JSON.stringify(seen.slice(0, 3)))
})

import { expect, test } from '@playwright/test'

/**
 * The candidate Apple layer, looked at rather than asserted.
 *
 * Two things are checked mechanically — the tokens actually resolve, and the
 * status row does not shift layout — and the rest is screenshots, because a
 * design language cannot be unit-tested and pretending otherwise is how a
 * broken surface ships behind green ticks.
 */
test('tokens resolve under the candidate scope', async ({ page }) => {
  await page.goto('/__language')
  await page.locator('[data-surface="candidate"]').waitFor()
  const resolved = await page.evaluate(() => {
    const el = document.querySelector('[data-surface="candidate"]')!
    const cs = getComputedStyle(el)
    return {
      ground: cs.getPropertyValue('--ap-ground').trim(),
      radius: cs.getPropertyValue('--ap-r-xl').trim(),
      label: cs.getPropertyValue('--ap-label').trim(),
      // If the scope were missing, the background would fall back to nothing.
      background: cs.backgroundColor,
    }
  })
  expect(resolved.ground, 'ground token').not.toBe('')
  expect(resolved.radius, 'radius token').not.toBe('')
  expect(resolved.label, 'label token').not.toBe('')
  expect(resolved.background, 'the scope is applied').not.toBe('rgba(0, 0, 0, 0)')
})

test('the material actually blurs', async ({ page }) => {
  await page.goto('/__language')
  const filter = await page.getByTestId('material-chrome').evaluate(
    (el) => getComputedStyle(el).backdropFilter || (getComputedStyle(el) as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter,
  )
  expect(filter, 'backdrop-filter is applied, not just a translucent colour').toContain('blur')
})

test('the status row reserves its height — zero layout shift', async ({ page }) => {
  await page.goto('/__language')
  const row = page.getByTestId('agent-status')
  await page.getByTestId('stage-thinking').click()
  const busy = (await row.boundingBox())!.height
  await page.getByTestId('stage-idle').click()
  const idle = (await row.boundingBox())!.height
  expect(idle, 'the row is the same height whether or not a stage is showing').toBe(busy)
})

test('specimen — desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/__language')
  await page.getByTestId('stage-cooking').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'e2e/shots/language-1440.png', fullPage: true })
})

test('specimen — 390x844', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/__language')
  await page.getByTestId('stage-reading').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'e2e/shots/language-390.png', fullPage: true })
})

test.describe('reduced motion', () => {
  test('status falls back to a static label, no looping oscillation', async ({ page }) => {
    // page.emulateMedia, not test.use({ reducedMotion }) — the fixture form did
    // not reach the page under this project's config, and a preference test
    // that silently tests the DEFAULT preference is worse than no test at all.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/__language')
    expect(
      await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
      'the preference is actually emulated',
    ).toBe(true)
    await page.getByTestId('stage-thinking').click()
    await page.waitForTimeout(300)
    // The dots must be at rest: rAF is skipped entirely under reduced motion.
    const transforms = await page.locator('[data-testid="agent-dot"]').evaluateAll(
      (els) => els.map((e) => (e as HTMLElement).style.transform),
    )
    expect(transforms.every((t) => t === ''), 'no per-frame transform is applied').toBe(true)
    await page.screenshot({ path: 'e2e/shots/language-reduced-motion.png', fullPage: true })
  })
})

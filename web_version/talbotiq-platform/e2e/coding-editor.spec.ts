import { test, expect, type Page } from '@playwright/test'

/**
 * The code editor's highlight layer, in a real browser.
 *
 * The tokenizer is unit-tested and its losslessness is proved there. What cannot
 * be proved there is the only thing that actually breaks this technique: the
 * painted layer and the textarea drifting apart. Three ways that happens, one
 * test each:
 *
 *   · the layer stops matching the text after a keystroke;
 *   · the layer does not follow the textarea's scroll — vertically it is obvious,
 *     HORIZONTALLY it is the one everybody forgets, and wrapping is off precisely
 *     so long lines scroll sideways;
 *   · the caret disappears, because the textarea's text was made transparent by
 *     hiding the element rather than its colour.
 */

const PROBLEM = {
  id: 'p1',
  title: 'Sum of Two Integers',
  statementMd: 'Read two integers and print their sum.',
  constraints: 'small',
  ioFormat: 'One line.',
  examples: [{ input: '2 3', output: '5', explanation: '' }],
  starterCode: {},
  sampleTests: [{ id: 'c1', input: '2 3', expectedOutput: '5', points: 2 }],
  hiddenTestCount: 2,
  timeLimitMs: 2000,
  memoryMb: 128,
  difficulty: 'easy',
  tags: [],
  allowedLanguages: ['python', 'javascript'],
  totalPoints: 10,
}

const CODE = [
  '# a comment',
  'def solve(n):',
  '    return "x" + str(n) + str(0x1f)',
  '',
  '# a very long line so the editor must scroll sideways: ' + 'z'.repeat(400),
].join('\n')

async function mount(page: Page, opts: { language?: string; draft?: string } = {}) {
  await page.route('**/api/**', (route) => {
    const url = route.request().url()
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.includes('/coding/languages')) {
      return json({
        source: 'judge',
        languages: [
          { key: 'python', label: 'Python 3', id: 71, version: 'Python (3.8.1)' },
          { key: 'javascript', label: 'JavaScript (Node)', id: 63, version: 'Node 12' },
        ],
      })
    }
    if (url.includes('/coding/draft')) return json({ ok: true })
    if (/\/coding$/.test(url)) {
      return json({
        sessionId: 'e2e-session',
        status: 'in_progress',
        problems: [PROBLEM],
        drafts: { p1: opts.draft ?? CODE },
        language: opts.language ?? 'python',
        branding: {},
      })
    }
    return json({})
  })
  await page.goto('/__coding-take')
  await expect(page.getByRole('textbox', { name: /Your solution to/i })).toBeVisible()
}

/** The painted layer's text, which must equal the textarea's value exactly. */
const layerText = (page: Page) => page.locator('pre[aria-hidden="true"]').first().innerText()

test.describe('the code editor', () => {
  test('colours comments, keywords and strings for the chosen language', async ({ page }) => {
    await mount(page)

    const pre = page.locator('pre[aria-hidden="true"]').first()
    await expect(pre.locator('.text-ink-faint', { hasText: '# a comment' })).toBeVisible()
    await expect(pre.locator('.text-accent-ink', { hasText: 'def' }).first()).toBeVisible()
    await expect(pre.locator('.text-ai', { hasText: '"x"' })).toBeVisible()
  })

  test('the painted layer still matches the text after typing', async ({ page }) => {
    await mount(page, { draft: 'x = 1\n' })
    const area = page.getByRole('textbox', { name: /Your solution to/i })

    await area.click()
    await area.press('End')
    await area.pressSequentially('if x: return "done"')

    const value = await area.inputValue()
    // innerText collapses the trailing newline the layer adds deliberately, so
    // compare on trimmed ends rather than byte for byte.
    expect((await layerText(page)).trimEnd()).toBe(value.trimEnd())
    expect(value).toContain('if x: return "done"')
  })

  test('the layer follows the textarea sideways, not only down', async ({ page }) => {
    await mount(page)

    const offsets = await page.evaluate(() => {
      const area = document.querySelector('textarea') as HTMLTextAreaElement
      const pre = document.querySelector('pre[aria-hidden="true"]') as HTMLPreElement
      area.scrollLeft = 300
      area.dispatchEvent(new Event('scroll', { bubbles: true }))
      return { area: area.scrollLeft, pre: pre.scrollLeft }
    })

    expect(offsets.area).toBeGreaterThan(0)
    expect(offsets.pre).toBe(offsets.area)
  })

  test('the textarea keeps its caret and stays the focusable thing', async ({ page }) => {
    await mount(page)
    const area = page.getByRole('textbox', { name: /Your solution to/i })
    await area.click()

    const state = await page.evaluate(() => {
      const area = document.querySelector('textarea') as HTMLTextAreaElement
      const pre = document.querySelector('pre[aria-hidden="true"]') as HTMLPreElement
      const areaStyle = getComputedStyle(area)
      return {
        focused: document.activeElement === area,
        // The TEXT is transparent; the element is not hidden, and the caret has
        // its own colour. Hiding the element instead would take the caret with it.
        transparentText: areaStyle.color === 'rgba(0, 0, 0, 0)',
        visible: areaStyle.visibility === 'visible' && areaStyle.opacity === '1',
        layerIgnoresPointer: getComputedStyle(pre).pointerEvents === 'none',
      }
    })

    expect(state.focused).toBe(true)
    expect(state.transparentText).toBe(true)
    expect(state.visible).toBe(true)
    expect(state.layerIgnoresPointer).toBe(true)
  })

  test('a language it cannot highlight renders as plain text, not as nothing', async ({ page }) => {
    // `cobol` is not in the table. The editor must still show the code.
    await mount(page, { language: 'cobol', draft: 'DISPLAY "HELLO".' })
    const area = page.getByRole('textbox', { name: /Your solution to/i })

    expect(await area.inputValue()).toContain('DISPLAY "HELLO"')
    // No painted layer at all, and the textarea's own text is therefore visible.
    await expect(page.locator('pre[aria-hidden="true"]')).toHaveCount(0)
    const color = await page.evaluate(
      () => getComputedStyle(document.querySelector('textarea') as HTMLTextAreaElement).color,
    )
    expect(color).not.toBe('rgba(0, 0, 0, 0)')
  })
})

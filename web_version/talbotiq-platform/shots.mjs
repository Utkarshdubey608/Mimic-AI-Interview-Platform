/**
 * Visual review harness — drives the local app and writes screenshots.
 *
 * Signs in with the audit recruiter account, then walks the routes named on the
 * command line (or a default set). Console errors per route are printed, so a
 * visual pass and a console check happen in one run.
 *
 * Usage: node shots.mjs <outDir> [width] [height] [route ...]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT = process.argv[2] ?? 'shots'
const W = Number(process.argv[3] ?? 1440)
const H = Number(process.argv[4] ?? 900)
const ROUTES = process.argv.slice(5).length
  ? process.argv.slice(5)
  : ['/', '/login', '/sessions', '/templates', '/analytics', '/settings', '/setup', '/candidate']

const EMAIL = 'design.audit@talbotiq.dev'
const PASSWORD = 'MimicAudit!2026x'
const BASE = 'http://localhost:3001'

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
const page = await ctx.newPage()

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(`${page.url()} :: ${m.text().slice(0, 220)}`) })
page.on('pageerror', (e) => errors.push(`${page.url()} :: PAGEERROR ${String(e).slice(0, 220)}`))

// Sign in once; the session persists across routes in this context.
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
if (page.url().includes('/login')) {
  try {
    await page.getByRole('textbox', { name: 'Email' }).fill(EMAIL)
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForTimeout(4000)
    console.log('signed in ->', page.url())
  } catch (e) {
    console.log('sign-in skipped:', String(e).slice(0, 120))
  }
}

for (const route of ROUTES) {
  const name = route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-')
  try {
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' })
    // Long enough for lazy chunks, queries and entrance motion to settle.
    await page.waitForTimeout(3800)
    await page.screenshot({ path: join(OUT, `${name}.png`), scale: 'css' })
    console.log(`shot ${name} @ ${W}x${H} -> ${page.url()}`)
  } catch (e) {
    console.log(`FAILED ${name}: ${String(e).slice(0, 160)}`)
  }
}

console.log('\n--- CONSOLE ERRORS ---')
console.log(errors.length ? [...new Set(errors)].join('\n') : 'none')

await browser.close()

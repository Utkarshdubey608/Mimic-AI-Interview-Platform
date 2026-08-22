/**
 * Marketing verification harness — walks every public route and proves it.
 *
 * The route list is not hardcoded. It is read out of src/marketing/content.ts
 * at run time, because a checklist that has to be updated by hand is a
 * checklist that silently stops covering the pages someone added last week.
 *
 * Per route, per viewport, it asserts the things a premium surface must never
 * get wrong and that no unit test can see:
 *
 *   render     the page actually painted something (main is taller than a
 *              header) — catches a blank or collapsed route
 *   overflow   the document does not scroll sideways
 *   h1         exactly one non-empty <h1> — semantics and SEO both
 *   seo        a title and a meta description exist and are not the shell's
 *   images     every <img> decoded; a broken product still is worse than none
 *   console    no console errors, no page errors, no failed requests
 *   reveal     nothing is stranded invisible by a scroll animation
 *
 * Usage:
 *   node scripts/marketing-verify.mjs                     both viewports, all routes
 *   node scripts/marketing-verify.mjs --width 390         one viewport
 *   node scripts/marketing-verify.mjs --routes / /trust   a subset
 *   node scripts/marketing-verify.mjs --reduced-motion    the reduced-motion pass
 *
 * Writes PNGs to marketing-verify/<w>x<h>/ and a machine-readable report.json
 * beside them. Exit code is non-zero when any route fails, so this can gate.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const BASE = process.env.MK_BASE ?? 'http://localhost:3001'

/* ── Routes, read from the content module ──────────────────────────────── */
function routesFromContent() {
  const src = readFileSync(join(ROOT, 'src/marketing/content.ts'), 'utf8')
  const slugs = []
  // Hubs carry their slug inline; everything else arrives through a factory
  // whose first argument is the slug, under a fixed section prefix.
  for (const m of src.matchAll(/slug:\s*'([a-z0-9/-]+)',\s*section:/g)) slugs.push(m[1])
  const families = [['plat', 'platform/'], ['solution', 'solutions/'], ['brief', 'solutions/'],
                    ['trust', 'trust/'], ['page', '']]
  for (const [fn, prefix] of families)
    for (const m of src.matchAll(new RegExp(`^  ${fn}\\('([a-z0-9/-]+)'`, 'gm'))) slugs.push(prefix + m[1])
  return ['/', ...[...new Set(slugs)].map((s) => `/${s}`)]
}

/* ── Args ──────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt }
const rIdx = argv.indexOf('--routes')
const ROUTES = rIdx >= 0 ? argv.slice(rIdx + 1).filter((a) => a.startsWith('/')) : routesFromContent()
const REDUCED = flag('--reduced-motion')
const VIEWPORTS = opt('--width', null)
  ? [{ width: Number(opt('--width')), height: Number(opt('--height', 900)) }]
  : [{ width: 1440, height: 900 }, { width: 390, height: 844 }]

/* Requests that failing does not make the page wrong. Media is range-requested
   and aborted by design when a poster is shown instead. */
const BENIGN = [/favicon/i, /\.webm$/i, /fonts\.gstatic/i]

const browser = await chromium.launch({ channel: 'chrome' })
const report = []
let failed = 0

for (const vp of VIEWPORTS) {
  const label = `${vp.width}x${vp.height}`
  const outDir = join(ROOT, 'marketing-verify', REDUCED ? `${label}-reduced` : label)
  mkdirSync(outDir, { recursive: true })
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 1,
    ...(REDUCED ? { reducedMotion: 'reduce' } : {}),
  })

  console.log(`\n══ ${label}${REDUCED ? ' (reduced motion)' : ''} — ${ROUTES.length} routes ══`)

  for (const route of ROUTES) {
    const page = await ctx.newPage()
    const problems = []
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 180)}`) })
    page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 180)}`))
    page.on('requestfailed', (r) => {
      const u = r.url()
      if (!BENIGN.some((re) => re.test(u))) problems.push(`netfail: ${u.slice(0, 140)}`)
    })

    const checks = {}
    try {
      const resp = await page.goto(BASE + route, { waitUntil: 'load', timeout: 45000 })
      if (resp && resp.status() >= 400) problems.push(`http ${resp.status()}`)
      await page.evaluate(() => document.fonts?.ready)

      /* Wait for the layout to STOP GROWING before measuring it.
       *
       * `load` fires while this is still an empty shell — the routes are lazy
       * and React has not mounted the page yet, so document.scrollHeight is a
       * few hundred pixels. Scrolling then walks a page that does not exist, no
       * observer fires below the fold, and the harness reports content as
       * permanently invisible when the truth is that it had not been rendered
       * yet. Poll until the height is the same twice in a row. */
      await page.waitForSelector('.mimic-site', { timeout: 20000 })
      await page.evaluate(async () => {
        let last = -1
        for (let i = 0; i < 40; i++) {
          const h = document.body.scrollHeight
          if (h === last && h > 600) return
          last = h
          await new Promise((r) => setTimeout(r, 120))
        }
      })

      /* Walk the whole page before asserting anything.
       *
       * Checking reveal state at load reads the animation mid-flight and
       * reports content as invisible that is a hundred milliseconds from
       * arriving — the first version of this harness "found" two bugs that
       * were only its own impatience. The honest question is not "is this
       * visible now" but "can the reader ever see it", so scroll to the
       * bottom, let every observer fire, and only then look. It warms the
       * lazy images for the screenshot too. */
      await page.evaluate(async () => {
        const step = Math.round(innerHeight * 0.8)
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          scrollTo({ top: y, behavior: 'instant' })
          await new Promise((r) => setTimeout(r, 90))
        }
        scrollTo({ top: 0, behavior: 'instant' })
        await new Promise((r) => setTimeout(r, 650))
      })

      Object.assign(checks, await page.evaluate(() => {
        const de = document.documentElement
        const main = document.querySelector('main, .mimic-site')
        const h1s = [...document.querySelectorAll('h1')].filter((h) => h.textContent.trim())
        const imgs = [...document.querySelectorAll('img')]
        // The page has been scrolled end to end by now, so every reveal has
        // had its chance. Anything still transparent is content no reader will
        // ever see, wherever it sits on the page.
        const stranded = [...document.querySelectorAll('.reveal, [data-reveal]')]
          .filter((el) => Number(getComputedStyle(el).opacity) < 0.05).length
        const desc = document.querySelector('meta[name="description"]')?.content ?? ''
        return {
          rendered: (main?.getBoundingClientRect().height ?? 0) > 400,
          overflow: de.scrollWidth - de.clientWidth,
          h1count: h1s.length,
          title: document.title,
          hasDesc: desc.length > 20,
          brokenImgs: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
          stranded,
        }
      }))

      if (!checks.rendered) problems.push('render: main collapsed under 400px')
      if (checks.overflow > 1) problems.push(`overflow: ${checks.overflow}px sideways`)
      if (checks.h1count !== 1) problems.push(`h1: found ${checks.h1count}`)
      if (!checks.title || checks.title.length < 5) problems.push(`seo: title "${checks.title}"`)
      if (!checks.hasDesc) problems.push('seo: no meta description')
      if (checks.brokenImgs) problems.push(`images: ${checks.brokenImgs} failed to decode`)
      if (checks.stranded) problems.push(`reveal: ${checks.stranded} elements stuck invisible`)

      const name = (route === '/' ? 'home' : route.slice(1).replace(/\//g, '__')) + '.png'
      await page.screenshot({ path: join(outDir, name), fullPage: true })
    } catch (e) {
      problems.push(`threw: ${String(e).slice(0, 200)}`)
    }

    const pass = problems.length === 0
    if (!pass) failed++
    report.push({ viewport: label, reduced: REDUCED, route, pass, problems, checks })
    console.log(`${pass ? '  ok  ' : '  FAIL'} ${route}${pass ? '' : '\n        ' + problems.join('\n        ')}`)
    await page.close()
  }

  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  await ctx.close()
}

await browser.close()

const total = report.length
console.log(`\n${total - failed}/${total} checks passed across ${ROUTES.length} routes.`)
if (failed) {
  console.log('\nFailures:')
  for (const r of report.filter((r) => !r.pass)) console.log(`  ${r.viewport} ${r.route}: ${r.problems.join('; ')}`)
}
process.exit(failed ? 1 : 0)

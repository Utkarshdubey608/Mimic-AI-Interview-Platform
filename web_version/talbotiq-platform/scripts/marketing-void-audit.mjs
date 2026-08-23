/**
 * Void audit — finds layouts that hug one edge and leave the other empty.
 *
 * The eye catches this instantly and a screenshot diff never does: content
 * pinned to the left of a wide container with a third of the row unused. It is
 * what a two-column grid looks like after one column runs out of things to
 * hold. Symmetric margins are air; a one-sided gap is a hole.
 *
 * For every section, measure the union of its laid-out children against its own
 * content box. Report any block that starts at the left edge and stops well
 * short of the right one.
 */
import { chromium } from 'playwright-core'

const ROUTES = process.argv.slice(2).filter((a) => a.startsWith('/'))
const b = await chromium.launch({ channel: 'chrome' })
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage()

for (const route of ROUTES.length ? ROUTES : ['/']) {
  await p.goto('http://localhost:3001' + route, { waitUntil: 'load' })
  await p.waitForSelector('.mimic-site')
  await p.evaluate(async () => {
    let last = -1
    for (let i = 0; i < 40; i++) {
      const h = document.body.scrollHeight
      if (h === last && h > 600) return
      last = h
      await new Promise((r) => setTimeout(r, 120))
    }
  })
  const found = await p.evaluate(() => {
    const out = []
    for (const sec of document.querySelectorAll('main > section, main > .wrap > *, .mkpage > .wrap > *')) {
      const wrap = sec.querySelector(':scope > .wrap') ?? sec
      const box = wrap.getBoundingClientRect()
      const cs = getComputedStyle(wrap)
      const left = box.left + parseFloat(cs.paddingLeft || 0)
      const right = box.right - parseFloat(cs.paddingRight || 0)
      const width = right - left
      if (width < 400) continue
      /* A single line of text is not a layout block. The breadcrumb is short
         because it says "Mimic / Trust", and reporting it on every inner page
         made the audit something you had to mentally filter — which is the same
         as not having it. Anything under two lines tall is a label. */
      if (box.height < 44) continue
      // Union of the children that actually occupy space.
      let cl = Infinity, cr = -Infinity
      for (const el of wrap.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width < 8 || r.height < 8) continue
        if (getComputedStyle(el).position === 'fixed') continue
        cl = Math.min(cl, r.left); cr = Math.max(cr, r.right)
      }
      if (!isFinite(cl)) continue
      const gapRight = right - cr
      const gapLeft = cl - left
      // A hole: flush left, and a quarter of the row unused on the right.
      if (gapRight > width * 0.22 && gapLeft < width * 0.06) {
        out.push({
          sel: sec.className || sec.tagName,
          width: Math.round(width),
          used: Math.round(cr - cl),
          gapRight: Math.round(gapRight),
          pct: Math.round((gapRight / width) * 100),
        })
      }
    }
    return out
  })
  console.log(`\n${route}`)
  if (!found.length) console.log('  no one-sided voids')
  for (const f of found) console.log(`  ${f.pct}% unused on the right (${f.gapRight}px of ${f.width})  ${String(f.sel).slice(0, 60)}`)
}
await b.close()

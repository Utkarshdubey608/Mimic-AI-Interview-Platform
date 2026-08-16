/**
 * Route integrity for the marketing site. Pure — no DOM, no React, no server.
 *   npx tsx src/features/marketing/routes.test.ts
 *
 * Written after a copy edit silently rewrote fourteen slugs and sixteen link
 * targets. A sweep of hyphens out of the prose also caught the FIRST ARGUMENT
 * of the page helpers — plat('ai-video-avatar', …) became plat('ai-video
 * avatar', …) — so /platform/ai-video-avatar quietly became a URL with a
 * space in it, and every nav link still pointing at the old path fell through
 * to the not-found page.
 *
 * Nothing caught it. `tsc` was happy (they are all just strings), the claims
 * audit was happy, and the browser sweep was happy because a single-page app
 * answers 200 for any path and renders "we couldn't find that page" INSIDE the
 * 200. A slug is not prose; it is a published address that other sites link to
 * and search engines have indexed. It is checked here, not by eye.
 */
import { NAV, PAGES, PAGE_BY_SLUG, type MktPage } from './content'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ', ' + extra : ''}`)
  if (!cond) failures++
}

/* ── Slugs are addresses, so they obey URL rules ───────────────────────────── */
const SLUG_OK = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/

for (const p of PAGES) {
  assert(`slug is url-safe: ${JSON.stringify(p.slug)}`, SLUG_OK.test(p.slug))
}
assert('no slug contains whitespace', PAGES.every((p) => !/\s/.test(p.slug)))
assert('no slug is uppercased', PAGES.every((p) => p.slug === p.slug.toLowerCase()))
assert('slugs are unique', new Set(PAGES.map((p) => p.slug)).size === PAGES.length)

/* ── Every internal link lands on a page that exists ───────────────────────── */
const known = new Set(PAGES.map((p) => p.slug))

/**
 * '/trust/how-mimic-scores#faq' -> 'trust/how-mimic-scores'
 *
 * The optional `mimic` segment is legacy. The marketing site used to be served
 * under /mimic and now sits at the root, so this accepts either shape: without
 * it, every root-level link kept its leading slash, matched nothing in `known`,
 * and all 376 links were reported broken at once — a failure loud enough to
 * look like a catastrophe and vague enough to be ignored.
 *
 * `mimic` must be followed by a slash or end of string, or a future page like
 * /mimicry would silently lose its first five characters.
 */
const toSlug = (to: string) =>
  to.replace(/^\/(?:mimic(?:\/|$))?/, '').split('#')[0].replace(/\/$/, '')

const links: { where: string; to: string }[] = []
for (const g of NAV) {
  links.push({ where: `NAV ${g.label}`, to: g.to })
  for (const c of g.columns) for (const l of c.links) links.push({ where: `NAV ${g.label} / ${l.label}`, to: l.to })
}
for (const p of PAGES) {
  links.push({ where: `${p.slug} sectionTo`, to: p.sectionTo })
  for (const l of p.related ?? []) links.push({ where: `${p.slug} related / ${l.label}`, to: l.to })
}

const broken = links.filter((l) => {
  if (!l.to.startsWith('/')) return false        // external or app route
  const s = toSlug(l.to)
  return s !== '' && !known.has(s)                     // '' is the /mimic home
})
assert(`all ${links.length} internal links resolve`, broken.length === 0,
  broken.length ? broken.map((b) => `${b.where} -> ${b.to}`).join(' | ') : '')

/* ── The nav is the site's contract with the reader ────────────────────────── */
assert('every hub route is a real page or the home route',
  NAV.every((g) => { const s = toSlug(g.to); return s === '' || known.has(s) }))

const hubs = PAGES.filter((p) => p.tier === 'hub').map((p) => p.slug)
assert('every sectionTo points at a hub or home',
  PAGES.every((p: MktPage) => { const s = toSlug(p.sectionTo); return s === '' || hubs.includes(s) }))

/* ── PAGE_BY_SLUG is what the router actually reads ────────────────────────── */
assert('PAGE_BY_SLUG covers every page', Object.keys(PAGE_BY_SLUG).length === PAGES.length)
assert('PAGE_BY_SLUG keys match slugs', PAGES.every((p) => PAGE_BY_SLUG[p.slug] === p))

console.log(failures === 0 ? '\n✅ ALL ROUTE TESTS PASSED' : `\n❌ ${failures} ROUTE TEST(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

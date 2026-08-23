/**
 * Writes a real <head> per marketing route into dist/.
 *
 * MarketingLayout has referenced this file in a comment for some time, and it
 * did not exist. The consequence was invisible from inside the app and total
 * from outside it: every one of the 73 marketing routes served the same
 * index.html, so the HTML a crawler or a link unfurler received carried the
 * generic "Mimic — AI Interview Platform" title, no description, no canonical
 * and no Open Graph tags at all. Google executes JS and would eventually see
 * the tags MarketingLayout sets on mount; Slack, WhatsApp, LinkedIn, iMessage
 * and Twitter do not, so every shared link previewed as a bare title with no
 * summary — on all 73 pages, including the home page.
 *
 * This runs after `vite build` and copies dist/index.html to dist/<slug>/
 * index.html once per route, substituting the head. Firebase Hosting serves a
 * matching static file before it applies the `** -> /index.html` rewrite, so
 * these are what get served; the rewrite still catches app routes and anything
 * unknown, exactly as before.
 *
 * The runtime tags in MarketingLayout stay: they are what keeps the head
 * correct during client-side navigation, where no document is fetched. This only
 * fixes the FIRST response.
 *
 *   npx tsx scripts/prerender-marketing-seo.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGES, HOME_SEO } from '../src/marketing/content'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const ORIGIN = 'https://mimic.talbotiq.com'
/* A wordmark rather than a screenshot, deliberately: the product stills we hold
   either show an unseeded workspace or predate the current UI, and an OG image
   that misrepresents the product is worse than a plain one. */
const OG_IMAGE = `${ORIGIN}/talbotiq-logo-full.png`

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const shell = readFileSync(join(DIST, 'index.html'), 'utf8')

function head(title: string, desc: string, url: string): string {
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Mimic" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(desc)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
  ].join('\n    ')
}

/** Replace the shell's <title> with a full head block. The shell has exactly
 *  one <title> and no description, so this is a substitution rather than a
 *  merge — if a description is ever added to index.html, this must drop it too
 *  or the page ships two. */
function render(title: string, desc: string, url: string): string {
  if (!/<title>[^<]*<\/title>/.test(shell)) {
    throw new Error('dist/index.html has no <title> to replace — did the build change?')
  }
  const out = shell.replace(/<title>[^<]*<\/title>/, head(title, desc, url))
  if (/<meta name="description"/.test(shell)) {
    throw new Error('index.html now ships a description; this script would emit two')
  }
  return out
}

let written = 0
function emit(slug: string, title: string, desc: string) {
  const url = slug ? `${ORIGIN}/${slug}` : `${ORIGIN}/`
  const dir = slug ? join(DIST, slug) : DIST
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), render(title, desc, url), 'utf8')
  written++
}

// The home route overwrites dist/index.html itself, which is also the file the
// hosting rewrite serves for every app route. That is correct: the app sets its
// own document title on mount, and a signed-out visitor landing on a deep app
// link is better served by the marketing title than by a generic one.
emit('', HOME_SEO.metaTitle, HOME_SEO.metaDesc)
for (const p of PAGES) emit(p.slug, p.metaTitle, p.metaDesc)

const long = PAGES.filter((p) => p.metaTitle.length > 65).map((p) => p.slug)
const short = PAGES.filter((p) => p.metaDesc.length < 70).map((p) => p.slug)
console.log(`prerendered ${written} marketing heads into dist/`)
if (long.length) console.log(`  note: ${long.length} title(s) over 65 chars: ${long.join(', ')}`)
if (short.length) console.log(`  note: ${short.length} description(s) under 70 chars: ${short.join(', ')}`)

#!/usr/bin/env node
/**
 * Contrast audit for the Mimic token layer.
 *
 * The previous design system asserted contrast ratios in code comments that a
 * later audit proved wrong across 173 usages. This script exists so that never
 * happens again: every text/ground pair the system PROMISES is measured here,
 * and this file is the promise. It reads the real values out of
 * src/design/tokens.css rather than a copy, so a token edit cannot silently
 * drift away from the documented ratio.
 *
 * Run: node scripts/contrast-audit.mjs
 * Exits non-zero on any failure, so it can gate a build.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, '..', 'src', 'design', 'tokens.css'), 'utf8')

/* ── Parse the two ground blocks out of tokens.css ───────────────────────── */
function block(selector) {
  // Grab from the selector to the closing brace of its rule.
  const i = css.indexOf(selector)
  if (i === -1) throw new Error(`token block not found: ${selector}`)
  const open = css.indexOf('{', i)
  const close = css.indexOf('\n}', open)
  return css.slice(open, close)
}

function vars(text) {
  const out = {}
  for (const m of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const root = vars(block(':root {'))
const record = { ...root, ...vars(block("[data-ground='record']")) }
const room = { ...root, ...vars(block("[data-ground='room']")) }

/** Resolve `var(--x)` chains down to a literal hex. */
function resolve(value, scope, depth = 0) {
  if (depth > 8) throw new Error(`var() cycle at ${value}`)
  const m = /^var\((--[\w-]+)\)$/.exec(value.trim())
  if (!m) return value.trim()
  const next = scope[m[1]]
  if (!next) throw new Error(`unresolved ${m[1]}`)
  return resolve(next, scope, depth + 1)
}

/* ── WCAG 2.1 relative luminance and contrast ────────────────────────────── */
function rgb(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex colour: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/* ── The promises ─────────────────────────────────────────────────────────
   `min` is the bar this pair must clear:
     4.5  body text
     3.0  large text (>=24px, or >=19px bold) and non-text UI boundaries
   Every pair the design system relies on is listed. If a pair is not here, no
   screen may depend on it.                                                  */
const CASES = []

const add = (ground, groundName, scope) => {
  const g = (k) => resolve(scope[k], scope)
  const on = (fg, bg, min, note) =>
    CASES.push({ ground: groundName, fg: g(fg), bg: g(bg), min, label: `${fg} on ${bg}`, note })

  // Text on the page ground and on a panel.
  for (const bg of [ground, '--surface']) {
    on('--ink', bg, 4.5, 'headings, primary values')
    on('--ink-body', bg, 4.5, 'body copy')
    on('--ink-muted', bg, 4.5, 'secondary text, captions, field labels')
    on('--ink-faint', bg, 4.5, 'the quietest permissible text')
  }

  // Accents used AS text.
  on('--accent-ink', '--surface', 4.5, 'links, accent text')
  on('--intel-fg', '--intel-bg', 4.5, 'AI-generated content marker')
  on('--live-fg', '--live-bg', 4.5, 'live connection marker')
  // Machine presence — the AI accent must hold as text everywhere it appears.
  on('--ai-fg', '--ai-bg', 4.5, 'AI state / insight text on its own tint')
  on('--ai-fg', '--surface', 4.5, 'AI state / insight text on a panel')
  on('--ai-fg', ground, 4.5, 'AI state / insight text on the page ground')
  on('--ok', '--ok-bg', 4.5, 'pass / healthy')
  on('--warn', '--warn-bg', 4.5, 'attention')
  on('--risk', '--risk-bg', 4.5, 'flagged / rejected / destructive')

  // Non-text boundaries. WCAG 1.4.11 covers the boundary of a UI COMPONENT —
  // the edge you need in order to find the control. An input border qualifies;
  // a divider between two table rows does not, because the rows are identifiable
  // without it. So --rule-strong is reported for visibility but not gated, and
  // saying so here is the honest version of "it fails" — it was never in scope.
  on('--rule-input', '--surface', 3, 'input border')
  on('--rule-input', ground, 3, 'input border on the page ground')
  on('--rule-strong', '--surface', null, 'structural divider — decorative, not gated')
  on('--focus-ring', '--surface', 3, 'focus ring on a panel')
  on('--focus-ring', ground, 3, 'focus ring on the page ground')
}

add('--ground', 'record', record)
add('--ground', 'room', room)

// The exhibit ramp: each format colour must be legible as ink on its own
// ground, because the tab label is set in it.
const EXHIBITS = ['chat', 'chatbot', 'voice', 'avatar', 'video', 'twoway']
for (const e of EXHIBITS) {
  CASES.push({
    ground: 'record', fg: resolve(root[`--ex-${e}`], root), bg: resolve(record['--surface-sunk'], record),
    min: 4.5, label: `--ex-${e} on --surface-sunk`, note: 'exhibit tab label',
  })
  CASES.push({
    ground: 'room', fg: resolve(root[`--ex-${e}-room`], root), bg: resolve(room['--ground'], room),
    min: 4.5, label: `--ex-${e}-room on --ground`, note: 'exhibit tab label, dark',
  })
}

// White text on the filled primary action, on both grounds.
CASES.push({
  ground: 'record', fg: '#FFFFFF', bg: resolve(record['--accent'], record),
  min: 4.5, label: 'white on --accent', note: 'primary button label',
})
CASES.push({
  ground: 'room', fg: resolve(room['--ink-inverse'], room), bg: resolve(room['--accent'], room),
  min: 4.5, label: '--ink-inverse on --accent', note: 'primary button label, dark',
})

/* ── Drift check: src/design/tokens.ts against src/design/tokens.css ───────
   tokens.ts duplicates a subset of the palette as TS literals, because charts,
   canvas and GL materials need the value during render and cannot read a CSS
   custom property without forcing a reflow. Duplication is a correctness risk,
   so it is checked rather than trusted: edit one and this fails.            */
const ts = readFileSync(join(here, '..', 'src', 'design', 'tokens.ts'), 'utf8')

function tsBlock(name) {
  const i = ts.indexOf(`const ${name} = {`)
  if (i === -1) throw new Error(`tokens.ts block not found: ${name}`)
  return ts.slice(i, ts.indexOf('} as const', i))
}

function tsEntries(name) {
  const out = {}
  for (const m of tsBlock(name).matchAll(/(\w+):\s*'(#[0-9A-Fa-f]{6})'/g)) out[m[1]] = m[2]
  return out
}

// camelCase in TS ↔ kebab-case custom property, plus the handful of names that
// do not map mechanically. `--intel` and `--live` are ground-INDEPENDENT brand
// constants declared once at :root; the value a surface actually paints with is
// `--intel-fg` / `--live-fg`, which each ground rebinds. tokens.ts stores the
// painted value, so it must be compared against the -fg pair.
const ALIAS = { intel: '--intel-fg', live: '--live-fg', ai: '--ai-fg' }
const kebab = (s) => ALIAS[s] ?? '--' + s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

const drift = []
for (const [name, scope] of [['record', record], ['room', room]]) {
  for (const [key, hex] of Object.entries(tsEntries(name))) {
    const cssVar = kebab(key)
    const declared = scope[cssVar]
    if (!declared) { drift.push(`${name}.${key} → ${cssVar} is not declared in tokens.css`); continue }
    const want = resolve(declared, scope).toUpperCase()
    if (want !== hex.toUpperCase()) {
      drift.push(`${name}.${key}: tokens.ts has ${hex}, tokens.css has ${want}`)
    }
  }
}

// The exhibit ramp is declared in both files too.
for (const [track, v] of Object.entries({
  chat: 'chat', chatbot: 'chatbot', voice: 'voice',
  video_avatar: 'avatar', video: 'video', two_way: 'twoway',
})) {
  const m = new RegExp(`${track}:\\s*\\{\\s*record:\\s*'(#[0-9A-Fa-f]{6})',\\s*room:\\s*'(#[0-9A-Fa-f]{6})'`).exec(ts)
  if (!m) { drift.push(`exhibit.${track} not found in tokens.ts`); continue }
  const cssRecord = resolve(root[`--ex-${v}`], root).toUpperCase()
  const cssRoom = resolve(root[`--ex-${v}-room`], root).toUpperCase()
  if (m[1].toUpperCase() !== cssRecord) drift.push(`exhibit.${track}.record: ts ${m[1]} vs css ${cssRecord}`)
  if (m[2].toUpperCase() !== cssRoom) drift.push(`exhibit.${track}.room: ts ${m[2]} vs css ${cssRoom}`)
}

/* ── Report ──────────────────────────────────────────────────────────────── */
let failed = 0
let gated = 0
const rows = CASES.map((c) => {
  const r = ratio(c.fg, c.bg)
  const pass = c.min === null ? null : r >= c.min
  if (pass === false) failed++
  if (c.min !== null) gated++
  return { ...c, r, pass }
})

// Group by ground so the two worlds read as two blocks, not one interleaved list.
const w = Math.max(...rows.map((r) => r.label.length))
for (const g of ['record', 'room']) {
  console.log(`\n  ${g === 'record' ? 'THE RECORD (light)' : 'THE ROOM (dark)'}`)
  console.log(`  ${'─'.repeat(w + 40)}`)
  for (const r of rows.filter((x) => x.ground === g)) {
    const mark = r.pass === null ? '  --  ' : r.pass ? '  ok  ' : ' FAIL '
    const bar = r.min === null ? '  (n/a)' : `  (min ${r.min})`
    console.log(`  ${mark}${r.label.padEnd(w)}  ${r.r.toFixed(2).padStart(6)}:1${bar}  ${r.note}`)
  }
}

console.log(
  `\n  ${gated - failed}/${gated} gated pairs pass` +
    (failed ? `  —  ${failed} FAILING` : '  —  every promised pair clears its bar'),
)

if (drift.length) {
  console.log('\n  TOKEN DRIFT — tokens.ts and tokens.css disagree')
  console.log(`  ${'─'.repeat(60)}`)
  for (const d of drift) console.log(`   FAIL ${d}`)
  console.log('')
} else {
  console.log('  tokens.ts matches tokens.css — no drift\n')
}

process.exit(failed || drift.length ? 1 : 0)

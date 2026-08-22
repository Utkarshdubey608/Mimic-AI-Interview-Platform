/**
 * Runs every *.test.ts in the repo through tsx, then the deployment gates.
 * Usage:  npm test
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
// Invoke tsx's CLI with this same node binary rather than going through `npx`
// in a shell — no shell means no arg-escaping issues on paths with spaces, and
// no DEP0190 deprecation warning.
const TSX_CLI = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (e.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

const tests = walk(ROOT).sort()
console.log(`Running ${tests.length} test file(s)\n`)

const failed = []
for (const t of tests) {
  const rel = path.relative(ROOT, t).replace(/\\/g, '/')
  try {
    execFileSync(process.execPath, [TSX_CLI, rel], { cwd: ROOT, stdio: 'pipe' })
    console.log(`  ✅ ${rel}`)
  } catch (err) {
    console.log(`  ❌ ${rel}`)
    console.log(String(err.stdout ?? '').split('\n').filter((l) => l.includes('FAIL')).join('\n'))
    failed.push(rel)
  }
}

if (failed.length) {
  console.log(`\n❌ ${failed.length} test file(s) failed:\n${failed.map((f) => `   ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('\n✅ All test files passed')

/* ── The colour system's promises are part of the deploy gate ───────────────
   contrast-audit.mjs used to be a manual step, which is how a manual step is
   skipped. It measures every text/ground pair the token layer promises and
   checks tokens.ts against tokens.css for drift; a token edit that breaks a
   promise now fails the same command that runs the tests. */
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'contrast-audit.mjs')], {
    cwd: ROOT,
    stdio: 'pipe',
  })
  console.log('✅ Contrast audit — every promised pair clears its bar, no token drift')
} catch (err) {
  console.log('\n❌ Contrast audit failed:')
  console.log(String(err.stdout ?? ''))
  process.exit(1)
}

/* ── The browser harness must never ship ───────────────────────────────────
   `/__mcq` mounts a recruiter screen OUTSIDE the identity gate, so Playwright can
   drive it without a Firebase session. It is guarded by `import.meta.env.DEV`,
   which Vite replaces at build time, so a production bundle should not contain it.

   "Should" is exactly why this check exists. A refactor that moved the route
   behind a runtime flag, or a bundler setting that stopped folding the constant,
   would silently publish an unauthenticated recruiter route — and nothing else in
   this pipeline would notice. Runs only when a build is present, so it is a no-op
   before one. */
// Every dev-only harness route. Listed rather than pattern-matched so adding one
// without adding it here is a visible omission rather than a silent gap.
const HARNESS_ROUTES = ['/__mcq-take', '/__mcq']
const distAssets = path.join(ROOT, 'dist', 'assets')
if (fs.existsSync(distAssets)) {
  const leaked = fs
    .readdirSync(distAssets)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => {
      const js = fs.readFileSync(path.join(distAssets, f), 'utf8')
      return HARNESS_ROUTES.some((route) => js.includes(route))
    })
  if (leaked.length) {
    console.log(
      `\n❌ A dev-only harness route reached the production bundle: ${leaked.join(', ')}`,
    )
    console.log('   These render recruiter or candidate screens with no identity check.')
    process.exit(1)
  }
  console.log('✅ No dev-only harness route in the production bundle')
}

/**
 * Guards against a client file addressing the API same-origin again. On a
 * Vercel + Render split those URLs resolve to Vercel, where no API exists.
 * Run with:  npx tsx src/lib/apiOrigin.callsites.test.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, '..')

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}

/** Every .ts/.tsx file under src/, minus this test and the helper it guards. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(full)
  }
  return out
}

const files = walk(SRC).filter((f) => path.basename(f) !== 'apiOrigin.ts')

console.log('\n=== no same-origin API URLs remain in src/ ===')
for (const f of files) {
  const body = fs.readFileSync(f, 'utf8')
  const rel = path.relative(SRC, f).replace(/\\/g, '/')
  // A WebSocket URL built from the page host.
  assert(`${rel}: no location.host WS URL`, !/location\.host/.test(body))
  // A literal '/api' base. Individual '/api/...' path fragments passed INTO
  // httpBase()/wsUrl() are fine; a bare base assignment is not.
  assert(`${rel}: no bare '/api' base const`, !/^\s*const\s+BASE\s*=\s*['"]\/api/m.test(body))
}

// voiceClient.ts is deliberately absent: the Voice Track connects the browser
// straight to Gemini Live with a backend-minted token (see src/lib/geminiLive.ts),
// so its socket URL is Google's, not ours.
console.log('\n=== the three backend WS call sites use wsUrl() ===')
for (const rel of [
  'hooks/useAudioAnalysis.ts',
  'hooks/useDeepgramTranscript.ts',
  'features/interview/useAnswerRecorder.ts',
]) {
  const body = fs.readFileSync(path.join(SRC, rel), 'utf8')
  assert(`${rel} imports wsUrl`, /wsUrl/.test(body))
}

console.log('\n=== the two HTTP base sites use httpBase() ===')
for (const rel of ['lib/api.ts', 'lib/faceCache.ts']) {
  const body = fs.readFileSync(path.join(SRC, rel), 'utf8')
  assert(`${rel} imports httpBase`, /httpBase/.test(body))
}

console.log(`\n${failures === 0 ? '✅ ALL CALL-SITE TESTS PASSED' : `❌ ${failures} ASSERTION(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

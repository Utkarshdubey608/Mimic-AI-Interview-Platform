/**
 * Pure-resolver tests for the API origin helper. No DOM, no import.meta.env —
 * only the pure functions are exercised. Run with:
 *   npx tsx src/lib/apiOrigin.test.ts
 */
import { resolveHttpBase, resolveWsUrl } from './apiOrigin'

let failures = 0
function assert(label: string, cond: boolean, extra = '') {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) failures++
}
function eq(label: string, actual: string, expected: string) {
  assert(label, actual === expected, actual === expected ? '' : `got "${actual}", want "${expected}"`)
}

console.log('\n=== resolveHttpBase (web surface lives under /api/web) ===')
eq('blank → same-origin /api/web', resolveHttpBase(''), '/api/web')
eq('undefined → same-origin /api/web', resolveHttpBase(undefined), '/api/web')
eq('whitespace → same-origin /api/web', resolveHttpBase('   '), '/api/web')
eq('absolute https base', resolveHttpBase('https://api.example.com'), 'https://api.example.com/api/web')
eq('trailing slash trimmed', resolveHttpBase('https://api.example.com/'), 'https://api.example.com/api/web')
eq('many trailing slashes trimmed', resolveHttpBase('https://api.example.com///'), 'https://api.example.com/api/web')
eq('scheme-less base assumes https', resolveHttpBase('api.example.com'), 'https://api.example.com/api/web')
eq('http base preserved', resolveHttpBase('http://localhost:8787'), 'http://localhost:8787/api/web')

console.log('\n=== resolveWsUrl (blank base → same-origin, page protocol decides) ===')
eq('https page → wss', resolveWsUrl('', 'https:', 'app.example.com', '/api/voice/s1'), 'wss://app.example.com/api/voice/s1')
eq('http page → ws', resolveWsUrl('', 'http:', 'localhost:3001', '/api/voice/s1'), 'ws://localhost:3001/api/voice/s1')

console.log('\n=== resolveWsUrl (explicit base → TARGET protocol decides) ===')
eq('https base → wss', resolveWsUrl('https://api.example.com', 'https:', 'app.example.com', '/api/voice/s1'), 'wss://api.example.com/api/voice/s1')
eq('http base → ws', resolveWsUrl('http://localhost:8787', 'http:', 'localhost:3001', '/api/voice/s1'), 'ws://localhost:8787/api/voice/s1')
// The page being http must NOT downgrade an https API base to ws:// — that
// would silently break the Voice Track behind any TLS-terminating proxy.
eq('http page never downgrades https base', resolveWsUrl('https://api.example.com', 'http:', 'x', '/api/voice/s1'), 'wss://api.example.com/api/voice/s1')
eq('scheme-less base assumes wss', resolveWsUrl('api.example.com', 'http:', 'x', '/api/voice/s1'), 'wss://api.example.com/api/voice/s1')
eq('trailing slash on base trimmed', resolveWsUrl('https://api.example.com/', 'https:', 'x', '/api/voice/s1'), 'wss://api.example.com/api/voice/s1')
eq('path without leading slash', resolveWsUrl('https://api.example.com', 'https:', 'x', 'api/voice/s1'), 'wss://api.example.com/api/voice/s1')
eq('query string preserved', resolveWsUrl('https://api.example.com', 'https:', 'x', '/api/avatar/deepgram?token=ab%20c'), 'wss://api.example.com/api/avatar/deepgram?token=ab%20c')

console.log(`\n${failures === 0 ? '✅ ALL API-ORIGIN TESTS PASSED' : `❌ ${failures} ASSERTION(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

/**
 * Run with:  npx tsx src/lib/validate.test.ts
 *
 * Mirrors `mobile_desktop_app_version/lib/core/utils/validators.dart` case for case.
 *
 * The point is not that either implementation is correct in isolation — the server
 * re-checks everything. It is that they AGREE: an address one client accepts and the
 * other rejects is an invite that works in one place and not the other, and a candidate
 * who mistypes should be told the same thing wherever they are. If one side changes,
 * both test files must.
 */
import {
  clampedInt,
  emailError,
  httpUrlError,
  isSafeHttpUrl,
  isValidEmail,
} from './validate'

let failures = 0
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}`}`)
  if (!ok) failures++
}

console.log('\n=== addresses people actually have ===')
for (const address of [
  'ada@example.com',
  'ada.lovelace@example.co.uk',
  "o'brien+tag@sub.example.io",
  'a@b.co',
]) {
  eq(address, isValidEmail(address), true)
}

console.log('\n=== mistakes people actually make ===')
for (const bad of ['', '   ', 'ada', 'ada@', '@example.com', 'ada@example', 'a b@example.com']) {
  eq(JSON.stringify(bad), isValidEmail(bad), false)
}

console.log('\n=== surrounding whitespace is trimmed, not rejected ===')
// A pasted address usually arrives with some.
eq('"  ada@example.com  "', isValidEmail('  ada@example.com  '), true)

console.log('\n=== an absurd length is refused ===')
eq('250-char local part', isValidEmail(`${'a'.repeat(250)}@example.com`), false)

console.log('\n=== a field needs a message, not a boolean ===')
eq('valid → null', emailError('ada@example.com'), null)
eq('invalid → message', emailError('ada'), 'Enter a valid email address.')

console.log('\n=== outbound URLs: https is fine ===')
eq('https', isSafeHttpUrl('https://example.com/hook'), true)

console.log('\n=== the scheme-injection surface is blocked ===')
// The reason this exists rather than a length check.
for (const bad of [
  'javascript:alert(1)',
  'file:///etc/passwd',
  'data:text/html,<script>',
  'not a url',
  '',
]) {
  eq(JSON.stringify(bad), isSafeHttpUrl(bad), false)
}

console.log('\n=== plain http only on localhost ===')
eq('http://example.com', isSafeHttpUrl('http://example.com'), false)
// The cloud metadata endpoint — the specific SSRF target worth naming.
eq('metadata endpoint', isSafeHttpUrl('http://169.254.169.254/latest/meta-data/'), false)
eq('http://localhost:8000', isSafeHttpUrl('http://localhost:8000/hook'), true)
eq('http://127.0.0.1:8000', isSafeHttpUrl('http://127.0.0.1:8000/hook'), true)

console.log('\n=== required vs optional ===')
eq('empty + required', httpUrlError('', { required: true }), 'Enter a URL.')
eq('empty + optional', httpUrlError('', { required: false }), null)
eq('unsafe', httpUrlError('javascript:x'), 'Enter a valid https URL.')

console.log('\n=== integers clamp rather than reject ===')
// "500" in a 1-25 field has an obvious intent; refusing it makes somebody retype.
eq('500 → 25', clampedInt('500', { min: 1, max: 25, fallback: 5 }), 25)
eq('-3 → 1', clampedInt('-3', { min: 1, max: 25, fallback: 5 }), 1)
eq('7 → 7', clampedInt('7', { min: 1, max: 25, fallback: 5 }), 7)

console.log('\n=== and fall back when not a number at all ===')
for (const bad of ['', '   ', 'lots', null, undefined]) {
  eq(JSON.stringify(bad), clampedInt(bad, { min: 1, max: 25, fallback: 5 }), 5)
}

console.log(failures === 0 ? '\nAll validation cases pass.\n' : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)

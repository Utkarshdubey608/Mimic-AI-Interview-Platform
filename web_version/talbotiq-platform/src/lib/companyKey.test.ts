/**
 * Run with:  npx tsx src/lib/companyKey.test.ts
 *
 * Mirrors backend/tests/web/test_web_company.py case for case. The key is
 * computed in the browser at sign-up and compared against one computed on the
 * server, so if these two implementations disagree, colleagues at one company
 * silently stop seeing each other's work. If one side changes, both test files
 * must.
 */
import { companyKey, companyDisplay, sameCompany, MAX_COMPANY_NAME } from './companyKey'

let failures = 0
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}`}`)
  if (!ok) failures++
}

console.log('\n=== names that mean the same company ===')
for (const typed of ['Talbotiq', 'talbotiq', 'taLbotiq', 'TALBOTIQ', '  Talbotiq  ', '\tTalbotiq\n']) {
  eq(JSON.stringify(typed), companyKey(typed), 'talbotiq')
}
eq('internal whitespace collapses', companyKey('Talbotiq   Technologies'), 'talbotiq technologies')
eq('tabs collapse too', companyKey('Talbotiq\tTechnologies'), 'talbotiq technologies')
// Ｔ and T look the same to a person and must not be two companies.
eq('full-width normalises to ascii', companyKey('Ｔalbotiq'), 'talbotiq')
// A zero-width joiner is invisible in every UI — without stripping it, one
// pasted name creates a second company that looks identical on screen.
eq('zero-width stripped', companyKey('Talbo​tiq'), 'talbotiq')
eq('BOM stripped', companyKey('﻿Talbotiq'), 'talbotiq')
eq('sameCompany accepts any spelling', sameCompany('TalbotIQ', '  talbotiq '), true)

console.log('\n=== names that are DIFFERENT companies ===')
// Wrongly splitting one company is an annoyance somebody reports; wrongly
// merging two is a leak nobody notices. So no guessing.
eq('a legal suffix is not stripped', companyKey('Talbotiq') === companyKey('Talbotiq Ltd'), false)
eq('punctuation is not stripped', companyKey('Talbot-iq') === companyKey('Talbotiq'), false)
eq('different names do not match', sameCompany('Talbotiq', 'Acme'), false)

console.log('\n=== the absent case ===')
for (const blank of [null, undefined, '', '   ', '\t\n', '​']) {
  eq(`blank ${JSON.stringify(blank)}`, companyKey(blank), '')
}
// If absent matched absent, every account with no company recorded would land in
// one shared bucket and see each other's templates.
eq('two unknowns are NOT the same company', sameCompany(null, null), false)
eq('empty strings are NOT the same company', sameCompany('', ''), false)
eq('known never matches unknown', sameCompany('Talbotiq', null), false)
eq('unknown never matches known', sameCompany(null, 'Talbotiq'), false)

console.log('\n=== display name ===')
eq('typed capitalisation survives', companyDisplay('  TalbotIQ  '), 'TalbotIQ')
eq('display tidies whitespace', companyDisplay('Talbotiq   Technologies'), 'Talbotiq Technologies')
eq(
  'display and key agree on which company it is',
  companyKey(companyDisplay('  TalbotIQ   Technologies ')),
  companyKey('  TalbotIQ   Technologies '),
)

console.log('\n=== bounded ===')
eq('a very long name is capped', companyKey('A'.repeat(500)).length, MAX_COMPANY_NAME)

console.log(failures === 0 ? '\nAll company-key assertions passed\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)

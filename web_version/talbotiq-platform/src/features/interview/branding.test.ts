/**
 * Run with:  npx tsx src/features/interview/branding.test.ts
 *
 * The interesting cases are the two directions of the same rule: a recruiter's
 * identity must never be overwritten by the product's, and an interview that
 * never had one must never show a stray letter from a legacy default.
 */
import type { BrandingConfig } from '@shared/types'
import { brandInitial, brandName, isProductBranding, PRODUCT_NAME } from './branding'

let failures = 0
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}`}`)
  if (!ok) failures++
}

const b = (over: Partial<BrandingConfig>): BrandingConfig =>
  ({ companyName: '', accentColor: '#0E1420', ...over })

console.log('\n=== unbranded interviews show the product ===')
eq('the legacy persisted default', isProductBranding(b({ companyName: 'TalbotIQ' })), true)
eq('case and padding do not matter', isProductBranding(b({ companyName: '  talbotiq ' })), true)
eq('the new default', isProductBranding(b({ companyName: 'Mimic' })), true)
eq('an empty name', isProductBranding(b({ companyName: '' })), true)
eq('name printed', brandName(b({ companyName: 'TalbotIQ' })), PRODUCT_NAME)

console.log('\n=== a recruiter identity always wins ===')
eq('a real company', isProductBranding(b({ companyName: 'Acme' })), false)
eq('name printed', brandName(b({ companyName: 'Acme' })), 'Acme')
eq('initial printed', brandInitial(b({ companyName: 'Acme' })), 'A')
eq(
  'a logo settles it even under a default name',
  isProductBranding(b({ companyName: 'TalbotIQ', logoUrl: 'https://x/y.png' })),
  false,
)
eq(
  'and that interview keeps its own name',
  brandName(b({ companyName: 'TalbotIQ', logoUrl: 'https://x/y.png' })),
  'TalbotIQ',
)

console.log('\n=== the initial never comes back empty ===')
eq('empty name falls back to the product', brandInitial(b({ companyName: '' })), 'M')

console.log(failures === 0 ? '\nAll branding assertions passed\n' : `\n${failures} failed\n`)
process.exit(failures === 0 ? 0 : 1)

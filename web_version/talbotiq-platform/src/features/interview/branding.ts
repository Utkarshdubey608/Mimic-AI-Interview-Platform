/**
 * Whose name the candidate sees at the top of an interview.
 *
 * An interview can carry a recruiter's own identity — their company name and
 * logo, set on the template. When it does, that identity wins everywhere and
 * nothing here applies: the candidate is being interviewed by that company, not
 * by us, and stamping the product mark over their logo would be wrong.
 *
 * When it does NOT, the interview still has to be branded as something, and the
 * honest answer is the product: Mimic.
 */
import type { BrandingConfig } from '@shared/types'

/** The product's own name, as a candidate should read it. */
export const PRODUCT_NAME = 'Mimic'

export const FALLBACK_BRANDING: BrandingConfig = {
  companyName: PRODUCT_NAME,
  accentColor: '#0E1420',
}

/**
 * The names that mean "no recruiter identity was ever set".
 *
 * `talbotiq` is in this list for a migration reason, not a cosmetic one. It was
 * the default company name written into every template created before the
 * product took the Mimic name, so it sits persisted in Firestore on templates
 * nobody ever branded — and changing the default in code cannot reach a document
 * that already exists. Treating it as unbranded is what lets those interviews
 * show the product mark without a data migration.
 *
 * The cost is the honest one to state: a recruiter who genuinely IS TalbotIQ and
 * sets no logo gets the Mimic mark. They can override it by setting a logo, and
 * TalbotIQ is the one company for whom the product mark is not a misattribution.
 */
const UNBRANDED = new Set(['', 'mimic', 'talbotiq'])

/**
 * True when this interview carries no recruiter identity, so the product's own
 * name and mark should stand in.
 *
 * A logo settles it on its own: anyone who uploaded one has an identity, whatever
 * they typed in the name field.
 */
export function isProductBranding(branding: BrandingConfig): boolean {
  if (branding.logoUrl) return false
  return UNBRANDED.has((branding.companyName || '').trim().toLowerCase())
}

/** The name to print. The recruiter's when there is one, the product's otherwise. */
export function brandName(branding: BrandingConfig): string {
  return isProductBranding(branding) ? PRODUCT_NAME : branding.companyName
}

/**
 * The single letter to fall back to when there is no logo and no product mark —
 * a recruiter who typed a name but uploaded nothing.
 */
export function brandInitial(branding: BrandingConfig): string {
  return (branding.companyName || PRODUCT_NAME).charAt(0).toUpperCase()
}

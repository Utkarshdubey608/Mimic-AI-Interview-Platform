/**
 * Company identity — one spelling, however it was typed.
 *
 * Recruiters from the same company must see the same templates, question sets and
 * configuration; recruiters from different companies must not. That only holds if
 * "Talbotiq", "talbotiq", "taLbotiq" and "  Talbotiq " are recognised as ONE
 * company, so every comparison goes through `companyKey` and never through the
 * name a person typed.
 *
 * TWO VALUES ARE STORED, and both are needed:
 *
 *   companyName  what the person typed, kept for display. "TalbotIQ" should read
 *                as "TalbotIQ" in the UI, not flattened to "talbotiq".
 *   companyKey   the normalised form, and the only thing ever compared.
 *
 * ── What normalising does, and deliberately does not do ────────────────────
 * DOES: Unicode NFKC (so a full-width Ｔ and an ASCII T are one letter), strips
 * zero-width characters (an invisible joiner would otherwise create a second,
 * indistinguishable company), collapses whitespace runs, trims, lowercases.
 *
 * DOES NOT: strip punctuation or legal suffixes like Ltd / Inc / GmbH.
 * "Talbotiq" and "Talbotiq Ltd" stay DIFFERENT keys. That is the cautious
 * direction: wrongly splitting one company is a visible annoyance somebody
 * reports, while wrongly merging two is a cross-company data leak nobody
 * notices. Never merge on a guess.
 *
 * ── Kept identical to the server ───────────────────────────────────────────
 * `backend/app/web/shared/company.py` implements the same function, and
 * `companyKey.test.ts` mirrors `test_web_company.py` case for case, because a
 * key computed in the browser at sign-up is compared against one computed on the
 * server. The server uses Python's `lower()` rather than `casefold()` for the
 * same reason this uses plain `toLowerCase()`: `casefold()` turns "ß" into "ss"
 * and would silently disagree with the browser.
 */

// Zero-width and bidirectional marks — invisible in every UI, so two names that
// look identical could differ by one and become separate companies.
const INVISIBLE = /[​-‏‪-‮⁠﻿]/g
const WHITESPACE = /\s+/g

export const MAX_COMPANY_NAME = 120

/** The canonical form. Empty string when there is no name — never a wildcard. */
export function companyKey(name: string | null | undefined): string {
  if (!name) return ''
  const cleaned = String(name)
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(WHITESPACE, ' ')
    .trim()
  return cleaned.toLowerCase().slice(0, MAX_COMPANY_NAME)
}

/** The name as typed — whitespace tidied, capitalisation kept. */
export function companyDisplay(name: string | null | undefined): string {
  if (!name) return ''
  return String(name)
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(WHITESPACE, ' ')
    .trim()
    .slice(0, MAX_COMPANY_NAME)
}

/**
 * Whether two typed names mean the same company.
 *
 * False when either is missing. Two unknowns are NOT a match — treating them as
 * one would put every account with no company recorded into a single shared
 * bucket, which is the leak this exists to prevent.
 */
export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const keyA = companyKey(a)
  return keyA !== '' && keyA === companyKey(b)
}

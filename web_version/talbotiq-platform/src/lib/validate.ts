/**
 * Input validation, in one place — the web counterpart of mobile's `validators.dart`.
 *
 * **The server is still authoritative.** Every rule here is also enforced server-side,
 * and has to be: a browser check is a courtesy to the person typing, not a control. What
 * this fixes is the courtesy being inconsistent — auth, candidate assignment and the
 * invite wizard each validated emails slightly differently, or not at all, so the same
 * mistyped address was caught in one place and accepted in another.
 *
 * Kept deliberately parallel to `mobile_desktop_app_version/lib/core/utils/validators.dart`,
 * because a candidate who mistypes their email should be told the same thing whichever
 * client they are in. `validate.test.ts` asserts the two agree on the same inputs.
 */

/**
 * A pragmatic email pattern: one @, a dotted domain, no spaces.
 *
 * Deliberately NOT RFC-5322-exhaustive. It rejects the mistakes people actually make —
 * a missing @, a trailing space, no TLD — without rejecting valid addresses, which is
 * the failure mode that matters: a real candidate locked out of their own interview by
 * an over-strict regex has no way around it.
 *
 * Character-for-character the pattern in validators.dart.
 */
const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/

/** RFC 5321's practical ceiling. Longer is a paste accident, not an address. */
export const MAX_EMAIL_LENGTH = 254

export function isValidEmail(value: string | null | undefined): boolean {
  if (!value) return false
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_EMAIL_LENGTH && EMAIL.test(trimmed)
}

/** A message to show, or null when it is fine. */
export function emailError(value: string | null | undefined): string | null {
  return isValidEmail(value) ? null : 'Enter a valid email address.'
}

/**
 * A safe outbound URL: a well-formed absolute `https` URL with a real host, or `http`
 * for localhost in development.
 *
 * This is the one rule here that is more than a courtesy. It blocks the
 * scheme-injection and SSRF surface that free-text URL fields otherwise accept —
 * `javascript:`, `file://`, and `http://169.254.169.254/…`, which is the cloud
 * metadata endpoint. The server checks the same thing; a URL that only reaches the
 * server having passed here is not the threat model, a URL rendered as a link in
 * somebody's browser is.
 */
export function isSafeHttpUrl(
  value: string | null | undefined,
  { allowHttpLocalhost = true }: { allowHttpLocalhost?: boolean } = {},
): boolean {
  if (!value) return false
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return false
  }
  if (!url.hostname) return false
  if (url.protocol === 'https:') return true
  return (
    allowHttpLocalhost &&
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  )
}

export function httpUrlError(
  value: string | null | undefined,
  { required = true }: { required?: boolean } = {},
): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return required ? 'Enter a URL.' : null
  return isSafeHttpUrl(trimmed) ? null : 'Enter a valid https URL.'
}

/**
 * Clamp a typed integer into a range, falling back when it is not a number.
 *
 * For the duration and count fields that otherwise accept negatives and absurd values.
 * Clamping rather than rejecting, because the intent of "500" in a 1–25 field is
 * obvious and refusing it makes somebody retype.
 */
export function clampedInt(
  text: string | null | undefined,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  const parsed = Number.parseInt((text ?? '').trim(), 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

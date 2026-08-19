/**
 * Dash-style punctuation, out of anything a candidate reads.
 *
 * The backend already does this to generated questions and chat turns. This is
 * the same rule for text that arrives as DATA rather than code: welcome
 * messages, company names, custom notes — copy a recruiter typed into Firestore
 * months ago, which no amount of editing our own source files will reach.
 *
 * Same contract as the server's `humanize_punctuation`, deliberately: em dash,
 * en dash, and a spaced hyphen used as a dash become a comma. Hyphens inside
 * words are untouched, because "auto-submits" and "e-commerce" are words. A
 * previous blanket hyphen sweep in this repo rewrote a route slug to
 * 'ai-video avatar' and published a URL with a space in it.
 */
const DASH_AS_PUNCTUATION = /\s*[—–]\s*|\s+-\s+/g

export function humanizeDashes(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(DASH_AS_PUNCTUATION, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

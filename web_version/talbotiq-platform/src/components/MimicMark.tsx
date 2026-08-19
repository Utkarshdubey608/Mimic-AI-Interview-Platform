/**
 * The Mimic mark.
 *
 * The same five-segment path the marketing site draws in its nav, kept here as
 * the one definition the product uses — the interview header and every
 * interviewer bubble read from this file, so the mark cannot drift between the
 * site a candidate arrives from and the interview they land in.
 *
 * Stroked in `currentColor` rather than a fixed colour, because it has to sit
 * in both directions: white on the ink chip in the interview header, and ink on
 * the white chip beside each message. The caller sets `color`; the mark follows.
 *
 * `aria-hidden` by default and no `<title>`: everywhere it is used the brand
 * name is already beside it in real text, and a second announcement of the same
 * word is noise to a screen reader.
 */
export function MimicMark({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <path
        d="M7 21V11l5 6 4-6 4 6 5-6v10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

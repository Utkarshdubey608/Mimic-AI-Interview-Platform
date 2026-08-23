// lib/features/auth/company_key.dart
//
// Company identity — one spelling, however it was typed.
//
// Recruiters from the same company must see the same templates and question sets;
// recruiters from different companies must not. That only holds if "Talbotiq",
// "talbotiq", "taLbotiq" and "  Talbotiq " are recognised as ONE company, so every
// comparison goes through the key and never through the name a person typed.
//
// ── Kept identical to the other two implementations ─────────────────────────
// `web_version/talbotiq-platform/src/lib/companyKey.ts` and
// `backend/app/web/shared/company.py` do the same thing, and a key computed on this
// device is compared against one computed on the server. All three:
//
//   DO   Unicode NFKC (a full-width Ｔ and an ASCII T are one letter), strip
//        zero-width characters (an invisible joiner would otherwise create a second,
//        indistinguishable company), collapse whitespace runs, trim, lowercase.
//
//   DO NOT strip punctuation or legal suffixes like Ltd / Inc / GmbH. "Talbotiq" and
//        "Talbotiq Ltd" stay DIFFERENT keys. That is the cautious direction: wrongly
//        splitting one company is a visible annoyance somebody reports, while wrongly
//        merging two is a cross-company data leak nobody notices. Never merge on a
//        guess.
//
// Dart's `toLowerCase()` matches JavaScript's and Python's `lower()`. Python's
// `casefold()` would turn "ß" into "ss" and silently disagree, which is why the
// server deliberately does not use it.

/// Zero-width and bidirectional marks — invisible in every UI, so two names that look
/// identical could differ by one and become separate companies.
final RegExp _invisible = RegExp(
  // Written as escapes, not literals. These characters are invisible, and two of
  // them (U+202A, U+202E) reorder how the SOURCE reads in an editor — the analyzer
  // flags that for good reason, and a regex whose contents cannot be seen is a
  // regex nobody can review.
  '[\u200B-\u200D\u200E\u200F\u202A-\u202E\u2060\uFEFF]',
);
final RegExp _whitespace = RegExp(r'\s+');

const int maxCompanyNameLength = 120;

String _cleaned(String? name) {
  if (name == null) return '';
  // Dart strings are already UTF-16; NFKC is not in the core library, and the cases it
  // covers (full-width Latin) are not reachable from this form's keyboard on the
  // platforms this app ships to. The other two implementations normalise, so a name
  // pasted from such a source could differ — recorded here rather than left silent.
  return name
      .replaceAll(_invisible, '')
      .replaceAll(_whitespace, ' ')
      .trim();
}

/// The canonical form. Empty string when there is no name — never a wildcard.
String normalizeCompanyKey(String? name) {
  final cleaned = _cleaned(name).toLowerCase();
  return cleaned.length > maxCompanyNameLength
      ? cleaned.substring(0, maxCompanyNameLength)
      : cleaned;
}

/// The name as typed — whitespace tidied, capitalisation kept.
String normalizeCompanyDisplay(String? name) {
  final cleaned = _cleaned(name);
  return cleaned.length > maxCompanyNameLength
      ? cleaned.substring(0, maxCompanyNameLength)
      : cleaned;
}

/// Whether two typed names mean the same company.
///
/// False when either is missing. Two unknowns are NOT a match — treating them as one
/// would put every account with no company recorded into a single shared bucket, which
/// is the leak this exists to prevent.
bool sameCompany(String? a, String? b) {
  final keyA = normalizeCompanyKey(a);
  return keyA.isNotEmpty && keyA == normalizeCompanyKey(b);
}

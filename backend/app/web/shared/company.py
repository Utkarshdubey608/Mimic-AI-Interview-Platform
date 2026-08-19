"""Company identity — one spelling, however it was typed.

Recruiters from the same company must see the same templates, question sets and
configuration; recruiters from different companies must not. That only works if
"Talbotiq", "talbotiq", "taLbotiq" and " Talbotiq  " are recognised as ONE
company, so every comparison goes through `company_key` and never through the
name a person typed.

TWO VALUES ARE STORED, and both are needed:

  companyName  what the person typed, preserved for display. "TalbotIQ" should
               appear as "TalbotIQ" in the UI, not flattened to "talbotiq".
  companyKey   the normalised form, and the ONLY thing ever compared or queried.

── What normalising does, and deliberately does not do ──────────────────────
DOES: Unicode NFKC (so a full-width Ｔ and an ASCII T are the same letter),
strips zero-width characters (an invisible joiner would otherwise create a
second, indistinguishable company), collapses runs of whitespace, trims, and
lowercases.

DOES NOT: strip punctuation, or legal suffixes like Ltd / Inc / GmbH.
"Talbotiq" and "Talbotiq Ltd" stay DIFFERENT keys. That is the cautious
direction: wrongly splitting one company is a visible annoyance someone reports,
while wrongly merging two is a cross-company data leak nobody notices. Never
merge on a guess.

`lower()` rather than `casefold()`, and that is not an oversight: the frontend
does the same normalisation in `src/lib/companyKey.ts`, and JavaScript's
`toLowerCase()` leaves "ß" alone where Python's `casefold()` turns it into "ss".
The two implementations agreeing matters more than either being linguistically
ideal, so both use the simple lowercase. `companyKey.test.ts` mirrors this
module's tests for exactly that reason.
"""

from __future__ import annotations

import re
import unicodedata

# Zero-width and bidirectional marks. Invisible in every UI, so two names that
# look identical could differ by one of these and become separate companies.
_INVISIBLE = re.compile(r"[​-‏‪-‮⁠﻿]")
_WHITESPACE = re.compile(r"\s+")

MAX_COMPANY_NAME = 120


def company_key(name: str | None) -> str:
    """The canonical form of a company name. Empty string when there is no name.

    Empty rather than None so callers cannot accidentally build a query that
    matches every company: an empty key is a value to reject, and
    `Collection.owned_by` already refuses blank ids for the same reason.
    """
    if not name:
        return ""
    text = unicodedata.normalize("NFKC", str(name))
    text = _INVISIBLE.sub("", text)
    text = _WHITESPACE.sub(" ", text).strip()
    return text.lower()[:MAX_COMPANY_NAME]


def company_display(name: str | None) -> str:
    """The name as typed, tidied but not flattened — whitespace only, case kept."""
    if not name:
        return ""
    text = unicodedata.normalize("NFKC", str(name))
    text = _INVISIBLE.sub("", text)
    return _WHITESPACE.sub(" ", text).strip()[:MAX_COMPANY_NAME]


def same_company(a: str | None, b: str | None) -> bool:
    """Whether two typed names mean the same company.

    False when either is missing. Two unknowns are not a match — treating them as
    one would put every company with no name recorded into a single shared bucket,
    which is precisely the leak this module exists to prevent.
    """
    key_a, key_b = company_key(a), company_key(b)
    return bool(key_a) and key_a == key_b

"""Classifying a candidate's raw spreadsheet role into a standard category.

**The one place this decision is made.** A spreadsheet's role column, a role pipeline's
`roleCategory`, and a candidate's classified role on their interview document all read
from `classify_role` below — nothing re-implements the keyword matching anywhere else,
on any client. See `app.web.services.invite_extract` (the only caller today) and
`app.role_configs` (which stores the categories this module can return).

Deliberately NOT a fixed, exhaustive enum — `CATEGORIES` is an ordered list any future
role can be appended to without touching the matching logic itself. Precedence matters
more than exhaustiveness here: "technology consultant" must resolve to Consulting, not
Tech, so Consulting's keywords are checked first. Never guesses from an email address —
only the raw role string is ever inspected.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

CONFIDENCE_MATCHED = "matched"
CONFIDENCE_UNCLASSIFIED = "unclassified"

OTHER_SLUG = "other"


@dataclass(frozen=True)
class RoleCategory:
    """One entry in the classification table.

    `keywords` are matched as whole words/phrases, case-insensitive, against the raw
    role string. `precedence` is checked low-to-high — the FIRST category (in that
    order) with a matching keyword wins, which is what lets a more specific category
    (Consulting) beat a more general one (Tech) for an overlapping phrase.
    """

    slug: str
    display_name: str
    keywords: tuple[str, ...] = field(default_factory=tuple)
    precedence: int = 100


# Ordered by precedence ascending. Append new categories here — nothing else needs to
# change for a new one to be recognised.
CATEGORIES: tuple[RoleCategory, ...] = (
    RoleCategory(
        slug="consulting",
        display_name="Consulting",
        precedence=10,
        keywords=(
            "consultant",
            "consulting",
            "management consultant",
            "strategy consultant",
            "business consultant",
            "technology consultant",
        ),
    ),
    RoleCategory(
        slug="sde",
        display_name="SDE / Software Engineering",
        precedence=20,
        keywords=(
            "software engineer",
            "software developer",
            "software development engineer",
            "sde",
            "developer",
            "backend engineer",
            "frontend engineer",
            "front end engineer",
            "back end engineer",
            "full stack",
            "fullstack",
            "mobile developer",
            "application engineer",
            "programmer",
        ),
    ),
    RoleCategory(
        slug="data",
        display_name="Data",
        precedence=30,
        keywords=(
            "data scientist",
            "data analyst",
            "data engineer",
            "data engineering",
            "machine learning",
            "ml engineer",
            "analytics",
        ),
    ),
    RoleCategory(
        slug="product",
        display_name="Product",
        precedence=40,
        keywords=(
            "product manager",
            "product management",
            "product owner",
            "product analyst",
        ),
    ),
    RoleCategory(
        slug="tech",
        display_name="Tech",
        precedence=50,
        keywords=(
            "technical",
            "technology",
            "it",
            "system",
            "systems",
            "cloud",
            "devops",
            "infrastructure",
            "cybersecurity",
            "security engineer",
            "network engineer",
            "qa engineer",
            "quality assurance",
            "test engineer",
        ),
    ),
    RoleCategory(
        slug="non_tech",
        display_name="Non-Tech",
        precedence=60,
        keywords=(
            "hr",
            "human resources",
            "sales",
            "marketing",
            "finance",
            "accounting",
            "operations",
            "recruitment",
            "recruiter",
            "administration",
            "admin",
            "business development",
            "customer support",
            "customer success",
            "legal",
        ),
    ),
)

_BY_SLUG = {c.slug: c for c in CATEGORIES}
_ORDERED = tuple(sorted(CATEGORIES, key=lambda c: c.precedence))


def _keyword_pattern(keyword: str) -> re.Pattern[str]:
    # Whole word/phrase match: spaces in a multi-word keyword become literal spaces,
    # bounded by word edges so "hr" does not match inside "chris" or "other".
    escaped = re.escape(keyword.strip())
    return re.compile(rf"(?<!\w){escaped}(?!\w)", re.IGNORECASE)


_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    category.slug: tuple(_keyword_pattern(k) for k in category.keywords)
    for category in CATEGORIES
}


@dataclass(frozen=True)
class RoleClassification:
    raw: str
    category: str
    confidence: str


def classify_role(raw: object) -> RoleClassification:
    """The best-effort category for one spreadsheet role string. Never raises.

    Checked in precedence order; the first category with any matching keyword wins.
    An empty, blank, or unmatched role classifies as "other"/unclassified rather than
    guessing — the caller (and the recruiter reviewing the import) can tell the
    difference between "we looked and found nothing" and a real match.
    """
    text = str(raw or "").strip()
    if not text:
        return RoleClassification(raw="", category=OTHER_SLUG, confidence=CONFIDENCE_UNCLASSIFIED)

    for category in _ORDERED:
        if any(pattern.search(text) for pattern in _PATTERNS[category.slug]):
            return RoleClassification(raw=text, category=category.slug, confidence=CONFIDENCE_MATCHED)

    return RoleClassification(raw=text, category=OTHER_SLUG, confidence=CONFIDENCE_UNCLASSIFIED)


def category_display_name(slug: str | None) -> str:
    """A category's label, or a safe fallback for an unknown/absent slug."""
    if not slug:
        return "Role not specified"
    found = _BY_SLUG.get(slug)
    if found:
        return found.display_name
    return "Other" if slug == OTHER_SLUG else slug


def known_categories() -> list[dict]:
    """`[{slug, displayName}]`, in precedence order, for populating a picker.

    "Other" is appended last and explicitly, even though it is not a row in
    `CATEGORIES` — it is always a valid, selectable outcome.
    """
    ordered = [{"slug": c.slug, "displayName": c.display_name} for c in _ORDERED]
    ordered.append({"slug": OTHER_SLUG, "displayName": "Other"})
    return ordered


def is_known_category(slug: object) -> bool:
    return isinstance(slug, str) and (slug == OTHER_SLUG or slug in _BY_SLUG)

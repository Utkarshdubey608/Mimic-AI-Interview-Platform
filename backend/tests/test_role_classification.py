"""`app.role_classification.classify_role` — precedence, fallback, and the acceptance
criteria's own worked examples (AC1).
"""

from __future__ import annotations

import pytest

from app.role_classification import (
    CONFIDENCE_MATCHED,
    CONFIDENCE_UNCLASSIFIED,
    OTHER_SLUG,
    category_display_name,
    classify_role,
    is_known_category,
    known_categories,
)


@pytest.mark.parametrize(
    "raw, expected_category",
    [
        ("Software Development Engineer", "sde"),
        ("Software Engineer", "sde"),
        ("Developer", "sde"),
        ("Senior Software Development Engineer", "sde"),
        ("Backend Engineer", "sde"),
        ("Full Stack Developer", "sde"),
        ("Management Consultant", "consulting"),
        ("Strategy Consultant", "consulting"),
        ("HR Executive", "non_tech"),
        ("Sales Manager", "non_tech"),
        ("Data Scientist", "data"),
        ("Product Manager", "product"),
        ("DevOps Engineer", "tech"),
    ],
)
def test_classifies_common_roles(raw: str, expected_category: str) -> None:
    result = classify_role(raw)
    assert result.category == expected_category
    assert result.confidence == CONFIDENCE_MATCHED
    assert result.raw == raw


def test_precedence_prefers_consulting_over_generic_tech() -> None:
    """The spec's own example: a "technology consultant" must not fall into Tech just
    because "technology" is also a Tech keyword — Consulting is checked first."""
    result = classify_role("Technology Consultant")
    assert result.category == "consulting"


@pytest.mark.parametrize("raw", ["", "   ", None])
def test_blank_or_missing_role_is_unclassified(raw) -> None:
    result = classify_role(raw)
    assert result.category == OTHER_SLUG
    assert result.confidence == CONFIDENCE_UNCLASSIFIED


def test_unrecognised_role_is_other_not_a_guess() -> None:
    result = classify_role("Zamboni Driver")
    assert result.category == OTHER_SLUG
    assert result.confidence == CONFIDENCE_UNCLASSIFIED


def test_does_not_match_a_keyword_as_a_mere_substring() -> None:
    """"Custodian" contains no recognised keyword as a whole word — a naive substring
    match would still be fine here, but this guards the word-boundary matching."""
    result = classify_role("Custodian")
    assert result.category == OTHER_SLUG


def test_category_display_name_falls_back_safely() -> None:
    assert category_display_name(None) == "Role not specified"
    assert category_display_name("") == "Role not specified"
    assert category_display_name("sde") == "SDE / Software Engineering"
    assert category_display_name("other") == "Other"
    assert category_display_name("totally-unknown-slug") == "totally-unknown-slug"


def test_known_categories_always_includes_other() -> None:
    slugs = [c["slug"] for c in known_categories()]
    assert "other" in slugs
    assert slugs[-1] == "other"
    assert len(slugs) == len(set(slugs)), "no duplicate category slugs"


def test_is_known_category() -> None:
    assert is_known_category("sde")
    assert is_known_category("other")
    assert not is_known_category("not-a-real-category")
    assert not is_known_category(None)

"""Essay mode's arithmetic: counting, limits, and band presentation.

Three things here decide whether a candidate is treated fairly.

COUNTING must match what the editor showed them. A candidate who watched the
counter read 249 and was rejected for "under 250" has been failed by a
disagreement between two implementations, not by their writing.

LIMITS are a policy, not a truth. Enforcing must be distinguishable from warning,
because a hard stop at a word count is a decision a recruiter makes deliberately.

BANDS are presentation only. Scores are stored 0-100 like every other track's
`kpiScores`, because the analytics aggregation and the frozen Dart reader both
depend on that scale. An IELTS band is computed for DISPLAY and never persisted
as the score.
"""

from __future__ import annotations

import pytest

from app.web.services.essay import (
    band_for,
    count_chars,
    count_words,
    essay_faults,
    limit_state,
)


# ── counting ──────────────────────────────────────────────────────────────────


def test_words_are_whitespace_separated_runs() -> None:
    assert count_words("the quick brown fox") == 4


def test_repeated_whitespace_is_one_separator() -> None:
    assert count_words("the   quick\n\nbrown\tfox  ") == 4


def test_empty_and_blank_text_count_zero() -> None:
    assert count_words("") == 0
    assert count_words("   \n\t ") == 0


def test_a_hyphenated_word_is_one_word() -> None:
    """This is the commonest disagreement between two counters, and it decides
    whether someone is over a limit."""
    assert count_words("a well-argued point") == 3


def test_punctuation_does_not_create_words() -> None:
    assert count_words("Yes, indeed -- truly.") == 3


def test_non_latin_text_counts_by_the_same_rule() -> None:
    """Essays may be written in the configured language, not only English."""
    assert count_words("यह एक वाक्य है") == 4


def test_characters_count_what_the_candidate_typed() -> None:
    assert count_chars("abc def") == 7


def test_characters_include_whitespace_but_normalise_line_endings() -> None:
    """CRLF is one character to a person looking at the editor. Counting two
    makes a Windows candidate hit a character limit sooner than a Mac one."""
    assert count_chars("a\r\nb") == count_chars("a\nb") == 3


# ── limits ────────────────────────────────────────────────────────────────────


def test_text_inside_the_range_is_ok() -> None:
    assert limit_state(count=300, minimum=250, maximum=500).state == "ok"


def test_below_the_minimum_is_reported_with_the_shortfall() -> None:
    result = limit_state(count=200, minimum=250, maximum=500)
    assert result.state == "under"
    assert result.delta == 50


def test_above_the_maximum_is_reported_with_the_excess() -> None:
    result = limit_state(count=560, minimum=250, maximum=500)
    assert result.state == "over"
    assert result.delta == 60


def test_absent_limits_are_always_ok() -> None:
    assert limit_state(count=1, minimum=None, maximum=None).state == "ok"


def test_a_boundary_value_is_inside_the_range() -> None:
    assert limit_state(count=250, minimum=250, maximum=500).state == "ok"
    assert limit_state(count=500, minimum=250, maximum=500).state == "ok"


# ── bands are display only ────────────────────────────────────────────────────


def test_a_perfect_score_is_the_top_band() -> None:
    assert band_for(100, scale="ielts") == 9.0


def test_zero_is_the_bottom_band() -> None:
    assert band_for(0, scale="ielts") == 0.0


def test_bands_land_on_half_points_as_ielts_reports_them() -> None:
    assert band_for(50, scale="ielts") == 4.5
    assert band_for(72, scale="ielts") in (6.5, 7.0)


def test_every_score_maps_to_a_legal_ielts_band() -> None:
    legal = {n / 2 for n in range(0, 19)}
    assert {band_for(s, scale="ielts") for s in range(0, 101)} <= legal


def test_an_unknown_scale_returns_none_rather_than_inventing_one() -> None:
    assert band_for(70, scale="not-a-scale") is None


def test_a_score_outside_the_stored_range_is_clamped() -> None:
    assert band_for(140, scale="ielts") == 9.0
    assert band_for(-5, scale="ielts") == 0.0


# ── readiness ─────────────────────────────────────────────────────────────────


def _prompt(**over):
    body = {
        "title": "Automation and employment",
        "promptMd": "Discuss the effect of automation on employment.",
        "minWords": 250,
        "maxWords": 500,
        "timeLimitSeconds": 2400,
    }
    body.update(over)
    return body


def test_a_complete_prompt_has_no_faults() -> None:
    assert essay_faults(_prompt()) == []


def test_a_prompt_with_no_question_is_not_ready() -> None:
    assert any("prompt" in f for f in essay_faults(_prompt(promptMd="")))


def test_a_prompt_with_no_title_is_not_ready() -> None:
    assert any("title" in f for f in essay_faults(_prompt(title="")))


def test_a_minimum_above_the_maximum_is_impossible_to_satisfy() -> None:
    """Nobody can write more than 500 and fewer than 600 words. Left unflagged
    every candidate fails the limit check no matter what they write."""
    faults = essay_faults(_prompt(minWords=600, maxWords=500))
    assert any("minimum" in f.lower() for f in faults)


def test_a_zero_time_limit_is_not_ready() -> None:
    assert any("time" in f.lower() for f in essay_faults(_prompt(timeLimitSeconds=0)))

"""A coding problem contains its own answer. This is the test that it stays there.

A problem holds every hidden test case and its expected output, which is the same
category of secret as an MCQ paper's `correctOptionIds`: a candidate who could read
the stored problem would not need to solve it.

The MCQ track pins that property with a test asserting an ABSENCE ON SERIALISED
BYTES rather than on the projected dict — `assert field not in payload` — because
bytes are what actually reach a candidate, and a dict comparison can be satisfied
by a structure that serialises to something else. This file does the same, and
goes one step further where it can: it asserts that the hidden inputs and outputs
themselves, as strings, do not appear anywhere in the payload. A leak does not have
to arrive under the field name it was stored as.
"""

from __future__ import annotations

import json

import pytest

from app.web.services.coding_problems import (
    InvalidProblem,
    PUBLIC_PROBLEM_FIELDS,
    clean_problem,
    problem_faults,
    public_problem,
)

NOW = "2026-08-24T12:00:00+00:00"

# Distinctive strings, so "is this substring in the payload" is a meaningful
# question. Real test data ("5", "12") would appear by coincidence.
HIDDEN_IN = "HIDDEN-INPUT-ce2f1a"
HIDDEN_OUT = "HIDDEN-OUTPUT-9b4d7e"
SAMPLE_IN = "SAMPLE-INPUT-11aa22"
SAMPLE_OUT = "SAMPLE-OUTPUT-33bb44"


def _problem(**overrides) -> dict:
    body = {
        "title": "Two Sum",
        "statementMd": "Given an array, return indices of the two numbers adding to target.",
        "constraints": "2 <= n <= 1e5",
        "ioFormat": "One line of integers.",
        "examples": [{"input": "1 2 3", "output": "0 1", "explanation": "1+2=3"}],
        "starterCode": {"python": "def solve():\n    pass"},
        "testCases": [
            {"id": "s1", "input": SAMPLE_IN, "expectedOutput": SAMPLE_OUT, "hidden": False, "points": 2},
            {"id": "h1", "input": HIDDEN_IN, "expectedOutput": HIDDEN_OUT, "hidden": True, "points": 5},
            {"id": "h2", "input": HIDDEN_IN + "-2", "expectedOutput": HIDDEN_OUT + "-2", "hidden": True, "points": 3},
        ],
        "timeLimitMs": 2000,
        "memoryMb": 128,
        "difficulty": "medium",
        "tags": ["arrays"],
        "allowedLanguages": ["python", "java"],
        **overrides,
    }
    return clean_problem(body, recruiter_id="uid-recruiter", problem_id="p1", now=NOW)


# ── the security boundary ─────────────────────────────────────────────────────


def test_no_hidden_case_reaches_the_candidate_payload() -> None:
    """THE test. Asserted on bytes, and on the values rather than the field names."""
    payload = json.dumps(public_problem(_problem()))

    assert HIDDEN_IN not in payload, "a hidden test case's input reached the candidate"
    assert HIDDEN_OUT not in payload, "a hidden test case's expected output reached the candidate"
    # The stored field name must not appear either — a nested case object carrying
    # `expectedOutput` for a hidden case would be a leak even if the value differed.
    assert "recruiterId" not in payload
    assert "uid-recruiter" not in payload


def test_the_sample_case_IS_published_including_its_expected_output() -> None:
    """The one judgement call, asserted so it is a decision and not an accident.

    A sample whose expected output is withheld teaches a candidate nothing when it
    fails, which is the entire purpose of a sample.
    """
    payload = json.dumps(public_problem(_problem()))
    assert SAMPLE_IN in payload
    assert SAMPLE_OUT in payload


def test_the_hidden_count_is_published_but_nothing_else_about_them() -> None:
    public = public_problem(_problem())
    assert public["hiddenTestCount"] == 2
    assert [c["id"] for c in public["sampleTests"]] == ["s1"]


def test_total_points_counts_hidden_cases() -> None:
    """Fair information: how much is riding on cases you cannot see, without
    saying anything about what they contain."""
    assert public_problem(_problem())["totalPoints"] == 10


def test_the_projection_is_an_allow_list_not_a_strip() -> None:
    """A field added to the stored problem later must be invisible by default.

    This is the property that makes the whole file trustworthy, so it is tested
    directly: a stored problem carrying an unexpected secret projects without it,
    with no edit to the projection.
    """
    stored = _problem()
    stored["referenceSolution"] = "REFERENCE-SOLUTION-d41d8c"
    stored["editorialUrl"] = "https://internal/editorial"

    public = public_problem(stored)
    payload = json.dumps(public)

    assert "REFERENCE-SOLUTION-d41d8c" not in payload
    assert "editorialUrl" not in payload
    assert set(public) == set(PUBLIC_PROBLEM_FIELDS)


def test_the_public_field_list_is_the_contract() -> None:
    """Pinned, so widening what a candidate sees is a deliberate edit to a named
    tuple with a test failure attached — not a quiet addition to a dict literal."""
    assert set(public_problem(_problem())) == set(PUBLIC_PROBLEM_FIELDS)


# ── storing a problem ─────────────────────────────────────────────────────────


def test_a_case_with_no_stated_visibility_is_hidden() -> None:
    """The safe default. A recruiter who says nothing gets a hidden case, because
    the failure mode of the other default is publishing an answer."""
    stored = _problem(testCases=[{"id": "x", "input": "a", "expectedOutput": "b"}])
    assert stored["testCases"][0]["hidden"] is True


def test_limits_are_clamped_into_range() -> None:
    """These values are handed to a judge that will honour them, so an unbounded
    time limit is a way to occupy a worker forever."""
    stored = _problem(timeLimitMs=999_999, memoryMb=99_999)
    assert stored["timeLimitMs"] == 15_000
    assert stored["memoryMb"] == 512

    floored = _problem(timeLimitMs=1, memoryMb=1)
    assert floored["timeLimitMs"] == 250
    assert floored["memoryMb"] == 16


def test_a_nonsense_limit_falls_back_rather_than_raising() -> None:
    stored = _problem(timeLimitMs="soon")
    assert stored["timeLimitMs"] == 2_000


def test_storing_is_an_allow_list_too() -> None:
    stored = _problem(secretBackdoor="nope")
    assert "secretBackdoor" not in stored


def test_too_many_cases_is_refused() -> None:
    with pytest.raises(InvalidProblem):
        _problem(testCases=[{"id": f"c{i}", "input": "", "expectedOutput": ""} for i in range(61)])


def test_a_case_that_is_not_an_object_is_refused() -> None:
    with pytest.raises(InvalidProblem):
        _problem(testCases=["not a case"])


# ── readiness, as opposed to validity ─────────────────────────────────────────


def test_a_complete_problem_has_no_faults() -> None:
    assert problem_faults(_problem()) == []


def test_a_problem_with_no_visible_sample_is_not_ready() -> None:
    """With no sample, Run has nothing to run against, so a candidate's only
    feedback is a graded submission."""
    only_hidden = _problem(
        testCases=[{"id": "h", "input": "a", "expectedOutput": "b", "hidden": True, "points": 1}]
    )
    assert any("sample" in f for f in problem_faults(only_hidden))


def test_a_problem_worth_nothing_is_not_ready() -> None:
    zero = _problem(
        testCases=[{"id": "s", "input": "a", "expectedOutput": "b", "hidden": False, "points": 0}]
    )
    assert any("points" in f for f in problem_faults(zero))


def test_missing_pieces_are_reported_rather_than_refused() -> None:
    """Saving is permissive, using is strict — the same line mcq_authoring draws."""
    draft = _problem(title="", allowedLanguages=[])
    faults = problem_faults(draft)
    assert len(faults) >= 2


# ── an expectation is what makes a case gradeable ─────────────────────────────


def test_a_case_with_no_expected_output_is_not_ready() -> None:
    """The fault this file exists to prevent reaching a candidate.

    Judge0 compares stdout against `expected_output`, and `run_cases` sends `""`
    rather than None for a blank one — so an empty expectation does not mean "do
    not compare", it means "expect nothing", which no program that prints an
    answer can ever satisfy. Left unflagged, such a problem is fully valid, is
    selectable in the invite wizard, and scores every correct submission zero.
    """
    blank = _problem(
        testCases=[
            {"id": "s", "input": "2 7", "expectedOutput": "", "hidden": False, "points": 1},
        ]
    )
    assert any("expected output" in f for f in problem_faults(blank))


def test_a_case_whose_expected_output_is_only_whitespace_is_not_ready() -> None:
    blank = _problem(
        testCases=[
            {"id": "s", "input": "2 7", "expectedOutput": "   \n ", "hidden": False, "points": 1},
        ]
    )
    assert any("expected output" in f for f in problem_faults(blank))


def test_the_faulting_case_is_named_so_a_recruiter_can_find_it() -> None:
    blank = _problem(
        testCases=[
            {"id": "tc1", "input": "a", "expectedOutput": "b", "hidden": False, "points": 1},
            {"id": "tc2", "input": "c", "expectedOutput": "", "hidden": True, "points": 1},
        ]
    )
    faults = " ".join(problem_faults(blank))
    assert "tc2" in faults and "tc1" not in faults


# ── a dropped key must not be silent ──────────────────────────────────────────


def test_unknown_keys_are_reported_so_an_import_typo_is_not_silent() -> None:
    """`expected` instead of `expectedOutput` imported clean and graded everyone
    zero. The allow-list is right; its silence was not."""
    from app.web.services.coding_problems import ignored_keys

    reported = ignored_keys(
        {
            "title": "Two Sum",
            "statementMd": "x",
            "difficultly": "easy",
            "testCases": [{"input": "a", "expected": "b", "hidden": False, "points": 1}],
        }
    )
    # A typo nothing can be made of is still reported...
    assert "difficultly" in reported
    # ...but `expected` is now understood, so it is a RENAME, not a loss. Reporting
    # it as ignored would be a lie about data that was in fact stored.
    assert not any("expected" in r for r in reported)


def test_a_correct_bundle_reports_nothing_ignored() -> None:
    from app.web.services.coding_problems import ignored_keys

    assert ignored_keys(
        {
            "title": "Two Sum",
            "statementMd": "x",
            "difficulty": "easy",
            "allowedLanguages": ["python"],
            "testCases": [{"input": "a", "expectedOutput": "b", "hidden": False, "points": 1}],
        }
    ) == []


# ── a bundle a human or an LLM actually writes ────────────────────────────────


def test_the_common_synonym_for_expected_output_is_accepted() -> None:
    """`expected` is what everyone writes. Rejecting it silently cost a candidate
    a correct submission; rejecting it loudly still costs them the import."""
    stored = _problem(
        testCases=[{"id": "s", "input": "2 7", "expected": "0 1", "hidden": False, "points": 1}]
    )
    assert stored["testCases"][0]["expectedOutput"] == "0 1"
    assert problem_faults(stored) == []


def test_snake_case_is_accepted_everywhere() -> None:
    from app.web.services.coding_problems import clean_problem as cp
    stored = cp(
        {
            "title": "Two Sum",
            "statement_md": "x",
            "allowed_languages": ["python"],
            "time_limit_ms": 3000,
            "test_cases": [
                {"input": "a", "expected_output": "b", "hidden": False, "points": 1}
            ],
        },
        recruiter_id="r",
        problem_id="p",
        now=NOW,
    )
    assert stored["statementMd"] == "x"
    assert stored["allowedLanguages"] == ["python"]
    assert stored["timeLimitMs"] == 3000
    assert stored["testCases"][0]["expectedOutput"] == "b"


def test_other_plausible_synonyms_are_accepted() -> None:
    from app.web.services.coding_problems import clean_problem as cp
    stored = cp(
        {
            "title": "Two Sum",
            "statement": "x",
            "languages": ["python"],
            "tests": [{"stdin": "a", "output": "b", "hidden": False, "points": 1}],
        },
        recruiter_id="r",
        problem_id="p",
        now=NOW,
    )
    assert stored["statementMd"] == "x"
    assert stored["allowedLanguages"] == ["python"]
    assert stored["testCases"][0]["input"] == "a"
    assert stored["testCases"][0]["expectedOutput"] == "b"
    assert problem_faults(stored) == []


def test_a_renamed_key_is_still_reported_so_the_author_learns_the_canonical_name() -> None:
    from app.web.services.coding_problems import renamed_keys
    assert any(
        "expected" in r and "expectedOutput" in r
        for r in renamed_keys({"testCases": [{"expected": "b"}]})
    )


def test_a_genuinely_unknown_key_is_still_reported_as_ignored() -> None:
    from app.web.services.coding_problems import ignored_keys
    assert "difficultly" in ignored_keys({"difficultly": "easy"})


def test_a_synonym_is_not_reported_as_ignored() -> None:
    from app.web.services.coding_problems import ignored_keys
    assert ignored_keys({"statement": "x", "testCases": [{"expected": "b"}]}) == []


def test_case_level_renames_are_found_however_the_cases_list_was_spelled() -> None:
    """The reporting must not depend on the container key being canonical: a bundle
    with `test_cases` still has cases whose own keys were renamed."""
    from app.web.services.coding_problems import renamed_keys
    reported = renamed_keys(
        {"title": "x", "test_cases": [{"input": "a", "expected_output": "b"}]}
    )
    assert any("expectedOutput" in r for r in reported)


def test_unknown_case_keys_are_found_however_the_cases_list_was_spelled() -> None:
    from app.web.services.coding_problems import ignored_keys
    assert any(
        "nonsense" in k
        for k in ignored_keys({"title": "x", "tests": [{"input": "a", "nonsense": "b"}]})
    )

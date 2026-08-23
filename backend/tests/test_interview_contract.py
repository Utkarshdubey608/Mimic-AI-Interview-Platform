"""The interview-document golden contract, Python side.

`interviews/{id}` is the one record both clients read and write. This suite pins the
document `app.interviews` produces, and the projection a candidate is allowed to see,
against `contracts/interview_document.fixtures.json` — the same file
`mobile_desktop_app_version/test/interview_contract_test.dart` asserts against.

Two different failures this is meant to catch:

* **A rename.** Field names here are read by `interview.dart` and cannot change. A
  rename fails here AND in the Dart suite, instead of failing in production as an
  interview that will not load.
* **A disclosure.** `candidate_result_view` is an allowlist, and the fixtures record
  exactly what it returns. A new field reaching a candidate shows up as a fixture diff,
  which is a reviewable line in a pull request rather than something nobody notices.

Regenerate with:

    REGENERATE_INTERVIEW_FIXTURES=1 .venv/bin/python -m pytest tests/test_interview_contract.py

and update the Dart side in the same commit.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app import interviews
from tests.interview_document_cases import (
    ASSIGNMENT_CASES,
    DISCLOSURE_CASES,
    TEST_SUMMARY_CASES,
)

FIXTURES = (
    Path(__file__).resolve().parent.parent.parent
    / "contracts"
    / "interview_document.fixtures.json"
)

README = (
    "Golden contract for the shared `interviews/{id}` document and the candidate "
    "disclosure allowlist. Generated from backend/app/interviews.py; asserted by BOTH "
    "backend/tests/test_interview_contract.py and "
    "mobile_desktop_app_version/test/interview_contract_test.dart. The field names are "
    "frozen — interview.dart reads them. Regenerate with "
    "REGENERATE_INTERVIEW_FIXTURES=1 and update both sides in the same commit."
)


def _build() -> dict:
    """Everything the contract covers, computed fresh from the current code."""
    return {
        "_readme": README,
        "assignments": {
            case["name"]: interviews.build_assignment(**case["kwargs"])
            for case in ASSIGNMENT_CASES
        },
        "testSummaries": {
            case["name"]: interviews.build_test_summary(**case["kwargs"])
            for case in TEST_SUMMARY_CASES
        },
        "candidateDisclosure": {
            case["name"]: interviews.candidate_result_view(case["document"])
            for case in DISCLOSURE_CASES
        },
        # Recorded so the Dart and TypeScript sides can assert they know the same
        # tracks. A mode present in one client and not another is how an invite becomes
        # unrunnable on the platform that does not recognise it.
        "modes": {
            mode: {"label": label, "type": interviews.type_for_mode(mode)}
            for mode, label in sorted(interviews.MODE_LABELS.items())
        },
        "candidateVisibleResultFields": list(interviews.CANDIDATE_VISIBLE_RESULT_FIELDS),
    }


def _regenerate_if_asked(current: dict) -> None:
    if os.environ.get("REGENERATE_INTERVIEW_FIXTURES") != "1":
        return
    FIXTURES.parent.mkdir(parents=True, exist_ok=True)
    FIXTURES.write_text(
        json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


@pytest.fixture(scope="module")
def golden() -> dict:
    current = _build()
    _regenerate_if_asked(current)
    assert FIXTURES.exists(), (
        f"{FIXTURES} is missing. Generate it with "
        "REGENERATE_INTERVIEW_FIXTURES=1 pytest tests/test_interview_contract.py"
    )
    return json.loads(FIXTURES.read_text(encoding="utf-8"))


# ── the frozen document ───────────────────────────────────────────────────────


@pytest.mark.parametrize("case", ASSIGNMENT_CASES, ids=lambda c: c["name"])
def test_the_assignment_document_matches_the_contract(case: dict, golden: dict) -> None:
    expected = golden["assignments"].get(case["name"])
    assert expected is not None, f"no fixture for {case['name']} — regenerate"
    assert interviews.build_assignment(**case["kwargs"]) == expected, case["why"]


@pytest.mark.parametrize("case", TEST_SUMMARY_CASES, ids=lambda c: c["name"])
def test_the_test_summary_matches_the_contract(case: dict, golden: dict) -> None:
    expected = golden["testSummaries"].get(case["name"])
    assert expected is not None, f"no fixture for {case['name']} — regenerate"
    assert interviews.build_test_summary(**case["kwargs"]) == expected, case["why"]


def test_type_is_always_derived_from_mode() -> None:
    """The invariant `build_assignment` exists to make unbreakable.

    Not parametrised off the fixtures on purpose: this asserts the RELATIONSHIP holds
    for every mode the product knows, so adding a mode without deciding its bucket
    fails here rather than shipping a document one client cannot run.
    """
    for mode in interviews.MODE_LABELS:
        document = interviews.build_assignment(
            test_id="t",
            recruiter_id="r",
            recruiter_email="r@t.test",
            recruiter_name=None,
            candidate_email="c@t.test",
            title="T",
            mode=mode,
        )
        assert document["mode"] == mode
        assert document["type"] == interviews.type_for_mode(mode)
        assert document["type"] in ("video", "chat"), (
            f"{mode} maps to {document['type']!r}, which interview.dart cannot parse"
        )


def test_the_lowercased_email_is_derived_not_supplied() -> None:
    """Assignment is matched on it, so it cannot be allowed to disagree."""
    document = interviews.build_assignment(
        test_id="t",
        recruiter_id="r",
        recruiter_email="r@t.test",
        recruiter_name=None,
        candidate_email="  Ada@Example.TEST  ",
        title="T",
        mode="chat",
    )
    assert document["candidateEmailLower"] == "ada@example.test"


# ── the candidate disclosure allowlist ────────────────────────────────────────


@pytest.mark.parametrize("case", DISCLOSURE_CASES, ids=lambda c: c["name"])
def test_the_candidate_projection_matches_the_contract(case: dict, golden: dict) -> None:
    expected = golden["candidateDisclosure"].get(case["name"], "MISSING")
    assert expected != "MISSING", f"no fixture for {case['name']} — regenerate"
    assert interviews.candidate_result_view(case["document"]) == expected, case["why"]


def test_no_recruiter_field_can_reach_a_candidate() -> None:
    """The property, asserted independently of the fixtures.

    A fixture diff catches a change somebody made. This catches one they did not: it
    holds for every case in the file at once, so a new case that leaks fails here even
    if its own fixture was regenerated without anybody reading the diff.
    """
    forbidden = {
        "overallScore",
        "recommendation",
        "summary",
        "strengths",
        "improvements",
        "evaluatedBy",
        "evaluationError",
        "responses",
        "detail",
        "twoWayReview",
        "resume",
    }
    for case in DISCLOSURE_CASES:
        view = interviews.candidate_result_view(case["document"])
        if view is None:
            continue
        leaked = forbidden & set(view)
        assert not leaked, f"{case['name']} discloses {sorted(leaked)} to the candidate"
        unexpected = set(view) - set(interviews.CANDIDATE_VISIBLE_RESULT_FIELDS)
        assert not unexpected, (
            f"{case['name']} returns {sorted(unexpected)}, which is not on the "
            "allowlist. Add it to CANDIDATE_VISIBLE_RESULT_FIELDS deliberately, or "
            "stop returning it."
        )


def test_an_unpublished_result_is_never_visible() -> None:
    """`resultPublished` is the only gate, and it is checked before anything else."""
    for outcome in ("selected", "not_selected", "pending", None):
        document = {"resultPublished": False, "result": {"outcome": outcome, "rank": 1}}
        assert interviews.candidate_result_view(document) is None


def test_the_allowlist_is_exactly_the_documented_three_plus_the_rank_pair() -> None:
    """A tripwire on the constant itself.

    Widening this set is a product and privacy decision, not a refactor. If this test
    is failing, that decision is what needs making — and recording in
    Documents/WEB_MOBILE_CONSISTENCY_PLAN.md, which states the same list.
    """
    assert set(interviews.CANDIDATE_VISIBLE_RESULT_FIELDS) == {
        "outcome",
        "rank",
        "rankOf",
        "candidateNote",
    }

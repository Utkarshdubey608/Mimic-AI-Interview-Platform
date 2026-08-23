"""What a candidate thought of the interview — now askable on both clients.

The prompt used to live only in the browser (`web_feedback`), so a candidate who
interviewed on the phone was never asked. It is the one channel the product has for
hearing from candidates, and it was collecting from roughly half of them — with nothing
in the data to distinguish "not asked" from "declined to answer".
"""

from __future__ import annotations

import pytest

from app import feedback


# ── what a candidate may say ──────────────────────────────────────────────────


@pytest.mark.parametrize("value", [1, 3, 5])
def test_a_rating_in_range_is_kept(value: int) -> None:
    assert feedback.clean_rating(value) == value


@pytest.mark.parametrize("value", [0, 6, -1, 99, "4", None, 3.7])
def test_anything_else_is_none_not_a_default(value) -> None:
    """None rather than a middle value.

    "Did not rate" and "rated 3" are different answers, and averaging an invented 3
    would quietly move a recruiter's numbers toward it.

    `3.7` is here on purpose: it is not a star rating, and truncating it to 3 would
    store a value nobody chose.
    """
    assert feedback.clean_rating(value) is None


def test_a_whole_numbered_float_is_still_a_rating() -> None:
    """JSON has one number type, so a browser sending 4 may arrive as `4.0`.

    Rejecting every float would discard real ratings; accepting `3.7` would invent one.
    Whole-numbered floats are the line.
    """
    assert feedback.clean_rating(4.0) == 4
    assert feedback.clean_rating(1.0) == 1


def test_true_is_not_a_one_star_review() -> None:
    """`bool` is an `int` in Python, so this needs excluding explicitly."""
    assert feedback.clean_rating(True) is None
    assert feedback.clean_rating(False) is None


def test_a_comment_is_bounded() -> None:
    """A verdict, not an essay — it bounds storage and what a dashboard renders."""
    assert len(feedback.clean_comment("x" * 9_000)) == feedback.MAX_COMMENT_CHARS
    assert feedback.clean_comment("  spaced  ") == "spaced"
    assert feedback.clean_comment(None) == ""


def test_nothing_at_all_is_recognised_as_nothing() -> None:
    """A row with no rating and no comment records that somebody pressed submit.

    That counts as feedback on every dashboard that counts rows, while saying nothing —
    worse than its honest absence.
    """
    assert feedback.is_empty(None, "") is True
    assert feedback.is_empty(None, "  ".strip()) is True
    assert feedback.is_empty(4, "") is False
    assert feedback.is_empty(None, "Audio cut out") is False


# ── what the server decides ───────────────────────────────────────────────────


def test_the_record_carries_both_id_names() -> None:
    """`sessionId` because the web surface reads it already; `interviewId` so a reader
    that knows nothing about web sessions has a field named for what it is."""
    record = feedback.build(
        interview_id="i-1",
        recruiter_id="uid-recruiter",
        track="chat",
        role="Backend",
        candidate_name="Ada",
        rating=4,
        comment="Clear questions.",
        had_technical_issues=False,
        submitted_at="2027-06-01T12:00:00+00:00",
    )
    assert record["sessionId"] == "i-1"
    assert record["interviewId"] == "i-1"


def test_the_attribution_is_not_a_field_a_client_supplies() -> None:
    """A feedback row is aggregated on a recruiter's dashboard.

    A client-supplied `recruiterId` would let anyone write into anyone else's numbers,
    which is why `build` takes it as an argument the ROUTE resolves from the interview
    rather than reading it from a body.
    """
    import inspect

    parameters = inspect.signature(feedback.build).parameters
    assert "recruiter_id" in parameters
    # Keyword-only, so a caller cannot pass it positionally by accident from a body dict.
    assert all(p.kind == p.KEYWORD_ONLY for p in parameters.values())


# ── the route ─────────────────────────────────────────────────────────────────


def test_feedback_requires_a_token() -> None:
    from fastapi.testclient import TestClient

    from app.main import create_app

    response = TestClient(create_app()).post("/api/interviews/i-1/feedback", json={})
    assert response.status_code == 401

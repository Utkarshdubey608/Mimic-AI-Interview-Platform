"""The recruiter's coding breakdown, and the reason it lives on the session.

A submission job expires an hour after it is created (`coding_jobs.TTL`) and a
report is opened days later, so anything the report shows has to be written into
the durable record at grading time or it is not really in the report. That is what
`durable_result` is for, and these tests pin the two properties that matter:

  · the durable record carries what the breakdown needs — language, code, and the
    per-case verdicts with their points and timings;
  · it does NOT carry per-case streams. They are candidate-controlled and up to
    8 KB each, and thirty of them do not fit in a Firestore document beside a
    transcript. `score_submission`'s caller attaches them to the graded dict, so
    a plain dict copy WOULD have carried them in — hence a test.

And one property of the breakdown itself: a problem nobody submitted still appears,
because a blank row is the finding that somebody ran out of time.
"""

from __future__ import annotations

import json

from app.web.services import coding_scoring

AT = "2026-08-27T05:00:00+00:00"


def _problem(pid: str = "p1", *, points=(3, 7)) -> dict:
    return {
        "id": pid,
        "title": "Two Sum",
        "difficulty": "easy",
        "timeLimitMs": 2000,
        "memoryMb": 128,
        "testCases": [
            {"id": "c1", "input": "1 2", "expectedOutput": "3", "points": points[0], "hidden": False},
            {"id": "c2", "input": "9 9", "expectedOutput": "18", "points": points[1], "hidden": True},
        ],
    }


def _verdicts(second_passes: bool) -> dict:
    return {
        "c1": {"status": coding_scoring.ACCEPTED, "timeMs": 12, "memoryKb": 4096, "stdout": "3"},
        "c2": {
            "status": coding_scoring.ACCEPTED if second_passes else coding_scoring.WRONG_ANSWER,
            "timeMs": 41,
            "memoryKb": 4300,
            "stdout": "18" if second_passes else "0",
        },
    }


def _graded(second_passes: bool = True) -> dict:
    problem = _problem()
    graded = coding_scoring.score_submission(problem, _verdicts(second_passes))
    # Exactly what the route does before writing the durable record, so the
    # stream-exclusion test below is testing the real call site's input.
    graded["streams"] = {"c1": {"stdout": "3"}, "c2": {"stdout": "LEAK-b91f2c"}}
    return graded


def test_durable_result_carries_what_the_breakdown_shows() -> None:
    record = coding_scoring.durable_result(
        _graded(), language="python", source="print(sum(map(int, input().split())))", at=AT, submission_id="s1"
    )

    assert record["score"] == 10
    assert record["maxScore"] == 10
    assert record["passed"] == 2
    assert record["total"] == 2
    assert record["language"] == "python"
    assert "print(sum" in record["code"]
    assert record["truncated"] is False
    assert record["submissionId"] == "s1"
    assert record["at"] == AT
    assert [c["id"] for c in record["cases"]] == ["c1", "c2"]
    assert [c["timeMs"] for c in record["cases"]] == [12, 41]
    assert [c["awarded"] for c in record["cases"]] == [3, 7]


def test_durable_result_does_not_carry_streams() -> None:
    """The graded dict it is handed HAS streams. The record must not."""
    graded = _graded()
    assert "LEAK-b91f2c" in json.dumps(graded), "fixture no longer proves anything"

    record = coding_scoring.durable_result(
        graded, language="python", source="x", at=AT, submission_id="s1"
    )

    assert "streams" not in record
    assert "LEAK-b91f2c" not in json.dumps(record)


def test_durable_result_bounds_the_stored_source() -> None:
    huge = "x" * (coding_scoring.MAX_REPORT_SOURCE_CHARS + 500)
    record = coding_scoring.durable_result(
        _graded(), language="c", source=huge, at=AT, submission_id="s1"
    )

    assert len(record["code"]) == coding_scoring.MAX_REPORT_SOURCE_CHARS
    assert record["truncated"] is True


def test_recruiter_report_keeps_hidden_case_detail() -> None:
    """The inverse of `candidate_view`. This is the owner reading their own paper."""
    session = {
        "track": "coding",
        "codingProblems": [_problem()],
        "codingResults": {
            "p1": coding_scoring.durable_result(
                _graded(second_passes=False), language="java", source="class Main {}", at=AT, submission_id="s1"
            )
        },
    }

    block = coding_scoring.recruiter_report(session)
    hidden = [c for c in block["problems"][0]["cases"] if c["hidden"]]

    assert len(hidden) == 1
    assert hidden[0]["status"] == coding_scoring.WRONG_ANSWER
    assert hidden[0]["timeMs"] == 41


def test_recruiter_report_lists_a_problem_nobody_submitted() -> None:
    session = {
        "track": "coding",
        "codingProblems": [_problem("p1"), _problem("p2")],
        "codingResults": {
            "p1": coding_scoring.durable_result(
                _graded(), language="python", source="ok", at=AT, submission_id="s1"
            )
        },
        "codingDrafts": {"p2": "def solve():  # ran out of time"},
    }

    block = coding_scoring.recruiter_report(session)
    first, second = block["problems"]

    assert first["attempted"] is True
    assert second["attempted"] is False
    assert second["score"] is None
    # Still worth 10, so the report shows what was on the table rather than a dash.
    assert second["maxScore"] == 10
    assert second["caseCount"] == 2
    assert second["draft"] == "def solve():  # ran out of time"
    # A submitted problem does not carry the draft: the submitted code is the record.
    assert "draft" not in first


def test_recruiter_report_totals_span_every_problem() -> None:
    session = {
        "track": "coding",
        "codingProblems": [_problem("p1"), _problem("p2")],
        "codingResults": {
            "p1": coding_scoring.durable_result(
                _graded(), language="python", source="ok", at=AT, submission_id="s1"
            ),
            "p2": coding_scoring.durable_result(
                _graded(second_passes=False), language="go", source="ok", at=AT, submission_id="s2"
            ),
        },
    }

    block = coding_scoring.recruiter_report(session)

    assert block["score"] == 13
    assert block["maxScore"] == 20
    assert block["percent"] == 65.0
    assert block["attempted"] == 2
    assert block["languages"] == ["go", "python"]
    assert block["slowestCaseMs"] == 41


def test_recruiter_report_of_an_untouched_assessment_does_not_divide_by_zero() -> None:
    block = coding_scoring.recruiter_report({"track": "coding"})

    assert block["problems"] == []
    assert block["percent"] == 0.0
    assert block["slowestCaseMs"] is None


# ── through the route ─────────────────────────────────────────────────────────
#
# The breakdown is composed in the report response rather than served from a
# second endpoint, so the tests that matter are: it is there for a coding session,
# it is absent for every other track, and a candidate cannot reach it — the last
# by the report route's own owner check, which is why it is worth asserting rather
# than assuming.

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

CANDIDATE = AuthedUser(uid="uid-cand", email="ada@example.test", claims={})


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


@pytest.fixture
def coding_session(fake_store):
    fake_store.templates.docs["t1"] = {
        "id": "t1",
        "name": "Backend screen",
        "role": "Backend",
        "track": "coding",
        "questionSource": "fixed",
        "rubric": {"kpis": []},
    }
    fake_store.sessions.docs["s1"] = {
        "id": "s1",
        "templateId": "t1",
        "recruiterId": "uid-recruiter",
        "track": "coding",
        "candidate": {"name": "Ada", "email": "ada@example.test"},
        "status": "completed",
        "questions": [],
        "currentIndex": 0,
        "createdAt": "2026-08-27T00:00:00+00:00",
        "codingProblems": [_problem()],
        "codingResults": {
            "p1": coding_scoring.durable_result(
                _graded(second_passes=False),
                language="python",
                source="print('nearly')",
                at=AT,
                submission_id="sub-1",
            )
        },
    }
    return fake_store


def test_the_report_carries_the_coding_breakdown(authed_client: TestClient, coding_session) -> None:
    body = authed_client.get("/api/web/sessions/s1/report").json()

    assert body["coding"]["score"] == 3
    assert body["coding"]["maxScore"] == 10
    assert body["coding"]["problems"][0]["title"] == "Two Sum"
    assert body["coding"]["problems"][0]["language"] == "python"
    assert "nearly" in body["coding"]["problems"][0]["code"]


def test_a_non_coding_report_has_no_coding_block(authed_client: TestClient, coding_session) -> None:
    """Absent, not empty. An empty block would render an empty panel on every report."""
    coding_session.sessions.docs["s1"]["track"] = "chat"
    body = authed_client.get("/api/web/sessions/s1/report").json()

    assert "coding" not in body


def test_a_candidate_cannot_read_the_coding_breakdown(coding_session) -> None:
    response = _client(CANDIDATE).get("/api/web/sessions/s1/report")

    assert response.status_code == 404
    assert "Two Sum" not in response.text

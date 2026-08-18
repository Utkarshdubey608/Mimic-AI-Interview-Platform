"""Candidate feedback on the interview experience.

Additive: a new `web_feedback` collection and two routes under /api/web. The
frozen /api/* Flutter contract, the session/template/report schemas and scoring
are all untouched — a feedback record is written after an interview is over and
read only by the recruiter who owns it.

The tenant boundary is the part worth testing hardest. recruiterId is copied from
the SESSION on the server, never accepted from the client, so a candidate cannot
attribute their feedback to someone else's tenant and a recruiter cannot read
another's.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

CANDIDATE = AuthedUser(uid="uid-cand", email="ada@example.test", claims={})
OTHER_CANDIDATE = AuthedUser(uid="uid-other", email="mallory@example.test", claims={})
RECRUITER = AuthedUser(uid="uid-recruiter", email="recruiter@talbotiq.com", claims={})
OTHER_RECRUITER = AuthedUser(uid="uid-recruiter-2", email="rival@example.test", claims={})


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def _template() -> dict:
    return {
        "id": "t1",
        "name": "Backend screen",
        "role": "Backend",
        "track": "chat",
        "questionSource": "fixed",
        "timing": {"prepSeconds": 30, "answerSeconds": 120, "allowSkipPrep": True,
                   "allowEarlySubmit": True, "warningThresholdSeconds": 15},
        "rubric": {"kpis": []},
        "integrity": {"logEvents": True},
        "branding": {"companyName": "Acme"},
    }


def _session(**overrides) -> dict:
    return {
        "id": "s1",
        "templateId": "t1",
        "recruiterId": "uid-recruiter",
        "track": "chat",
        "candidate": {"name": "Ada", "email": "ada@example.test"},
        "status": "completed",
        "questions": [],
        "currentIndex": 0,
        "createdAt": "2027-01-01T00:00:00+00:00",
        "integrityEvents": [],
        **overrides,
    }


@pytest.fixture
def seeded(fake_store):
    fake_store.templates.docs["t1"] = _template()
    fake_store.sessions.docs["s1"] = _session()
    return fake_store


# ── the candidate writes ──────────────────────────────────────────────────────


def test_a_candidate_can_leave_feedback_on_their_own_interview(seeded) -> None:
    response = _client(CANDIDATE).post(
        "/api/web/sessions/s1/feedback",
        json={"rating": 5, "comment": "Clear and calm.", "hadTechnicalIssues": False},
    )
    assert response.status_code == 200

    stored = seeded.feedback.docs["s1"]
    assert stored["rating"] == 5
    assert stored["comment"] == "Clear and calm."
    assert stored["hadTechnicalIssues"] is False
    assert stored["track"] == "chat"
    assert stored["createdAt"]


def test_the_recruiter_id_comes_from_the_session_not_the_client(seeded) -> None:
    """Otherwise a candidate could file feedback into someone else's tenant."""
    _client(CANDIDATE).post(
        "/api/web/sessions/s1/feedback",
        json={"rating": 3, "recruiterId": "uid-attacker"},
    )
    assert seeded.feedback.docs["s1"]["recruiterId"] == "uid-recruiter"


def test_someone_elses_session_is_a_404(seeded) -> None:
    response = _client(OTHER_CANDIDATE).post("/api/web/sessions/s1/feedback", json={"rating": 5})
    assert response.status_code == 404


def test_feedback_requires_a_token(seeded) -> None:
    assert TestClient(create_app()).post("/api/web/sessions/s1/feedback", json={"rating": 5}).status_code == 401


@pytest.mark.parametrize("rating", [0, 6, -1, "five", None])
def test_a_rating_outside_one_to_five_is_rejected(seeded, rating) -> None:
    response = _client(CANDIDATE).post("/api/web/sessions/s1/feedback", json={"rating": rating})
    assert response.status_code == 400


def test_a_comment_is_optional(seeded) -> None:
    assert _client(CANDIDATE).post("/api/web/sessions/s1/feedback", json={"rating": 4}).status_code == 200
    assert seeded.feedback.docs["s1"]["comment"] == ""


def test_resubmitting_replaces_rather_than_duplicates(seeded) -> None:
    """Keyed by sessionId: one interview, one verdict."""
    client = _client(CANDIDATE)
    client.post("/api/web/sessions/s1/feedback", json={"rating": 2})
    client.post("/api/web/sessions/s1/feedback", json={"rating": 5})
    assert len(seeded.feedback.docs) == 1
    assert seeded.feedback.docs["s1"]["rating"] == 5


def test_a_long_comment_is_bounded(seeded) -> None:
    _client(CANDIDATE).post("/api/web/sessions/s1/feedback", json={"rating": 4, "comment": "x" * 5000})
    assert len(seeded.feedback.docs["s1"]["comment"]) <= 2000


# ── the recruiter reads ───────────────────────────────────────────────────────


def test_a_recruiter_sees_their_own_feedback_with_an_average(seeded) -> None:
    seeded.feedback.docs["s1"] = {
        "sessionId": "s1", "recruiterId": "uid-recruiter", "track": "chat",
        "rating": 4, "comment": "good", "hadTechnicalIssues": False,
        "createdAt": "2027-01-01T00:00:00+00:00", "candidateName": "Ada", "role": "Backend",
    }
    seeded.feedback.docs["s2"] = {
        "sessionId": "s2", "recruiterId": "uid-recruiter", "track": "voice",
        "rating": 2, "comment": "mic trouble", "hadTechnicalIssues": True,
        "createdAt": "2027-01-02T00:00:00+00:00", "candidateName": "Bob", "role": "Backend",
    }

    body = _client(RECRUITER).get("/api/web/feedback").json()

    assert body["count"] == 2
    assert body["averageRating"] == 3.0
    assert body["technicalIssueCount"] == 1
    assert {i["sessionId"] for i in body["items"]} == {"s1", "s2"}


def test_a_recruiter_never_sees_another_tenants_feedback(seeded) -> None:
    seeded.feedback.docs["s1"] = {
        "sessionId": "s1", "recruiterId": "uid-recruiter", "track": "chat",
        "rating": 5, "createdAt": "2027-01-01T00:00:00+00:00",
    }
    body = _client(OTHER_RECRUITER).get("/api/web/feedback").json()
    assert body["items"] == []
    assert body["count"] == 0


def test_an_empty_tenant_reports_a_null_average_not_a_crash(seeded) -> None:
    body = _client(RECRUITER).get("/api/web/feedback").json()
    assert body["count"] == 0
    assert body["averageRating"] is None

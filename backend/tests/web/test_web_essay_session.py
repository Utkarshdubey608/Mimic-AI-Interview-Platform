"""`/api/web/sessions/{id}/essay` — the candidate's side.

TWO PROPERTIES CARRY THIS FILE.

The server owns the clock. A countdown rendered in a browser is a convenience;
the deadline is computed from the session's own start time, because a client
clock can be changed and a candidate should not be able to award themselves an
extra hour by adjusting one.

And work is never lost. A submission arriving after the deadline is STILL
STORED — marked late, so a recruiter can see it — because the alternative is
throwing away forty minutes of somebody's writing over a few seconds of network.
That is the same reasoning behind auto-submitting at zero rather than discarding.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

CANDIDATE = AuthedUser(uid="uid-cand", email="cand@example.test", claims={})
GUIDANCE = "RECRUITER-ONLY-8ab12c"


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def _session_doc(**over) -> dict:
    started = datetime.now(timezone.utc) - timedelta(minutes=5)
    doc = {
        "id": "sess-1",
        # Assignment is by email, matched case-insensitively — the app never stores
        # a candidate uid, because the invite exists before they have an account.
        "candidateEmailLower": CANDIDATE.email,
        "track": "essay",
        "status": "in_progress",
        "startedAt": started.isoformat(),
        "essayPrompt": {
            "id": "ep-1",
            "title": "Automation and employment",
            "promptMd": "Discuss the effect of automation on employment.",
            "promptType": "discursive",
            "language": "en",
            "sourcePassageMd": "",
            "guidanceMd": GUIDANCE,
            "minWords": 250,
            "maxWords": 500,
            "maxChars": 0,
            "timeLimitSeconds": 1_800,
        },
    }
    doc.update(over)
    return doc


@pytest.fixture
def candidate(fake_store) -> TestClient:
    client = _client(CANDIDATE)
    fake_store.sessions.docs["sess-1"] = _session_doc()
    return client


# ── the wrong track ───────────────────────────────────────────────────────────


def test_a_non_essay_session_has_no_essay_routes(fake_store) -> None:
    """404, not 400: these routes simply do not exist for a chatbot interview."""
    client = _client(CANDIDATE)
    fake_store.sessions.docs["sess-1"] = _session_doc(track="chatbot")
    assert client.get("/api/web/sessions/sess-1/essay").status_code == 404


# ── what the candidate receives ───────────────────────────────────────────────


def test_the_candidate_gets_the_question_and_its_limits(candidate: TestClient) -> None:
    body = candidate.get("/api/web/sessions/sess-1/essay").json()
    assert body["prompt"]["promptMd"].startswith("Discuss")
    assert body["prompt"]["minWords"] == 250


def test_the_candidate_never_receives_recruiter_guidance(candidate: TestClient) -> None:
    assert GUIDANCE not in candidate.get("/api/web/sessions/sess-1/essay").text


def test_the_server_reports_the_remaining_time(candidate: TestClient) -> None:
    """Five minutes elapsed of thirty, so a shade under 1500s should remain — and
    it comes from the session's start time, not from anything the client said."""
    body = candidate.get("/api/web/sessions/sess-1/essay").json()
    assert 1_400 < body["remainingSeconds"] <= 1_500


def test_an_expired_session_reports_no_time_rather_than_a_negative(fake_store) -> None:
    client = _client(CANDIDATE)
    long_ago = datetime.now(timezone.utc) - timedelta(hours=3)
    fake_store.sessions.docs["sess-1"] = _session_doc(startedAt=long_ago.isoformat())
    assert client.get("/api/web/sessions/sess-1/essay").json()["remainingSeconds"] == 0


# ── autosave ──────────────────────────────────────────────────────────────────


def test_a_draft_is_saved_and_comes_back(candidate: TestClient) -> None:
    """A refresh must not cost somebody the paragraph they just wrote."""
    candidate.post("/api/web/sessions/sess-1/essay/draft", json={"text": "First paragraph."})
    assert candidate.get("/api/web/sessions/sess-1/essay").json()["draft"] == "First paragraph."


def test_the_saved_draft_reports_its_counts(candidate: TestClient) -> None:
    body = candidate.post(
        "/api/web/sessions/sess-1/essay/draft", json={"text": "one two three"}
    ).json()
    assert body["words"] == 3
    assert body["chars"] == 13


def test_an_oversized_draft_is_refused_rather_than_truncated(candidate: TestClient) -> None:
    """Firestore documents cap at 1 MiB. Silently truncating would lose the end of
    an essay without telling the person writing it."""
    huge = "word " * 400_000
    assert (
        candidate.post("/api/web/sessions/sess-1/essay/draft", json={"text": huge}).status_code
        == 413
    )


# ── submission ────────────────────────────────────────────────────────────────


def test_a_submission_is_stored_with_its_counts(candidate: TestClient) -> None:
    body = candidate.post(
        "/api/web/sessions/sess-1/essay/submit", json={"text": "A short essay."}
    ).json()
    assert body["ok"] is True
    assert body["words"] == 3


def test_a_late_submission_is_kept_and_flagged(fake_store) -> None:
    """Never lose the work. A recruiter can see it was late; nobody has to lose
    forty minutes of writing to a few seconds of network."""
    client = _client(CANDIDATE)
    long_ago = datetime.now(timezone.utc) - timedelta(hours=3)
    fake_store.sessions.docs["sess-1"] = _session_doc(startedAt=long_ago.isoformat())
    body = client.post(
        "/api/web/sessions/sess-1/essay/submit", json={"text": "Late but written."}
    ).json()
    assert body["ok"] is True
    assert body["late"] is True


def test_an_on_time_submission_is_not_flagged_late(candidate: TestClient) -> None:
    body = candidate.post(
        "/api/web/sessions/sess-1/essay/submit", json={"text": "On time."}
    ).json()
    assert body["late"] is False


def test_submitting_twice_is_refused(candidate: TestClient) -> None:
    """One essay, one submission. A second would silently replace the first after
    it may already have been marked."""
    candidate.post("/api/web/sessions/sess-1/essay/submit", json={"text": "First."})
    second = candidate.post("/api/web/sessions/sess-1/essay/submit", json={"text": "Second."})
    assert second.status_code == 409


def test_an_empty_submission_is_refused(candidate: TestClient) -> None:
    assert (
        candidate.post("/api/web/sessions/sess-1/essay/submit", json={"text": "   "}).status_code
        == 400
    )

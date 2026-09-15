"""`POST /sessions/{id}/essay/submit` actually scores the essay — the route,
not the isolated unit test.

WHY THIS FILE EXISTS. `essay_evaluation.build_essay_scoring_body` and
`normalise_essay_score` were thoroughly unit-tested in `test_essay_evaluation.py`
— and, until this file, called from nowhere else in the entire codebase. An
essay could be written, submitted, and stored, and nothing would ever score it.
This exercises the actual submit route end to end, the same way
`test_web_invites_essay.py` exists to run the handler rather than prove a
helper that no handler calls.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.security import AuthedUser
from app.web.services import gemini

CANDIDATE = AuthedUser(uid="uid-cand", email="cand@example.test", claims={})

DEFAULT_KPI_SCORES = {
    "task_response": 80,
    "coherence": 75,
    "argument": 70,
    "lexical": 85,
    "grammar": 90,
    "clarity": 78,
}


def _client(user: AuthedUser) -> TestClient:
    from app.main import create_app
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def _seed(fake_store, **over) -> None:
    started = datetime.now(timezone.utc) - timedelta(minutes=5)
    doc = {
        "id": "sess-1",
        "candidateEmailLower": CANDIDATE.email,
        "track": "essay",
        "status": "in_progress",
        "templateId": "t-1",
        "startedAt": started.isoformat(),
        "essayPrompt": {
            "id": "ep-1",
            "title": "Automation and employment",
            "promptMd": "Discuss the effect of automation on employment.",
            "language": "en",
            "minWords": 1,
            "maxWords": 5_000,
            "timeLimitSeconds": 1_800,
        },
    }
    doc.update(over)
    fake_store.sessions.docs["sess-1"] = doc
    fake_store.templates.docs["t-1"] = {"id": "t-1"}


def _mock_gemini(monkeypatch, *, kpi_scores: dict | None = None, calls: dict | None = None) -> None:
    scores = kpi_scores or DEFAULT_KPI_SCORES

    async def _enabled(_settings):
        return True

    async def _model(_settings):
        return "gemini-2.5-flash"

    async def _generate(_settings, *, model, request_body):
        if calls is not None:
            calls["n"] = calls.get("n", 0) + 1
        result = {
            "kpiScores": scores,
            "kpiRationale": {k: f"Rationale for {k}." for k in scores},
            "strengths": ["Clear thesis."],
            "improvements": ["Add a counterargument."],
        }
        payload = {"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]}
        return 200, json.dumps(payload).encode(), "application/json"

    monkeypatch.setattr(gemini, "is_enabled", _enabled)
    monkeypatch.setattr(gemini, "resolve_model", _model)
    monkeypatch.setattr(gemini, "generate_content_raw", _generate)


def test_a_submitted_essay_is_actually_scored(fake_store, monkeypatch) -> None:
    """THE regression. Before this wiring existed, this assertion always failed:
    nothing ever wrote to `reports` for an essay session."""
    _seed(fake_store)
    _mock_gemini(monkeypatch)
    client = _client(CANDIDATE)

    response = client.post(
        "/api/web/sessions/sess-1/essay/submit",
        json={"text": "Automation changes work in ways that are not evenly distributed."},
    )
    assert response.status_code == 200, response.text

    report = fake_store.reports.docs.get("sess-1")
    assert report is not None, "essay evaluation never ran"
    assert report["overallScore"] > 0
    assert report["kpiAverages"]["grammar"] == 90
    assert report["perQuestion"][0]["questionId"] == "essay"
    assert "degraded" not in report
    assert report["strengths"] == ["Clear thesis."]


def test_essay_session_is_marked_completed_on_submit(fake_store, monkeypatch) -> None:
    """Every other track stamps `status: completed` on finishing — essay never
    did, so the recruiter's report screen showed "still in progress" forever."""
    _seed(fake_store)
    _mock_gemini(monkeypatch)
    client = _client(CANDIDATE)

    client.post("/api/web/sessions/sess-1/essay/submit", json={"text": "An essay."})
    assert fake_store.sessions.docs["sess-1"]["status"] == "completed"
    assert fake_store.sessions.docs["sess-1"].get("completedAt")


def test_scoring_degrades_to_the_labelled_heuristic_with_no_gemini_key(fake_store) -> None:
    """No monkeypatch: this environment configures no Gemini key, so
    `gemini.is_enabled` resolves false — matching every other track's own
    degrade-rather-than-fail behaviour, not a silent skip."""
    _seed(fake_store)
    client = _client(CANDIDATE)

    client.post("/api/web/sessions/sess-1/essay/submit", json={"text": "An essay written with no key configured."})

    report = fake_store.reports.docs.get("sess-1")
    assert report is not None
    assert report["degraded"] is True
    assert report["overallScore"] >= 0


def test_essay_is_not_scored_twice(fake_store, monkeypatch) -> None:
    """A second submit is refused at 409 before scoring is even considered — so
    a retried request cannot double up the model call either."""
    _seed(fake_store)
    calls: dict = {}
    _mock_gemini(monkeypatch, calls=calls)
    client = _client(CANDIDATE)

    first = client.post("/api/web/sessions/sess-1/essay/submit", json={"text": "First."})
    second = client.post("/api/web/sessions/sess-1/essay/submit", json={"text": "Second."})

    assert first.status_code == 200, first.text
    assert second.status_code == 409
    assert calls.get("n") == 1

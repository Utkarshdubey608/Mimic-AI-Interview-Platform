"""The MCQ paper's whole-paper timer — server-enforced, not just displayed.

WHY THIS FILE EXISTS. `mcqConfig.totalSeconds` was stored and returned to the
client, and nothing anywhere ever checked it: a candidate could leave a web MCQ
paper open indefinitely with zero time pressure. `app/mcq_runtime.py`'s
`remaining_seconds_for` already existed and was already correct — it was simply
never called from this session route. This file pins the fix: the deadline is
computed server-side, an expired paper closes itself on the next read or write,
and a late Submit is still scored rather than silently discarded.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

RECRUITER = AuthedUser(uid="uid-rec", email="rec@example.test", claims={})
CANDIDATE = AuthedUser(uid="uid-cand", email="ada@example.test", claims={})


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


PAPER = [
    {
        "id": "q1",
        "text": "What does EC2 stand for?",
        "type": "single",
        "options": [
            {"id": "a", "text": "Elastic Compute Cloud"},
            {"id": "b", "text": "Elastic Container Cloud"},
        ],
        "correctOptionIds": ["a"],
        "topic": "AWS",
    },
]


def _seed(fake_store, *, config=None, started_at=None, status="in_progress") -> str:
    session_id = "s-mcq-timer-1"
    doc = {
        "id": session_id,
        "templateId": "t1",
        "recruiterId": RECRUITER.uid,
        "track": "mcq",
        "status": status,
        "candidate": {"name": "Ada", "email": CANDIDATE.email},
        "candidateEmailLower": CANDIDATE.email,
        "questions": PAPER,
        "mcqConfig": config or {},
        "integrityEvents": [],
        "tabSwitchCount": 0,
    }
    if started_at is not None:
        doc["startedAt"] = started_at.isoformat()
    _run(fake_store.sessions.put(doc))
    _run(fake_store.templates.put({"id": "t1", "name": "AWS screen", "role": "Cloud", "track": "mcq"}))
    return session_id


def _ago(**kwargs) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**kwargs)


def test_remaining_seconds_is_absent_for_an_untimed_paper(fake_store) -> None:
    sid = _seed(fake_store, config={}, started_at=_ago(minutes=5))
    body = _client(CANDIDATE).get(f"/api/web/sessions/{sid}/mcq").json()
    assert body["remainingSeconds"] is None
    assert body["status"] == "in_progress"


def test_remaining_seconds_counts_down_from_started_at(fake_store) -> None:
    sid = _seed(fake_store, config={"totalSeconds": 600}, started_at=_ago(minutes=5))
    body = _client(CANDIDATE).get(f"/api/web/sessions/{sid}/mcq").json()
    # 600 - 300 = 300, minus a shade for test execution time.
    assert 250 < body["remainingSeconds"] <= 300


def test_an_expired_paper_is_auto_submitted_on_the_next_read(fake_store) -> None:
    sid = _seed(fake_store, config={"totalSeconds": 60}, started_at=_ago(minutes=5))
    body = _client(CANDIDATE).get(f"/api/web/sessions/{sid}/mcq").json()

    assert body["remainingSeconds"] == 0
    assert body["submittedAt"] is not None
    assert body["status"] == "completed"

    stored = fake_store.sessions.docs[sid]
    assert stored["mcqAutoSubmitted"] is True
    assert fake_store.reports.docs.get(sid) is not None, "the auto-close must still write a report"


def test_an_untimed_paper_never_auto_submits(fake_store) -> None:
    """No `totalSeconds` at all means no deadline, however long ago it opened."""
    sid = _seed(fake_store, config={}, started_at=_ago(days=3))
    body = _client(CANDIDATE).get(f"/api/web/sessions/{sid}/mcq").json()
    assert body["status"] == "in_progress"
    assert body["submittedAt"] is None


def test_a_late_manual_submit_is_still_scored_with_its_own_answers(fake_store) -> None:
    """The candidate's own Submit, arriving after the deadline, must not be
    silently reduced to whatever the last autosave happened to catch."""
    sid = _seed(fake_store, config={"totalSeconds": 60}, started_at=_ago(minutes=5))
    response = _client(CANDIDATE).post(
        f"/api/web/sessions/{sid}/mcq/submit", json={"answers": {"q1": ["a"]}}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["submittedAt"] is not None

    stored = fake_store.sessions.docs[sid]
    assert stored["mcqAnswers"] == {"q1": ["a"]}
    assert stored["mcqResult"]["correctCount"] == 1


def test_autosave_is_rejected_once_the_clock_has_closed_the_paper(fake_store) -> None:
    sid = _seed(fake_store, config={"totalSeconds": 60}, started_at=_ago(minutes=5))
    response = _client(CANDIDATE).post(
        f"/api/web/sessions/{sid}/mcq/answers", json={"answers": {"q1": ["a"]}}
    )
    assert response.status_code == 409


def test_submitting_an_already_auto_closed_paper_is_refused_not_rescored(fake_store) -> None:
    sid = _seed(fake_store, config={"totalSeconds": 60}, started_at=_ago(minutes=5))
    client = _client(CANDIDATE)
    # A read closes it first, exactly as a poll or a page load would.
    client.get(f"/api/web/sessions/{sid}/mcq")
    second = client.post(f"/api/web/sessions/{sid}/mcq/submit", json={"answers": {"q1": ["a"]}})
    assert second.status_code == 409

"""The dashboard counts every interview, not only the ones this surface ran.

The cohort was `web_sessions` alone. An interview a candidate took in the Flutter app
has no web session, so it was absent from the dashboard entirely — and the same
recruiter saw different totals, averages and coverage depending on which client they
opened. Two dashboards, two answers, one corpus.

Both aggregate `interviews` joined with the shared `reports` now. These tests are about
the union: that phone interviews are counted, that a web session still wins where both
records exist, and that the synthesised rows do not distort the funnel.
"""

from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from app import interviews, reports


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _phone_interview(fake_firestore, interview_id: str, **overrides) -> None:
    """An interview created and completed entirely on the phone — no web session."""
    fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs[interview_id] = {
        "recruiterId": "uid-recruiter",
        "candidateEmail": f"{interview_id}@example.test",
        "candidateEmailLower": f"{interview_id}@example.test",
        "title": "Backend Engineer — interview",
        "type": "chat",
        "questions": ["Q1", "Q2"],
        "status": "completed",
        "createdAt": "2027-02-01T09:00:00+00:00",
        "completedAt": "2027-02-01T09:30:00+00:00",
        "result": {"overallScore": 80, "evaluatedBy": "ai"},
        **overrides,
    }


def _report(fake_firestore, interview_id: str, score: int) -> None:
    fake_firestore.collection(reports.REPORTS_COLLECTION).docs[interview_id] = {
        "sessionId": interview_id,
        "interviewId": interview_id,
        "overallScore": score,
        "perQuestion": [{"question": "Q1", "score": score}],
        "kpiAverages": {"clarity": score},
    }


def _summary(client: TestClient) -> dict:
    response = client.get("/api/web/analytics")
    assert response.status_code == 200, response.text
    return response.json()


# ── the union ─────────────────────────────────────────────────────────────────


def test_a_phone_interview_is_counted(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """The defect: it was absent from the dashboard entirely."""
    _phone_interview(fake_firestore, "mob-1")
    _report(fake_firestore, "mob-1", 80)

    body = _summary(authed_client)
    assert body["totals"]["created"] >= 1
    assert body["totals"]["completed"] >= 1


def test_the_two_records_of_one_interview_are_counted_once(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """The session id IS the interview id, which makes the union a merge on one key.

    Counting both would double every interview taken through the browser — a dashboard
    that silently doubles is worse than one that silently omits, because it looks
    healthy.
    """
    _phone_interview(fake_firestore, "both-1")
    _run(
        fake_store.sessions.put(
            {
                "id": "both-1",
                "recruiterId": "uid-recruiter",
                "templateId": "tpl-1",
                "track": "chat",
                "status": "completed",
                "createdAt": "2027-02-01T09:00:00+00:00",
                "completedAt": "2027-02-01T09:30:00+00:00",
                "questions": [{"text": "Q1"}],
            }
        )
    )

    assert _summary(authed_client)["totals"]["created"] == 1


def test_the_web_session_wins_where_both_exist(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """It is the richer record — it knows the template and the real track."""
    _phone_interview(fake_firestore, "both-2", type="video")
    _run(
        fake_store.templates.put({"id": "tpl-1", "name": "Screen", "role": "Backend"})
    )
    _run(
        fake_store.sessions.put(
            {
                "id": "both-2",
                "recruiterId": "uid-recruiter",
                "templateId": "tpl-1",
                "track": "chatbot",
                "status": "completed",
                "createdAt": "2027-02-01T09:00:00+00:00",
                "questions": [],
            }
        )
    )

    body = _summary(authed_client)
    tracks = {row["track"]: row for row in body.get("byTrack") or []}
    assert "chatbot" in tracks, "the session's track should win over the interview's"


def test_an_unopened_invite_counts_as_created_not_started(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """Counting it as started would inflate the funnel's first step.

    An interview nobody has opened has not been started, whatever the invite's own
    vocabulary calls it.
    """
    _phone_interview(fake_firestore, "new-1", status="assigned", completedAt=None)

    body = _summary(authed_client)
    assert body["totals"]["created"] == 1
    assert body["totals"]["started"] == 0
    assert body["totals"]["completed"] == 0


def test_another_recruiters_interview_is_never_counted(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """A company-wide average that silently included someone else's candidates would
    be wrong in a way nobody would notice."""
    _phone_interview(fake_firestore, "theirs", recruiterId="someone-else")

    assert _summary(authed_client)["totals"]["created"] == 0


def test_a_template_filter_excludes_interviews_with_no_template(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """`templateId` is left None rather than invented.

    A synthesised row matched to an arbitrary template would put phone interviews
    inside a filter they have nothing to do with.
    """
    _phone_interview(fake_firestore, "mob-2")

    filtered = authed_client.get("/api/web/analytics?templateId=tpl-1").json()
    assert filtered["totals"]["created"] == 0


def test_the_dashboard_still_renders_when_interviews_cannot_be_read(
    authed_client: TestClient, fake_store, fake_firestore, monkeypatch
) -> None:
    """A summary degrades to what this surface knows rather than failing the page.

    It logs, so a persistently short cohort is visible rather than quietly wrong.
    """

    def _explode(_settings):
        raise RuntimeError("firestore unavailable")

    monkeypatch.setattr(interviews, "collection", _explode)
    _run(
        fake_store.sessions.put(
            {
                "id": "web-only",
                "recruiterId": "uid-recruiter",
                "templateId": None,
                "track": "chat",
                "status": "completed",
                "createdAt": "2027-02-01T09:00:00+00:00",
                "questions": [],
            }
        )
    )

    assert _summary(authed_client)["totals"]["created"] == 1

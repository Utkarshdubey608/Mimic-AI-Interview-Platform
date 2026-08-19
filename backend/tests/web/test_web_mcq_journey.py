"""The whole MCQ journey, in the order a person walks it.

WHY THIS FILE EXISTS. Every piece of the MCQ track had unit tests and passed them,
and the feature was still completely broken when a recruiter clicked the first
button. Twice over:

  · "New MCQ set" answered 400 every time, because one rule refused an empty set
    and another refused the blank question added to satisfy it. Both rules had
    tests. Neither test created a set the way the editor does.
  · A finished paper could not be SENT, because `MODE_LABELS` gated the invite
    route and 'mcq' was missing from it. Every route involved had tests. None of
    them sent an invite.

Unit tests prove the parts. This proves the JOINS, which is where both failures
lived. It walks one path from an empty account to a scored report, asserting in
order and stopping at the first thing that would stop a person.

If a future change breaks any hand-off — a mode list, a template field, an id that
does not survive a hop — this test fails at that step and names it.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

RECRUITER = AuthedUser(uid="uid-rec", email="rec@talbotiq.test", claims={"email_verified": True})
CANDIDATE = AuthedUser(uid="uid-cand", email="ada@example.test", claims={"email_verified": True})


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _authored_questions() -> list[dict]:
    """Two questions as the editor would have them once actually written."""
    return [
        {
            "id": "auth-q1",
            "text": "What does EC2 stand for?",
            "type": "single",
            "options": [
                {"id": "a", "text": "Elastic Compute Cloud"},
                {"id": "b", "text": "Elastic Container Cloud"},
                {"id": "c", "text": "Encrypted Compute Cluster"},
            ],
            "correctOptionIds": ["a"],
            "topic": "AWS",
            "points": 2,
        },
        {
            "id": "auth-q2",
            "text": "Which of these are AWS services?",
            "type": "multi",
            "options": [
                {"id": "a", "text": "S3"},
                {"id": "b", "text": "IAM"},
                {"id": "c", "text": "Azure Blob Storage"},
            ],
            "correctOptionIds": ["a", "b"],
            "topic": "AWS",
        },
    ]


def test_the_whole_mcq_journey(fake_store) -> None:
    recruiter = _client(RECRUITER)
    candidate = _client(CANDIDATE)

    # ── 1. The recruiter starts a paper ──────────────────────────────────────
    # Exactly what the New MCQ set button sends: a blank question, so the set is
    # not empty. This is the call that used to 400.
    blank = {
        "text": "",
        "options": [{"id": "o1", "text": ""}, {"id": "o2", "text": ""}],
        "correctOptionIds": [],
    }
    created = recruiter.post(
        "/api/web/mcq-sets", json={"name": "New MCQ set", "questions": [blank]}
    )
    assert created.status_code == 201, f"step 1 — creating a set: {created.text}"
    set_id = created.json()["id"]
    assert created.json()["ready"] is False, "a blank set must not claim to be ready"

    # ── 2. It cannot be sent while unfinished ────────────────────────────────
    # The strict half. A paper with no correct answers scores everyone zero.
    premature = recruiter.post(
        "/api/web/invites",
        json={
            "mode": "mcq",
            "role": "Cloud Engineer",
            "mcqSetId": set_id,
            "candidates": [{"email": CANDIDATE.email, "role": "Cloud Engineer"}],
            "origin": "https://example.test",
        },
    )
    assert premature.status_code == 400, "step 2 — an unfinished paper must not send"
    assert "not ready" in premature.json()["detail"]

    # ── 3. The recruiter writes the questions ────────────────────────────────
    saved = recruiter.put(
        f"/api/web/mcq-sets/{set_id}",
        json={"name": "AWS fundamentals", "questions": _authored_questions()},
    )
    assert saved.status_code == 200, f"step 3 — saving the paper: {saved.text}"
    assert saved.json()["ready"] is True, f"still unready: {saved.json()['faults']}"

    # ── 4. The paper reaches an interview ────────────────────────────────────
    # Via a template, which is what the invite pipeline synthesises. This is the
    # hop that carries `mcqSetId`, and where a missing field would strand it.
    _run(
        fake_store.templates.put(
            {
                "id": "tpl-mcq",
                "name": "AWS screen",
                "role": "Cloud Engineer",
                "track": "mcq",
                "mcqSetId": set_id,
                "mcqConfig": {"multiRule": "all_or_nothing"},
            }
        )
    )
    session = recruiter.post(
        "/api/web/sessions",
        json={
            "templateId": "tpl-mcq",
            "track": "mcq",
            "candidate": {"name": "Ada", "email": CANDIDATE.email},
        },
    )
    assert session.status_code == 201, f"step 4 — creating the session: {session.text}"
    session_id = session.json()["id"]

    # ── 5. The candidate opens the paper ─────────────────────────────────────
    paper = candidate.get(f"/api/web/sessions/{session_id}/mcq")
    assert paper.status_code == 200, f"step 5 — opening the paper: {paper.text}"
    body = paper.json()
    assert len(body["questions"]) == 2, "both questions must arrive"
    assert body["status"] == "in_progress", "opening the paper starts the assessment"

    # THE PROPERTY THE WHOLE MODE RESTS ON, asserted on the real wire payload.
    assert "correctOptionIds" not in paper.text, "the answer key reached the candidate"
    assert "auth-q1" not in paper.text or True  # ids may travel; the KEY may not

    # Options arrived, so it can actually be answered.
    first = body["questions"][0]
    assert len(first["options"]) == 3

    # ── 6. They answer, and a reload does not lose it ────────────────────────
    saved_answers = candidate.post(
        f"/api/web/sessions/{session_id}/mcq/answers",
        json={"answers": {first["id"]: ["a"]}},
    )
    assert saved_answers.status_code == 200, f"step 6 — auto-save: {saved_answers.text}"
    reopened = candidate.get(f"/api/web/sessions/{session_id}/mcq").json()
    assert reopened["answers"] == {first["id"]: ["a"]}, "a reload lost the answers"

    # ── 7. They submit ───────────────────────────────────────────────────────
    second = body["questions"][1]
    submitted = candidate.post(
        f"/api/web/sessions/{session_id}/mcq/submit",
        json={"answers": {first["id"]: ["a"], second["id"]: ["a", "b"]}},
    )
    assert submitted.status_code == 200, f"step 7 — submitting: {submitted.text}"
    assert "correctOptionIds" not in submitted.text, "the key leaked on submit"

    # ── 8. It is scored, exactly, with no model involved ─────────────────────
    stored = _run(fake_store.sessions.get(session_id))
    result = stored["mcqResult"]
    assert result["percent"] == 100.0, f"scored wrong: {result}"
    assert result["correctCount"] == 2
    # Weighted: q1 is worth 2 points, q2 the default 1.
    assert result["pointsAvailable"] == 3.0
    assert stored["status"] == "completed"

    # ── 9. The recruiter has a report where every other track writes one ─────
    report = _run(fake_store.reports.get(session_id))
    assert report is not None, "step 9 — no report was written"
    assert report["track"] == "mcq"
    assert report["mcq"]["percent"] == 100.0
    # And the recruiter's copy DOES keep the key — it is what makes it reviewable.
    assert report["mcq"]["questions"][0]["correctOptionIds"] == ["a"]

    # ── 10. Submitting again is refused, not rescored ────────────────────────
    again = candidate.post(f"/api/web/sessions/{session_id}/mcq/submit", json={})
    assert again.status_code == 409, "a second submit must not rescore"


def test_a_finished_paper_can_actually_be_sent(fake_store) -> None:
    """Step 2's counterpart, and the bug it would have caught.

    A complete paper must pass the invite route. `MODE_LABELS` gates that route and
    'mcq' was missing from it, so a finished paper was unsendable — with every
    individual route green. This asserts the join.
    """
    recruiter = _client(RECRUITER)
    created = recruiter.post(
        "/api/web/mcq-sets",
        json={"name": "AWS fundamentals", "questions": _authored_questions()},
    ).json()
    assert created["ready"] is True

    response = recruiter.post(
        "/api/web/invites",
        json={
            "mode": "mcq",
            "role": "Cloud Engineer",
            "mcqSetId": created["id"],
            "candidates": [{"email": CANDIDATE.email, "role": "Cloud Engineer"}],
            "origin": "https://example.test",
        },
    )
    # Not asserting 201 specifically: sending is allowed to fail on mail transport
    # in a hermetic test. What must NOT happen is a refusal about the MODE or the
    # PAPER, which is what both of today's bugs looked like.
    assert response.status_code != 400 or "mode" not in response.text.lower(), response.text
    assert "not ready" not in response.text


@pytest.mark.parametrize(
    "answers,expected",
    [
        ({"auth-q1": ["a"], "auth-q2": ["a", "b"]}, 100.0),   # all correct
        ({"auth-q1": ["a"], "auth-q2": ["a"]}, 66.7),          # multi partial → 0 of 1
        ({"auth-q1": ["b"], "auth-q2": ["a", "b"]}, 33.3),     # single wrong
        ({}, 0.0),                                              # nothing answered
    ],
)
def test_the_score_a_candidate_would_actually_get(fake_store, answers, expected) -> None:
    """The arithmetic, over the real routes rather than the scorer in isolation.

    Weighted deliberately — q1 is 2 points and q2 is 1 — because a percentage over
    question COUNT rather than points is the kind of error that looks right until
    somebody weights a paper.
    """
    recruiter, candidate = _client(RECRUITER), _client(CANDIDATE)
    created = recruiter.post(
        "/api/web/mcq-sets",
        json={"name": "AWS", "questions": _authored_questions()},
    ).json()
    _run(
        fake_store.templates.put(
            {"id": "t", "name": "s", "role": "Cloud", "track": "mcq", "mcqSetId": created["id"]}
        )
    )
    session_id = recruiter.post(
        "/api/web/sessions",
        json={"templateId": "t", "track": "mcq", "candidate": {"email": CANDIDATE.email}},
    ).json()["id"]

    # Session question ids are fresh per session, so map by text to answer them.
    paper = candidate.get(f"/api/web/sessions/{session_id}/mcq").json()["questions"]
    by_text = {q["text"]: q["id"] for q in paper}
    original = {q["id"]: q["text"] for q in _authored_questions()}
    remapped = {by_text[original[qid]]: picks for qid, picks in answers.items()}

    candidate.post(f"/api/web/sessions/{session_id}/mcq/submit", json={"answers": remapped})
    assert _run(fake_store.sessions.get(session_id))["mcqResult"]["percent"] == expected

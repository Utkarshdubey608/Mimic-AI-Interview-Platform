"""Starting a conversational (chat) session — guarding the fixed-question path.

WHY THIS FILE EXISTS. A `chat` template with `questionSource: "fixed"` but no
`fixedQuestionSetId` (or a set with no questions) used to greet the candidate
normally, and only fail once they answered "yes, I'm ready": `_ask_first_question`
found zero configured questions and called `end_conversation`, which reads exactly
like the interview auto-submitting itself the instant readiness is confirmed.
`TemplateEditorPage` already warns a recruiter "sessions can't start until you pick
one" — this file pins the fix that makes that true: the misconfiguration is now
refused at `/chat/begin`, before any greeting is shown.
"""

from __future__ import annotations

import asyncio

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


def _seed_session(fake_store, *, template: dict) -> str:
    session_id = "s-chat-begin-1"
    _run(fake_store.templates.put(template))
    _run(
        fake_store.sessions.put(
            {
                "id": session_id,
                "templateId": template["id"],
                "recruiterId": RECRUITER.uid,
                "track": "chatbot",
                "status": "created",
                "candidate": {"name": "Ada", "email": CANDIDATE.email},
                "candidateEmailLower": CANDIDATE.email,
            }
        )
    )
    return session_id


def test_begin_is_refused_when_a_fixed_template_has_no_question_set(fake_store) -> None:
    template = {"id": "t-fixed-empty", "name": "No set", "track": "chatbot", "questionSource": "fixed"}
    sid = _seed_session(fake_store, template=template)

    response = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/begin", json={})

    assert response.status_code == 400, response.text
    stored = fake_store.sessions.docs[sid]
    assert stored.get("status") == "created", "must not have started at all"
    assert not stored.get("transcript")


def test_begin_uses_questions_embedded_on_the_session_when_there_is_no_question_set(
    fake_store,
) -> None:
    """An invite materialised through `invite_bridge` (role pipelines, bulk
    invites via the shared `interviews` collection) has no `fixedQuestionSetId`
    at all — its fixed questions were embedded directly on the SESSION as plain
    text when the candidate first opened the link. Refusing to start just
    because there's no question-SET reference would treat three real, already
    -embedded questions as if there were none.
    """
    template = {"id": "t-fixed-embedded", "name": "Bridge-materialised", "track": "chatbot", "questionSource": "fixed"}
    session_id = "s-chat-begin-embedded"
    _run(fake_store.templates.put(template))
    _run(
        fake_store.sessions.put(
            {
                "id": session_id,
                "templateId": template["id"],
                "recruiterId": RECRUITER.uid,
                "track": "chatbot",
                "status": "created",
                "candidate": {"name": "Ada", "email": CANDIDATE.email},
                "candidateEmailLower": CANDIDATE.email,
                "questions": [
                    {"id": "q1", "text": "Tell me about a production system you built.", "autoSubmitted": False},
                    {"id": "q2", "text": "Describe a difficult bug you tracked down.", "autoSubmitted": False},
                ],
            }
        )
    )

    response = _client(CANDIDATE).post(f"/api/web/sessions/{session_id}/chat/begin", json={})
    assert response.status_code == 200, response.text

    answered = _client(CANDIDATE).post(
        f"/api/web/sessions/{session_id}/chat/answer",
        json={"answerText": "Yes, I'm ready to begin."},
    )
    assert answered.status_code == 200, answered.text
    stored = fake_store.sessions.docs[session_id]
    assert stored["status"] == "in_progress"
    interviewer_turns = [t for t in stored["transcript"] if t.get("role") == "interviewer"]
    assert any("production system" in (t.get("content") or "") for t in interviewer_turns)


def test_begin_is_refused_when_the_referenced_question_set_is_empty(fake_store) -> None:
    _run(fake_store.question_sets.put({"id": "qs-empty", "questions": []}))
    template = {
        "id": "t-fixed-empty-set",
        "name": "Empty set",
        "track": "chatbot",
        "questionSource": "fixed",
        "fixedQuestionSetId": "qs-empty",
    }
    sid = _seed_session(fake_store, template=template)

    response = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/begin", json={})

    assert response.status_code == 400, response.text


def test_begin_succeeds_and_readiness_reaches_a_real_first_question(fake_store) -> None:
    _run(
        fake_store.question_sets.put(
            {"id": "qs-1", "questions": [{"id": "q1", "text": "Tell me about yourself."}]}
        )
    )
    template = {
        "id": "t-fixed-ok",
        "name": "Has questions",
        "track": "chatbot",
        "questionSource": "fixed",
        "fixedQuestionSetId": "qs-1",
    }
    sid = _seed_session(fake_store, template=template)
    client = _client(CANDIDATE)

    begun = client.post(f"/api/web/sessions/{sid}/chat/begin", json={})
    assert begun.status_code == 200, begun.text

    stored = fake_store.sessions.docs[sid]
    assert stored["status"] == "in_progress"

    answered = client.post(
        f"/api/web/sessions/{sid}/chat/answer",
        json={"answerText": "Yes, I'm ready to begin."},
    )
    assert answered.status_code == 200, answered.text

    stored = fake_store.sessions.docs[sid]
    # Readiness must lead to a real question, not an immediate completion.
    assert stored["status"] == "in_progress"
    interviewer_turns = [t for t in stored["transcript"] if t.get("role") == "interviewer"]
    assert any(isinstance(t.get("questionIndex"), int) for t in interviewer_turns)

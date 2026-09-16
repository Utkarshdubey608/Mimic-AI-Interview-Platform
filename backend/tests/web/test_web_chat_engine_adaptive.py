"""The adaptive chat engine — follow-up clamps, safe degrade, and the
duplicate-submission bug on `/chat/answer`.

WHY THIS FILE EXISTS. `chat_engine.py`'s adaptive core (`generate_turn`,
`_advance_adaptive`, `normalise_decision`) already runs live — a structured
Gemini decision with a follow-up counter and a hard budget — but none of it had
a single test. That mattered once `answerQuality` and its rubric were added:
without these tests, a regression in the clamps (a model over budget getting a
second follow-up anyway, or ending the interview early) or in the new field's
safe-default behaviour would ship silently. Separately, `/chat/answer` never
validated the `turnId` the frontend already sends — a double-click or a network
retry would silently answer whatever turn was current BY THEN, double-advancing
the interview and burning a second Gemini call. Both are pinned here.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser
from app.web.services import chat_engine, gemini

RECRUITER = AuthedUser(uid="uid-rec", email="rec@example.test", claims={})
CANDIDATE = AuthedUser(uid="uid-cand", email="ada@example.test", claims={})
OTHER_CANDIDATE = AuthedUser(uid="uid-cand-2", email="mallory@example.test", claims={})


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _seed(fake_store, *, adaptive: dict | None = None, current_index: int = 0, follow_ups: int = 0) -> str:
    """An in-progress adaptive chat session, already past the greeting/readiness
    turns and sitting on a real primary question — the state `/chat/answer`
    actually runs against."""
    session_id = "s-chat-adaptive-1"
    template = {
        "id": "t-adaptive",
        "name": "Adaptive template",
        "track": "chatbot",
        "questionSource": "adaptive",
        "adaptive": adaptive or {"allowFollowUps": True, "maxFollowUpsPerQuestion": 1},
    }
    _run(fake_store.templates.put(template))
    _run(
        fake_store.sessions.put(
            {
                "id": session_id,
                "templateId": template["id"],
                "recruiterId": RECRUITER.uid,
                "track": "chatbot",
                "status": "in_progress",
                "candidate": {"name": "Ada", "email": CANDIDATE.email},
                "candidateEmailLower": CANDIDATE.email,
                "resumeText": "Backend engineer, 3 years, mostly Python and SQL.",
                "currentIndex": current_index,
                "followUpsThisQuestion": follow_ups,
                "plannedQuestionCount": 5,
                "transcript": [
                    {"id": "turn-question-1", "role": "interviewer", "content": "Tell me about a recent project.",
                     "turnType": "question", "questionIndex": current_index, "isFollowUp": False},
                ],
            }
        )
    )
    return session_id


def _stub_gemini(monkeypatch, payload: dict | str) -> dict:
    """Replaces the one Gemini call chat_engine makes per turn. `calls` counts
    invocations, so a rejected duplicate request can be asserted to have made
    ZERO extra calls."""
    calls = {"n": 0}

    async def _generate_text(*args, **kwargs):
        calls["n"] += 1
        return payload if isinstance(payload, str) else json.dumps(payload)

    async def _true(*_args, **_kwargs):
        return True

    monkeypatch.setattr(gemini, "is_enabled", _true)
    monkeypatch.setattr(gemini, "generate_text", _generate_text)
    return calls


# ── follow-up budget / state-machine clamps ───────────────────────────────────


def test_a_follow_up_past_budget_is_clamped_to_the_next_question(fake_store, monkeypatch) -> None:
    """The model asking for a follow-up it has no budget left for must not get
    one — this is the deterministic safety net the master prompt calls for,
    independent of whatever the model itself decides."""
    sid = _seed(fake_store, adaptive={"allowFollowUps": True, "maxFollowUpsPerQuestion": 1}, follow_ups=1)
    _stub_gemini(monkeypatch, {
        "answerQuality": "weak", "acknowledgment": "Thanks for that.",
        "message": "Can you say more?", "action": "follow_up",
    })

    r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-question-1", "answerText": "Not much to say.",
    })
    assert r.status_code == 200, r.text

    stored = fake_store.sessions.docs[sid]
    # Clamped to next_question: index advanced, follow-up counter reset — NOT
    # incremented, which is what actually taking the follow_up branch would do.
    assert stored["currentIndex"] == 1
    assert stored["followUpsThisQuestion"] == 0


def test_end_interview_is_clamped_while_primary_questions_remain(fake_store, monkeypatch) -> None:
    """A model that decides to wrap up early would cut the interview short and
    score the candidate on fewer questions than everyone else in the batch."""
    sid = _seed(fake_store, current_index=0)
    fake_store.sessions.docs[sid]["plannedQuestionCount"] = 5
    _stub_gemini(monkeypatch, {
        "answerQuality": "sufficient", "acknowledgment": "Great.",
        "message": "Thanks, that concludes our interview.", "action": "end_interview",
    })

    r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-question-1", "answerText": "A solid, complete answer.",
    })
    assert r.status_code == 200, r.text

    stored = fake_store.sessions.docs[sid]
    assert stored["status"] == "in_progress"  # NOT ended — clamped to next_question
    assert stored["currentIndex"] == 1


def test_a_sufficient_answer_does_not_trigger_a_needless_follow_up(fake_store, monkeypatch) -> None:
    """Not a clamp — this is the model's OWN judgment, exercised end to end: an
    answer the model itself calls sufficient should move on, not be probed."""
    sid = _seed(fake_store)
    _stub_gemini(monkeypatch, {
        "answerQuality": "sufficient", "acknowledgment": "That's a clear answer.",
        "message": "What was the biggest challenge in that project?", "action": "next_question",
    })

    r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-question-1", "answerText": "Here is a detailed, complete answer.",
    })
    assert r.status_code == 200, r.text
    assert fake_store.sessions.docs[sid]["currentIndex"] == 1


# ── safe degrade on malformed/missing model output ────────────────────────────


def test_non_json_model_output_degrades_safely_and_saves_the_answer(fake_store, monkeypatch) -> None:
    """A model that returns garbage must not crash the interview or lose the
    candidate's answer — it degrades to the documented fallback."""
    sid = _seed(fake_store)
    _stub_gemini(monkeypatch, "not json at all { garbage")

    r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-question-1", "answerText": "My real answer.",
    })
    assert r.status_code == 200, r.text

    stored = fake_store.sessions.docs[sid]
    candidate_turns = [t for t in stored["transcript"] if t.get("role") == "candidate"]
    assert candidate_turns and candidate_turns[0]["content"] == "My real answer."
    # The interview is still usable — some interviewer turn followed.
    assert stored["transcript"][-1]["role"] == "interviewer"


def test_missing_answer_quality_defaults_safely_without_crashing(fake_store, monkeypatch) -> None:
    """A well-formed decision that simply omits the new field (an older prompt
    version, a flaky model) must not crash `normalise_decision` or the route."""
    sid = _seed(fake_store)
    _stub_gemini(monkeypatch, {
        "acknowledgment": "Thanks.", "message": "Tell me more about that.", "action": "next_question",
    })

    r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-question-1", "answerText": "An answer.",
    })
    assert r.status_code == 200, r.text


def test_normalise_decision_defaults_an_invalid_answer_quality() -> None:
    """Unit-level: exercising `normalise_decision` directly, the same
    defence `action` already has."""
    decision = chat_engine.normalise_decision({"answerQuality": "amazing!!", "message": "x", "action": "bogus"})
    assert decision["answerQuality"] == "partial"
    assert decision["action"] == "next_question"


# ── idempotent /chat/answer ────────────────────────────────────────────────────


def test_a_stale_turn_id_is_refused_not_silently_answered(fake_store, monkeypatch) -> None:
    """The frontend already sends `turnId` on every submit — this pins that the
    backend actually checks it, mirroring the fixed-slot track's own guard
    against the identical bug (`routes/sessions.py`'s questionId check)."""
    sid = _seed(fake_store)
    calls = _stub_gemini(monkeypatch, {
        "answerQuality": "sufficient", "acknowledgment": "Good.",
        "message": "Next question.", "action": "next_question",
    })

    r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-that-does-not-exist", "answerText": "An answer.",
    })
    assert r.status_code == 409, r.text
    assert calls["n"] == 0  # rejected before any Gemini call, and before any mutation
    stored = fake_store.sessions.docs[sid]
    assert len(stored["transcript"]) == 1  # unchanged — nothing appended


def test_a_missing_turn_id_is_refused_the_same_way(fake_store, monkeypatch) -> None:
    """Strict on purpose, matching the fixed-slot idiom exactly: an absent id
    fails the comparison the same way a wrong one does."""
    sid = _seed(fake_store)
    _stub_gemini(monkeypatch, {
        "answerQuality": "sufficient", "message": "Next.", "action": "next_question",
    })
    r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={"answerText": "An answer."})
    assert r.status_code == 409, r.text


def test_a_double_submit_only_advances_the_interview_once(fake_store, monkeypatch) -> None:
    """The exact race this fix closes: the SAME answer, posted twice with the
    turnId the client had at send time. The second call's turnId is now stale
    because the first call already advanced the session — it must be refused,
    not treated as an answer to whatever question is current by then."""
    sid = _seed(fake_store)
    calls = _stub_gemini(monkeypatch, {
        "answerQuality": "sufficient", "acknowledgment": "Good.",
        "message": "Next question.", "action": "next_question",
    })
    client = _client(CANDIDATE)
    body = {"turnId": "turn-question-1", "answerText": "My answer."}

    first = client.post(f"/api/web/sessions/{sid}/chat/answer", json=body)
    assert first.status_code == 200, first.text
    assert calls["n"] == 1

    second = client.post(f"/api/web/sessions/{sid}/chat/answer", json=body)
    assert second.status_code == 409, second.text
    assert calls["n"] == 1  # no second Gemini call

    stored = fake_store.sessions.docs[sid]
    assert stored["currentIndex"] == 1  # advanced exactly once
    candidate_turns = [t for t in stored["transcript"] if t.get("role") == "candidate"]
    assert len(candidate_turns) == 1  # the answer was recorded exactly once


# ── IDOR on the chat routes ────────────────────────────────────────────────────


def test_a_different_candidate_cannot_answer_someone_elses_session(fake_store, monkeypatch) -> None:
    sid = _seed(fake_store)
    _stub_gemini(monkeypatch, {"answerQuality": "sufficient", "message": "x", "action": "next_question"})
    r = _client(OTHER_CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-question-1", "answerText": "Not mine to answer.",
    })
    assert r.status_code == 404, r.text
    assert len(fake_store.sessions.docs[sid]["transcript"]) == 1  # untouched


def test_a_different_candidate_cannot_begin_someone_elses_session(fake_store) -> None:
    sid = _seed(fake_store)
    r = _client(OTHER_CANDIDATE).post(f"/api/web/sessions/{sid}/chat/begin", json={})
    assert r.status_code == 404, r.text


# ── the answer-quality rubric field never reaches the candidate ───────────────


def test_answer_quality_is_stored_server_side_but_never_sent_to_the_candidate(fake_store, monkeypatch) -> None:
    sid = _seed(fake_store)
    _stub_gemini(monkeypatch, {
        "answerQuality": "incorrect", "acknowledgment": "I see.",
        "message": "Let's look at that from another angle.", "action": "follow_up",
    })
    r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-question-1", "answerText": "A confidently wrong answer.",
    })
    assert r.status_code == 200, r.text

    # Stored server-side, for future recruiter-facing use.
    stored = fake_store.sessions.docs[sid]
    interviewer_turns = [t for t in stored["transcript"] if t.get("role") == "interviewer"]
    assert any(t.get("answerQuality") == "incorrect" for t in interviewer_turns)

    # But never present in what the candidate's own client receives.
    body = r.json()
    for turn in body["transcript"]:
        assert "answerQuality" not in turn

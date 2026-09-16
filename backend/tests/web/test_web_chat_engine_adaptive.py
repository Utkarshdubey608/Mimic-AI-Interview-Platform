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


def _seed(
    fake_store,
    *,
    adaptive: dict | None = None,
    current_index: int = 0,
    follow_ups: int = 0,
    planned_count: int = 5,
    follow_ups_used: int = 0,
) -> str:
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
                "followUpsUsed": follow_ups_used,
                "plannedQuestionCount": planned_count,
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


# ── never falsely praise a non-answer (the reported bug) ──────────────────────


def test_no_answer_with_an_empty_model_acknowledgment_is_never_praised(fake_store, monkeypatch) -> None:
    """The exact reported bug: candidate says "let me think about it," the
    model correctly judges no_answer but (as it did live) leaves the
    acknowledgment blank. The old fallback substituted an always-positive
    MOTIVATIONS phrase — e.g. "Awesome, I really appreciate the detail!" —
    with zero regard for the judgment. It must now pick a neutral one."""
    sid = _seed(fake_store)
    _stub_gemini(monkeypatch, {
        "answerQuality": "no_answer", "acknowledgment": "",
        "message": "Describe a difficult bug you tracked down.", "action": "next_question",
    })

    r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-question-1", "answerText": "let me think about it",
    })
    assert r.status_code == 200, r.text

    stored = fake_store.sessions.docs[sid]
    ack_turns = [t for t in stored["transcript"] if t.get("turnType") == "acknowledgment"]
    assert ack_turns, "an acknowledgment turn should still be recorded"
    ack_text = ack_turns[0]["content"]
    assert ack_text in chat_engine.NEUTRAL_ACKS
    assert ack_text not in chat_engine.WARM_ACKS
    assert "appreciate the detail" not in ack_text.lower()


def test_a_praise_coded_acknowledgment_is_replaced_for_a_non_sufficient_answer(fake_store, monkeypatch) -> None:
    """Even if the model itself violates its own tone instruction and writes
    enthusiastic praise for a bad answer, the pipeline must catch it — this is
    the backstop `normalise_decision` adds, not a change to how the answer
    itself is evaluated."""
    sid = _seed(fake_store)
    _stub_gemini(monkeypatch, {
        "answerQuality": "incorrect", "acknowledgment": "Great answer, that's brilliant!",
        "message": "Let's look at that from another angle.", "action": "next_question",
    })

    r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-question-1", "answerText": "A confidently wrong answer.",
    })
    assert r.status_code == 200, r.text

    stored = fake_store.sessions.docs[sid]
    ack_turns = [t for t in stored["transcript"] if t.get("turnType") == "acknowledgment"]
    assert ack_turns
    ack_text = ack_turns[0]["content"]
    assert ack_text != "Great answer, that's brilliant!"
    assert ack_text in chat_engine.NEUTRAL_ACKS


def test_gemini_unreachable_fallback_never_praises(fake_store, monkeypatch) -> None:
    """Section 23's requirement: an AI failure must not be silently treated as
    a good answer. The transport-fallback acknowledgment must be neutral, not
    a WARM_ACKS phrase, even though it carries no real quality judgment."""
    sid = _seed(fake_store)

    async def _false(*_args, **_kwargs):
        return False

    monkeypatch.setattr(gemini, "is_enabled", _false)

    r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-question-1", "answerText": "An answer while Gemini is down.",
    })
    assert r.status_code == 200, r.text

    stored = fake_store.sessions.docs[sid]
    ack_turns = [t for t in stored["transcript"] if t.get("turnType") == "acknowledgment"]
    assert ack_turns
    assert ack_turns[0]["content"] in chat_engine.NEUTRAL_ACKS


def test_a_first_no_answer_gets_one_patient_chance_then_a_repeat_moves_on(fake_store, monkeypatch) -> None:
    """The master prompt's own worked example: "let me think about it" should
    not jump straight to an unrelated next question — it should get one
    patient invitation to still answer. Only a SECOND non-answer (or an
    exhausted budget) should move the interview on."""
    sid = _seed(fake_store, adaptive={"allowFollowUps": True, "maxFollowUpsPerQuestion": 1}, follow_ups=0)
    client = _client(CANDIDATE)

    _stub_gemini(monkeypatch, {
        "answerQuality": "no_answer", "acknowledgment": "",
        "message": "Take your time — when you're ready, walk me through it.",
        "action": "follow_up",
    })
    first = client.post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-question-1", "answerText": "let me think about it",
    })
    assert first.status_code == 200, first.text
    stored = fake_store.sessions.docs[sid]
    assert stored["followUpsThisQuestion"] == 1  # granted, not clamped
    assert stored["followUpsUsed"] == 1
    assert stored["currentIndex"] == 0  # still the same primary question
    next_turn_id = first.json()["currentTurnId"]

    # Budget for this question is now exhausted — even if the model asks for
    # another follow-up, the clamp must move on.
    _stub_gemini(monkeypatch, {
        "answerQuality": "no_answer", "acknowledgment": "",
        "message": "Let's move to the next question.", "action": "follow_up",
    })
    second = client.post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": next_turn_id, "answerText": "I actually don't know.",
    })
    assert second.status_code == 200, second.text
    stored = fake_store.sessions.docs[sid]
    assert stored["currentIndex"] == 1  # moved on
    assert stored["followUpsThisQuestion"] == 0  # reset for the new question


# ── the whole-interview follow-up budget ───────────────────────────────────────


def test_global_follow_up_budget_formula() -> None:
    """clamp(floor(planned / 4), 1, 3) — small interviews still get one
    follow-up to spend; long ones are capped at 3 regardless of length."""
    assert chat_engine.global_follow_up_budget(3) == 1
    assert chat_engine.global_follow_up_budget(5) == 1
    assert chat_engine.global_follow_up_budget(8) == 2
    assert chat_engine.global_follow_up_budget(12) == 3
    assert chat_engine.global_follow_up_budget(20) == 3


def test_the_global_budget_binds_even_when_the_per_question_budget_allows_more(fake_store, monkeypatch) -> None:
    """A 3-question interview has a global budget of 1 (see the formula test).
    This question's OWN counter is still 0 (per-question budget would allow a
    follow-up), but the interview has already spent its one global follow-up
    on an earlier question — the model's request must still be clamped."""
    sid = _seed(
        fake_store,
        adaptive={"allowFollowUps": True, "maxFollowUpsPerQuestion": 1},
        follow_ups=0,
        planned_count=3,
        follow_ups_used=1,
    )
    _stub_gemini(monkeypatch, {
        "answerQuality": "weak", "acknowledgment": "Thanks for that.",
        "message": "Can you say more?", "action": "follow_up",
    })

    r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/chat/answer", json={
        "turnId": "turn-question-1", "answerText": "A vague answer.",
    })
    assert r.status_code == 200, r.text

    stored = fake_store.sessions.docs[sid]
    assert stored["currentIndex"] == 1  # clamped to next_question, not follow_up
    assert stored["followUpsUsed"] == 1  # unchanged — no follow-up was actually granted

"""The interview session engine.

The candidate-facing surface, so the weight is on two things: what a candidate can see
(only their current question, never a score, never anyone else's session), and that the
clock is settled before every request is judged.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser
from app.web.services import timing

CANDIDATE = AuthedUser(uid="uid-cand", email="ada@example.test", claims={})
OTHER = AuthedUser(uid="uid-other", email="mallory@example.test", claims={})

T0 = 1_800_000_000_000
SECOND = 1000


def _template(**overrides) -> dict:
    return {
        "id": "t1",
        "name": "Backend screen",
        "role": "Backend",
        "track": "chat",
        "questionSource": "fixed",
        "timing": {
            "prepSeconds": 30,
            "answerSeconds": 120,
            "allowSkipPrep": True,
            "allowEarlySubmit": True,
            "warningThresholdSeconds": 15,
        },
        "rubric": {"kpis": [{"id": "depth", "label": "Depth", "enabled": True, "weight": 1}]},
        "integrity": {"logEvents": True, "maxTabSwitchWarnings": 3},
        "branding": {"companyName": "Acme"},
        **overrides,
    }


def _question(index: int, **overrides) -> dict:
    return {"id": f"q{index}", "text": f"Question {index}", "autoSubmitted": False, **overrides}


def _session(count: int = 2, **overrides) -> dict:
    return {
        "id": "s1",
        "templateId": "t1",
        "recruiterId": "uid-recruiter",
        "track": "chat",
        "candidate": {"name": "Ada", "email": "ada@example.test"},
        "status": "created",
        "questions": [_question(i) for i in range(count)],
        "currentIndex": 0,
        "createdAt": "2027-01-01T00:00:00+00:00",
        "integrityEvents": [],
        "tabSwitchCount": 0,
        **overrides,
    }


@pytest.fixture
def seeded(fake_store):
    fake_store.templates.docs["t1"] = _template()
    fake_store.sessions.docs["s1"] = _session()
    return fake_store


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


# ── access ────────────────────────────────────────────────────────────────────


def test_the_assigned_candidate_may_open_their_session(seeded) -> None:
    assert _client(CANDIDATE).get("/api/web/sessions/s1/state").status_code == 200


def test_the_owning_recruiter_may_open_it_too(authed_client: TestClient, seeded) -> None:
    """So a recruiter can preview their own interview end to end."""
    assert authed_client.get("/api/web/sessions/s1/state").status_code == 200


def test_anyone_else_gets_a_404_not_a_403(seeded) -> None:
    """404 so the response never reveals that a session they cannot see exists."""
    response = _client(OTHER).get("/api/web/sessions/s1/state")
    assert response.status_code == 404
    assert response.json()["error"] == "Session not found"


def test_assignment_is_matched_case_insensitively(seeded) -> None:
    seeded.sessions.docs["s1"]["candidate"]["email"] = "ADA@EXAMPLE.TEST"
    assert _client(CANDIDATE).get("/api/web/sessions/s1/state").status_code == 200


def test_a_session_whose_template_is_gone_cannot_run(seeded) -> None:
    """Its questions, timing and rubric all live there."""
    del seeded.templates.docs["t1"]
    response = _client(CANDIDATE).get("/api/web/sessions/s1/state")
    assert response.status_code == 404
    assert "Template" in response.json()["error"]


def test_sessions_require_a_token() -> None:
    assert TestClient(create_app()).get("/api/web/sessions/s1/state").status_code == 401


# ── the candidate's view ──────────────────────────────────────────────────────


def test_the_state_never_carries_future_questions(seeded) -> None:
    """The stored session holds every question and its ideal-answer notes; returning it
    would hand the candidate the rest of their own interview."""
    seeded.sessions.docs["s1"] = _session(
        3,
        status="in_progress",
        questions=[
            _question(0, prepStartedAt=timing.to_iso(T0)),
            _question(1, idealAnswerNotes="what a strong answer covers"),
            _question(2),
        ],
    )
    body = _client(CANDIDATE).get("/api/web/sessions/s1/state").json()

    assert body["question"]["id"] == "q0"
    assert "Question 1" not in str(body)
    assert "idealAnswerNotes" not in str(body)


def test_a_candidate_never_sees_a_report(seeded) -> None:
    seeded.reports.docs["s1"] = {"sessionId": "s1", "overallScore": 88}
    assert _client(CANDIDATE).get("/api/web/sessions/s1/report").status_code == 404


def test_the_owning_recruiter_sees_the_report(authed_client: TestClient, seeded) -> None:
    seeded.reports.docs["s1"] = {"sessionId": "s1", "overallScore": 88, "perQuestion": []}
    body = authed_client.get("/api/web/sessions/s1/report").json()
    assert body["report"]["overallScore"] == 88
    assert body["session"]["templateName"] == "Backend screen"
    assert body["rubric"]["kpis"][0]["id"] == "depth"


# ── the entry screen ──────────────────────────────────────────────────────────


def test_a_track_can_be_chosen_before_the_interview_starts(seeded) -> None:
    body = _client(CANDIDATE).post("/api/web/sessions/s1/track", json={"track": "voice"}).json()
    assert body["track"] == "voice"
    assert seeded.sessions.docs["s1"]["track"] == "voice"


def test_the_track_cannot_change_mid_interview(seeded) -> None:
    """Switching would strand the answers already given in a shape the new track cannot
    read."""
    seeded.sessions.docs["s1"]["status"] = "in_progress"
    response = _client(CANDIDATE).post("/api/web/sessions/s1/track", json={"track": "voice"})
    assert response.status_code == 409


def test_an_unknown_track_is_refused(seeded) -> None:
    response = _client(CANDIDATE).post("/api/web/sessions/s1/track", json={"track": "telepathy"})
    assert response.status_code == 400


def test_the_system_check_advances_only_from_created(seeded) -> None:
    _client(CANDIDATE).post("/api/web/sessions/s1/system-check")
    assert seeded.sessions.docs["s1"]["status"] == "system_check"

    seeded.sessions.docs["s1"]["status"] = "in_progress"
    _client(CANDIDATE).post("/api/web/sessions/s1/system-check")
    assert seeded.sessions.docs["s1"]["status"] == "in_progress"


# ── beginning ─────────────────────────────────────────────────────────────────


def test_beginning_starts_the_first_prep_phase(seeded) -> None:
    body = _client(CANDIDATE).post("/api/web/sessions/s1/begin").json()

    stored = seeded.sessions.docs["s1"]
    assert stored["status"] == "in_progress"
    assert stored["startedAt"]
    assert stored["questions"][0]["prepStartedAt"]
    assert body["phase"] == "prep"


def test_beginning_twice_does_not_restart_the_clock(seeded) -> None:
    """A double-tap must not reset a clock the candidate is already answering against."""
    client = _client(CANDIDATE)
    client.post("/api/web/sessions/s1/begin")
    first = seeded.sessions.docs["s1"]["questions"][0]["prepStartedAt"]

    client.post("/api/web/sessions/s1/begin")
    assert seeded.sessions.docs["s1"]["questions"][0]["prepStartedAt"] == first


def test_a_finished_interview_cannot_be_restarted(seeded) -> None:
    seeded.sessions.docs["s1"]["status"] = "completed"
    response = _client(CANDIDATE).post("/api/web/sessions/s1/begin")
    assert response.status_code == 409


def test_an_adaptive_interview_needs_a_resume_first(seeded) -> None:
    seeded.templates.docs["t1"] = _template(questionSource="adaptive")
    seeded.sessions.docs["s1"] = _session(0)

    response = _client(CANDIDATE).post("/api/web/sessions/s1/begin")
    assert response.status_code == 400
    assert "résumé is required" in response.json()["error"]


def test_an_interview_with_no_questions_refuses_to_start(seeded) -> None:
    seeded.sessions.docs["s1"] = _session(0)
    response = _client(CANDIDATE).post("/api/web/sessions/s1/begin")
    assert response.status_code == 400


# ── when the question plan is built ───────────────────────────────────────────
#
# A production session pressed Begin and waited 26.5 seconds on a warm instance,
# because /begin was where the model call happened. These pin the plan to the
# résumé upload — the one step where the candidate is already told to wait.


def _adaptive(seeded) -> None:
    seeded.templates.docs["t1"] = _template(questionSource="adaptive")
    seeded.sessions.docs["s1"] = _session(0)


def _upload(client: TestClient):
    return client.post(
        "/api/web/sessions/s1/resume",
        files={"resume": ("cv.txt", b"Ada Lovelace. Ten years of Python and Kafka.", "text/plain")},
        data={"fullName": "Ada Lovelace"},
    )


@pytest.fixture
def generated(monkeypatch):
    """Stands in for the Gemini call, and counts how often it is made."""
    from app.web.services import question_gen

    calls: list[str] = []

    async def _generate(settings, *, resume_text: str, **kwargs) -> list[dict]:
        calls.append(resume_text)
        return [
            {"text": "Tell me about your Kafka work.", "category": "Experience", "idealAnswerNotes": "n"},
            {"text": "How do you test async code?", "category": "Technical", "idealAnswerNotes": "n"},
        ]

    monkeypatch.setattr(question_gen, "generate_from_resume_text", _generate)
    return calls


def test_uploading_a_resume_builds_the_question_plan(seeded, generated) -> None:
    _adaptive(seeded)

    assert _upload(_client(CANDIDATE)).status_code == 200

    questions = seeded.sessions.docs["s1"]["questions"]
    assert [q["text"] for q in questions] == [
        "Tell me about your Kafka work.",
        "How do you test async code?",
    ]
    assert len(generated) == 1, "the résumé upload should generate exactly once"


def test_begin_makes_no_model_call_once_the_plan_exists(seeded, generated) -> None:
    """The whole point: pressing Begin is a database write, not a model call."""
    _adaptive(seeded)
    _upload(_client(CANDIDATE))
    assert len(generated) == 1

    response = _client(CANDIDATE).post("/api/web/sessions/s1/begin")

    assert response.status_code == 200
    assert response.json()["status"] == "in_progress"
    assert len(generated) == 1, "/begin must not generate again — the plan is already stored"


def test_begin_still_generates_for_a_session_that_never_got_a_plan(seeded, generated) -> None:
    """The fallback path, for résumés uploaded before the plan moved upstream."""
    _adaptive(seeded)
    seeded.sessions.docs["s1"]["resumeText"] = "Ada Lovelace. Ten years of Python."

    response = _client(CANDIDATE).post("/api/web/sessions/s1/begin")

    assert response.status_code == 200
    assert len(generated) == 1, "no stored plan, so /begin has to build one"


def test_a_fixed_question_set_is_never_sent_to_the_model(seeded, generated) -> None:
    """A recruiter's own question set is the plan; there is nothing to generate."""
    seeded.templates.docs["t1"] = _template(questionSource="fixed")
    seeded.sessions.docs["s1"] = _session(2)
    seeded.sessions.docs["s1"]["track"] = "video_avatar"

    assert _upload(_client(CANDIDATE)).status_code == 200
    assert generated == []


# ── answering ─────────────────────────────────────────────────────────────────


def _in_answer_phase(store, at_ms: int = T0) -> None:
    store.sessions.docs["s1"] = _session(
        2,
        status="in_progress",
        startedAt=timing.to_iso(at_ms),
        questions=[
            _question(
                0,
                prepStartedAt=timing.to_iso(at_ms - 30 * SECOND),
                answerStartedAt=timing.to_iso(at_ms),
            ),
            _question(1),
        ],
    )


def test_an_answer_is_locked_and_the_next_question_starts(seeded) -> None:
    _in_answer_phase(seeded)
    body = _client(CANDIDATE).post(
        "/api/web/sessions/s1/answers", json={"questionId": "q0", "answerText": "My answer"}
    ).json()

    stored = seeded.sessions.docs["s1"]
    assert stored["questions"][0]["answerText"] == "My answer"
    assert stored["questions"][0]["submittedAt"]
    assert stored["questions"][0]["autoSubmitted"] is False
    assert stored["currentIndex"] == 1
    assert stored["questions"][1]["prepStartedAt"]
    assert body["question"]["id"] == "q1"


def test_submitting_the_wrong_question_is_refused(seeded) -> None:
    """The clock may have moved on while they were typing."""
    _in_answer_phase(seeded)
    response = _client(CANDIDATE).post(
        "/api/web/sessions/s1/answers", json={"questionId": "q1", "answerText": "x"}
    )
    assert response.status_code == 409
    assert response.json()["error"] == "Not the current question"
    # The current state comes back so the client can resynchronise.
    assert response.json()["state"]["question"]["id"] == "q0"


def test_submitting_during_preparation_is_refused(seeded) -> None:
    seeded.sessions.docs["s1"] = _session(
        2,
        status="in_progress",
        questions=[_question(0, prepStartedAt=timing.to_iso(T0)), _question(1)],
    )
    response = _client(CANDIDATE).post(
        "/api/web/sessions/s1/answers", json={"questionId": "q0", "answerText": "x"}
    )
    assert response.status_code == 400
    assert "during preparation" in response.json()["error"]


def test_the_draft_is_used_when_no_answer_text_is_sent(seeded) -> None:
    _in_answer_phase(seeded)
    seeded.sessions.docs["s1"]["questions"][0]["draft"] = "typed but not sent"

    _client(CANDIDATE).post("/api/web/sessions/s1/answers", json={"questionId": "q0"})
    assert seeded.sessions.docs["s1"]["questions"][0]["answerText"] == "typed but not sent"


def test_the_last_answer_completes_the_session(seeded) -> None:
    seeded.sessions.docs["s1"] = _session(
        1,
        status="in_progress",
        questions=[
            _question(
                0,
                prepStartedAt=timing.to_iso(T0 - 30 * SECOND),
                answerStartedAt=timing.to_iso(T0),
            )
        ],
    )
    _client(CANDIDATE).post("/api/web/sessions/s1/answers", json={"questionId": "q0", "answerText": "x"})

    stored = seeded.sessions.docs["s1"]
    assert stored["status"] == "completed"
    assert stored["completedAt"]


def test_early_submission_can_be_disabled(seeded) -> None:
    seeded.templates.docs["t1"] = _template(
        timing={**_template()["timing"], "allowEarlySubmit": False}
    )
    _in_answer_phase(seeded, at_ms=timing.now_ms())

    response = _client(CANDIDATE).post(
        "/api/web/sessions/s1/answers", json={"questionId": "q0", "answerText": "x"}
    )
    assert response.status_code == 403


# ── drafts ────────────────────────────────────────────────────────────────────


def test_a_draft_is_saved(seeded) -> None:
    _in_answer_phase(seeded)
    response = _client(CANDIDATE).post(
        "/api/web/sessions/s1/draft", json={"questionId": "q0", "draft": "half an answer"}
    )
    assert response.status_code == 200
    assert seeded.sessions.docs["s1"]["questions"][0]["draft"] == "half an answer"


def test_a_stale_draft_is_refused_rather_than_misfiled(seeded) -> None:
    """Writing it onto whatever question is current now would attach an answer to the
    wrong question."""
    _in_answer_phase(seeded)
    response = _client(CANDIDATE).post(
        "/api/web/sessions/s1/draft", json={"questionId": "q1", "draft": "x"}
    )
    assert response.status_code == 409
    assert seeded.sessions.docs["s1"]["questions"][1].get("draft") is None


# ── skipping preparation ──────────────────────────────────────────────────────


def test_preparation_can_be_skipped_when_allowed(seeded) -> None:
    seeded.sessions.docs["s1"] = _session(
        2,
        status="in_progress",
        questions=[_question(0, prepStartedAt=timing.to_iso(timing.now_ms())), _question(1)],
    )
    body = _client(CANDIDATE).post("/api/web/sessions/s1/skip-prep").json()
    assert body["phase"] == "answer"


def test_skipping_is_refused_when_disabled(seeded) -> None:
    seeded.templates.docs["t1"] = _template(
        timing={**_template()["timing"], "allowSkipPrep": False}
    )
    seeded.sessions.docs["s1"] = _session(
        2, status="in_progress", questions=[_question(0, prepStartedAt=timing.to_iso(T0)), _question(1)]
    )
    assert _client(CANDIDATE).post("/api/web/sessions/s1/skip-prep").status_code == 403


def test_skipping_outside_a_prep_phase_is_refused(seeded) -> None:
    _in_answer_phase(seeded)
    assert _client(CANDIDATE).post("/api/web/sessions/s1/skip-prep").status_code == 409


# ── the clock is settled on every request ─────────────────────────────────────


def test_an_elapsed_deadline_is_applied_even_without_polling(seeded) -> None:
    """A client cannot dodge a deadline by not asking — the next request it makes
    settles first."""
    long_ago = timing.now_ms() - 3600 * SECOND
    seeded.sessions.docs["s1"] = _session(
        1,
        status="in_progress",
        startedAt=timing.to_iso(long_ago),
        questions=[
            _question(
                0,
                prepStartedAt=timing.to_iso(long_ago - 30 * SECOND),
                answerStartedAt=timing.to_iso(long_ago),
                draft="what they had typed",
            )
        ],
    )

    body = _client(CANDIDATE).get("/api/web/sessions/s1/state").json()

    stored = seeded.sessions.docs["s1"]
    assert stored["status"] == "completed"
    # The draft was promoted, not discarded — they answered.
    assert stored["questions"][0]["answerText"] == "what they had typed"
    assert stored["questions"][0]["autoSubmitted"] is True
    assert body["status"] == "completed"


# ── completion ────────────────────────────────────────────────────────────────


def test_completing_early_keeps_the_unsent_draft(seeded) -> None:
    """Someone who typed an answer and closed the tab has answered."""
    _in_answer_phase(seeded)
    seeded.sessions.docs["s1"]["questions"][0]["draft"] = "partial thoughts"

    _client(CANDIDATE).post("/api/web/sessions/s1/complete")

    stored = seeded.sessions.docs["s1"]
    assert stored["status"] == "completed"
    assert stored["questions"][0]["answerText"] == "partial thoughts"
    assert stored["questions"][0]["autoSubmitted"] is True


def test_completing_a_finished_session_is_harmless(seeded) -> None:
    seeded.sessions.docs["s1"]["status"] = "completed"
    assert _client(CANDIDATE).post("/api/web/sessions/s1/complete").status_code == 200


# ── integrity ─────────────────────────────────────────────────────────────────


def test_a_tab_switch_is_counted_and_the_limit_returned(seeded) -> None:
    """The count comes back with the recruiter's maximum so the client can warn the
    candidate before it matters — the point is deterrence, not a silent tally."""
    body = _client(CANDIDATE).post(
        "/api/web/sessions/s1/integrity-event", json={"type": "tab_switch"}
    ).json()

    assert body == {"ok": True, "tabSwitchWarnings": 1, "maxTabSwitchWarnings": 3}
    assert seeded.sessions.docs["s1"]["integrityEvents"][0]["type"] == "tab_switch"


def test_only_attention_events_increment_the_warning_count(seeded) -> None:
    client = _client(CANDIDATE)
    client.post("/api/web/sessions/s1/integrity-event", json={"type": "blocked_paste"})
    body = client.post(
        "/api/web/sessions/s1/integrity-event", json={"type": "window_blur"}
    ).json()

    assert body["tabSwitchWarnings"] == 1
    assert len(seeded.sessions.docs["s1"]["integrityEvents"]) == 2


def test_logging_can_be_switched_off(seeded) -> None:
    seeded.templates.docs["t1"] = _template(integrity={"logEvents": False})
    body = _client(CANDIDATE).post(
        "/api/web/sessions/s1/integrity-event", json={"type": "tab_switch"}
    ).json()

    assert body == {"ok": True, "ignored": True}
    assert seeded.sessions.docs["s1"]["integrityEvents"] == []


# ── facial analysis ───────────────────────────────────────────────────────────


def test_facial_routes_are_video_track_only(seeded) -> None:
    client = _client(CANDIDATE)
    for path, payload in [
        ("/api/web/sessions/s1/facial-frame", {"imageBase64": "A" * 9000}),
        ("/api/web/sessions/s1/facial", {"summary": {"perQuestion": []}}),
    ]:
        assert client.post(path, json=payload).status_code == 400


def test_a_tiny_frame_is_skipped_without_an_api_call(seeded) -> None:
    seeded.sessions.docs["s1"]["track"] = "video"
    body = _client(CANDIDATE).post(
        "/api/web/sessions/s1/facial-frame",
        json={"imageBase64": "A" * 100, "questionIdx": 1, "timestampMs": 99},
    ).json()

    assert body == {
        "success": False,
        "reason": "frame_too_small",
        "questionIdx": 1,
        "timestampMs": 99,
    }


def test_a_facial_summary_is_stored_when_shaped_correctly(seeded) -> None:
    seeded.sessions.docs["s1"]["track"] = "video"
    client = _client(CANDIDATE)

    assert client.post(
        "/api/web/sessions/s1/facial", json={"summary": {"perQuestion": [{"a": 1}]}}
    ).json() == {"ok": True}
    assert seeded.sessions.docs["s1"]["facialSummary"]["perQuestion"] == [{"a": 1}]

    assert client.post("/api/web/sessions/s1/facial", json={"summary": "nope"}).json() == {
        "ok": False
    }


# ── the video track mirrors its answers into a transcript ─────────────────────


def test_a_video_answer_becomes_transcript_turns(seeded) -> None:
    """The live transcript IS the answer — mirroring it lets scoring and the results view
    run the same conversation path as Voice."""
    seeded.sessions.docs["s1"] = _session(
        1,
        track="video",
        status="in_progress",
        questions=[
            _question(
                0,
                prepStartedAt=timing.to_iso(T0 - 30 * SECOND),
                answerStartedAt=timing.to_iso(T0),
            )
        ],
    )
    _client(CANDIDATE).post(
        "/api/web/sessions/s1/answers", json={"questionId": "q0", "answerText": "spoken words"}
    )

    transcript = seeded.sessions.docs["s1"]["transcript"]
    assert [t["role"] for t in transcript] == ["interviewer", "candidate"]
    assert transcript[1]["content"] == "spoken words"
    assert seeded.sessions.docs["s1"]["mode"] == "conversational"


# ── recruiter and candidate lists ─────────────────────────────────────────────


def test_the_recruiter_list_is_owner_scoped(authed_client: TestClient, seeded) -> None:
    seeded.sessions.docs["theirs"] = _session(recruiterId="uid-other", id="theirs")
    listed = authed_client.get("/api/web/sessions").json()
    assert [s["id"] for s in listed] == ["s1"]


def test_the_recruiter_list_carries_the_score(authed_client: TestClient, seeded) -> None:
    seeded.reports.docs["s1"] = {"sessionId": "s1", "overallScore": 91}
    assert authed_client.get("/api/web/sessions").json()[0]["overallScore"] == 91


def test_a_deleted_template_is_named_in_the_list(authed_client: TestClient, seeded) -> None:
    del seeded.templates.docs["t1"]
    assert authed_client.get("/api/web/sessions").json()[0]["templateName"] == "(deleted template)"


def test_mine_is_scoped_to_the_verified_email(seeded) -> None:
    seeded.sessions.docs["theirs"] = {
        **_session(id="theirs"),
        "id": "theirs",
        "candidate": {"email": "someone@else.test"},
    }
    listed = _client(CANDIDATE).get("/api/web/sessions/mine").json()
    assert [s["id"] for s in listed] == ["s1"]


def test_mine_never_carries_a_score(seeded) -> None:
    seeded.reports.docs["s1"] = {"sessionId": "s1", "overallScore": 91}
    body = _client(CANDIDATE).get("/api/web/sessions/mine").json()
    assert "overallScore" not in body[0]
    assert "91" not in str(body)


def test_mine_is_empty_for_an_account_with_no_email() -> None:
    """An empty array reveals nothing about sessions assigned to anyone else."""
    client = _client(AuthedUser(uid="u", email=None, claims={}))
    assert client.get("/api/web/sessions/mine").json() == []


def test_mine_is_not_read_as_a_session_id(seeded) -> None:
    """The literal route must win over `/{session_id}`."""
    assert _client(CANDIDATE).get("/api/web/sessions/mine").status_code == 200


# ── creation ──────────────────────────────────────────────────────────────────


def test_a_session_is_created_from_a_template(authed_client: TestClient, fake_store) -> None:
    fake_store.templates.docs["t1"] = _template(questionSource="fixed", fixedQuestionSetId="qs1")
    fake_store.question_sets.docs["qs1"] = {
        "id": "qs1",
        "questions": [{"id": "orig", "text": "Why us?", "category": "Motivation"}],
    }

    body = authed_client.post(
        "/api/web/sessions",
        json={"templateId": "t1", "candidate": {"email": "Ada@Example.test", "name": "Ada"}},
    ).json()

    stored = fake_store.sessions.docs[body["id"]]
    assert stored["recruiterId"] == "uid-recruiter"
    assert stored["candidate"]["email"] == "ada@example.test"
    # Fresh ids: editing the set later must not reach back into a finished interview.
    assert stored["questions"][0]["id"] != "orig"
    assert stored["questions"][0]["text"] == "Why us?"


def test_a_candidate_email_is_required(authed_client: TestClient, fake_store) -> None:
    """It IS the access control — without one the session could never be opened."""
    fake_store.templates.docs["t1"] = _template()
    response = authed_client.post("/api/web/sessions", json={"templateId": "t1"})
    assert response.status_code == 400
    assert "candidate email is required" in response.json()["error"]


def test_an_unknown_template_is_refused(authed_client: TestClient) -> None:
    response = authed_client.post(
        "/api/web/sessions", json={"templateId": "nope", "candidate": {"email": "a@x.test"}}
    )
    assert response.status_code == 400


def test_an_empty_question_set_is_refused(authed_client: TestClient, fake_store) -> None:
    fake_store.templates.docs["t1"] = _template(fixedQuestionSetId="qs1")
    fake_store.question_sets.docs["qs1"] = {"id": "qs1", "questions": []}

    response = authed_client.post(
        "/api/web/sessions", json={"templateId": "t1", "candidate": {"email": "a@x.test"}}
    )
    assert response.status_code == 400
    assert "empty or missing question set" in response.json()["error"]

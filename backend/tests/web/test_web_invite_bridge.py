"""Materialising a Firestore invite into a local session.

Two models meet here, so the tests are about the seams: the frozen `interviews` schema
going in, the template-driven engine coming out, and the access check in between — which
is the one place on this surface that answers 403 rather than 404, deliberately.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from app import interviews as app_interviews
from app.config import Settings
from app.security import AuthedUser
from app.web.services import invite_bridge

NOW = "2027-01-15T12:00:00+00:00"
CANDIDATE = AuthedUser(uid="uid-cand", email="ada@example.test", claims={})


def _invite(**overrides) -> dict:
    return {
        "recruiterId": "uid-recruiter",
        "candidateEmail": "Ada@Example.test",
        "candidateEmailLower": "ada@example.test",
        "candidateName": None,
        "role": "Backend Engineer",
        "mode": "chat",
        "type": "chat",
        "questions": [],
        "status": "assigned",
        "screening": {"source": "tailor"},
        **overrides,
    }


# ── track resolution ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("mode", ["chatbot", "voice", "video_avatar", "chat", "video", "two_way"])
def test_the_precise_mode_wins(mode: str) -> None:
    assert invite_bridge.track_for(_invite(mode=mode)) == mode


def test_an_invite_from_the_mobile_app_falls_back_to_its_type() -> None:
    """A mobile-created invite has no `mode`; `type` only distinguishes video from chat.

    It degrades to the SAME track, never a richer one. This asserted `video_avatar`
    until the mismap was fixed — which meant a recruiter's recorded video interview
    silently became a Tavus avatar conversation the moment the candidate opened it in a
    browser: a different experience, vendor and cost from the one configured.
    """
    assert invite_bridge.track_for({"type": "video"}) == "video"
    assert invite_bridge.track_for({"type": "chat"}) == "chat"
    assert invite_bridge.track_for({}) == "chat"


def test_an_unrecognised_mode_falls_back_rather_than_passing_through() -> None:
    assert invite_bridge.track_for({"mode": "telepathy", "type": "video"}) == "video"


# ── template synthesis ────────────────────────────────────────────────────────


def _template(**invite_overrides) -> dict:
    return invite_bridge.synthesise_template("i1", _invite(**invite_overrides), NOW)


def test_the_template_is_namespaced_to_the_interview() -> None:
    """So it cannot collide with a recruiter's authored template, and it is obvious in the
    store that it was generated."""
    assert _template()["id"] == "invite:i1"
    assert invite_bridge.template_id_for("abc") == "invite:abc"


def test_a_saved_question_set_produces_a_fixed_template() -> None:
    template = _template(screening={"source": "set"}, questions=["Q one", "Q two"])
    assert template["questionSource"] == "fixed"
    assert template["timing"]["numberOfQuestions"] == 2
    assert "adaptive" not in template


def test_a_tailored_invite_produces_an_adaptive_template() -> None:
    template = _template(screening={"source": "tailor", "techCount": 4, "nonTechCount": 2})
    assert template["questionSource"] == "adaptive"
    assert template["adaptive"]["technicalCount"] == 4
    assert template["timing"]["numberOfQuestions"] == 6


def test_a_two_way_invite_is_never_adaptive() -> None:
    """It carries no `screening.source`, which would fall through to adaptive and gate the
    candidate behind a résumé upload before they could reach the live room."""
    template = _template(mode="two_way", screening={})
    assert template["questionSource"] == "fixed"
    assert "adaptive" not in template


def test_a_fixed_template_always_claims_at_least_one_question() -> None:
    """Zero would make the progress display divide by nothing."""
    template = _template(mode="two_way", screening={}, questions=[])
    assert template["timing"]["numberOfQuestions"] == 1


def test_the_adaptive_count_is_bounded() -> None:
    template = _template(screening={"source": "tailor", "techCount": 900, "nonTechCount": 900})
    assert template["timing"]["numberOfQuestions"] == invite_bridge.MAX_QUESTION_COUNT


def test_zero_counts_fall_back_to_a_default() -> None:
    template = _template(screening={"source": "tailor", "techCount": 0, "nonTechCount": 0})
    assert template["timing"]["numberOfQuestions"] == invite_bridge.DEFAULT_QUESTION_COUNT


def test_non_numeric_counts_fall_back() -> None:
    template = _template(screening={"source": "tailor", "techCount": "lots"})
    assert template["adaptive"]["technicalCount"] == 3


def test_follow_ups_are_off_for_an_invite() -> None:
    """`numberOfQuestions` is the length the candidate was told; follow-ups would extend
    it silently."""
    assert _template()["adaptive"]["allowFollowUps"] is False


def test_focus_topics_come_from_the_screening_domains() -> None:
    template = _template(screening={"source": "tailor", "domains": ["Kafka", "React"]})
    assert template["adaptive"]["focusTopics"] == ["Kafka", "React"]


def test_a_non_list_domains_becomes_empty() -> None:
    template = _template(screening={"source": "tailor", "domains": "Kafka"})
    assert template["adaptive"]["focusTopics"] == []


def test_a_voice_invite_gets_a_voice_config() -> None:
    assert "voice" in _template(mode="voice")
    assert "voice" not in _template(mode="chat")


def test_the_template_carries_the_product_defaults() -> None:
    from app.web.store import defaults

    template = _template()
    assert template["rubric"] == defaults.default_rubric()
    assert template["integrity"] == defaults.DEFAULT_INTEGRITY
    assert template["branding"] == defaults.DEFAULT_BRANDING


def test_a_missing_role_gets_a_readable_placeholder() -> None:
    """It appears in the template name and in generated question prompts."""
    template = invite_bridge.synthesise_template("i1", {"mode": "chat"}, NOW)
    assert template["role"] == "this role"
    assert template["name"] == "this role — invite"


# ── session construction ──────────────────────────────────────────────────────


def _session(**invite_overrides) -> dict:
    invite = _invite(**invite_overrides)
    template = invite_bridge.synthesise_template("i1", invite, NOW)
    return invite_bridge.build_session(
        "i1", invite, template, candidate_email="ada@example.test", now=NOW
    )


def test_the_session_id_is_the_interview_id() -> None:
    """What makes materialising idempotent across reloads and devices."""
    assert _session()["id"] == "i1"


def test_the_session_is_marked_as_invite_backed() -> None:
    """That flag is what makes the score sync back to Firestore rather than staying
    local."""
    assert _session()["viaInvite"] is True


def test_embedded_questions_become_session_questions() -> None:
    session = _session(screening={"source": "set"}, questions=["Q one", "Q two"])
    assert [q["text"] for q in session["questions"]] == ["Q one", "Q two"]
    assert all(q["id"] for q in session["questions"])
    assert all(q["autoSubmitted"] is False for q in session["questions"])


def test_blank_embedded_questions_are_dropped() -> None:
    session = _session(screening={"source": "set"}, questions=["Real", "  ", None, 42])
    assert [q["text"] for q in session["questions"]] == ["Real"]


def test_an_adaptive_session_starts_with_no_questions() -> None:
    """They are generated from the résumé after upload."""
    session = _session(screening={"source": "tailor"}, questions=["ignored"])
    assert session["questions"] == []


def test_the_candidate_name_falls_back_to_the_email() -> None:
    """The invite exists before the candidate has an account, so there is often no name."""
    assert _session()["candidate"]["name"] == "ada@example.test"
    assert _session(candidateName="Ada L")["candidate"]["name"] == "Ada L"


def test_the_session_starts_clean() -> None:
    session = _session()
    assert session["status"] == "created"
    assert session["currentIndex"] == 0
    assert session["integrityEvents"] == []
    assert session["tabSwitchCount"] == 0


def test_the_recruiter_is_carried_for_ownership() -> None:
    assert _session()["recruiterId"] == "uid-recruiter"


# ── access control ────────────────────────────────────────────────────────────


class _Snapshot:
    def __init__(self, data: dict | None) -> None:
        self.exists = data is not None
        self._data = data

    def to_dict(self) -> dict | None:
        return self._data


class _Reference:
    def __init__(self, data: dict | None) -> None:
        self._data = data
        self.updates: list[dict] = []

    def get(self) -> _Snapshot:
        return _Snapshot(self._data)

    def update(self, fields: dict) -> None:
        self.updates.append(fields)


class _Collection:
    def __init__(self, reference: _Reference) -> None:
        self._reference = reference

    def document(self, _id: str) -> _Reference:
        return self._reference


def _patch_interviews(monkeypatch, data: dict | None) -> _Reference:
    """Stand in for the shared `interviews` collection.

    Patched on `app.interviews.collection` — the single accessor everything now goes
    through — rather than on a delegate. Patching a delegate only covers the callers
    that happen to use that one, and this helper previously patched
    `interview_invite.interviews`, which is now the imported MODULE: the setattr still
    succeeded and silently stopped intercepting anything. A patch that no-ops instead
    of failing is worse than no patch, so it goes on the source.
    """
    reference = _Reference(data)
    monkeypatch.setattr(
        app_interviews, "collection", lambda _settings: _Collection(reference)
    )
    return reference


def test_a_missing_invite_is_a_404(monkeypatch, fake_store) -> None:
    _patch_interviews(monkeypatch, None)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))
    assert caught.value.status_code == 404


def test_an_invite_with_no_assignee_cannot_be_claimed(monkeypatch, fake_store) -> None:
    """A 404 rather than letting the first caller take it."""
    _patch_interviews(monkeypatch, _invite(candidateEmailLower=""))
    with pytest.raises(HTTPException) as caught:
        asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))
    assert caught.value.status_code == 404


def test_a_mismatched_signin_gets_a_403_that_names_the_address(monkeypatch, fake_store) -> None:
    """The one place this surface answers 403 rather than 404, deliberately: ids are
    unguessable and emailed, so confirming existence costs little, and a 404 would
    dead-end every candidate signed in with a second account."""
    _patch_interviews(monkeypatch, _invite(candidateEmailLower="someone@else.test"))

    with pytest.raises(HTTPException) as caught:
        asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))

    assert caught.value.status_code == 403
    assert "ada@example.test" in caught.value.detail
    assert "sign out" in caught.value.detail


def test_the_assignment_check_is_case_insensitive(monkeypatch, fake_store) -> None:
    _patch_interviews(monkeypatch, _invite(candidateEmailLower="ADA@EXAMPLE.TEST"))
    session, _ = asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))
    assert session["candidate"]["email"] == "ada@example.test"


def test_a_completed_invite_is_a_409(monkeypatch, fake_store) -> None:
    _patch_interviews(monkeypatch, _invite(status="completed"))
    with pytest.raises(HTTPException) as caught:
        asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))
    assert caught.value.status_code == 409
    assert "already been completed" in caught.value.detail


# ── the MCQ paper ─────────────────────────────────────────────────────────────
#
# `synthesise_template` puts only the SET ID on the synthesised template — right
# for the shared runtime, which resolves it fresh on every call, but nothing for
# `routes/sessions_mcq.py` to read: that route expects the paper embedded on the
# SESSION, the way `routes/sessions.py`'s own MCQ session-creation already does
# it. Materialising used to hand a candidate an interview with zero questions
# and no way to answer anything — not a slow paper, an empty one, forever.


def test_materialising_an_mcq_invite_embeds_the_real_paper(monkeypatch, fake_store) -> None:
    asyncio.run(
        fake_store.mcq_sets.put(
            {
                "id": "set-1",
                "questions": [
                    {
                        "id": "q1", "text": "2+2=?", "type": "single",
                        "options": [{"id": "a", "text": "3"}, {"id": "b", "text": "4"}],
                        "correctOptionIds": ["b"], "sectionId": "sec-1",
                    }
                ],
                "sections": [{"id": "sec-1", "name": "Arithmetic"}],
            }
        )
    )
    _patch_interviews(
        monkeypatch,
        _invite(mode="mcq", type="mcq", screening={"mcqSetId": "set-1"}),
    )

    session, template = asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))

    assert template["mcqSetId"] == "set-1"
    assert len(session["questions"]) == 1
    assert session["questions"][0]["text"] == "2+2=?"
    # A fresh id, not the set's own — editing the set later must not reach back
    # into a session someone has already started.
    assert session["questions"][0]["id"] != "q1"
    assert session["mcqSections"] == [{"id": "sec-1", "name": "Arithmetic"}]


def test_materialising_an_mcq_invite_with_a_missing_set_is_refused(monkeypatch, fake_store) -> None:
    _patch_interviews(
        monkeypatch,
        _invite(mode="mcq", type="mcq", screening={"mcqSetId": "set-does-not-exist"}),
    )
    with pytest.raises(HTTPException) as caught:
        asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))
    assert caught.value.status_code == 400
    assert "set-does-not-exist" not in caught.value.detail  # no id leaked either


def test_materialising_an_mcq_invite_with_an_unready_set_is_refused(monkeypatch, fake_store) -> None:
    """The same completeness check invite creation already ran once — a set can
    still be edited into invalidity in between, and a candidate must never sit
    a paper with a question that scores everyone zero."""
    asyncio.run(
        fake_store.mcq_sets.put(
            {
                "id": "set-1",
                "questions": [
                    {
                        "id": "q1", "text": "No correct answer marked",
                        "type": "single",
                        "options": [{"id": "a", "text": "X"}, {"id": "b", "text": "Y"}],
                        "correctOptionIds": [],
                    }
                ],
            }
        )
    )
    _patch_interviews(
        monkeypatch,
        _invite(mode="mcq", type="mcq", screening={"mcqSetId": "set-1"}),
    )
    with pytest.raises(HTTPException) as caught:
        asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))
    assert caught.value.status_code == 400
    assert "no correct answer" in caught.value.detail.lower()


# ── idempotence + persistence ─────────────────────────────────────────────────


def test_materialising_stores_the_session_and_template(monkeypatch, fake_store) -> None:
    _patch_interviews(monkeypatch, _invite())
    session, template = asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))

    assert fake_store.sessions.docs["i1"]["id"] == "i1"
    assert fake_store.templates.docs["invite:i1"]["id"] == template["id"]
    assert session["templateId"] == "invite:i1"


def test_a_second_claim_reuses_the_same_session(monkeypatch, fake_store) -> None:
    """A candidate who reloads, reconnects, or opens the link on their phone must land on
    the same interview, not a second one."""
    _patch_interviews(monkeypatch, _invite())
    first, _ = asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))
    first["status"] = "in_progress"
    asyncio.run(fake_store.sessions.put(first))

    second, _ = asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))
    assert second["status"] == "in_progress"
    assert len(fake_store.sessions.docs) == 1


def test_a_reclaim_with_a_missing_template_is_a_404(monkeypatch, fake_store) -> None:
    fake_store.sessions.docs["i1"] = {"id": "i1", "templateId": "invite:gone"}
    with pytest.raises(HTTPException) as caught:
        asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))
    assert caught.value.status_code == 404


def test_the_launch_is_recorded_on_the_interview(monkeypatch, fake_store) -> None:
    reference = _patch_interviews(monkeypatch, _invite())
    asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))

    assert reference.updates, "the launch was not recorded"
    written = reference.updates[0]
    assert written["status"] == "in_progress"
    # Server-side increment, so a client cannot reset its own attempt count.
    assert "attemptsUsed" in written


def test_a_failed_launch_write_does_not_block_the_candidate(monkeypatch, fake_store) -> None:
    """They are standing at the start of their interview; a status field is not a reason to
    stop them."""
    reference = _patch_interviews(monkeypatch, _invite())

    def _boom(_fields):
        raise RuntimeError("firestore unavailable")

    reference.update = _boom
    session, _ = asyncio.run(invite_bridge.materialise(Settings(), "i1", CANDIDATE))
    assert session["id"] == "i1"


# ── result sync ───────────────────────────────────────────────────────────────


def _report(**overrides) -> dict:
    return {
        "sessionId": "i1",
        "overallScore": 82,
        "summary": "Strong communicator.",
        "recommendation": "yes",
        "strengths": ["clear"],
        "improvements": ["depth"],
        "perQuestion": [{"questionId": "q1", "kpiScores": {"a": 80}, "feedback": "ok"}],
        "kpiAverages": {"a": 80},
        "generatedAt": NOW,
        **overrides,
    }


def test_the_result_is_the_flat_half_only() -> None:
    """Flat fields for the Flutter model; the rich half lives in the report document.

    This used to nest `perQuestion` and `kpiAverages` under `result.detail`. That was a
    second copy of what the report already held, and the MOBILE surface wrote its own
    `detail` to the same field in a different shape — one name, two meanings, read by
    nobody. `reports/{interviewId}` is the single home now.
    """
    result = invite_bridge.build_result(_report())

    assert result["overallScore"] == 82
    assert result["recommendation"] == "yes"
    assert result["evaluatedBy"] == "ai"
    assert "detail" not in result
    assert "perQuestion" not in result
    assert "kpiAverages" not in result


def test_the_flat_half_is_the_shared_definition() -> None:
    """Both surfaces build it from the same function, so a recruiter reading a score
    cannot tell which client ran the interview."""
    from app import reports

    report = _report()
    assert invite_bridge.build_result(report) == reports.build_result_summary(report)


def test_a_missing_recommendation_is_defaulted_not_omitted() -> None:
    """The mobile model reads this field directly; absent renders as an empty badge."""
    assert invite_bridge.build_result(_report(recommendation=None))["recommendation"] == "maybe"


def test_missing_lists_become_empty_rather_than_none() -> None:
    result = invite_bridge.build_result({"overallScore": 0})
    assert result["strengths"] == []
    assert result["improvements"] == []


def test_syncing_writes_the_result_and_leaves_it_unpublished(monkeypatch, fake_store) -> None:
    """Releasing a result to the candidate stays a recruiter action; writing
    `resultPublished: true` here would publish every score automatically."""
    reference = _patch_interviews(monkeypatch, _invite())
    session = {"id": "i1", "viaInvite": True}

    asyncio.run(invite_bridge.sync_result(Settings(), session, _report()))

    written = reference.updates[0]
    assert written["status"] == "completed"
    assert written["resultPublished"] is False
    assert written["result"]["overallScore"] == 82


def test_a_recruiter_created_session_is_synced_too(monkeypatch, fake_store) -> None:
    """It has an interview document now, so it syncs like any other.

    This test asserted the opposite until the shared assignment record existed. A
    recruiter-created session used to live only in `web_sessions`, so `sync_result`
    returned early on the missing `viaInvite` flag — and the interview, its score
    included, never reached the mobile app. `POST /sessions` writes the assignment now
    and the session id IS the interview id, so there is nothing left to branch on.
    """
    reference = _patch_interviews(monkeypatch, _invite())
    asyncio.run(invite_bridge.sync_result(Settings(), {"id": "s1"}, _report()))

    assert len(reference.updates) == 1
    written = reference.updates[0]
    assert written["status"] == "completed"
    assert written["result"]["overallScore"] == 82
    # Still a recruiter action, on every path.
    assert written["resultPublished"] is False


def test_a_session_with_no_interview_document_is_skipped_quietly(
    monkeypatch, fake_store, caplog
) -> None:
    """Sessions predating the assignment record have nothing to sync into.

    `update` is used rather than `set(merge=True)` precisely so this fails instead of
    creating half a document — a result with no candidate and no title would render on
    the mobile dashboard as an unreadable row.
    """
    from google.api_core import exceptions as google_exceptions

    reference = _patch_interviews(monkeypatch, _invite())

    def _missing(_fields):
        raise google_exceptions.NotFound("no such document")

    reference.update = _missing

    with caplog.at_level("INFO"):
        asyncio.run(invite_bridge.sync_result(Settings(), {"id": "legacy"}, _report()))

    # Expected, so it must not read as a fault in the logs of every legacy completion.
    assert not [r for r in caplog.records if r.levelname == "ERROR"]


def test_a_failed_sync_never_raises(monkeypatch, fake_store) -> None:
    """The report is already stored locally, so a failure delays the recruiter seeing it
    rather than losing it."""
    reference = _patch_interviews(monkeypatch, _invite())

    def _boom(_fields):
        raise RuntimeError("firestore unavailable")

    reference.update = _boom
    asyncio.run(invite_bridge.sync_result(Settings(), {"id": "i1", "viaInvite": True}, _report()))


def test_an_essay_invite_carries_its_prompt_id_into_the_template() -> None:
    """The regression that made "Send invite" do nothing for an essay.

    Essay was added to the wizard and to session creation but not to this bridge,
    so the prompt id was dropped between the invite and the template — and session
    creation then refused with "Template references no essay prompt", for an
    invite the recruiter had filled in correctly.
    """
    template = _template(mode="essay", screening={"essayPromptId": "ep-1"})
    assert template["track"] == "essay"
    assert template["essayPromptId"] == "ep-1"


def test_an_essay_prompt_id_sent_at_the_top_level_is_also_accepted() -> None:
    """The mobile client puts it beside `screening` rather than inside it, exactly
    as it does for coding."""
    template = _template(mode="essay", essayPromptId="ep-2")
    assert template["essayPromptId"] == "ep-2"


def test_every_track_the_wizard_offers_is_invitable() -> None:
    """The bug this pins: a mode could be offered by the wizard, accepted by the
    session router, and then refused at invite creation with "A valid interview
    mode is required" — because three separate allow-lists had to agree and one
    of them was stale.

    `is_known_mode` gates invite creation and `mode_label` writes the invite
    email, so a track missing here is selectable and unsendable.
    """
    from app import interviews

    for track in invite_bridge.WEB_TRACKS:
        assert interviews.is_known_mode(track), f"{track} is not invitable"
        assert interviews.mode_label(track) != track, f"{track} has no human label"

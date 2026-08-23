"""Deciding a round on the web, and what the candidate is then told.

Until these routes existed the web surface wrote `resultPublished` only as `False`, at
creation, and never set it true — there was no publish action at all. A recruiter
working in the browser could score an interview and had no way to tell the candidate
anything; the only client that could release a result was the phone.

The tests are in two halves, and the second is the one that matters most. The first
checks a recruiter can decide and release. The second checks that doing so hands the
candidate three fields and never the recruiter's evaluation — the score, the AI's
verdict, its summary, its list of this person's weaknesses.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import interviews
from app.security import AuthedUser

# The full internal evaluation, as stored. Mirrors FULL_RECRUITER_RESULT in
# tests/interview_document_cases.py and `_recruiterResult` in the mobile suite, so all
# three are refusing to disclose the same specific values.
RECRUITER_RESULT = {
    "overallScore": 87,
    "recommendation": "Strong Hire",
    "summary": "Excellent systems depth, hire immediately.",
    "strengths": ["Deep Flutter knowledge"],
    "improvements": ["Rambles under pressure"],
    "evaluatedBy": "ai",
    "responses": [{"question": "Q1", "answer": "A1"}],
}


def _interview(fake_firestore, interview_id: str = "i-1", **overrides) -> str:
    document = {
        "recruiterId": "uid-recruiter",
        "candidateEmail": "Ada@Example.test",
        "candidateEmailLower": "ada@example.test",
        "candidateName": "Ada Lovelace",
        "title": "Backend Engineer — interview",
        "type": "chat",
        "status": "completed",
        "resultPublished": False,
        "result": dict(RECRUITER_RESULT),
        **overrides,
    }
    fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs[interview_id] = document
    return interview_id


def _stored(fake_firestore, interview_id: str = "i-1") -> dict:
    return fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs[interview_id]


# ── the recruiter decides ─────────────────────────────────────────────────────


def test_a_result_can_be_released(authed_client: TestClient, fake_firestore) -> None:
    """The action that did not exist. `resultPublished` is the only gate."""
    _interview(fake_firestore)

    response = authed_client.post("/api/web/interviews/i-1/publish", json={"published": True})
    assert response.status_code == 200, response.text
    assert _stored(fake_firestore)["resultPublished"] is True


def test_a_result_can_be_withheld_again(authed_client: TestClient, fake_firestore) -> None:
    _interview(fake_firestore, resultPublished=True)

    authed_client.post("/api/web/interviews/i-1/publish", json={"published": False})
    assert _stored(fake_firestore)["resultPublished"] is False


def test_an_outcome_never_destroys_the_evaluation_it_was_based_on(
    authed_client: TestClient, fake_firestore
) -> None:
    """THE reason these writes use dotted field paths.

    Replacing the `result` map would throw away the score, the summary, the strengths
    and — worst — the candidate's stored answers, which are what make a failed scoring
    run retryable without asking them to sit the interview again.
    """
    _interview(fake_firestore)

    response = authed_client.post(
        "/api/web/interviews/i-1/outcome",
        json={"outcome": "selected", "note": "See you Tuesday.", "publish": True},
    )
    assert response.status_code == 200, response.text

    result = _stored(fake_firestore)["result"]
    assert result["outcome"] == "selected"
    assert result["candidateNote"] == "See you Tuesday."
    # Everything the recruiter had before, still there.
    assert result["overallScore"] == 87
    assert result["summary"] == "Excellent systems depth, hire immediately."
    assert result["strengths"] == ["Deep Flutter knowledge"]
    assert result["responses"], "the raw answers are what make a re-score possible"


def test_deciding_and_publishing_are_separate(
    authed_client: TestClient, fake_firestore
) -> None:
    """So a recruiter can decide a whole round privately and release it in one go."""
    _interview(fake_firestore)

    authed_client.post(
        "/api/web/interviews/i-1/outcome", json={"outcome": "not_selected"}
    )
    stored = _stored(fake_firestore)
    assert stored["result"]["outcome"] == "not_selected"
    assert stored["resultPublished"] is False


def test_an_unknown_outcome_is_refused_rather_than_stored(
    authed_client: TestClient, fake_firestore
) -> None:
    """Reading an unknown value degrades to pending so old documents still render.

    WRITING one is a caller bug, and storing it would put a value on the document that
    the mobile client will not display.
    """
    _interview(fake_firestore)

    response = authed_client.post(
        "/api/web/interviews/i-1/outcome", json={"outcome": "probably?"}
    )
    assert response.status_code == 400
    assert "outcome" in response.json()["detail"]


def test_a_rank_is_written_as_a_pair(authed_client: TestClient, fake_firestore) -> None:
    _interview(fake_firestore)

    authed_client.post(
        "/api/web/interviews/i-1/outcome",
        json={"outcome": "selected", "rank": 3, "rankOf": 40},
    )
    result = _stored(fake_firestore)["result"]
    assert (result["rank"], result["rankOf"]) == (3, 40)


def test_another_recruiters_interview_is_a_404(
    authed_client: TestClient, fake_firestore
) -> None:
    _interview(fake_firestore, recruiterId="someone-else")

    assert (
        authed_client.post("/api/web/interviews/i-1/publish", json={}).status_code == 404
    )
    assert _stored(fake_firestore)["resultPublished"] is False


# ── deciding a whole round ────────────────────────────────────────────────────


def _round_of(fake_firestore, n: int) -> list[str]:
    return [_interview(fake_firestore, f"i-{i}") for i in range(1, n + 1)]


def test_a_round_is_decided_in_one_go(authed_client: TestClient, fake_firestore) -> None:
    ids = _round_of(fake_firestore, 4)

    response = authed_client.post(
        "/api/web/interviews/outcomes",
        json={
            "ranked": ids,
            "selectedIds": ids[:2],
            "noteForSelected": "Through to the next round.",
            "noteForRejected": "Thank you for your time.",
            "publish": True,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["decided"] == 4
    assert body["selected"] == 2
    assert body["published"] is True
    # Emailing is opt-in and separate from publishing: publishing makes the outcome
    # visible when they next sign in, an email PUSHES it to them, and an email cannot
    # be unsent. So it defaults off.
    assert body["emailed"] == 0

    first = _stored(fake_firestore, "i-1")["result"]
    last = _stored(fake_firestore, "i-4")["result"]
    assert first["outcome"] == "selected"
    assert first["candidateNote"] == "Through to the next round."
    assert last["outcome"] == "not_selected"
    assert last["candidateNote"] == "Thank you for your time."


def test_ranks_are_stamped_from_position(
    authed_client: TestClient, fake_firestore
) -> None:
    """Stamped, not computed on read.

    A rank that recomputed itself would shift under the candidate every time anybody
    else in the round was re-scored.
    """
    ids = _round_of(fake_firestore, 3)
    authed_client.post(
        "/api/web/interviews/outcomes", json={"ranked": ids, "selectedIds": [ids[0]]}
    )

    for position, interview_id in enumerate(ids, start=1):
        result = _stored(fake_firestore, interview_id)["result"]
        assert (result["rank"], result["rankOf"]) == (position, 3)


def test_one_unowned_interview_refuses_the_whole_round(
    authed_client: TestClient, fake_firestore
) -> None:
    """A partly-applied round decision is worse than a refused one — nobody can tell
    which half landed."""
    ids = _round_of(fake_firestore, 3)
    _interview(fake_firestore, "i-2", recruiterId="someone-else")

    response = authed_client.post(
        "/api/web/interviews/outcomes", json={"ranked": ids, "selectedIds": []}
    )
    assert response.status_code == 404

    for interview_id in ids:
        assert "outcome" not in _stored(fake_firestore, interview_id)["result"]


def test_selecting_someone_outside_the_round_is_refused(
    authed_client: TestClient, fake_firestore
) -> None:
    ids = _round_of(fake_firestore, 2)
    response = authed_client.post(
        "/api/web/interviews/outcomes",
        json={"ranked": ids, "selectedIds": ["not-in-this-round"]},
    )
    assert response.status_code == 400


def test_a_duplicated_candidate_is_refused(
    authed_client: TestClient, fake_firestore
) -> None:
    """Two positions for one person means one of the two ranks is a lie."""
    _interview(fake_firestore, "i-1")
    response = authed_client.post(
        "/api/web/interviews/outcomes", json={"ranked": ["i-1", "i-1"], "selectedIds": []}
    )
    assert response.status_code == 400


# ── what the candidate is told ────────────────────────────────────────────────
#
# The half that matters most. `candidate_result_view` is an allowlist, and these assert
# it holds through the HTTP layer, which is where a leak would actually reach someone.


# The assigned candidate. `authed_client` takes this via the `authed_user` marker.
CANDIDATE = AuthedUser(
    uid="uid-cand", email="ada@example.test", claims={"email_verified": True}
)
AS_CANDIDATE = pytest.mark.authed_user(CANDIDATE)


@AS_CANDIDATE
def test_a_published_outcome_reaches_the_candidate(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    _interview(
        fake_firestore,
        resultPublished=True,
        result={
            **RECRUITER_RESULT,
            "outcome": "selected",
            "rank": 3,
            "rankOf": 40,
            "candidateNote": "We will be in touch.",
        },
    )

    rows = authed_client.get("/api/web/sessions/mine").json()
    row = next(r for r in rows if r["id"] == "i-1")

    assert row["outcome"] == {
        "outcome": "selected",
        "rank": 3,
        "rankOf": 40,
        "candidateNote": "We will be in touch.",
    }


@AS_CANDIDATE
def test_the_candidate_never_receives_the_evaluation(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """The whole point. Every one of these is the recruiter's working note.

    Asserted on the serialised RESPONSE, not on the projection, because that is where a
    leak would actually reach someone — a field added to a row further up the handler
    would not be caught by testing the allowlist function alone.
    """
    _interview(
        fake_firestore,
        resultPublished=True,
        result={**RECRUITER_RESULT, "outcome": "selected"},
    )

    body = authed_client.get("/api/web/sessions/mine").text

    for leaked in ("87", "Strong Hire", "Excellent systems depth", "Deep Flutter", "Rambles"):
        assert leaked not in body, f"the candidate was sent {leaked!r}"


@AS_CANDIDATE
def test_an_unpublished_outcome_is_invisible(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """`resultPublished` is the only gate, and only a recruiter sets it."""
    _interview(
        fake_firestore,
        resultPublished=False,
        result={**RECRUITER_RESULT, "outcome": "selected", "candidateNote": "Hi!"},
    )

    row = next(
        r
        for r in authed_client.get("/api/web/sessions/mine").json()
        if r["id"] == "i-1"
    )
    assert row["outcome"] is None
    assert "Hi!" not in authed_client.get("/api/web/sessions/mine").text


@AS_CANDIDATE
def test_a_legacy_published_result_reads_as_pending(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """Published before outcomes existed: a score and no outcome.

    It must read as under review, NOT fall back to the score it does have. That
    fallback is the exact leak this design closes.
    """
    _interview(fake_firestore, resultPublished=True, result=dict(RECRUITER_RESULT))

    row = next(
        r
        for r in authed_client.get("/api/web/sessions/mine").json()
        if r["id"] == "i-1"
    )
    assert row["outcome"] == {"outcome": "pending"}


@AS_CANDIDATE
def test_the_mine_list_still_carries_no_score(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """The route's original rule, unchanged and now asserted.

    An earlier draft of the plan proposed widening it for PUBLISHED results. That would
    have sent an AI's verdict and a list of the candidate's weaknesses to the
    candidate; the rule is right as written.
    """
    _interview(fake_firestore, resultPublished=True, result=dict(RECRUITER_RESULT))

    for row in authed_client.get("/api/web/sessions/mine").json():
        assert "overallScore" not in row
        assert "score" not in row


# ── recovering a failed evaluation ────────────────────────────────────────────
#
# Both of these existed only on the phone. In the browser a failed scoring run was
# TERMINAL: the answers were sitting on the document, the scorer could have run again,
# and there was no route to it.

FAILED_RESULT = {
    "summary": "",
    "recommendation": "",
    "strengths": [],
    "improvements": [],
    "evaluatedBy": "",
    "evaluationError": "Gemini returned nothing usable.",
    "responses": [{"question": "Tell me about a hard bug.", "answer": "A long answer."}],
}


def test_a_failed_evaluation_is_offered_for_retry(
    authed_client: TestClient, fake_firestore
) -> None:
    _interview(fake_firestore, result=dict(FAILED_RESULT))

    rows = authed_client.get("/api/web/interviews/retryable").json()
    assert [r["id"] for r in rows] == ["i-1"]
    assert rows[0]["answers"] == 1
    # Shown so a recruiter can tell a transient upstream error from "nothing was said".
    assert "Gemini" in rows[0]["error"]


def test_an_already_scored_interview_is_not_offered(
    authed_client: TestClient, fake_firestore
) -> None:
    """`evaluatedBy` is non-empty, so something scored it."""
    _interview(fake_firestore)
    assert authed_client.get("/api/web/interviews/retryable").json() == []


def test_an_interview_with_no_stored_answers_is_not_offered(
    authed_client: TestClient, fake_firestore
) -> None:
    """Without them there is nothing to feed the scorer.

    The only route left is a manual evaluation, so offering a retry that cannot work
    would be a button that always fails.
    """
    _interview(fake_firestore, result={**FAILED_RESULT, "responses": []})
    assert authed_client.get("/api/web/interviews/retryable").json() == []


def test_a_two_way_interview_is_never_offered(
    authed_client: TestClient, fake_firestore
) -> None:
    """No recording means no transcript, however much else it stores.

    A live interview's way back is the recruiter's own review, not a model.
    """
    _interview(fake_firestore, mode="two_way", result=dict(FAILED_RESULT))
    assert authed_client.get("/api/web/interviews/retryable").json() == []

    _interview(fake_firestore, "i-2", roundKind="two_way", result=dict(FAILED_RESULT))
    assert "i-2" not in [
        r["id"] for r in authed_client.get("/api/web/interviews/retryable").json()
    ]


def test_an_unfinished_interview_is_not_a_failure(
    authed_client: TestClient, fake_firestore
) -> None:
    _interview(fake_firestore, status="in_progress", result=dict(FAILED_RESULT))
    assert authed_client.get("/api/web/interviews/retryable").json() == []


def test_retrying_runs_the_shared_scorer(
    authed_client: TestClient, fake_firestore, monkeypatch
) -> None:
    """The SAME scorer the mobile surface runs.

    `evaluation.score_and_store` moved into the kernel for exactly this — a second
    implementation here would be a second set of results for one interview.
    """
    from app import evaluation

    called = {}

    async def _fake(settings, interview_id, *, job_role, responses):
        called.update(id=interview_id, role=job_role, answers=len(responses))
        # What a real success writes.
        _stored(fake_firestore)["result"] = {"evaluatedBy": "ai", "overallScore": 71}

    monkeypatch.setattr(evaluation, "score_and_store", _fake)
    _interview(fake_firestore, result=dict(FAILED_RESULT))

    body = authed_client.post("/api/web/interviews/i-1/retry-evaluation").json()

    assert called["id"] == "i-1"
    assert called["answers"] == 1
    assert body == {"id": "i-1", "scored": True, "overallScore": 71, "error": ""}


def test_a_retry_that_fails_again_says_so_rather_than_reporting_success(
    authed_client: TestClient, fake_firestore, monkeypatch
) -> None:
    """`score_and_store` never raises — it records the failure ON the document.

    So the response is read back afterwards. Reporting "done" because no exception
    escaped is the exact state this feature exists to get out of.
    """
    from app import evaluation

    async def _fails(settings, interview_id, *, job_role, responses):
        _stored(fake_firestore)["result"] = {
            **FAILED_RESULT,
            "evaluationError": "Upstream unavailable.",
        }

    monkeypatch.setattr(evaluation, "score_and_store", _fails)
    _interview(fake_firestore, result=dict(FAILED_RESULT))

    body = authed_client.post("/api/web/interviews/i-1/retry-evaluation").json()
    assert body["scored"] is False
    assert body["error"] == "Upstream unavailable."


def test_retrying_something_already_scored_is_refused(
    authed_client: TestClient, fake_firestore
) -> None:
    _interview(fake_firestore)
    assert (
        authed_client.post("/api/web/interviews/i-1/retry-evaluation").status_code == 409
    )


# ── letting someone sit it again ──────────────────────────────────────────────


def test_clearing_a_result_reopens_the_interview(
    authed_client: TestClient, fake_firestore
) -> None:
    """Mirrors mobile's `clearResult`: the candidate stays ASSIGNED and can retake.

    Distinct from deleting, which removes them from the test entirely.
    """
    _interview(fake_firestore, resultPublished=True, attemptsUsed=1)

    response = authed_client.post("/api/web/interviews/i-1/clear-result")
    assert response.status_code == 200, response.text

    stored = _stored(fake_firestore)
    assert stored["status"] == "assigned"
    assert stored["resultPublished"] is False
    # Actually GONE, not overwritten with an empty map: a lingering `result` would keep
    # the score on the leaderboard and in every list that reads it.
    assert "result" not in stored
    # Still assigned to the same candidate — that is the whole distinction.
    assert stored["candidateEmailLower"] == "ada@example.test"


def test_clearing_does_not_reset_the_attempt_count(
    authed_client: TestClient, fake_firestore
) -> None:
    """Reopening grants one more go; it does not erase how many times it was sat.

    If the cap has been reached, raising it is a separate and visible decision.
    """
    _interview(fake_firestore, attemptsUsed=2)
    authed_client.post("/api/web/interviews/i-1/clear-result")
    assert _stored(fake_firestore)["attemptsUsed"] == 2


def test_clearing_another_recruiters_interview_is_a_404(
    authed_client: TestClient, fake_firestore
) -> None:
    _interview(fake_firestore, recruiterId="someone-else", resultPublished=True)
    assert authed_client.post("/api/web/interviews/i-1/clear-result").status_code == 404
    assert _stored(fake_firestore)["resultPublished"] is True


# ── telling the candidates by email ───────────────────────────────────────────


def test_emails_are_opt_in_and_separate_from_publishing(
    authed_client: TestClient, fake_firestore, monkeypatch
) -> None:
    """Publishing makes an outcome visible; an email pushes it.

    A recruiter deciding a round privately, or one whose candidates are tracked
    elsewhere, wants the first without the second — and an email cannot be unsent.
    """
    sent: list[dict] = []

    async def _capture(settings, **kwargs):
        sent.append(kwargs)
        return {"status": "accepted", "sentAt": "", "attempts": 1}

    from app.web.services import interview_invite

    monkeypatch.setattr(interview_invite, "send_invite_email", _capture)
    ids = _round_of(fake_firestore, 2)

    # Published, but no emails asked for.
    authed_client.post(
        "/api/web/interviews/outcomes",
        json={"ranked": ids, "selectedIds": [ids[0]], "publish": True},
    )
    assert sent == []


def test_each_candidate_gets_the_email_for_their_own_outcome(
    authed_client: TestClient, fake_firestore, monkeypatch
) -> None:
    """The same `selected` / `rejection` kinds the pipeline advance path uses.

    One renderer for one decision — a second here would be a second voice, and the
    golden fixture only pins one of them.
    """
    sent: list[dict] = []

    async def _capture(settings, **kwargs):
        sent.append(kwargs)
        return {"status": "accepted", "sentAt": "", "attempts": 1}

    from app.web.services import interview_invite

    monkeypatch.setattr(interview_invite, "send_invite_email", _capture)
    ids = _round_of(fake_firestore, 3)

    body = authed_client.post(
        "/api/web/interviews/outcomes",
        json={
            "ranked": ids,
            "selectedIds": [ids[0]],
            "publish": True,
            "sendEmails": True,
            "roundName": "Technical screen",
        },
    ).json()

    assert body["emailed"] == 3
    kinds = [k["kind"] for k in sent]
    assert kinds == ["selected", "rejection", "rejection"]
    # Neither email sends anyone anywhere: an advance to a NEXT round is a different
    # email with its own link, sent when that round is assigned.
    assert all(k["link"] == "" for k in sent)


def test_a_bounced_address_is_reported_per_recipient(
    authed_client: TestClient, fake_firestore, monkeypatch
) -> None:
    """One undeliverable address must not sink a round of fifty.

    Reported per recipient so a recruiter retries the two that failed rather than
    re-sending to everyone.
    """

    async def _fail_one(settings, **kwargs):
        if kwargs["to_email"].startswith("Ada"):
            return {"status": "failed", "error": "mailbox full", "attempts": 1}
        return {"status": "accepted", "sentAt": "", "attempts": 1}

    from app.web.services import interview_invite

    monkeypatch.setattr(interview_invite, "send_invite_email", _fail_one)
    ids = _round_of(fake_firestore, 2)

    body = authed_client.post(
        "/api/web/interviews/outcomes",
        json={"ranked": ids, "selectedIds": [], "sendEmails": True},
    ).json()

    # The DECISION landed for everyone regardless.
    assert body["decided"] == 2
    assert body["emailed"] == 0
    assert len(body["emailFailures"]) == 2
    assert "mailbox full" in body["emailFailures"][0]["error"]
    for interview_id in ids:
        assert _stored(fake_firestore, interview_id)["result"]["outcome"] == "not_selected"


def test_an_unscored_candidate_is_never_told_their_score_is_zero(
    authed_client: TestClient, fake_firestore, monkeypatch
) -> None:
    """Empty rather than "0".

    Reading "your score: 0" for an interview nobody managed to score is worse than
    reading nothing at all.
    """
    sent: list[dict] = []

    async def _capture(settings, **kwargs):
        sent.append(kwargs)
        return {"status": "accepted", "sentAt": "", "attempts": 1}

    from app.web.services import interview_invite

    monkeypatch.setattr(interview_invite, "send_invite_email", _capture)
    _interview(fake_firestore, "i-1", result={"evaluatedBy": "", "responses": []})

    authed_client.post(
        "/api/web/interviews/outcomes",
        json={"ranked": ["i-1"], "selectedIds": [], "sendEmails": True},
    )
    assert sent[0]["variables"]["score"] == ""

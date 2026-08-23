"""Multi-round pipelines.

These rules decide whether a real person progresses in a hiring process, so the
weight is on the two that can be wrong in a costly way: **a null score is never a
pass**, and a batch failure must not discard work already committed for other
candidates.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser
from app.web.services import pipeline_board as board


def _run(coro):
    import asyncio

    return asyncio.new_event_loop().run_until_complete(coro)

OTHER = AuthedUser(uid="uid-other", email="other@talbotiq.com", claims={})


def _round(**overrides) -> dict:
    return {"name": "Screening", "mode": "chat", **overrides}


def _pipeline(rounds: int = 2, **overrides) -> dict:
    return {
        "id": "p1",
        "recruiterId": "uid-recruiter",
        "role": "Backend",
        "rounds": [
            {"index": i, "name": f"Round {i + 1}", "mode": "chat"} for i in range(rounds)
        ],
        **overrides,
    }


def _candidate(**overrides) -> dict:
    return {
        "id": "c1",
        "pipelineId": "p1",
        "recruiterId": "uid-recruiter",
        "candidateEmail": "ada@x.test",
        "role": "Backend",
        "currentRoundIndex": 0,
        "status": board.IN_ROUND,
        "perRound": [{"roundIndex": 0, "interviewId": "i0"}],
        "history": [],
        **overrides,
    }


# ── round validation ──────────────────────────────────────────────────────────


def test_a_round_needs_a_name() -> None:
    with pytest.raises(HTTPException) as caught:
        board.normalise_round({"mode": "chat"}, 0)
    assert "Round 1: name is required" in caught.value.detail


def test_two_way_rounds_are_refused() -> None:
    """A live recruiter-led call has no automatic score, so a two-way round could
    never advance anyone — the pipeline would dead-end."""
    with pytest.raises(HTTPException) as caught:
        board.normalise_round(_round(mode="two_way"), 0)
    assert "two_way deferred" in caught.value.detail


@pytest.mark.parametrize("mode", ["chatbot", "voice", "video_avatar", "chat", "video"])
def test_scoreable_modes_are_allowed(mode: str) -> None:
    assert board.normalise_round(_round(mode=mode), 0)["mode"] == mode


def test_the_index_comes_from_position_not_the_body() -> None:
    """A client index disagreeing with position would make "the next round"
    ambiguous."""
    result = board.normalise(
        {"role": "R", "rounds": [_round(index=99), _round(name="Two", index=0)]}
    )
    assert [r["index"] for r in result["rounds"]] == [0, 1]


def test_a_pipeline_needs_a_role_and_a_round() -> None:
    for body, message in [
        ({"rounds": [_round()]}, "role is required"),
        ({"role": "R", "rounds": []}, "at least one round"),
        ({"role": "R"}, "at least one round"),
    ]:
        with pytest.raises(HTTPException) as caught:
            board.normalise(body)
        assert message in caught.value.detail


def test_a_tailored_round_keeps_its_config() -> None:
    result = board.normalise_round(
        _round(source="tailor", config={"techCount": "3", "nonTechCount": 2, "domains": "x"}),
        0,
    )
    assert result["config"]["techCount"] == 3
    assert result["config"]["nonTechCount"] == 2
    # A non-list `domains` becomes an empty list rather than a string.
    assert result["config"]["domains"] == []


def test_a_set_round_keeps_its_question_set() -> None:
    result = board.normalise_round(_round(source="set", questionSetId="qs1"), 0)
    assert result["questionSetId"] == "qs1"


def test_an_unrecognised_advance_rule_is_dropped() -> None:
    assert "advanceRule" not in board.normalise_round(
        _round(advanceRule={"kind": "vibes", "value": 1}), 0
    )
    assert board.normalise_round(_round(advanceRule={"kind": "topN", "value": "3"}), 0)[
        "advanceRule"
    ] == {"kind": "topN", "value": 3}


# ── scoring ───────────────────────────────────────────────────────────────────


def test_a_report_with_no_answers_is_not_scored() -> None:
    """`notEvaluated` reports carry zero scores as PLACEHOLDERS. Treating them as real
    would reject someone on a number nobody produced."""
    assert board.is_scored({"overallScore": 0, "notEvaluated": True}) is False
    assert board.is_scored({"overallScore": 0}) is True


def test_a_missing_or_malformed_report_is_not_scored() -> None:
    assert board.is_scored(None) is False
    assert board.is_scored({}) is False
    assert board.is_scored({"overallScore": "82"}) is False
    assert board.is_scored({"overallScore": True}) is False


# ── advance rules ─────────────────────────────────────────────────────────────


def _cards(*scores) -> list[dict]:
    return [
        {"pipelineCandidateId": f"c{i}", "score": score} for i, score in enumerate(scores)
    ]


def test_a_threshold_selects_at_or_above_the_value() -> None:
    picked = board.select_by_criteria(_cards(90, 70, 69.5, 70.0), {"kind": "threshold", "value": 70})
    assert picked == ["c0", "c1", "c3"]


def test_top_n_selects_the_highest_scores() -> None:
    picked = board.select_by_criteria(_cards(50, 90, 70), {"kind": "topN", "value": 2})
    assert picked == ["c1", "c2"]


def test_unscored_candidates_are_never_selected_by_a_threshold() -> None:
    picked = board.select_by_criteria(_cards(None, 90, None), {"kind": "threshold", "value": 0})
    assert picked == ["c1"]


def test_unscored_candidates_are_never_selected_by_top_n() -> None:
    """A topN over a list padded with nulls would advance people nobody assessed once
    the scored pool was smaller than N."""
    picked = board.select_by_criteria(_cards(None, 90, None, None), {"kind": "topN", "value": 3})
    assert picked == ["c1"]


def test_top_n_of_zero_selects_nobody() -> None:
    assert board.select_by_criteria(_cards(90, 80), {"kind": "topN", "value": 0}) == []
    assert board.select_by_criteria(_cards(90), {"kind": "topN", "value": -5}) == []


def test_top_n_beyond_the_pool_takes_everyone_scored() -> None:
    assert board.select_by_criteria(_cards(90, 80), {"kind": "topN", "value": 99}) == ["c0", "c1"]


def test_an_empty_pool_selects_nobody() -> None:
    for rule in [{"kind": "threshold", "value": 50}, {"kind": "topN", "value": 3}]:
        assert board.select_by_criteria([], rule) == []


# ── eligibility ───────────────────────────────────────────────────────────────


def test_an_unscored_candidate_cannot_advance() -> None:
    with pytest.raises(HTTPException) as caught:
        board.assert_advanceable(_candidate(), 1, 2, scored=False)
    assert "not completed and been scored" in caught.value.detail


def test_a_terminal_candidate_cannot_advance_again() -> None:
    for state in (board.SELECTED, board.NOT_ADVANCING):
        with pytest.raises(HTTPException) as caught:
            board.assert_advanceable(_candidate(status=state), 1, 2, scored=True)
        assert "not in an active round" in caught.value.detail


def test_rounds_cannot_be_skipped() -> None:
    with pytest.raises(HTTPException) as caught:
        board.assert_advanceable(_candidate(), 2, 3, scored=True)
    assert "only advance to the next round" in caught.value.detail


def test_advancing_backwards_is_refused() -> None:
    with pytest.raises(HTTPException):
        board.assert_advanceable(_candidate(currentRoundIndex=1), 1, 3, scored=True)


def test_advancing_past_the_end_is_refused() -> None:
    with pytest.raises(HTTPException) as caught:
        board.assert_advanceable(_candidate(currentRoundIndex=1), 2, 1, scored=True)
    assert "out of range" in caught.value.detail


def test_the_selection_step_is_allowed() -> None:
    """target == round count means "selected", which is one past the last round."""
    board.assert_advanceable(_candidate(currentRoundIndex=1), 2, 2, scored=True)


# ── the board ─────────────────────────────────────────────────────────────────


def _build(candidates: list[dict], reports=None, sessions=None) -> dict:
    reports = reports or {}
    sessions = sessions or {}
    return board.build_board(
        _pipeline(), candidates, lambda i: reports.get(i), lambda i: sessions.get(i)
    )


def test_candidates_land_in_their_current_round_column() -> None:
    result = _build([_candidate(), _candidate(id="c2", currentRoundIndex=1)])
    columns = {c["key"]: c for c in result["columns"]}
    assert [card["pipelineCandidateId"] for card in columns["round-0"]["cards"]] == ["c1"]
    assert [card["pipelineCandidateId"] for card in columns["round-1"]["cards"]] == ["c2"]


def test_terminal_candidates_land_in_the_terminal_columns() -> None:
    result = _build(
        [
            _candidate(id="s1", status=board.SELECTED),
            _candidate(id="n1", status=board.NOT_ADVANCING),
        ]
    )
    columns = {c["key"]: c for c in result["columns"]}
    assert [c["pipelineCandidateId"] for c in columns["selected"]["cards"]] == ["s1"]
    assert [c["pipelineCandidateId"] for c in columns["not-advancing"]["cards"]] == ["n1"]


def test_an_unscored_card_shows_a_null_score_not_zero() -> None:
    """Zero would sort them alongside someone who genuinely scored zero."""
    card = _build([_candidate()])["columns"][0]["cards"][0]
    assert card["score"] is None
    assert card["advanceable"] is False


def test_a_scored_card_is_advanceable() -> None:
    card = _build([_candidate()], reports={"i0": {"overallScore": 82}})["columns"][0]["cards"][0]
    assert card["score"] == 82
    assert card["advanceable"] is True
    assert card["roundStatus"] == "completed"


def test_a_not_evaluated_report_is_not_advanceable() -> None:
    card = _build(
        [_candidate()], reports={"i0": {"overallScore": 0, "notEvaluated": True}}
    )["columns"][0]["cards"][0]
    assert card["score"] is None
    assert card["advanceable"] is False


@pytest.mark.parametrize(
    "session_status,expected",
    [
        (None, "invited"),
        ("created", "invited"),
        ("system_check", "in_progress"),
        ("in_progress", "in_progress"),
        ("expired", "expired"),
        ("completed", "completed"),
    ],
)
def test_round_status_follows_the_session(session_status, expected: str) -> None:
    card = _build([_candidate()], sessions={"i0": session_status})["columns"][0]["cards"][0]
    assert card["roundStatus"] == expected


def test_a_candidate_with_no_interview_shows_none() -> None:
    card = _build([_candidate(perRound=[])])["columns"][0]["cards"][0]
    assert card["roundStatus"] == "none"


def test_every_column_exists_even_with_no_candidates() -> None:
    result = _build([])
    assert [c["key"] for c in result["columns"]] == [
        "round-0", "round-1", "selected", "not-advancing",
    ]


def test_the_history_travels_with_the_card() -> None:
    """It is the audit trail a recruiter explains a decision from."""
    history = [{"at": "2026-01-01", "action": "invited"}]
    card = _build([_candidate(history=history)])["columns"][0]["cards"][0]
    assert card["history"] == history


# ── email result ──────────────────────────────────────────────────────────────


def test_skipped_and_failed_are_distinct() -> None:
    """Conflating them would make the audit trail lie about whether a candidate was
    ever contacted."""
    assert board.email_result(sent=False, send_emails=False) == "skipped"
    assert board.email_result(sent=False, send_emails=True) == "failed"
    assert board.email_result(sent=True, send_emails=True) == "accepted"


# ── routes ────────────────────────────────────────────────────────────────────


def test_pipelines_round_trip(authed_client: TestClient) -> None:
    created = authed_client.post(
        "/api/web/pipelines",
        json={"role": "Backend", "name": "Backend hiring", "rounds": [_round(), _round(name="Final")]},
    ).json()

    assert created["recruiterId"] == "uid-recruiter"
    assert [r["index"] for r in created["rounds"]] == [0, 1]
    assert authed_client.get(f"/api/web/pipelines/{created['id']}").json() == created


def test_the_owner_is_stamped_not_taken_from_the_body(authed_client: TestClient) -> None:
    created = authed_client.post(
        "/api/web/pipelines",
        json={"role": "R", "rounds": [_round()], "recruiterId": "uid-victim"},
    ).json()
    assert created["recruiterId"] == "uid-recruiter"


def test_another_recruiters_pipeline_is_a_404(authed_client: TestClient, fake_store) -> None:
    fake_store.pipelines.docs["theirs"] = _pipeline(id="theirs", recruiterId=OTHER.uid)

    for method, path in [
        ("GET", "/api/web/pipelines/theirs"),
        ("GET", "/api/web/pipelines/theirs/board"),
        ("PUT", "/api/web/pipelines/theirs"),
        ("DELETE", "/api/web/pipelines/theirs"),
        ("POST", "/api/web/pipelines/theirs/invite"),
        ("POST", "/api/web/pipelines/theirs/advance"),
        ("POST", "/api/web/pipelines/theirs/not-advancing"),
        ("POST", "/api/web/pipelines/theirs/move-back"),
    ]:
        response = authed_client.request(
            method, path, json={"role": "R", "rounds": [_round()], "candidateIds": ["x"]}
        )
        assert response.status_code == 404, f"{method} {path}"


def test_the_list_is_owner_filtered_and_role_filterable(
    authed_client: TestClient, fake_store
) -> None:
    fake_store.pipelines.docs["mine-a"] = _pipeline(id="mine-a", role="Backend", createdAt="2026-01-01")
    fake_store.pipelines.docs["mine-b"] = _pipeline(id="mine-b", role="Frontend", createdAt="2026-02-01")
    fake_store.pipelines.docs["theirs"] = _pipeline(id="theirs", recruiterId=OTHER.uid)

    listed = authed_client.get("/api/web/pipelines").json()
    # Newest first, and never another recruiter's.
    assert [p["id"] for p in listed] == ["mine-b", "mine-a"]

    filtered = authed_client.get("/api/web/pipelines", params={"role": "Backend"}).json()
    assert [p["id"] for p in filtered] == ["mine-a"]


def test_a_candidate_from_another_pipeline_is_not_actionable(
    authed_client: TestClient, fake_store
) -> None:
    """Owning *a* pipeline must not make someone else's candidate actionable."""
    fake_store.pipelines.docs["p1"] = _pipeline(id="p1")
    fake_store.pipeline_candidates.docs["elsewhere"] = _candidate(
        id="elsewhere", pipelineId="p-other"
    )

    response = authed_client.post(
        "/api/web/pipelines/p1/move-back", json={"candidateId": "elsewhere"}
    )
    assert response.status_code == 404


def test_advance_reports_per_candidate_failures_without_aborting(
    authed_client: TestClient, fake_store
) -> None:
    """Partial success by design: one candidate's failure must not discard work
    already committed for the others."""
    fake_store.pipelines.docs["p1"] = _pipeline(id="p1")
    # Unscored, so genuinely ineligible.
    fake_store.pipeline_candidates.docs["c1"] = _candidate(id="c1")

    response = authed_client.post(
        "/api/web/pipelines/p1/advance",
        json={"candidateIds": ["c1", "missing"], "targetRoundIndex": 1, "sendEmails": False},
    )
    assert response.status_code == 200

    results = response.json()["results"]
    assert len(results) == 2
    assert "not completed and been scored" in results[0]["error"]
    assert results[1]["error"]


def test_advance_requires_its_arguments(authed_client: TestClient, fake_store) -> None:
    fake_store.pipelines.docs["p1"] = _pipeline(id="p1")
    for body in [{}, {"candidateIds": []}, {"candidateIds": ["c"], "targetRoundIndex": "1"}]:
        response = authed_client.post("/api/web/pipelines/p1/advance", json=body)
        assert response.status_code == 400


def test_not_advancing_marks_the_candidate_and_sends_nothing_by_default(
    authed_client: TestClient, fake_store
) -> None:
    """A rejection sent by default cannot be recalled."""
    fake_store.pipelines.docs["p1"] = _pipeline(id="p1")
    fake_store.pipeline_candidates.docs["c1"] = _candidate(id="c1")

    body = authed_client.post(
        "/api/web/pipelines/p1/not-advancing", json={"candidateIds": ["c1"]}
    ).json()

    assert body["results"][0]["sent"] is False
    stored = fake_store.pipeline_candidates.docs["c1"]
    assert stored["status"] == board.NOT_ADVANCING
    assert stored["history"][-1]["emailResult"] == "skipped"
    assert stored["history"][-1]["basis"] == "no email"


def test_move_back_is_refused_at_round_zero(authed_client: TestClient, fake_store) -> None:
    fake_store.pipelines.docs["p1"] = _pipeline(id="p1")
    fake_store.pipeline_candidates.docs["c1"] = _candidate(id="c1", currentRoundIndex=0)

    response = authed_client.post(
        "/api/web/pipelines/p1/move-back", json={"candidateId": "c1"}
    )
    assert response.status_code == 400
    assert "Nothing to move back" in response.json()["error"]


def test_move_back_is_refused_once_the_round_is_scored(
    authed_client: TestClient, fake_store
) -> None:
    """That round really happened; erasing a completed assessment is not a
    correction."""
    fake_store.pipelines.docs["p1"] = _pipeline(id="p1")
    fake_store.pipeline_candidates.docs["c1"] = _candidate(
        id="c1",
        currentRoundIndex=1,
        perRound=[{"roundIndex": 0, "interviewId": "i0"}, {"roundIndex": 1, "interviewId": "i1"}],
    )
    fake_store.reports.docs["i1"] = {"sessionId": "i1", "overallScore": 70}

    response = authed_client.post(
        "/api/web/pipelines/p1/move-back", json={"candidateId": "c1"}
    )
    assert response.status_code == 400
    assert "already completed" in response.json()["error"]


def test_move_back_rewinds_and_records_the_correction(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    fake_store.pipelines.docs["p1"] = _pipeline(id="p1")
    fake_store.pipeline_candidates.docs["c1"] = _candidate(
        id="c1",
        currentRoundIndex=1,
        status=board.IN_ROUND,
        perRound=[{"roundIndex": 0, "interviewId": "i0"}, {"roundIndex": 1, "interviewId": "i1"}],
    )
    # A session the candidate materialised by opening the now-reverted link.
    fake_store.sessions.docs["i1"] = {"id": "i1", "status": "created"}

    assert authed_client.post(
        "/api/web/pipelines/p1/move-back", json={"candidateId": "c1"}
    ).status_code == 200

    stored = fake_store.pipeline_candidates.docs["c1"]
    assert stored["currentRoundIndex"] == 0
    assert stored["status"] == board.IN_ROUND
    assert [p["roundIndex"] for p in stored["perRound"]] == [0]
    assert stored["history"][-1] == {
        **stored["history"][-1],
        "action": "moved_back",
        "fromRound": 1,
        "toRound": 0,
        "basis": "correction",
    }
    # The dead link must not stay resumable.
    assert "i1" not in fake_store.sessions.docs
    # ...and that means the SHARED interviews document too, not just the web session —
    # the candidate holds a link into `interviews`, which is what the Flutter app reads.
    assert "i1" in fake_firestore.collection("interviews").deleted


def test_pipelines_require_a_token() -> None:
    assert TestClient(create_app()).get("/api/web/pipelines").status_code == 401


# ── retirement: writes off, reads intact, data untouched ──────────────────────


def _retired():
    """A client whose deployment has retired the pipeline model."""
    from fastapi.testclient import TestClient

    from app.config import Settings
    from app.main import create_app
    from app.security import AuthedUser, require_firebase_user
    from app.web.deps import web_user_from_query

    user = AuthedUser(uid="uid-recruiter", email="r@t.test", claims={})
    app = create_app()
    app.state.settings = Settings(pipelines_writable=False)
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


@pytest.mark.parametrize(
    "method,path",
    [
        ("post", "/api/web/pipelines"),
        ("put", "/api/web/pipelines/p1"),
        ("delete", "/api/web/pipelines/p1"),
        ("post", "/api/web/pipelines/p1/advance"),
        ("post", "/api/web/pipelines/p1/not-advancing"),
        ("post", "/api/web/pipelines/p1/move-back"),
    ],
)
def test_every_write_is_refused_once_retired(fake_store, method: str, path: str) -> None:
    """Rounds replaced this model. Turning writes off is how it is retired.

    410, not 404: the route exists and so does the pipeline — it is the CAPABILITY that
    is gone. A 404 would read as "your pipeline was deleted", which is the one thing
    that has not happened.
    """
    response = _retired().request(method.upper(), path, json={})
    assert response.status_code == 410, f"{method.upper()} {path} still writes"
    assert "Timeline" in response.json()["detail"]


def test_reads_still_work_once_retired(fake_store) -> None:
    """A recruiter part-way through a hire must not lose sight of a pipeline they are
    running just because nothing new can be added to it."""
    _run(
        fake_store.pipelines.put(
            {"id": "p1", "recruiterId": "uid-recruiter", "role": "Backend", "rounds": []}
        )
    )
    client = _retired()

    assert client.get("/api/web/pipelines").status_code == 200
    assert client.get("/api/web/pipelines/p1").status_code == 200
    assert [p["id"] for p in client.get("/api/web/pipelines").json()] == ["p1"]


def test_retiring_deletes_nothing(fake_store) -> None:
    """Retiring and deleting are different steps, and conflating them makes the
    reversible one irreversible. Deletion is `scripts/delete_web_pipelines.py`."""
    _run(fake_store.pipelines.put({"id": "p1", "recruiterId": "uid-recruiter"}))
    _retired().post("/api/web/pipelines", json={"role": "Backend"})

    assert "p1" in fake_store.pipelines.docs

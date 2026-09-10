"""`/api/web/candidates/board` — the Kanban's read-only, grouped-by-candidate data.

Writes directly into the fake `interviews` collection (mirroring
`test_web_rounds_api.py`'s helpers) rather than going through the invite routes, since
what matters here is the AGGREGATION, not how a document was created.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app import interviews


def _assignment(fake_firestore, doc_id: str, **overrides) -> None:
    fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs[doc_id] = {
        "recruiterId": "uid-recruiter",
        "candidateEmailLower": f"{doc_id}@example.test",
        "candidateEmail": f"{doc_id}@example.test",
        "candidateName": None,
        "status": "assigned",
        "roundOrder": 0,
        **overrides,
    }


def test_one_candidate_with_two_rounds_is_one_card(
    authed_client: TestClient, fake_firestore
) -> None:
    """AC8: a candidate with multiple round documents does not appear twice."""
    _assignment(
        fake_firestore, "r1", candidateEmailLower="ada@x.test", candidateEmail="ada@x.test",
        candidateName="Ada Lovelace", roundOrder=0, roundTitle="Screening", status="completed",
        result={"overallScore": 70},
    )
    _assignment(
        fake_firestore, "r2", candidateEmailLower="ada@x.test", candidateEmail="ada@x.test",
        candidateName="Ada Lovelace", roundOrder=1, roundTitle="Technical", status="assigned",
    )

    res = authed_client.get("/api/web/candidates/board")
    assert res.status_code == 200
    cards = res.json()["cards"]
    assert len(cards) == 1
    card = cards[0]
    assert card["email"] == "ada@x.test"
    assert len(card["rounds"]) == 2


def test_current_round_is_the_highest_order_present(
    authed_client: TestClient, fake_firestore
) -> None:
    _assignment(fake_firestore, "r1", candidateEmailLower="bo@x.test", roundOrder=0, status="completed")
    _assignment(fake_firestore, "r2", candidateEmailLower="bo@x.test", roundOrder=1, status="in_progress")

    card = authed_client.get("/api/web/candidates/board").json()["cards"][0]
    assert card["currentRoundOrder"] == 1
    assert card["currentStatus"] == "in_progress"


def test_score_is_the_current_rounds_own_never_an_aggregate(
    authed_client: TestClient, fake_firestore
) -> None:
    """Explicit product requirement: no invented cross-round score."""
    _assignment(
        fake_firestore, "r1", candidateEmailLower="cy@x.test", roundOrder=0,
        status="completed", result={"overallScore": 90},
    )
    _assignment(
        fake_firestore, "r2", candidateEmailLower="cy@x.test", roundOrder=1,
        status="in_progress",  # no result yet
    )

    card = authed_client.get("/api/web/candidates/board").json()["cards"][0]
    assert card["currentScore"] is None  # NOT 90, and NOT an average


def test_missing_role_category_is_null_not_a_crash(
    authed_client: TestClient, fake_firestore
) -> None:
    _assignment(fake_firestore, "legacy", candidateEmailLower="old@x.test")
    card = authed_client.get("/api/web/candidates/board").json()["cards"][0]
    assert card["roleCategory"] is None


def test_role_category_filter_narrows_the_board(
    authed_client: TestClient, fake_firestore
) -> None:
    _assignment(fake_firestore, "a", candidateEmailLower="sde@x.test", candidateEmail="sde@x.test", roleCategory="sde")
    _assignment(fake_firestore, "b", candidateEmailLower="con@x.test", candidateEmail="con@x.test", roleCategory="consulting")

    res = authed_client.get("/api/web/candidates/board", params={"roleCategory": "sde"})
    emails = {c["email"] for c in res.json()["cards"]}
    assert emails == {"sde@x.test"}


def test_search_matches_name_or_email(authed_client: TestClient, fake_firestore) -> None:
    _assignment(fake_firestore, "a", candidateEmailLower="findme@x.test", candidateEmail="findme@x.test", candidateName="Zed Zephyr")
    _assignment(fake_firestore, "b", candidateEmailLower="other@x.test", candidateEmail="other@x.test", candidateName="Someone Else")

    by_email = authed_client.get("/api/web/candidates/board", params={"search": "findme"}).json()["cards"]
    assert len(by_email) == 1

    by_name = authed_client.get("/api/web/candidates/board", params={"search": "zephyr"}).json()["cards"]
    assert len(by_name) == 1
    assert by_name[0]["email"] == "findme@x.test"


def test_another_recruiters_candidates_are_invisible(
    authed_client: TestClient, fake_firestore
) -> None:
    _assignment(fake_firestore, "mine", candidateEmailLower="mine@x.test", candidateEmail="mine@x.test", recruiterId="uid-recruiter")
    _assignment(fake_firestore, "theirs", candidateEmailLower="theirs@x.test", candidateEmail="theirs@x.test", recruiterId="someone-else")

    cards = authed_client.get("/api/web/candidates/board").json()["cards"]
    emails = {c["email"] for c in cards}
    assert emails == {"mine@x.test"}


def test_board_is_read_only_no_write_route_exists(authed_client: TestClient) -> None:
    """There is no POST/PUT on this router — advancing a candidate stays whatever
    action the existing round-assign endpoint already provides."""
    res = authed_client.post("/api/web/candidates/board", json={})
    assert res.status_code in (404, 405)

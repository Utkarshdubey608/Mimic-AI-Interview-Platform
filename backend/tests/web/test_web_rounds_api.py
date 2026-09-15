"""Authoring a timeline from the web.

The web had `web_pipelines` and the Flutter app had `tests/{testId}/rounds`, and neither
knew about the other. These routes put the web on the shared model, so a round created
in a browser appears on the phone and vice versa.

`web_pipelines` is deliberately untouched and still drives the existing board — the two
models run in parallel until the rebuilt one is trusted.
"""

from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from app import interviews, rounds
from app.config import Settings


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _test_doc(fake_firestore, test_id: str = "t-1", **overrides) -> str:
    fake_firestore.collection(interviews.TESTS_COLLECTION).docs[test_id] = {
        "recruiterId": "uid-recruiter",
        "title": "Backend hiring",
        "type": "chat",
        **overrides,
    }
    return test_id


def _assignment(fake_firestore, doc_id: str, **overrides) -> None:
    fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs[doc_id] = {
        "recruiterId": "uid-recruiter",
        "testId": "t-1",
        "candidateEmailLower": f"{doc_id}@example.test",
        "candidateName": None,
        "status": "assigned",
        **overrides,
    }


def _stored(fake_firestore, doc_id: str) -> dict:
    return fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs[doc_id]


# ── creating ──────────────────────────────────────────────────────────────────


def test_a_round_is_added_to_the_end_of_the_timeline(
    authed_client: TestClient, fake_firestore
) -> None:
    """Order comes from the timeline's LENGTH, not from the body.

    An index the caller chose could collide with an existing round and make the running
    order arbitrary.
    """
    _test_doc(fake_firestore)

    first = authed_client.post(
        "/api/web/tests/t-1/rounds", json={"title": "Screen", "order": 99}
    )
    assert first.status_code == 201, first.text
    assert first.json()["order"] == 0

    second = authed_client.post("/api/web/tests/t-1/rounds", json={"title": "Technical"})
    assert second.json()["order"] == 1


def test_a_round_needs_a_name(authed_client: TestClient, fake_firestore) -> None:
    _test_doc(fake_firestore)
    assert authed_client.post("/api/web/tests/t-1/rounds", json={"title": "  "}).status_code == 400


def test_an_unknown_kind_is_refused_not_coerced(
    authed_client: TestClient, fake_firestore
) -> None:
    """Strict on write, lenient on read — the same split as interview outcomes.

    Storing an unrecognised kind would put a value on the timeline the Flutter client
    renders as something else entirely.
    """
    _test_doc(fake_firestore)
    response = authed_client.post(
        "/api/web/tests/t-1/rounds", json={"title": "Screen", "kind": "telepathy"}
    )
    assert response.status_code == 400
    assert "kind must be one of" in response.json()["detail"]


def test_a_round_cannot_close_before_it_opens(
    authed_client: TestClient, fake_firestore
) -> None:
    """Such a round is closed the instant it opens, and `state_at` would report it
    closed forever with no visible cause."""
    _test_doc(fake_firestore)
    response = authed_client.post(
        "/api/web/tests/t-1/rounds",
        json={
            "title": "Screen",
            "opensAt": "2027-06-10T09:00:00Z",
            "closesAt": "2027-06-01T09:00:00Z",
        },
    )
    assert response.status_code == 400
    assert "close before it opens" in response.json()["detail"]


def test_an_unparseable_date_is_refused_rather_than_dropped(
    authed_client: TestClient, fake_firestore
) -> None:
    """A recruiter who typed a date and had it silently ignored would believe the round
    has a deadline it does not have — and find out when candidates kept taking it."""
    _test_doc(fake_firestore)
    response = authed_client.post(
        "/api/web/tests/t-1/rounds", json={"title": "Screen", "closesAt": "next Friday"}
    )
    assert response.status_code == 400
    assert "closesAt" in response.json()["detail"]


def test_another_recruiters_test_is_a_404(
    authed_client: TestClient, fake_firestore
) -> None:
    _test_doc(fake_firestore, recruiterId="someone-else")
    assert authed_client.post(
        "/api/web/tests/t-1/rounds", json={"title": "Screen"}
    ).status_code == 404


# ── listing ───────────────────────────────────────────────────────────────────


def test_the_state_is_computed_not_stored(
    authed_client: TestClient, fake_firestore
) -> None:
    """Nothing persists it, so nothing can go stale.

    The web's pipelines AUTHORED candidate status, which is what let a status disagree
    with the clock while nobody noticed.
    """
    _test_doc(fake_firestore)
    authed_client.post(
        "/api/web/tests/t-1/rounds",
        json={"title": "Closed already", "closesAt": "2020-01-01T00:00:00Z"},
    )

    listed = authed_client.get("/api/web/tests/t-1/rounds").json()
    assert listed["rounds"][0]["state"] == rounds.STATE_CLOSED
    # And it is genuinely absent from storage.
    stored = rounds.collection(Settings(), "t-1").docs
    assert all("state" not in d for d in stored.values())


def test_the_list_reports_assignments_that_belong_to_no_round(
    authed_client: TestClient, fake_firestore
) -> None:
    """Non-zero means the test was created as a single round and given rounds later.

    Surfaced rather than hidden: those assignments are invisible to every round-scoped
    view, and a recruiter cannot fix what they are not told about.
    """
    _test_doc(fake_firestore)
    _assignment(fake_firestore, "legacy")
    authed_client.post("/api/web/tests/t-1/rounds", json={"title": "Screen"})

    assert authed_client.get("/api/web/tests/t-1/rounds").json()["legacyAssignments"] == 1


# ── ending ────────────────────────────────────────────────────────────────────


def test_ending_a_round_reports_how_many_it_locked_out(
    authed_client: TestClient, fake_firestore
) -> None:
    """Stamping `closedAt` on the round closes nothing — the candidate's device gates on
    `expiresAt` on their OWN assignment. `lockedOut` is how many it actually reached."""
    _test_doc(fake_firestore)
    created = authed_client.post(
        "/api/web/tests/t-1/rounds", json={"title": "Screen"}
    ).json()
    round_id = created["id"]
    _assignment(fake_firestore, "a", roundId=round_id)
    _assignment(fake_firestore, "b", roundId=round_id)
    _assignment(fake_firestore, "done", roundId=round_id, status="completed")

    response = authed_client.post(f"/api/web/tests/t-1/rounds/{round_id}/end")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["state"] == rounds.STATE_CLOSED
    # The completed one is skipped: the interview is already over.
    assert body["lockedOut"] == 2


def test_editing_a_round_cannot_reopen_a_closed_one(
    authed_client: TestClient, fake_firestore
) -> None:
    """Ending goes through its own route, so fixing a typo must not undo it."""
    _test_doc(fake_firestore)
    round_id = authed_client.post(
        "/api/web/tests/t-1/rounds", json={"title": "Screen"}
    ).json()["id"]
    authed_client.post(f"/api/web/tests/t-1/rounds/{round_id}/end")

    edited = authed_client.put(
        f"/api/web/tests/t-1/rounds/{round_id}",
        json={"title": "Screen (renamed)", "closedAt": None, "closedBy": None},
    )
    assert edited.status_code == 200
    assert edited.json()["state"] == rounds.STATE_CLOSED


# ── assigning and adopting ────────────────────────────────────────────────────


def test_assigning_with_no_list_offers_everyone_in_the_test(
    authed_client: TestClient, fake_firestore
) -> None:
    """Which is what adding a second round to an existing pipeline means."""
    _test_doc(fake_firestore)
    _assignment(fake_firestore, "ada", roundId="r-old")
    _assignment(fake_firestore, "grace", roundId="r-old")
    round_id = authed_client.post(
        "/api/web/tests/t-1/rounds", json={"title": "Round two"}
    ).json()["id"]

    response = authed_client.post(f"/api/web/tests/t-1/rounds/{round_id}/assign", json={})
    assert response.status_code == 200, response.text
    assert response.json()["assigned"] == 2


def test_assign_does_not_enforce_round_order_by_design(
    authed_client: TestClient, fake_firestore
) -> None:
    """Documents current, INTENTIONAL behaviour rather than a gap.

    RoundsModal's own "Add candidates" panel already relies on being able to put
    any candidate into any round on purpose (e.g. "this one doesn't need round 2").
    A candidate here holds no interview document for round 1 or round 2 at all, and
    round 3 accepts them directly anyway. A future reader must not "fix" this into
    a regression against that shipped flexibility — any round-adjacency guarantee
    belongs at the call site (see AdvanceCandidateModal on the web, which only ever
    offers `current + 1`), not here.
    """
    _test_doc(fake_firestore)
    authed_client.post("/api/web/tests/t-1/rounds", json={"title": "Round 1"})
    authed_client.post("/api/web/tests/t-1/rounds", json={"title": "Round 2"})
    round3 = authed_client.post("/api/web/tests/t-1/rounds", json={"title": "Round 3"}).json()["id"]

    response = authed_client.post(
        f"/api/web/tests/t-1/rounds/{round3}/assign",
        json={"candidates": ["skip-ahead@example.test"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["assigned"] == 1


def test_adopting_moves_roundless_assignments_in_without_recreating_them(
    authed_client: TestClient, fake_firestore
) -> None:
    """THE repair, and the reason it adopts rather than recreates.

    A pre-timeline assignment may already hold a completed interview, a transcript and a
    score. Recreating would throw all of that away — and assigning instead of adopting
    creates a SECOND document per candidate, so the same test appears twice on their
    screen, both launchable.
    """
    _test_doc(fake_firestore)
    _assignment(
        fake_firestore,
        "legacy",
        status="completed",
        result={"overallScore": 81, "evaluatedBy": "ai"},
    )
    round_id = authed_client.post(
        "/api/web/tests/t-1/rounds", json={"title": "Screen"}
    ).json()["id"]

    response = authed_client.post(f"/api/web/tests/t-1/rounds/{round_id}/adopt")
    assert response.json()["adopted"] == 1

    stored = _stored(fake_firestore, "legacy")
    assert stored["roundId"] == round_id
    assert stored["roundOrder"] == 0
    # The work it already held survived.
    assert stored["result"]["overallScore"] == 81
    assert stored["status"] == "completed"

    # And it is no longer counted as roundless.
    assert authed_client.get("/api/web/tests/t-1/rounds").json()["legacyAssignments"] == 0


def test_adopting_twice_adopts_nothing_the_second_time(
    authed_client: TestClient, fake_firestore
) -> None:
    _test_doc(fake_firestore)
    _assignment(fake_firestore, "legacy")
    round_id = authed_client.post(
        "/api/web/tests/t-1/rounds", json={"title": "Screen"}
    ).json()["id"]

    authed_client.post(f"/api/web/tests/t-1/rounds/{round_id}/adopt")
    assert authed_client.post(f"/api/web/tests/t-1/rounds/{round_id}/adopt").json()["adopted"] == 0


def test_rounds_require_a_token() -> None:
    from app.main import create_app

    assert TestClient(create_app()).get("/api/web/tests/t-1/rounds").status_code == 401


# ── the sessions list gained a batch ──────────────────────────────────────────


def test_a_session_row_reports_which_test_it_belongs_to(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """The web had no concept of a test, so a timeline had nothing to hang off.

    Mobile's entire recruiter dashboard is tests; here a session did not even know its
    batch. Read from the shared assignment, because a web session does not carry it.
    """
    _test_doc(fake_firestore)
    _assignment(fake_firestore, "ada")

    row = next(
        r for r in authed_client.get("/api/web/sessions").json() if r["id"] == "ada"
    )
    assert row["testId"] == "t-1"


def test_a_session_with_no_assignment_has_no_test(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """Null rather than pooled into a fake batch.

    Sessions created before the shared assignment record simply do not belong to one,
    and inventing a batch would put unrelated interviews on one timeline.
    """
    _run(
        fake_store.sessions.put(
            {
                "id": "orphan",
                "recruiterId": "uid-recruiter",
                "templateId": None,
                "track": "chat",
                "status": "completed",
                "createdAt": "2027-01-01T00:00:00Z",
                "questions": [],
            }
        )
    )

    row = next(
        r for r in authed_client.get("/api/web/sessions").json() if r["id"] == "orphan"
    )
    assert row["testId"] is None


# ── a résumé round routes the candidate elsewhere ─────────────────────────────


def test_a_candidate_row_says_which_kind_of_round_it_is(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """`roundKind` is what the client routes on, NOT `track`.

    A résumé round's assignment carries `type: chat` (it has no interview track at
    all), so routing on the track would send the candidate into the interview engine —
    a chat with zero questions, and no way to tell that from a broken page. The same
    failure the MCQ gate exists to stop on the other client.
    """
    _test_doc(fake_firestore)
    fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs["res-1"] = {
        "recruiterId": "uid-recruiter",
        "testId": "t-1",
        "roundId": "r-1",
        "roundKind": "resume",
        "candidateEmail": "recruiter@talbotiq.com",
        "candidateEmailLower": "recruiter@talbotiq.com",
        "title": "Backend hiring — Résumé screen",
        "type": "chat",
        "status": "assigned",
    }

    row = next(
        r for r in authed_client.get("/api/web/sessions/mine").json() if r["id"] == "res-1"
    )
    assert row["roundKind"] == "resume"
    # The track still says chat, which is exactly why the client cannot route on it.
    assert row["track"] == "chat"


def test_an_ordinary_interview_has_no_round_kind_to_route_on(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """Null, not a default: an interview outside a timeline belongs to no round, and
    inventing `chat` here would be indistinguishable from a real chat ROUND."""
    fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs["plain"] = {
        "recruiterId": "uid-recruiter",
        "candidateEmail": "recruiter@talbotiq.com",
        "candidateEmailLower": "recruiter@talbotiq.com",
        "title": "Backend Engineer — interview",
        "type": "chat",
        "status": "assigned",
    }

    row = next(
        r for r in authed_client.get("/api/web/sessions/mine").json() if r["id"] == "plain"
    )
    assert row["roundKind"] is None


# ── who is actually in each round ─────────────────────────────────────────────


def test_the_timeline_reports_who_is_in_each_round(
    authed_client: TestClient, fake_firestore
) -> None:
    """The roster, keyed by roundId.

    The browser cannot work this out from the sessions list: that list is built from web
    SESSION rows, and somebody assigned to a round has no session row until they open
    their invite — so a candidate advanced into round 2 was invisible to every
    round-scoped view at exactly the moment a recruiter still has the option to undo it.
    The UI showed "0 candidates" on a round the server had just refused to re-assign
    because two people were already in it.
    """
    _test_doc(fake_firestore)
    first = authed_client.post("/api/web/tests/t-1/rounds", json={"title": "Screen"}).json()
    second = authed_client.post("/api/web/tests/t-1/rounds", json={"title": "Technical"}).json()

    _assignment(fake_firestore, "a", roundId=first["id"], candidateName="Ada")
    _assignment(fake_firestore, "b", roundId=first["id"], status="completed")
    _assignment(fake_firestore, "c", roundId=second["id"])
    # Predates the timeline: belongs to no round, and must not be attributed to one.
    _assignment(fake_firestore, "d")

    body = authed_client.get("/api/web/tests/t-1/rounds").json()
    rosters = body["rosters"]

    assert [r["email"] for r in rosters[first["id"]]] == ["a@example.test", "b@example.test"]
    assert [r["email"] for r in rosters[second["id"]]] == ["c@example.test"]
    # The empty key is where pre-timeline assignments land — the same ones
    # `legacyAssignments` counts.
    assert [r["email"] for r in rosters[""]] == ["d@example.test"]
    assert body["legacyAssignments"] == 1

    ada = next(r for r in rosters[first["id"]] if r["email"] == "a@example.test")
    assert ada["name"] == "Ada"
    # Sent raw, so the client can say "not started" without this route owning the words.
    assert ada["status"] == "assigned"
    assert rosters[first["id"]][1]["status"] == "completed"


def test_a_roster_never_leaks_another_recruiters_candidates(
    authed_client: TestClient, fake_firestore
) -> None:
    _test_doc(fake_firestore)
    created = authed_client.post("/api/web/tests/t-1/rounds", json={"title": "Screen"}).json()

    _assignment(fake_firestore, "mine", roundId=created["id"])
    _assignment(fake_firestore, "theirs", roundId=created["id"], recruiterId="uid-someone-else")

    rosters = authed_client.get("/api/web/tests/t-1/rounds").json()["rosters"]
    assert [r["email"] for r in rosters[created["id"]]] == ["mine@example.test"]


def test_assigning_a_named_list_keeps_the_candidates_names(
    authed_client: TestClient, fake_firestore
) -> None:
    """Picking three people by hand used to produce three NAMELESS rows.

    A supplied list is a list of addresses; the names live on the test's existing
    assignments. Reading them either way is what makes the picker and "assign everyone"
    produce the same rows.
    """
    _test_doc(fake_firestore)
    first = authed_client.post("/api/web/tests/t-1/rounds", json={"title": "Screen"}).json()
    second = authed_client.post("/api/web/tests/t-1/rounds", json={"title": "Technical"}).json()

    _assignment(fake_firestore, "ada", roundId=first["id"], candidateName="Ada Lovelace")

    moved = authed_client.post(
        f"/api/web/tests/t-1/rounds/{second['id']}/assign",
        json={"candidates": ["ada@example.test"]},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["assigned"] == 1

    roster = authed_client.get("/api/web/tests/t-1/rounds").json()["rosters"][second["id"]]
    assert roster[0]["name"] == "Ada Lovelace"

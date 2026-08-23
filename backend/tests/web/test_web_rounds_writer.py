"""The two round writes that are easy to get wrong.

Both mirror `InterviewRepository` in the Flutter app, which is where they were correct
first, and both exist to prevent a specific failure rather than to model something.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from app import interviews, rounds, rounds_writer
from app.config import Settings

NOW = datetime(2027, 6, 1, 12, 0, tzinfo=timezone.utc)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _round(**overrides) -> rounds.Round:
    base = dict(
        id="r-1",
        test_id="t-1",
        recruiter_id="uid-recruiter",
        order=1,
        title="Technical screen",
        opens_at=NOW,
        closes_at=NOW + timedelta(days=7),
    )
    return rounds.Round(**{**base, **overrides})


def _assignment(fake_firestore, doc_id: str, **overrides) -> None:
    fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs[doc_id] = {
        "recruiterId": "uid-recruiter",
        "testId": "t-1",
        "roundId": "r-1",
        "candidateEmailLower": f"{doc_id}@example.test",
        "status": "assigned",
        "expiresAt": NOW + timedelta(days=7),
        **overrides,
    }


def _stored(fake_firestore, doc_id: str) -> dict:
    return fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs[doc_id]


# ── the window has to reach the candidate ─────────────────────────────────────


def test_ending_a_round_locks_the_candidates_out(fake_firestore) -> None:
    """THE reason `propagate_window` exists.

    A candidate's device has no permission to read round documents —
    `availableFrom`/`expiresAt` on their OWN assignment is the only thing it checks. So
    stamping `closedAt` on the round alone closes nothing: they still hold the original
    deadline and can still start the interview.
    """
    _assignment(fake_firestore, "a")
    _assignment(fake_firestore, "b")

    locked = _run(rounds_writer.close_now(Settings(), _round()))

    assert locked == 2
    for doc_id in ("a", "b"):
        # The sentinel, not the original future deadline — that is the lock-out.
        assert "DELETE_FIELD" not in repr(_stored(fake_firestore, doc_id)["expiresAt"])
        assert _stored(fake_firestore, doc_id)["expiresAt"] != NOW + timedelta(days=7)


def test_the_round_document_records_who_ended_it(fake_firestore) -> None:
    """`closedBy: manual` is what distinguishes "a recruiter stopped this" from "the
    deadline passed", and the timeline says which."""
    _assignment(fake_firestore, "a")
    _run(rounds_writer.close_now(Settings(), _round()))

    stored = rounds.collection(Settings(), "t-1").docs["r-1"]
    assert stored["closedBy"] == rounds.CLOSED_BY_MANUAL
    assert stored["closedAt"] is not None

    # And it reads back as closed even though `closesAt` is still a week away — the
    # manual close has to beat the schedule.
    parsed = rounds.Round.from_document("r-1", "t-1", {**_round().to_create_map(), **stored})
    assert parsed.was_ended_manually is True


def test_a_completed_assignment_is_not_touched(fake_firestore) -> None:
    """The interview is already over, and at a thousand candidates those are most of
    the writes."""
    _assignment(fake_firestore, "done", status="completed")
    _assignment(fake_firestore, "live")

    locked = _run(rounds_writer.close_now(Settings(), _round()))

    assert locked == 1
    assert _stored(fake_firestore, "done")["expiresAt"] == NOW + timedelta(days=7)


def test_another_recruiters_assignments_are_never_reached(fake_firestore) -> None:
    _assignment(fake_firestore, "mine")
    _assignment(fake_firestore, "theirs", recruiterId="someone-else")

    locked = _run(rounds_writer.close_now(Settings(), _round()))

    assert locked == 1
    assert _stored(fake_firestore, "theirs")["expiresAt"] == NOW + timedelta(days=7)


def test_editing_a_title_does_not_rewrite_every_assignment(fake_firestore) -> None:
    """Otherwise fixing a typo costs a thousand writes.

    The previous document is read purely to decide this — the alternative is making the
    caller declare that the dates changed, which is the kind of thing a caller
    eventually forgets.
    """
    _assignment(fake_firestore, "a")
    rounds_collection = interviews.tests_collection(Settings()).document("t-1").collection(
        rounds.ROUNDS_SUBCOLLECTION
    )
    rounds_collection.document("r-1").set(_round().to_create_map())

    before = _stored(fake_firestore, "a")["expiresAt"]
    _run(rounds_writer.update(Settings(), _round(title="Technical screen (v2)")))

    assert _stored(fake_firestore, "a")["expiresAt"] == before


def test_moving_the_window_does_rewrite_them(fake_firestore) -> None:
    _assignment(fake_firestore, "a")
    rounds_collection = interviews.tests_collection(Settings()).document("t-1").collection(
        rounds.ROUNDS_SUBCOLLECTION
    )
    rounds_collection.document("r-1").set(_round().to_create_map())

    moved = _round(closes_at=NOW + timedelta(days=14))
    _run(rounds_writer.update(Settings(), moved))

    assert _stored(fake_firestore, "a")["expiresAt"] == NOW + timedelta(days=14)


# ── assigning ─────────────────────────────────────────────────────────────────


def test_assigning_stamps_everything_the_candidates_device_needs(fake_firestore) -> None:
    """It cannot read round documents, so `roundOrder`, `roundKind` and the window all
    have to be copied onto the assignment — it shows "Round 2 of 4" from these."""
    created = _run(
        rounds_writer.assign(
            Settings(),
            _round(kind=rounds.KIND_VOICE),
            recruiter_email="r@t.test",
            recruiter_name="Grace",
            test_title="Backend hiring",
            candidates={"ada@example.test": "Ada"},
        )
    )
    assert created == 1

    written = next(
        d
        for d in fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs.values()
        if d.get("candidateEmailLower") == "ada@example.test"
    )
    assert written["roundId"] == "r-1"
    assert written["roundOrder"] == 1
    assert written["roundKind"] == rounds.KIND_VOICE
    assert written["expiresAt"] == NOW + timedelta(days=7)
    # The precise track, so the web client never guesses it from `type`.
    assert written["mode"] == "voice"


def test_assigning_twice_does_not_reset_anyone(fake_firestore) -> None:
    """What makes it safe to press again after adding two more people.

    Overwriting would reset the status and wipe the result of the fifty who already
    took the round.
    """
    args = dict(
        recruiter_email="r@t.test",
        recruiter_name=None,
        test_title="Backend hiring",
        candidates={"ada@example.test": "Ada"},
    )
    _run(rounds_writer.assign(Settings(), _round(), **args))
    again = _run(rounds_writer.assign(Settings(), _round(), **args))

    assert again == 0
    matching = [
        d
        for d in fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs.values()
        if d.get("candidateEmailLower") == "ada@example.test"
    ]
    assert len(matching) == 1, "a second document is the same test twice on their screen"


def test_a_resume_round_assigns_a_chat_type_with_no_track(fake_firestore) -> None:
    """A résumé screen is not an interview track. `mode_for_kind` returns "", and the
    Dart model already expects `type: chat` for one."""
    _run(
        rounds_writer.assign(
            Settings(),
            _round(kind=rounds.KIND_RESUME),
            recruiter_email="r@t.test",
            recruiter_name=None,
            test_title="Backend hiring",
            candidates={"ada@example.test": None},
        )
    )
    written = next(
        d
        for d in fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs.values()
        if d.get("candidateEmailLower") == "ada@example.test"
    )
    assert written["roundKind"] == rounds.KIND_RESUME
    assert written["type"] == "chat"

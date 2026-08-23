"""A test's timeline — the model both clients now share.

Two multi-round features existed and neither knew about the other: mobile's
`tests/{id}/rounds` and the web's `web_pipelines`. A candidate advanced on one was
invisible on the other. This is mobile's model, and these tests pin the three
properties that made it the one to keep.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app import rounds

NOW = datetime(2027, 6, 1, 12, 0, tzinfo=timezone.utc)


def _round(**overrides) -> rounds.Round:
    return rounds.Round(
        id="r-1",
        test_id="t-1",
        recruiter_id="uid-recruiter",
        order=0,
        title="Technical screen",
        **overrides,
    )


# ── state is DERIVED from the clock ───────────────────────────────────────────


def test_a_round_with_no_window_is_open() -> None:
    """No dates means "available now", not "misconfigured"."""
    assert _round().state_at(NOW) == rounds.STATE_OPEN


def test_a_future_opening_is_scheduled() -> None:
    assert (
        _round(opens_at=NOW + timedelta(days=1)).state_at(NOW) == rounds.STATE_SCHEDULED
    )


def test_a_passed_deadline_is_closed() -> None:
    assert _round(closes_at=NOW - timedelta(hours=1)).state_at(NOW) == rounds.STATE_CLOSED


def test_a_manual_close_beats_a_future_deadline() -> None:
    """"End round now" has to win over a `closesAt` that has not arrived.

    Order matters here: checking the schedule first would report a manually-ended round
    as still open, which is precisely what the recruiter just stopped.
    """
    ended = _round(closes_at=NOW + timedelta(days=7), closed_at=NOW - timedelta(minutes=1))
    assert ended.state_at(NOW) == rounds.STATE_CLOSED


def test_nothing_stores_the_state() -> None:
    """It is derived, so it cannot go stale — the whole reason this model won.

    The web's pipelines AUTHORED candidate status, which meant a status could disagree
    with the clock and nothing would notice.
    """
    written = _round(opens_at=NOW, closes_at=NOW + timedelta(days=1)).to_create_map()
    for forbidden in ("state", "status", "isOpen", "isClosed"):
        assert forbidden not in written


def test_the_clock_is_an_argument_not_read_internally() -> None:
    """So a whole timeline renders against ONE instant instead of drifting per row."""
    r = _round(closes_at=NOW)
    assert r.state_at(NOW - timedelta(seconds=1)) == rounds.STATE_OPEN
    assert r.state_at(NOW + timedelta(seconds=1)) == rounds.STATE_CLOSED


# ── the write shape ───────────────────────────────────────────────────────────


def test_a_new_round_is_never_born_closed() -> None:
    written = _round().to_create_map()
    assert written["closedAt"] is None
    assert written["closedBy"] is None


def test_an_edit_cannot_reopen_a_closed_round() -> None:
    """`closedAt`/`closedBy` are omitted from the update shape deliberately.

    Ending a round goes through `close_now`, so fixing a typo in a title must not be
    able to bring a closed round back to life.
    """
    updated = _round(closed_at=NOW).to_update_map()
    assert "closedAt" not in updated
    assert "closedBy" not in updated


def test_the_field_names_are_the_dart_models() -> None:
    """They cannot be renamed — `interview_round.dart` reads them."""
    written = _round().to_create_map()
    assert set(written) >= {
        "testId",
        "recruiterId",
        "order",
        "title",
        "kind",
        "config",
        "opensAt",
        "closesAt",
        "criteria",
    }


def test_a_round_round_trips_through_its_document() -> None:
    original = _round(
        kind=rounds.KIND_VOICE,
        opens_at=NOW,
        closes_at=NOW + timedelta(days=2),
        criteria=rounds.Criteria(required_skills=["Kafka"], min_years=3, min_score=70),
    )
    document = original.to_create_map()
    parsed = rounds.Round.from_document("r-1", "t-1", document)

    assert parsed.kind == rounds.KIND_VOICE
    assert parsed.opens_at == NOW
    assert parsed.criteria.required_skills == ["Kafka"]
    assert parsed.criteria.min_years == 3
    assert parsed.criteria.min_score == 70


# ── kinds ─────────────────────────────────────────────────────────────────────


def test_an_unknown_kind_reads_as_chat_rather_than_breaking() -> None:
    """Lenient on read: an unrecognised value must render, not break a timeline."""
    assert rounds.kind_from_wire("telepathy") == rounds.KIND_CHAT
    assert rounds.kind_from_wire(None) == rounds.KIND_CHAT
    assert rounds.kind_from_wire(rounds.KIND_TWO_WAY) == rounds.KIND_TWO_WAY


def test_a_resume_round_is_not_an_interview() -> None:
    """It is a submission step — there is no session for a candidate to join."""
    assert rounds.kind_is_interview(rounds.KIND_RESUME) is False
    assert rounds.kind_is_interview(rounds.KIND_CHAT) is True


def test_only_a_two_way_round_is_recruiter_scored() -> None:
    """A human was in the room and there is no recording for a model to read."""
    assert rounds.kind_is_recruiter_scored(rounds.KIND_TWO_WAY) is True
    for kind in (rounds.KIND_CHAT, rounds.KIND_VIDEO, rounds.KIND_VOICE):
        assert rounds.kind_is_recruiter_scored(kind) is False


def test_a_resume_round_assigns_no_interview_track() -> None:
    """The two vocabularies overlap but are not identical: `resume` is a round kind
    with no track at all, so the mapping is explicit rather than assumed."""
    assert rounds.mode_for_kind(rounds.KIND_RESUME) == ""
    assert rounds.mode_for_kind(rounds.KIND_VOICE) == "voice"
    assert rounds.mode_for_kind(rounds.KIND_TWO_WAY) == "two_way"


# ── criteria ──────────────────────────────────────────────────────────────────


def test_a_null_in_a_skill_list_is_dropped_not_stringified() -> None:
    """`str(None)` is the literal "None", which would be sent to the scorer as a skill
    named None and scored against."""
    parsed = rounds.Criteria.from_map({"requiredSkills": ["Kafka", None, "  ", 42]})
    assert parsed.required_skills == ["Kafka"]


def test_criteria_match_the_reader_the_resume_scorer_already_uses() -> None:
    """`app.interviews.criteria_from_map` reads the same document.

    Two readers of one shape is a drift risk, so they are asserted equal here rather
    than merged — `app.interviews` owns the frozen INTERVIEW schema and `app.rounds`
    owns the round schema, and one module owning both would make a round change look
    like an interview change in review.
    """
    from app import interviews

    stored = {
        "requiredSkills": ["Kafka", "SQL"],
        "niceToHave": ["Go"],
        "minYears": 4,
        "minScore": 65,
    }
    mine = rounds.Criteria.from_map(stored)
    theirs = interviews.criteria_from_map(stored)

    assert mine.required_skills == theirs.required_skills
    assert mine.nice_to_have == theirs.nice_to_have
    assert mine.min_years == theirs.min_years
    assert mine.min_score == theirs.min_score


def test_empty_criteria_are_recognised_as_empty() -> None:
    """"Score it on the role in general" is a valid request, not a misconfiguration."""
    assert rounds.Criteria().is_empty is True
    assert rounds.Criteria(min_score=50).is_empty is False

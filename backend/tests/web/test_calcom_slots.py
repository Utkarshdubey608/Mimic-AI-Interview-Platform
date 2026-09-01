"""Slot arithmetic for the Cal.com booking tools.

The HTTP is the easy part. What will actually break a booking is instant
comparison: `2026-09-01T09:30:00+05:30` and `2026-09-01T04:00:00Z` are the SAME
moment, and a naive string or wall-clock comparison decides they are not. The
voice agent would then tell a prospect their requested time is unavailable while
the calendar is sitting wide open, which is exactly the "never guess" failure the
whole design exists to prevent.

Pure functions, no network. Every case here is one a real caller can produce.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.web.services.calcom import (
    find_slot,
    query_window,
    slot_instant,
)

IST = ZoneInfo("Asia/Kolkata")
NY = ZoneInfo("America/New_York")


# ── instant comparison ────────────────────────────────────────────────────────


def test_the_same_moment_in_two_notations_is_one_instant() -> None:
    assert slot_instant("2026-09-01T09:30:00+05:30") == slot_instant("2026-09-01T04:00:00Z")


def test_a_naive_timestamp_is_refused_rather_than_assumed_utc() -> None:
    """Guessing the timezone of a bare timestamp is the single most expensive
    assumption available here."""
    with pytest.raises(ValueError):
        slot_instant("2026-09-01T09:30:00")


def test_a_requested_time_matches_its_slot_across_notations() -> None:
    requested = datetime(2026, 9, 1, 9, 30, tzinfo=IST)
    slots = ["2026-09-01T03:00:00Z", "2026-09-01T04:00:00Z", "2026-09-01T05:00:00Z"]
    assert find_slot(requested, slots) == "2026-09-01T04:00:00Z"


def test_a_time_that_is_not_offered_returns_none() -> None:
    requested = datetime(2026, 9, 1, 9, 45, tzinfo=IST)
    assert find_slot(requested, ["2026-09-01T04:00:00Z"]) is None


def test_matching_ignores_seconds_and_microseconds() -> None:
    requested = datetime(2026, 9, 1, 9, 30, 41, 5, tzinfo=IST)
    assert find_slot(requested, ["2026-09-01T04:00:00Z"]) == "2026-09-01T04:00:00Z"


def test_a_naive_request_is_refused() -> None:
    with pytest.raises(ValueError):
        find_slot(datetime(2026, 9, 1, 9, 30), ["2026-09-01T04:00:00Z"])


def test_an_unparseable_slot_is_skipped_not_fatal() -> None:
    """One malformed entry from the provider must not lose the whole response."""
    requested = datetime(2026, 9, 1, 9, 30, tzinfo=IST)
    assert find_slot(requested, ["nonsense", "2026-09-01T04:00:00Z"]) == "2026-09-01T04:00:00Z"


def test_a_caller_in_another_zone_matches_the_same_slot() -> None:
    """The prospect may be anywhere. 04:00 UTC is one instant regardless of who
    is describing it."""
    requested = datetime(2026, 9, 1, 0, 0, tzinfo=NY)  # 04:00 UTC in EDT
    assert find_slot(requested, ["2026-09-01T04:00:00Z"]) == "2026-09-01T04:00:00Z"


# ── query window ──────────────────────────────────────────────────────────────


def test_the_window_covers_the_local_day_not_the_utc_day() -> None:
    """A 00:30 IST slot falls on the PREVIOUS date in UTC. Querying the UTC day
    silently loses the first five and a half hours of every Indian morning."""
    start, end = query_window(datetime(2026, 9, 1, 0, 30, tzinfo=IST), tz="Asia/Kolkata")
    assert start <= date(2026, 9, 1) <= end
    assert start <= date(2026, 8, 31)


def test_the_window_spans_at_least_the_requested_day() -> None:
    start, end = query_window(datetime(2026, 9, 1, 12, 0, tzinfo=IST), tz="Asia/Kolkata")
    assert end - start >= timedelta(days=1)


def test_a_late_evening_request_still_includes_the_next_utc_day() -> None:
    start, end = query_window(datetime(2026, 9, 1, 23, 45, tzinfo=NY), tz="America/New_York")
    assert end >= date(2026, 9, 2)


def test_the_window_is_refused_for_a_naive_time() -> None:
    with pytest.raises(ValueError):
        query_window(datetime(2026, 9, 1, 9, 30), tz="Asia/Kolkata")

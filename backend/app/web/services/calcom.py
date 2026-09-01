"""Cal.com as the availability authority, for the web form and the voice agent alike.

One calendar, two channels. A demo booked through the marketing embed and a demo
booked by the outbound agent must contend for the same slots, or the two will
cheerfully double-book the same half hour and someone will find out on the call.

WHAT THIS FILE IS CAREFUL ABOUT, and it is not the HTTP.

`2026-09-01T09:30:00+05:30` and `2026-09-01T04:00:00Z` are the SAME MOMENT. A
comparison on strings, or on wall-clock fields, decides they are not — and the
agent then tells a prospect that their requested time is unavailable while the
calendar sits wide open. That is the "never guess" failure the whole design
exists to prevent, arriving through arithmetic rather than through the model. So
every comparison here goes through a UTC instant, and a timestamp with no
timezone is REFUSED rather than assumed to be UTC.

The other trap is the query window. A 00:30 IST slot falls on the PREVIOUS date
in UTC, so asking Cal for "2026-09-01" in UTC silently loses the first five and a
half hours of every Indian morning. `query_window` widens by a day on each side
rather than trusting a date to mean the same thing in two zones.

Natural language is deliberately absent. "Tomorrow at half nine" is the model's
job to resolve into an instant; this file only ever sees one.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

from app.config import Settings
from app.providers.base import http_client

logger = logging.getLogger("web.calcom")

API_BASE = "https://api.cal.com/v2"
SLOTS_API_VERSION = "2024-09-04"
BOOKINGS_API_VERSION = "2024-08-13"


class CalcomNotConfigured(RuntimeError):
    """No Cal.com credentials, so availability cannot be known. Raised, never
    worked around — inventing a slot is the one thing that must not happen."""


class CalcomUnavailable(RuntimeError):
    """Cal.com is configured but did not answer. A transient infrastructure fault,
    and the caller must say so rather than offer a time it cannot stand behind."""


# ── instants ──────────────────────────────────────────────────────────────────


def slot_instant(value: str) -> datetime:
    """One slot timestamp as an aware UTC datetime.

    A naive timestamp raises. Assuming UTC for a bare local time is how a booking
    lands five and a half hours from where the prospect expected it.
    """
    text = str(value).strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    parsed = datetime.fromisoformat(text)  # ValueError on anything unparseable
    if parsed.tzinfo is None:
        raise ValueError(f"slot timestamp {value!r} carries no timezone")
    return parsed.astimezone(timezone.utc)


def find_slot(requested: datetime, slots: Iterable[str]) -> str | None:
    """The offered slot that is the same MOMENT as `requested`, or None.

    Compared to the minute: a caller may hand over seconds from a clock read, and
    a slot is a half-hour boundary. A malformed entry is skipped rather than
    thrown, so one bad row from the provider cannot lose the whole response.
    """
    if requested.tzinfo is None:
        raise ValueError("requested time carries no timezone")
    target = requested.astimezone(timezone.utc).replace(second=0, microsecond=0)
    for slot in slots:
        try:
            if slot_instant(slot).replace(second=0, microsecond=0) == target:
                return slot
        except (ValueError, TypeError):
            logger.warning("skipping unparseable slot from cal.com: %r", slot)
            continue
    return None


def query_window(when: datetime, *, tz: str) -> tuple[date, date]:
    """A date range that certainly contains `when` as seen in `tz`.

    Widened by a day either side on purpose. A date does not mean the same span
    in two zones, and over-fetching a day is free where missing one is a booking
    the prospect was told they could not have.
    """
    if when.tzinfo is None:
        raise ValueError("requested time carries no timezone")
    day = when.astimezone(ZoneInfo(tz)).date()
    return day - timedelta(days=1), day + timedelta(days=1)


# ── configuration ─────────────────────────────────────────────────────────────


def configured(settings: Settings) -> bool:
    return bool(getattr(settings, "calcom_api_key", "").strip())


def _key(settings: Settings) -> str:
    key = getattr(settings, "calcom_api_key", "").strip()
    if not key:
        raise CalcomNotConfigured(
            "Scheduling is not configured. Set CALCOM_API_KEY and CALCOM_EVENT_TYPE_ID."
        )
    return key


def _headers(settings: Settings, *, version: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_key(settings)}",
        "cal-api-version": version,
        "Content-Type": "application/json",
    }


def _event_type_id(settings: Settings) -> int:
    raw = getattr(settings, "calcom_event_type_id", 0)
    if not raw:
        raise CalcomNotConfigured("CALCOM_EVENT_TYPE_ID is not set")
    return int(raw)


async def _get(settings: Settings, path: str, *, params: dict, version: str) -> dict:
    try:
        response = await http_client().get(
            f"{API_BASE}{path}", params=params, headers=_headers(settings, version=version)
        )
    except httpx.HTTPError as exc:
        raise CalcomUnavailable(f"cal.com did not answer: {exc}") from exc
    if response.status_code >= 400:
        raise CalcomUnavailable(f"cal.com returned {response.status_code} for {path}")
    return response.json() or {}


async def _post(settings: Settings, path: str, *, body: dict, version: str) -> dict:
    try:
        response = await http_client().post(
            f"{API_BASE}{path}", json=body, headers=_headers(settings, version=version)
        )
    except httpx.HTTPError as exc:
        raise CalcomUnavailable(f"cal.com did not answer: {exc}") from exc
    if response.status_code >= 400:
        raise CalcomUnavailable(f"cal.com returned {response.status_code} for {path}")
    return response.json() or {}


# ── the tools the agent may request ───────────────────────────────────────────


def flatten_slots(payload: dict) -> list[str]:
    """Cal returns slots grouped by local date; the agent wants one ordered list."""
    data = payload.get("data") or {}
    out: list[str] = []
    for _day, entries in sorted(data.items()):
        for entry in entries or []:
            start = entry.get("start") if isinstance(entry, dict) else entry
            if start:
                out.append(str(start))
    return out


async def available_slots(
    settings: Settings, *, start: date, end: date, tz: str
) -> list[str]:
    """Every bookable start between two dates, as ISO strings."""
    payload = await _get(
        settings,
        "/slots",
        params={
            "eventTypeId": _event_type_id(settings),
            "start": start.isoformat(),
            "end": end.isoformat(),
            "timeZone": tz,
        },
        version=SLOTS_API_VERSION,
    )
    return flatten_slots(payload)


async def check_requested_time(settings: Settings, *, when: datetime, tz: str) -> str | None:
    """The slot matching what the prospect actually asked for, or None.

    This is the tool that lets the agent honour "Thursday at two" instead of
    reading a list at them. It answers only from what Cal offers.
    """
    start, end = query_window(when, tz=tz)
    return find_slot(when, await available_slots(settings, start=start, end=end, tz=tz))


async def create_booking(
    settings: Settings,
    *,
    when: datetime,
    tz: str,
    name: str,
    email: str,
    company: str = "",
    client_ref: str = "",
) -> dict:
    """Book a slot, re-checking availability first.

    The re-check is not belt and braces. Between offering a time and the prospect
    saying yes, the web embed may have taken it — so the offer is re-validated
    against Cal at the moment of writing, and a vanished slot raises rather than
    booking over someone.
    """
    if await check_requested_time(settings, when=when, tz=tz) is None:
        raise CalcomUnavailable("that slot is no longer available")
    return await _post(
        settings,
        "/bookings",
        body={
            "eventTypeId": _event_type_id(settings),
            "start": when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "attendee": {"name": name, "email": email, "timeZone": tz},
            "bookingFieldsResponses": {"company": company, "clientRef": client_ref},
        },
        version=BOOKINGS_API_VERSION,
    )


async def reschedule_booking(
    settings: Settings, *, uid: str, when: datetime, tz: str, reason: str = ""
) -> dict:
    """Move a booking, re-checking the new time first — same reason as above."""
    if await check_requested_time(settings, when=when, tz=tz) is None:
        raise CalcomUnavailable("that slot is no longer available")
    return await _post(
        settings,
        f"/bookings/{uid}/reschedule",
        body={
            "start": when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "reschedulingReason": reason or "Rescheduled by request during a confirmation call",
        },
        version=BOOKINGS_API_VERSION,
    )


async def cancel_booking(settings: Settings, *, uid: str, reason: str = "") -> dict:
    """Cancel. The caller confirms with the prospect BEFORE reaching this."""
    return await _post(
        settings,
        f"/bookings/{uid}/cancel",
        body={"cancellationReason": reason or "Cancelled by request during a confirmation call"},
        version=BOOKINGS_API_VERSION,
    )

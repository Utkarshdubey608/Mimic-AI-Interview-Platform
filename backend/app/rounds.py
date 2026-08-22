"""Rounds — a test's timeline, and the one model both clients use.

`tests/{testId}/rounds/{roundId}`. A subcollection rather than a top-level collection:
a round is never read outside its test, and nesting keeps the security rule to a single
`recruiterId` check.

**Why this is the shared model rather than the web's pipelines.** Both clients grew a
multi-round feature and neither knew about the other's. The web's (`web_pipelines` +
`web_pipeline_candidates`) authored candidate status as stored state; this one derives
it, and three of its properties are the reason it won:

1. **State is DERIVED from the clock.** Nothing stores `scheduled`/`open`/`closed`, so
   nothing can go stale. `state_at` takes the instant as an argument, so a list of
   rounds renders against one consistent moment instead of drifting per row.

2. **The window is COPIED onto each assignment.** A candidate's device has no
   permission to read round documents, and `availableFrom`/`expiresAt` on their own
   assignment is the only thing it checks. Every write that moves a round's window
   therefore has to push it down — which is why "end round now" cannot just stamp
   `closedAt`: that locks nobody out.

3. **Ranks are STAMPED, not recomputed.** A rank computed when the candidate looked
   would shift under them every time anybody else in the round was re-scored.

Field names are `interview_round.dart`'s and cannot be renamed — the Flutter client
reads them.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.config import Settings
from app.interviews import ROUNDS_SUBCOLLECTION, TESTS_COLLECTION, tests_collection

logger = logging.getLogger("rounds")

# ── vocabulary ────────────────────────────────────────────────────────────────
#
# `RoundKind` in interview_round.dart. A superset of the interview tracks: `resume` is
# a submission step with no interview session at all.
KIND_RESUME = "resume"
KIND_CHAT = "chat"
KIND_VIDEO = "video"
KIND_VOICE = "voice"
KIND_TWO_WAY = "two_way"
KINDS = (KIND_RESUME, KIND_CHAT, KIND_VIDEO, KIND_VOICE, KIND_TWO_WAY)

# Derived, never stored. See the module docstring.
STATE_SCHEDULED = "scheduled"
STATE_OPEN = "open"
STATE_CLOSED = "closed"

CLOSED_BY_MANUAL = "manual"
CLOSED_BY_AUTO = "auto"


def kind_from_wire(value: object) -> str:
    """A round kind, defaulting to `chat` exactly as `RoundKindX.fromWire` does.

    Lenient on read for the same reason every other reader here is: an unrecognised
    value on a stored document must render as something rather than break a timeline.
    """
    return value if value in KINDS else KIND_CHAT


def kind_is_interview(kind: str) -> bool:
    """Whether the round runs a session a candidate joins. A résumé round does not."""
    return kind != KIND_RESUME


def kind_is_recruiter_scored(kind: str) -> bool:
    """Only two-way: a human was in the room and there is no recording to score."""
    return kind == KIND_TWO_WAY


def mode_for_kind(kind: str) -> str:
    """The interview `mode` a round of this kind assigns, or "" for a résumé round.

    The two vocabularies overlap but are not the same — `resume` is a round kind with
    no track — so the mapping is explicit rather than assumed identical.
    """
    return "" if kind == KIND_RESUME else kind


# ── criteria ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Criteria:
    """What a round is judged against. Mirrors `RoundCriteria` in Dart.

    Duplicated in `app.interviews.RoundCriteria`, which is the READER the résumé scorer
    already uses. This one round-trips: it also writes. The two are asserted equal in
    tests rather than merged, because `app.interviews` is the frozen interview schema
    and this is the round schema — one module owning both would make a round change
    look like an interview change in review.
    """

    required_skills: list[str] = field(default_factory=list)
    nice_to_have: list[str] = field(default_factory=list)
    min_years: float | None = None
    min_score: int | None = None

    @property
    def is_empty(self) -> bool:
        return (
            not self.required_skills
            and not self.nice_to_have
            and self.min_years is None
            and self.min_score is None
        )

    def to_map(self) -> dict:
        return {
            "requiredSkills": list(self.required_skills),
            "niceToHave": list(self.nice_to_have),
            "minYears": self.min_years,
            "minScore": self.min_score,
        }

    @staticmethod
    def from_map(data: dict | None) -> "Criteria":
        data = data or {}
        years = data.get("minYears")
        return Criteria(
            required_skills=_str_list(data.get("requiredSkills")),
            nice_to_have=_str_list(data.get("niceToHave")),
            min_years=(
                float(years)
                if isinstance(years, (int, float)) and not isinstance(years, bool)
                else None
            ),
            min_score=_as_int(data.get("minScore")),
        )


def _str_list(value: object) -> list[str]:
    """Strings out of a Firestore array, dropping blanks and non-strings.

    The isinstance check is not padding: `str(None)` is the literal "None", so a null
    left in `requiredSkills` would be sent to the scorer as a skill named None and
    scored against.
    """
    if not isinstance(value, list):
        return []
    return [v.strip() for v in value if isinstance(v, str) and v.strip()]


def _as_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def _as_datetime(value: object) -> datetime | None:
    """Firestore timestamps arrive as datetimes; anything else is ignored.

    Naive values are treated as UTC so a comparison never raises.
    """
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


# ── the round ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Round:
    """One round of a test's timeline. Mirrors `InterviewRound` in Dart."""

    id: str
    test_id: str
    recruiter_id: str
    order: int
    title: str
    kind: str = KIND_CHAT
    config: dict = field(default_factory=dict)
    opens_at: datetime | None = None
    closes_at: datetime | None = None
    closed_at: datetime | None = None
    closed_by: str | None = None
    criteria: Criteria = field(default_factory=Criteria)

    def state_at(self, now: datetime) -> str:
        """This round's state at `now`.

        The clock is an ARGUMENT, not read here, so the value is testable and a whole
        timeline can be rendered against one instant rather than drifting per row.

        Order matters: a manual close wins over the schedule, because "end round now"
        has to beat a `closesAt` that is still in the future.
        """
        if self.closed_at is not None:
            return STATE_CLOSED
        if self.closes_at is not None and now > self.closes_at:
            return STATE_CLOSED
        if self.opens_at is not None and now < self.opens_at:
            return STATE_SCHEDULED
        return STATE_OPEN

    @property
    def was_ended_manually(self) -> bool:
        return self.closed_by == CLOSED_BY_MANUAL

    def to_create_map(self, *, server_timestamp: object = None) -> dict:
        """The document for a NEW round. Field names are `interview_round.dart`'s."""
        return {
            "testId": self.test_id,
            "recruiterId": self.recruiter_id,
            "order": self.order,
            "title": self.title,
            "kind": self.kind,
            "config": dict(self.config),
            "opensAt": self.opens_at,
            "closesAt": self.closes_at,
            # A new round is never born closed.
            "closedAt": None,
            "closedBy": None,
            "criteria": self.criteria.to_map(),
            "createdAt": server_timestamp,
            "updatedAt": server_timestamp,
        }

    def to_update_map(self, *, server_timestamp: object = None) -> dict:
        """Editable fields only.

        `closedAt`/`closedBy` are omitted deliberately: ending a round goes through
        `close_now`, so fixing a typo in a title can never reopen a closed round.
        """
        return {
            "order": self.order,
            "title": self.title,
            "kind": self.kind,
            "config": dict(self.config),
            "opensAt": self.opens_at,
            "closesAt": self.closes_at,
            "criteria": self.criteria.to_map(),
            "updatedAt": server_timestamp,
        }

    @staticmethod
    def from_document(doc_id: str, test_id: str, data: dict) -> "Round":
        """Tolerant of missing fields — one bad round must not break a timeline."""
        return Round(
            id=doc_id,
            test_id=test_id,
            recruiter_id=str(data.get("recruiterId") or ""),
            order=_as_int(data.get("order")) or 0,
            title=str(data.get("title") or "Round"),
            kind=kind_from_wire(data.get("kind")),
            config=data.get("config") if isinstance(data.get("config"), dict) else {},
            opens_at=_as_datetime(data.get("opensAt")),
            closes_at=_as_datetime(data.get("closesAt")),
            closed_at=_as_datetime(data.get("closedAt")),
            closed_by=data.get("closedBy") if data.get("closedBy") in (CLOSED_BY_MANUAL, CLOSED_BY_AUTO) else None,
            criteria=Criteria.from_map(data.get("criteria")),
        )


# ── collection access ─────────────────────────────────────────────────────────


def collection(settings: Settings, test_id: str):
    """`tests/{testId}/rounds`."""
    return tests_collection(settings).document(test_id).collection(ROUNDS_SUBCOLLECTION)


__all__ = [
    "Criteria",
    "Round",
    "KINDS",
    "KIND_RESUME",
    "KIND_CHAT",
    "KIND_VIDEO",
    "KIND_VOICE",
    "KIND_TWO_WAY",
    "STATE_SCHEDULED",
    "STATE_OPEN",
    "STATE_CLOSED",
    "CLOSED_BY_MANUAL",
    "CLOSED_BY_AUTO",
    "ROUNDS_SUBCOLLECTION",
    "TESTS_COLLECTION",
    "collection",
    "kind_from_wire",
    "kind_is_interview",
    "kind_is_recruiter_scored",
    "mode_for_kind",
]

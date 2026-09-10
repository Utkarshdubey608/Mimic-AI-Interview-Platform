"""One recruiter's candidates, aggregated across rounds — the Kanban's read model.

Generalises `app.rounds_writer.candidates_of` (which already groups a SINGLE test's
assignments by `candidateEmailLower`) into a recruiter-wide board: every interview the
recruiter owns, grouped by candidate identity, reduced to "which round are they on now
and how did the earlier ones go."

**Read-only, by design.** This module never writes a round transition — a candidate's
current round is whichever round already has an `interviews` document for them, created
through the existing assign/invite paths. Advancing someone is still whatever action a
recruiter already takes today; nothing here invents a new one.

**No invented aggregate score.** A candidate's `currentScore` is the CURRENT round's own
`result.overallScore` — never a cross-round average, which the product has never defined
and this module must not quietly decide on its behalf.
"""

from __future__ import annotations

import asyncio
import logging

from app import interviews
from app.config import Settings

logger = logging.getLogger("candidates")


def _round_entry(data: dict, interview_id: str) -> dict:
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    return {
        "interviewId": interview_id,
        "roundOrder": data.get("roundOrder") if isinstance(data.get("roundOrder"), int) else 0,
        # Denormalised at assignment time (see rounds_writer.assign) so the board needs
        # no second read per candidate. Absent on interviews created before this
        # existed — falls back to a generic label, never a blank column header.
        "roundTitle": data.get("roundTitle") or None,
        "roundKind": data.get("roundKind") or data.get("type") or "chat",
        "status": data.get("status") or "assigned",
        "score": result.get("overallScore") if isinstance(result.get("overallScore"), (int, float)) else None,
    }


def _matches_status(candidate_status: str, wanted: str | None) -> bool:
    if not wanted:
        return True
    return candidate_status == wanted


def _matches_search(name: str, email: str, wanted: str | None) -> bool:
    if not wanted:
        return True
    needle = wanted.strip().lower()
    return needle in name.lower() or needle in email.lower()


async def board_for_recruiter(
    settings: Settings,
    *,
    recruiter_id: str,
    role_category: str | None = None,
    status: str | None = None,
    search: str | None = None,
) -> list[dict]:
    """Every distinct candidate this recruiter has invited, one card each.

    Grouped by `candidateEmailLower` — the same identity `rounds_writer.candidates_of`
    already uses — so a candidate with three round documents appears once, not three
    times. "Current" is the highest `roundOrder` for which a document exists; that
    matches how rounds are actually populated (a round-2 document is only created once
    the recruiter assigns the candidate forward), so it needs no extra state.
    """
    from google.cloud.firestore_v1.base_query import FieldFilter

    if not recruiter_id:
        return []

    def _read() -> list[dict]:
        query = interviews.collection(settings).where(
            filter=FieldFilter("recruiterId", "==", recruiter_id)
        )
        if role_category:
            query = query.where(filter=FieldFilter("roleCategory", "==", role_category))

        grouped: dict[str, dict] = {}
        for snapshot in query.stream():
            data = snapshot.to_dict() or {}
            email_lower = str(
                data.get("candidateEmailLower")
                or (data.get("candidateEmail") or "").strip().lower()
            )
            if not email_lower:
                continue

            entry = grouped.setdefault(
                email_lower,
                {
                    "email": data.get("candidateEmail") or email_lower,
                    "name": data.get("candidateName") or None,
                    "roleCategory": data.get("roleCategory") or None,
                    "rawRole": data.get("rawRole") or data.get("role") or None,
                    "rounds": [],
                },
            )
            if not entry["name"] and data.get("candidateName"):
                entry["name"] = data["candidateName"]
            if not entry["roleCategory"] and data.get("roleCategory"):
                entry["roleCategory"] = data["roleCategory"]
            entry["rounds"].append(_round_entry(data, snapshot.id))

        cards: list[dict] = []
        for entry in grouped.values():
            rounds_sorted = sorted(entry["rounds"], key=lambda r: r["roundOrder"])
            current = rounds_sorted[-1] if rounds_sorted else None
            if current is None:
                continue
            if not _matches_status(current["status"], status):
                continue
            if not _matches_search(entry["name"] or "", entry["email"], search):
                continue
            cards.append(
                {
                    "email": entry["email"],
                    "name": entry["name"],
                    "roleCategory": entry["roleCategory"],
                    "rawRole": entry["rawRole"],
                    "rounds": rounds_sorted,
                    "currentRoundOrder": current["roundOrder"],
                    "currentRoundTitle": current["roundTitle"],
                    "currentStatus": current["status"],
                    "currentScore": current["score"],
                    "currentInterviewId": current["interviewId"],
                }
            )

        cards.sort(key=lambda c: (c["name"] or c["email"]).lower())
        return cards

    return await asyncio.to_thread(_read)

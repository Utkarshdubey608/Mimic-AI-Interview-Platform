"""Candidate feedback on the interview experience.

Two routes, both additive. Nothing here touches the frozen `/api/*` Flutter
contract, the session/template/report schemas, scoring, or auth: a feedback
record is written once an interview is already over, and read only by the
recruiter who owns the session it belongs to.

**The tenant boundary is the whole security story.** `recruiterId` is copied from
the session on the server and never accepted from the request body, so a
candidate cannot file feedback into someone else's tenant, and the recruiter
listing filters on the caller's own uid rather than on anything the client sends.

Feedback is deliberately *not* part of scoring. It is the candidate's opinion of
us, not our opinion of them, and letting the two meet would be indefensible to a
candidate and useless to a recruiter.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Body, HTTPException, Request, status

from app.security import AuthedUser
from app.web.deps import WebUser, settings_of
from app.web.services import session_store
from app.web.store import get_store

router = APIRouter(tags=["feedback"])
logger = logging.getLogger("web.feedback")

# A comment box, not an essay. Long enough for a real complaint, bounded because
# it rides in every recruiter listing.
MAX_COMMENT_CHARS = 2000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rating_of(body: dict) -> int:
    """1..5, or 400. A rating outside the scale makes the average meaningless."""
    raw = body.get("rating")
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A rating from 1 to 5 is required")
    if not 1 <= raw <= 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A rating from 1 to 5 is required")
    return raw


@router.post("/sessions/{session_id}/feedback", summary="Leave feedback on an interview")
async def leave_feedback(
    session_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    settings = settings_of(request)
    # Reuses the session guard, so "not your session" is a 404 here exactly as it
    # is everywhere else — the response never reveals that a session exists.
    session, template = await session_store.load(settings, session_id, user)

    rating = _rating_of(body)
    comment = str(body.get("comment") or "").strip()[:MAX_COMMENT_CHARS]

    record = {
        "sessionId": session_id,
        # From the SESSION. Never from the client.
        "recruiterId": session.get("recruiterId"),
        "track": session.get("track"),
        "role": template.get("role"),
        "candidateName": (session.get("candidate") or {}).get("name"),
        "rating": rating,
        "comment": comment,
        "hadTechnicalIssues": bool(body.get("hadTechnicalIssues")),
        "createdAt": _now(),
    }
    await get_store(settings).feedback.put(record)
    return {"ok": True}


@router.get("/feedback", summary="Feedback across this recruiter's interviews")
async def list_feedback(request: Request, user: AuthedUser = WebUser) -> dict:
    settings = settings_of(request)
    rows = await get_store(settings).feedback.where("recruiterId", "==", user.uid)

    ratings = [r["rating"] for r in rows if isinstance(r.get("rating"), int)]
    return {
        "items": sorted(rows, key=lambda r: r.get("createdAt") or "", reverse=True),
        "count": len(rows),
        # None, not 0: "no feedback yet" and "everyone rated us zero" are
        # different facts, and a zero would quietly libel the interview.
        "averageRating": round(sum(ratings) / len(ratings), 2) if ratings else None,
        "technicalIssueCount": sum(1 for r in rows if r.get("hadTechnicalIssues")),
    }

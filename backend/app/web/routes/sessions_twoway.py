"""The two-way interview — a live recruiter ↔ candidate call over Daily.

Ports the `/twoway/*` routes of `sessions.ts`.

The asymmetry between host and join is the design. **The recruiter creates the room**,
and only they receive an owner token, because ownership is what allows admitting the
person waiting in the lobby. A candidate holding an owner token could admit themselves,
and anyone else.

`join` answers **409 while the room does not exist**, which the client polls on: a
candidate sitting on the waiting screen minutes before the interviewer arrives is a
normal state of this flow, not an error.

The same three operations exist on the common surface at `/api/interviews/{id}/twoway/*`
for the mobile app. They share `app.providers.daily` and nothing else — mobile keys them
on interview documents, this keys them on sessions. Collapsing the two is consolidation
work with a frontend change attached.
"""

from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter, Body, HTTPException, Request, status

from app.providers.daily import DailyClient, room_name_for
from app.security import AuthedUser
from app.web.deps import RateLimitMediaWeb, WebUser, owns, settings_of
from app.web.services import interview_invite, session_store

logger = logging.getLogger("web.sessions.twoway")

router = APIRouter(prefix="/sessions", tags=["web:sessions"])


async def _load_two_way(settings, session_id: str, user: AuthedUser) -> tuple[dict, dict]:
    session, template = await session_store.load(settings, session_id, user)
    if session.get("track") != "two_way":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a two-way interview")
    return session, template


@router.post(
    "/{session_id}/twoway/host",
    summary="The recruiter opens the call",
    dependencies=[RateLimitMediaWeb],
)
async def host(session_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    """Create the room and mint an OWNER token.

    Owner-only. The token is what lets someone admit the candidate knocking at the
    lobby, so handing one to the candidate would let them admit themselves.
    """
    settings = settings_of(request)
    store_missing = not await _session_exists(settings, session_id)

    if store_missing:
        await _explain_unopened_invite(settings, session_id, user)

    session, _ = await _load_two_way(settings, session_id, user)
    if not owns(session, user):
        # 404, not 403 — a recruiter must not learn that another's session exists.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if session.get("status") in ("completed", "expired"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This interview has already ended")

    client = DailyClient(settings)
    now = int(time.time())
    room_name = room_name_for(session_id)

    room = await client.ensure_room(room_name, now_seconds=now)
    token = await client.mint_token(
        room_name=room_name,
        is_owner=True,
        user_name="Interviewer",
        now_seconds=now,
    )

    session["liveRoomName"] = room_name
    if session.get("status") in ("created", "system_check"):
        session["status"] = "in_progress"
        session.setdefault("startedAt", _now())
    await session_store.save(settings, session)

    return {"roomUrl": str(room.get("url") or ""), "token": token, "isOwner": True}


async def _session_exists(settings, session_id: str) -> bool:
    from app.web.store import get_store

    return await get_store(settings).sessions.get(session_id) is not None


async def _explain_unopened_invite(settings, session_id: str, user: AuthedUser) -> None:
    """Say plainly that the candidate has not opened their link yet.

    A bulk-invited two-way session does not exist locally until the candidate opens
    their take link at least once. Without this the recruiter gets a bare "Session not
    found" for a perfectly normal state and has no way to work out what to do.

    Only after confirming THIS recruiter owns the underlying invite — otherwise the
    message would confirm that some other recruiter's invite exists at this id.
    """
    try:
        snapshot = await asyncio.to_thread(
            interview_invite.interviews_collection(settings).document(session_id).get
        )
    except Exception as exc:  # noqa: BLE001 - best-effort; fall through to a 404
        logger.info("could not check invite %s: %s", session_id, type(exc).__name__)
        return

    if snapshot.exists and (snapshot.to_dict() or {}).get("recruiterId") == user.uid:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The candidate must open their interview link before you can join.",
        )


@router.post(
    "/{session_id}/twoway/join",
    summary="The candidate joins the call",
    dependencies=[RateLimitMediaWeb],
)
async def join(session_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    """A non-owner token, once the recruiter has opened the room.

    409 while the room does not exist. The client polls on exactly this — waiting for
    the interviewer is a normal state of this flow, and a 404 would read as a broken
    link.
    """
    settings = settings_of(request)
    session, _ = await _load_two_way(settings, session_id, user)

    if session.get("status") in ("completed", "expired"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This interview has already ended")

    client = DailyClient(settings)
    room_name = room_name_for(session_id)

    if not await client.room_exists(room_name):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Your interviewer has not started this interview yet.",
        )

    token = await client.mint_token(
        room_name=room_name,
        # Never an owner: an owner token would let the candidate admit themselves past
        # the lobby, and admit anyone else.
        is_owner=False,
        user_name=(session.get("candidate") or {}).get("name") or "Candidate",
        now_seconds=int(time.time()),
    )

    domain = settings.daily_domain.strip()
    return {
        "roomUrl": f"https://{domain}/{room_name}" if domain else "",
        "token": token,
        "isOwner": False,
    }


@router.post("/{session_id}/twoway/complete", summary="End the call")
async def complete(
    session_id: str,
    request: Request,
    body: dict = Body(default={}),
    user: AuthedUser = WebUser,
) -> dict:
    """Finish the interview and tear down the room.

    Deleting the room ejects anyone still connected, so the recruiter ending the call
    ends it for the candidate too. Only the owner deletes it — a candidate closing their
    tab must not end an interview the recruiter is still conducting.
    """
    settings = settings_of(request)
    session, _ = await _load_two_way(settings, session_id, user)
    is_owner = owns(session, user)

    if session.get("status") != "completed":
        session["status"] = "completed"
        session["completedAt"] = _now()
        await session_store.save(settings, session)

    if is_owner and session.get("liveRoomName"):
        try:
            await DailyClient(settings).delete_room(session["liveRoomName"])
        except Exception as exc:  # noqa: BLE001 - the room expires on its own
            logger.warning("could not delete room for %s: %s", session_id, exc)

    return {"ok": True}


@router.post("/{session_id}/twoway/review", summary="The recruiter's manual score")
async def review(
    session_id: str,
    request: Request,
    body: dict = Body(...),
    user: AuthedUser = WebUser,
) -> dict:
    """Record a human score for a human-run interview.

    A two-way call has no transcript and no model score — the person who conducted it is
    the scorer. Owner-only, and the stars map onto the same 0-100 scale every other track
    writes, so a two-way round ranks on the same leaderboard and can advance a candidate
    without any of that machinery learning what a live interview is.
    """
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)

    if not owns(session, user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if session.get("track") != "two_way":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a two-way interview")

    raw_rating = body.get("rating")
    if not isinstance(raw_rating, (int, float)) or isinstance(raw_rating, bool):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A rating is required")
    stars = max(0, min(5, int(raw_rating)))

    from app.web.store import get_store

    report = {
        "sessionId": session_id,
        "perQuestion": [],
        "kpiAverages": {},
        "overallScore": stars * 20,
        "summary": (str(body.get("notes") or "").strip())[:2000]
        or "Scored by the interviewer after a live two-way call.",
        "recommendation": _recommendation_for(stars),
        "generatedAt": _now(),
        "manualReview": {
            "rating": stars,
            "notes": str(body.get("notes") or "").strip()[:2000],
            "by": user.uid,
            "at": _now(),
        },
    }
    await get_store(settings).reports.put(report)

    from app.web.services import invite_bridge

    await invite_bridge.sync_result(settings, session, report)
    logger.info("two-way review recorded for %s by %s", session_id, user.uid)
    return {"ok": True}


def _recommendation_for(stars: int) -> str:
    from app.web.services.scoring import recommendation_for

    return recommendation_for(stars * 20)


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()

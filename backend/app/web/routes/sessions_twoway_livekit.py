"""The two-way interview over **LiveKit** — the recording-capable engine.

Drop-in alternative to ``sessions_twoway.py`` (Daily), selected by
``settings.twoway_engine == "livekit"``. Same ``host`` / ``join`` / ``complete`` /
``review`` contract, so web and mobile clients are unchanged; only the media
engine swaps. The Daily module is left completely untouched — when this engine is
active it is registered *instead of* Daily (see ``app.web.__init__``), so the two
never collide.

What LiveKit adds over Daily: on ``host`` the call is recorded server-side (a
review MP4 + one audio track per participant), and on ``complete`` those egresses
stop and fire webhooks that transcribe and auto-score the round (see
``twoway_webhook.py``). ``review`` (the recruiter's manual stars) is kept as-is so
a human score is still possible alongside the model one.
"""

from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter, Body, HTTPException, Request, status

from app.providers.livekit import LiveKitClient, room_name_for
from app.security import AuthedUser
from app.web.deps import RateLimitMediaWeb, WebUser, owns, settings_of
from app.web.services import interview_invite, session_store

logger = logging.getLogger("web.sessions.twoway.livekit")

router = APIRouter(prefix="/sessions", tags=["web:sessions"])


async def _load_two_way(settings, session_id: str, user: AuthedUser) -> tuple[dict, dict]:
    session, template = await session_store.load(settings, session_id, user)
    if session.get("track") != "two_way":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a two-way interview")
    return session, template


@router.post(
    "/{session_id}/twoway/host",
    summary="The recruiter opens the call (LiveKit)",
    dependencies=[RateLimitMediaWeb],
)
async def host(session_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    """Create the room, mint an OWNER token, and start recording.

    Owner-only. Recording starts here (the review MP4); each participant's audio
    is recorded reactively as their mic publishes (see the track_published
    webhook), so speaker attribution is deterministic.
    """
    settings = settings_of(request)
    if not await _session_exists(settings, session_id):
        await _explain_unopened_invite(settings, session_id, user)

    session, _ = await _load_two_way(settings, session_id, user)
    if not owns(session, user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if session.get("status") in ("completed", "expired"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This interview has already ended")

    client = LiveKitClient(settings)
    now = int(time.time())
    room_name = room_name_for(session_id)

    room = await client.ensure_room(room_name, now_seconds=now)
    token = await client.mint_token(
        room_name=room_name, is_owner=True, user_name="Interviewer", now_seconds=now
    )

    session["liveRoomName"] = room_name
    if session.get("status") in ("created", "system_check"):
        session["status"] = "in_progress"
        session.setdefault("startedAt", _now())
    await session_store.save(settings, session)

    # Recording is server-side; a failure to start it must not block the call.
    try:
        await client.start_review_egress(room_name)
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not start review egress for %s: %s", session_id, exc)

    return {"roomUrl": str(room.get("url") or ""), "token": token, "isOwner": True}


async def _session_exists(settings, session_id: str) -> bool:
    from app.web.store import get_store

    return await get_store(settings).sessions.get(session_id) is not None


async def _explain_unopened_invite(settings, session_id: str, user: AuthedUser) -> None:
    """A bulk-invited two-way session doesn't exist locally until the candidate
    opens their link. Say so plainly — but only after confirming THIS recruiter
    owns the invite, so the message never reveals another recruiter's invite."""
    try:
        snapshot = await asyncio.to_thread(
            interview_invite.interviews(settings).document(session_id).get
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("could not check invite %s: %s", session_id, type(exc).__name__)
        return

    if snapshot.exists and (snapshot.to_dict() or {}).get("recruiterId") == user.uid:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "The candidate must open their interview link before you can join.",
        )


@router.post(
    "/{session_id}/twoway/join",
    summary="The candidate joins the call (LiveKit)",
    dependencies=[RateLimitMediaWeb],
)
async def join(session_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    """A non-owner token, once the recruiter has opened the room.

    409 while the room does not exist — the client polls on exactly this. For
    LiveKit the room URL is the ws endpoint (same for host and candidate).
    """
    settings = settings_of(request)
    session, _ = await _load_two_way(settings, session_id, user)

    if session.get("status") in ("completed", "expired"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This interview has already ended")

    client = LiveKitClient(settings)
    room_name = room_name_for(session_id)

    if not await client.room_exists(room_name):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Your interviewer has not started this interview yet.",
        )

    token = await client.mint_token(
        room_name=room_name,
        is_owner=False,
        user_name=(session.get("candidate") or {}).get("name") or "Candidate",
        now_seconds=int(time.time()),
    )
    return {"roomUrl": settings.livekit_url.strip(), "token": token, "isOwner": False}


@router.post("/{session_id}/twoway/complete", summary="End the call (LiveKit)")
async def complete(
    session_id: str,
    request: Request,
    body: dict = Body(default={}),
    user: AuthedUser = WebUser,
) -> dict:
    """Finish the interview: stop recording, then tear the room down.

    Stopping egress fires the egress_ended webhooks that transcribe + score.
    Owner-only teardown — a candidate closing their tab must not end the call.
    """
    settings = settings_of(request)
    session, _ = await _load_two_way(settings, session_id, user)
    is_owner = owns(session, user)

    if session.get("status") != "completed":
        session["status"] = "completed"
        session["completedAt"] = _now()
        await session_store.save(settings, session)

    if is_owner and session.get("liveRoomName"):
        client = LiveKitClient(settings)
        try:
            await client.stop_all_egress(session["liveRoomName"])
        except Exception as exc:  # noqa: BLE001
            logger.warning("could not stop egress for %s: %s", session_id, exc)
        try:
            await client.delete_room(session["liveRoomName"])
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
    """Record a human score — kept for LiveKit too, alongside the model score.

    Identical behaviour to the Daily engine's review (stars → 0-100), so a
    two-way round ranks on the same leaderboard whether or not the auto-scorer ran.
    """
    settings = settings_of(request)
    session, _ = await session_store.load(settings, session_id, user)

    if not owns(session, user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    if session.get("track") != "two_way":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Not a two-way interview")

    raw_rating = body.get("rating")
    if not isinstance(raw_rating, (int, float)) or isinstance(raw_rating, bool):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A rating is required")
    stars = max(0, min(5, int(raw_rating)))
    notes = str(body.get("notes") or "").strip()[:2000]

    from app.web.store import get_store

    report = {
        "sessionId": session_id,
        "perQuestion": [],
        "kpiAverages": {},
        "overallScore": stars * 20,
        "summary": notes or "Scored by the interviewer after a live two-way call.",
        "recommendation": _recommendation_for(stars),
        "generatedAt": _now(),
        "manualReview": {"rating": stars, "notes": notes, "by": user.uid, "at": _now()},
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

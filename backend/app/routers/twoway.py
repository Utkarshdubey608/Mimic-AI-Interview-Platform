"""The two-way interview: a live recruiter ↔ candidate call.

Three routes, and the asymmetry between the first two is the whole design.

`POST .../twoway/host` — the RECRUITER opens the call. This is what creates the
room. Only the interview's owner may call it, and only they receive an owner
token, because ownership is what lets someone admit the person knocking at the
lobby.

`POST .../twoway/join` — the CANDIDATE asks to be let in. It deliberately
answers **409 while the room does not exist yet**, which the app polls on: the
candidate can be sitting on the waiting screen minutes before the recruiter
arrives, and "not started yet" is a normal state of this flow, not an error.
That ordering is forced — a candidate who could create the room would be sitting
in a call the recruiter has no owner token for, unable to admit anyone.

`POST .../twoway/complete` — the recruiter ends it. The room is deleted (which
ejects anyone still connected) and the interview is marked completed, awaiting
the recruiter's own review.

There is no recording, no transcript and no AI score on this track. A human
conducted the interview, so the human scores it — see the review route in
`app.routers.evaluations`' sibling on the app side. That also means this router
never touches Gemini or Deepgram.
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app import interviews
from app.config import Settings
from app.firebase import FirestoreUnavailable
from app.interviews import (
    InterviewAccessDenied,
    InterviewNotFound,
    InterviewNotLaunchable,
)
from app.providers.daily import DailyClient, room_name_for
from app.ratelimit import RateLimitMedia
from app.schemas import TwoWayJoinResponse
from app.security import AuthedUser, require_firebase_user

logger = logging.getLogger("routers.twoway")

router = APIRouter(
    prefix="/api/interviews",
    tags=["two-way"],
    dependencies=[Depends(require_firebase_user)],
)


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _load(settings: Settings, interview_id: str) -> interviews.Interview:
    try:
        return interviews.fetch(settings, interview_id)
    except InterviewNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except FirestoreUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc


def _require_two_way(interview: interviews.Interview) -> None:
    """Refuse anything that is not a two-way round.

    Not merely tidiness: minting a Daily token for, say, a résumé round would
    spend on a call nobody is going to have, and would hand out an owner token
    for a round with no interviewer.
    """
    if interview.round_kind != "two_way":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This interview is not a two-way interview.",
        )


@router.post(
    "/{interview_id}/twoway/host",
    response_model=TwoWayJoinResponse,
    response_model_by_alias=True,
    summary="Recruiter opens the live call",
    dependencies=[RateLimitMedia],
)
async def host(
    interview_id: str,
    request: Request,
    user: AuthedUser = Depends(require_firebase_user),
) -> TwoWayJoinResponse:
    settings = _settings(request)
    interview = _load(settings, interview_id)
    _require_two_way(interview)

    try:
        # The OWNING recruiter only. `require_candidate` would also admit the
        # candidate, and an owner token is exactly what they must not have.
        interviews.require_recruiter(interview, uid=user.uid)
    except InterviewAccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc

    client = DailyClient(settings)
    now = int(time.time())
    room_name = room_name_for(interview_id)

    room = await client.ensure_room(room_name, now_seconds=now)
    token = await client.mint_token(
        room_name=room_name,
        is_owner=True,
        user_name=interview.recruiter_name or "Interviewer",
        now_seconds=now,
    )

    return TwoWayJoinResponse(
        room_url=str(room.get("url") or ""),
        token=token,
        is_owner=True,
    )


@router.post(
    "/{interview_id}/twoway/join",
    response_model=TwoWayJoinResponse,
    response_model_by_alias=True,
    summary="Candidate joins the live call once the recruiter has opened it",
    dependencies=[RateLimitMedia],
)
async def join(
    interview_id: str,
    request: Request,
    user: AuthedUser = Depends(require_firebase_user),
) -> TwoWayJoinResponse:
    settings = _settings(request)
    interview = _load(settings, interview_id)
    _require_two_way(interview)

    try:
        # Assignment first, then eligibility: an unrelated caller should not learn
        # whether this interview has expired.
        interviews.require_candidate(interview, uid=user.uid, email=user.email)
        # The owning recruiter reaches this route too (require_candidate allows
        # them), and they are allowed to preview outside the window.
        if not interviews.is_owning_recruiter(interview, uid=user.uid):
            interview.ensure_launchable(
                interviews.device_from_header(
                    request.headers.get(interviews.CLIENT_DEVICE_HEADER)
                )
            )
    except InterviewAccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except InterviewNotLaunchable as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    client = DailyClient(settings)
    room_name = room_name_for(interview_id)

    if not await client.room_exists(room_name):
        # 409, not 404: the interview exists and the caller is entitled to it —
        # the interviewer simply is not there yet. The app polls on precisely
        # this and shows a waiting screen rather than an error.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Your interviewer has not started this interview yet.",
        )

    token = await client.mint_token(
        room_name=room_name,
        # Never an owner. A candidate with an owner token could admit themselves
        # past the lobby, and admit anyone else.
        is_owner=False,
        user_name=interview.candidate_name or "Candidate",
        now_seconds=int(time.time()),
    )

    return TwoWayJoinResponse(
        room_url=f"https://{settings.daily_domain}/{room_name}"
        if settings.daily_domain
        else "",
        token=token,
        is_owner=False,
    )


@router.post(
    "/{interview_id}/twoway/complete",
    summary="Recruiter ends the live call",
)
async def complete(
    interview_id: str,
    request: Request,
    user: AuthedUser = Depends(require_firebase_user),
) -> dict:
    settings = _settings(request)
    interview = _load(settings, interview_id)
    _require_two_way(interview)

    try:
        interviews.require_recruiter(interview, uid=user.uid)
    except InterviewAccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc

    # Deleting the room ejects anyone still connected, so ending the call for the
    # recruiter ends it for the candidate too.
    await DailyClient(settings).delete_room(room_name_for(interview_id))

    # Completed with NO score: a human ran this interview, so the human scores it.
    # The recruiter's review is written from the app, and until then the round
    # reads as "awaiting your review" rather than as a failed evaluation.
    interviews.save_evaluation(
        settings,
        interview_id,
        result={
            "summary": "",
            "recommendation": "",
            "strengths": [],
            "improvements": [],
            # Empty, and deliberately NOT an error: nothing failed, the recruiter
            # simply has not scored it yet.
            "evaluatedBy": "",
            "evaluationError": "",
            "awaitingRecruiterReview": True,
        },
    )
    logger.info("two-way interview %s ended", interview_id)
    # `awaitingReview` tells the app to show "awaiting your review" rather than
    # the "scoring failed" badge every other track's empty `evaluatedBy` means.
    return {"status": "ended", "awaitingReview": True}

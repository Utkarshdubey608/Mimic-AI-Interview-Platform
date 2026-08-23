"""`/api/interviews/{interview_id}/mcq` — sitting a paper, from any client.

Additive to the frozen mobile surface: new paths, nothing renamed.

MCQ was web-only, and not by choice. Its runtime lived inside `web_sessions` with the
resolved paper — answer key included — stored on the session document, so a second
client could not reach it without reaching into the other surface. `app/mcq_runtime.py`
is that runtime, moved; these routes are how both clients now call it.

**The candidate is authorised the same way as every other track**: assignment is by
verified email, and the owning recruiter is admitted too so they can preview their own
assessment end to end.

**Nothing here can return an answer key.** The paper is projected through
`mcq_scoring.mcq_public_question` — an allow-list — and the attempt document stores only
what the candidate chose. There is no field on any response for a key to travel in.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status

from app import interviews, mcq_runtime
from app.config import Settings
from app.firebase import FirestoreUnavailable
from app.interviews import InterviewAccessDenied, InterviewNotFound
from app.ratelimit import RateLimitGenerate
from app.security import AuthedUser, require_firebase_user

logger = logging.getLogger("routers.mcq")

router = APIRouter(
    prefix="/api/interviews",
    tags=["mcq"],
    dependencies=[Depends(require_firebase_user)],
)


def _settings(request: Request) -> Settings:
    return request.app.state.settings


async def _authorised(request: Request, interview_id: str, user: AuthedUser) -> dict:
    """The interview document, if this caller may sit or preview it.

    Returns the raw document rather than the parsed `Interview` because the runtime
    needs `screening.mcqSetId` and `mcqConfig`, which the dataclass does not carry.
    """
    import asyncio

    settings = _settings(request)

    try:
        interview = interviews.fetch(settings, interview_id)
    except InterviewNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except FirestoreUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc

    try:
        interviews.require_candidate(interview, uid=user.uid, email=user.email)
    except InterviewAccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc

    def _read() -> dict:
        snapshot = interviews.collection(settings).document(interview_id).get()
        return snapshot.to_dict() or {}

    return await asyncio.to_thread(_read)


def _unavailable(exc: Exception) -> HTTPException:
    """409, not 404.

    The interview exists and the candidate is entitled to it — the PAPER is the problem,
    and every message these raise is written to be read by the candidate. A 404 would
    say "no such interview", which is both wrong and unactionable.
    """
    return HTTPException(status.HTTP_409_CONFLICT, str(exc))


@router.get("/{interview_id}/mcq", summary="The paper, as the candidate may see it")
async def paper(
    interview_id: str,
    request: Request,
    user: AuthedUser = Depends(require_firebase_user),
) -> dict:
    """Opening it starts the attempt. Idempotent across reloads and devices."""
    data = await _authorised(request, interview_id, user)

    # Launch eligibility, the same check every other track runs: a closed round or a
    # spent attempt must not be sittable just because the paper would render.
    try:
        interviews.from_document(interview_id, data).ensure_launchable(
            interviews.device_from_header(
                request.headers.get(interviews.CLIENT_DEVICE_HEADER)
            )
        )
    except interviews.InterviewNotLaunchable as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    try:
        return await mcq_runtime.resolve(
            _settings(request),
            interview_id=interview_id,
            interview_data=data,
            candidate_email=(user.email or "").strip().lower(),
        )
    except (mcq_runtime.PaperUnavailable, mcq_runtime.AlreadySubmitted) as exc:
        raise _unavailable(exc) from exc


@router.post("/{interview_id}/mcq/answers", summary="Autosave the chosen answers")
async def save_answers(
    interview_id: str,
    request: Request,
    body: dict = Body(default={}),
    user: AuthedUser = Depends(require_firebase_user),
) -> dict:
    """A refresh, a dropped connection or a closed lid must not cost a candidate their
    answers. Merged rather than replaced — see `mcq_runtime.save`."""
    data = await _authorised(request, interview_id, user)
    try:
        return await mcq_runtime.save(
            _settings(request),
            interview_id=interview_id,
            interview_data=data,
            answers=body.get("answers"),
        )
    except (mcq_runtime.PaperUnavailable, mcq_runtime.AlreadySubmitted) as exc:
        raise _unavailable(exc) from exc


@router.post(
    "/{interview_id}/mcq/submit",
    summary="Score the paper and finish",
    # Scoring is a comparison, not a model call, so this is cheap — but the route
    # writes a result, and a client looping it should still be bounded.
    dependencies=[RateLimitGenerate],
)
async def submit(
    interview_id: str,
    request: Request,
    body: dict = Body(default={}),
    user: AuthedUser = Depends(require_firebase_user),
) -> dict:
    """Deliberately NOT gated on `ensure_launchable`.

    A candidate who was inside the window when they started must be able to hand in the
    paper they just sat, even if the round closed while they were answering. The
    alternative is destroying their work at the buzzer — the same reasoning as
    `/evaluate`.
    """
    data = await _authorised(request, interview_id, user)
    try:
        return await mcq_runtime.submit(
            _settings(request),
            interview_id=interview_id,
            interview_data=data,
            answers=body.get("answers"),
        )
    except (mcq_runtime.PaperUnavailable, mcq_runtime.AlreadySubmitted) as exc:
        raise _unavailable(exc) from exc

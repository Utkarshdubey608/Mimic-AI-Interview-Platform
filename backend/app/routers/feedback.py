"""`POST /api/interviews/{interview_id}/feedback` — what a candidate thought.

Additive to the frozen mobile surface: a new path, nothing renamed.

**Why this exists at all.** The prompt used to live only in the browser
(`web_feedback`), so a candidate who interviewed on the phone was never asked — on the
one channel the product has for hearing from candidates. The collection is shared now;
this is the half that was missing.

**What the client may say, and what the server decides.** The rating and the comment are
the candidate's. Which recruiter, which track, which role are all resolved here from the
interview, because a feedback row is aggregated on a recruiter's dashboard and a
client-supplied `recruiterId` would let anyone write into anyone else's numbers.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status

from app import feedback, interviews
from app.config import Settings
from app.firebase import FirestoreUnavailable
from app.interviews import InterviewAccessDenied, InterviewNotFound
from app.security import AuthedUser, require_firebase_user

logger = logging.getLogger("routers.feedback")

router = APIRouter(
    prefix="/api/interviews",
    tags=["feedback"],
    dependencies=[Depends(require_firebase_user)],
)


def _settings(request: Request) -> Settings:
    return request.app.state.settings


@router.post(
    "/{interview_id}/feedback",
    summary="Submit feedback on the interview experience",
)
async def submit_feedback(
    interview_id: str,
    request: Request,
    body: dict = Body(default={}),
    user: AuthedUser = Depends(require_firebase_user),
) -> dict:
    """Record one candidate's verdict. Idempotent — a resubmission replaces.

    Deliberately NOT gated on `ensure_launchable`. A candidate giving feedback has
    already finished; refusing them because the round has since closed would discard the
    one thing they were asked for.
    """
    settings = _settings(request)

    try:
        interview = interviews.fetch(settings, interview_id)
    except InterviewNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except FirestoreUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc

    try:
        # The assigned candidate. The owning recruiter is admitted too, which is what
        # lets them preview their own interview end to end.
        interviews.require_candidate(interview, uid=user.uid, email=user.email)
    except InterviewAccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc

    rating = feedback.clean_rating(body.get("rating"))
    comment = feedback.clean_comment(body.get("comment"))

    if feedback.is_empty(rating, comment):
        # Nothing worth storing. A row with neither records that somebody pressed
        # submit, which counts as feedback on every dashboard that counts rows while
        # saying nothing — worse than its honest absence.
        return {"ok": True, "ignored": True}

    record = feedback.build(
        interview_id=interview_id,
        # From the INTERVIEW, never the body.
        recruiter_id=interview.recruiter_id,
        track=interview.round_kind or None,
        role=None,
        candidate_name=interview.candidate_name,
        rating=rating,
        comment=comment,
        had_technical_issues=bool(body.get("hadTechnicalIssues")),
        submitted_at=datetime.now(timezone.utc).isoformat(),
    )

    def _write() -> None:
        feedback.collection(settings).document(interview_id).set(record)

    await asyncio.to_thread(_write)
    logger.info("feedback stored for %s", interview_id)
    return {"ok": True}

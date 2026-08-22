"""`POST /api/interviews/{interview_id}/evaluate` — submit a finished interview.

The route does as little as possible and returns 202 immediately; the scoring
runs afterwards in a background task.

That split is the fix for two things at once. The candidate is told they are
finished the moment their answers are stored, instead of waiting on a model. And
because no HTTP connection is held open while Gemini works, there is no gateway
timeout to hit — a long generation used to come back as a 504 that `ApiClient`
does not retry, which permanently failed the evaluation. See `app.evaluation` for
the full account.

What this means for the caller: a 202 confirms the ANSWERS ARE SAFE, not that a
score exists. The result appears on the interview document when scoring finishes,
and if scoring fails the document records the reason with no score — which is the
state the recruiter's one-tap retry acts on. Nothing is ever left with a
fabricated number.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status

from app import evaluation, interviews
from app.config import Settings
from app.firebase import FirestoreUnavailable
from app.interviews import (
    InterviewAccessDenied,
    InterviewNotFound,
)
from app.providers.base import ProviderNotConfigured, UpstreamError
from app.providers.gemini import GeminiClient
from app.ratelimit import RateLimitGenerate
from app.schemas import EvaluateRequest, EvaluateResponse
from app.security import AuthedUser, require_firebase_user

logger = logging.getLogger("routers.evaluations")

router = APIRouter(
    prefix="/api/interviews",
    tags=["evaluations"],
    # Applied to the whole router rather than per-route, so a route added later
    # cannot forget it.
    dependencies=[Depends(require_firebase_user)],
)


def _settings(request: Request) -> Settings:
    return request.app.state.settings


async def run_evaluation(
    settings: Settings,
    interview_id: str,
    *,
    job_role: str,
    responses: list[dict],
) -> None:
    """Delegates to `evaluation.score_and_store`.

    The orchestration moved into the kernel so the WEB surface can reach it too: a
    recruiter's re-score used to be impossible in the browser purely because this code
    lived inside the mobile surface's router, which the layering rules (correctly) keep
    the web package out of. One scorer, two callers.

    Kept as a named function rather than inlined at the call site because it is handed
    to `BackgroundTasks`, and the name is what appears in a traceback.
    """
    await evaluation.score_and_store(
        settings,
        interview_id,
        job_role=job_role,
        responses=responses,
    )


def _record_failure(
    settings: Settings,
    interview_id: str,
    error: str,
    responses: list[dict],
) -> None:
    """Delegates to `evaluation.record_failure` — see `run_evaluation`."""
    evaluation.record_failure(settings, interview_id, error, responses)


@router.post(
    "/{interview_id}/evaluate",
    response_model=EvaluateResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a finished interview for scoring",
    dependencies=[RateLimitGenerate],
)
async def evaluate(
    interview_id: str,
    payload: EvaluateRequest,
    request: Request,
    background: BackgroundTasks,
    user: AuthedUser = Depends(require_firebase_user),
) -> EvaluateResponse:
    settings = _settings(request)

    try:
        interview = interviews.fetch(settings, interview_id)
    except InterviewNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except FirestoreUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc

    try:
        # The assigned candidate submits their own interview; the owning recruiter
        # may too, which is what makes a recruiter-side re-score go through the
        # same path rather than a second implementation.
        interviews.require_candidate(interview, uid=user.uid, email=user.email)
    except InterviewAccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc

    # Deliberately NOT gated on `ensure_launchable`. A candidate who was still
    # inside the window when they started must be able to submit the interview
    # they just sat, even if the round closed while they were answering — the
    # alternative is destroying their work at the buzzer.

    responses = evaluation.clean_responses(payload.responses)
    if not responses:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "No question/answer pairs were submitted.",
        )

    if not evaluation.has_enough_to_score(responses):
        # Store it as an unscored submission rather than scoring silence into a
        # confident-looking number. The recruiter sees the reason and the answers.
        _record_failure(
            settings,
            interview_id,
            "Too little was said to score this interview. The microphone may "
            "have been muted or blocked, or the questions went unanswered.",
            responses,
        )
        return EvaluateResponse(
            interview_id=interview_id,
            status="stored_without_score",
            responses=len(responses),
        )

    # Queued, not awaited: FastAPI runs this after the response is sent, so the
    # candidate's device is released now and nothing holds a connection open
    # while Gemini works.
    background.add_task(
        run_evaluation,
        settings,
        interview_id,
        job_role=interview.title,
        responses=responses,
    )

    return EvaluateResponse(
        interview_id=interview_id,
        status="scoring",
        responses=len(responses),
    )

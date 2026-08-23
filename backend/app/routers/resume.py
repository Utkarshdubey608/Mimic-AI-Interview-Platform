"""Résumé rounds: transcribe a PDF, then score it against the round's criteria.

Two routes rather than one. Extraction is useful on its own — the candidate sees
the text and confirms it before anything is scored, and a scoring failure must
not throw away a transcription that cost a PDF upload. They also cost differently
enough to belong in different rate-limit buckets.

Only `/score` touches Firestore, and it writes with the Admin SDK on purpose.
See `app.resume` for why the score cannot be computed on the device, and
`app.interviews.save_resume_submission` for what is written.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app import interviews, resume
from app.config import Settings
from app.firebase import FirestoreUnavailable
from app.interviews import (
    InterviewAccessDenied,
    InterviewNotFound,
    InterviewNotLaunchable,
)
from app.providers.gemini import GeminiClient
from app.ratelimit import RateLimitGenerate, RateLimitMedia
from app.schemas import (
    ResumeExtractRequest,
    ResumeExtractResponse,
    ResumeScore,
    ResumeScoreRequest,
    ResumeScoreResponse,
)
from app.security import AuthedUser, require_firebase_user

router = APIRouter(
    prefix="/api/resume",
    tags=["resume"],
    # Applied to the whole router rather than per-route, so a route added later
    # cannot forget it.
    dependencies=[Depends(require_firebase_user)],
)


def _settings(request: Request) -> Settings:
    return request.app.state.settings


@router.post(
    "/extract",
    response_model=ResumeExtractResponse,
    response_model_by_alias=True,
    summary="Transcribe a résumé PDF to plain text",
    # The media bucket, not the generate one: this uploads a file and is the
    # pricier of the two calls, and a burst of uploads must not lock a recruiter
    # out of scoring the résumés already in hand.
    dependencies=[RateLimitMedia],
)
async def extract(
    payload: ResumeExtractRequest,
    request: Request,
) -> ResumeExtractResponse:
    """Stateless — nothing is written. The caller keeps the text and posts it to
    `/score` once the candidate has confirmed it."""
    try:
        resume.decode_pdf(payload.pdf_base64)
    except ValueError as exc:
        # The caller's file is wrong, and the message says how — no Gemini call
        # is made, so a bad upload costs nothing.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)
        ) from exc

    response = await GeminiClient(_settings(request)).generate_content(
        resume.build_extraction_body(payload.pdf_base64)
    )

    try:
        text = resume.extracted_text(response)
    except resume.ResumeExtractionFailed as exc:
        # 422, not 502: the upstream call succeeded, the PDF just has no readable
        # text in it (a scan, or an image-only export).
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)
        ) from exc

    return ResumeExtractResponse(
        text=text,
        char_count=len(text),
        truncated=len(text) >= resume.MAX_RESUME_CHARS,
    )


@router.post(
    "/score",
    response_model=ResumeScoreResponse,
    response_model_by_alias=True,
    summary="Score a résumé against its round and store the result",
    dependencies=[RateLimitGenerate],
)
async def score(
    payload: ResumeScoreRequest,
    request: Request,
    user: AuthedUser = Depends(require_firebase_user),
) -> ResumeScoreResponse:
    settings = _settings(request)

    try:
        interview = interviews.fetch(settings, payload.interview_id)
    except InterviewNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except FirestoreUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc

    is_recruiter = interviews.is_owning_recruiter(interview, uid=user.uid)
    try:
        # Assignment first, then eligibility — someone with no claim on this
        # interview should not learn whether its round has closed.
        interviews.require_candidate(interview, uid=user.uid, email=user.email)
        # The window is what "end round now" enforces: closing a round pulls
        # `expiresAt` back to that instant, and this is where that bites for a
        # résumé submission. The OWNING RECRUITER is exempt — re-scoring a
        # résumé after the round has closed is a normal thing for them to do.
        if not is_recruiter:
            interview.ensure_launchable(
                interviews.device_from_header(
                    request.headers.get(interviews.CLIENT_DEVICE_HEADER)
                )
            )
    except InterviewAccessDenied as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    except InterviewNotLaunchable as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc

    criteria = interviews.fetch_round_criteria(settings, interview)

    client = GeminiClient(settings)
    response = await client.generate_content(
        resume.build_scoring_body(
            resume_text=payload.resume_text,
            role=interview.title,
            criteria=criteria,
        )
    )

    try:
        parsed = resume.parse_score(response)
    except resume.ResumeScoringFailed as exc:
        # 502: the upstream call worked but gave us something unusable, which is
        # a transient fault on their side rather than a bad request from here.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    stored_text = payload.resume_text.strip()[: resume.MAX_RESUME_CHARS]
    try:
        interviews.save_resume_submission(
            settings,
            interview.id,
            resume={
                # The raw text is stored so a recruiter can read exactly what was
                # scored — a score with no visible basis is not reviewable.
                "text": stored_text,
                "charCount": len(stored_text),
                "fileName": payload.file_name,
                "score": {**parsed, "model": client.resolve_model(None)},
            },
            result=resume.build_result_map(parsed),
        )
    except FirestoreUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc

    return ResumeScoreResponse(
        interview_id=interview.id,
        score=ResumeScore(**parsed),
        char_count=len(stored_text),
        model=client.resolve_model(None),
    )

"""AI Avatar Screening — the credential proxy. Ports `server/routes/avatar.ts`.

The source app this feature came from called Deepgram, Hume and Gemini directly
from the browser, with the keys in the client bundle, and reached AWS Rekognition
through a standalone proxy. These routes are thin key-injecting proxies: the client
keeps its exact prompt, parsing and aggregation logic, and only the credential
moved to the server.

That is why several handlers here look unusually raw — returning the vendor's
status code, or its response body byte for byte. The browser owns the contract on
the other side of them, so normalising the shape would break a client this port is
not allowed to change.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    File,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse, Response

from app.config import Settings
from app.providers import rekognition
from app.providers.base import ProviderNotConfigured, UpstreamError, http_client
from app.providers.hume import HumeClient
from app.security import AuthedUser
from app.web.deps import (
    RateLimitChat,
    RateLimitFace,
    RateLimitMediaWeb,
    WebUser,
    settings_of,
)
from app.web.services import gemini, voice_analysis, voice_jobs, app_settings

logger = logging.getLogger("web.avatar")

router = APIRouter(prefix="/avatar", tags=["web:avatar"])

# An interview's audio, not a media library. 25 MB matches the Express limit.
MAX_AUDIO_BYTES = 25 * 1024 * 1024

DEEPGRAM_TOKEN_TTL_SECONDS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── readiness (UI gating; never returns a secret) ──────────────────────────────


@router.get("/status", summary="Which screening services are configured")
async def status_(request: Request, user: AuthedUser = WebUser) -> dict:
    settings = settings_of(request)
    gemini_ready = await gemini.is_enabled(settings)

    return {
        "deepgram": bool(settings.deepgram_api_key.strip()),
        # Voice-emotion analysis is available when Hume is configured OR the Gemini
        # audio fallback can run — Hume discontinued its batch prosody API, so for
        # most deployments this flag is really reporting the fallback.
        "hume": bool(settings.hume_api_key.strip()) or gemini_ready,
        "gemini": gemini_ready,
        "rekognition": rekognition.is_configured(settings),
        # Added when the Tavus key stopped being something a recruiter typed into the
        # browser. The client used to gate its avatar UI on the key it held locally,
        # which meant the page could report "configured" for a credential the server
        # had never seen. This is the server's own answer.
        "tavus": bool(await app_settings.tavus_key(settings)),
    }


# ── Deepgram: a short-lived token for the browser's WebSocket ──────────────────


@router.post("/deepgram/token", summary="Mint a short-lived Deepgram token")
async def deepgram_token(request: Request, user: AuthedUser = WebUser) -> dict:
    """Grant the browser a 30-second Deepgram token so the key stays here.

    Known to fail on some accounts: this project's key has been observed
    returning "Insufficient permissions" from `/v1/auth/grant`, which is precisely
    why the live-captions path is a server-side relay rather than a direct browser
    connection. The route stays because the client treats the token as optional and
    the relay works either way.
    """
    settings = settings_of(request)
    key = settings.deepgram_api_key.strip()
    if not key:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Deepgram is not configured on the server"
        )

    response = await http_client().post(
        "https://api.deepgram.com/v1/auth/grant",
        headers={"Authorization": f"Token {key}", "Content-Type": "application/json"},
        json={"ttl_seconds": DEEPGRAM_TOKEN_TTL_SECONDS},
    )
    payload = _json_or_none(response)
    token = (payload or {}).get("access_token")
    if response.status_code >= 400 or not token:
        reason = (payload or {}).get("err_msg") or f"HTTP {response.status_code}"
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Deepgram token grant failed: {reason}"
        )

    return {
        "access_token": token,
        "expires_in": (payload or {}).get("expires_in") or DEEPGRAM_TOKEN_TTL_SECONDS,
    }


# ── voice emotion: Hume first, Gemini as the stand-in ─────────────────────────


@router.post(
    "/hume/jobs",
    summary="Submit audio for prosody analysis",
    dependencies=[RateLimitMediaWeb],
)
async def submit_voice_job(
    request: Request,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    user: AuthedUser = WebUser,
) -> dict:
    """Start a prosody job and return its id.

    Real Hume is tried first so an account that still has access keeps using it,
    and so the path resumes working by itself if Hume restores the product. On any
    submit failure the audio is analysed by Gemini instead, behind the same
    job/poll/predictions contract — the client cannot tell which ran.
    """
    settings = settings_of(request)
    audio = await file.read()
    if not audio:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No audio file uploaded")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "That recording is too large to analyse.",
        )

    filename = file.filename or "interview.webm"
    content_type = file.content_type or "audio/webm"

    hume_job_id = await HumeClient(settings).submit_job(
        audio, filename=filename, content_type=content_type
    )
    if hume_job_id:
        return {"job_id": hume_job_id}

    if not await gemini.is_enabled(settings):
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Voice analysis unavailable: Hume rejected the job and Gemini is not configured",
        )

    job_id = voice_jobs.new_id(uuid.uuid4().hex)
    await voice_jobs.create(settings, job_id, now=_now())
    background.add_task(
        _run_gemini_voice_job,
        settings,
        job_id,
        audio,
        content_type=content_type,
        filename=filename,
    )
    return {"job_id": job_id}


async def _run_gemini_voice_job(
    settings: Settings,
    job_id: str,
    audio: bytes,
    *,
    content_type: str,
    filename: str,
) -> None:
    """Analyse the audio and record the outcome. Never raises.

    A background task that raised would log a traceback and leave the job stuck at
    IN_PROGRESS, so the client would poll until it timed out with no reason. Every
    failure is written to the job instead.
    """
    try:
        segments = await voice_analysis.analyse_with_gemini(
            settings, audio, content_type=content_type
        )
        await voice_jobs.complete(
            settings,
            job_id,
            predictions=voice_analysis.wrap_as_batch_predictions(segments, filename),
            now=_now(),
        )
        logger.info(
            "voice analysis %s completed — %d prosody segments (Gemini fallback)",
            job_id,
            len(segments),
        )
    except Exception as exc:  # noqa: BLE001 - recorded on the job, never re-raised
        logger.error("voice analysis %s failed: %s", job_id, exc)
        try:
            await voice_jobs.fail(settings, job_id, error=str(exc), now=_now())
        except Exception:  # noqa: BLE001 - nothing left to try
            logger.exception("could not record failure for voice job %s", job_id)


@router.get("/hume/jobs/{job_id}", summary="Poll a prosody job")
async def poll_voice_job(
    job_id: str, request: Request, user: AuthedUser = WebUser
) -> Response:
    settings = settings_of(request)

    if voice_jobs.is_local(job_id):
        job = await voice_jobs.get(settings, job_id, now=_now())
        if not job:
            # FAILED with a 200, not a 404. The client polls this for minutes and
            # retries a 404 — reporting the terminal state instead makes it fail
            # fast rather than sitting behind a spinner until it times out.
            return JSONResponse(
                {
                    "job_id": job_id,
                    "status": voice_jobs.FAILED,
                    "error": "Voice-analysis job no longer exists (expired or restarted).",
                }
            )
        body = {"job_id": job_id, "status": job.get("status")}
        if job.get("error"):
            body["error"] = job["error"]
        return JSONResponse(body)

    _require_hume(settings)
    raw = await HumeClient(settings).get_job(job_id)
    return Response(content=raw, media_type="application/json")


@router.get("/hume/jobs/{job_id}/predictions", summary="Fetch a job's predictions")
async def voice_job_predictions(
    job_id: str, request: Request, user: AuthedUser = WebUser
) -> Response:
    settings = settings_of(request)

    if voice_jobs.is_local(job_id):
        job = await voice_jobs.get(settings, job_id, now=_now())
        if not job:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Unknown voice-analysis job"
            )
        if job.get("status") != voice_jobs.COMPLETED:
            # 409, not 404: the job exists and the caller is entitled to it — it
            # simply is not finished. The client polls on exactly this.
            raise HTTPException(
                status.HTTP_409_CONFLICT, f"Job is {job.get('status')}"
            )
        return JSONResponse(voice_jobs.predictions_of(job))

    _require_hume(settings)
    raw = await HumeClient(settings).get_predictions(job_id)
    return Response(content=raw, media_type="application/json")


def _require_hume(settings: Settings) -> None:
    if not settings.hume_api_key.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Hume is not configured on the server"
        )


# ── Gemini: key-injecting passthrough ─────────────────────────────────────────


@router.post(
    "/gemini-generate",
    summary="Proxy a generateContent call",
    dependencies=[RateLimitChat],
)
async def gemini_generate(
    request: Request,
    payload: dict = Body(...),
    user: AuthedUser = WebUser,
) -> Response:
    """Forward the client's generateContent body, returning the vendor's response.

    The client builds the prompt and parses the result; only the credential moved
    here. The upstream status is returned unchanged because the client's retry
    logic depends on it — it retries 503 and 429, but reads the error body to
    distinguish a transient rate limit from a hard quota wall it must not retry.
    """
    settings = settings_of(request)

    try:
        model = gemini.validate_model_name(str(payload.get("model") or gemini.DEFAULT_MODEL))
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    request_body = payload.get("requestBody")
    if not isinstance(request_body, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing requestBody")

    try:
        upstream_status, body, content_type = await gemini.generate_content_raw(
            settings, model=model, request_body=request_body
        )
    except ProviderNotConfigured as exc:
        # 400, matching the Express route: the recruiter's next step is to save a
        # key on the Settings page, which is a client-actionable problem.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Gemini is not configured on the server"
        ) from exc

    return Response(content=body, status_code=upstream_status, media_type=content_type)


# ── AWS Rekognition: face attributes for one frame ────────────────────────────


@router.post(
    "/analyze-face",
    summary="Detect face attributes in one frame",
    dependencies=[RateLimitFace],
)
async def analyze_face(
    request: Request,
    payload: dict = Body(...),
    user: AuthedUser = WebUser,
) -> dict:
    """Face attributes for a base64 JPEG frame.

    The response carries a `success` flag rather than relying on the status code,
    and echoes `questionIdx`/`timestampMs` back — the client correlates frames by
    them, and treats a `success: false` as a skipped frame rather than an error.
    Keeping that shape is what lets the browser's aggregation code stay unchanged.
    """
    settings = settings_of(request)
    image_base64 = payload.get("imageBase64")
    question_idx = payload.get("questionIdx")
    timestamp_ms = payload.get("timestampMs")

    if not image_base64 or not isinstance(image_base64, str):
        return JSONResponse(
            {"success": False, "error": "imageBase64 required"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    # Reject a blank or truncated capture before spending a billed call. base64
    # inflates by 4/3, so this is the decoded size.
    if (len(image_base64) * 3) // 4 < rekognition.MIN_IMAGE_BYTES:
        return {
            "success": False,
            "reason": "frame_too_small",
            "questionIdx": question_idx,
            "timestampMs": timestamp_ms,
        }

    try:
        face_details = await rekognition.detect_faces(settings, image_base64)
    except ProviderNotConfigured as exc:
        return JSONResponse(
            {"success": False, "error": str(exc)},
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    except UpstreamError as exc:
        logger.warning("Rekognition error: %s", exc.detail)
        return JSONResponse(
            {"success": False, "error": exc.detail},
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return {
        "success": True,
        "faceDetails": face_details,
        "questionIdx": question_idx,
        "timestampMs": timestamp_ms,
    }


def _json_or_none(response) -> dict | None:
    try:
        parsed = response.json()
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None

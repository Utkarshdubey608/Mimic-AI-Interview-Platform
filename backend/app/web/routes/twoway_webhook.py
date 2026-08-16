"""LiveKit egress webhook — turns a recorded two-way call into a scored report.

UNAUTHENTICATED on purpose: LiveKit signs every event, verified by
``LiveKitClient.verify_webhook``. A Firebase bearer here would be wrong — LiveKit
cannot send one. Always registered; its path is new, so it never collides with
the Daily routes and adds nothing to their surface.

Two events matter:

* ``track_published`` (audio) → start recording THAT participant's mic to its own
  file, tagged with their role in the name. This is what makes speaker
  attribution deterministic (by who published), not acoustic diarization.
* ``egress_ended`` → the composite MP4 becomes the review recording; each
  ``spk-{role}-*.ogg`` is transcribed under its role, appended to the transcript,
  and the round is (re)scored by the EXISTING ``two_way`` scorer.

NOTE: reads a few ``livekit-api`` webhook-event fields (``egress_info``,
``track.type``, ``participant.identity``). Confirm the attribute names against the
pinned SDK version — they mirror the proven TS ``WebhookReceiver`` payload.
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone

import boto3
from botocore.config import Config
from fastapi import APIRouter, Request, Response

from app.providers.deepgram import DeepgramClient
from app.providers.livekit import LiveKitClient
from app.web.deps import settings_of
from app.web.services import session_store
from app.web.store import get_store

logger = logging.getLogger("web.sessions.twoway.webhook")

router = APIRouter(prefix="/sessions", tags=["web:sessions"])

# TrackType.AUDIO in the LiveKit proto.
_TRACK_TYPE_AUDIO = 0
_SPK_RE = re.compile(r"/spk-(interviewer|candidate)-")


@router.post("/twoway/livekit-webhook", summary="LiveKit egress webhook (public, signed)")
async def livekit_webhook(request: Request) -> Response:
    settings = settings_of(request)
    raw = (await request.body()).decode("utf-8", "replace")
    event = LiveKitClient(settings).verify_webhook(raw, request.headers.get("Authorization"))
    if event is None:
        return Response(status_code=401)

    kind = getattr(event, "event", "")

    if kind == "track_published":
        await _on_track_published(settings, event)
        return Response(status_code=200)

    if kind == "egress_ended":
        await _on_egress_ended(settings, event)

    return Response(status_code=200)


async def _on_track_published(settings, event) -> None:
    """A mic published → record that participant's audio to its own file."""
    track = getattr(event, "track", None)
    if track is None or getattr(track, "type", None) != _TRACK_TYPE_AUDIO:
        return
    room_name = getattr(getattr(event, "room", None), "name", None)
    sid = _session_id_from_room(room_name)
    if not sid:
        return
    store = get_store(settings)
    if not await store.sessions.get(sid):
        return
    identity = getattr(getattr(event, "participant", None), "identity", None)
    try:
        await LiveKitClient(settings).start_participant_audio_egress(
            room_name, track.sid, identity
        )
    except Exception as exc:  # noqa: BLE001 - a webhook must never 500
        logger.warning("participant egress failed for %s: %s", sid, exc)


async def _on_egress_ended(settings, event) -> None:
    """A recording finished — the MP4 is for review, spk-*.ogg drives scoring."""
    info = getattr(event, "egress_info", None)
    files = list(getattr(info, "file_results", []) or [])
    sid = _session_id_from_room(getattr(info, "room_name", None))
    if not sid or not files:
        return

    store = get_store(settings)
    session = await store.sessions.get(sid)
    if not session:
        return

    filename = getattr(files[0], "filename", "") or ""  # the S3 object key
    role_match = _SPK_RE.search("/" + filename)

    if not role_match:
        # Composite MP4 → the recruiter-review recording. A time-limited PRESIGNED
        # URL so the report can play it from a PRIVATE bucket (candidate video is
        # PII — the bucket must not be public).
        session["recordingUrl"] = _presigned_url(settings, filename)
        await session_store.save(settings, session)
        return

    role = role_match.group(1)
    template = await store.templates.get(session.get("templateId") or "")
    if not template:
        return
    try:
        turns = await _transcribe_speaker(settings, filename)
        if not turns:
            return
        _append_turns(session, role, turns)
        await session_store.save(settings, session)
        # The existing scorer handles the "two_way" track. Overwrite the report so
        # it converges to the full transcript as each speaker's file lands.
        from app.web.services import invite_bridge, scoring

        report = await scoring.score_session(settings, session, template)
        await store.reports.put(report)
        await invite_bridge.sync_result(settings, session, report)
        logger.info("two-way auto-scored %s (%s turns)", sid, len(session.get("transcript") or []))
    except Exception as exc:  # noqa: BLE001 - a webhook must not 500 on scoring
        logger.warning("two-way scoring failed for %s: %s", sid, exc)


def _s3_client(settings):
    """Authenticated S3 client for the recordings bucket.

    Works with a PRIVATE bucket (candidate recordings are PII — no public access).
    ``endpoint_url`` is the backend-reachable one (MinIO/S3/GCS); blank → real AWS
    S3. Path-style + s3v4 so the same code works for MinIO and cloud buckets.
    """
    endpoint = (settings.lk_s3_public_endpoint or settings.lk_s3_endpoint or "").strip() or None
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.lk_s3_key or None,
        aws_secret_access_key=settings.lk_s3_secret or None,
        region_name=settings.lk_s3_region or "us-east-1",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def _presigned_url(settings, key: str, expires: int = 7 * 24 * 3600) -> str:
    """Time-limited signed URL so the report can play a recording from a PRIVATE
    bucket. (For indefinite access, presign on report view instead of storing it.)"""
    try:
        return _s3_client(settings).generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.lk_s3_bucket, "Key": key.lstrip("/")},
            ExpiresIn=expires,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("presign failed for %s: %s", key, exc)
        return ""


async def _transcribe_speaker(settings, key: str) -> list[dict]:
    """Fetch one participant's audio from the (private) bucket via AUTHENTICATED S3,
    then transcribe it → [{text, start}]. boto3 is sync, so run it off the loop."""
    def _fetch() -> tuple[bytes, str]:
        obj = _s3_client(settings).get_object(Bucket=settings.lk_s3_bucket, Key=key.lstrip("/"))
        return obj["Body"].read(), (obj.get("ContentType") or "audio/ogg")

    audio, content_type = await asyncio.to_thread(_fetch)

    raw = await DeepgramClient(settings).request(
        "POST",
        "/listen",
        params={
            "model": "nova-3",
            "language": "en-US",
            "punctuate": "true",
            "smart_format": "true",
            "utterances": "true",
        },
        content=audio,
        headers={"Content-Type": content_type},
    )
    utterances = ((raw or {}).get("results") or {}).get("utterances") or []
    out: list[dict] = []
    for u in utterances:
        text = (u.get("transcript") or "").strip()
        if text:
            out.append({"text": text, "start": float(u.get("start") or 0.0)})
    return out


def _append_turns(session: dict, role: str, turns: list[dict]) -> None:
    """Append one speaker's turns, then re-sort the transcript by in-call time so
    the two speakers' files interleave chronologically."""
    session.setdefault("transcript", [])
    session.setdefault("mode", "conversational")
    base = _base_epoch_ms(session)
    for t in turns:
        turn = {
            "id": str(uuid.uuid4()),
            "role": role,
            "questionIndex": 0,
            "content": t["text"],
            "createdAt": _iso_at(base + int(t["start"] * 1000)),
        }
        if role == "interviewer":
            turn["turnType"] = "question"
        session["transcript"].append(turn)
    session["transcript"].sort(key=lambda x: x.get("createdAt") or "")


def _session_id_from_room(room_name: str | None) -> str | None:
    if not room_name or not room_name.startswith("room-"):
        return None
    return room_name[len("room-"):]


def _base_epoch_ms(session: dict) -> int:
    started = session.get("startedAt")
    if started:
        try:
            return int(datetime.fromisoformat(started.replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:  # noqa: BLE001
            return 0
    return 0


def _iso_at(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()

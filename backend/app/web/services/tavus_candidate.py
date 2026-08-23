"""Starting a candidate's avatar interview — a port of `server/services/tavusServer.ts`.

The recruiter configures the avatar once on the Setup page and applies it; every
candidate in that batch then gets the same avatar, the same persona and the same
question script. **The candidate's browser never sees a Tavus key** — the conversation
is created here and only its join URL is returned.

The payload deliberately mirrors the recruiter-run Setup flow exactly, because that
shape is the one proven to work on this account. In particular `properties.pipeline_mode`
is NOT sent: Tavus rejects it as an unknown field, and that 400 is what broke the old
client-side path.

Wraps the shared `app.providers.tavus` client rather than duplicating it — this module
is only the candidate-specific payload.
"""

from __future__ import annotations

import logging

from app.config import Settings
from app.providers.tavus import TavusClient
from app.web.shared import speech

logger = logging.getLogger("web.tavus_candidate")

# Tavus rejects a call shorter than a minute; half an hour is the product default.
MIN_CALL_SECONDS = 60
DEFAULT_CALL_SECONDS = 1800

# Long enough that a candidate stepping away briefly is not ejected mid-interview.
PARTICIPANT_LEFT_TIMEOUT = 60


def build_payload(
    config: dict,
    *,
    candidate_name: str,
    questions: list[str],
    time_of_day: str | None = None,
    resume_text: str | None = None,
) -> dict:
    """The conversation payload for one candidate. Pure, so it is directly testable."""
    name = (candidate_name or "").strip()

    context = speech.avatar_interview_context(
        persona_text=config.get("conversationalContext"),
        candidate_name=name or None,
        ai_name=config.get("aiName"),
        questions=questions,
        time_of_day=time_of_day,
        resume_text=resume_text,
    )
    greeting = speech.avatar_greeting_text(
        custom=config.get("customGreeting"),
        candidate_name=name or None,
        ai_name=config.get("aiName"),
        time_of_day=time_of_day,
    )

    duration = config.get("maxCallDuration")
    properties: dict = {
        "max_call_duration": duration
        if isinstance(duration, (int, float))
        and not isinstance(duration, bool)
        and duration >= MIN_CALL_SECONDS
        else DEFAULT_CALL_SECONDS,
        "participant_left_timeout": PARTICIPANT_LEFT_TIMEOUT,
        # Always on: the candidate's speech becomes the live captions the client
        # forwards back as transcript turns, which is the only record this track has to
        # score. Without it there is nothing to evaluate.
        "enable_transcription": True,
    }

    # Only when it is not the default, mirroring the Setup page — sending
    # `language: "English"` has been observed to behave differently from omitting it.
    language = (config.get("language") or "").strip()
    if language and language != "English":
        properties["language"] = language

    if config.get("enableRecording"):
        properties["enable_recording"] = True

    base = (config.get("conversationName") or "").strip() or "Mimic"
    payload: dict = {
        "replica_id": config.get("replicaId"),
        "conversation_name": f"{base} — {name or 'Candidate'}",
        "conversational_context": context,
        "custom_greeting": greeting,
        "properties": properties,
    }

    if config.get("personaId"):
        payload["persona_id"] = config["personaId"]
    if (config.get("callbackUrl") or "").strip():
        payload["callback_url"] = config["callbackUrl"].strip()

    return payload


async def create_conversation(
    settings: Settings,
    config: dict,
    *,
    candidate_name: str,
    questions: list[str],
    time_of_day: str | None = None,
    resume_text: str | None = None,
) -> dict:
    """Create the conversation and return `{conversation_id, conversation_url}`."""
    payload = build_payload(
        config,
        candidate_name=candidate_name,
        questions=questions,
        time_of_day=time_of_day,
        resume_text=resume_text,
    )
    response = await TavusClient(settings).create_conversation(payload)
    return {
        "conversation_id": response.get("conversation_id") or "",
        "conversation_url": response.get("conversation_url") or "",
    }


async def end_conversation(settings: Settings, conversation_id: str) -> None:
    """End a conversation. Best-effort — it also expires on its own."""
    if not conversation_id:
        return
    try:
        await TavusClient(settings).end_conversation(conversation_id)
    except Exception as exc:  # noqa: BLE001 - never block the caller
        logger.info("could not end conversation %s: %s", conversation_id, type(exc).__name__)

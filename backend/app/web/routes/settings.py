"""Recruiter settings — ports `server/routes/settings.ts`.

Two things live here: the recruiter-entered API keys, and the Video Avatar config
applied from the Setup page.

**Every response is masked.** No route here returns a raw key, on any path, for any
caller. The client is told whether a key is set, which source is winning, and four
characters from each end — enough to confirm which key is in place, not enough to use
it.

ROLE-GATING: the Express server required the recruiter role for this whole router.
Role gating is deferred, so any authenticated caller can currently read this status
and write these keys. That is the most sensitive gap on the deferred list — see the
package README.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request, status

from app.security import AuthedUser
from app.web.deps import WebUser, settings_of
from app.web.services import app_settings

logger = logging.getLogger("web.settings")

router = APIRouter(prefix="/settings", tags=["web:settings"])

# Tavus rejects a call shorter than a minute, and caps at two hours.
MIN_CALL_SECONDS = 60
MAX_CALL_SECONDS = 7200

# Field length caps, matching the Express normalisation. These are read aloud or
# shown to a candidate, so they are bounded rather than trusted.
MAX_AI_NAME = 60
MAX_CONVERSATION_NAME = 120
MAX_FALLBACK_QUESTIONS = 30


def _text(value: object, limit: int | None = None) -> str | None:
    """A trimmed non-empty string, optionally capped. None otherwise.

    None rather than "" because the stored config distinguishes "not set" from
    "explicitly blank" — a blank `customGreeting` would make the avatar open a call
    with silence.
    """
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    return cleaned[:limit] if limit else cleaned


def normalise_avatar_config(body: dict) -> dict:
    """A stored avatar config from a request. Pure, so it is directly testable."""
    duration = body.get("maxCallDuration")
    max_call = (
        min(int(duration), MAX_CALL_SECONDS)
        if isinstance(duration, (int, float))
        and not isinstance(duration, bool)
        and duration >= MIN_CALL_SECONDS
        else None
    )

    raw_questions = body.get("fallbackQuestions")
    fallback = (
        [
            question.strip()
            for question in raw_questions
            if isinstance(question, str) and question.strip()
        ][:MAX_FALLBACK_QUESTIONS]
        if isinstance(raw_questions, list)
        else None
    )

    return {
        "replicaId": _text(body.get("replicaId")),
        "personaId": _text(body.get("personaId")),
        "aiName": _text(body.get("aiName"), MAX_AI_NAME),
        "conversationName": _text(body.get("conversationName"), MAX_CONVERSATION_NAME),
        "conversationalContext": _text(body.get("conversationalContext")),
        "customGreeting": _text(body.get("customGreeting")),
        "language": _text(body.get("language")),
        "maxCallDuration": max_call,
        # Only ever True or absent: `enableRecording: false` and "not configured"
        # mean the same thing to Tavus, and storing False would imply a choice the
        # recruiter did not make.
        "enableRecording": True if body.get("enableRecording") is True else None,
        "callbackUrl": _text(body.get("callbackUrl")),
        "fallbackQuestions": fallback,
        # NO `tavusKey`. This route used to accept one from the request body, which
        # made applying an avatar a third way to write a vendor credential from the
        # browser. Credentials come from the deployment environment only — see the
        # note above the status route.
    }


# ── Gemini ────────────────────────────────────────────────────────────────────


@router.get("", summary="Provider status (read-only)")
async def status_(request: Request, user: AuthedUser = WebUser) -> dict:
    """Whether the deployment has Gemini configured, and on which model.

    **Read-only, and there is deliberately no route that writes any of it.**

    This surface used to accept a Gemini key, a Tavus key and a third copy of the
    Tavus key riding on an applied avatar config — all typed into a browser by a
    recruiter, all stored in `web_settings`, and all then used to score and run every
    candidate's interview on the deployment. That is three ways for one authenticated
    recruiter to change the credential everyone else's interviews run on, and it is
    the thing the architecture is otherwise built to prevent: the server holds every
    key, and none reaches the browser.

    The mobile client has never had any of it, and says why in
    `settings/sections/service_status_section.dart`: a recruiter needs the answer to
    "is it me, or is this not set up?", and nothing more. This is now the same — a
    status a recruiter can read when a feature misbehaves, with no control that
    implies they can fix it themselves.

    Credentials and the model come from the environment. See `.env.example`.
    """
    return await app_settings.gemini_status(settings_of(request))


# ── the applied avatar config ─────────────────────────────────────────────────


@router.get("/avatar", summary="Applied avatar config (masked)")
async def avatar_status(request: Request, user: AuthedUser = WebUser) -> dict:
    return await app_settings.avatar_status(settings_of(request))


@router.put("/avatar", summary="Apply an avatar config to candidate interviews")
async def apply_avatar(
    body: dict, request: Request, user: AuthedUser = WebUser
) -> dict:
    config = normalise_avatar_config(body or {})
    if not config["replicaId"]:
        # Rejected up front: a config with no replica cannot start a conversation, so
        # storing it would report "configured" for something guaranteed to fail at
        # interview time.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "A replica is required — pick one on the Setup page before applying.",
        )

    logger.info("avatar config applied by %s (replica %s)", user.uid, config["replicaId"])
    return await app_settings.save_avatar(settings_of(request), config)


@router.delete("/avatar", summary="Remove the applied avatar config")
async def clear_avatar(request: Request, user: AuthedUser = WebUser) -> dict:
    logger.info("avatar config cleared by %s", user.uid)
    return await app_settings.clear_avatar(settings_of(request))

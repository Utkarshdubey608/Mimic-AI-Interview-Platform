"""Interview templates — ports `server/routes/templates.ts`.

A template defines HOW an interview runs: the track, where its questions come from,
the rubric it is scored against, timing, integrity rules, branding, and (for the
spoken tracks) the voice.

**These are shared across recruiters, not owned by one.** `InterviewTemplate` has no
`recruiterId` field — unlike `Pipeline`, `InviteEmailTemplate` and `InterviewSession`,
which all carry one and are owner-scoped. That is a design choice in the original
(recruiters in a company reuse each other's templates), faithfully preserved here.

⚠️ Worth a decision before this goes live: on the Express server "shared across
recruiters" meant one company's recruiters. On a common backend it means everyone on
the deployment. Adding ownership is a small change here but a visible one for
recruiters, who would stop seeing templates they currently rely on — so it is not a
change to make silently. See this package's README.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.security import AuthedUser
from app.web.deps import WebUser, settings_of
from app.web.store import defaults, get_store

logger = logging.getLogger("web.templates")

router = APIRouter(prefix="/templates", tags=["web:templates"])

# Tracks whose questions are driven by a conversation rather than a fixed list.
CONVERSATIONAL_TRACKS = ("chatbot", "voice")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_template(
    body: dict, *, template_id: str, now: str, recruiter_id: str | None = None
) -> dict:
    """A complete template from a partial request. Pure, so it is directly testable.

    The defaults are applied per-section with the request layered on top, so a client
    sending only `timing.answerSeconds` keeps every other timing field rather than
    blanking them. The track-dependent sections are populated only for the tracks
    that read them — a `chat` template carrying a voice config would suggest the
    voice is used, and it is not.

    `recruiter_id` RECORDS the author without restricting anyone. Templates are
    still listed to every recruiter on the deployment exactly as before — this
    changes no visibility. It exists because the author was already known at this
    moment (and even logged: "template %s created by %s") and then thrown away, so
    every template ever created was permanently unattributable. Deciding later
    whether a company's templates should be private to it is impossible without
    this field, and every day it is not recorded adds documents no migration can
    ever attribute. See the ⚠️ at the top of this module for the decision itself.
    """
    track = body.get("track") or "chat"
    question_source = body.get("questionSource") or "fixed"
    role = body.get("role") or ""
    conversational = track in CONVERSATIONAL_TRACKS

    template = {
        "id": template_id,
        "name": body.get("name") or "Untitled template",
        "role": role,
        "seniority": body.get("seniority"),
        "track": track,
        "questionSource": question_source,
        "fixedQuestionSetId": body.get("fixedQuestionSetId"),
        "timing": {**defaults.DEFAULT_TIMING, **(body.get("timing") or {})},
        "rubric": body.get("rubric") or defaults.default_rubric(),
        "integrity": {**defaults.DEFAULT_INTEGRITY, **(body.get("integrity") or {})},
        "branding": {**defaults.DEFAULT_BRANDING, **(body.get("branding") or {})},
        "createdAt": now,
        "updatedAt": now,
    }

    # Recorded only when known. A legacy template edited by someone else must not
    # gain them as an "owner" — that would invent attribution rather than record it.
    if recruiter_id:
        template["recruiterId"] = recruiter_id

    # ── track-dependent sections ─────────────────────────────────────────────
    mode = body.get("mode")
    if mode is None and conversational:
        mode = "conversational"
    if mode is not None:
        template["mode"] = mode

    adaptive = body.get("adaptive")
    if adaptive is None and conversational and question_source == "adaptive":
        adaptive = defaults.default_adaptive(role or "Software Engineer")
    if adaptive is not None:
        template["adaptive"] = adaptive

    if body.get("fixedAllowFollowUps") is not None:
        template["fixedAllowFollowUps"] = body["fixedAllowFollowUps"]

    conversation_timing = body.get("conversationTiming")
    if conversation_timing is None and track == "chatbot":
        conversation_timing = dict(defaults.DEFAULT_CONVERSATION_TIMING)
    if conversation_timing is not None:
        template["conversationTiming"] = conversation_timing

    chatbot_timer = body.get("chatbotTimer")
    if chatbot_timer is None and track in ("chatbot", "video_avatar"):
        chatbot_timer = dict(defaults.DEFAULT_CHATBOT_TIMER)
    if chatbot_timer is not None:
        template["chatbotTimer"] = chatbot_timer

    voice = body.get("voice")
    if voice is None and track == "voice":
        voice = defaults.default_voice_config()
    if voice is not None:
        template["voice"] = voice

    return template


@router.get("", summary="Every interview template, newest first")
async def list_templates(request: Request, user: AuthedUser = WebUser) -> list[dict]:
    store = get_store(settings_of(request))
    templates = await store.templates.all()
    # Newest first, matching the Express ordering the list page relies on.
    return sorted(templates, key=lambda t: str(t.get("updatedAt") or ""), reverse=True)


@router.get("/{template_id}", summary="One template")
async def get_template(
    template_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    template = await store.templates.get(template_id)
    if not template:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")
    return template


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a template")
async def create_template(
    body: dict, request: Request, user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    template = build_template(
        body or {}, template_id=str(uuid.uuid4()), now=_now(), recruiter_id=user.uid
    )
    await store.templates.put(template)
    logger.info("template %s created by %s", template["id"], user.uid)
    return template


@router.put("/{template_id}", summary="Replace a template")
async def update_template(
    template_id: str, body: dict, request: Request, user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    existing = await store.templates.get(template_id)
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Template not found")

    # The client sends the whole edited template back, so this is a merge over the
    # stored copy. `id` and `createdAt` are re-pinned afterwards: they are identity,
    # and a client that echoed a stale or wrong value would otherwise rewrite them.
    updated = {
        **existing,
        **(body or {}),
        "id": existing["id"],
        "createdAt": existing.get("createdAt"),
        # Re-pinned like id and createdAt, and for the same reason: a client that
        # echoed this could claim someone else's template, or hand its own away.
        # Absent stays absent — editing a legacy template does not make the editor
        # its author.
        "recruiterId": existing.get("recruiterId"),
        "updatedAt": _now(),
    }
    if updated.get("recruiterId") is None:
        updated.pop("recruiterId", None)
    await store.templates.put(updated)
    return updated


@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a template",
)
async def delete_template(
    template_id: str, request: Request, user: AuthedUser = WebUser
) -> Response:
    # Deleting a template a session still references is allowed, matching Express.
    # Sessions carry their own resolved question plan, so an in-flight interview is
    # unaffected; only the report view degrades, and only for the template name.
    store = get_store(settings_of(request))
    await store.templates.delete(template_id)
    logger.info("template %s deleted by %s", template_id, user.uid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

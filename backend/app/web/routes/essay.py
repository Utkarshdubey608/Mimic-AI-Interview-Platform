"""Authoring essay prompts. The recruiter's side of the Essay Writing track.

Mirrors `coding.py` deliberately: a recruiter writes prompts, lists their own,
previews one exactly as a candidate would see it, and generates drafts from a
role and a topic. Generation RETURNS rather than saves — the same line
`question_sets/generate` and `mcq_sets` draw, because a model's first attempt at
a question is a suggestion and a recruiter should approve it before a candidate
ever meets it.

Ownership is enforced on every read of a single prompt, not merely on writes:
`guidanceMd` is the recruiter's private note about what they are marking for, and
another recruiter reading it would learn how to score against a rubric that is
not theirs.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status

from app.security import AuthedUser
from app.web.deps import RateLimitGenerateWeb, WebUser, assert_owner, settings_of
from app.web.services import essay_prompts
from app.web.store import get_store

logger = logging.getLogger("web.essay")

router = APIRouter(prefix="/essay", tags=["web:essay"])

MAX_PROMPTS_PER_GENERATION = 5


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _with_faults(record: dict) -> dict:
    """Every response about a prompt carries its readiness alongside it.

    Saving is permissive and using is strict, so a recruiter needs to see the gap
    at the moment they are looking at the prompt — not when an invite fails.
    """
    return {"prompt": record, "faults": essay_prompts.essay_faults(record)}


@router.post(
    "/prompts", status_code=status.HTTP_201_CREATED, summary="Create an essay prompt"
)
async def create_prompt(request: Request, body: dict, user: AuthedUser = WebUser) -> dict:
    try:
        record = essay_prompts.clean_prompt(
            body,
            recruiter_id=user.uid,
            prompt_id=f"ep-{uuid.uuid4().hex[:12]}",
            now=_now(),
        )
    except essay_prompts.InvalidEssayPrompt as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await get_store(settings_of(request)).essay_prompts.put(record)
    return _with_faults(record)


@router.get("/prompts", summary="List my essay prompts")
async def list_prompts(request: Request, user: AuthedUser = WebUser) -> list[dict]:
    store = get_store(settings_of(request))
    records = await store.essay_prompts.owned_by(user.uid)
    # The list is a chooser, so it carries only what the chooser needs — and never
    # `guidanceMd`, even though every record here belongs to the caller.
    return [
        {
            "id": r.get("id"),
            "title": r.get("title"),
            "promptType": r.get("promptType"),
            "language": r.get("language"),
            "minWords": r.get("minWords"),
            "maxWords": r.get("maxWords"),
            "timeLimitSeconds": r.get("timeLimitSeconds"),
            "faults": essay_prompts.essay_faults(r),
        }
        for r in sorted(records, key=lambda r: str(r.get("createdAt") or ""), reverse=True)
    ]


@router.get("/prompts/{prompt_id}", summary="One essay prompt, in full (owner only)")
async def get_prompt(request: Request, prompt_id: str, user: AuthedUser = WebUser) -> dict:
    store = get_store(settings_of(request))
    record = assert_owner(await store.essay_prompts.get(prompt_id), user, what="Essay prompt")
    return _with_faults(record)


@router.put("/prompts/{prompt_id}", summary="Replace an essay prompt")
async def replace_prompt(
    request: Request, prompt_id: str, body: dict, user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    existing = assert_owner(await store.essay_prompts.get(prompt_id), user, what="Essay prompt")
    try:
        record = essay_prompts.clean_prompt(
            body,
            recruiter_id=user.uid,
            prompt_id=prompt_id,
            # Creation time is a fact about the past; a replace does not rewrite it.
            now=str(existing.get("createdAt") or _now()),
        )
    except essay_prompts.InvalidEssayPrompt as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await store.essay_prompts.put(record)
    return _with_faults(record)


@router.delete("/prompts/{prompt_id}", summary="Delete an essay prompt")
async def delete_prompt(request: Request, prompt_id: str, user: AuthedUser = WebUser) -> dict:
    store = get_store(settings_of(request))
    assert_owner(await store.essay_prompts.get(prompt_id), user, what="Essay prompt")
    await store.essay_prompts.delete(prompt_id)
    return {"ok": True}


@router.get(
    "/prompts/{prompt_id}/preview",
    summary="The prompt exactly as a candidate would see it",
)
async def preview_prompt(request: Request, prompt_id: str, user: AuthedUser = WebUser) -> dict:
    """Not a convenience. A recruiter cannot check that their private guidance
    stayed private without being shown the projection itself."""
    store = get_store(settings_of(request))
    record = assert_owner(await store.essay_prompts.get(prompt_id), user, what="Essay prompt")
    return {"prompt": essay_prompts.public_prompt(record)}


@router.post(
    "/prompts/generate",
    summary="Draft essay prompts from a topic (does not save)",
    dependencies=[RateLimitGenerateWeb],
)
async def generate_prompts(request: Request, body: dict, user: AuthedUser = WebUser) -> dict:
    """RETURNS rather than saves, matching `question_sets/generate` and `mcq_sets`.

    A model's first attempt at a question is a suggestion. A recruiter reads it,
    edits it, and decides — before any candidate is asked to spend forty minutes
    answering it.
    """
    from app.web.services import essay_generation

    topic = str((body or {}).get("topic") or "").strip()
    if not topic:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A topic is needed to draft from")
    count = min(int((body or {}).get("count") or 3), MAX_PROMPTS_PER_GENERATION)

    drafts = await essay_generation.generate_prompts(
        settings_of(request),
        topic=topic,
        role=str((body or {}).get("role") or ""),
        difficulty=str((body or {}).get("difficulty") or "medium"),
        prompt_type=str((body or {}).get("promptType") or "argumentative"),
        language=str((body or {}).get("language") or "en"),
        count=count,
    )
    if not drafts:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Nothing usable came back. Try a more specific topic.",
        )
    logger.info("drafted %d essay prompt(s) for %s", len(drafts), user.uid)
    return {"prompts": drafts}

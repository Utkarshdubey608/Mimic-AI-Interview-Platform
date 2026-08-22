"""`/api/mcq-sets` — authoring MCQ papers, from any client.

Additive to the frozen mobile surface: new paths, nothing renamed.

The web surface has had this since MCQ shipped (`/api/web/mcq-sets`). This is the same
feature on the shared surface, and it is deliberately NOT a second implementation: the
cleaning, the validation, the completeness rules and the generation prompts all live in
the kernel (`app/mcq_authoring.py`, `app/mcq_gen.py`), and both routers are transport
over them. A paper authored on a phone and one authored in a browser are the same
document under the same rules.

── Ownership is the whole access control ────────────────────────────────────
A paper CONTAINS THE ANSWER KEY. `firestore.rules` denies clients the collection
outright, so nothing between a caller and somebody else's assessment except the
`recruiterId` check on every route here. It is stamped from the auth token and never
read from the body.

404, not 403, for a paper belonging to someone else: a 403 confirms it exists, which is
itself information about another recruiter's work.

── The one difference from the web surface ──────────────────────────────────
Generation calls Gemini through `providers.GeminiClient` and the environment key, where
the web resolves the recruiter's saved key through its own settings document. The PROMPT
and the normalisation are shared; only the transport differs, and unifying that would
mean promoting the web's settings document into the kernel — a much larger change than
"both clients can generate a paper" needs.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response, status

from app import mcq, mcq_authoring, mcq_gen
from app.config import Settings
from app.firebase import FirestoreUnavailable
from app.providers.gemini import GeminiClient
from app.ratelimit import RateLimitGenerate
from app.security import AuthedUser, require_firebase_user

logger = logging.getLogger("routers.mcq_sets")

router = APIRouter(
    prefix="/api/mcq-sets",
    tags=["mcq-sets"],
    dependencies=[Depends(require_firebase_user)],
)


def _settings(request: Request) -> Settings:
    return request.app.state.settings


def _clean(body: dict, *, recruiter_id: str, existing: dict | None = None) -> dict:
    try:
        return mcq_authoring.clean_set(body, recruiter_id=recruiter_id, existing=existing)
    except mcq_authoring.InvalidPaper as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


async def _owned_or_404(request: Request, set_id: str, recruiter_id: str) -> dict:
    try:
        paper = await mcq.fetch_set(_settings(request), set_id, recruiter_id=recruiter_id)
    except FirestoreUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    if paper is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such MCQ set.")
    return paper


@router.get("", summary="This recruiter's MCQ sets, by name")
async def list_sets(
    request: Request, user: AuthedUser = Depends(require_firebase_user)
) -> list[dict]:
    papers = await mcq.list_sets(_settings(request), recruiter_id=user.uid)
    return [mcq_authoring.with_readiness(paper) for paper in papers]


@router.get("/{set_id}", summary="One MCQ set")
async def get_set(
    set_id: str, request: Request, user: AuthedUser = Depends(require_firebase_user)
) -> dict:
    return mcq_authoring.with_readiness(await _owned_or_404(request, set_id, user.uid))


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create an MCQ set")
async def create_set(
    request: Request,
    body: dict = Body(...),
    user: AuthedUser = Depends(require_firebase_user),
) -> dict:
    paper = _clean(body, recruiter_id=user.uid)
    await mcq.save_set(_settings(request), paper)
    logger.info("mcq set created id=%s questions=%d", paper["id"], len(paper["questions"]))
    return mcq_authoring.with_readiness(paper)


@router.put("/{set_id}", summary="Update an MCQ set")
async def update_set(
    set_id: str,
    request: Request,
    body: dict = Body(...),
    user: AuthedUser = Depends(require_firebase_user),
) -> dict:
    existing = await _owned_or_404(request, set_id, user.uid)
    paper = _clean(body, recruiter_id=user.uid, existing=existing)
    # The path wins over anything in the body: a body id pointing elsewhere would let
    # one recruiter's save land on another recruiter's paper, past the ownership check
    # that was made against the path.
    paper["id"] = set_id
    await mcq.save_set(_settings(request), paper)
    return mcq_authoring.with_readiness(paper)


@router.post("/{set_id}/duplicate", summary="Duplicate an MCQ set")
async def duplicate_set(
    set_id: str, request: Request, user: AuthedUser = Depends(require_firebase_user)
) -> dict:
    """A copy to edit, so a working paper is never the thing being experimented on."""
    import uuid

    original = await _owned_or_404(request, set_id, user.uid)
    copy = {
        **original,
        "id": uuid.uuid4().hex,
        "name": mcq_authoring.text_of(
            f"{original.get('name')} (copy)", mcq_authoring.MAX_NAME
        ),
        "createdAt": mcq_authoring.now_iso(),
        "updatedAt": mcq_authoring.now_iso(),
    }
    await mcq.save_set(_settings(request), copy)
    return mcq_authoring.with_readiness(copy)


@router.delete(
    "/{set_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete an MCQ set"
)
async def delete_set(
    set_id: str, request: Request, user: AuthedUser = Depends(require_firebase_user)
) -> Response:
    await _owned_or_404(request, set_id, user.uid)
    await mcq.delete_set(_settings(request), set_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── role → topics → generated paper ───────────────────────────────────────────


async def _generate_json(request: Request, prompt: str, schema: dict, *, thinking: bool) -> dict:
    """One Gemini call that must come back as JSON, or `{}`.

    `{}` rather than an exception for unparseable output: the caller turns an empty
    result into a message a recruiter can act on ("try again, or narrow the topics"),
    which is more useful than a stack trace about a model's punctuation.
    """
    body: dict = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": schema,
            # Thinking OFF for topics — a list of nouns, with a recruiter watching.
            # ON for a paper: writing distractors that are plausible but wrong is the
            # reasoning-heavy part of this whole mode, and a few extra seconds once, at
            # authoring time, beats a paper of obvious answers.
            **({} if thinking else {"thinkingConfig": {"thinkingBudget": 0}}),
        },
    }
    response = await GeminiClient(_settings(request)).generate_content(body)
    parts = (
        (response.get("candidates") or [{}])[0].get("content", {}).get("parts") or [{}]
    )
    text = "".join(str(part.get("text") or "") for part in parts).strip()
    try:
        return json.loads(text)
    except ValueError:
        logger.warning("mcq generation: response was not JSON")
        return {}


@router.post(
    "/suggest-topics",
    summary="Topics worth testing for a role",
    dependencies=[RateLimitGenerate],
)
async def suggest_topics(
    request: Request,
    body: dict = Body(...),
    user: AuthedUser = Depends(require_firebase_user),
) -> dict:
    role = mcq_authoring.text_of((body or {}).get("role"), 120)
    if not role:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A role is required.")

    payload = await _generate_json(
        request, mcq_gen.build_topic_prompt(role), mcq_gen.TOPIC_SCHEMA, thinking=False
    )
    topics = mcq_gen.normalise_topics(payload)
    if not topics:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "No topics came back for that role. Try naming it more specifically, "
            "or add your own topics.",
        )
    return {"role": role, "topics": topics}


@router.post(
    "/generate",
    summary="Generate MCQs from a role and topics (does not save)",
    dependencies=[RateLimitGenerate],
)
async def generate(
    request: Request,
    body: dict = Body(...),
    user: AuthedUser = Depends(require_firebase_user),
) -> dict:
    """Questions for review. The recruiter edits them, then saves separately.

    Generation RETURNS rather than saves, matching the web surface and
    `question_sets/generate`: a model call costs something, and a recruiter who dislikes
    the result should not have to delete a set they never wanted.
    """
    body = body or {}
    role = mcq_authoring.text_of(body.get("role"), 120)
    if not role:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A role is required.")

    topics = [
        t for t in (mcq_authoring.text_of(x, 60) for x in (body.get("topics") or [])) if t
    ][: mcq_gen.MAX_TOPICS]
    if not topics:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Pick at least one topic — questions spread across nothing is not a paper.",
        )

    fallback = max(1, min(mcq_gen.MAX_QUESTIONS, mcq_authoring.int_of(body.get("count"), 10)))
    split = mcq_gen.normalise_split(
        mcq_authoring.text_of(body.get("style"), 20).lower() or "technical",
        mcq_authoring.int_of(body.get("technicalCount"), fallback),
        mcq_authoring.int_of(body.get("nonTechnicalCount"), fallback),
    )
    count = sum(split.values())

    difficulty = mcq_authoring.text_of(body.get("difficulty"), 12).lower()
    if difficulty not in mcq_gen.DIFFICULTIES:
        difficulty = "mixed"

    prompt = mcq_gen.build_paper_prompt(
        role=role,
        topics=topics,
        split=split,
        difficulty=difficulty,
        allow_multi=bool(body.get("allowMulti")),
    )
    payload = await _generate_json(request, prompt, mcq_gen.PAPER_SCHEMA, thinking=True)
    questions = mcq_gen.normalise_generated(payload, sections=tuple(split))

    if not questions:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Nothing usable came back. Every generated question was missing its "
            "options or its correct answer, so none were kept — try again, or "
            "narrow the topics.",
        )

    # `dropped` is reported rather than hidden: a recruiter who asked for 20 and
    # received 17 is entitled to know the difference was thrown away for being
    # unusable, not that the model was asked for 17.
    return {
        "role": role,
        "topics": topics,
        "questions": questions,
        "requested": count,
        "dropped": max(0, count - len(questions)),
        "sections": split,
        "delivered": mcq_gen.section_counts(questions),
    }

"""Question sets — ports `server/routes/questionSets.ts`.

Reusable fixed question lists. The array order IS the saved order, which is what
makes drag-to-reorder work.

Like interview templates, these are **shared across recruiters** rather than owned:
`QuestionSet` carries no `recruiterId`. See the note in `templates.py`.

`POST /generate` reads a résumé PDF and returns questions for review WITHOUT saving
them — the recruiter edits the list and saves it with `POST ""`. That split is
deliberate: generation costs a model call, and a recruiter who dislikes the result
should not have to delete a set they never wanted.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)

from app.security import AuthedUser
from app.web.deps import RateLimitGenerateWeb, WebUser, settings_of
from app.web.services import gemini, question_gen
from app.web.store import get_store

logger = logging.getLogger("web.question_sets")

router = APIRouter(prefix="/question-sets", tags=["web:question-sets"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalise_questions(raw: object) -> list[dict]:
    """Incoming questions → stored questions, order preserved.

    Each question keeps its id when it has one, so editing a set does not renumber
    the questions an in-flight session already recorded answers against. A question
    with no text is dropped rather than saved blank — an empty question would be
    read aloud as silence in the voice and avatar tracks.
    """
    if not isinstance(raw, list):
        return []

    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        out.append(
            {
                "id": str(item.get("id") or uuid.uuid4()),
                "text": text,
                "category": item.get("category") or None,
                "idealAnswerNotes": item.get("idealAnswerNotes") or None,
            }
        )
    return out


@router.get("", summary="Every question set, by name")
async def list_sets(request: Request, user: AuthedUser = WebUser) -> list[dict]:
    store = get_store(settings_of(request))
    sets_ = await store.question_sets.all()
    # Alphabetical, matching the Express ordering the picker relies on.
    return sorted(sets_, key=lambda s: str(s.get("name") or "").lower())


@router.post(
    "/generate",
    summary="Generate questions from a résumé PDF (does not save)",
    dependencies=[RateLimitGenerateWeb],
)
async def generate(
    request: Request,
    resume: UploadFile = File(...),
    style: str = Form(default="mix"),
    difficulty: str = Form(default="mixed"),
    role: str = Form(default=""),
    name: str = Form(default=""),
    technicalCount: str = Form(default="8"),
    nonTechnicalCount: str = Form(default="8"),
    user: AuthedUser = WebUser,
) -> dict:
    """Questions tailored to one résumé, returned for review.

    The Express version also accepted an `apiKey` form field — a Gemini key typed
    into the browser dialog — and it is deliberately NOT ported. The server holds the
    credential on every other route here and on mobile; accepting one from a client
    contradicts that. A deployment with no key configured now says so.
    """
    settings = settings_of(request)

    if resume.content_type != "application/pdf":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Only PDF résumés are supported"
        )

    pdf_bytes = await resume.read()
    if not pdf_bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No résumé PDF uploaded")
    if len(pdf_bytes) > question_gen.MAX_PDF_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That PDF is too large."
        )

    chosen_style = style if style in question_gen.STYLES else "mix"
    chosen_difficulty = (
        difficulty if difficulty in question_gen.DIFFICULTIES else "mixed"
    )
    technical = question_gen.clamp_int(technicalCount, 0, question_gen.MAX_QUESTIONS, 8)
    non_technical = question_gen.clamp_int(
        nonTechnicalCount, 0, question_gen.MAX_QUESTIONS, 8
    )

    total = question_gen.total_for(chosen_style, technical, non_technical)
    if total < 1 or total > question_gen.MAX_QUESTIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Total questions must be between 1 and {question_gen.MAX_QUESTIONS}",
        )

    if not await gemini.is_enabled(settings):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No Gemini API key configured. Add one in Settings.",
        )

    cleaned_role = role.strip() or None
    try:
        questions = await question_gen.generate_from_pdf(
            settings,
            pdf_bytes=pdf_bytes,
            style=chosen_style,
            technical=technical,
            non_technical=non_technical,
            difficulty=chosen_difficulty,
            role=cleaned_role,
        )
    except Exception as exc:  # noqa: BLE001 - translated to a message for the dialog
        logger.error("question generation failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, question_gen.friendly_error(exc)
        ) from exc

    if not questions:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Gemini returned no questions. The résumé may be empty/scanned — try "
            "another file.",
        )

    suggested = name.strip() or f"{cleaned_role or 'Candidate'} — Résumé Screen"
    return {"questions": questions, "suggestedName": suggested}


@router.get("/{set_id}", summary="One question set")
async def get_set(set_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    store = get_store(settings_of(request))
    found = await store.question_sets.get(set_id)
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question set not found")
    return found


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a question set")
async def create_set(body: dict, request: Request, user: AuthedUser = WebUser) -> dict:
    store = get_store(settings_of(request))
    now = _now()
    created = {
        "id": str(uuid.uuid4()),
        "name": str((body or {}).get("name") or "").strip() or "Untitled set",
        "questions": normalise_questions((body or {}).get("questions")),
        # Records the author WITHOUT restricting anyone: these are still listed to
        # every recruiter exactly as before. The uid was already known here and
        # discarded, leaving every set unattributable — which is what makes the
        # "should a company's sets be private to it" decision impossible to take
        # later. See the ⚠️ in routes/templates.py.
        "recruiterId": user.uid,
        "createdAt": now,
        "updatedAt": now,
    }
    await store.question_sets.put(created)
    return created


@router.put("/{set_id}", summary="Update a question set")
async def update_set(
    set_id: str, body: dict, request: Request, user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    existing = await store.question_sets.get(set_id)
    if not existing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question set not found")

    body = body or {}
    name = str(body.get("name") or "").strip() or existing.get("name")
    # Absent `questions` means "name only" — replacing them with an empty list would
    # silently wipe the set. An explicitly empty array does clear it.
    questions = (
        normalise_questions(body["questions"])
        if "questions" in body
        else existing.get("questions") or []
    )

    updated = {
        **existing,
        "name": name,
        "questions": questions,
        "updatedAt": _now(),
    }
    await store.question_sets.put(updated)
    return updated


@router.post(
    "/{set_id}/duplicate",
    status_code=status.HTTP_201_CREATED,
    summary="Copy a question set",
)
async def duplicate_set(
    set_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    source = await store.question_sets.get(set_id)
    if not source:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question set not found")

    now = _now()
    copy = {
        "id": str(uuid.uuid4()),
        "name": f"{source.get('name')} (copy)",
        # Fresh question ids: the copy is a separate set, and sharing ids with the
        # original would make per-question answers ambiguous across the two.
        "questions": [
            {**question, "id": str(uuid.uuid4())}
            for question in source.get("questions") or []
        ],
        # The copy is a new set, so its author is whoever copied it — not the
        # author of the original.
        "recruiterId": user.uid,
        "createdAt": now,
        "updatedAt": now,
    }
    await store.question_sets.put(copy)
    return copy


@router.delete(
    "/{set_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a question set"
)
async def delete_set(
    set_id: str, request: Request, user: AuthedUser = WebUser
) -> Response:
    store = get_store(settings_of(request))
    await store.question_sets.delete(set_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

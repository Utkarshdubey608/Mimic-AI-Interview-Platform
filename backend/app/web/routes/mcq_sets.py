"""MCQ question sets — the recruiter's authored multiple-choice papers.

Reusable, drag-ordered lists of closed questions. The array order IS the saved
order, exactly as `question_sets.py` does it, so the same drag-to-reorder editor
works here.

── Why this is a separate collection, owner-scoped ───────────────────────────
`templates` and `question_sets` are shared across every recruiter on the
deployment — a deliberate choice for open-ended questions, since recruiters in a
company reuse each other's work (see the ⚠️ note in `templates.py`).

An MCQ set is different in kind, because it CONTAINS THE CORRECT ANSWERS. Shared
storage would mean every recruiter on the deployment can read every assessment's
answer key, which on a multi-company backend is a cross-tenant leak of the one
thing an assessment depends on keeping.

So MCQ sets live in their own collection, owner-scoped from their first day.
Nothing about the existing shared sets changes, no recruiter loses access to
anything they rely on, and there is no ownership migration to run later.

`recruiterId` is stamped server-side from the auth token and never read from the
request body — the same rule sessions, pipelines and feedback follow.

── Validation is refused early, on purpose ──────────────────────────────────
A question with one option, or with no correct answer marked, is not a question —
it is a trap that scores every candidate zero. It is rejected at save time rather
than discovered by the first candidate to sit the paper.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, HTTPException, Request, Response, status

from app.security import AuthedUser
from app.web.deps import WebUser, settings_of
from app.web.store import get_store

logger = logging.getLogger("web.mcq_sets")

router = APIRouter(prefix="/mcq-sets", tags=["web:mcq-sets"])

MAX_NAME = 120
MAX_TEXT = 2000
MAX_OPTION_TEXT = 500
MAX_OPTIONS = 10
MAX_QUESTIONS = 200
DIFFICULTIES = ("easy", "medium", "hard")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: object, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _clean_question(raw: object, index: int) -> dict:
    """One authored MCQ, validated.

    Rejects rather than repairs. A silently "fixed" question is worse than a
    refused one: the recruiter believes they authored something they did not, and
    only a candidate's score reveals the difference.
    """
    where = f"Question {index + 1}"
    if not isinstance(raw, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{where} is not a question.")

    text = _text(raw.get("text"), MAX_TEXT)
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{where} has no text.")

    options: list[dict] = []
    seen_ids: set[str] = set()
    for opt in raw.get("options") or []:
        if not isinstance(opt, dict):
            continue
        opt_text = _text(opt.get("text"), MAX_OPTION_TEXT)
        if not opt_text:
            continue
        opt_id = _text(opt.get("id"), 64) or uuid.uuid4().hex[:8]
        if opt_id in seen_ids:
            # Duplicate ids would make the key ambiguous — two options could both
            # claim to be the right one.
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{where} has two options with the same id."
            )
        seen_ids.add(opt_id)
        options.append({"id": opt_id, "text": opt_text})

    if len(options) < 2:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{where} needs at least two options — a single-option question asks nothing.",
        )
    if len(options) > MAX_OPTIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"{where} has more than {MAX_OPTIONS} options."
        )

    key = [str(v) for v in (raw.get("correctOptionIds") or []) if str(v) in seen_ids]
    # De-duplicate while keeping order, so a key of ["a","a"] cannot masquerade as
    # a two-answer question.
    key = list(dict.fromkeys(key))
    if not key:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{where} has no correct answer marked — every candidate would score zero.",
        )
    if len(key) == len(options):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{where} marks every option correct, so it cannot distinguish anyone.",
        )

    answer_type = "multi" if raw.get("type") == "multi" or len(key) > 1 else "single"
    if answer_type == "single" and len(key) > 1:  # pragma: no cover - defensive
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"{where} is single-answer but marks several correct."
        )

    question: dict = {
        "id": _text(raw.get("id"), 64) or uuid.uuid4().hex,
        "text": text,
        "options": options,
        "correctOptionIds": key,
        "type": answer_type,
    }

    points = raw.get("points")
    if isinstance(points, (int, float)) and not isinstance(points, bool) and points >= 0:
        question["points"] = float(points)
    if topic := _text(raw.get("topic") or raw.get("category"), 120):
        question["topic"] = topic
    if (difficulty := _text(raw.get("difficulty"), 12).lower()) in DIFFICULTIES:
        question["difficulty"] = difficulty
    if explanation := _text(raw.get("explanation"), MAX_TEXT):
        question["explanation"] = explanation

    return question


def _clean_set(body: dict, *, recruiter_id: str, existing: dict | None = None) -> dict:
    name = _text(body.get("name"), MAX_NAME)
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The set needs a name.")

    raw_questions = body.get("questions")
    if not isinstance(raw_questions, list) or not raw_questions:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The set needs at least one question.")
    if len(raw_questions) > MAX_QUESTIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"A set holds at most {MAX_QUESTIONS} questions."
        )

    return {
        "id": (existing or {}).get("id") or uuid.uuid4().hex,
        "kind": "mcq",
        "name": name,
        # Stamped from the token. Never from the body — a client that could set
        # this could write into another recruiter's sets.
        "recruiterId": recruiter_id,
        "questions": [_clean_question(q, i) for i, q in enumerate(raw_questions)],
        "createdAt": (existing or {}).get("createdAt") or _now(),
        "updatedAt": _now(),
    }


async def _owned_or_404(store, set_id: str, recruiter_id: str) -> dict:
    """One set, or 404.

    404 rather than 403 when it belongs to someone else: a 403 confirms the set
    exists, which is itself information about another recruiter's work.
    """
    doc = await store.mcq_sets.get(set_id)
    if not doc or doc.get("recruiterId") != recruiter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such MCQ set.")
    return doc


@router.get("", summary="This recruiter's MCQ sets, by name")
async def list_sets(request: Request, user: AuthedUser = WebUser) -> list[dict]:
    store = get_store(settings_of(request))
    sets_ = await store.mcq_sets.owned_by(user.uid)
    return sorted(sets_, key=lambda s: str(s.get("name") or "").lower())


@router.get("/{set_id}", summary="One MCQ set")
async def get_set(set_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    store = get_store(settings_of(request))
    return await _owned_or_404(store, set_id, user.uid)


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create an MCQ set")
async def create_set(
    request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    doc = _clean_set(body, recruiter_id=user.uid)
    await store.mcq_sets.put(doc)
    logger.info("mcq set created id=%s questions=%d", doc["id"], len(doc["questions"]))
    return doc


@router.put("/{set_id}", summary="Update an MCQ set")
async def update_set(
    set_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    existing = await _owned_or_404(store, set_id, user.uid)
    doc = _clean_set(body, recruiter_id=user.uid, existing=existing)
    doc["id"] = set_id
    await store.mcq_sets.put(doc)
    return doc


@router.post("/{set_id}/duplicate", summary="Duplicate an MCQ set")
async def duplicate_set(
    set_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    """A copy to edit, so a working paper is never the thing being experimented on."""
    store = get_store(settings_of(request))
    original = await _owned_or_404(store, set_id, user.uid)
    copy = {
        **original,
        "id": uuid.uuid4().hex,
        "name": _text(f"{original.get('name')} (copy)", MAX_NAME),
        "createdAt": _now(),
        "updatedAt": _now(),
    }
    await store.mcq_sets.put(copy)
    return copy


@router.delete("/{set_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete an MCQ set")
async def delete_set(set_id: str, request: Request, user: AuthedUser = WebUser) -> Response:
    store = get_store(settings_of(request))
    await _owned_or_404(store, set_id, user.uid)
    await store.mcq_sets.delete(set_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

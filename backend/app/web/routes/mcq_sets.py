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
from app.web.deps import RateLimitGenerateWeb, WebUser, settings_of
from app.web.services import mcq_gen, question_gen
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
    """One authored MCQ, cleaned. INCOMPLETE IS ALLOWED.

    Saving is permissive; USING is strict. Nobody authors a forty-question paper
    through a sequence of individually valid states: you type a question, then its
    options, then mark the answer, and every moment in between is incomplete.

    Refusing those states made this feature unusable from its very first click.
    The editor creates a blank question so a new set is not empty, and the server
    then rejected the blank question -- two rules of mine contradicting each other,
    and the "New MCQ set" button answered 400 every time.

    So an incomplete question is stored as a draft and `set_faults` reports what is
    missing. Completeness is enforced where it actually matters: when a paper is
    attached to an interview. A question with no correct answer scores every
    candidate zero, and that must never reach a candidate -- but it is fine, and
    necessary, halfway through being written.

    Structurally impossible input is still refused. That is a client bug rather
    than an authoring state, and storing it would make a result unexplainable.
    """
    where = f"Question {index + 1}"
    if not isinstance(raw, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{where} is not a question.")

    # May be empty while being written. `set_faults` reports it; save does not block.
    text = _text(raw.get("text"), MAX_TEXT)

    options: list[dict] = []
    seen_ids: set[str] = set()
    for opt in raw.get("options") or []:
        if not isinstance(opt, dict):
            continue
        # An option with no text yet is a row being typed into, and it is KEPT.
        # Dropping it meant a half-written question came back from the server with
        # its option rows deleted — the recruiter's blank options vanishing from
        # under them mid-edit. Readiness reports the emptiness; the row survives.
        opt_text = _text(opt.get("text"), MAX_OPTION_TEXT)
        opt_id = _text(opt.get("id"), 64) or uuid.uuid4().hex[:8]
        if opt_id in seen_ids:
            # Duplicate ids would make the key ambiguous — two options could both
            # claim to be the right one.
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{where} has two options with the same id."
            )
        seen_ids.add(opt_id)
        options.append({"id": opt_id, "text": opt_text})

    if len(options) > MAX_OPTIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"{where} has more than {MAX_OPTIONS} options."
        )

    key = [str(v) for v in (raw.get("correctOptionIds") or []) if str(v) in seen_ids]
    # De-duplicate while keeping order, so a key of ["a","a"] cannot masquerade as
    # a two-answer question.
    key = list(dict.fromkeys(key))

    answer_type = "multi" if raw.get("type") == "multi" or len(key) > 1 else "single"

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

    # An empty set is a draft, not an error: a set is created before it is written.
    raw_questions = body.get("questions")
    if not isinstance(raw_questions, list):
        raw_questions = []
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



def question_fault(question: dict, index: int) -> str | None:
    """Why this question cannot be USED, or None.

    The rules save no longer enforces. Each makes a paper unable to distinguish
    candidates: no text asks nothing, one option asks nothing, no correct answer
    scores everyone zero, and every option correct separates nobody.
    """
    where = f"Question {index + 1}"
    if not (question.get("text") or "").strip():
        return f"{where} has no text."
    options = [o for o in question.get("options") or [] if (o.get("text") or "").strip()]
    if len(options) < 2:
        return f"{where} needs at least two options."
    ids = {o["id"] for o in options}
    key = [k for k in question.get("correctOptionIds") or [] if k in ids]
    if not key:
        return f"{where} has no correct answer marked."
    if len(key) == len(options):
        return f"{where} marks every option correct, so it cannot distinguish anyone."
    return None


def set_faults(doc: dict) -> list[str]:
    """Everything between this set and being usable in an interview."""
    questions = doc.get("questions") or []
    if not questions:
        return ["The set has no questions yet."]
    return [f for f in (question_fault(q, i) for i, q in enumerate(questions)) if f]


def with_readiness(doc: dict) -> dict:
    """The set, plus whether it can be used. Computed on read, never stored.

    Derived rather than persisted so it cannot go stale against the questions it
    describes.
    """
    faults = set_faults(doc)
    return {**doc, "ready": not faults, "faults": faults}


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
    ordered = sorted(sets_, key=lambda s: str(s.get("name") or "").lower())
    return [with_readiness(doc) for doc in ordered]


@router.get("/{set_id}", summary="One MCQ set")
async def get_set(set_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    store = get_store(settings_of(request))
    return with_readiness(await _owned_or_404(store, set_id, user.uid))


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create an MCQ set")
async def create_set(
    request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    doc = _clean_set(body, recruiter_id=user.uid)
    await store.mcq_sets.put(doc)
    logger.info("mcq set created id=%s questions=%d", doc["id"], len(doc["questions"]))
    return with_readiness(doc)


@router.put("/{set_id}", summary="Update an MCQ set")
async def update_set(
    set_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    existing = await _owned_or_404(store, set_id, user.uid)
    doc = _clean_set(body, recruiter_id=user.uid, existing=existing)
    doc["id"] = set_id
    await store.mcq_sets.put(doc)
    return with_readiness(doc)


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
    return with_readiness(copy)


@router.delete("/{set_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete an MCQ set")
async def delete_set(set_id: str, request: Request, user: AuthedUser = WebUser) -> Response:
    store = get_store(settings_of(request))
    await _owned_or_404(store, set_id, user.uid)
    await store.mcq_sets.delete(set_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Mode A: role → topics → generated paper ─────────────────────────────────
#
# Two one-time calls at authoring. Neither runs per candidate: a paper is written
# once and sat by everyone, which is why this mode costs almost nothing to operate
# compared with the six open-ended ones.
#
# Generation RETURNS rather than saves, matching question_sets/generate: a model
# call costs something, and a recruiter who dislikes the result should not have to
# delete a set they never wanted.


@router.post(
    "/suggest-topics",
    summary="Topics worth testing for a role",
    dependencies=[RateLimitGenerateWeb],
)
async def suggest_topics(
    request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    role = _text((body or {}).get("role"), 120)
    if not role:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A role is required.")

    settings = settings_of(request)
    try:
        topics = await mcq_gen.suggest_topics(settings, role=role)
    except Exception as exc:  # noqa: BLE001 - mapped to a readable message below
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, question_gen.friendly_error(exc)
        ) from exc

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
    dependencies=[RateLimitGenerateWeb],
)
async def generate(
    request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    """Questions for review. The recruiter edits them, then saves separately."""
    body = body or {}
    role = _text(body.get("role"), 120)
    if not role:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A role is required.")

    topics = [
        t for t in (_text(x, 60) for x in (body.get("topics") or [])) if t
    ][: mcq_gen.MAX_TOPICS]
    if not topics:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Pick at least one topic — questions spread across nothing is not a paper.",
        )

    raw_count = body.get("count")
    count = raw_count if isinstance(raw_count, int) and not isinstance(raw_count, bool) else 10
    count = max(1, min(mcq_gen.MAX_QUESTIONS, count))

    difficulty = _text(body.get("difficulty"), 12).lower()
    if difficulty not in mcq_gen.DIFFICULTIES:
        difficulty = "mixed"

    settings = settings_of(request)
    try:
        questions = await mcq_gen.generate_paper(
            settings,
            role=role,
            topics=topics,
            count=count,
            difficulty=difficulty,
            allow_multi=bool(body.get("allowMulti")),
        )
    except Exception as exc:  # noqa: BLE001 - mapped to a readable message below
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, question_gen.friendly_error(exc)
        ) from exc

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
    }

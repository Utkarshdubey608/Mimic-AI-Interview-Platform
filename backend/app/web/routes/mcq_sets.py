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

from fastapi import APIRouter, Body, File, HTTPException, Request, Response, UploadFile, status

from app.security import AuthedUser
from app.web.deps import RateLimitGenerateWeb, WebUser, settings_of
from app import mcq_authoring
from app.web.services import mcq_diagrams, mcq_gen, mcq_import, question_gen
from app.web.store import get_store

logger = logging.getLogger("web.mcq_sets")

router = APIRouter(prefix="/mcq-sets", tags=["web:mcq-sets"])

# Shared with the invite-extract upload — one ceiling for "a file a recruiter
# drops into a review step", rather than a new number to keep in sync.
MAX_IMPORT_BYTES = 10 * 1024 * 1024

# The cleaning, the validation and the completeness rules live in the KERNEL, so both
# surfaces enforce the same ones — see app/mcq_authoring.py. This module is now the web
# surface's transport for them: store access, ownership, and mapping a domain error onto
# an HTTP status.
#
# Re-exported because tests and other routes import these names from here.
MAX_NAME = mcq_authoring.MAX_NAME
MAX_TEXT = mcq_authoring.MAX_TEXT
MAX_OPTION_TEXT = mcq_authoring.MAX_OPTION_TEXT
MAX_OPTIONS = mcq_authoring.MAX_OPTIONS
MAX_QUESTIONS = mcq_authoring.MAX_QUESTIONS
MAX_SECTIONS = mcq_authoring.MAX_SECTIONS
MAX_PASSAGE = mcq_authoring.MAX_PASSAGE
MAX_CODE = mcq_authoring.MAX_CODE
DIFFICULTIES = mcq_authoring.DIFFICULTIES

question_fault = mcq_authoring.question_fault
set_faults = mcq_authoring.set_faults
with_readiness = mcq_authoring.with_readiness

_now = mcq_authoring.now_iso
_text = mcq_authoring.text_of
_int = mcq_authoring.int_of


def _clean_set(body: dict, *, recruiter_id: str, existing: dict | None = None) -> dict:
    """The kernel cleaner, with its domain error mapped onto a 400.

    The mapping lives here rather than in the kernel because a status code is a
    transport concern — `app/routers/mcq_sets.py` does exactly the same on the other
    surface, and neither has to agree with the other about anything but the message.
    """
    try:
        return mcq_authoring.clean_set(body, recruiter_id=recruiter_id, existing=existing)
    except mcq_authoring.InvalidPaper as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


async def _owned_or_404(store, set_id: str, recruiter_id: str) -> dict:
    """One set, or 404.

    404 rather than 403 when it belongs to someone else: a 403 confirms the set
    exists, which is itself information about another recruiter's work.
    """
    doc = await store.mcq_sets.get(set_id)
    if not doc or doc.get("recruiterId") != recruiter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such MCQ set.")
    return doc


def _section_or_404(doc: dict, section_id: str) -> dict:
    """One section of an already-owned set, or 404 — same reasoning as
    `_owned_or_404`: a section id that does not belong to this set is
    indistinguishable, to the caller, from one that never existed."""
    for section in doc.get("sections") or []:
        if section.get("id") == section_id:
            return section
    raise HTTPException(status.HTTP_404_NOT_FOUND, "No such section.")


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
        # LOGGED, because friendly_error's whole point is that the recruiter sees a
        # message they can act on while the real cause stays available to us. The
        # first version of this route omitted the log, so a bug that stopped the
        # prompt reaching Gemini at all surfaced in production as the generic
        # "Gemini request failed" with nothing behind it anywhere.
        logger.exception("mcq generation failed")
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

    # The SHAPE of the paper. Same vocabulary the invite wizard, the template
    # editor and resume generation already use — `style` plus a count per section —
    # so a recruiter who has met "Mix, 6 and 4" once has met it everywhere.
    #
    # `count` is still honoured as the fallback for both counts, which keeps every
    # caller written before sections existed producing exactly the paper it always
    # did: no style means a single technical section of `count` questions.
    fallback = max(1, min(mcq_gen.MAX_QUESTIONS, _int(body.get("count"), 10)))
    split = mcq_gen.normalise_split(
        _text(body.get("style"), 20).lower() or "technical",
        _int(body.get("technicalCount"), fallback),
        _int(body.get("nonTechnicalCount"), fallback),
    )
    count = sum(split.values())

    difficulty = _text(body.get("difficulty"), 12).lower()
    if difficulty not in mcq_gen.DIFFICULTIES:
        difficulty = "mixed"

    settings = settings_of(request)
    try:
        questions = await mcq_gen.generate_paper(
            settings,
            role=role,
            topics=topics,
            split=split,
            difficulty=difficulty,
            allow_multi=bool(body.get("allowMulti")),
        )
    except Exception as exc:  # noqa: BLE001 - mapped to a readable message below
        # LOGGED, because friendly_error's whole point is that the recruiter sees a
        # message they can act on while the real cause stays available to us. The
        # first version of this route omitted the log, so a bug that stopped the
        # prompt reaching Gemini at all surfaced in production as the generic
        # "Gemini request failed" with nothing behind it anywhere.
        logger.exception("mcq generation failed")
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
        # The split asked for and the split that arrived, separately, for the same
        # reason `dropped` is here: a model told "6 technical and 4 non-technical"
        # can return 7 and 3, and the recruiter about to screen people on this
        # paper should be told that rather than have to count the questions.
        "sections": split,
        "delivered": mcq_gen.section_counts(questions),
    }


@router.post(
    "/generate-diagram-questions",
    summary="Generate directions/aptitude questions with a diagram (does not save)",
    dependencies=[RateLimitGenerateWeb],
)
async def generate_diagram_questions(
    request: Request, body: dict = Body(default={}), user: AuthedUser = WebUser
) -> dict:
    """Questions for review, same contract as `/generate`.

    NOT a Gemini call. Each question's diagram is drawn from a path this
    generates itself, and the correct answer is computed from that SAME path
    before the image exists — see `app.web.services.mcq_diagrams` for why that
    order, rather than a model, is what makes the answer key trustworthy.
    """
    count = _int((body or {}).get("count"), 5)
    count = max(1, min(mcq_gen.MAX_QUESTIONS, count))
    questions = mcq_diagrams.generate_diagram_questions(count)
    return {"questions": questions}


# ── Mode B: fill ONE section toward its target (does not save) ──────────────
#
# Mode A above writes a whole paper in one shot. This is the template
# builder's own action: the recruiter has a section that may already have
# some questions, and asks for exactly what it still needs — never a fresh
# batch most of which gets thrown away, and never more than the section's
# own target calls for.


@router.post(
    "/{set_id}/sections/{section_id}/generate",
    summary="Generate the remaining questions for one section, or regenerate one (does not save)",
    dependencies=[RateLimitGenerateWeb],
)
async def generate_section_questions(
    set_id: str,
    section_id: str,
    request: Request,
    body: dict = Body(default={}),
    user: AuthedUser = WebUser,
) -> dict:
    """Same "returns for review, never saves" contract as `/generate` — the
    caller appends the result into its draft and saves separately.
    """
    store = get_store(settings_of(request))
    doc = await _owned_or_404(store, set_id, user.uid)
    section = _section_or_404(doc, section_id)

    existing = [q for q in doc.get("questions") or [] if q.get("sectionId") == section_id]
    existing_texts = [q.get("text") or "" for q in existing if (q.get("text") or "").strip()]

    regenerate_id = _text((body or {}).get("regenerateQuestionId"), 64)
    if regenerate_id:
        if not any(q.get("id") == regenerate_id for q in existing):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That question is not in this section.")
        # Exclude every OTHER question in the section — not the one being
        # replaced — so the model cannot just hand the same one back.
        exclude_texts = [
            q.get("text") or ""
            for q in existing
            if q.get("id") != regenerate_id and (q.get("text") or "").strip()
        ]
        count = 1
    else:
        exclude_texts = existing_texts
        requested = _int((body or {}).get("count"), 0)
        target = int(section.get("targetQuestionCount") or 0)
        # A client-sent count is honoured (an ad-hoc "generate 5 more" on a
        # section with no formal target set); otherwise the SERVER derives
        # the shortfall from the section's own target, rather than trust a
        # client-sent total that could ask for more than is actually needed.
        count = requested if requested > 0 else mcq_gen.remaining_count(target, len(existing))
        count = max(0, min(mcq_gen.MAX_QUESTIONS, count))

    if count <= 0:
        return {"questions": [], "passage": section.get("passage"), "requested": 0, "delivered": 0}

    role = _text((body or {}).get("role"), 120) or _text(doc.get("name"), 120) or "this role"
    difficulty = _text((body or {}).get("difficulty"), 12).lower()
    if difficulty not in mcq_gen.DIFFICULTIES:
        difficulty = "mixed"

    settings = settings_of(request)
    try:
        result = await mcq_gen.generate_for_section(
            settings,
            role=role,
            section_type=str(section.get("sectionType") or "custom"),
            section_name=str(section.get("name") or "This section"),
            count=count,
            difficulty=difficulty,
            exclude_texts=exclude_texts,
            existing_passage=section.get("passage"),
        )
    except Exception as exc:  # noqa: BLE001 - mapped to a readable message below
        logger.exception("mcq section generation failed")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, question_gen.friendly_error(exc)
        ) from exc

    if not result["questions"]:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Nothing usable came back. Every generated question was missing its "
            "options or its correct answer, so none were kept — try again.",
        )

    for question in result["questions"]:
        question["sectionId"] = section_id

    return {
        "questions": result["questions"],
        "passage": result["passage"],
        "requested": count,
        "delivered": len(result["questions"]),
    }


# ── Import: a document or spreadsheet, reviewed before anything is added ────
#
# Same "returns for review, never saves" contract as generation — an import
# is not a create-or-update. The recruiter confirms in the review UI, and the
# accepted rows ride the ordinary `PUT /mcq-sets/{id}` save like any manually
# typed question.


@router.post(
    "/{set_id}/sections/{section_id}/import",
    summary="Extract questions from an uploaded file, for review (does not save)",
    dependencies=[RateLimitGenerateWeb],
)
async def import_section_questions(
    set_id: str,
    section_id: str,
    request: Request,
    file: UploadFile = File(...),
    user: AuthedUser = WebUser,
) -> dict:
    store = get_store(settings_of(request))
    doc = await _owned_or_404(store, set_id, user.uid)
    _section_or_404(doc, section_id)

    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No file uploaded.")
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That file is too large.")

    filename = file.filename or ""
    content_type = file.content_type or ""
    existing_texts = [
        q.get("text") or ""
        for q in doc.get("questions") or []
        if q.get("sectionId") == section_id and (q.get("text") or "").strip()
    ]

    if mcq_import.is_spreadsheet(filename, content_type):
        result = mcq_import.import_from_spreadsheet(
            data, filename=filename, existing_texts=existing_texts
        )
    elif filename.lower().endswith(mcq_import.DOCUMENT_SUFFIXES) or content_type.startswith("text/") or content_type == "application/pdf" or "wordprocessingml" in content_type:
        settings = settings_of(request)
        try:
            result = await mcq_import.import_from_document(
                settings,
                data,
                content_type=content_type,
                filename=filename,
                existing_texts=existing_texts,
            )
        except Exception as exc:  # noqa: BLE001 - mapped to a readable message below
            logger.exception("mcq document import failed")
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, question_gen.friendly_error(exc)
            ) from exc
    else:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "File type not supported. Please upload PDF, DOCX, TXT, CSV, or XLSX.",
        )

    if error := result.get("error"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, error)

    for question in [*result["valid"], *result["needsReview"]]:
        if "question" in question:
            question["question"]["sectionId"] = section_id

    return result

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
from app.web.services import mcq_gen, mcq_scoring, question_gen
from app.web.store import get_store

logger = logging.getLogger("web.mcq_sets")

router = APIRouter(prefix="/mcq-sets", tags=["web:mcq-sets"])

MAX_NAME = 120
MAX_TEXT = 2000
MAX_OPTION_TEXT = 500
MAX_OPTIONS = 10
MAX_QUESTIONS = 200
DIFFICULTIES = ("easy", "medium", "hard")

MAX_SECTIONS = 20
MAX_PAIRS = 10
MAX_PASSAGE = 8000
MAX_CODE = 4000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: object, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _text_keeping_newlines(value: object, limit: int) -> str:
    """Like `_text`, but line breaks survive.

    A code snippet is unreadable as one line, and `_text` is used everywhere else
    precisely because a question's text should not carry them.
    """
    return str(value or "").strip()[:limit]


def _int(value: object, fallback: int) -> int:
    """A whole number from a JSON body. `bool` is excluded deliberately: it is an
    `int` in Python, and `True` arriving as a question count would silently mean 1.
    """
    return value if isinstance(value, int) and not isinstance(value, bool) else fallback


def _clean_section(raw: object, index: int) -> dict:
    """One section of an assessment.

    ORDER IS THE ARRAY'S ORDER. There is no `position` field, deliberately: two
    representations of the same thing drift, and a stored index that disagrees with
    the array is a bug with no obvious right answer. Reordering rewrites the list.

    A section may be empty and unnamed while it is being built, for the same reason
    a question may be incomplete — saving is permissive, using is strict.
    """
    where = f"Section {index + 1}"
    if not isinstance(raw, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{where} is not a section.")

    section: dict = {
        "id": _text(raw.get("id"), 64) or uuid.uuid4().hex,
        "name": _text(raw.get("name"), MAX_NAME),
    }
    if instructions := _text(raw.get("instructions"), MAX_TEXT):
        section["instructions"] = instructions
    # The reading passage lives on the SECTION, not on a question. English
    # comprehension is naturally one passage with several ordinary questions about
    # it, so modelling it here means passage-based assessment needs no new question
    # type at all - and nothing in the scorer has to know passages exist. A
    # recruiter who wants two passages adds two sections.
    if passage := _text(raw.get("passage"), MAX_PASSAGE):
        section["passage"] = passage
    return section


def _clean_pairs(raw: dict, where: str) -> dict:
    """The two columns and the pairing of a match-the-following question.

    Ids are minted per SIDE and never shared between them. If a prompt and its
    match had the same id, the pairing would be guessable from the naming alone
    however the columns were ordered - the answer key would be in the field names.
    """
    prompts: list[dict] = []
    matches: list[dict] = []
    pairs: dict[str, str] = {}

    for row in raw.get("pairs") or []:
        if not isinstance(row, dict):
            continue
        left = _text(row.get("left"), MAX_OPTION_TEXT)
        right = _text(row.get("right"), MAX_OPTION_TEXT)
        # A blank row is one being typed into and is KEPT, exactly as a blank
        # option row is: deleting it under the recruiter mid-edit is worse.
        prompt_id = _text(row.get("promptId"), 64) or uuid.uuid4().hex[:8]
        match_id = _text(row.get("matchId"), 64) or uuid.uuid4().hex[:8]
        if prompt_id in pairs or match_id in pairs.values():
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{where} has two rows with the same id."
            )
        prompts.append({"id": prompt_id, "text": left})
        matches.append({"id": match_id, "text": right})
        pairs[prompt_id] = match_id

    if len(prompts) > MAX_PAIRS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"{where} has more than {MAX_PAIRS} pairs."
        )
    return {"prompts": prompts, "matches": matches, "correctPairs": pairs}


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

    requested_type = _text(raw.get("type"), 20).lower()

    if requested_type == mcq_scoring.MATCH:
        question = {
            "id": _text(raw.get("id"), 64) or uuid.uuid4().hex,
            "text": text,
            "type": mcq_scoring.MATCH,
            **_clean_pairs(raw, where),
        }
        return _with_question_extras(question, raw)

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

    return _with_question_extras(question, raw)


def _with_question_extras(question: dict, raw: dict) -> dict:
    """The fields every question type carries, whatever its answer looks like.

    Shared by both branches of `_clean_question` on purpose. The cleaner is an
    ALLOW-LIST, so anything not named here is dropped on save — which is the
    property that keeps a stray client field out of the stored document, and also
    the reason a new field has to be added here deliberately. Sections were
    silently discarded on save until this list learned about them.
    """
    points = raw.get("points")
    if isinstance(points, (int, float)) and not isinstance(points, bool) and points >= 0:
        question["points"] = float(points)
    if topic := _text(raw.get("topic") or raw.get("category"), 120):
        question["topic"] = topic
    # Which section this question sits in. `section` is the legacy spelling, from
    # when a section was a two-value tag rather than a first-class object; it is
    # read as an id because "technical" and "non_technical" are ids in the prebuilt
    # library, so no migration and no special case is needed.
    if section_id := _text(raw.get("sectionId") or raw.get("section"), 64):
        question["sectionId"] = section_id
    # The snippet a code-reading question is about. This is how coding and
    # debugging are assessed here: the candidate reads code and answers a closed
    # question about it, so scoring stays a comparison rather than an execution.
    if code := _text_keeping_newlines(raw.get("code"), MAX_CODE):
        question["code"] = code
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

    raw_sections = body.get("sections")
    if not isinstance(raw_sections, list):
        raw_sections = []
    if len(raw_sections) > MAX_SECTIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"An assessment holds at most {MAX_SECTIONS} sections."
        )
    sections = [_clean_section(sec, i) for i, sec in enumerate(raw_sections)]
    questions = [_clean_question(q, i) for i, q in enumerate(raw_questions)]

    # A question may only claim a section the assessment actually has. A dangling
    # id would make the score breakdown invent a section that is nowhere in the
    # paper, and the recruiter would have no way to find or fix it.
    #
    # Enforced ONLY when there is a manifest to check against. A paper from before
    # sections were first-class carries a bare `technical` tag and no `sections`
    # list, and stripping that would silently downgrade an assessment that is
    # working perfectly well.
    if sections:
        known = {sec["id"] for sec in sections}
        for question in questions:
            if question.get("sectionId") not in known:
                question.pop("sectionId", None)

    return {
        "id": (existing or {}).get("id") or uuid.uuid4().hex,
        "kind": "mcq",
        "name": name,
        # Stamped from the token. Never from the body — a client that could set
        # this could write into another recruiter's sets.
        "recruiterId": recruiter_id,
        "sections": sections,
        "questions": questions,
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

    if question.get("type") == mcq_scoring.MATCH:
        prompts = [p for p in question.get("prompts") or [] if (p.get("text") or "").strip()]
        matches = [x for x in question.get("matches") or [] if (x.get("text") or "").strip()]
        # Two pairs is the floor, and not arbitrarily: with one pair there is
        # nothing to choose between, and `_unaligned` cannot keep the single match
        # out of its answering position either.
        if len(prompts) < 2 or len(matches) < 2:
            return f"{where} needs at least two complete pairs."
        pairs = question.get("correctPairs") or {}
        prompt_ids = {p["id"] for p in prompts}
        match_ids = {x["id"] for x in matches}
        unpaired = [p for p in prompt_ids if pairs.get(p) not in match_ids]
        if unpaired:
            return f"{where} has a row with nothing to match it to."
        # Two prompts pointing at one match would make the pairing unsolvable.
        targets = [pairs[p] for p in prompt_ids]
        if len(set(targets)) != len(targets):
            return f"{where} matches two rows to the same answer."
        return None

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
    """Everything between this assessment and being usable in an interview."""
    questions = doc.get("questions") or []
    if not questions:
        return ["The assessment has no questions yet."]

    faults = [f for f in (question_fault(q, i) for i, q in enumerate(questions)) if f]

    # A section a candidate would be shown and then given nothing to answer. Worth
    # refusing rather than rendering: an empty section reads as a loading failure.
    sections = doc.get("sections") or []
    if sections:
        used = {mcq_scoring.section_id_of(q) for q in questions}
        for index, section in enumerate(sections):
            label = (section.get("name") or "").strip() or f"Section {index + 1}"
            if not (section.get("name") or "").strip():
                faults.append(f"Section {index + 1} has no name.")
            if section["id"] not in used:
                faults.append(f"“{label}” has no questions in it.")

    return faults


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

"""Authoring an MCQ paper — cleaning, validating, and saying what is missing.

Pure. No I/O, no Firestore, no HTTP: it takes a request body and returns a document, or
raises `InvalidPaper`. Both surfaces run it, so a paper authored on a phone and a paper
authored in a browser are the same document with the same rules — rather than two
validators that agree until one of them is changed.

── Saving is permissive; USING is strict ────────────────────────────────────
Nobody authors a forty-question paper through a sequence of individually valid states:
you type a question, then its options, then mark the answer, and every moment in between
is incomplete. Refusing those states made this feature unusable from its first click —
the editor created a blank question so a new set would not be empty, and the server
rejected the blank question.

So an incomplete question is stored as a draft, and `set_faults` reports what is
missing. Completeness is enforced where it matters: when a paper is attached to an
interview. A question with no correct answer scores every candidate zero, and that must
never reach a candidate — but it is fine, and necessary, halfway through being written.

── The cleaner is an ALLOW-LIST ─────────────────────────────────────────────
`_with_question_extras` names every field that may be stored, so anything a client
invents is dropped on save. That is what keeps a stray field out of the document — and
it is also why a new field has to be added there deliberately. Sections were silently
discarded on save until that list learned about them.

── Why this is owner-scoped, and stays so ───────────────────────────────────
`recruiterId` is stamped from the auth token by the caller and never read from the body.
A paper CONTAINS THE ANSWER KEY, so unlike `templates` and `question_sets` — shared
across the deployment on purpose, since recruiters reuse each other's work — a set is
readable only by the recruiter who wrote it.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app import mcq_scoring


class InvalidPaper(ValueError):
    """The body cannot be stored as a paper at all.

    Distinct from a FAULT, which is a complete-enough paper that is not yet usable.
    This is structurally impossible input — a client bug rather than an authoring
    state — and both surfaces map it to a 400.
    """


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
# A rendered diagram (PNG, base64) runs a few KB — the generator's own output tops
# out around 10-15K characters. This caps well above that with room to spare,
# while still keeping a paper's total document size nowhere near Firestore's
# 1 MiB document limit even with every question in a section carrying one.
MAX_IMAGE_DATA_URL = 300_000

# The one section every set is given by default (see the web editor's
# `mcqSections.ts` — this id must match exactly). Unlike a section a recruiter
# adds on purpose, it exists before anyone has written anything into it, so an
# empty one is not a mistake to flag — it is simply not filled in YET. A
# "General" section used to be forced on every set too; it no longer is — an
# unsectioned question is unsectioned, exactly as it always was.
DEFAULT_SECTION_IDS = frozenset({"diagram-questions"})

# Predefined section TYPES, offered to a recruiter as a quick-start picker —
# not an enum enforced at save time. A section's `name` stays the free-text
# field it always was; `sectionType` is metadata that lets the template
# builder and the generator understand what a section is FOR (which prompt
# brief to use, which icon to show) without constraining what recruiters can
# call it or forcing every section into one of these five. "custom" is the
# default for a section with no recognised type, including every section
# authored before this field existed.
SECTION_TYPES: dict[str, dict[str, str]] = {
    "aptitude": {
        "label": "Aptitude",
        "description": "Numerical and logical aptitude",
    },
    "quantitative": {
        "label": "Quantitative Ability",
        "description": "Mathematical reasoning and problem solving",
    },
    "reading_comprehension": {
        "label": "Reading Comprehension",
        "description": "Passage-based comprehension questions",
    },
    "verbal_reasoning": {
        "label": "Verbal Reasoning",
        "description": "Language and verbal logic",
    },
    "diagram": {
        "label": "Diagram / Visual Reasoning",
        "description": "Image and diagram-based reasoning",
    },
    "custom": {
        "label": "Custom",
        "description": "A section of your own",
    },
}

# What a question may be tagged with to say how it entered the paper. Server-
# side bookkeeping only — deliberately not part of `mcq_public_question`'s
# allow-list (see mcq_scoring.py), so it never reaches a candidate.
QUESTION_SOURCES = ("manual", "imported", "ai_generated")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def text_of(value: object, limit: int) -> str:
    return str(value or "").strip()[:limit]


def multiline_of(value: object, limit: int) -> str:
    """Like `_text`, but line breaks survive.

    A code snippet is unreadable as one line, and `_text` is used everywhere else
    precisely because a question's text should not carry them.
    """
    return str(value or "").strip()[:limit]


def int_of(value: object, fallback: int) -> int:
    """A whole number from a JSON body. `bool` is excluded deliberately: it is an
    `int` in Python, and `True` arriving as a question count would silently mean 1.
    """
    return value if isinstance(value, int) and not isinstance(value, bool) else fallback


def clean_section(raw: object, index: int) -> dict:
    """One section of an assessment.

    ORDER IS THE ARRAY'S ORDER. There is no `position` field, deliberately: two
    representations of the same thing drift, and a stored index that disagrees with
    the array is a bug with no obvious right answer. Reordering rewrites the list.

    A section may be empty and unnamed while it is being built, for the same reason
    a question may be incomplete — saving is permissive, using is strict.
    """
    where = f"Section {index + 1}"
    if not isinstance(raw, dict):
        raise InvalidPaper(f"{where} is not a section.")

    section: dict = {
        "id": text_of(raw.get("id"), 64) or uuid.uuid4().hex,
        "name": text_of(raw.get("name"), MAX_NAME),
    }
    if instructions := text_of(raw.get("instructions"), MAX_TEXT):
        section["instructions"] = instructions
    # The reading passage lives on the SECTION, not on a question. English
    # comprehension is naturally one passage with several ordinary questions about
    # it, so modelling it here means passage-based assessment needs no new question
    # type at all - and nothing in the scorer has to know passages exist. A
    # recruiter who wants two passages adds two sections.
    if passage := text_of(raw.get("passage"), MAX_PASSAGE):
        section["passage"] = passage
    # A quick-start category (see SECTION_TYPES) — never enforced, only offered.
    # Anything unrecognised (including a section saved before this field
    # existed) is "custom" rather than raising, since the type is a picker
    # convenience, not a constraint on what a recruiter may name a section.
    section_type = text_of(raw.get("sectionType"), 40).lower()
    section["sectionType"] = section_type if section_type in SECTION_TYPES else "custom"
    # How many questions this section is meant to end up with. 0 means "no
    # target set" — a recruiter who never opens the count picker gets the
    # section behaving exactly as it always did, with no target to chase.
    target = int_of(raw.get("targetQuestionCount"), 0)
    section["targetQuestionCount"] = min(max(target, 0), MAX_QUESTIONS)
    return section


def clean_pairs(raw: dict, where: str) -> dict:
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
        left = text_of(row.get("left"), MAX_OPTION_TEXT)
        right = text_of(row.get("right"), MAX_OPTION_TEXT)
        # A blank row is one being typed into and is KEPT, exactly as a blank
        # option row is: deleting it under the recruiter mid-edit is worse.
        prompt_id = text_of(row.get("promptId"), 64) or uuid.uuid4().hex[:8]
        match_id = text_of(row.get("matchId"), 64) or uuid.uuid4().hex[:8]
        if prompt_id in pairs or match_id in pairs.values():
            raise InvalidPaper(f"{where} has two rows with the same id.")
        prompts.append({"id": prompt_id, "text": left})
        matches.append({"id": match_id, "text": right})
        pairs[prompt_id] = match_id

    if len(prompts) > MAX_PAIRS:
        raise InvalidPaper(f"{where} has more than {MAX_PAIRS} pairs.")
    return {"prompts": prompts, "matches": matches, "correctPairs": pairs}


def clean_question(raw: object, index: int) -> dict:
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
        raise InvalidPaper(f"{where} is not a question.")

    # May be empty while being written. `set_faults` reports it; save does not block.
    text = text_of(raw.get("text"), MAX_TEXT)

    requested_type = text_of(raw.get("type"), 20).lower()

    if requested_type == mcq_scoring.MATCH:
        question = {
            "id": text_of(raw.get("id"), 64) or uuid.uuid4().hex,
            "text": text,
            "type": mcq_scoring.MATCH,
            **clean_pairs(raw, where),
        }
        return with_question_extras(question, raw)

    options: list[dict] = []
    seen_ids: set[str] = set()
    for opt in raw.get("options") or []:
        if not isinstance(opt, dict):
            continue
        # An option with no text yet is a row being typed into, and it is KEPT.
        # Dropping it meant a half-written question came back from the server with
        # its option rows deleted — the recruiter's blank options vanishing from
        # under them mid-edit. Readiness reports the emptiness; the row survives.
        opt_text = text_of(opt.get("text"), MAX_OPTION_TEXT)
        opt_id = text_of(opt.get("id"), 64) or uuid.uuid4().hex[:8]
        if opt_id in seen_ids:
            # Duplicate ids would make the key ambiguous — two options could both
            # claim to be the right one.
            raise InvalidPaper(f"{where} has two options with the same id.")
        seen_ids.add(opt_id)
        options.append({"id": opt_id, "text": opt_text})

    if len(options) > MAX_OPTIONS:
        raise InvalidPaper(f"{where} has more than {MAX_OPTIONS} options.")

    key = [str(v) for v in (raw.get("correctOptionIds") or []) if str(v) in seen_ids]
    # De-duplicate while keeping order, so a key of ["a","a"] cannot masquerade as
    # a two-answer question.
    key = list(dict.fromkeys(key))

    answer_type = "multi" if raw.get("type") == "multi" or len(key) > 1 else "single"

    question: dict = {
        "id": text_of(raw.get("id"), 64) or uuid.uuid4().hex,
        "text": text,
        "options": options,
        "correctOptionIds": key,
        "type": answer_type,
    }

    return with_question_extras(question, raw)


def with_question_extras(question: dict, raw: dict) -> dict:
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
    if topic := text_of(raw.get("topic") or raw.get("category"), 120):
        question["topic"] = topic
    # Which section this question sits in. `section` is the legacy spelling, from
    # when a section was a two-value tag rather than a first-class object; it is
    # read as an id because "technical" and "non_technical" are ids in the prebuilt
    # library, so no migration and no special case is needed.
    if section_id := text_of(raw.get("sectionId") or raw.get("section"), 64):
        question["sectionId"] = section_id
    # The snippet a code-reading question is about. This is how coding and
    # debugging are assessed here: the candidate reads code and answers a closed
    # question about it, so scoring stays a comparison rather than an execution.
    if code := multiline_of(raw.get("code"), MAX_CODE):
        question["code"] = code
    # A diagram this question is about — the same "unanswerable without it, so it
    # survives save" reasoning as `code` above. Checked for shape (a real data
    # URI, not an arbitrary string a client could stuff in here) rather than
    # decoded — decoding would cost real work for every save of every question.
    image = raw.get("imageDataUrl")
    if isinstance(image, str) and image.startswith("data:image/") and len(image) <= MAX_IMAGE_DATA_URL:
        question["imageDataUrl"] = image
    if (difficulty := text_of(raw.get("difficulty"), 12).lower()) in DIFFICULTIES:
        question["difficulty"] = difficulty
    if explanation := text_of(raw.get("explanation"), MAX_TEXT):
        question["explanation"] = explanation
    # How this question entered the paper — recruiter bookkeeping only (see
    # QUESTION_SOURCES's docstring). Defaults to "manual" so a question saved
    # before this field existed, or one a client omits it for, backfills to
    # the one source that was always true of every question until now.
    source = text_of(raw.get("source"), 20).lower()
    question["source"] = source if source in QUESTION_SOURCES else "manual"

    return question


def clean_set(body: dict, *, recruiter_id: str, existing: dict | None = None) -> dict:
    name = text_of(body.get("name"), MAX_NAME)
    if not name:
        raise InvalidPaper("The set needs a name.")

    # An empty set is a draft, not an error: a set is created before it is written.
    raw_questions = body.get("questions")
    if not isinstance(raw_questions, list):
        raw_questions = []
    if len(raw_questions) > MAX_QUESTIONS:
        raise InvalidPaper(f"A set holds at most {MAX_QUESTIONS} questions.")

    raw_sections = body.get("sections")
    if not isinstance(raw_sections, list):
        raw_sections = []
    if len(raw_sections) > MAX_SECTIONS:
        raise InvalidPaper(f"An assessment holds at most {MAX_SECTIONS} sections.")
    sections = [clean_section(sec, i) for i, sec in enumerate(raw_sections)]
    questions = [clean_question(q, i) for i, q in enumerate(raw_questions)]

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
        "createdAt": (existing or {}).get("createdAt") or now_iso(),
        "updatedAt": now_iso(),
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
            if section["id"] not in used and section["id"] not in DEFAULT_SECTION_IDS:
                faults.append(f"“{label}” has no questions in it.")

    return faults


def with_readiness(doc: dict) -> dict:
    """The set, plus whether it can be used. Computed on read, never stored.

    Derived rather than persisted so it cannot go stale against the questions it
    describes.
    """
    faults = set_faults(doc)
    return {**doc, "ready": not faults, "faults": faults}

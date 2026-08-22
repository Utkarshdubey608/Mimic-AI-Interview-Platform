"""MCQ papers and attempts — the shared model both clients run on.

`mcq_scoring.py` next door owns the comparison and the public projection. This module
owns the two RECORDS: where a paper lives, and where a candidate's attempt at one lives.

── Why an attempt is not a session ───────────────────────────────────────────
The web runtime stored a candidate's MCQ answers on `web_sessions`, alongside the
resolved paper — answer key included. That worked while MCQ was web-only and is the
reason it could not leave: the runtime, the key and the session were one object.

An MCQ attempt has no per-question clock, no prep phase, no transcript, no draft text
and no integrity monitoring. It is a paper, a set of chosen options, and a submission
time. Modelling it as its own small shared record is both less work than dragging
`web_sessions` into the kernel and more honest about what it is.

`mcq_attempts/{interviewId}` — keyed by the interview, like `reports` and `feedback`,
because one candidate sits one paper once and a resubmission replaces rather than
duplicates.

── The rule that governs everything here ─────────────────────────────────────
**The answer key exists in exactly two places: the stored paper, and the scorer.**
Never in a response, never on a device, never in a log. An attempt therefore stores only
what the candidate CHOSE — never the paper it was chosen from, and never the score's
working. `resolve_paper` reads the set fresh each time and projects it through
`mcq_scoring.mcq_public_question` on the way out.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app import mcq_scoring
from app.config import Settings
from app.firebase import get_db

logger = logging.getLogger("mcq")

# Recruiter-authored papers. Owner-scoped: the set CONTAINS THE ANSWERS, so shared
# storage would let every recruiter on the deployment read every assessment's key.
SETS_COLLECTION = "mcq_sets"

# One candidate's attempt at one paper.
ATTEMPTS_COLLECTION = "mcq_attempts"

STATUS_IN_PROGRESS = "in_progress"
STATUS_SUBMITTED = "submitted"


def sets_collection(settings: Settings):
    return get_db(settings).collection(SETS_COLLECTION)


def attempts_collection(settings: Settings):
    return get_db(settings).collection(ATTEMPTS_COLLECTION)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_attempt(*, interview_id: str, candidate_email: str, mcq_set_id: str) -> dict:
    """A fresh attempt. Pure.

    Deliberately does NOT copy the paper in. The web runtime resolved questions into the
    session at create time, key and all, which is what welded the runtime to
    `web_sessions` and put an answer key in a document the candidate's own record. Here
    the paper is read fresh on every request from the set the recruiter owns.

    The trade is one extra read per request against a key that cannot leak into an
    attempt document. That is not a close call.
    """
    started = _now()
    return {
        "interviewId": interview_id,
        "candidateEmail": candidate_email,
        # Which paper was sat. An id, not the paper.
        "mcqSetId": mcq_set_id,
        # `{questionId: [optionId, ...]}` or, for a pairing, `{promptId: matchId}`.
        # What the candidate CHOSE. Never what was correct.
        "answers": {},
        "status": STATUS_IN_PROGRESS,
        "startedAt": started,
        "submittedAt": None,
        "updatedAt": started,
    }


def clean_answer(question: dict, submitted: object) -> list | dict:
    """One candidate answer, keeping only ids the question actually has.

    Type-aware, and in ONE place deliberately. Autosave and submit both clean the same
    payload, and they used to do it with two copies of the same four lines — which is
    precisely how a submit-only bug hides behind a passing autosave test. A new question
    type now has one place to teach rather than two to remember.

    A client sending an unknown id is a bug, not an answer, and storing it would make
    the result unexplainable to the recruiter reading the report.
    """
    if question.get("type") == mcq_scoring.MATCH:
        # A pairing, not a list. Both halves are checked: a prompt the question does not
        # ask about, or a match that is not on offer, is dropped.
        if not isinstance(submitted, dict):
            return {}
        prompts = {str(p.get("id")) for p in question.get("prompts") or []}
        matches = {str(m.get("id")) for m in question.get("matches") or []}
        return {
            str(prompt): str(match)
            for prompt, match in submitted.items()
            if str(prompt) in prompts and str(match) in matches
        }

    if not isinstance(submitted, (list, tuple, set)):
        return []
    options = {str(o.get("id")) for o in question.get("options") or []}
    picks = [str(v) for v in submitted if str(v) in options]
    return list(dict.fromkeys(picks))


def clean_answers(raw: object, questions: list[dict]) -> dict:
    """A whole submission, reduced to what this paper can actually contain.

    Two filters, and each drops something a client could otherwise store:

    * a question id not on THIS paper — otherwise an attempt accumulates answers to
      questions nobody was asked, and `answered / total` stops meaning anything;
    * within a question, anything `clean_answer` does not recognise.

    Bounded rather than rejected. A malformed autosave mid-paper must not cost a
    candidate the answers they have already given, so the unusable parts are dropped and
    the rest is kept.
    """
    if not isinstance(raw, dict):
        return {}

    by_id = {str(q.get("id")): q for q in questions or [] if q.get("id") is not None}
    cleaned: dict = {}
    for question_id, value in raw.items():
        key = str(question_id)
        question = by_id.get(key)
        if question is None:
            continue
        cleaned[key] = clean_answer(question, value)
    return cleaned


def answered_count(answers: dict) -> int:
    """How many questions have an answer. What a progress indicator reads."""
    return sum(1 for value in (answers or {}).values() if value)


def is_submitted(attempt: dict | None) -> bool:
    return bool(attempt) and attempt.get("status") == STATUS_SUBMITTED


def questions_of(paper: dict) -> list[dict]:
    return [q for q in (paper or {}).get("questions") or [] if isinstance(q, dict)]


def sections_of(paper: dict) -> list[dict]:
    return [s for s in (paper or {}).get("sections") or [] if isinstance(s, dict)]


def ordered_questions(paper: dict) -> list[dict]:
    """The paper's questions in the order a candidate meets them.

    Sorted by section, so section one comes first. A question belonging to no section
    sorts LAST rather than being dropped — an unsectioned question is still a question
    somebody has to answer, and silently omitting it would score them zero on it.
    """
    order = {
        str(section.get("id")): index for index, section in enumerate(sections_of(paper))
    }
    return sorted(
        questions_of(paper),
        key=lambda q: order.get(mcq_scoring.section_id_of(q), len(order)),
    )


def public_sections(paper: dict) -> list[dict]:
    """The paper's structure, as the candidate may see it.

    Carries `questionIds` rather than stamping a `sectionId` on every published
    question: the runtime needs the grouping either way, and one representation cannot
    disagree with itself. Nothing here is secret — a section's name, instructions and
    reading passage are all about to be shown anyway.
    """
    questions = questions_of(paper)
    manifest: list[dict] = []
    for section in sections_of(paper):
        section_id = str(section.get("id") or "")
        entry: dict = {
            "id": section_id,
            "name": str(section.get("name") or ""),
            "questionIds": [
                str(q.get("id"))
                for q in questions
                if mcq_scoring.section_id_of(q) == section_id
            ],
        }
        if instructions := section.get("instructions"):
            entry["instructions"] = str(instructions)
        if passage := section.get("passage"):
            entry["passage"] = str(passage)
        manifest.append(entry)
    return manifest


def public_paper(paper: dict, *, seed: str | None) -> list[dict]:
    """Every question, allow-listed and in section order.

    The ONE place a stored paper becomes a sendable one. Both runtimes call it, so
    there is no second projection to keep honest.
    """
    return [
        mcq_scoring.mcq_public_question(question, shuffle_seed=seed)
        for question in ordered_questions(paper)
    ]


def shuffle_seed_for(config: dict | None, *, attempt_key: str) -> str | None:
    """Deterministic per candidate, different between candidates.

    Seeded on the attempt key so a refresh does not reshuffle the options under
    somebody mid-decision, while "it's the third one" is worth nothing to the next
    person. `shuffleOptions: false` turns it off for a paper whose options are ordered
    meaningfully — "all of the above", or a sequence.
    """
    return attempt_key if (config or {}).get("shuffleOptions", True) else None


# ── the paper store ───────────────────────────────────────────────────────────
#
# Both surfaces read and write papers through these, rather than through the web
# surface's `Collection` helper. Not a style preference: `app/web/store/` is off limits
# to the common surface by rule 1 of tests/test_layering.py, so a shared authoring API
# needed the access to live somewhere both could reach.
#
# Ownership is enforced on every one of them. A paper contains the answer key, so
# "which recruiter is asking" is not a filter for tidiness — it is the whole access
# control, since `firestore.rules` denies clients the collection outright and there is
# no other check between a caller and somebody else's assessment.


async def list_sets(settings: Settings, *, recruiter_id: str) -> list[dict]:
    """This recruiter's papers, by name.

    Empty for a blank id, and that guard is not padding: `where('recruiterId', '==',
    '')` is a valid query that would match every document written before ownership was
    stamped and hand them to whoever asked.

    One unreadable document does not empty the list — the same rule the Flutter client's
    `_parseDocs` has always followed. "You have nothing" is indistinguishable from a real
    empty state, and sends somebody hunting for deleted work.
    """
    import asyncio

    if not recruiter_id:
        return []

    def _read() -> list[dict]:
        from google.cloud.firestore_v1.base_query import FieldFilter

        query = sets_collection(settings).where(
            filter=FieldFilter("recruiterId", "==", recruiter_id)
        )
        papers = []
        for snapshot in query.stream():
            try:
                data = snapshot.to_dict() or {}
            except Exception as exc:  # noqa: BLE001 - one bad row must not empty a list
                logger.warning("unreadable mcq set %s: %s", snapshot.id, exc)
                continue
            papers.append({**data, "id": data.get("id") or snapshot.id})
        return papers

    papers = await asyncio.to_thread(_read)
    return sorted(papers, key=lambda p: str(p.get("name") or "").lower())


async def fetch_set(settings: Settings, set_id: str, *, recruiter_id: str) -> dict | None:
    """One paper, or None when it does not exist OR belongs to someone else.

    The two cases are deliberately indistinguishable to the caller, so the route can
    answer 404 for both. A 403 would confirm the paper exists, which is itself
    information about another recruiter's work.
    """
    import asyncio

    if not set_id:
        return None

    def _read() -> dict | None:
        snapshot = sets_collection(settings).document(set_id).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict() or {}
        return {**data, "id": data.get("id") or snapshot.id}

    paper = await asyncio.to_thread(_read)
    if paper is None or (recruiter_id and paper.get("recruiterId") != recruiter_id):
        return None
    return paper


async def save_set(settings: Settings, paper: dict) -> dict:
    """Write a paper whole. Returns what was stored.

    A full replace rather than a merge: the editor reads a paper, edits it and saves the
    whole thing back, and a merge would silently keep questions the recruiter deleted.
    """
    import asyncio

    set_id = str(paper.get("id") or "")
    if not set_id:
        raise ValueError("an mcq set has no id")

    def _write() -> None:
        sets_collection(settings).document(set_id).set(paper)

    await asyncio.to_thread(_write)
    return paper


async def delete_set(settings: Settings, set_id: str) -> None:
    """Remove a paper. Deleting a missing one is not an error.

    Deliberately unconditional — the caller has already established ownership through
    `fetch_set`, and re-checking here would read the document twice for one delete.
    """
    import asyncio

    if not set_id:
        return

    def _write() -> None:
        sets_collection(settings).document(set_id).delete()

    await asyncio.to_thread(_write)

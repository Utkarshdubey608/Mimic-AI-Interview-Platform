"""The MCQ track's candidate runtime.

Its OWN routes rather than an extension of the timed engine, and that is a safety
decision as much as a design one. The timed engine has prep and answer phases, a
per-question server clock, drafts, auto-submit on expiry and adaptive generation —
an MCQ paper has none of that. Bending `/begin`, `/answers` and `/complete` to
serve both would put changes in the path that is currently running real
interviews, to support a mode that shares almost none of its behaviour.

Three routes, added beside it:

  GET  /{id}/mcq            the paper, WITHOUT the answer key, plus whatever the
                            candidate has answered so far
  POST /{id}/mcq/answers    auto-save; a refresh must not cost anybody their work
  POST /{id}/mcq/submit     score deterministically, store the result, finish

── The answer key ───────────────────────────────────────────────────────────
Lives in the session document and never leaves the server. The candidate's view is
built by `mcq_scoring.mcq_public_question`, an allow-list: it names the fields that
may travel, so `correctOptionIds` cannot appear in a response no matter what the
stored question later grows. Option order is shuffled per session, deterministically,
so a leaked "it's the third one" is worth nothing to the next candidate and a refresh
does not reshuffle under someone mid-decision.

── Scoring ──────────────────────────────────────────────────────────────────
Deterministic and instant. No model is called, so an MCQ result is exact,
reproducible and free — see `services/mcq_scoring.py` for why multi-select is
all-or-nothing by default.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Body, HTTPException, Request, status

from app.security import AuthedUser
from app.web.deps import WebUser, settings_of
from app.web.services import mcq_scoring, session_store
from app.web.store import get_store

logger = logging.getLogger("web.sessions_mcq")

router = APIRouter(prefix="/sessions", tags=["web:sessions-mcq"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_mcq(session: dict) -> None:
    """404 for a non-MCQ session.

    Not 400: these routes simply do not exist for a chatbot interview, and saying
    so more precisely would only describe the shape of somebody else's session.
    """
    if session.get("track") != "mcq":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not an MCQ session.")


def _public_paper(session: dict) -> list[dict]:
    """The questions as the candidate may see them.

    Seeded with the session id so the shuffle is stable for this candidate across
    reloads and different for the next one.
    """
    config = session.get("mcqConfig") or {}
    seed = session["id"] if config.get("shuffleOptions", True) else None
    return [
        mcq_scoring.mcq_public_question(question, shuffle_seed=seed)
        for question in session.get("questions") or []
    ]


def _public_result(result: dict | None) -> dict | None:
    """The score, WITHOUT the answers that produced it.

    Showing a candidate their score is not the same as publishing the key, and the
    stored result carries both: every per-question record holds
    `correctOptionIds`, because that is what makes the RECRUITER's report
    reviewable. Returning the stored result verbatim would therefore hand the whole
    answer key to anyone whose recruiter enabled `showScoreToCandidate` — the exact
    leak the paper route is careful to prevent, arriving through the back door.

    So this is an allow-list too, and per-question it names only what the candidate
    is entitled to: whether they got it right, and what it was worth.
    """
    if not result:
        return None
    return {
        "kind": "mcq",
        "correctCount": result.get("correctCount"),
        "questionCount": result.get("questionCount"),
        "points": result.get("points"),
        "pointsAvailable": result.get("pointsAvailable"),
        "percent": result.get("percent"),
        "passThreshold": result.get("passThreshold"),
        "passed": result.get("passed"),
        "questions": [
            {
                "questionId": record.get("questionId"),
                "correct": record.get("correct"),
                "points": record.get("points"),
                "pointsAvailable": record.get("pointsAvailable"),
            }
            for record in result.get("questions") or []
        ],
    }


def _state(session: dict) -> dict:
    """Everything the runtime needs, and nothing it must not have."""
    config = session.get("mcqConfig") or {}
    return {
        "sessionId": session["id"],
        "status": session.get("status"),
        "questions": _public_paper(session),
        # What they have answered so far, so a reload restores the paper as left.
        "answers": session.get("mcqAnswers") or {},
        "submittedAt": session.get("mcqSubmittedAt"),
        "totalSeconds": config.get("totalSeconds"),
        "perQuestionSeconds": config.get("perQuestionSeconds"),
        "branding": (session.get("branding") or {}),
        # The candidate is told the score only if the recruiter allows it; absent
        # by default, because a score delivered by a machine with no human in the
        # loop is what the completion screen deliberately avoids. Even when
        # allowed, it goes through `_public_result` — a score is not the key.
        "result": _public_result(session.get("mcqResult")) if config.get("showScoreToCandidate") else None,
    }


@router.get("/{session_id}/mcq", summary="The MCQ paper, without the answer key")
async def get_paper(session_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    settings = settings_of(request)
    session, _template = await session_store.load(settings, session_id, user)
    _require_mcq(session)

    # First open counts as starting: an assessment a candidate has seen is one they
    # have begun, and leaving it "created" would let a whole-paper timer be dodged
    # by opening and closing the tab.
    if session.get("status") == "created":
        session["status"] = "in_progress"
        session["startedAt"] = _now()
        await session_store.save(settings, session)

    return _state(session)


@router.post("/{session_id}/mcq/answers", summary="Auto-save the paper so far")
async def save_answers(
    session_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    """Store selections without scoring. Idempotent, and safe to call often.

    A refresh, a dropped connection or a closed laptop must not cost a candidate
    the answers they had already chosen.
    """
    settings = settings_of(request)
    session, _template = await session_store.load(settings, session_id, user)
    _require_mcq(session)

    if session.get("mcqSubmittedAt"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This assessment is already submitted.")

    valid_ids = {str(q.get("id")) for q in session.get("questions") or []}
    incoming = (body or {}).get("answers")
    if not isinstance(incoming, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "answers must be an object.")

    # Keep only real questions and real option ids. A client sending an unknown id
    # is a bug, not an answer, and storing it would make the result unexplainable.
    by_id = {str(q.get("id")): q for q in session.get("questions") or []}
    cleaned: dict[str, list[str]] = {}
    for question_id, selected in incoming.items():
        key = str(question_id)
        if key not in valid_ids:
            continue
        options = {str(o.get("id")) for o in (by_id[key].get("options") or [])}
        picks = [str(v) for v in (selected or []) if str(v) in options]
        cleaned[key] = list(dict.fromkeys(picks))

    session["mcqAnswers"] = cleaned
    session["mcqAnswersAt"] = _now()
    await session_store.save(settings, session)
    return {"ok": True, "saved": len(cleaned)}


@router.post("/{session_id}/mcq/submit", summary="Submit and score the paper")
async def submit(session_id: str, request: Request, body: dict = Body(default={}), user: AuthedUser = WebUser) -> dict:
    """Score server-side, store the result, finish the interview.

    Whatever is saved is what gets scored, plus anything in this request — a
    candidate who answers and submits in one go must not need a prior auto-save to
    have counted.

    Submitting twice is refused rather than rescored: the first submission is the
    one the candidate stood behind, and letting a second overwrite it would make
    the result depend on how many times a button was pressed.
    """
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)
    _require_mcq(session)

    if session.get("mcqSubmittedAt"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This assessment is already submitted.")

    answers = dict(session.get("mcqAnswers") or {})
    late = (body or {}).get("answers")
    if isinstance(late, dict):
        by_id = {str(q.get("id")): q for q in session.get("questions") or []}
        for question_id, selected in late.items():
            key = str(question_id)
            if key not in by_id:
                continue
            options = {str(o.get("id")) for o in (by_id[key].get("options") or [])}
            answers[key] = list(
                dict.fromkeys(str(v) for v in (selected or []) if str(v) in options)
            )

    config = session.get("mcqConfig") or {}
    result = mcq_scoring.score_submission(
        session.get("questions") or [],
        answers,
        multi_rule=config.get("multiRule") or mcq_scoring.ALL_OR_NOTHING,
        pass_threshold=config.get("passThreshold"),
    )
    result["topics"] = mcq_scoring.topic_breakdown(
        session.get("questions") or [], result["questions"]
    )
    # Only present for a paper that HAS sections. An unsectioned paper gets no key
    # at all rather than an empty list, so the report can ask "was this paper
    # divided?" and get an answer, instead of rendering an empty heading.
    if sections := mcq_scoring.section_breakdown(
        session.get("questions") or [], result["questions"]
    ):
        result["sections"] = sections

    now = _now()
    session["mcqAnswers"] = answers
    session["mcqResult"] = result
    session["mcqSubmittedAt"] = now
    session["status"] = "completed"
    session["completedAt"] = now
    await session_store.save(settings, session)

    # The recruiter's report, in the same collection every other track writes to,
    # so results, analytics and pipelines find it where they already look.
    store = get_store(settings)
    await store.reports.put(
        {
            "sessionId": session["id"],
            "recruiterId": session.get("recruiterId"),
            "track": "mcq",
            "role": (template or {}).get("role"),
            "candidateName": (session.get("candidate") or {}).get("name"),
            "mcq": result,
            "createdAt": now,
        }
    )

    logger.info(
        "mcq submitted session=%s correct=%s/%s percent=%s",
        session["id"], result["correctCount"], result["questionCount"], result["percent"],
    )
    return _state(session)

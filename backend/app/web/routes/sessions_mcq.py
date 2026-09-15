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
Deterministic and instant, and run by `app/mcq_runtime.py` — the SAME scorer the shared
`/api/interviews/{id}/mcq` routes use, so the same paper sat in a browser or on a phone
cannot produce two different numbers. No model is called, so an MCQ result is exact,
reproducible and free — see `app/mcq_scoring.py` for why multi-select is
all-or-nothing by default.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Body, HTTPException, Request, status

from app.security import AuthedUser
from app.web.deps import WebUser, settings_of
from app import mcq, mcq_runtime
from app.web.services import session_store
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


def _paper_of(session: dict) -> dict:
    """The session's resolved paper, in the shape the kernel's helpers expect.

    A web session stores the paper inline (`questions` + `mcqSections`) because that is
    how MCQ was built before the runtime moved. Rather than change how a live session is
    stored mid-flight, this adapts the shape at the boundary — so ordering, the public
    projection, answer cleaning and scoring all run through the SAME code the shared
    route uses. See `app/mcq_runtime.py`.
    """
    return {
        "questions": session.get("questions") or [],
        "sections": session.get("mcqSections") or [],
        "name": session.get("role") or "",
    }


def _state(session: dict) -> dict:
    """Everything the runtime needs, and nothing it must not have."""
    config = session.get("mcqConfig") or {}
    paper = _paper_of(session)
    return {
        "sessionId": session["id"],
        "status": session.get("status"),
        "questions": mcq.public_paper(
            paper, seed=mcq.shuffle_seed_for(config, attempt_key=session["id"])
        ),
        # Absent for an unsectioned paper, so the runtime can ask "is this divided?"
        # and get an answer rather than render an empty heading.
        "sections": mcq.public_sections(paper) or None,
        # What they have answered so far, so a reload restores the paper as left.
        "answers": session.get("mcqAnswers") or {},
        "submittedAt": session.get("mcqSubmittedAt"),
        "totalSeconds": config.get("totalSeconds"),
        "perQuestionSeconds": config.get("perQuestionSeconds"),
        # Server-computed, from `startedAt` — the SAME deadline math
        # `mcq_runtime` already uses for the shared `/api/interviews/{id}/mcq`
        # routes (Flutter's path). None for an untimed paper, so the client
        # renders no clock rather than a wrong one; never negative, 0 means
        # time is up and `_maybe_auto_submit` has already closed the paper.
        "remainingSeconds": mcq_runtime.remaining_seconds_for(
            config.get("totalSeconds"), session.get("startedAt")
        ),
        "branding": (session.get("branding") or {}),
        # The candidate is told the score only if the recruiter allows it; absent
        # by default, because a score delivered by a machine with no human in the
        # loop is what the completion screen deliberately avoids. Even when
        # allowed, it goes through `_public_result` — a score is not the key.
        "result": mcq_runtime.candidate_result(session.get("mcqResult"))
        if config.get("showScoreToCandidate")
        else None,
    }


def _expired(session: dict) -> bool:
    """Whether the whole-paper clock has run out. False for an untimed paper."""
    config = session.get("mcqConfig") or {}
    remaining = mcq_runtime.remaining_seconds_for(
        config.get("totalSeconds"), session.get("startedAt")
    )
    return remaining == 0


async def _score_and_finish(
    settings, session: dict, template: dict | None, answers: dict, *, auto: bool
) -> dict:
    """Score, store, and finish — shared by a candidate's own Submit and the
    clock closing the paper for them, so a paper handed in by choice and one
    closed out by expiry produce exactly the same kind of result.

    `auto=True` records that nobody pressed Submit — the recruiter's report
    can distinguish "they finished" from "time ran out on them," the same
    distinction `question.autoSubmitted` already draws for the timed track.
    """
    paper = _paper_of(session)
    config = session.get("mcqConfig") or {}
    result = mcq_runtime.score(paper["questions"], answers, config=config, paper=paper)

    now = _now()
    session["mcqAnswers"] = answers
    session["mcqResult"] = result
    session["mcqSubmittedAt"] = now
    session["mcqAutoSubmitted"] = auto
    session["status"] = "completed"
    session["completedAt"] = now
    await session_store.save(settings, session)

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
        "mcq %s session=%s correct=%s/%s percent=%s",
        "auto-submitted (time expired)" if auto else "submitted",
        session["id"], result["correctCount"], result["questionCount"], result["percent"],
    )
    return result


async def _maybe_auto_submit(settings, session: dict, template: dict | None) -> bool:
    """If the clock has run out and nobody has submitted, submit whatever is
    already saved. Called on every read and write, the same "a client cannot
    avoid a deadline by not asking" principle `session_store.settle` uses for
    the other tracks — MCQ has no per-question ticks to piggyback on, so this
    is the whole-paper equivalent. Returns True if this call just closed it.
    """
    if session.get("mcqSubmittedAt") or not _expired(session):
        return False
    await _score_and_finish(settings, session, template, session.get("mcqAnswers") or {}, auto=True)
    return True


@router.get("/{session_id}/mcq", summary="The MCQ paper, without the answer key")
async def get_paper(session_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)
    _require_mcq(session)

    # First open counts as starting: an assessment a candidate has seen is one they
    # have begun, and leaving it "created" would let a whole-paper timer be dodged
    # by opening and closing the tab.
    if session.get("status") == "created":
        session["status"] = "in_progress"
        session["startedAt"] = _now()
        await session_store.save(settings, session)

    # A client cannot avoid the deadline by simply not asking: every read
    # closes an expired paper before returning its state.
    await _maybe_auto_submit(settings, session, template)

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
    session, template = await session_store.load(settings, session_id, user)
    _require_mcq(session)

    await _maybe_auto_submit(settings, session, template)

    if session.get("mcqSubmittedAt"):
        raise HTTPException(status.HTTP_409_CONFLICT, "This assessment is already submitted.")

    incoming = (body or {}).get("answers")
    if not isinstance(incoming, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "answers must be an object.")

    cleaned = mcq.clean_answers(incoming, session.get("questions") or [])

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

    # Folded in BEFORE the expiry check below, so a Submit that loses the race
    # with the clock by a second still has ITS OWN answers scored rather than
    # whatever the last autosave happened to catch — a submission arriving
    # right at the deadline is late, not discarded.
    paper = _paper_of(session)
    session["mcqAnswers"] = {
        **(session.get("mcqAnswers") or {}),
        **mcq.clean_answers((body or {}).get("answers"), paper["questions"]),
    }

    # ONE scorer, shared with `/api/interviews/{id}/mcq/submit`. The same paper sat on
    # either surface must not be able to produce two numbers, and the only way to
    # guarantee that is for there to be one implementation rather than an agreement
    # between two.
    if await _maybe_auto_submit(settings, session, template):
        # The clock closed it in the line above, but with this request's own
        # answers already folded in — this Submit still counts, it just tied
        # with the deadline instead of beating it.
        return _state(session)

    await _score_and_finish(settings, session, template, session["mcqAnswers"], auto=False)
    return _state(session)

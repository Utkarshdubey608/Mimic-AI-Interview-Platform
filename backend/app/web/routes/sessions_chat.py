"""The conversational track's routes — ports the `/chat/*` half of `sessions.ts`.

Six routes over one state machine. The candidate sees a chat: a greeting, a readiness
prompt, then questions one at a time with the interviewer acknowledging each answer.

Mounted on the same `/sessions` prefix as the core lifecycle, in its own module because
the conversational engine has nothing in common with the fixed-slot one beyond the
session it runs on.

`/question-presented` is the route that makes the timing fair — see `reveal_timed_turn`.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Body, HTTPException, Request, status
from fastapi.responses import JSONResponse

from app.security import AuthedUser
from app.web.deps import RateLimitGenerateWeb, WebUser, settings_of
from app.web.services import chat_engine, conversation, session_store
from app.web.store import get_store

logger = logging.getLogger("web.sessions.chat")

router = APIRouter(prefix="/sessions", tags=["web:sessions"])

TIMES_OF_DAY = ("morning", "afternoon", "evening")


async def _fixed_questions(settings, template: dict, session: dict | None = None) -> list[dict]:
    """The fixed question list this interview actually runs on, or empty for
    an adaptive interview.

    Two shapes, because two things build a "fixed" chat template. A recruiter
    authoring directly against `web_templates` points `fixedQuestionSetId` at a
    saved question set, resolved here by id. An invite materialised through
    `invite_bridge` (the shared `interviews` collection — role pipelines, bulk
    invites) carries no such reference at all: its questions were embedded as
    plain text straight onto the SESSION when the candidate first opened the
    link (`invite_bridge.build_session`), because that is where the frozen
    schema's `questions: list[str]` already lived. Looking only for
    `fixedQuestionSetId` treated every one of those as having no questions —
    the interview would greet the candidate normally and then end the moment
    they said they were ready, despite three real questions sitting right on
    the session the whole time.
    """
    if template.get("questionSource") != "fixed":
        return []
    if template.get("fixedQuestionSetId"):
        question_set = await get_store(settings).question_sets.get(
            str(template["fixedQuestionSetId"])
        )
        return (question_set or {}).get("questions") or []
    embedded = [
        q for q in (session or {}).get("questions") or []
        if isinstance(q, dict) and str(q.get("text") or "").strip()
    ]
    return embedded


def _state(session: dict, template: dict, questions: list[dict]) -> dict:
    return conversation.compute_chatbot_state(
        session,
        template,
        fixed_question_count=len(questions),
        fixed_question_ids=[q.get("id") for q in questions],
    )


@router.post(
    "/{session_id}/chat/begin",
    summary="Start the conversation",
    dependencies=[RateLimitGenerateWeb],
)
async def begin_chat(
    session_id: str,
    request: Request,
    body: dict = Body(default={}),
    user: AuthedUser = WebUser,
) -> dict:
    """Produce the opening greeting.

    Idempotent for a running interview: a reconnecting client gets the current state
    rather than a second greeting and a reset transcript.
    """
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)
    questions = await _fixed_questions(settings, template, session)

    if session.get("status") == "in_progress" and (session.get("transcript") or []):
        return _state(session, template, questions)
    if session.get("status") in ("completed", "expired"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Interview already finished")

    time_of_day = body.get("timeOfDay")
    try:
        await chat_engine.begin_conversation(
            settings,
            session,
            template,
            time_of_day=time_of_day if time_of_day in TIMES_OF_DAY else None,
            fixed_questions=questions,
        )
    except ValueError as exc:
        # The one hard requirement: an adaptive interview cannot be conducted without a
        # résumé to ground its questions in.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    await session_store.save(settings, session)
    return _state(session, template, questions)


@router.get("/{session_id}/chat/state", summary="The conversation so far")
async def chat_state(
    session_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    """The transcript and the current clock.

    Advances any elapsed phase first, and auto-submits when the answer window has run
    out — so a candidate who stopped polling comes back to an interview that moved on,
    exactly as one who kept polling would.
    """
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)
    questions = await _fixed_questions(settings, template, session)

    ids = [q.get("id") for q in questions]
    if conversation.advance_chatbot_timing(session, template, fixed_question_ids=ids) == (
        "answer_expired"
    ):
        await _auto_submit(settings, session, template, questions)
    else:
        await session_store.save(settings, session)

    await session_store.maybe_score(settings, session, template)
    return _state(session, template, questions)


async def _auto_submit(settings, session: dict, template: dict, questions: list[dict]) -> None:
    """Submit whatever the candidate had typed when their window closed.

    Marked `auto_advanced`, which the recruiter's report distinguishes from a candidate
    who chose to stop — running out of time and giving up are different facts.
    """
    turn = conversation.current_interviewer_turn(session)
    draft = (turn or {}).get("draft") or ""

    await chat_engine.submit_chat_answer(
        settings, session, template, draft, auto_advanced=True, fixed_questions=questions
    )
    await session_store.save(settings, session)


@router.post(
    "/{session_id}/chat/answer",
    summary="Answer the current turn",
    dependencies=[RateLimitGenerateWeb],
)
async def chat_answer(
    session_id: str,
    request: Request,
    body: dict = Body(...),
    user: AuthedUser = WebUser,
) -> JSONResponse:
    """Record the answer and produce the next turn."""
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)
    questions = await _fixed_questions(settings, template, session)
    ids = [q.get("id") for q in questions]

    if session.get("status") != "in_progress":
        return JSONResponse(
            {"error": "Interview is not in progress", "state": _state(session, template, questions)},
            status_code=status.HTTP_409_CONFLICT,
        )

    turn = conversation.current_interviewer_turn(session)
    if turn is None:
        return JSONResponse(
            {"error": "No turn is awaiting an answer", "state": _state(session, template, questions)},
            status_code=status.HTTP_409_CONFLICT,
        )

    # Same idiom as the fixed-slot track's own guard against this exact bug class
    # (routes/sessions.py's `question.get("id") != body.get("questionId")`): the
    # client already sends `turnId` on every submit (`useChatbotSession.ts`), but
    # nothing here ever checked it. A double-click or a network retry would
    # silently answer whatever turn happened to be current BY THEN — appending a
    # second candidate turn, advancing the interview twice, and burning a second
    # Gemini call for one submission. Strict on purpose: a missing turnId fails
    # this the same way a wrong one does, exactly like the fixed-slot check does
    # for a missing `questionId`.
    if turn.get("id") != body.get("turnId"):
        return JSONResponse(
            {"error": "Not the current turn", "state": _state(session, template, questions)},
            status_code=status.HTTP_409_CONFLICT,
        )

    # A late answer is still an answer, but it is recorded as auto-advanced: the window
    # had already closed, and treating it as a deliberate submission would overstate it.
    expired = conversation.advance_chatbot_timing(
        session, template, fixed_question_ids=ids
    ) == "answer_expired"

    answer = body.get("answerText")
    text = answer if isinstance(answer, str) else (turn.get("draft") or "")

    await chat_engine.submit_chat_answer(
        settings, session, template, text, auto_advanced=expired, fixed_questions=questions
    )
    await session_store.save(settings, session)
    await session_store.maybe_score(settings, session, template)
    return JSONResponse(_state(session, template, questions))


@router.post("/{session_id}/chat/draft", summary="Auto-save the in-progress answer")
async def chat_draft(
    session_id: str,
    request: Request,
    body: dict = Body(...),
    user: AuthedUser = WebUser,
) -> dict:
    """Persist what the candidate has typed, so a refresh does not lose it."""
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)

    turn = conversation.current_interviewer_turn(session)
    if turn is None:
        return {"ok": False}

    turn["draft"] = str(body.get("draft") or "")
    await session_store.save(settings, session)
    return {"ok": True}


@router.post(
    "/{session_id}/chat/question-presented", summary="The client has shown the question"
)
async def question_presented(
    session_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    """Arm the clock for the current turn.

    This is what makes conversational timing fair. The server appends a turn the moment
    it is generated, but the client shows a "Thinking…" beat and may reveal an
    acknowledgment bubble first — so the clock starts here instead, and none of that
    preamble comes out of the candidate's answer time.
    """
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)
    questions = await _fixed_questions(settings, template, session)

    if conversation.reveal_timed_turn(
        session, template, fixed_question_ids=[q.get("id") for q in questions]
    ):
        await session_store.save(settings, session)

    return _state(session, template, questions)


@router.post("/{session_id}/chat/skip-thinking", summary="Start answering now")
async def chat_skip_thinking(
    session_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)
    questions = await _fixed_questions(settings, template, session)

    if conversation.skip_thinking(
        session, template, fixed_question_ids=[q.get("id") for q in questions]
    ):
        await session_store.save(settings, session)

    return _state(session, template, questions)

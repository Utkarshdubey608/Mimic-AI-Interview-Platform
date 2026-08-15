"""The interview session engine — ports the candidate lifecycle of `server/routes/sessions.ts`.

The candidate-facing half of the product. A session is created by a recruiter (or
materialised from an invite), the candidate picks a track, uploads a résumé if the
interview is adaptive, and then works through questions under a server-enforced clock.

Two rules run through every handler here:

**The clock is settled before anything else.** Every route calls `settle` first, so a
boundary that elapsed while the client was not asking is applied before the request is
judged. A client cannot dodge a deadline by not polling.

**The candidate only ever receives `compute_public_state`.** It carries the current
question and nothing else from the list — the full session holds every question, every
answer and the ideal-answer notes, and returning it would hand the candidate the rest of
their own interview.

The chat, avatar and two-way sub-tracks live in sibling modules mounted under the same
prefix.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import (
    APIRouter,
    Body,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse

from app.providers import rekognition
from app.providers.base import ProviderNotConfigured, UpstreamError
from app.security import AuthedUser
from app.web.deps import (
    RateLimitFace,
    RateLimitGenerateWeb,
    RateLimitLiveTokenWeb,
    WebUser,
    assert_owner,
    settings_of,
)
from app.web.services import (
    conversation,
    interview_invite,
    invite_bridge,
    question_gen,
    resume_text,
    session_store,
    timing,
    video_transcript,
    voice_setup,
)
from app.web.store import get_store

logger = logging.getLogger("web.sessions")

router = APIRouter(prefix="/sessions", tags=["web:sessions"])

TRACKS = ("chat", "chatbot", "video_avatar", "voice", "video", "two_way")

# A résumé, not a portfolio.
MAX_RESUME_BYTES = 8 * 1024 * 1024

DELETED_TEMPLATE = "(deleted template)"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _iso(value: object) -> str | None:
    """Firestore hands back a datetime; the rest of this surface speaks ISO strings."""
    if value is None:
        return None
    as_iso = getattr(value, "isoformat", None)
    return as_iso() if callable(as_iso) else str(value)


async def _pending_invites(settings, email: str, already_listed: set[str]) -> list[dict]:
    """Interviews this candidate has been invited to but has never opened.

    A bulk invite writes an `interviews` document and nothing else: the web session is
    only materialised when the candidate first opens their take link. Listing web
    sessions alone therefore hides exactly the interviews a candidate signs in to look
    for — the link in the email works, but the portal says they have none.

    Read-only and best-effort. This list is a convenience on top of the email; a
    Firestore hiccup here must not blank out the sessions the candidate really does
    have, so a failure logs and yields nothing rather than raising.
    """
    import asyncio

    def _fetch() -> list[dict]:
        try:
            documents = (
                interview_invite.interviews(settings)
                .where("candidateEmailLower", "==", email)
                .get()
            )
        except Exception as exc:  # noqa: BLE001 - convenience list, never fatal
            logger.warning(
                "could not read invites for %s: %s", email, type(exc).__name__
            )
            return []

        rows: list[dict] = []
        for document in documents:
            # Already materialised — the session row is the better record of the two.
            if document.id in already_listed:
                continue
            data = document.to_dict() or {}
            rows.append(
                {
                    "id": document.id,
                    "templateName": data.get("title") or DELETED_TEMPLATE,
                    "role": data.get("role"),
                    "track": invite_bridge.track_for(data),
                    # The invite's own vocabulary ("assigned") is not the session
                    # lifecycle's. Anything not finished reads as not started, which is
                    # what the candidate needs the button to say.
                    "status": (
                        "completed" if data.get("status") == "completed" else "created"
                    ),
                    "createdAt": _iso(data.get("createdAt")),
                    "completedAt": _iso(data.get("completedAt")),
                }
            )
        return rows

    return await asyncio.to_thread(_fetch)


def _state(session: dict, template: dict) -> dict:
    return timing.compute_public_state(session, template)


# ── creation ──────────────────────────────────────────────────────────────────


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a session")
async def create_session(
    request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    """A session from a template, producing a take link.

    ROLE-GATING: recruiter-only in Express. Deferred — the caller becomes the owner
    either way, so a candidate creating one would only ever see their own.
    """
    settings = settings_of(request)
    store = get_store(settings)

    template = await store.templates.get(str(body.get("templateId") or ""))
    if not template:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown templateId")

    # The email IS the access control: the candidate must later sign in with a matching
    # verified address. Without one the session could never be opened by anybody.
    candidate = body.get("candidate") if isinstance(body.get("candidate"), dict) else {}
    email = str(candidate.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "A candidate email is required to assign this interview",
        )

    questions: list[dict] = []
    if template.get("questionSource") == "fixed":
        question_set = await store.question_sets.get(
            str(template.get("fixedQuestionSetId") or "")
        )
        if not question_set or not (question_set.get("questions") or []):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Template references an empty or missing question set",
            )
        # Fresh ids: the session's questions are its own record, and sharing ids with the
        # set would make an edit to the set reach back into a finished interview.
        questions = [
            {
                "id": str(uuid.uuid4()),
                "text": question.get("text"),
                "category": question.get("category"),
                "idealAnswerNotes": question.get("idealAnswerNotes"),
                "autoSubmitted": False,
            }
            for question in question_set["questions"]
        ]

    now = _now()
    session = {
        "id": str(uuid.uuid4()),
        "templateId": template["id"],
        "recruiterId": user.uid,
        "track": body.get("track") or template.get("track"),
        "candidate": {"name": candidate.get("name") or "Candidate", "email": email},
        "status": "created",
        "questions": questions,
        "currentIndex": 0,
        "createdAt": now,
        "integrityEvents": [],
        "tabSwitchCount": 0,
    }
    await store.sessions.put(session)
    return {"id": session["id"]}


@router.post("/{session_id}/claim", summary="Open an invite link")
async def claim(session_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    """Resolve a Firestore invite into a local session. Idempotent."""
    settings = settings_of(request)
    session, template = await invite_bridge.materialise(settings, session_id, user)
    await session_store.settle(settings, session, template)
    return _state(session, template)


# ── the candidate's view ──────────────────────────────────────────────────────


@router.get("/mine", summary="The signed-in candidate's interviews")
async def mine(request: Request, user: AuthedUser = WebUser) -> list[dict]:
    """Scoped strictly to the caller's verified email.

    Never includes a score. An empty array reveals nothing about sessions assigned to
    anyone else, which is what makes "no interviews" a safe answer for a candidate who
    signed in with the wrong address.

    Defined before `/{session_id}` so "mine" is not read as a session id.
    """
    settings = settings_of(request)
    store = get_store(settings)

    email = (user.email or "").strip().lower()
    if not email:
        return []

    sessions = await store.sessions.where("candidate.email", "==", email)
    templates = {t["id"]: t for t in await store.templates.all() if t.get("id")}

    items = [
        {
            "id": session.get("id"),
            "templateName": (templates.get(session.get("templateId") or "") or {}).get(
                "name"
            )
            or DELETED_TEMPLATE,
            "role": (templates.get(session.get("templateId") or "") or {}).get("role"),
            "track": session.get("track"),
            "status": session.get("status"),
            "createdAt": session.get("createdAt"),
            "completedAt": session.get("completedAt"),
        }
        for session in sessions
    ]

    # Plus anything they have been invited to and not yet opened, which has no session
    # row to find. Without this the portal is empty for a freshly-invited candidate.
    items.extend(await _pending_invites(settings, email, {i["id"] for i in items}))

    return sorted(items, key=lambda item: str(item.get("createdAt") or ""), reverse=True)


@router.get("", summary="The recruiter's sessions")
async def list_sessions(request: Request, user: AuthedUser = WebUser) -> list[dict]:
    """Owner-scoped. A recruiter never sees another's candidates."""
    import asyncio

    settings = settings_of(request)
    store = get_store(settings)

    sessions, templates = await asyncio.gather(
        store.sessions.owned_by(user.uid), store.templates.all()
    )
    by_id = {t["id"]: t for t in templates if t.get("id")}

    # Scores fetched concurrently: at ~60ms per round trip a sequential loop over a
    # busy recruiter's list would take seconds.
    ids = [s["id"] for s in sessions if s.get("id")]
    reports = await asyncio.gather(*(store.reports.get(i) for i in ids))
    scores = {i: (r or {}).get("overallScore") for i, r in zip(ids, reports)}
    # How many scored answers stand behind each score. DERIVED, never authored:
    # the length of the report's perQuestion. The sessions list shows a score
    # with the weight of evidence behind it rather than a bare number. None
    # until a report exists, so the column stays empty instead of reading "0".
    cited = {
        i: (len((r or {}).get("perQuestion") or []) or None) for i, r in zip(ids, reports)
    }

    items = [
        {
            "id": session.get("id"),
            "candidate": session.get("candidate"),
            "templateId": session.get("templateId"),
            "templateName": (by_id.get(session.get("templateId") or "") or {}).get("name")
            or DELETED_TEMPLATE,
            "track": session.get("track"),
            "status": session.get("status"),
            "createdAt": session.get("createdAt"),
            "startedAt": session.get("startedAt"),
            "completedAt": session.get("completedAt"),
            "overallScore": scores.get(session.get("id")),
            "citedAnswers": cited.get(session.get("id")),
        }
        for session in sessions
    ]
    return sorted(items, key=lambda item: str(item.get("createdAt") or ""), reverse=True)


@router.get("/{session_id}/state", summary="The candidate's view of a session")
async def state(session_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)
    await session_store.settle(settings, session, template)
    return _state(session, template)


# ── entry screen ──────────────────────────────────────────────────────────────


@router.post("/{session_id}/track", summary="Choose a track")
async def choose_track(
    session_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)

    if session.get("status") not in ("created", "system_check"):
        # Switching mid-interview would strand the answers already given in a shape the
        # new track cannot read.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Track can only be chosen before the interview begins",
        )

    track = body.get("track")
    if track not in TRACKS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid track")

    session["track"] = track
    await session_store.save(settings, session)
    return _state(session, template)


@router.post("/{session_id}/system-check", summary="Reached the system check")
async def system_check(
    session_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)

    if session.get("status") == "created":
        session["status"] = "system_check"
        await session_store.save(settings, session)

    return _state(session, template)


@router.post(
    "/{session_id}/resume",
    summary="Upload a résumé",
    dependencies=[RateLimitGenerateWeb],
)
async def upload_resume(
    session_id: str,
    request: Request,
    resume: UploadFile = File(...),
    fullName: str = Form(default=""),
    user: AuthedUser = WebUser,
) -> dict:
    """Parse a résumé, and record the candidate's name.

    The name is asked on the same step and matters: the AI interviewer addresses the
    candidate by it in greetings and questions, and "Candidate" read aloud is worse than
    no name at all.

    Accepted for adaptive interviews (which need it to generate questions) and for the
    video-avatar track regardless of question source — the avatar is given it so it knows
    who it is talking to.
    """
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)

    if template.get("questionSource") != "adaptive" and session.get("track") != "video_avatar":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This interview does not use a résumé"
        )

    data = await resume.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No résumé uploaded")
    if len(data) > MAX_RESUME_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That file is too large."
        )

    text = await resume_text.extract(
        data, content_type=resume.content_type or "", filename=resume.filename or ""
    )
    if not text.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No text could be read from that file. If it is a scanned image, try a "
            "text-based PDF or a DOCX.",
        )

    session["resumeText"] = text
    if fullName.strip():
        session.setdefault("candidate", {})["name"] = fullName.strip()[:120]

    await session_store.save(settings, session)
    return _state(session, template)


# ── the interview ─────────────────────────────────────────────────────────────


@router.post("/{session_id}/begin", summary="Start the interview")
async def begin(session_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    """Start question 0's preparation phase.

    Idempotent for an already-running session: a double-tap on "Begin" must not restart
    the clock the candidate is already answering against.
    """
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)

    if session.get("status") == "in_progress":
        await session_store.settle(settings, session, template)
        return _state(session, template)
    if session.get("status") in ("completed", "expired"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Interview already finished")

    if not (session.get("questions") or []) and template.get("questionSource") == "adaptive":
        if not session.get("resumeText"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "A résumé is required before starting"
            )
        session["questions"] = await _generate_adaptive_questions(
            settings, session, template
        )

    if not (session.get("questions") or []):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "No questions could be generated"
        )

    now = _now()
    session["status"] = "in_progress"
    session["startedAt"] = now
    session["currentIndex"] = 0
    session["questions"][0]["prepStartedAt"] = now

    await session_store.save(settings, session)
    return _state(session, template)


async def _generate_adaptive_questions(
    settings, session: dict, template: dict
) -> list[dict]:
    """The tailored question list for an adaptive interview.

    Falls back to a generic set rather than failing: a candidate who has uploaded their
    résumé and pressed Begin should be interviewed, and a degraded question list is
    better than a dead end. The recruiter sees the interview happened either way.
    """
    adaptive = template.get("adaptive") or {}
    count = (
        adaptive.get("numberOfQuestions")
        or (template.get("timing") or {}).get("numberOfQuestions")
        or 5
    )

    try:
        generated = await question_gen.generate_from_resume_text(
            settings,
            resume_text=session.get("resumeText") or "",
            role=template.get("role") or "",
            seniority=template.get("seniority"),
            count=count,
            style=adaptive.get("style"),
            technical=adaptive.get("technicalCount"),
            non_technical=adaptive.get("nonTechnicalCount"),
            difficulty=adaptive.get("difficulty"),
            focus_topics=adaptive.get("focusTopics"),
        )
    except Exception as exc:  # noqa: BLE001 - interview them anyway
        logger.error("adaptive generation failed for %s: %s", session.get("id"), exc)
        generated = []

    if not generated:
        generated = question_gen.fallback_questions(template.get("role") or "this", count)

    return [
        {
            "id": str(uuid.uuid4()),
            "text": question.get("text"),
            "category": question.get("category"),
            "idealAnswerNotes": question.get("idealAnswerNotes"),
            "autoSubmitted": False,
        }
        for question in generated
    ]


@router.post("/{session_id}/skip-prep", summary="Start answering now")
async def skip_prep(session_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)
    await session_store.settle(settings, session, template)

    if not (template.get("timing") or {}).get("allowSkipPrep"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Skipping preparation is disabled")

    question = _current_question(session)
    if (
        session.get("status") != "in_progress"
        or question is None
        or not question.get("prepStartedAt")
        or question.get("answerStartedAt")
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Not in a preparation phase")

    question["answerStartedAt"] = _now()
    await session_store.save(settings, session)
    return _state(session, template)


@router.post("/{session_id}/draft", summary="Auto-save the in-progress answer")
async def save_draft(
    session_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> JSONResponse:
    """Persist what the candidate has typed so far, so a refresh does not lose it."""
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)
    await session_store.settle(settings, session, template)

    question = _current_question(session)
    if question is None or question.get("id") != body.get("questionId"):
        # The clock moved on while they were typing. 409 rather than writing the draft
        # onto whatever question is current now, which would attach an answer to the
        # wrong question.
        return JSONResponse(
            {"error": "Stale question — refresh state"},
            status_code=status.HTTP_409_CONFLICT,
        )

    question["draft"] = str(body.get("draft") or "")
    await session_store.save(settings, session)
    return JSONResponse({"ok": True})


@router.post("/{session_id}/answers", summary="Submit the current answer")
async def submit_answer(
    session_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> JSONResponse:
    """Lock the answer and advance."""
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)
    # May have auto-advanced already — the candidate's submit can lose a race with
    # their own deadline.
    await session_store.settle(settings, session, template)

    question = _current_question(session)
    if session.get("status") != "in_progress" or question is None:
        return JSONResponse(
            {"error": "No active question", "state": _state(session, template)},
            status_code=status.HTTP_409_CONFLICT,
        )
    if question.get("id") != body.get("questionId"):
        return JSONResponse(
            {"error": "Not the current question", "state": _state(session, template)},
            status_code=status.HTTP_409_CONFLICT,
        )
    if not question.get("answerStartedAt"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Cannot submit during preparation"
        )

    timing_config = template.get("timing") or {}
    started = timing.to_ms(question["answerStartedAt"]) or 0
    elapsed = (timing.now_ms() - started) / 1000
    if elapsed < (timing_config.get("answerSeconds") or 0) and not timing_config.get(
        "allowEarlySubmit"
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Early submission is disabled")

    now = _now()
    answer = body.get("answerText")
    question["answerText"] = answer if isinstance(answer, str) else question.get("draft") or ""

    if session.get("track") == "video":
        # The live transcript IS the answer — no video is stored. Mirroring it as
        # question/answer turns lets scoring and the results view run the same
        # conversation path as Voice.
        session.setdefault("mode", "conversational")
        session.setdefault("transcript", []).extend(
            video_transcript.build_turns(question, session.get("currentIndex") or 0, now)
        )

    question["submittedAt"] = now
    question["autoSubmitted"] = False

    session["currentIndex"] = (session.get("currentIndex") or 0) + 1
    following = _current_question(session)
    if following is not None:
        following["prepStartedAt"] = now
    else:
        session["status"] = "completed"
        session["completedAt"] = now

    await session_store.save(settings, session)
    await session_store.maybe_score(settings, session, template)
    return JSONResponse(_state(session, template))


@router.post("/{session_id}/complete", summary="Finish the interview")
async def complete(session_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    """Force-completion — the candidate quit, or the client ended the session.

    Whatever draft exists is submitted rather than discarded: someone who typed an
    answer and then closed the tab has answered.
    """
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)

    if session.get("track") in ("chatbot", "video_avatar"):
        _finish_conversation(session)
        await session_store.save(settings, session)
        await session_store.maybe_score(settings, session, template)
        return conversation.compute_chatbot_state(session, template)

    await session_store.settle(settings, session, template)

    if session.get("status") == "in_progress":
        question = _current_question(session)
        if question is not None and not question.get("submittedAt"):
            if question.get("answerText") is None:
                question["answerText"] = question.get("draft") or ""
            question["submittedAt"] = _now()
            question["autoSubmitted"] = True
        session["status"] = "completed"
        session["completedAt"] = _now()
        await session_store.save(settings, session)

    await session_store.maybe_score(settings, session, template)
    return _state(session, template)


def _finish_conversation(session: dict) -> None:
    """Close a conversational session, keeping the unsent draft as the final answer."""
    if session.get("status") != "in_progress":
        return

    now = _now()
    turn = conversation.current_interviewer_turn(session)
    if turn is not None:
        turn["submittedAt"] = now
        turn["autoAdvanced"] = True
        session.setdefault("transcript", []).append(
            {
                "id": str(uuid.uuid4()),
                "role": "candidate",
                "content": turn.get("draft") or "",
                "questionIndex": turn.get("questionIndex"),
                "isFollowUp": turn.get("isFollowUp"),
                "createdAt": now,
            }
        )

    session["status"] = "completed"
    session["completedAt"] = now


# ── integrity and facial analysis ─────────────────────────────────────────────


@router.post("/{session_id}/integrity-event", summary="Log an integrity event")
async def integrity_event(
    session_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    """Record a tab switch, blur, blocked paste or fullscreen exit.

    The count is returned with the recruiter's configured maximum so the client can warn
    the candidate before it matters — the point is deterrence, not a silent tally.
    """
    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)

    integrity = template.get("integrity") or {}
    if not integrity.get("logEvents"):
        return {"ok": True, "ignored": True}

    event_type = str(body.get("type") or "unknown")[:60]
    session.setdefault("integrityEvents", []).append({"type": event_type, "at": _now()})
    if event_type in ("tab_switch", "window_blur"):
        session["tabSwitchCount"] = (session.get("tabSwitchCount") or 0) + 1

    await session_store.save(settings, session)
    return {
        "ok": True,
        "tabSwitchWarnings": session.get("tabSwitchCount") or 0,
        "maxTabSwitchWarnings": integrity.get("maxTabSwitchWarnings"),
    }


@router.post(
    "/{session_id}/facial-frame",
    summary="Analyse one video frame",
    dependencies=[RateLimitFace],
)
async def facial_frame(
    session_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
):
    """Rekognition for a frame, reachable by the CANDIDATE.

    Distinct from `/api/web/avatar/analyze-face`, which is the recruiter's screening
    tool. Same request and response shape, so the client's service is unchanged.
    """
    settings = settings_of(request)
    session, _ = await session_store.load(settings, session_id, user)

    if session.get("track") != "video":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This interview does not capture facial analysis",
        )

    image = body.get("imageBase64")
    question_idx = body.get("questionIdx")
    timestamp_ms = body.get("timestampMs")

    if not image or not isinstance(image, str):
        return JSONResponse(
            {"success": False, "error": "imageBase64 required"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    if (len(image) * 3) // 4 < rekognition.MIN_IMAGE_BYTES:
        return {
            "success": False,
            "reason": "frame_too_small",
            "questionIdx": question_idx,
            "timestampMs": timestamp_ms,
        }

    try:
        faces = await rekognition.detect_faces(settings, image)
    except ProviderNotConfigured as exc:
        return JSONResponse(
            {"success": False, "error": str(exc)},
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    except UpstreamError as exc:
        return JSONResponse(
            {"success": False, "error": exc.detail},
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    return {
        "success": True,
        "faceDetails": faces,
        "questionIdx": question_idx,
        "timestampMs": timestamp_ms,
    }


@router.post("/{session_id}/facial", summary="Store the facial-analysis summary")
async def facial_summary(
    session_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    """The aggregated summary, computed client-side, stored opaquely.

    Shape-checked only enough to know it is the right kind of object — the recruiter's
    view owns the interpretation, and validating its internals here would couple this
    route to a client-side aggregation that changes independently.
    """
    settings = settings_of(request)
    session, _ = await session_store.load(settings, session_id, user)

    if session.get("track") != "video":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This interview does not capture facial analysis",
        )

    summary = body.get("summary")
    if isinstance(summary, dict) and isinstance(summary.get("perQuestion"), list):
        session["facialSummary"] = summary
        await session_store.save(settings, session)
        return {"ok": True}

    return {"ok": False}


# ── the recruiter's report ────────────────────────────────────────────────────


@router.get("/{session_id}/report", summary="The scored report")
async def report(session_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    """Owner-only. A candidate never sees a score or any feedback."""
    settings = settings_of(request)
    store = get_store(settings)
    session, template = await session_store.load(settings, session_id, user)
    assert_owner(session, user)

    is_conversation = session.get("track") in (
        "chatbot",
        "video_avatar",
        "voice",
        "video",
        "two_way",
    )

    return {
        "session": {
            "id": session.get("id"),
            "candidate": session.get("candidate"),
            "templateName": template.get("name"),
            "track": session.get("track"),
            "status": session.get("status"),
            "createdAt": session.get("createdAt"),
            "startedAt": session.get("startedAt"),
            "completedAt": session.get("completedAt"),
            "questions": _report_questions(session, is_conversation),
            "integrityEvents": session.get("integrityEvents") or [],
            "tabSwitchCount": session.get("tabSwitchCount") or 0,
            **(
                {
                    "transcript": [
                        {
                            "role": turn.get("role"),
                            "content": turn.get("content"),
                            "questionIndex": turn.get("questionIndex"),
                            "isFollowUp": turn.get("isFollowUp"),
                            "turnType": turn.get("turnType"),
                        }
                        for turn in session.get("transcript") or []
                    ]
                }
                if is_conversation
                else {}
            ),
            **(
                {"facialSummary": session["facialSummary"]}
                if session.get("facialSummary")
                else {}
            ),
        },
        "rubric": template.get("rubric"),
        "report": await store.reports.get(session_id),
    }


def _report_questions(session: dict, is_conversation: bool) -> list[dict]:
    """The per-question view the report renders.

    A conversation has no stored question records, so the transcript is regrouped into
    them. When the transcript is empty — a call that dropped before anything was said —
    it falls back to the PLANNED questions, so the report shows what the interview was
    going to ask rather than an empty accordion that looks like a rendering bug.
    """
    if not is_conversation:
        return [
            {
                "id": question.get("id"),
                "text": question.get("text"),
                "category": question.get("category"),
                "answerText": question.get("answerText"),
                "videoUrl": question.get("videoUrl"),
                "timeUsedSeconds": timing.answer_time_used(question),
                "autoSubmitted": question.get("autoSubmitted"),
            }
            for question in session.get("questions") or []
        ]

    groups = conversation.primary_question_groups(session)
    if groups:
        return [
            {
                "id": f"q{group['index']}",
                "text": group["question"],
                "answerText": group["answer"],
                "autoSubmitted": group["autoAdvanced"],
            }
            for group in groups
        ]

    return [
        {
            "id": f"q{index}",
            "text": question.get("text"),
            "category": question.get("category"),
            "answerText": "",
            "autoSubmitted": False,
        }
        for index, question in enumerate(session.get("questions") or [])
    ]


def _current_question(session: dict) -> dict | None:
    questions = session.get("questions") or []
    index = session.get("currentIndex") or 0
    return questions[index] if 0 <= index < len(questions) else None


# ── the voice track ───────────────────────────────────────────────────────────


@router.post(
    "/{session_id}/voice/token",
    summary="Mint a locked Gemini Live token for a voice interview",
    dependencies=[RateLimitLiveTokenWeb],
)
async def voice_token(
    session_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    """A credential for one voice interview, with the whole session locked into it.

    Replaces the Express WebSocket relay, which sat between the candidate's microphone
    and Google forwarding audio both ways. The browser now connects to Google directly —
    the same mechanism the Flutter app uses, one fewer hop of latency, and no long-lived
    socket for this service to keep alive.

    The lock is what makes it safe: the token carries the entire setup with no
    `fieldMask`, so the interviewer's instructions, the question script, the voice and the
    model are fixed here and a tampered client cannot rewrite them.
    """
    from app.providers.gemini import GeminiClient, rfc3339

    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)

    if session.get("track") != "voice":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This interview does not use the voice track"
        )
    if session.get("status") in ("completed", "expired"):
        raise HTTPException(status.HTTP_409_CONFLICT, "The interview has already finished")

    if not (session.get("questions") or []):
        if template.get("questionSource") == "adaptive" and not session.get("resumeText"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "A résumé is required before starting"
            )
        session["questions"] = await _generate_adaptive_questions(
            settings, session, template
        )
        if not (session.get("questions") or []):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "No questions are configured for this interview"
            )

    session["status"] = "in_progress"
    session.setdefault("startedAt", _now())
    session.setdefault("mode", "conversational")
    session.setdefault("transcript", [])
    await session_store.save(settings, session)

    setup = voice_setup.build_live_setup(
        session, template, model=settings.live_model_name
    )
    token = await GeminiClient(settings).mint_live_token(
        setup,
        session_minutes=voice_setup.session_minutes(
            template, settings.gemini_token_expiry_buffer_minutes
        ),
    )

    return {
        "token": token.token,
        "wsUrl": token.ws_url,
        "model": token.model,
        "expiresAt": rfc3339(token.expires_at),
        "connectBy": rfc3339(token.connect_by),
        "totalQuestions": len(session.get("questions") or []),
    }


@router.post("/{session_id}/voice/transcript", summary="Forward a live voice utterance")
async def voice_transcript(
    session_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    """Record one utterance from the direct browser↔Google session.

    Because the audio no longer passes through this service, the transcript has to be
    forwarded back explicitly — Google's transcription reaches the browser, and this is
    how it reaches the record the interview is scored from.

    Shares the avatar track's matching, so a voice interview produces the same shape and
    is scored by the same path.
    """
    from app.web.services import avatar_transcript

    settings = settings_of(request)
    session, template = await session_store.load(settings, session_id, user)

    if session.get("track") != "voice":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This interview does not use the voice track"
        )

    role = body.get("role")
    text = body.get("text")
    if role not in ("interviewer", "candidate") or not isinstance(text, str):
        return {"ok": False}
    if session.get("status") not in ("in_progress", "completed"):
        return {"ok": False}

    if not avatar_transcript.append_utterance(session, role, text.strip()[:4000]):
        return {"ok": False}

    await session_store.save(settings, session)
    return {
        "ok": True,
        "asked": avatar_transcript.questions_asked(session),
        "total": len(session.get("questions") or []),
    }

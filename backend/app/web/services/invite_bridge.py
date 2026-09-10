"""The bridge between a Firestore invite and the local session engine.

Ports `server/services/inviteBridge.ts`.

Two data models meet here. Invites live in `interviews/{id}` — the collection shared
with the Flutter app, whose field names are frozen. The candidate interview ENGINE is
entirely template-driven and lives in `web_sessions` / `web_templates`. Rather than
rebuild every track against the interviews schema, an invite is **materialised** into a
session plus a synthesised template the first time the assigned candidate opens their
link, and the existing engine runs unchanged.

The session id IS the interview id. That is what makes the whole thing idempotent: a
candidate who reloads, loses connection, or opens the link on their phone lands on the
same session rather than starting a second one.

On completion `sync_result` writes the score back to the interview document, so the
recruiter and the Flutter app both see it — unpublished, because releasing a result to
the candidate stays a recruiter action.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app import interviews as interviews_kernel
from app import reports
from app.config import Settings
from app.security import AuthedUser
from app.web.services import interview_invite
from app.web.store import defaults, get_store

logger = logging.getLogger("web.invite_bridge")

# Every track the web runs. The interview document stores the precise one in `mode`;
# `type` is only Flutter's two-way bucket.
#
# This list said "the web's six tracks" and stayed at six while three more were added,
# so `track_for` silently answered "chat" for mcq, coding and essay — which made the
# `if track == ...` branches below for those tracks DEAD, and would have materialised a
# coding assessment as a timed chat interview. Adding a track without adding it here
# does not fail loudly; it fails as the wrong interview.
WEB_TRACKS = (
    "chatbot",
    "voice",
    "video_avatar",
    "chat",
    "video",
    "two_way",
    "mcq",
    "coding",
    "essay",
)

# An adaptive screen without a configured count. Bounded at the top by the same ceiling
# the question generator uses.
DEFAULT_QUESTION_COUNT = 5
MAX_QUESTION_COUNT = 25


def template_id_for(interview_id: str) -> str:
    """The synthesised template's id.

    Namespaced by the interview so it cannot collide with a recruiter's real template,
    and so it is obvious in the store that this one was generated rather than authored.
    """
    return f"invite:{interview_id}"


def track_for(data: dict) -> str:
    """The track an invite runs on.

    `mode` is authoritative and is now written by `interviews.build_assignment`, so
    every interview created since carries one. The fallback is for documents that
    predate that, and for the mobile client until it writes `mode` too — those have
    only `type`, which distinguishes video from chat and nothing else.

    **The fallback degrades to the SAME track, never a richer one.** It used to map
    `type: video` onto `video_avatar`, which silently turned a recruiter's recorded
    video interview into a Tavus avatar conversation the moment the candidate opened it
    in a browser: a different experience, a different vendor and a different cost from
    the one that was configured. `video` is a real track here — recorded video answers
    — so the honest degradation is to it. Guessing upward is how a client ends up
    running an interview nobody asked for.
    """
    mode = data.get("mode")
    if mode in WEB_TRACKS:
        return mode
    return "video" if data.get("type") == "video" else "chat"


def _as_int(value: object, fallback: int) -> int:
    try:
        return int(float(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback


def synthesise_template(interview_id: str, data: dict, now: str) -> dict:
    """A valid template built from the invite's screening config. Pure.

    The question source is the part worth reading twice:

    * A **two-way** interview is a live recruiter-led call with no scripted questions.
      The invite carries no `screening.source` for it, which would fall through to
      `adaptive` and gate the candidate behind a résumé upload before they could reach
      the live room. Forced to `fixed` with an empty question list.
    * `screening.source == "set"` means the recruiter chose a saved question set, and its
      questions are already embedded in the document — so the template is `fixed`.
    * `screening.source == "mixed"` combines both: the FIXED portion is already embedded
      in `questions` exactly like `set` mode's, and the RÉSUMÉ-ADAPTED portion is
      generated the same way `adaptive` mode's is — just a smaller count, appended after
      the fixed ones rather than replacing them. See `build_session` for the seeding and
      `routes/sessions.py`/`routes/sessions_avatar.py` for the append.
    * Anything else is `adaptive`: the questions are generated per candidate from their
      résumé after they upload it.
    """
    role = data.get("role") or "this role"
    track = track_for(data)
    screening = data.get("screening") if isinstance(data.get("screening"), dict) else {}

    if track == "two_way":
        source = "fixed"
    elif screening.get("source") == "set":
        source = "fixed"
    elif screening.get("source") == "mixed":
        source = "mixed"
    else:
        source = "adaptive"

    technical = _as_int(screening.get("techCount"), 3)
    non_technical = _as_int(screening.get("nonTechCount"), 2)
    embedded = [q for q in (data.get("questions") or []) if isinstance(q, str) and q.strip()]
    mixed_config = screening.get("mixedConfig") if isinstance(screening.get("mixedConfig"), dict) else {}
    resume_question_count = _as_int(mixed_config.get("resumeQuestionCount"), 0)

    if source == "fixed":
        # At least one, even with nothing embedded: a template claiming zero questions
        # would make the progress display divide by nothing.
        count = max(1, len(embedded))
    elif source == "mixed":
        # The TOTAL the candidate was told, not just the fixed portion already
        # embedded — the résumé-adapted questions are appended before the interview
        # starts (see build_session/routes/sessions.py) but the progress display and
        # timing must account for them from the first render.
        count = max(1, _as_int(mixed_config.get("totalQuestions"), len(embedded) + resume_question_count))
    else:
        count = max(1, min(MAX_QUESTION_COUNT, technical + non_technical or DEFAULT_QUESTION_COUNT))

    template: dict = {
        "id": template_id_for(interview_id),
        "name": f"{role} — invite",
        "role": role,
        "track": track,
        "questionSource": source,
        "timing": {**defaults.DEFAULT_TIMING, "numberOfQuestions": count},
        "rubric": defaults.default_rubric(),
        "integrity": dict(defaults.DEFAULT_INTEGRITY),
        "branding": dict(defaults.DEFAULT_BRANDING),
        "mode": "conversational",
        "createdAt": now,
        "updatedAt": now,
    }

    # MCQ carries a SET ID, not embedded question text. The rest of this pipeline
    # stores questions as plain strings, which cannot express an option list or an
    # answer key — so the paper stays in the recruiter's own mcq_sets document and
    # the session resolves it at create time (routes/sessions.py), with the key
    # never leaving the server.
    if track == "mcq":
        # Under `screening`, where build_document puts it, with a top-level fallback
        # for a document written by hand or by another client.
        mcq_set_id = screening.get("mcqSetId") or data.get("mcqSetId")
        if mcq_set_id:
            template["mcqSetId"] = str(mcq_set_id)
        mcq_config = screening.get("mcqConfig") or data.get("mcqConfig")
        if isinstance(mcq_config, dict):
            template["mcqConfig"] = dict(mcq_config)

    # Coding, mirroring the MCQ branch above: the ids travel, never the problems,
    # and the session resolves them with their hidden tests at create time.
    if track == "coding":
        ids = screening.get("codingProblemIds") or data.get("codingProblemIds")
        if isinstance(ids, list) and ids:
            template["codingProblemIds"] = [str(x) for x in ids if str(x)]

    # Essay, mirroring both branches above: the id travels, never the prompt, and the
    # session resolves it — with the recruiter's private marking notes — at create time.
    if track == "essay":
        prompt_id = str(screening.get("essayPromptId") or data.get("essayPromptId") or "")
        if prompt_id:
            template["essayPromptId"] = prompt_id

    if source == "adaptive":
        template["adaptive"] = {
            "role": role,
            "difficulty": screening.get("difficulty") or "mixed",
            "style": screening.get("style") or "mix",
            "numberOfQuestions": count,
            "technicalCount": technical,
            "nonTechnicalCount": non_technical,
            "focusTopics": screening["domains"]
            if isinstance(screening.get("domains"), list)
            else [],
            # Off: `numberOfQuestions` is the real total, and follow-ups would silently
            # lengthen an interview the candidate was told the length of.
            "allowFollowUps": False,
            "maxFollowUpsPerQuestion": 1,
            "interviewerTone": "friendly and professional",
            "language": "English",
        }

    if source == "mixed":
        # `mixed` — the counts the config UI and validation already enforce add up to
        # `count` above. `resumeQuestionCount` may be 0 (all-fixed Mixed config); the
        # résumé-generation step this drives (routes/sessions.py) simply appends nothing
        # in that case.
        template["mixed"] = {
            "fixedQuestionCount": _as_int(mixed_config.get("fixedQuestionCount"), len(embedded)),
            "resumeQuestionCount": resume_question_count,
        }
        # Reused AS-IS by the résumé-generation call (`question_gen.generate_from_resume_text`
        # via `_generate_adaptive_questions`) — the same function `adaptive` mode calls,
        # just asked for `resumeQuestionCount` questions instead of the interview's full
        # length. No second resume-analysis implementation.
        template["adaptive"] = {
            "role": role,
            "difficulty": screening.get("difficulty") or "mixed",
            "style": screening.get("style") or "mix",
            "numberOfQuestions": max(0, resume_question_count),
            "technicalCount": technical,
            "nonTechnicalCount": non_technical,
            "focusTopics": screening["domains"]
            if isinstance(screening.get("domains"), list)
            else [],
            "allowFollowUps": False,
            "maxFollowUpsPerQuestion": 1,
            "interviewerTone": "friendly and professional",
            "language": "English",
        }

    if track == "voice":
        template["voice"] = defaults.default_voice_config()

    return template


def build_session(
    interview_id: str, data: dict, template: dict, *, candidate_email: str, now: str
) -> dict:
    """The local session for an invite. Pure.

    The id is the INTERVIEW id, not a new one — that is what makes materialising
    idempotent across reloads and devices.
    """
    embedded = [q for q in (data.get("questions") or []) if isinstance(q, str) and q.strip()]
    questions = (
        [
            {"id": str(uuid.uuid4()), "text": text, "autoSubmitted": False}
            for text in embedded
        ]
        # `mixed` seeds the FIXED portion only, same as `fixed` — the résumé-adapted
        # rest is appended once, at session-begin, never here (see
        # routes/sessions.py/routes/sessions_avatar.py). Never prepended: fixed-first
        # ordering is structural, and appending after whatever is already in the list
        # is what preserves it.
        if template["questionSource"] in ("fixed", "mixed")
        else []
    )

    return {
        "id": interview_id,
        "templateId": template["id"],
        "recruiterId": data.get("recruiterId") or None,
        "track": template["track"],
        "candidate": {
            "name": data.get("candidateName") or candidate_email,
            "email": candidate_email,
        },
        "status": "created",
        "questions": questions,
        "currentIndex": 0,
        "createdAt": now,
        "integrityEvents": [],
        "tabSwitchCount": 0,
        # Marks this session as invite-backed, which is what makes `sync_result` write
        # the score back to Firestore instead of keeping it local.
        "viaInvite": True,
    }


async def materialise(
    settings: Settings, interview_id: str, user: AuthedUser
) -> tuple[dict, dict]:
    """Resolve an invite into a session and template. Idempotent.

    Raises 404 when the invite does not exist, 403 when it is assigned to someone else,
    and 409 when it is already completed.
    """
    import asyncio

    store = get_store(settings)

    existing = await store.sessions.get(interview_id)
    if existing:
        template = await store.templates.get(existing.get("templateId") or "")
        if not template:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, "Template for session not found"
            )
        return existing, template

    reference = interview_invite.interviews_collection(settings).document(interview_id)
    snapshot = await asyncio.to_thread(reference.get)
    if not snapshot.exists:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Interview not found")

    data = snapshot.to_dict() or {}
    assigned = str(data.get("candidateEmailLower") or "").strip().lower()
    caller = (user.email or "").strip().lower()

    if not assigned:
        # An invite with no assignee cannot be claimed by anyone — a 404 rather than
        # letting the first caller take it.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Interview not found")

    if assigned != caller:
        # 403 naming the signed-in address, deliberately, where the rest of this surface
        # answers 404 to avoid confirming a record exists. The trade is made once, here:
        # interview ids are unguessable random strings delivered by email, so confirming
        # existence to a signed-in non-assignee costs little — and the alternative
        # dead-ends every candidate who happens to be signed in with a second account,
        # with no way to work out why.
        logger.warning(
            "invite claim mismatch for %s: signed-in %s is not the assigned candidate",
            interview_id,
            caller or "(no email)",
        )
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This invitation was sent to a different email address. You are signed in as "
            f"{caller or 'an account without an email'} — sign out, then sign in (or "
            "create your candidate account) with the email address that received the "
            "invitation.",
        )

    if data.get("status") == "completed":
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This interview has already been completed"
        )

    # The recruiter may have restricted this to particular clients. Checked here, at
    # the claim, rather than deeper in: this is the point where a session and a
    # synthesised template would be written, and materialising an interview the
    # candidate is then refused would leave a session nobody can run.
    #
    # Unlike the Flutter side this needs no header — reaching `/api/web/*` at all IS
    # being the browser, so `web` cannot be spoofed here. See `interviews.DEVICES`.
    allowed = interviews_kernel.normalise_devices(data.get("allowedDevices"))
    if allowed and interviews_kernel.DEVICE_WEB not in allowed:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This interview has to be taken on "
            f"{interviews_kernel.describe_devices(allowed)}. Open your invitation "
            "there and sign in with this same email address.",
        )

    now = datetime.now(timezone.utc).isoformat()
    template = synthesise_template(interview_id, data, now)
    session = build_session(
        interview_id, data, template, candidate_email=assigned, now=now
    )

    await store.templates.put(template)
    await store.sessions.put(session)

    await _mark_launched(settings, reference, interview_id)
    return session, template


async def _mark_launched(settings: Settings, reference, interview_id: str) -> None:
    """Record the launch on the interview document. Best-effort.

    Never raises: the candidate is standing at the start of their interview, and failing
    to write a status field is not a reason to stop them. `attemptsUsed` increments
    server-side so a client cannot reset its own attempt count.
    """
    import asyncio

    from firebase_admin import firestore as admin_firestore

    def _write() -> None:
        reference.update(
            {
                "status": "in_progress",
                "attemptsUsed": admin_firestore.Increment(1),
                "updatedAt": admin_firestore.SERVER_TIMESTAMP,
            }
        )

    try:
        await asyncio.to_thread(_write)
    except Exception as exc:  # noqa: BLE001 - never block the candidate
        logger.error("could not mark %s in_progress: %s", interview_id, exc)


def build_result(report: dict) -> dict:
    """The `result` block written onto an interview document.

    A thin delegate to `reports.build_result_summary`, the shared definition of the
    flat half — the mobile surface's scorer produces the same shape from the same
    function, so a recruiter reading a score cannot tell which client ran the
    interview.

    **No `detail` block any more.** It used to nest the per-question scores, KPI
    averages and generation time here. That was a second copy of what the report
    document already held — and worse, the mobile surface wrote a `detail` of its own
    with a DIFFERENT shape and a `kind` discriminator, so one field name meant two
    things depending on which client had scored the interview. Nothing read either.
    The rich half has one home now: `reports/{interviewId}`. See app/reports.py.
    """
    return reports.build_result_summary(report)


async def sync_result(settings: Settings, session: dict, report: dict) -> None:
    """Push a completed session's score back to its interview document.

    **Runs for every session, not only invite-backed ones.** It used to return early
    unless the session carried `viaInvite`, because a recruiter-created session had no
    interview document to write to. It has one now — `POST /sessions` records the
    shared assignment, using the session id as the interview id — so the flag no longer
    distinguishes anything worth branching on, and branching on it is what made a
    template-created interview invisible to the mobile app, score included.

    `viaInvite` is left on the documents that have it. It is still true, still
    describes where the session came from, and removing it would rewrite history for
    no gain.

    Best-effort and never raises: the report is already stored locally, so a failure here
    delays the recruiter seeing it rather than losing it. `update` rather than
    `set(merge=True)` is deliberate — it FAILS on a missing document instead of
    creating a partial one. Sessions created before the assignment write existed have
    no interview document, and half a document (a result, no candidate, no title) would
    show up on the mobile dashboard as an unreadable row. Logged and skipped is the
    honest outcome for those.

    `resultPublished` is deliberately NOT set. Releasing a result to the candidate stays a
    recruiter action, and writing it here would publish every score automatically.
    """
    import asyncio

    from firebase_admin import firestore as admin_firestore
    from google.api_core import exceptions as google_exceptions

    session_id = session.get("id")
    if not session_id:
        return

    def _write() -> None:
        interview_invite.interviews_collection(settings).document(session_id).update(
            {
                "status": "completed",
                "completedAt": admin_firestore.SERVER_TIMESTAMP,
                "result": build_result(report),
                "resultPublished": False,
                "updatedAt": admin_firestore.SERVER_TIMESTAMP,
            }
        )

    try:
        await asyncio.to_thread(_write)
    except google_exceptions.NotFound:
        # A session predating the assignment write. Expected, not an error: the report
        # is stored and the recruiter sees it on the web. Info, so it does not read as
        # a fault in the logs of every legacy completion.
        logger.info(
            "no interviews/%s to sync into — session predates the shared "
            "assignment record",
            session_id,
        )
    except Exception as exc:  # noqa: BLE001 - the report is safe locally either way
        logger.error("could not sync result for %s: %s", session_id, exc)

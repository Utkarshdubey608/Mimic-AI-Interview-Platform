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

from app import interviews
from app.providers import rekognition
from app.providers.base import ProviderNotConfigured, UpstreamError
from app.security import AuthedUser
from app.web.deps import (
    NotFound,
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
    essay_prompts,
)
from app.web.shared import speech
from app.web.routes import mcq_sets as mcq_sets_routes
from app.web.services import coding_problems, coding_scoring
from app.web.store import get_store

logger = logging.getLogger("web.sessions")

router = APIRouter(prefix="/sessions", tags=["web:sessions"])

# The interview modes the server will accept on a session.
#
# `mcq` is the closed-ended mode: its answers are compared to a stored key by
# `app/mcq_scoring.py` rather than judged by Gemini, so it is the only track
# whose score is exact, instant and reproducible.
#
# Mirrors `TrackType` in web_version/talbotiq-platform/shared/types.ts, which
# carries the note on the third copy of this list (the Flutter client).
TRACKS = (
    "chat",
    "chatbot",
    "video_avatar",
    "voice",
    "video",
    "two_way",
    "mcq",
    "coding",
    "essay",
)

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


async def _candidate_interviews(settings, email: str) -> dict[str, dict]:
    """Every interview assigned to this candidate, keyed by id.

    Read once and used twice: for the invites they have not opened yet, and for the
    published OUTCOME on the ones they have. Both need the same documents, and a
    candidate's own list is small.

    Best-effort. A Firestore hiccup here must not blank out the sessions they really do
    have, so a failure logs and yields nothing rather than raising.
    """
    import asyncio

    def _fetch() -> dict[str, dict]:
        try:
            documents = (
                interview_invite.interviews_collection(settings)
                .where("candidateEmailLower", "==", email)
                .get()
            )
        except Exception as exc:  # noqa: BLE001 - convenience data, never fatal
            logger.warning(
                "could not read invites for %s: %s", email, type(exc).__name__
            )
            return {}
        return {document.id: (document.to_dict() or {}) for document in documents}

    return await asyncio.to_thread(_fetch)


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
                interview_invite.interviews_collection(settings)
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
                    # Same allowlist as the session rows above. A candidate can be
                    # given an outcome for an interview they never opened — a résumé
                    # round is scored from what they submitted, not from a session.
                    "outcome": interviews.candidate_result_view(data),
                    "roundKind": data.get("roundKind") or None,
                    # How the whole pipeline ended, once a recruiter has released
                    # it. Allow-listed like the round result — see interviews.py.
                    "conclusion": interviews.candidate_conclusion_view(data),
                    # Which pipeline this round belongs to, and where in it.
                    #
                    # Without these the browser can only show a candidate a flat
                    # list of unrelated invitations — the exact confusion the
                    # Flutter client fixed with groupByTest. `testId` is the
                    # stored key; the clients call it a pipeline.
                    "pipelineId": data.get("testId") or None,
                    "roundOrder": data.get("roundOrder"),
                    "roundTitle": data.get("roundTitle") or None,
                }
            )
        return rows

    return await asyncio.to_thread(_fetch)


async def _recruiter_interviews(settings, uid: str) -> dict[str, dict]:
    """This recruiter's interviews, keyed by id. Best-effort.

    Read so a session row can report which TEST it belongs to — the web session does
    not carry `testId`, and without it the browser has no batch to hang a timeline off.
    A failure yields nothing rather than emptying the list.
    """
    import asyncio

    def _fetch() -> dict[str, dict]:
        try:
            documents = (
                interview_invite.interviews_collection(settings)
                .where("recruiterId", "==", uid)
                .get()
            )
        except Exception as exc:  # noqa: BLE001 - a convenience field, never fatal
            logger.warning(
                "could not read interviews for %s: %s", uid, type(exc).__name__
            )
            return {}
        return {d.id: (d.to_dict() or {}) for d in documents}

    return await asyncio.to_thread(_fetch)


async def _recruiter_pending_invites(
    settings, uid: str, already_listed: set[str]
) -> list[dict]:
    """Invites this recruiter has sent that no candidate has opened yet.

    The recruiter-side mirror of `_pending_invites`, for the same reason: a bulk
    invite writes an `interviews` document and nothing else, so until the candidate
    opens their link there is no session row — and a recruiter who just sent ten
    invites sees none of them on the sessions list, which reads as the send having
    silently failed. Same shape as a session row; same best-effort rule.

    Names follow the invite bridge (`{role} — invite`) so a row keeps its name when
    the candidate opens the link and the real session replaces it.
    """
    import asyncio

    def _fetch() -> list[dict]:
        try:
            documents = (
                interview_invite.interviews_collection(settings)
                .where("recruiterId", "==", uid)
                .get()
            )
        except Exception as exc:  # noqa: BLE001 - convenience list, never fatal
            logger.warning(
                "could not read sent invites for %s: %s", uid, type(exc).__name__
            )
            return []

        rows: list[dict] = []
        for document in documents:
            if document.id in already_listed:
                continue
            data = document.to_dict() or {}
            email = data.get("candidateEmail") or data.get("candidateEmailLower") or ""
            role = str(data.get("role") or "").strip()
            # The score off the SHARED record.
            #
            # This was hardcoded to None, and the effect was that an interview a
            # candidate took in the Flutter app showed on the recruiter's web list as
            # "completed" with an empty score column — while the score sat right there
            # on the interview document the row was built from. Web scores are read
            # from the reports collection keyed by session id, and a mobile-run
            # interview has no web session, so it fell through to this branch and lost
            # its number.
            result = data.get("result") if isinstance(data.get("result"), dict) else {}
            rows.append(
                {
                    "id": document.id,
                    "candidate": {
                        "name": data.get("candidateName") or "",
                        "email": email,
                    },
                    "testId": data.get("testId") or None,
                    "templateId": None,
                    "templateName": (f"{role} — invite" if role else None)
                    or data.get("title")
                    or DELETED_TEMPLATE,
                    "track": invite_bridge.track_for(data),
                    "status": (
                        "completed" if data.get("status") == "completed" else "created"
                    ),
                    "createdAt": _iso(data.get("createdAt")),
                    "startedAt": _iso(data.get("startedAt")),
                    "completedAt": _iso(data.get("completedAt")),
                    # Absent stays absent: an unscored interview must show an empty
                    # column, never a 0 that reads as a real result.
                    "overallScore": result.get("overallScore"),
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
    mcq_config: dict | None = None
    mcq_sections: list[dict] = []
    coding_problems_resolved: list[dict] = []
    essay_prompt_resolved: dict | None = None
    if (body.get("track") or template.get("track")) == "mcq":
        # The MCQ paper. Resolved here, WITH its answer key, into the session
        # document — the key stays server-side for the whole interview and the
        # candidate's view is built by an allow-list (see routes/sessions_mcq.py).
        mcq_set = await store.mcq_sets.get(str(template.get("mcqSetId") or ""))
        if not mcq_set:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Template references a missing MCQ set",
            )
        # Completeness enforced at USE, not at save. See routes/mcq_sets.py.
        mcq_faults = mcq_sets_routes.set_faults(mcq_set)
        if mcq_faults:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"That MCQ set is not ready. {mcq_faults[0]}",
            )
        # The set belongs to one recruiter, so a template may only point at a set
        # its own recruiter owns. Without this, a template id plus somebody else's
        # set id would read a paper — and its answers — across the boundary.
        if mcq_set.get("recruiterId") not in (None, "", user.uid):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Template references an MCQ set owned by another recruiter",
            )
        # Fresh question ids, for the same reason the fixed track uses them: editing
        # the set later must not reach back into a finished assessment. Options keep
        # THEIR ids, because the stored answers reference them.
        questions = [
            {**question, "id": str(uuid.uuid4())}
            for question in mcq_set["questions"]
        ]
        mcq_config = {**(template.get("mcqConfig") or {})}
        # The section manifest travels with the paper into the session, for the same
        # reason the questions do: editing the assessment later must not reach back
        # into an interview somebody has already sat. Section ids are kept as they
        # are - the questions reference them, exactly as options keep their ids.
        mcq_sections = [dict(section) for section in mcq_set.get("sections") or []]
    elif (body.get("track") or template.get("track")) == "coding":
        # The coding problems, resolved here WITH their hidden test cases and
        # expected outputs, into the session document. Same reasoning as the MCQ
        # paper above: the answer stays server-side for the whole assessment and the
        # candidate's view is built by an allow-list (see routes/sessions_coding.py).
        #
        # Copied INTO the session rather than referenced, so editing a problem later
        # cannot reach back into an assessment somebody has already sat — the same
        # rule the MCQ questions follow, and the reason they are copied too.
        wanted = template.get("codingProblemIds") or []
        if not isinstance(wanted, list) or not wanted:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Template references no coding problems",
            )
        for problem_id in [str(x) for x in wanted]:
            problem = await store.coding_problems.get(problem_id)
            if not problem:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Template references a missing coding problem",
                )
            # A template may only point at a problem its own recruiter owns.
            # Without this, a template id plus somebody else's problem id would
            # read a problem — and its hidden tests — across the boundary.
            if problem.get("recruiterId") not in (None, "", user.uid):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Template references a coding problem owned by another recruiter",
                )
            faults = coding_problems.problem_faults(problem)
            if faults:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f'"{problem.get("title") or problem_id}" is not ready. {faults[0]}',
                )
            coding_problems_resolved.append(dict(problem))
    elif (body.get("track") or template.get("track")) == "essay":
        # Copied INTO the session, like the coding problems and the MCQ paper and
        # for the same reason: editing a prompt afterwards must not reach back into
        # an essay somebody has already sat. It also carries `guidanceMd`, which is
        # the recruiter's private marking note — safe here because a `web_`
        # collection is unreachable by any client, and the candidate's view is
        # built by `essay_prompts.public_prompt` rather than filtered at the edge.
        prompt_id = str(template.get("essayPromptId") or "")
        if not prompt_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Template references no essay prompt"
            )
        prompt = await store.essay_prompts.get(prompt_id)
        if not prompt:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"Essay prompt {prompt_id} no longer exists"
            )
        faults = essay_prompts.essay_faults(prompt)
        if faults:
            # Refused at creation rather than discovered by the candidate. A prompt
            # nobody could satisfy is worse than a missing one: they find out after
            # writing.
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f'"{prompt.get("title") or prompt_id}" is not ready. {faults[0]}',
            )
        essay_prompt_resolved = dict(prompt)
    elif template.get("questionSource") == "fixed":
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
    track = body.get("track") or template.get("track")

    # ── the shared assignment record ─────────────────────────────────────────
    #
    # A recruiter-created session used to exist ONLY in `web_sessions`: no
    # `interviews/{id}` document, so no `viaInvite` flag, so `sync_result` returned
    # early and the whole interview — score included — was invisible to the mobile
    # app. A recruiter who created sessions from a template in the browser could not
    # see any of them on their phone.
    #
    # The session id IS the interview id, matching what the invite bridge already
    # does. One id for one interview is what makes the two records addressable as one
    # thing from either client, and it is why `sync_result` no longer needs a flag to
    # know where to write.
    session_id = str(uuid.uuid4())
    await _record_assignment(
        settings,
        interview_id=session_id,
        user=user,
        template=template,
        track=track,
        candidate_email=email,
        candidate_name=candidate.get("name"),
    )

    session = {
        "id": session_id,
        "templateId": template["id"],
        "recruiterId": user.uid,
        "track": track,
        "candidate": {"name": candidate.get("name") or "Candidate", "email": email},
        "status": "created",
        "questions": questions,
        "currentIndex": 0,
        "createdAt": now,
        "integrityEvents": [],
        "tabSwitchCount": 0,
    }
    if mcq_config is not None:
        session["mcqConfig"] = mcq_config
    if mcq_sections:
        session["mcqSections"] = mcq_sections
    if coding_problems_resolved:
        # Inline, with the hidden tests. A `web_` collection is unreachable by any
        # client (see store/db.py), so this is the same protection the MCQ answer
        # key already relies on — and the candidate's view is projected by an
        # allow-list rather than filtered here.
        session["codingProblems"] = coding_problems_resolved
    if essay_prompt_resolved:
        session["essayPrompt"] = essay_prompt_resolved
    await store.sessions.put(session)
    return {"id": session["id"]}


async def _record_assignment(
    settings,
    *,
    interview_id: str,
    user: AuthedUser,
    template: dict,
    track: str,
    candidate_email: str,
    candidate_name: str | None,
) -> None:
    """Write the shared `interviews/{id}` document for a recruiter-created session.

    Best-effort: a failure here must not deny the recruiter their session, which is
    the thing they asked for and which still runs entirely from `web_sessions`. The
    cost of a failure is that this one interview stays web-only, which is exactly the
    status quo it is replacing.

    **The test id is the interview id**, deliberately. A standalone session is not a
    batch, and inventing a separate `testId` for it would put an extra layer of
    indirection on a single assignment. Mobile already has this convention: interviews
    created before `testId` existed group under their OWN id, and both
    `TestSummary.fromInterview` and `backfillTests` fall back to `i.id` for exactly
    that case. So a single web session lands on the mobile dashboard as a
    one-candidate test, using a rule that client already understands.
    """
    import asyncio

    from firebase_admin import firestore as admin_firestore

    from app import interviews
    from app.web.services import users

    role = str(template.get("role") or "").strip() or "this role"
    label = interviews.mode_label(track)
    recruiter_name = await users.get_display_name(settings, user.uid)

    document = interviews.build_assignment(
        test_id=interview_id,
        recruiter_id=user.uid,
        recruiter_email=user.email or "",
        recruiter_name=recruiter_name,
        candidate_email=candidate_email,
        candidate_name=(candidate_name or "").strip() or None,
        title=f"{role} — {label} interview",
        mode=track,
        server_timestamp=admin_firestore.SERVER_TIMESTAMP,
    )

    def _write() -> None:
        interviews.collection(settings).document(interview_id).set(document)

    try:
        await asyncio.to_thread(_write)
    except Exception as exc:  # noqa: BLE001 - never deny the recruiter their session
        logger.error(
            "could not record interviews/%s for a recruiter-created session "
            "(the session still runs, but stays invisible to the mobile app): %s",
            interview_id,
            exc,
        )
        return

    await interview_invite.ensure_test_summary(
        settings,
        test_id=interview_id,
        recruiter_id=user.uid,
        role=role,
        mode=track,
    )


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
    assigned = await _candidate_interviews(settings, email)

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
            # What the candidate is told, or None. The ENTIRE candidate-facing result:
            # outcome, an optional rank, an optional note the recruiter wrote for them.
            #
            # Never a score. `candidate_result_view` is an allowlist, not a filter, so
            # the recruiter's evaluation — the number, the AI's verdict, its summary,
            # its list of this person's weaknesses — cannot reach here even as new
            # fields are added to `result`. See app/interviews.py.
            "outcome": interviews.candidate_result_view(
                assigned.get(session.get("id") or "") or {}
            ),
            # Which KIND of round this is, so the client can route.
            #
            # A résumé round is a submission step, not a session anyone joins — routing
            # it into the interview engine drops the candidate into a chat with no
            # questions, which is exactly the failure the MCQ gate exists to stop on the
            # other client.
            "roundKind": (assigned.get(session.get("id") or "") or {}).get("roundKind")
            or None,
            "conclusion": interviews.candidate_conclusion_view(
                assigned.get(session.get("id") or "") or {}
            ),
            # Pipeline membership, so the browser can group a candidate's rounds
            # the way the phone does. See the note on the other mapper.
            "pipelineId": (assigned.get(session.get("id") or "") or {}).get("testId")
            or None,
            "roundOrder": (assigned.get(session.get("id") or "") or {}).get("roundOrder"),
            "roundTitle": (assigned.get(session.get("id") or "") or {}).get("roundTitle")
            or None,
            # The ROUND's format, which on a multi-round pipeline can differ from
            # the session's own `track` — a chat round followed by a video one.
            "roundKind": (assigned.get(session.get("id") or "") or {}).get("roundKind")
            or None,
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
    # The shared assignments, for `testId` — a web session does not carry it.
    assigned = await _recruiter_interviews(settings, user.uid)

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
            # Which BATCH this belongs to. The web had no concept of a test at all —
            # mobile's whole recruiter dashboard is tests — so a timeline had nothing
            # to hang off. Read from the shared assignment, because a web session does
            # not carry it.
            "testId": (assigned.get(session.get("id") or "") or {}).get("testId") or None,
            # Where in the pipeline this row sits. The recruiter list stores one
            # row per candidate PER ROUND, so without an order the same person
            # appears several times, scattered by createdAt, with nothing on the
            # row naming which round it was — the confusion the Flutter client
            # fixed with groupRoundsByCandidate.
            "roundOrder": (assigned.get(session.get("id") or "") or {}).get("roundOrder"),
            "roundTitle": (assigned.get(session.get("id") or "") or {}).get("roundTitle")
            or None,
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

    # Plus every invite whose candidate has not opened their link yet — those have no
    # session row, and without them a freshly-sent batch looks like it went nowhere.
    items.extend(
        await _recruiter_pending_invites(settings, user.uid, {i["id"] for i in items})
    )

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

    # Generate the question plan HERE, not at /begin.
    #
    # This is the only moment before the interview where the candidate already
    # expects to wait — they have just handed over a file and the screen says so.
    # Generating at /begin instead put a multi-second model call behind a button
    # press that looks instantaneous: one production session sat on a dead "Begin"
    # button for 26.5s on a warm instance.
    #
    # Done inside the request rather than as a background task on purpose. A
    # fire-and-forget task belongs to one replica's event loop, so it is lost when
    # that instance is recycled and invisible to the instance that serves the next
    # request. Everything here is persisted before the response, which is what lets
    # any replica serve /begin — the property that matters under autoscaling.
    #
    # Never fatal: _generate_adaptive_questions falls back to a generic set rather
    # than raising, and /begin still generates if this somehow left none. A résumé
    # that uploaded fine must not fail because a model call did.
    if template.get("questionSource") == "adaptive" and not (session.get("questions") or []):
        session["questions"] = await _generate_adaptive_questions(
            settings, session, template
        )

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

    # Fallback only. The question plan is normally built when the résumé is uploaded
    # (see upload_resume) precisely so this path does not make the candidate wait on
    # a model call after pressing Begin. This still covers a session whose résumé
    # predates that change, or whose generation was interrupted.
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
    await _force_complete(settings, session, template)
    return _state(session, template)


async def _force_complete(settings, session: dict, template: dict) -> None:
    """End a running interview, keeping whatever the candidate had written.

    Shared by /complete and the tab-switch limit. A candidate cut off mid-answer
    has still answered, and the two paths discarding drafts differently would be
    a bug nobody notices until someone's work disappears.
    """
    if session.get("status") != "in_progress":
        return

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

    count = session.get("tabSwitchCount") or 0
    maximum = integrity.get("maxTabSwitchWarnings")
    terminated = False

    # Enforce the recruiter's limit. This used to only count: a candidate could
    # sit on "Recorded 4 of 3 allowed" and keep going, which made the limit a
    # decoration. It is enforced HERE rather than in the browser because a check
    # the client owns is bypassable by exactly the candidate it exists to stop.
    #
    # Two guard rails, both deliberate:
    #   * an unset or zero maximum means "count, do not enforce" — the previous
    #     behaviour, and the safe reading of a mis-saved template. Treating 0 as
    #     "terminate immediately" would end every interview on the first blur.
    #   * only tab-switch events count toward it. A blocked paste is logged, not
    #     punished under a limit that is not about pasting.
    if (
        isinstance(maximum, int)
        and maximum > 0
        and event_type in ("tab_switch", "window_blur")
        and count > maximum
        and session.get("status") == "in_progress"
    ):
        if session.get("track") in ("chatbot", "video_avatar"):
            _finish_conversation(session)
            await session_store.save(settings, session)
            await session_store.maybe_score(settings, session, template)
        else:
            await _force_complete(settings, session, template)
        terminated = True
        logger.warning(
            "session %s ended: %s tab switches against a limit of %s", session_id, count, maximum
        )

    return {
        "ok": True,
        "tabSwitchWarnings": count,
        "maxTabSwitchWarnings": maximum,
        # The client needs to know so it can say the interview has ended rather
        # than inviting the candidate back into one that is over.
        "terminated": terminated,
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
    """Owner-only. A candidate never sees a score or any feedback.

    An interview the candidate took in the FLUTTER app has no web session — the engine
    here never ran — so this used to 404 for it, even though the score and the full
    report were sitting in the shared record the whole time. A recruiter who ran a
    batch on their phone could not open a single one of those reports in the browser.
    `_report_from_shared_record` serves those from `interviews/{id}` + `reports/{id}`.
    """
    settings = settings_of(request)
    store = get_store(settings)
    try:
        session, template = await session_store.load(settings, session_id, user)
    except NotFound:
        return await _report_from_shared_record(settings, session_id, user)
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
        # The coding track is scored by arithmetic on the judge's verdicts, not by
        # a model writing a report, so its breakdown is composed here from the
        # session's own durable record rather than read from reports/{id}.
        **(
            {"coding": coding_scoring.recruiter_report(session)}
            if session.get("track") == "coding"
            else {}
        ),
    }


async def _report_from_shared_record(settings, interview_id: str, user: AuthedUser) -> dict:
    """A report for an interview this surface never ran.

    Same response shape, sourced from the records both clients share:

      interviews/{id}    who, what role, which track, when — the assignment
      reports/{id}       the per-question breakdown, written by whichever scorer ran

    This is not a second report model. `reports/{interviewId}` is the SAME collection
    and the same document the web scorer writes to; the only difference is that the
    session metadata comes off the assignment instead of off a `web_sessions` row that
    does not exist. That is what makes the score and the detail identical whichever
    client produced them.

    404 for a caller who does not own it, matching the rest of this surface — a
    response never confirms that a record they cannot see exists.
    """
    import asyncio

    from app import interviews as shared_interviews
    from app import reports as shared_reports

    def _read_interview() -> dict | None:
        snapshot = shared_interviews.collection(settings).document(interview_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    data = await asyncio.to_thread(_read_interview)
    if not data:
        raise NotFound("Session")
    if str(data.get("recruiterId") or "") != user.uid:
        raise NotFound("Session")

    def _read_report() -> dict | None:
        snapshot = shared_reports.collection(settings).document(interview_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    stored_report = await asyncio.to_thread(_read_report)

    # Falls back to the flat `interviews.result` when no report document exists —
    # an interview scored before reports were shared, or one whose detail write failed.
    # The score is the part that must never be missing.
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    if stored_report is None and result:
        stored_report = {
            "sessionId": interview_id,
            "interviewId": interview_id,
            "overallScore": result.get("overallScore"),
            "summary": result.get("summary") or "",
            "recommendation": result.get("recommendation") or "",
            "strengths": result.get("strengths") or [],
            "improvements": result.get("improvements") or [],
            "perQuestion": [],
        }

    return {
        "session": {
            "id": interview_id,
            "candidate": {
                "name": data.get("candidateName") or "",
                "email": data.get("candidateEmail") or data.get("candidateEmailLower") or "",
            },
            "templateName": data.get("title") or DELETED_TEMPLATE,
            "track": invite_bridge.track_for(data),
            "status": data.get("status") or "created",
            "createdAt": _iso(data.get("createdAt")),
            "startedAt": _iso(data.get("startedAt")),
            "completedAt": _iso(data.get("completedAt")),
            # The questions as ASSIGNED. The mobile runtime keeps its answers on
            # `result.responses`, not in the per-question shape this view renders, so
            # the breakdown comes from the report document where there is one.
            "questions": [
                {"id": None, "text": text, "category": None}
                for text in (data.get("questions") or [])
                if isinstance(text, str) and text.strip()
            ],
            # Integrity monitoring is a web-runtime feature; an interview taken on the
            # phone genuinely has none, and claiming zero events would read as "clean"
            # rather than "not measured".
            "integrityEvents": [],
            "tabSwitchCount": 0,
        },
        # The rubric lives on a web template, which an interview from the app never
        # had. Null rather than a default: a fabricated rubric would make the report
        # look scored against criteria nobody set.
        "rubric": None,
        "report": stored_report,
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
        session, template, model=settings.web_live_model_name
    )
    token = await GeminiClient(settings).mint_live_token(
        setup,
        session_minutes=voice_setup.session_minutes(
            template,
            settings.gemini_token_expiry_buffer_minutes,
            question_count=len(session.get("questions") or []),
        ),
    )

    return {
        "token": token.token,
        "wsUrl": token.ws_url,
        "model": token.model,
        "expiresAt": rfc3339(token.expires_at),
        "connectBy": rfc3339(token.connect_by),
        "totalQuestions": len(session.get("questions") or []),
        # ADDITIVE. The browser runs a local, display-only live captioner (Web Speech
        # API) so the candidate sees their words the moment they say them — Google's
        # authoritative transcription arrives only at the end of the turn. This is the
        # locale that captioner should listen in: the first (most specific) of the same
        # language hints the recogniser itself was given.
        "language": speech.transcription_languages(
            (template.get("voice") or {}).get("language")
        )[0],
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

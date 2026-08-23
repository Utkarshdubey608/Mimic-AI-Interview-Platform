"""Multi-round pipelines — ports `server/routes/pipelines.ts`.

Owner-scoped, like invite-email templates: `recruiterId` is server-stamped and a
cross-owner read answers 404.

Each round a candidate enters is a real `interviews/{id}` document, so it reuses the
same take-link, claim and scoring path as a single-round invite. Progress lives in
`web_pipeline_candidates`, with an append-only `history` that is the audit trail for
every move.

**The batch routes are deliberately partial-success.** `/advance` and `/not-advancing`
act on several candidates, and each one's work — a status change, an interview
document, an email that has already left — cannot be rolled back once done. So a
failure for one candidate becomes a row in `results` rather than an aborted request,
and the response is always 200 with whatever actually happened. Aborting midway would
leave earlier candidates advanced with the recruiter told the whole thing failed.

See `app.web.services.pipeline_board` for the rules; this file is storage and email.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, HTTPException, Query, Request, Response, status

from app.security import AuthedUser
from app.web.deps import NotFound, WebUser, settings_of
from app.web.services import interview_invite, pipeline_board, users
from app.web.shared import invite_email
from app.web.store import get_store

logger = logging.getLogger("web.pipelines")

router = APIRouter(prefix="/pipelines", tags=["web:pipelines"])

WHAT = "Pipeline"
CANDIDATE = "Candidate"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def load_owned(request: Request, pipeline_id: str, user: AuthedUser) -> dict:
    """A pipeline this recruiter owns, or 404 (no existence leak)."""
    store = get_store(settings_of(request))
    found = await store.pipelines.get(pipeline_id)
    if not found or str(found.get("recruiterId") or "") != user.uid:
        raise NotFound(WHAT)
    return found


async def load_candidate(request: Request, pipeline: dict, candidate_id: str, user: AuthedUser) -> dict:
    """One candidate of this pipeline, owned by this recruiter, or 404.

    All three conditions are checked: a candidate id from another pipeline or another
    recruiter must not be actionable just because the caller owns *a* pipeline.
    """
    store = get_store(settings_of(request))
    found = await store.pipeline_candidates.get(candidate_id)
    if (
        not found
        or found.get("pipelineId") != pipeline.get("id")
        or str(found.get("recruiterId") or "") != user.uid
    ):
        raise NotFound(CANDIDATE)
    return found


async def resolve_template(
    request: Request, body: dict, user: AuthedUser, kind: str
) -> dict:
    """The email template for a transition.

    `kind` is REQUIRED, with no default: sending the invite copy for a rejection would
    tell a candidate they had been invited to an interview that does not exist.
    """
    store = get_store(settings_of(request))
    seed = invite_email.default_template_for(kind)
    stamped = {"id": "inline", "recruiterId": user.uid, **seed}

    inline = body.get("emailConfig")
    if isinstance(inline, dict):
        return {**stamped, **inline}

    template_id = body.get("emailTemplateId")
    if isinstance(template_id, str) and template_id:
        found = await store.invite_email_templates.get(template_id)
        if not found or str(found.get("recruiterId") or "") != user.uid:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Email template not found")
        return found

    return stamped


async def round_questions(request: Request, round_def: dict) -> list[str]:
    """The fixed questions for a round, or empty for a tailored one.

    Tailored rounds generate per candidate after a résumé upload, so an empty list here
    is correct rather than missing.
    """
    if round_def.get("source") != "set" or not round_def.get("questionSetId"):
        return []
    store = get_store(settings_of(request))
    question_set = await store.question_sets.get(str(round_def["questionSetId"]))
    if not question_set:
        return []
    return [q["text"] for q in question_set.get("questions") or [] if q.get("text")]


def _company(template: dict) -> str:
    return (template.get("branding") or {}).get("companyName") or "Mimic"


def _from_name(template: dict) -> str:
    return (template.get("sender") or {}).get("fromName") or "Mimic"


# ── CRUD ──────────────────────────────────────────────────────────────────────



def _assert_writable(settings) -> None:
    """Refuse a write once the pipeline model has been retired.

    Rounds replaced it (`tests/{testId}/rounds`), and this is the switch that ends the
    parallel-running period. READS are untouched on purpose: a recruiter part-way
    through a hire should not lose sight of a pipeline they are running just because
    nothing new can be added to it.

    410 rather than 404: the route exists and the resource exists, it is the CAPABILITY
    that is gone — and a 404 would read as "your pipeline was deleted", which is the one
    thing that has not happened.
    """
    if settings.pipelines_writable:
        return
    raise HTTPException(
        status.HTTP_410_GONE,
        "Pipelines have been replaced by round timelines. Your existing pipelines are "
        "still here to read; create new rounds from a test's Timeline instead.",
    )


@router.get("", summary="This recruiter's pipelines")
async def list_pipelines(
    request: Request, role: str = Query(default=""), user: AuthedUser = WebUser
) -> list[dict]:
    store = get_store(settings_of(request))
    mine = await store.pipelines.owned_by(user.uid)
    if role:
        mine = [p for p in mine if p.get("role") == role]
    # Newest first, matching the list page's ordering.
    return sorted(mine, key=lambda p: str(p.get("createdAt") or ""), reverse=True)


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a pipeline")
async def create_pipeline(
    request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    _assert_writable(settings_of(request))
    store = get_store(settings_of(request))
    now = _now()
    created = {
        "id": str(uuid.uuid4()),
        "recruiterId": user.uid,
        "createdAt": now,
        "updatedAt": now,
        **pipeline_board.normalise(body),
    }
    await store.pipelines.put(created)
    return created


@router.get("/{pipeline_id}", summary="One pipeline")
async def get_pipeline(
    pipeline_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    return await load_owned(request, pipeline_id, user)


@router.put("/{pipeline_id}", summary="Replace a pipeline's definition")
async def update_pipeline(
    pipeline_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    _assert_writable(settings_of(request))
    store = get_store(settings_of(request))
    existing = await load_owned(request, pipeline_id, user)

    updated = {
        **existing,
        **pipeline_board.normalise(body),
        "id": existing["id"],
        "recruiterId": existing["recruiterId"],
        "createdAt": existing.get("createdAt"),
        "updatedAt": _now(),
    }
    await store.pipelines.put(updated)
    return updated


@router.delete(
    "/{pipeline_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a pipeline"
)
async def delete_pipeline(
    pipeline_id: str, request: Request, user: AuthedUser = WebUser
) -> Response:
    _assert_writable(settings_of(request))
    await load_owned(request, pipeline_id, user)
    store = get_store(settings_of(request))
    # The candidate records are left in place deliberately: they carry the audit trail
    # for people who were really interviewed, and deleting a pipeline definition should
    # not erase the record of what was done to them.
    await store.pipelines.delete(pipeline_id)
    logger.info("pipeline %s deleted by %s", pipeline_id, user.uid)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── the board ─────────────────────────────────────────────────────────────────


@router.get("/{pipeline_id}/board", summary="Kanban board for a pipeline")
async def board(pipeline_id: str, request: Request, user: AuthedUser = WebUser) -> dict:
    settings = settings_of(request)
    store = get_store(settings)
    pipeline = await load_owned(request, pipeline_id, user)

    candidates = [
        candidate
        for candidate in await store.pipeline_candidates.owned_by(user.uid)
        if candidate.get("pipelineId") == pipeline_id
    ]

    # Reports and sessions are fetched up front, concurrently: the board reads one of
    # each per candidate, and at roughly 60ms per Firestore round trip a sequential
    # loop over thirty candidates would take a visible two seconds.
    interview_ids = [
        interview_id
        for interview_id in (
            pipeline_board.current_interview_id(candidate) for candidate in candidates
        )
        if interview_id
    ]
    reports, sessions = await asyncio.gather(
        asyncio.gather(*(store.reports.get(i) for i in interview_ids)),
        asyncio.gather(*(store.sessions.get(i) for i in interview_ids)),
    )
    report_by_id = dict(zip(interview_ids, reports))
    session_by_id = dict(zip(interview_ids, sessions))

    return pipeline_board.build_board(
        pipeline,
        candidates,
        lambda i: report_by_id.get(i),
        lambda i: (session_by_id.get(i) or {}).get("status"),
    )


# ── round 1 ───────────────────────────────────────────────────────────────────


@router.post(
    "/{pipeline_id}/invite",
    status_code=status.HTTP_201_CREATED,
    summary="Invite candidates into round 1",
)
async def invite_round_one(
    pipeline_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    from firebase_admin import firestore as admin_firestore

    settings = settings_of(request)
    store = get_store(settings)
    pipeline = await load_owned(request, pipeline_id, user)

    candidates = body.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no candidates")

    first_round = (pipeline.get("rounds") or [{}])[0]
    template = await resolve_template(request, body, user, "invite")
    questions = await round_questions(request, first_round)

    send_emails = body.get("sendEmails") is not False
    origin = str(body.get("origin") or "").strip()
    now = _now()
    test_id = str(uuid.uuid4())
    collection = interview_invite.interviews_collection(settings)
    recruiter_name = await users.get_display_name(settings, user.uid)

    # Enrolling into a pipeline is a batch like any other, so it gets the metadata
    # document the mobile recruiter dashboard pages over. Best-effort; never raises.
    await interview_invite.ensure_test_summary(
        settings,
        test_id=test_id,
        recruiter_id=user.uid,
        role=str(pipeline.get("role") or ""),
        mode=first_round.get("mode") or "chat",
    )

    created: list[dict] = []
    emailed = 0
    dry_run = False

    for entry in candidates:
        if not isinstance(entry, dict) or not (entry.get("email") or "").strip():
            continue
        email = entry["email"].strip()
        role = (entry.get("role") or pipeline.get("role") or "").strip()
        candidate_id = str(uuid.uuid4())

        document = interview_invite.build_document(
            test_id=test_id,
            recruiter_id=user.uid,
            recruiter_email=user.email or "",
            recruiter_name=recruiter_name,
            candidate_email=email,
            role=role,
            mode=first_round.get("mode") or "chat",
            questions=questions,
            source=first_round.get("source"),
            config=first_round.get("config"),
            question_set_id=first_round.get("questionSetId"),
            # The back-reference the board and the advance routes navigate by.
            pipeline={
                "pipelineId": pipeline_id,
                "roundIndex": 0,
                "pipelineCandidateId": candidate_id,
            },
            server_timestamp=admin_firestore.SERVER_TIMESTAMP,
        )
        reference = (await asyncio.to_thread(collection.add, document))[1]
        link = interview_invite.interview_link(origin, reference.id)
        row: dict = {"id": reference.id, "email": email, "link": link}

        if send_emails:
            invite = await interview_invite.send_invite_email(
                settings,
                template=template,
                to_email=email,
                link=link,
                interview_id=reference.id,
                variables=interview_invite.render_vars(
                    candidate_email=email,
                    role=role,
                    recruiter_name=_from_name(template),
                    company=_company(template),
                    deadline=template.get("deadlineText") or "",
                ),
            )
            row["sent"] = invite["status"] == "accepted"
            row["status"] = invite["status"]
            if invite.get("error"):
                row["error"] = invite["error"]
            if row["sent"]:
                emailed += 1
            dry_run = dry_run or "dry-run" in (invite.get("error") or "")
            await asyncio.to_thread(reference.update, {"invite": invite})

        await store.pipeline_candidates.put(
            pipeline_board.build_candidate(
                pipeline_id=pipeline_id,
                recruiter_id=user.uid,
                candidate_email=email,
                role=role,
                interview_id=reference.id,
                now=now,
                candidate_id=candidate_id,
            )
        )
        created.append(row)

    if not created:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no candidates")

    return {
        "pipelineId": pipeline_id,
        "created": created,
        "emailed": emailed,
        "dryRun": dry_run,
    }


# ── advancement ───────────────────────────────────────────────────────────────


@router.post("/{pipeline_id}/advance", summary="Advance candidates to the next round")
async def advance(
    pipeline_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    """Move candidates forward, or to the terminal `selected` status.

    `targetRoundIndex` equal to the round count means selection: no new interview is
    created, only a terminal email. Partial success by design — see the module
    docstring.
    """
    _assert_writable(settings_of(request))
    settings = settings_of(request)
    pipeline = await load_owned(request, pipeline_id, user)
    rounds = pipeline.get("rounds") or []

    candidate_ids = body.get("candidateIds")
    target = body.get("targetRoundIndex")
    if not isinstance(candidate_ids, list) or not candidate_ids or not isinstance(target, int):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "candidateIds and targetRoundIndex required"
        )

    is_selection = target >= len(rounds)
    template = await resolve_template(
        request, body, user, "selected" if is_selection else "advance"
    )
    send_emails = body.get("sendEmails") is not False
    basis = str(body.get("basis") or "manual")
    origin = str(body.get("origin") or "").strip()

    results = []
    for candidate_id in candidate_ids:
        results.append(
            await _advance_one(
                request,
                settings,
                pipeline=pipeline,
                candidate_id=str(candidate_id),
                target=target,
                template=template,
                send_emails=send_emails,
                basis=basis,
                origin=origin,
                user=user,
            )
        )

    return {"pipelineId": pipeline_id, "results": results}


async def _advance_one(
    request: Request,
    settings,
    *,
    pipeline: dict,
    candidate_id: str,
    target: int,
    template: dict,
    send_emails: bool,
    basis: str,
    origin: str,
    user: AuthedUser,
) -> dict:
    """One candidate's advance, isolated. Never raises.

    Isolated because the work is not reversible: by the time a later candidate fails,
    this one's interview document exists and their email has left. An exception here
    would discard the record of that while the mail is already in flight.
    """
    from firebase_admin import firestore as admin_firestore

    rounds = pipeline.get("rounds") or []
    is_selection = target >= len(rounds)
    to_round: object = "selected" if is_selection else target
    email = ""

    try:
        store = get_store(settings)
        candidate = await load_candidate(request, pipeline, candidate_id, user)
        email = candidate.get("candidateEmail") or ""

        interview_id = pipeline_board.current_interview_id(candidate)
        report = await store.reports.get(interview_id) if interview_id else None
        scored = pipeline_board.is_scored(report)
        pipeline_board.assert_advanceable(candidate, target, len(rounds), scored)

        now = _now()
        score_text = str(report.get("overallScore")) if scored else ""

        if is_selection:
            # Terminal: no interview document, email only. A link here would send them
            # back into an interview they have finished.
            sent = False
            error = None
            if send_emails:
                invite = await interview_invite.send_invite_email(
                    settings,
                    template=template,
                    to_email=email,
                    link="",
                    interview_id=candidate_id,
                    kind="selected",
                    variables=interview_invite.transition_vars(
                        candidate_email=email,
                        role=candidate.get("role") or "",
                        recruiter_name=_from_name(template),
                        company=_company(template),
                        score=score_text,
                    ),
                )
                sent = invite["status"] == "accepted"
                error = invite.get("error")

            candidate["status"] = pipeline_board.SELECTED
            candidate["updatedAt"] = now
            candidate.setdefault("history", []).append(
                {
                    "at": now,
                    "byUid": user.uid,
                    "action": "selected",
                    "fromRound": candidate.get("currentRoundIndex"),
                    "basis": basis,
                    "emailResult": pipeline_board.email_result(sent, send_emails),
                }
            )
            await store.pipeline_candidates.put(candidate)
            return {
                "pipelineCandidateId": candidate_id,
                "email": email,
                "toRound": "selected",
                "sent": sent,
                **({"error": error} if error else {}),
            }

        # A real next round: create its interview, then send the advance email.
        round_def = rounds[target]
        questions = await round_questions(request, round_def)
        collection = interview_invite.interviews_collection(settings)

        # DELIBERATELY no `ensure_test_summary` here, unlike the enrolment path above.
        #
        # This mints a fresh testId PER ADVANCED CANDIDATE, so writing a metadata
        # document for each would put one single-candidate "test" on the mobile
        # dashboard for every person advanced — twenty advances, twenty junk rows.
        # That is worse than the current invisibility, not better.
        #
        # The real defect is upstream: a web pipeline round is not modelled as a round
        # at all, so its interviews cannot group under the test they belong to. Fixing
        # THAT is Phase 10 (rounds convergence), where a pipeline's rounds become
        # `tests/{testId}/rounds/{roundId}` and every round's assignments share the
        # pipeline's own test. See Documents/WEB_MOBILE_CONSISTENCY_PLAN.md.
        document = interview_invite.build_document(
            test_id=str(uuid.uuid4()),
            recruiter_id=user.uid,
            recruiter_email=user.email or "",
            recruiter_name=await users.get_display_name(settings, user.uid),
            candidate_email=email,
            role=candidate.get("role") or "",
            mode=round_def.get("mode") or "chat",
            questions=questions,
            source=round_def.get("source"),
            config=round_def.get("config"),
            question_set_id=round_def.get("questionSetId"),
            pipeline={
                "pipelineId": pipeline.get("id"),
                "roundIndex": target,
                "pipelineCandidateId": candidate_id,
            },
            server_timestamp=admin_firestore.SERVER_TIMESTAMP,
        )
        reference = (await asyncio.to_thread(collection.add, document))[1]
        link = interview_invite.interview_link(origin, reference.id)

        sent = False
        error = None
        if send_emails:
            previous = rounds[candidate.get("currentRoundIndex") or 0]
            invite = await interview_invite.send_invite_email(
                settings,
                template=template,
                to_email=email,
                link=link,
                interview_id=reference.id,
                kind="advance",
                variables=interview_invite.transition_vars(
                    candidate_email=email,
                    role=candidate.get("role") or "",
                    recruiter_name=_from_name(template),
                    company=_company(template),
                    round_name=round_def.get("name") or "",
                    previous_round_name=previous.get("name") or "",
                    score=score_text,
                ),
            )
            sent = invite["status"] == "accepted"
            error = invite.get("error")
            await asyncio.to_thread(reference.update, {"invite": invite})

        candidate.setdefault("perRound", []).append(
            {"roundIndex": target, "interviewId": reference.id, "invitedAt": now}
        )
        candidate.setdefault("history", []).append(
            {
                "at": now,
                "byUid": user.uid,
                "action": "advanced",
                "fromRound": candidate.get("currentRoundIndex"),
                "toRound": target,
                "basis": basis,
                "emailResult": pipeline_board.email_result(sent, send_emails),
            }
        )
        candidate["currentRoundIndex"] = target
        candidate["status"] = pipeline_board.IN_ROUND
        candidate["updatedAt"] = now
        await store.pipeline_candidates.put(candidate)

        return {
            "pipelineCandidateId": candidate_id,
            "email": email,
            "toRound": target,
            "sent": sent,
            **({"error": error} if error else {}),
        }

    except HTTPException as exc:
        return {
            "pipelineCandidateId": candidate_id,
            "email": email,
            "toRound": to_round,
            "error": exc.detail if isinstance(exc.detail, str) else "Failed",
        }
    except Exception as exc:  # noqa: BLE001 - one candidate must not sink the batch
        logger.error("advance failed for %s: %s", candidate_id, exc)
        return {
            "pipelineCandidateId": candidate_id,
            "email": email,
            "toRound": to_round,
            "error": str(exc)[:200],
        }


@router.post("/{pipeline_id}/not-advancing", summary="Move candidates out of the pipeline")
async def not_advancing(
    pipeline_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    """Mark candidates as not advancing.

    The rejection email is **OFF unless explicitly requested**. Moving someone out of a
    pipeline is often a working decision a recruiter revisits, and a rejection sent by
    default cannot be recalled.
    """
    _assert_writable(settings_of(request))
    settings = settings_of(request)
    store = get_store(settings)
    pipeline = await load_owned(request, pipeline_id, user)

    candidate_ids = body.get("candidateIds")
    if not isinstance(candidate_ids, list) or not candidate_ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "candidateIds required")

    send_rejection = body.get("sendRejection") is True
    template = (
        await resolve_template(request, body, user, "rejection") if send_rejection else {}
    )

    results = []
    for raw_id in candidate_ids:
        candidate_id = str(raw_id)
        email = ""
        try:
            candidate = await load_candidate(request, pipeline, candidate_id, user)
            email = candidate.get("candidateEmail") or ""
            now = _now()

            sent = False
            error = None
            if send_rejection:
                invite = await interview_invite.send_invite_email(
                    settings,
                    template=template,
                    to_email=email,
                    link="",
                    interview_id=candidate_id,
                    kind="rejection",
                    variables=interview_invite.transition_vars(
                        candidate_email=email,
                        role=candidate.get("role") or "",
                        recruiter_name=_from_name(template),
                        company=_company(template),
                    ),
                )
                sent = invite["status"] == "accepted"
                error = invite.get("error")

            candidate["status"] = pipeline_board.NOT_ADVANCING
            candidate["updatedAt"] = now
            candidate.setdefault("history", []).append(
                {
                    "at": now,
                    "byUid": user.uid,
                    "action": "not_advancing",
                    "fromRound": candidate.get("currentRoundIndex"),
                    "basis": "rejection email" if send_rejection else "no email",
                    "emailResult": pipeline_board.email_result(sent, send_rejection),
                }
            )
            await store.pipeline_candidates.put(candidate)

            results.append(
                {
                    "pipelineCandidateId": candidate_id,
                    "email": email,
                    "toRound": "not_advancing",
                    "sent": sent,
                    **({"error": error} if error else {}),
                }
            )
        except HTTPException as exc:
            results.append(
                {
                    "pipelineCandidateId": candidate_id,
                    "email": email,
                    "toRound": "not_advancing",
                    "error": exc.detail if isinstance(exc.detail, str) else "Failed",
                }
            )
        except Exception as exc:  # noqa: BLE001 - isolated, see the module docstring
            logger.error("not-advancing failed for %s: %s", candidate_id, exc)
            results.append(
                {
                    "pipelineCandidateId": candidate_id,
                    "email": email,
                    "toRound": "not_advancing",
                    "error": str(exc)[:200],
                }
            )

    return {"pipelineId": pipeline_id, "results": results}


@router.post("/{pipeline_id}/move-back", summary="Undo the last advance for one candidate")
async def move_back(
    pipeline_id: str, request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    """Reverse the most recent advance, while the new round is still untouched.

    Refused once the advanced-into round has a report: that round really happened, and
    erasing an assessment a candidate completed is not a correction.
    """
    _assert_writable(settings_of(request))
    settings = settings_of(request)
    store = get_store(settings)
    pipeline = await load_owned(request, pipeline_id, user)

    candidate = await load_candidate(
        request, pipeline, str(body.get("candidateId") or ""), user
    )

    current = candidate.get("currentRoundIndex") or 0
    if current == 0 or candidate.get("status") in (
        pipeline_board.SELECTED,
        pipeline_board.NOT_ADVANCING,
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to move back")

    interview_id = pipeline_board.current_interview_id(candidate)
    if interview_id and await store.reports.get(interview_id):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Current round already completed; cannot move back",
        )

    now = _now()
    if interview_id:
        # Delete the interview document so the link the candidate may already hold
        # stops working, and drop any session or report they materialised by opening
        # it — otherwise a dead link stays resumable and an orphan report lingers for
        # a round that no longer exists.
        try:
            # Resolving the collection is inside the try on purpose: it reaches
            # Firestore, so leaving it outside meant an unreachable backend aborted the
            # whole move-back with a 503 and skipped the local cleanup below — the
            # opposite of what this except clause is here to guarantee.
            collection = interview_invite.interviews_collection(settings)
            await asyncio.to_thread(collection.document(interview_id).delete)
        except Exception as exc:  # noqa: BLE001 - the local cleanup still matters
            logger.warning("could not delete interview %s: %s", interview_id, exc)
        await store.sessions.delete(interview_id)
        await store.reports.delete(interview_id)

    candidate["perRound"] = [
        progress
        for progress in candidate.get("perRound") or []
        if progress.get("roundIndex") != current
    ]
    candidate["currentRoundIndex"] = current - 1
    candidate["status"] = pipeline_board.IN_ROUND
    candidate["updatedAt"] = now
    candidate.setdefault("history", []).append(
        {
            "at": now,
            "byUid": user.uid,
            "action": "moved_back",
            "fromRound": current,
            "toRound": current - 1,
            "basis": "correction",
        }
    )
    await store.pipeline_candidates.put(candidate)

    logger.info(
        "candidate %s moved back from round %d by %s", candidate["id"], current, user.uid
    )
    return {"ok": True}

"""Deciding a round, and releasing it to the candidate.

The recruiter half of the candidate's outcome. Until this existed the web surface could
write `resultPublished` only as `False`, at creation, and never set it true — there was
no publish action at all. A recruiter working in the browser could score an interview
and had no way to tell the candidate anything about it; the only client that could
release a result was the phone.

Everything here mirrors `InterviewRepository` in the Flutter app, which is the more
developed implementation, and three of its decisions are load-bearing rather than
incidental:

**Dotted field paths.** Every write targets `result.outcome`, `result.rank` and so on
rather than replacing the `result` map. That map holds the recruiter's evaluation — the
score, the summary, the strengths, the candidate's raw answers — and a decision about
someone must not destroy the assessment it was based on.

**Ranks are stamped, not computed.** A rank written from a candidate's position in a
ranked list stays put. A rank recomputed whenever someone looked would shift under the
candidate every time anybody else was re-scored.

**Publishing is separate from deciding.** Setting an outcome without publishing lets a
recruiter decide a whole round privately and release it in one go, which is how hiring
actually works.

What the candidate then sees is NOT decided here — it is `interviews.candidate_result_view`,
an allowlist of three fields. See app/interviews.py.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Body, HTTPException, Request, status

from app import evaluation, interviews
from app.security import AuthedUser
from app.web.services import interview_invite
from app.web.deps import NotFound, WebUser, settings_of
from app.web.shared import invite_email
from app.web.store import get_store

logger = logging.getLogger("web.outcomes")

router = APIRouter(prefix="/interviews", tags=["web:outcomes"])

# Firestore hard-caps a batch at 500 writes; stay well under, as every other batched
# write in this codebase does.
BATCH_SIZE = 400

# How many interviews one batch decision may cover. A round of a few hundred is normal;
# a request claiming tens of thousands is a bug or an attack, not a hiring round.
MAX_BATCH = 2_000


def _outcome_or_400(value: object) -> str:
    """Validate an outcome, refusing anything the clients do not agree on.

    Deliberately strict where `interviews.outcome_from_wire` is lenient. Reading an
    unknown value degrades to `pending`, because an old document must still render;
    WRITING one is a caller bug and silently storing it would put a value on the
    document that the mobile client will not display.
    """
    if value in (
        interviews.OUTCOME_SELECTED,
        interviews.OUTCOME_NOT_SELECTED,
        interviews.OUTCOME_PENDING,
    ):
        return str(value)
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        f"outcome must be one of selected, not_selected, pending — got {value!r}",
    )


async def _owned_or_404(settings, interview_id: str, user: AuthedUser) -> dict:
    """The interview, if this recruiter owns it.

    404 rather than 403 for someone else's, matching the rest of this surface: a
    response never confirms that a record the caller cannot see exists.
    """
    if not interview_id:
        raise NotFound("Interview")

    def _read() -> dict | None:
        snapshot = interviews.collection(settings).document(interview_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    data = await asyncio.to_thread(_read)
    if not data or str(data.get("recruiterId") or "") != user.uid:
        raise NotFound("Interview")
    return data


@router.post("/{interview_id}/publish", summary="Release or withhold one result")
async def publish_one(
    interview_id: str,
    request: Request,
    body: dict = Body(default={}),
    user: AuthedUser = WebUser,
) -> dict:
    """Show or hide one candidate's result. Mirrors mobile's `setPublished`.

    This is the ONLY thing that makes a result visible to a candidate, and it is
    deliberately a recruiter action — no automated path writes it, which is why
    `sync_result`, `save_evaluation` and `save_resume_submission` all leave it alone.
    """
    settings = settings_of(request)
    await _owned_or_404(settings, interview_id, user)

    published = bool(body.get("published", True))

    from firebase_admin import firestore as admin_firestore

    def _write() -> None:
        interviews.collection(settings).document(interview_id).update(
            {
                "resultPublished": published,
                "updatedAt": admin_firestore.SERVER_TIMESTAMP,
            }
        )

    await asyncio.to_thread(_write)
    logger.info(
        "%s result for %s by %s",
        "published" if published else "withheld",
        interview_id,
        user.uid,
    )
    return {"id": interview_id, "resultPublished": published}


@router.post("/{interview_id}/outcome", summary="Record what a candidate is told")
async def set_outcome(
    interview_id: str,
    request: Request,
    body: dict = Body(...),
    user: AuthedUser = WebUser,
) -> dict:
    """Set one candidate's outcome, optionally with a rank and a note.

    Written with DOTTED FIELD PATHS so the recruiter's evaluation — score, summary,
    strengths, the raw answers kept for a re-score — survives the decision.

    `rank` and `rankOf` are written as a pair or not at all: a position with no total
    reads as a bare number out of nowhere, and `candidate_result_view` drops a lone
    rank for the same reason.
    """
    settings = settings_of(request)
    await _owned_or_404(settings, interview_id, user)

    outcome = _outcome_or_400(body.get("outcome"))

    from firebase_admin import firestore as admin_firestore

    fields: dict = {
        "result.outcome": outcome,
        "updatedAt": admin_firestore.SERVER_TIMESTAMP,
    }

    rank, rank_of = body.get("rank"), body.get("rankOf")
    if rank is not None and rank_of is not None:
        fields["result.rank"] = int(rank)
        fields["result.rankOf"] = int(rank_of)
    elif rank is None and rank_of is None and "rank" in body:
        # An explicit null clears a rank that no longer applies — after a re-score
        # moved everyone around — rather than leaving a stale position on screen.
        fields["result.rank"] = None
        fields["result.rankOf"] = None

    note = body.get("note")
    if isinstance(note, str):
        fields["result.candidateNote"] = note.strip()

    publish = body.get("publish")
    if publish is not None:
        fields["resultPublished"] = bool(publish)

    def _write() -> None:
        interviews.collection(settings).document(interview_id).update(fields)

    await asyncio.to_thread(_write)
    return {"id": interview_id, "outcome": outcome, "resultPublished": bool(publish)}


async def _tell_candidate(
    settings,
    *,
    interview: dict,
    interview_id: str,
    selected: bool,
    template: dict | None,
    round_name: str,
) -> dict:
    """Send one candidate the transition email for a decision. Never raises.

    Reuses `interview_invite.send_invite_email` and the same `selected` / `rejection`
    kinds the pipeline advance path uses, so both produce the SAME email from the same
    template — a second renderer here would be a second voice for one decision, and
    `contracts/invite_email.fixtures.json` only pins one of them.

    Best-effort per recipient, exactly as a bulk invite is: one undeliverable address
    must not sink a round of fifty, and the decision is already written to the document
    before this runs. A failure is reported back and costs the email, not the outcome.
    """
    result = interview.get("result") if isinstance(interview.get("result"), dict) else {}
    score = result.get("overallScore")

    return await interview_invite.send_invite_email(
        settings,
        template=template,
        to_email=str(
            interview.get("candidateEmail") or interview.get("candidateEmailLower") or ""
        ),
        # No link: neither of these emails sends anyone anywhere. An advance to a NEXT
        # round is a different email with a different link, sent when that round is
        # assigned — conflating them would put a stale link in front of somebody.
        link="",
        interview_id=interview_id,
        kind="selected" if selected else "rejection",
        variables=interview_invite.transition_vars(
            candidate_email=str(interview.get("candidateEmail") or ""),
            role=str(interview.get("role") or ""),
            recruiter_name=str((template or {}).get("sender", {}).get("fromName") or ""),
            company=str((template or {}).get("branding", {}).get("companyName") or "TalbotIQ"),
            round_name=round_name,
            # A string, and empty when absent rather than "0": a candidate reading
            # "your score: 0" for an interview nobody managed to score is worse than
            # reading nothing.
            score=str(score) if isinstance(score, (int, float)) else "",
        ),
    )


@router.post("/outcomes", summary="Decide a whole round at once")
async def apply_round_outcomes(
    request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    """Record outcomes for a ranked list of candidates in one go.

    Mirrors mobile's `applyRoundOutcomes`: `ranked` is the list IN RANK ORDER, and
    everyone in `selectedIds` moves forward while everyone else does not.

    **Ranks come from position in `ranked` and are stamped here**, not computed when
    the candidate looks. A rank that recomputed itself would shift under them whenever
    anyone else was re-scored.

    Ownership is verified for every id before ANY write, so a request carrying one
    interview belonging to somebody else changes nothing at all rather than applying
    the half it was allowed to.
    """
    settings = settings_of(request)

    ranked = body.get("ranked")
    if not isinstance(ranked, list) or not ranked:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ranked must be a non-empty list")
    if len(ranked) > MAX_BATCH:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"that is more than {MAX_BATCH} candidates in one decision",
        )

    ids = [str(i).strip() for i in ranked if str(i).strip()]
    if len(set(ids)) != len(ids):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ranked contains duplicates")

    selected = {str(i) for i in (body.get("selectedIds") or [])}
    unknown = selected - set(ids)
    if unknown:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "selectedIds contains candidates that are not in ranked",
        )

    # Every id checked before anything is written — a partially-applied round decision
    # is worse than a refused one, because nobody can tell which half landed.
    # Every id checked before anything is written, and the documents KEPT: the email
    # step needs each candidate's address and score, and re-reading them would be a
    # second round trip per person for data already in hand.
    fetched = await asyncio.gather(*(_owned_or_404(settings, i, user) for i in ids))
    documents = dict(zip(ids, fetched))

    note_selected = body.get("noteForSelected")
    note_rejected = body.get("noteForRejected")
    publish = bool(body.get("publish", True))

    # Telling candidates by EMAIL is opt-in and separate from publishing.
    #
    # Publishing makes the outcome visible when they next sign in; an email pushes it
    # to them. A recruiter deciding a round privately, or one whose candidates are
    # tracked elsewhere, wants the first without the second — and an email cannot be
    # unsent, so it defaults off.
    send_emails = body.get("sendEmails") is True
    round_name = str(body.get("roundName") or "")

    from firebase_admin import firestore as admin_firestore

    client = interviews.get_db(settings)
    collection = interviews.collection(settings)
    total = len(ids)

    def _write() -> None:
        for start in range(0, total, BATCH_SIZE):
            chunk = ids[start : start + BATCH_SIZE]
            batch = client.batch()
            for offset, interview_id in enumerate(chunk):
                position = start + offset
                is_selected = interview_id in selected
                note = note_selected if is_selected else note_rejected
                fields: dict = {
                    "result.outcome": (
                        interviews.OUTCOME_SELECTED
                        if is_selected
                        else interviews.OUTCOME_NOT_SELECTED
                    ),
                    "result.rank": position + 1,
                    "result.rankOf": total,
                    "resultPublished": publish,
                    "updatedAt": admin_firestore.SERVER_TIMESTAMP,
                }
                if isinstance(note, str) and note.strip():
                    fields["result.candidateNote"] = note.strip()
                batch.update(collection.document(interview_id), fields)
            batch.commit()

    await asyncio.to_thread(_write)

    # Emails go AFTER the writes, deliberately. The decision is the durable thing; an
    # email sent for an outcome that then failed to store would be unretractable and
    # wrong. This ordering can only ever under-send, which a retry fixes.
    emailed = 0
    failures: list[dict] = []
    if send_emails:
        # The recruiter's saved template for this kind if they have one, else the
        # product default. `default_template_for` is what the invite route falls back
        # to as well, so both paths render from the same seed.
        stored = [
            t
            for t in await get_store(settings).invite_email_templates.owned_by(user.uid)
            if invite_email.kind_of(t) == invite_email.SELECTED
        ]
        template = stored[0] if stored else invite_email.default_template_for(
            invite_email.SELECTED
        )
        for interview_id in ids:
            interview = documents.get(interview_id) or {}
            outcome = await _tell_candidate(
                settings,
                interview=interview,
                interview_id=interview_id,
                selected=interview_id in selected,
                template=template,
                round_name=round_name,
            )
            if outcome["status"] == "accepted":
                emailed += 1
            else:
                failures.append(
                    {"id": interview_id, "error": outcome.get("error") or "not sent"}
                )

    logger.info(
        "round decided by %s: %d candidate(s), %d selected, published=%s, emailed=%d",
        user.uid,
        total,
        len(selected),
        publish,
        emailed,
    )
    return {
        "decided": total,
        "selected": len(selected),
        "published": publish,
        "emailed": emailed,
        # Per-recipient, so a recruiter can retry the two that bounced rather than
        # re-sending to all fifty.
        "emailFailures": failures,
    }


# ── Recovering a failed evaluation, and letting someone sit it again ──────────
#
# Both existed only on the phone. In the browser a failed scoring run was TERMINAL:
# the answers were sitting on the document, the scorer could have run again, and there
# was no route to it. The recruiter's options were a manual evaluation or asking the
# candidate to do the whole interview over.


def _is_retryable(data: dict) -> bool:
    """Whether an AI scorer could usefully run again on this interview.

    Mirrors `Interview.canRetryEvaluation` in Dart, and each clause earns its place:

    * **completed with a result** — an interview still in progress is not a failure.
    * **`evaluatedBy` empty** — nothing scored it. Covers "scoring failed" and "the
      scorer never got there", which need the same thing done about them.
    * **`responses` non-empty** — the answers survive. Without them there is nothing to
      feed the scorer and the only route left is a manual evaluation.
    * **not a recruiter-scored round** — a two-way interview has no recording, so there
      is no transcript for a model to read however much else it stores. Its way back is
      the recruiter's own review.
    """
    if data.get("status") != "completed":
        return False
    result = data.get("result")
    if not isinstance(result, dict):
        return False
    if str(result.get("evaluatedBy") or "").strip():
        return False
    if not (isinstance(result.get("responses"), list) and result["responses"]):
        return False
    # `two_way` by either name: `mode` is authoritative, `roundKind` is what the
    # mobile timeline stamps.
    return "two_way" not in (
        str(data.get("mode") or ""),
        str(data.get("roundKind") or ""),
    )


@router.get("/retryable", summary="Interviews whose scoring can be re-run")
async def retryable(request: Request, user: AuthedUser = WebUser) -> list[dict]:
    """The recruiter's recoverable failures.

    Filtered in memory rather than by query, for the reason mobile documents: whether a
    result counts as retryable depends on `evaluatedBy` being EMPTY and `responses`
    being non-empty, and Firestore cannot express "this nested field is missing or
    empty" — an equality on '' would also miss every document written before the field
    existed.

    Bounded by how many of this recruiter's interviews completed, and only paid when
    they ask.
    """
    settings = settings_of(request)

    def _fetch() -> list[dict]:
        documents = (
            interviews.collection(settings).where("recruiterId", "==", user.uid).get()
        )
        rows = []
        for document in documents:
            data = document.to_dict() or {}
            if not _is_retryable(data):
                continue
            result = data["result"]
            rows.append(
                {
                    "id": document.id,
                    "candidate": {
                        "name": data.get("candidateName") or "",
                        "email": data.get("candidateEmail")
                        or data.get("candidateEmailLower")
                        or "",
                    },
                    "title": data.get("title") or "",
                    "answers": len(result["responses"]),
                    # Why it failed, when the scorer said. Shown so a recruiter can
                    # tell a transient upstream error from "nothing was said".
                    "error": str(result.get("evaluationError") or "").strip(),
                }
            )
        return rows

    return await asyncio.to_thread(_fetch)


@router.post("/{interview_id}/retry-evaluation", summary="Score it again")
async def retry_evaluation(
    interview_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    """Re-run scoring from the answers already stored. No candidate involvement.

    Runs the SAME scorer the mobile surface runs — `evaluation.score_and_store`, which
    moved into the kernel for exactly this. A second implementation here would be a
    second set of results for one interview.

    Awaited rather than backgrounded, unlike the candidate's own submission. Nobody is
    waiting on a spinner to be told they are finished; the recruiter pressed a button
    and wants to know whether it worked, and a 202 that silently failed is the state
    this feature exists to get out of.
    """
    settings = settings_of(request)
    data = await _owned_or_404(settings, interview_id, user)

    if not _is_retryable(data):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This interview cannot be re-scored: either something already scored it, "
            "the answers were not kept, or it is a live interview with no transcript "
            "for a model to read.",
        )

    responses = evaluation.clean_responses(data["result"]["responses"])
    if not responses:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The stored answers are unusable."
        )

    await evaluation.score_and_store(
        settings,
        interview_id,
        job_role=str(data.get("title") or "this role"),
        responses=responses,
    )

    # Read back rather than reporting success blindly: `score_and_store` never raises,
    # so a failure is recorded ON the document and the recruiter has to be told that
    # rather than "done".
    after = await _owned_or_404(settings, interview_id, user)
    result = after.get("result") or {}
    scored = bool(str(result.get("evaluatedBy") or "").strip())
    return {
        "id": interview_id,
        "scored": scored,
        "overallScore": result.get("overallScore"),
        "error": str(result.get("evaluationError") or "").strip(),
    }


@router.post("/{interview_id}/clear-result", summary="Let them sit it again")
async def clear_result(
    interview_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    """Drop the result and reopen the interview, KEEPING the assignment.

    Mirrors mobile's `clearResult`, and the distinction from deleting is the point: the
    candidate stays assigned and can take it again. Deleting removes them from the test
    entirely.

    Irreversible — the stored answers and any score go with it. That is why this is
    separate from the retry above: re-scoring is free and keeps everything, so it is
    the thing to try first.

    `attemptsUsed` is deliberately NOT reset. A recruiter reopening an interview is
    granting one more go, not erasing the history of how many times it has been sat —
    and if the cap has been reached, raising it is a separate, visible decision.
    """
    settings = settings_of(request)
    await _owned_or_404(settings, interview_id, user)

    from firebase_admin import firestore as admin_firestore

    def _write() -> None:
        interviews.collection(settings).document(interview_id).update(
            {
                "result": admin_firestore.DELETE_FIELD,
                "resultPublished": False,
                "status": "assigned",
                "updatedAt": admin_firestore.SERVER_TIMESTAMP,
            }
        )

    await asyncio.to_thread(_write)
    logger.info("result cleared for %s by %s", interview_id, user.uid)
    return {"id": interview_id, "status": "assigned"}

"""A test's timeline, on the web surface — `/api/web/tests/{testId}/rounds`.

The web had its own multi-round feature (`web_pipelines`) and the Flutter app had
another (`tests/{testId}/rounds`), and neither knew about the other: a candidate
advanced on one was invisible on the other. These routes put the web on the shared
model.

**`web_pipelines` is still live and still drives the existing board.** The two run in
parallel until the rebuilt board is trusted; nothing here reads or writes a pipeline.

Everything that actually touches Firestore lives in `app.rounds_writer`, which is where
the two dangerous writes are documented — pushing a round's window down onto every
assignment, and stamping ranks rather than recomputing them.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Body, HTTPException, Request, status

from app import interviews, rounds, rounds_writer
from app.security import AuthedUser
from app.web.deps import NotFound, WebUser, settings_of
from app.web.services import interview_invite, users
from app.web.store import get_store

logger = logging.getLogger("web.rounds")

router = APIRouter(prefix="/tests", tags=["web:rounds"])

# A timeline, not a workflow engine. Beyond this a recruiter is modelling something
# rounds are the wrong shape for.
MAX_ROUNDS = 20


def _iso(value: object) -> str | None:
    if value is None:
        return None
    as_iso = getattr(value, "isoformat", None)
    return as_iso() if callable(as_iso) else str(value)


def _parse_when(value: object, field: str) -> datetime | None:
    """An optional ISO instant, or a 400 naming the field.

    Refused rather than ignored. A recruiter who typed a date and had it silently
    dropped would believe the round has a deadline it does not have, and would only
    find out when candidates kept taking it.
    """
    if value in (None, ""):
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"{field} is not a valid date/time"
        ) from exc
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _public(round_: rounds.Round, now: datetime) -> dict:
    """A round as the client sees it.

    `state` is COMPUTED here and sent, rather than being stored and read: nothing
    persists it, so nothing can go stale. Every round in one response is judged against
    the same instant, which is why `now` is passed in.
    """
    return {
        "id": round_.id,
        "testId": round_.test_id,
        "order": round_.order,
        "title": round_.title,
        "kind": round_.kind,
        "config": round_.config,
        "opensAt": _iso(round_.opens_at),
        "closesAt": _iso(round_.closes_at),
        "closedAt": _iso(round_.closed_at),
        "closedBy": round_.closed_by,
        "criteria": round_.criteria.to_map(),
        "state": round_.state_at(now),
        "endedManually": round_.was_ended_manually,
        # A résumé round is a submission step, not a session anyone joins. The board
        # renders it differently, and sending it saves the client re-deriving a rule
        # the server already owns.
        "isInterview": rounds.kind_is_interview(round_.kind),
        "isRecruiterScored": rounds.kind_is_recruiter_scored(round_.kind),
    }


async def _owned_test_or_404(settings, test_id: str, user: AuthedUser) -> dict:
    """The test document, if this recruiter owns it."""
    import asyncio

    if not test_id:
        raise NotFound("Test")

    def _read() -> dict | None:
        snapshot = interviews.tests_collection(settings).document(test_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    data = await asyncio.to_thread(_read)
    if not data or str(data.get("recruiterId") or "") != user.uid:
        raise NotFound("Test")
    return data


async def _owned_round_or_404(
    settings, test_id: str, round_id: str, user: AuthedUser
) -> rounds.Round:
    await _owned_test_or_404(settings, test_id, user)
    for existing in await rounds_writer.fetch_all(settings, test_id, user.uid):
        if existing.id == round_id:
            return existing
    raise NotFound("Round")


def _kind_or_400(value: object) -> str:
    """Strict on write, lenient on read — the same split as interview outcomes.

    Reading an unknown kind degrades to `chat` so an old document still renders;
    WRITING one is a caller bug, and storing it would put a value on the timeline the
    Flutter client will render as something else entirely.
    """
    if value in rounds.KINDS:
        return str(value)
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        f"kind must be one of {', '.join(rounds.KINDS)} — got {value!r}",
    )


@router.get("/{test_id}/rounds", summary="A test's timeline")
async def list_rounds(
    test_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    settings = settings_of(request)
    await _owned_test_or_404(settings, test_id, user)

    found = await rounds_writer.fetch_all(settings, test_id, user.uid)
    now = datetime.now(timezone.utc)

    return {
        "rounds": [_public(r, now) for r in found],
        # How many assignments predate the timeline. Non-zero means this test was
        # created as a single round and given rounds afterwards, and those assignments
        # belong to NO round — see the adopt route.
        "legacyAssignments": await rounds_writer.count_legacy_assignments(
            settings, test_id=test_id, recruiter_id=user.uid
        ),
    }


@router.post("/{test_id}/rounds", status_code=status.HTTP_201_CREATED, summary="Add a round")
async def create_round(
    test_id: str,
    request: Request,
    body: dict = Body(...),
    user: AuthedUser = WebUser,
) -> dict:
    settings = settings_of(request)
    await _owned_test_or_404(settings, test_id, user)

    existing = await rounds_writer.fetch_all(settings, test_id, user.uid)
    if len(existing) >= MAX_ROUNDS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"A timeline holds at most {MAX_ROUNDS} rounds.",
        )

    title = str(body.get("title") or "").strip()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A round needs a name.")

    opens_at = _parse_when(body.get("opensAt"), "opensAt")
    closes_at = _parse_when(body.get("closesAt"), "closesAt")
    if opens_at and closes_at and closes_at <= opens_at:
        # Refused rather than stored: such a round is closed the instant it opens, and
        # `state_at` would report it closed forever with no obvious cause.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "A round cannot close before it opens."
        )

    model = rounds.Round(
        id="",
        test_id=test_id,
        recruiter_id=user.uid,
        # Position comes from the END of the timeline, not from the body: an index the
        # caller chose could collide with an existing round and make the order arbitrary.
        order=len(existing),
        title=title,
        kind=_kind_or_400(body.get("kind") or rounds.KIND_CHAT),
        config=body.get("config") if isinstance(body.get("config"), dict) else {},
        opens_at=opens_at,
        closes_at=closes_at,
        criteria=rounds.Criteria.from_map(body.get("criteria")),
    )

    round_id = await rounds_writer.create(settings, model)
    logger.info("round %s added to test %s by %s", round_id, test_id, user.uid)
    return _public(
        rounds.Round(**{**model.__dict__, "id": round_id}), datetime.now(timezone.utc)
    )


@router.put("/{test_id}/rounds/{round_id}", summary="Edit a round")
async def update_round(
    test_id: str,
    round_id: str,
    request: Request,
    body: dict = Body(...),
    user: AuthedUser = WebUser,
) -> dict:
    settings = settings_of(request)
    existing = await _owned_round_or_404(settings, test_id, round_id, user)

    opens_at = (
        _parse_when(body.get("opensAt"), "opensAt")
        if "opensAt" in body
        else existing.opens_at
    )
    closes_at = (
        _parse_when(body.get("closesAt"), "closesAt")
        if "closesAt" in body
        else existing.closes_at
    )
    if opens_at and closes_at and closes_at <= opens_at:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "A round cannot close before it opens."
        )

    updated = rounds.Round(
        id=existing.id,
        test_id=test_id,
        recruiter_id=existing.recruiter_id,
        order=existing.order,
        title=str(body.get("title") or existing.title).strip() or existing.title,
        kind=_kind_or_400(body.get("kind")) if "kind" in body else existing.kind,
        config=body.get("config") if isinstance(body.get("config"), dict) else existing.config,
        opens_at=opens_at,
        closes_at=closes_at,
        # NOT carried over from the body. Ending a round goes through its own route, so
        # a routine edit cannot reopen a closed one.
        closed_at=existing.closed_at,
        closed_by=existing.closed_by,
        criteria=(
            rounds.Criteria.from_map(body.get("criteria"))
            if "criteria" in body
            else existing.criteria
        ),
    )

    # `update` decides for itself whether the window moved, and only rewrites the
    # assignments when it did — otherwise fixing a typo costs a write per candidate.
    await rounds_writer.update(settings, updated)
    return _public(updated, datetime.now(timezone.utc))


@router.post("/{test_id}/rounds/{round_id}/end", summary="End a round now")
async def end_round(
    test_id: str, round_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    """Close a round ahead of its deadline, and lock its candidates out.

    Both halves matter. Stamping `closedAt` on the round alone closes nothing — each
    candidate's device gates on `expiresAt` on their OWN assignment, which still holds
    the original deadline. `close_now` pushes the close down; `lockedOut` is how many it
    reached.
    """
    settings = settings_of(request)
    existing = await _owned_round_or_404(settings, test_id, round_id, user)

    locked = await rounds_writer.close_now(settings, existing)
    logger.info("round %s/%s ended by %s (%d locked out)", test_id, round_id, user.uid, locked)
    return {"id": round_id, "state": rounds.STATE_CLOSED, "lockedOut": locked}


@router.post("/{test_id}/rounds/{round_id}/assign", summary="Assign candidates to a round")
async def assign_round(
    test_id: str,
    round_id: str,
    request: Request,
    body: dict = Body(default={}),
    user: AuthedUser = WebUser,
) -> dict:
    """Assign candidates, skipping anyone already in this round.

    With no `candidates` in the body, everyone already in the TEST is offered — which is
    what adding a second round to an existing pipeline means.
    """
    settings = settings_of(request)
    test = await _owned_test_or_404(settings, test_id, user)
    existing = await _owned_round_or_404(settings, test_id, round_id, user)

    supplied = body.get("candidates")
    if isinstance(supplied, list) and supplied:
        candidates = {
            str(e).strip().lower(): None for e in supplied if str(e or "").strip()
        }
    else:
        candidates = await rounds_writer.candidates_of(
            settings, test_id=test_id, recruiter_id=user.uid
        )

    if not candidates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No candidates to assign.")

    # A role-pipeline round carries its own configured question source in `config`
    # (mode/source/questionSetId/mixedConfig — see app.role_configs) — resolved here
    # with the exact same function a manual invite uses, so a round 2+ mixed/tailor/set
    # configuration actually takes effect instead of silently falling back to adaptive.
    # A round with no `source` in its config (every round created before this existed,
    # and any round a recruiter configured by hand today) resolves to nothing here and
    # reproduces today's exact behaviour: `questions` from the body, as always, and no
    # `screening` block at all.
    body_questions = body.get("questions") if isinstance(body.get("questions"), list) else None
    resolved_questions = body_questions
    resolved_screening: dict | None = None
    round_mode = rounds.mode_for_kind(existing.kind)
    round_source = (existing.config or {}).get("source")
    if body_questions is None and round_source and round_mode not in (
        "two_way",
        "mcq",
        "coding",
        "essay",
    ):
        store = get_store(settings)
        resolved_questions, resolved_screening = await interview_invite.resolve_question_source(
            store,
            mode=round_mode,
            source=round_source,
            config=existing.config,
            mixed_config=(existing.config or {}).get("mixedConfig"),
        )

    created = await rounds_writer.assign(
        settings,
        existing,
        recruiter_email=user.email or "",
        recruiter_name=await users.get_display_name(settings, user.uid),
        test_title=str(test.get("title") or "Interview"),
        candidates=candidates,
        questions=resolved_questions,
        screening=resolved_screening,
    )
    return {"assigned": created, "skipped": len(candidates) - created}


@router.post("/{test_id}/rounds/{round_id}/adopt", summary="Adopt pre-timeline assignments")
async def adopt_round(
    test_id: str, round_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    """Move assignments that belong to NO round into this one.

    The repair for "assign a single-round test, then add rounds". Those assignments have
    no `roundId`, and every consequence is silent: assigning again creates a SECOND
    document per candidate (the same test twice on their screen, both launchable), they
    never appear in a round leaderboard, and ending the round never closes them.

    Adopts rather than recreating, because those documents may already hold a completed
    interview, a transcript and a score.
    """
    settings = settings_of(request)
    existing = await _owned_round_or_404(settings, test_id, round_id, user)

    adopted = await rounds_writer.adopt_legacy_assignments(settings, existing)
    return {"adopted": adopted}

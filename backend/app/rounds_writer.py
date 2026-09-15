"""Writing rounds, and the two writes that are easy to get wrong.

Split from `app.rounds` (which is the pure model) because these touch Firestore and
because both of them exist to prevent a specific failure:

**`propagate_window` — the one that locks candidates out.** A candidate's device has no
permission to read round documents. `availableFrom`/`expiresAt` on their OWN assignment
is the only thing it checks, so a round's window is copied down onto every assignment
when it is set or moved. Stamping `closedAt` on the round alone closes nothing: the
candidate still holds the original `expiresAt` and can still start.

**`stamp_ranks` — the one that moves under people.** A rank written from a candidate's
position in a ranked list stays put. A rank recomputed when somebody looked would shift
every time anyone else in the round was re-scored, so a candidate told "4 of 32" would
see a different number tomorrow with no explanation.

Both mirror `InterviewRepository` in the Flutter app, which is where they were correct
first.
"""

from __future__ import annotations

import asyncio
import logging

from app import interviews, rounds
from app.config import Settings

logger = logging.getLogger("rounds.writer")

# Firestore hard-caps a batch at 500 writes; stay well under, as every other batched
# write in this codebase does.
BATCH_SIZE = 400


async def create(settings: Settings, round_: rounds.Round) -> str:
    """Create a round and return its id."""
    from firebase_admin import firestore as admin_firestore

    def _write() -> str:
        reference = rounds.collection(settings, round_.test_id).document()
        reference.set(
            round_.to_create_map(server_timestamp=admin_firestore.SERVER_TIMESTAMP)
        )
        return reference.id

    return await asyncio.to_thread(_write)


async def fetch_all(settings: Settings, test_id: str, recruiter_id: str) -> list[rounds.Round]:
    """A test's timeline, in running order.

    `recruiter_id` is REQUIRED even though the path already scopes to one test, and this
    is not defensive padding: `firestore.rules` grants round reads via
    `resource.data.recruiterId == uid`, and a LIST query has to be provable from its own
    constraints — Firestore will not fetch documents to discover whether the rule would
    have allowed them. Without this equality the query comes back PERMISSION_DENIED.
    The Admin SDK bypasses rules, so it would work here and fail on the phone, which is
    the worst way to find out.
    """
    if not test_id or not recruiter_id:
        return []

    def _read() -> list[rounds.Round]:
        from google.cloud.firestore_v1.base_query import FieldFilter

        query = (
            rounds.collection(settings, test_id)
            .where(filter=FieldFilter("recruiterId", "==", recruiter_id))
            .order_by("order")
        )
        out = []
        for snapshot in query.stream():
            try:
                out.append(
                    rounds.Round.from_document(snapshot.id, test_id, snapshot.to_dict() or {})
                )
            except Exception as exc:  # noqa: BLE001 - one bad round must not break a timeline
                logger.warning("skipping malformed round %s: %s", snapshot.id, exc)
        return out

    return await asyncio.to_thread(_read)


async def update(settings: Settings, round_: rounds.Round) -> None:
    """Save an edited round, and push the window down IF the recruiter moved it.

    The previous document is read first purely to make that decision. Without it either
    every edit rewrites every assignment — a thousand writes to fix a typo in a title —
    or the caller has to remember to say the dates changed, which is exactly the kind of
    thing a caller eventually forgets.
    """
    from firebase_admin import firestore as admin_firestore

    reference = rounds.collection(settings, round_.test_id).document(round_.id)

    def _read_before() -> dict | None:
        snapshot = reference.get()
        return snapshot.to_dict() if snapshot.exists else None

    before = await asyncio.to_thread(_read_before)

    def _write() -> None:
        reference.update(
            round_.to_update_map(server_timestamp=admin_firestore.SERVER_TIMESTAMP)
        )

    await asyncio.to_thread(_write)

    previous = (
        rounds.Round.from_document(round_.id, round_.test_id, before) if before else None
    )
    moved = (
        previous is None
        or previous.opens_at != round_.opens_at
        or previous.closes_at != round_.closes_at
    )
    if moved:
        await propagate_window(
            settings,
            recruiter_id=round_.recruiter_id,
            test_id=round_.test_id,
            round_id=round_.id,
            available_from=round_.opens_at,
            expires_at=round_.closes_at,
        )


async def close_now(settings: Settings, round_: rounds.Round) -> int:
    """"End round now" — close it ahead of its deadline.

    Writing `closedAt` alone would NOT lock anyone out: each candidate's assignment
    still carries the original `expiresAt`, and that is the only thing their device
    checks. So the same instant is stamped onto every unfinished assignment in the
    round, which is what actually ends it. Returns how many were locked out.

    `SERVER_TIMESTAMP` rather than a computed now: the device clock is the one thing a
    candidate can trivially change, and this value is what shuts them out.
    """
    from firebase_admin import firestore as admin_firestore

    def _write() -> None:
        rounds.collection(settings, round_.test_id).document(round_.id).update(
            {
                "closedAt": admin_firestore.SERVER_TIMESTAMP,
                "closedBy": rounds.CLOSED_BY_MANUAL,
                "updatedAt": admin_firestore.SERVER_TIMESTAMP,
            }
        )

    await asyncio.to_thread(_write)

    return await propagate_window(
        settings,
        recruiter_id=round_.recruiter_id,
        test_id=round_.test_id,
        round_id=round_.id,
        available_from=round_.opens_at,
        expires_at=admin_firestore.SERVER_TIMESTAMP,
    )


async def propagate_window(
    settings: Settings,
    *,
    recruiter_id: str,
    test_id: str,
    round_id: str,
    available_from: object,
    expires_at: object,
) -> int:
    """Copy a round's window onto its candidates' assignments. Returns how many.

    THE reason this module exists — see its docstring. `expires_at` is deliberately
    untyped so a caller can pass a concrete deadline or Firestore's server-timestamp
    sentinel for "ending now".

    Completed assignments are skipped: the interview is already over, and at a thousand
    candidates those are most of the writes.
    """
    from firebase_admin import firestore as admin_firestore
    from google.cloud.firestore_v1.base_query import FieldFilter

    if not recruiter_id or not test_id or not round_id:
        return 0

    client = interviews.get_db(settings)
    collection = interviews.collection(settings)

    def _write() -> int:
        query = (
            collection.where(filter=FieldFilter("recruiterId", "==", recruiter_id))
            .where(filter=FieldFilter("testId", "==", test_id))
            .where(filter=FieldFilter("roundId", "==", round_id))
        )
        references = [
            snapshot.reference
            for snapshot in query.stream()
            if (snapshot.to_dict() or {}).get("status") != "completed"
        ]
        if not references:
            return 0

        payload = {
            "availableFrom": available_from,
            "expiresAt": expires_at,
            "updatedAt": admin_firestore.SERVER_TIMESTAMP,
        }
        for start in range(0, len(references), BATCH_SIZE):
            batch = client.batch()
            for reference in references[start : start + BATCH_SIZE]:
                batch.update(reference, payload)
            batch.commit()
        return len(references)

    written = await asyncio.to_thread(_write)
    logger.info(
        "round %s/%s window pushed onto %d assignment(s)", test_id, round_id, written
    )
    return written


async def assign(
    settings: Settings,
    round_: rounds.Round,
    *,
    recruiter_email: str,
    recruiter_name: str | None,
    test_title: str,
    candidates: dict[str, str | None],
    questions: list[str] | None = None,
    screening: dict | None = None,
) -> int:
    """Assign `candidates` (emailLower → name) to a round, SKIPPING anyone already in it.

    Skipping rather than overwriting is what makes this safe to press twice: a re-assign
    after adding two more people must not reset the status or wipe the result of the
    fifty who already took the round.

    Each assignment carries the round's window and its denormalised `roundOrder` /
    `roundKind` / `roundTitle`, because the candidate's device cannot read round
    documents and still has to show "Round 2 of 4" and gate on the deadline; `roundTitle`
    additionally lets the Candidates Kanban (`app.candidates`) render a round's real name
    without a second read per card.

    `screening` is an OPAQUE dict, resolved by the caller (`app.web.routes.rounds`, via
    the same `interview_invite.resolve_question_source` a manual invite already uses) and
    written verbatim onto each new document — this module has no opinion on question
    sources. Omitted (the default) reproduces today's exact behaviour: no `screening` key
    at all, so `invite_bridge.synthesise_template` falls back to `adaptive` precisely as
    it always has for a round-2+ assignment carrying no source of its own.
    """
    from firebase_admin import firestore as admin_firestore
    from google.cloud.firestore_v1.base_query import FieldFilter

    if not candidates or not round_.test_id or not round_.id:
        return 0

    client = interviews.get_db(settings)
    collection = interviews.collection(settings)
    mode = rounds.mode_for_kind(round_.kind)

    def _write() -> int:
        existing = (
            collection.where(filter=FieldFilter("recruiterId", "==", round_.recruiter_id))
            .where(filter=FieldFilter("testId", "==", round_.test_id))
            .where(filter=FieldFilter("roundId", "==", round_.id))
            .stream()
        )
        already = {
            str((s.to_dict() or {}).get("candidateEmailLower") or "") for s in existing
        }
        pending = [e for e in candidates if e and e not in already]
        if not pending:
            return 0

        for start in range(0, len(pending), BATCH_SIZE):
            batch = client.batch()
            for email in pending[start : start + BATCH_SIZE]:
                document = {
                    **interviews.build_assignment(
                        test_id=round_.test_id,
                        recruiter_id=round_.recruiter_id,
                        recruiter_email=recruiter_email,
                        recruiter_name=recruiter_name,
                        candidate_email=email,
                        candidate_name=candidates.get(email),
                        title=f"{test_title} — {round_.title}",
                        # A résumé round has no track, so `mode_for_kind` returns "" and
                        # `build_assignment` writes `type: chat` — which is what the
                        # Dart model already expects for one.
                        mode=mode or "chat",
                        questions=list(questions or []),
                        server_timestamp=admin_firestore.SERVER_TIMESTAMP,
                    ),
                    # Denormalised from the round. The candidate's device cannot read
                    # round documents, so it needs all three here.
                    "roundId": round_.id,
                    "roundOrder": round_.order,
                    "roundKind": round_.kind,
                    "roundTitle": round_.title,
                    "availableFrom": round_.opens_at,
                    "expiresAt": round_.closes_at,
                    **({"screening": screening} if screening else {}),
                }
                batch.set(collection.document(), document)
            batch.commit()
        return len(pending)

    return await asyncio.to_thread(_write)


async def rosters(
    settings: Settings, *, test_id: str, recruiter_id: str
) -> dict[str, list[dict]]:
    """Who is in each round of a test, keyed by `roundId`.

    **Why this exists rather than deriving it from the sessions list.** The recruiter's
    sessions list is built from web SESSION rows and joins assignments onto them by id.
    An assignment created here has its own auto-id and no session row until the
    candidate opens it — so a person advanced into round 3 was invisible to every
    round-scoped view in the browser until they started, which is precisely the moment
    a recruiter most wants to see them and still has the option to undo it.

    Assignments with no `roundId` are grouped under the empty string: they predate the
    timeline, and `adopt_legacy_assignments` is what moves them.

    Scores are NOT here. They live on the report, which is keyed by session, so the
    caller merges the two — this is a roster, not a leaderboard.
    """
    from google.cloud.firestore_v1.base_query import FieldFilter

    if not test_id or not recruiter_id:
        return {}

    collection = interviews.collection(settings)

    def _read() -> dict[str, list[dict]]:
        found = (
            collection.where(filter=FieldFilter("recruiterId", "==", recruiter_id))
            .where(filter=FieldFilter("testId", "==", test_id))
            .stream()
        )
        grouped: dict[str, list[dict]] = {}
        for snapshot in found:
            data = snapshot.to_dict() or {}
            email = str(data.get("candidateEmailLower") or data.get("candidateEmail") or "")
            if not email:
                continue
            grouped.setdefault(str(data.get("roundId") or ""), []).append(
                {
                    "id": snapshot.id,
                    "email": email,
                    "name": data.get("candidateName") or "",
                    # "assigned" is the untouched state `build_assignment` writes;
                    # anything else means they have engaged with it. Sent raw so the
                    # client can say "not started" without this module owning the words.
                    "status": str(data.get("status") or "assigned"),
                }
            )
        for rows in grouped.values():
            rows.sort(key=lambda r: r["email"])
        return grouped

    return await asyncio.to_thread(_read)


async def unassign(
    settings: Settings, round_: rounds.Round, *, candidates: list[str]
) -> dict:
    """Take candidates OUT of a round — the undo for advancing somebody by mistake.

    Deletes their assignment in THIS round and touches nothing else, so the earlier
    round they came from, and everything they did in it, is untouched. That is the whole
    reason this deletes rather than re-pointing `roundId`: a re-point would drag any
    answers they had given into a round those questions do not belong to, and the
    candidate would be sitting in a stage holding another stage's work.

    **Anyone who has already started is REFUSED, not deleted.** Their document holds the
    transcript and the score it was computed from, and "they should not have been
    advanced" is never a reason to destroy a candidate's work. Those are returned in
    `kept` so the caller can say who, and why, rather than silently doing half the job.
    """
    from google.cloud.firestore_v1.base_query import FieldFilter

    wanted = {str(e or "").strip().lower() for e in candidates}
    wanted.discard("")
    if not wanted or not round_.test_id or not round_.id:
        return {"removed": 0, "kept": []}

    client = interviews.get_db(settings)
    collection = interviews.collection(settings)

    def _write() -> dict:
        found = (
            collection.where(filter=FieldFilter("recruiterId", "==", round_.recruiter_id))
            .where(filter=FieldFilter("testId", "==", round_.test_id))
            .where(filter=FieldFilter("roundId", "==", round_.id))
            .stream()
        )

        doomed: list[str] = []
        kept: list[dict] = []
        for snapshot in found:
            data = snapshot.to_dict() or {}
            email = str(data.get("candidateEmailLower") or "")
            if email not in wanted:
                continue
            # "assigned" is the untouched state `build_assignment` writes. Anything
            # else means they have engaged with it.
            if str(data.get("status") or "assigned") != "assigned":
                kept.append({"email": email, "reason": "already started this round"})
                continue
            doomed.append(snapshot.id)

        for start in range(0, len(doomed), BATCH_SIZE):
            batch = client.batch()
            for document_id in doomed[start : start + BATCH_SIZE]:
                batch.delete(collection.document(document_id))
            batch.commit()

        return {"removed": len(doomed), "kept": kept}

    return await asyncio.to_thread(_write)


async def count_legacy_assignments(
    settings: Settings, *, test_id: str, recruiter_id: str
) -> int:
    """How many of a test's assignments predate its timeline — i.e. carry no `roundId`."""
    return len(await _legacy_assignments(settings, test_id=test_id, recruiter_id=recruiter_id))


async def _legacy_assignments(
    settings: Settings, *, test_id: str, recruiter_id: str
) -> list:
    """A test's assignments with no `roundId`.

    Filtered client-side rather than with `where("roundId", "==", None)`: pre-timeline
    documents do not have the field AT ALL, and Firestore cannot query for an absent
    field — an equality on null matches only documents that explicitly store null, which
    is none of them.
    """
    from google.cloud.firestore_v1.base_query import FieldFilter

    if not test_id or not recruiter_id:
        return []

    def _read() -> list:
        query = (
            interviews.collection(settings)
            .where(filter=FieldFilter("recruiterId", "==", recruiter_id))
            .where(filter=FieldFilter("testId", "==", test_id))
        )
        out = []
        for snapshot in query.stream():
            round_id = (snapshot.to_dict() or {}).get("roundId")
            if round_id is None or (isinstance(round_id, str) and not round_id):
                out.append(snapshot)
        return out

    return await asyncio.to_thread(_read)


async def adopt_legacy_assignments(settings: Settings, round_: rounds.Round) -> int:
    """Move a test's round-LESS assignments into `round_`, in place. Returns how many.

    **The repair for "assign a single-round test, then add rounds".** Those original
    assignments belong to no round, and every consequence is silent:

    * `assign` cannot recognise their owners as already assigned, so it creates a SECOND
      document per candidate — the same test appears twice on their screen, both
      launchable, and whichever they pick is a coin toss.
    * they never appear in a round leaderboard, "end round now" never closes them, and
      notifying a round never covers them.

    **Adopting rather than deleting-and-recreating is the whole point.** These documents
    may already hold a completed interview, a transcript and a score. Recreating would
    throw that away.

    The round's window is applied too, so an adopted candidate is governed by the round
    they are now in.
    """
    from firebase_admin import firestore as admin_firestore

    snapshots = await _legacy_assignments(
        settings, test_id=round_.test_id, recruiter_id=round_.recruiter_id
    )
    if not snapshots:
        return 0

    client = interviews.get_db(settings)

    def _write() -> int:
        payload = {
            "roundId": round_.id,
            "roundOrder": round_.order,
            "roundKind": round_.kind,
            "availableFrom": round_.opens_at,
            "expiresAt": round_.closes_at,
            "updatedAt": admin_firestore.SERVER_TIMESTAMP,
        }
        for start in range(0, len(snapshots), BATCH_SIZE):
            batch = client.batch()
            for snapshot in snapshots[start : start + BATCH_SIZE]:
                batch.update(snapshot.reference, payload)
            batch.commit()
        return len(snapshots)

    adopted = await asyncio.to_thread(_write)
    logger.info(
        "adopted %d legacy assignment(s) into round %s/%s",
        adopted,
        round_.test_id,
        round_.id,
    )
    return adopted


async def candidates_of(settings: Settings, *, test_id: str, recruiter_id: str) -> dict:
    """Every distinct candidate across a test, as `emailLower → display name`.

    Reads the test's assignments once. That is the cost this module otherwise works hard
    to avoid, but a recruiter adding a round has to be offered the people already in the
    pipeline, and there is nowhere cheaper to get them — candidates are deliberately not
    listed on the test document. Paid once per assign action, on one test.
    """
    from google.cloud.firestore_v1.base_query import FieldFilter

    if not test_id or not recruiter_id:
        return {}

    def _read() -> dict:
        query = (
            interviews.collection(settings)
            .where(filter=FieldFilter("recruiterId", "==", recruiter_id))
            .where(filter=FieldFilter("testId", "==", test_id))
        )
        out: dict[str, str | None] = {}
        for snapshot in query.stream():
            data = snapshot.to_dict() or {}
            email = str(
                data.get("candidateEmailLower")
                or (data.get("candidateEmail") or "").strip().lower()
            )
            if not email:
                continue
            name = (data.get("candidateName") or "").strip() or None
            # First non-empty name wins: a later round may have been created without
            # one and must not blank out a name an earlier round has.
            if out.get(email) is None and name:
                out[email] = name
            else:
                out.setdefault(email, None)
        return out

    return await asyncio.to_thread(_read)

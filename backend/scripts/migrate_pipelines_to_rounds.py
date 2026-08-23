"""Copy `web_pipelines` into the shared rounds model, once.

Two multi-round features existed and neither knew about the other: mobile's
`tests/{testId}/rounds` and the web's `web_pipelines` + `web_pipeline_candidates`. A
candidate advanced on one was invisible on the other. Mobile's model is the one being
kept — it derives round state from the clock, copies the window onto each assignment,
and stamps ranks — so this moves the pipelines that already exist onto it.

**A COPY. Nothing is deleted and `web_pipelines` still drives the web board.** That is
deliberate and it is what the plan asked for: the two models run in parallel until the
rebuilt board is trusted, so a rollback is redeploying the previous build rather than
restoring data. Retiring the old collections is a separate, later change.

WHAT IT WRITES, per pipeline:

  tests/{pipelineId}                      the batch metadata the mobile dashboard pages
                                          over — a pipeline IS a test
  tests/{pipelineId}/rounds/{roundId}     one per entry in `pipeline.rounds`, in order
  interviews/{id}.roundId / roundOrder    stamped onto the assignments that already
                / roundKind               exist, so the phone can place them in a round

WHAT IT CANNOT DO. A pipeline has no per-round WINDOW (no opensAt/closesAt) and no
criteria — those are round concepts the web model never had. They are written as null
rather than invented: a made-up deadline would lock candidates out of a round nobody
scheduled, which is a far worse outcome than a round with no deadline.

    .venv/bin/python scripts/migrate_pipelines_to_rounds.py --dry-run
    .venv/bin/python scripts/migrate_pipelines_to_rounds.py
"""

from __future__ import annotations

import argparse
import sys

from app import interviews, rounds
from app.config import Settings
from app.firebase import get_db

PIPELINES = "web_pipelines"
BATCH_SIZE = 400

# A pipeline round names a web TRACK; a round names a KIND. The two overlap but are not
# the same list, so the mapping is explicit — `chatbot` and `mcq` have no round kind of
# their own and are chat-shaped to the phone, which is also what their `type` says.
_KIND_FOR_MODE = {
    "chat": rounds.KIND_CHAT,
    "chatbot": rounds.KIND_CHAT,
    "mcq": rounds.KIND_CHAT,
    "voice": rounds.KIND_VOICE,
    "video": rounds.KIND_VIDEO,
    "video_avatar": rounds.KIND_VIDEO,
    "two_way": rounds.KIND_TWO_WAY,
}


def _kind_for(mode: object) -> str:
    return _KIND_FOR_MODE.get(str(mode or ""), rounds.KIND_CHAT)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="write nothing")
    parser.add_argument(
        "--force",
        action="store_true",
        help="rewrite rounds for a pipeline that already has them",
    )
    args = parser.parse_args()

    settings = Settings()
    client = get_db(settings)
    pipelines = list(client.collection(PIPELINES).stream())
    if not pipelines:
        print("no pipelines — nothing to migrate.")
        return 0

    print(f"{len(pipelines)} pipeline(s)")
    totals = {"tests": 0, "rounds": 0, "stamped": 0, "skipped": 0, "roundless": 0}

    for snapshot in pipelines:
        pipeline = snapshot.to_dict() or {}
        pipeline_id = snapshot.id
        recruiter_id = str(pipeline.get("recruiterId") or "")
        entries = pipeline.get("rounds") or []
        name = str(pipeline.get("name") or pipeline.get("role") or "Pipeline")

        print(f"\n── {name} ({pipeline_id})")

        if not recruiter_id:
            # Unattributable: rounds are read with a `recruiterId` equality, so a round
            # written without one would be invisible to the client that needs it.
            print("  ! no recruiterId — skipped (its rounds would be unreadable)")
            totals["skipped"] += 1
            continue

        if not isinstance(entries, list) or not entries:
            print("  ! no rounds — skipped")
            totals["roundless"] += 1
            continue

        existing = list(rounds.collection(settings, pipeline_id).stream())
        if existing and not args.force:
            print(f"  already has {len(existing)} round(s) — skipped")
            totals["skipped"] += 1
            continue

        print(f"  {len(entries)} round(s) to write")
        for index, entry in enumerate(entries):
            entry = entry if isinstance(entry, dict) else {}
            kind = _kind_for(entry.get("mode"))
            print(
                f"    {index}: {entry.get('name') or f'Round {index + 1}'} "
                f"[{entry.get('mode') or 'chat'} → {kind}]"
            )

        if args.dry_run:
            totals["tests"] += 1
            totals["rounds"] += len(entries)
            continue

        from firebase_admin import firestore as admin_firestore

        # The batch metadata document, so the pipeline appears on the mobile dashboard
        # at all. Without it the rounds exist under a test nothing lists.
        client.collection(interviews.TESTS_COLLECTION).document(pipeline_id).set(
            interviews.build_test_summary(
                recruiter_id=recruiter_id,
                title=name,
                mode=str((entries[0] or {}).get("mode") or "chat"),
                server_timestamp=admin_firestore.SERVER_TIMESTAMP,
            ),
            merge=True,
        )
        totals["tests"] += 1

        # Rounds, keyed by their INDEX so a re-run with --force overwrites rather than
        # duplicating. A generated id would produce a second timeline every run.
        round_ids: dict[int, str] = {}
        for index, entry in enumerate(entries):
            entry = entry if isinstance(entry, dict) else {}
            round_id = f"r{index}"
            round_ids[index] = round_id
            model = rounds.Round(
                id=round_id,
                test_id=pipeline_id,
                recruiter_id=recruiter_id,
                order=index,
                title=str(entry.get("name") or f"Round {index + 1}"),
                kind=_kind_for(entry.get("mode")),
                # Everything the round model has no field for is preserved here rather
                # than dropped: the web board still reads the pipeline, and a later
                # change may want the question source back.
                config={
                    "mode": entry.get("mode"),
                    "source": entry.get("source"),
                    "questionSetId": entry.get("questionSetId"),
                    "advance": entry.get("advance"),
                    "migratedFromPipeline": pipeline_id,
                },
                # No window and no criteria — a pipeline never had either. NULL rather
                # than invented: a made-up deadline would lock candidates out of a round
                # nobody scheduled.
            )
            rounds.collection(settings, pipeline_id).document(round_id).set(
                model.to_create_map(server_timestamp=admin_firestore.SERVER_TIMESTAMP),
                merge=True,
            )
            totals["rounds"] += 1

        # Stamp the assignments that already exist, so the phone can place them.
        from google.cloud.firestore_v1.base_query import FieldFilter

        assignments = list(
            interviews.collection(settings)
            .where(filter=FieldFilter("recruiterId", "==", recruiter_id))
            .stream()
        )
        pending = []
        for doc in assignments:
            data = doc.to_dict() or {}
            block = data.get("pipeline")
            if not isinstance(block, dict) or block.get("pipelineId") != pipeline_id:
                continue
            if data.get("roundId"):
                continue  # already placed
            index = data.get("roundIndex")
            if index is None:
                index = block.get("roundIndex")
            try:
                index = int(index)
            except (TypeError, ValueError):
                index = 0
            round_id = round_ids.get(index)
            if not round_id:
                continue
            pending.append((doc.reference, index, round_id, entries[index] or {}))

        for start in range(0, len(pending), BATCH_SIZE):
            batch = client.batch()
            for reference, index, round_id, entry in pending[start : start + BATCH_SIZE]:
                batch.update(
                    reference,
                    {
                        "testId": pipeline_id,
                        "roundId": round_id,
                        "roundOrder": index,
                        "roundKind": _kind_for(entry.get("mode")),
                        "updatedAt": admin_firestore.SERVER_TIMESTAMP,
                    },
                )
            batch.commit()
        totals["stamped"] += len(pending)
        print(f"  stamped {len(pending)} assignment(s)")

    print("\n── summary ──")
    for label, count in totals.items():
        print(f"  {label}: {count}")

    if args.dry_run:
        print("\ndry run — nothing written.")
    else:
        print(
            f"\n{PIPELINES} is UNTOUCHED and still drives the web board. The two models "
            "run in parallel until the rebuilt board is trusted; retiring the old "
            "collections is a separate change."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

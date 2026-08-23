"""Copy `web_mcq_sets` into the shared `mcq_sets` collection, once.

MCQ papers were `web_`-prefixed, which is why MCQ never reached the phone: the runtime,
the paper and the answer key were all inside the web surface, and rule 1 of
`tests/test_layering.py` (correctly) keeps the rest of the codebase out of it. The
collection is shared now — see `app/mcq.py` — and this moves the papers that already
exist, so a recruiter's existing assessment works on both clients rather than only the
ones authored after the deploy.

**Dropping the prefix does not widen access.** A paper contains the answer key, and it
stays owner-scoped: every route filters on `recruiterId`, which is stamped server-side
from the auth token, and `firestore.rules` denies client reads of the collection
outright. The prefix was never the thing enforcing ownership — it only made the paper
unreachable from the other surface.

**A copy, not a move.** Nothing is deleted, so a rollback is redeploying the previous
build: `web_mcq_sets` is still whole and still authoritative for it. Delete it in a
separate change once the shared collection has been serving reads long enough to trust.

**Idempotent.** Re-running copies nothing it has already copied. `--force` overwrites
destination documents that already exist, which is only wanted if a bad partial run
needs redoing.

Ids are preserved, and they have to be: an interview already sent out carries
`screening.mcqSetId`, so a paper copied to a new id would leave every outstanding
invite pointing at nothing.

    # See what would happen. Reads only.
    .venv/bin/python scripts/migrate_web_mcq_sets.py --dry-run

    # Do it.
    .venv/bin/python scripts/migrate_web_mcq_sets.py

    # Redo documents a bad run left half-written.
    .venv/bin/python scripts/migrate_web_mcq_sets.py --force
"""

from __future__ import annotations

import argparse
import sys

from app import mcq
from app.config import Settings
from app.firebase import get_db

SOURCE_COLLECTION = "web_mcq_sets"

# Firestore hard-caps a batch at 500 writes. Well under, as everywhere else.
BATCH_SIZE = 400


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="report what would be copied, write nothing"
    )
    parser.add_argument(
        "--force", action="store_true", help="overwrite destination documents that already exist"
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    settings = Settings()
    client = get_db(settings)

    source = client.collection(SOURCE_COLLECTION)
    destination = mcq.sets_collection(settings)

    print(f"reading {SOURCE_COLLECTION} …")
    documents = list(source.stream())
    if not documents:
        print("nothing to migrate.")
        return 0

    existing = {snapshot.id for snapshot in destination.stream()}
    print(f"{len(documents)} paper(s) in source, {len(existing)} already in destination")

    pending: list[tuple[str, dict]] = []
    skipped = 0
    unowned = 0

    for snapshot in documents:
        data = snapshot.to_dict() or {}
        if snapshot.id in existing and not args.force:
            skipped += 1
            continue
        # Named, not fixed. A paper with no owner is unreachable through every route
        # (all of them filter on `recruiterId`), so copying it is harmless — but
        # inventing an owner here would hand somebody else's answer key to whoever this
        # script guessed.
        if not data.get("recruiterId"):
            unowned += 1
        pending.append((snapshot.id, data))

    print(
        f"to copy: {len(pending)}  already present (skipped): {skipped}"
        + (f"  with no recruiterId (copied, still unreachable): {unowned}" if unowned else "")
    )

    if args.dry_run:
        for set_id, data in pending[:10]:
            questions = len(data.get("questions") or [])
            print(f"  would write {mcq.SETS_COLLECTION}/{set_id}  ({questions} question(s))")
        if len(pending) > 10:
            print(f"  … and {len(pending) - 10} more")
        print("\ndry run — nothing written.")
        return 0

    if not pending:
        print("nothing to do.")
        return 0

    written = 0
    for start in range(0, len(pending), BATCH_SIZE):
        chunk = pending[start : start + BATCH_SIZE]
        batch = client.batch()
        for set_id, payload in chunk:
            batch.set(destination.document(set_id), payload)
        batch.commit()
        written += len(chunk)
        print(f"  {written}/{len(pending)}")

    print(f"\ncopied {written} paper(s) into {mcq.SETS_COLLECTION}.")
    print(
        f"{SOURCE_COLLECTION} is untouched — delete it in a separate change, once the "
        "shared collection has been serving reads long enough to trust."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

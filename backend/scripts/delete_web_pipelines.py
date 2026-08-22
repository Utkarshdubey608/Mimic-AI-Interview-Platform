"""Delete `web_pipelines` and `web_pipeline_candidates`. IRREVERSIBLE.

The last step of the rounds convergence, and deliberately the only destructive one.

**Do not run this as part of retiring the model.** Retiring is
`PIPELINES_WRITABLE=false`: writes stop, existing boards keep rendering, and every
document stays where it is. That is reversible by flipping the flag back. This is not.

RUN IT ONLY WHEN ALL OF THESE ARE TRUE:

  1. `scripts/migrate_pipelines_to_rounds.py` has run, and the rounds it created have
     been checked against the old board for at least one real pipeline — same rounds,
     same order, same candidate counts.
  2. `PIPELINES_WRITABLE=false` has been live long enough that anyone still relying on
     the old board has said so. Nothing new can have accumulated in that window.
  3. You have a Firestore export you could restore from. There is no undo here and no
     script that can write these documents back.

    .venv/bin/python scripts/delete_web_pipelines.py --dry-run
    .venv/bin/python scripts/delete_web_pipelines.py --i-have-a-backup
"""

from __future__ import annotations

import argparse
import sys

from app.config import Settings
from app.firebase import get_db

COLLECTIONS = ("web_pipelines", "web_pipeline_candidates")
BATCH_SIZE = 400


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="count only, delete nothing")
    parser.add_argument(
        "--i-have-a-backup",
        action="store_true",
        help="required to actually delete — there is no undo",
    )
    args = parser.parse_args()

    settings = Settings()
    client = get_db(settings)

    if settings.pipelines_writable and not args.dry_run:
        # The ordering guard. Deleting while the model still accepts writes means a
        # recruiter can create a pipeline into a collection that is being emptied.
        print(
            "REFUSED: PIPELINES_WRITABLE is still true.\n"
            "Retire the model first (set it false), let that sit, then delete."
        )
        return 2

    total = 0
    for name in COLLECTIONS:
        snapshots = list(client.collection(name).stream())
        print(f"{name}: {len(snapshots)} document(s)")
        total += len(snapshots)

        if args.dry_run or not snapshots:
            continue
        if not args.i_have_a_backup:
            print("REFUSED: pass --i-have-a-backup. There is no undo.")
            return 2

        deleted = 0
        for start in range(0, len(snapshots), BATCH_SIZE):
            batch = client.batch()
            for snapshot in snapshots[start : start + BATCH_SIZE]:
                batch.delete(snapshot.reference)
            batch.commit()
            deleted += len(snapshots[start : start + BATCH_SIZE])
            print(f"  {deleted}/{len(snapshots)}")

    if args.dry_run:
        print(f"\ndry run — {total} document(s) would be deleted permanently.")
    else:
        print(f"\nDeleted {total} document(s). The rounds model is now the only one.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

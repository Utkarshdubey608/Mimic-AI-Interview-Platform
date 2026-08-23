"""Copy `web_reports` into the shared `reports` collection, once.

`web_reports` was `web_`-prefixed, so the mobile app could not see it: a recruiter
opening a report on their phone for an interview taken in a browser got nothing. The
collection is shared now (`app/reports.py`), and this moves the reports that already
exist so the promotion applies to history and not only to new interviews.

**A copy, not a move.** Nothing is deleted. `web_reports` is left exactly as it is, so
a rollback is redeploying the previous build — the old collection is still whole and
still authoritative for it. Delete it in a later, separate change, once the shared
collection has been serving reads in production long enough to trust.

**Idempotent.** Re-running copies nothing it has already copied, so it is safe to run
twice, and safe to re-run after a partial failure. `--force` overwrites destination
documents that already exist, which is only wanted if a bad partial run needs redoing.

The key does not change. A report has always been keyed by `sessionId`, and the session
id IS the interview id, so `web_reports/{sessionId}` becomes `reports/{sessionId}` at
the same address. `interviewId` is stamped alongside it — same value, a name that means
something to a reader who knows nothing about web sessions.

    # See what would happen. Reads only.
    .venv/bin/python scripts/migrate_web_reports.py --dry-run

    # Do it.
    .venv/bin/python scripts/migrate_web_reports.py

    # Redo documents a bad run left half-written.
    .venv/bin/python scripts/migrate_web_reports.py --force
"""

from __future__ import annotations

import argparse
import sys

from app import reports
from app.config import Settings
from app.firebase import get_db

SOURCE_COLLECTION = "web_reports"

# Firestore hard-caps a batch at 500 writes. Well under, as every other batched write
# in this codebase does.
BATCH_SIZE = 400


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would be copied, write nothing",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="overwrite destination documents that already exist",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    settings = Settings()
    client = get_db(settings)

    source = client.collection(SOURCE_COLLECTION)
    destination = reports.collection(settings)

    print(f"reading {SOURCE_COLLECTION} …")
    documents = list(source.stream())
    if not documents:
        print("nothing to migrate.")
        return 0

    # Which destination ids already exist, read once rather than per document.
    existing = {snapshot.id for snapshot in destination.stream()}
    print(f"{len(documents)} report(s) in source, {len(existing)} already in destination")

    pending: list[tuple[str, dict]] = []
    skipped = 0
    unkeyed = 0

    for snapshot in documents:
        data = snapshot.to_dict() or {}

        # The document id is authoritative. A stored body whose id field disagrees
        # (possible for anything hand-edited in the console) would otherwise be copied
        # to an address nothing can look it up by.
        interview_id = snapshot.id
        if not interview_id:
            unkeyed += 1
            continue

        if interview_id in existing and not args.force:
            skipped += 1
            continue

        pending.append((interview_id, reports.stamp_ids(data, interview_id)))

    print(
        f"to copy: {len(pending)}  already present (skipped): {skipped}"
        + (f"  unkeyed (ignored): {unkeyed}" if unkeyed else "")
    )
    if args.force and skipped == 0 and existing:
        print("(--force: destination documents will be overwritten)")

    if args.dry_run:
        for interview_id, _ in pending[:10]:
            print(f"  would write reports/{interview_id}")
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
        for interview_id, payload in chunk:
            batch.set(destination.document(interview_id), payload)
        batch.commit()
        written += len(chunk)
        print(f"  {written}/{len(pending)}")

    print(f"\ncopied {written} report(s) into {reports.REPORTS_COLLECTION}.")
    print(
        f"{SOURCE_COLLECTION} is untouched — delete it in a separate change, once the "
        "shared collection has been serving reads long enough to trust."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

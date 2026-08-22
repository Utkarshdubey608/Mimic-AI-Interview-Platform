"""Stamp `companyKey` on templates and question sets. Run BEFORE enabling scoping.

`web_templates` and `web_question_sets` were read with `.all()`, so every recruiter on
the deployment saw every other recruiter's interview templates and question sets. On the
Express server "shared across recruiters" meant one company's recruiters; on a common
backend it means everyone.

Scoping them needs a key on each document, and this derives it from the author's
profile: `web_templates/{id}.recruiterId` → `users/{uid}.companyKey`.

**Run this and check the report before setting `COMPANY_SCOPING_ENABLED=true`.** The
order matters: switching the reads first hides every document this would have keyed.

**What it deliberately cannot fix.** A document with no `recruiterId` has no author to
resolve a company from — authorship was only recorded recently, so these are the
majority of what exists on an older deployment. They are reported, not guessed at:
`users.visible_to` keeps them visible to everyone, exactly as they are today, because
hiding years of work reads as data loss while guessing wrong shows one company
another's material. The count below is how much of the leak survives the migration, and
it is the number worth arguing about.

    .venv/bin/python scripts/backfill_company_keys.py --dry-run
    .venv/bin/python scripts/backfill_company_keys.py
"""

from __future__ import annotations

import argparse
import sys

from app.config import Settings
from app.firebase import get_db
from app.web.shared import company

COLLECTIONS = ("web_templates", "web_question_sets")
BATCH_SIZE = 400


def _company_of(client, uid: str, cache: dict) -> str:
    """The recruiter's normalised company, cached — a deployment has few recruiters."""
    if uid in cache:
        return cache[uid]
    key = ""
    try:
        snapshot = client.collection("users").document(uid).get()
        if snapshot.exists:
            data = snapshot.to_dict() or {}
            key = company.company_key(data.get("companyKey") or data.get("company"))
    except Exception as exc:  # noqa: BLE001 - reported per document
        print(f"  ! could not read users/{uid}: {exc}")
    cache[uid] = key
    return key


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="write nothing")
    parser.add_argument(
        "--force",
        action="store_true",
        help="overwrite a companyKey that is already set",
    )
    args = parser.parse_args()

    client = get_db(Settings())
    cache: dict = {}
    grand_total = {"keyed": 0, "already": 0, "no_author": 0, "no_company": 0}

    for name in COLLECTIONS:
        print(f"\n── {name} ──")
        documents = list(client.collection(name).stream())
        if not documents:
            print("  empty.")
            continue

        pending: list[tuple[str, str]] = []
        already = no_author = no_company = 0

        for snapshot in documents:
            data = snapshot.to_dict() or {}

            existing = company.company_key(data.get("companyKey"))
            if existing and not args.force:
                already += 1
                continue

            uid = str(data.get("recruiterId") or "")
            if not uid:
                # Unattributable. Stays visible to everyone — see the module docstring.
                no_author += 1
                continue

            key = _company_of(client, uid, cache)
            if not key:
                # The author exists but has no company recorded. Their own documents
                # stay visible to them via the author rule; nothing is guessed.
                no_company += 1
                continue

            pending.append((snapshot.id, key))

        print(f"  {len(documents)} document(s)")
        print(f"    to key:                  {len(pending)}")
        print(f"    already keyed:           {already}")
        print(f"    no author (stay public): {no_author}")
        print(f"    author has no company:   {no_company}")

        grand_total["keyed"] += len(pending)
        grand_total["already"] += already
        grand_total["no_author"] += no_author
        grand_total["no_company"] += no_company

        if args.dry_run or not pending:
            continue

        written = 0
        for start in range(0, len(pending), BATCH_SIZE):
            chunk = pending[start : start + BATCH_SIZE]
            batch = client.batch()
            for doc_id, key in chunk:
                batch.set(
                    client.collection(name).document(doc_id),
                    {"companyKey": key},
                    merge=True,
                )
            batch.commit()
            written += len(chunk)
            print(f"    {written}/{len(pending)}")

    print("\n── summary ──")
    for label, count in grand_total.items():
        print(f"  {label}: {count}")

    unscoped = grand_total["no_author"]
    if unscoped:
        print(
            f"\n  ⚠ {unscoped} document(s) have no author and stay visible to EVERY "
            "recruiter on the deployment. That is how much of the leak survives this "
            "migration. Attributing them means guessing, and guessing wrong shows one "
            "company another's material — so it is a decision to take deliberately, "
            "per document, not in a script."
        )

    if args.dry_run:
        print("\ndry run — nothing written.")
    else:
        print("\nDone. Now set COMPANY_SCOPING_ENABLED=true (it defaults on).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

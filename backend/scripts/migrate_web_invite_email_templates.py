"""Copy `web_invite_email_templates` into the shared `email_templates`, once.

The web surface kept its own template store, so a recruiter's saved invite email
existed on exactly one client. The collection is shared now
(`app/templates_store.py`), and this moves the templates that already exist so the
unification applies to history and not only to new ones.

**A copy, not a move.** Nothing is deleted, so a rollback is redeploying the previous
build. Delete the old collection in a separate, later change.

**It adds the two compatibility fields**, which is the point of doing this rather than
a console copy: the mobile surface stores the body as `body` + `isHtml` and scopes by
`ownerEmail`, so a document carrying only `bodyHtml` and `recruiterId` renders an empty
email on the phone and cannot be found by its list query at all.

`ownerEmail` is resolved from `users/{recruiterId}` — the templates were written with
an owner uid but no address, because this surface never needed one.

    .venv/bin/python scripts/migrate_web_invite_email_templates.py --dry-run
    .venv/bin/python scripts/migrate_web_invite_email_templates.py
"""

from __future__ import annotations

import argparse
import sys

from app import templates_store
from app.config import Settings
from app.firebase import get_db

SOURCE_COLLECTION = "web_invite_email_templates"
BATCH_SIZE = 400


def _owner_email(client, recruiter_id: str, cache: dict) -> str:
    """The recruiter's address, for `ownerEmail`. Cached — a batch shares owners."""
    if not recruiter_id:
        return ""
    if recruiter_id in cache:
        return cache[recruiter_id]
    email = ""
    try:
        snapshot = client.collection("users").document(recruiter_id).get()
        if snapshot.exists:
            data = snapshot.to_dict() or {}
            email = str(data.get("emailLower") or data.get("email") or "")
    except Exception as exc:  # noqa: BLE001 - reported per document below
        print(f"  ! could not read users/{recruiter_id}: {exc}")
    cache[recruiter_id] = email
    return email


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="write nothing")
    parser.add_argument(
        "--force", action="store_true", help="overwrite destinations that already exist"
    )
    args = parser.parse_args()

    settings = Settings()
    client = get_db(settings)
    source = client.collection(SOURCE_COLLECTION)
    destination = client.collection(templates_store.TEMPLATES_COLLECTION)

    print(f"reading {SOURCE_COLLECTION} …")
    documents = list(source.stream())
    if not documents:
        print("nothing to migrate.")
        return 0

    existing = {snapshot.id for snapshot in destination.stream()}
    print(f"{len(documents)} template(s) in source, {len(existing)} doc(s) already in destination")

    cache: dict = {}
    pending: list[tuple[str, dict]] = []
    skipped = 0
    ownerless = 0

    for snapshot in documents:
        data = snapshot.to_dict() or {}
        if snapshot.id in existing and not args.force:
            skipped += 1
            continue

        recruiter_id = str(data.get("recruiterId") or "")
        email = _owner_email(client, recruiter_id, cache)
        if not email:
            # Kept, but flagged. `recruiterId` still scopes it correctly on the web;
            # it just will not appear on the phone until an address is known.
            ownerless += 1

        pending.append(
            (
                snapshot.id,
                {
                    **data,
                    **templates_store.compatibility_fields(
                        subject=str(data.get("subject") or ""),
                        body_html=str(data.get("bodyHtml") or ""),
                        owner_email=email,
                    ),
                },
            )
        )

    print(f"to copy: {len(pending)}  already present (skipped): {skipped}")
    if ownerless:
        print(
            f"  ⚠ {ownerless} template(s) have no resolvable owner address — they stay "
            "visible on the web but not on the phone until one is known"
        )

    if args.dry_run:
        for template_id, payload in pending[:10]:
            print(f"  would write email_templates/{template_id} (owner {payload['ownerEmail'] or '?'})")
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
        for template_id, payload in chunk:
            batch.set(destination.document(template_id), payload)
        batch.commit()
        written += len(chunk)
        print(f"  {written}/{len(pending)}")

    print(f"\ncopied {written} template(s) into {templates_store.TEMPLATES_COLLECTION}.")
    print(f"{SOURCE_COLLECTION} is untouched — delete it in a separate change.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Firestore access primitives for the web surface.

The Express server kept everything in memory and snapshotted it to a JSON file
(`server/store/db.ts`). That store cannot back a shared backend: it is
single-instance, disk-bound, and invisible to the mobile app. These classes are
its replacement.

**Two design decisions worth knowing.**

*Every method is async and wraps the blocking call in `asyncio.to_thread`.* The
Admin SDK's Firestore client is synchronous, so calling it directly from an
`async def` handler blocks the event loop for the whole round trip. The session
engine polls state, saves drafts and appends transcript turns, so this path is
hot enough that blocking it would serialise every other request behind it.
`app.mailer` already uses `to_thread` for the same reason.

*There is no read cache.* The Express store answered reads from memory, and
mirroring that here would be faster — but a cache that is written by one process
and read by another is wrong the moment this service runs more than one worker,
which it must to serve web, mobile and desktop. `Collection` is the seam: if
measurement later shows the session engine needs a cache, it goes here, behind
these same methods, with a single-instance constraint documented at that point.
Correctness first.

Documents keep the web frontend's camelCase field names, and carry their own id
in the document body as well as the Firestore document id — the JSON store's
objects had an `id` field and the ported routes return those objects verbatim.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger("web.store")

# Firestore's `in` operator caps at 30 values per query, and a single batched
# write caps at 500 operations. Both are hard service limits, not tuning knobs.
MAX_IN_CLAUSE = 30
MAX_BATCH_OPS = 500


class Collection:
    """One Firestore collection, keyed by a document field (usually `id`).

    `key_field` exists because the JSON store did not key every collection by
    `id`: reports were keyed by `sessionId`. Keeping that mapping here means the
    ported route code does not have to know about it.
    """

    def __init__(self, client: Any, name: str, *, key_field: str = "id") -> None:
        self._client = client
        self.name = name
        self.key_field = key_field

    # ── reads ────────────────────────────────────────────────────────────────

    async def get(self, doc_id: str) -> dict | None:
        """One document, or None. Never raises for a missing document."""
        if not doc_id:
            return None

        def _read() -> dict | None:
            snap = self._client.collection(self.name).document(doc_id).get()
            return _with_id(snap, self.key_field) if snap.exists else None

        return await asyncio.to_thread(_read)

    async def all(self) -> list[dict]:
        """Every document. Only for collections that stay small.

        Deliberately NOT used for sessions or reports — those are always read
        through `where()` so one recruiter's list does not scan the tenant.
        """

        def _read() -> list[dict]:
            return _parse_all(
                self._client.collection(self.name).stream(), self.key_field, self.name
            )

        return await asyncio.to_thread(_read)

    async def where(self, field: str, op: str, value: Any) -> list[dict]:
        """Documents matching one filter — the owner-scoped list every route needs."""

        def _read() -> list[dict]:
            from google.cloud.firestore_v1.base_query import FieldFilter

            query = self._client.collection(self.name).where(
                filter=FieldFilter(field, op, value)
            )
            return _parse_all(query.stream(), self.key_field, self.name)

        return await asyncio.to_thread(_read)

    async def owned_by(self, recruiter_id: str) -> list[dict]:
        """Documents this recruiter owns. Empty for a blank id — never everything.

        The blank guard is not defensive padding: `where('recruiterId', '==', '')`
        is a perfectly valid query that would match every legacy document written
        before ownership was stamped, and hand them to whoever asked.
        """
        if not recruiter_id:
            return []
        return await self.where("recruiterId", "==", recruiter_id)

    # ── writes ───────────────────────────────────────────────────────────────

    async def put(self, doc: dict) -> dict:
        """Upsert by `key_field`, replacing the document. Returns what was stored.

        A full replace rather than a merge: the ported routes read an object,
        mutate it and save the whole thing back, exactly as they did against the
        in-memory store. A merge would silently keep fields the caller deleted.
        """
        doc_id = str(doc.get(self.key_field) or "")
        if not doc_id:
            raise ValueError(f"{self.name}: document has no {self.key_field}")

        def _write() -> None:
            self._client.collection(self.name).document(doc_id).set(doc)

        await asyncio.to_thread(_write)
        return doc

    async def patch(self, doc_id: str, fields: dict) -> None:
        """Merge specific fields into a document.

        For the high-frequency single-field updates (timing ticks, draft text) a
        merge avoids reading and rewriting a whole session document.
        """
        if not doc_id or not fields:
            return

        def _write() -> None:
            self._client.collection(self.name).document(doc_id).set(fields, merge=True)

        await asyncio.to_thread(_write)

    async def add(self, doc: dict) -> dict:
        """Append with a Firestore-generated id, stamping it into the body.

        For the append-only collections (leads) where the caller has no id to
        supply and nothing ever looks a document up by one.
        """

        def _write() -> dict:
            ref = self._client.collection(self.name).document()
            stored = {**doc, self.key_field: ref.id}
            ref.set(stored)
            return stored

        return await asyncio.to_thread(_write)

    async def delete(self, doc_id: str) -> None:
        """Remove a document. Deleting a missing document is not an error."""
        if not doc_id:
            return

        def _write() -> None:
            self._client.collection(self.name).document(doc_id).delete()

        await asyncio.to_thread(_write)

    async def put_many(self, docs: list[dict]) -> int:
        """Write many documents in batches. Returns how many were written.

        Used by the bulk-invite flow and the one-off `db.json` import, both of
        which write far more documents than a single batch allows.
        """
        if not docs:
            return 0

        def _write() -> int:
            written = 0
            for start in range(0, len(docs), MAX_BATCH_OPS):
                chunk = docs[start : start + MAX_BATCH_OPS]
                batch = self._client.batch()
                for doc in chunk:
                    doc_id = str(doc.get(self.key_field) or "")
                    if not doc_id:
                        raise ValueError(
                            f"{self.name}: document has no {self.key_field}"
                        )
                    batch.set(self._client.collection(self.name).document(doc_id), doc)
                batch.commit()
                written += len(chunk)
            return written

        return await asyncio.to_thread(_write)


class SingletonDocument:
    """A collection holding exactly one document — the store's `settings` object.

    Kept as a one-document collection rather than a top-level document because
    Firestore has no root-level documents: everything lives under a collection.
    """

    def __init__(self, client: Any, name: str, *, doc_id: str = "global") -> None:
        self._client = client
        self.name = name
        self.doc_id = doc_id

    async def get(self) -> dict:
        """The document, or `{}` when it has never been written."""

        def _read() -> dict:
            snap = self._client.collection(self.name).document(self.doc_id).get()
            return (snap.to_dict() or {}) if snap.exists else {}

        return await asyncio.to_thread(_read)

    async def merge(self, fields: dict) -> dict:
        """Merge fields in and return the resulting document.

        A merge, not a replace: the settings object accumulates independently
        managed sections (the Gemini key, the Tavus key, the applied avatar
        config) and each is saved by a different endpoint. Replacing would make
        saving one section clear the others.
        """
        if fields:

            def _write() -> None:
                self._client.collection(self.name).document(self.doc_id).set(
                    fields, merge=True
                )

            await asyncio.to_thread(_write)
        return await self.get()

    async def unset(self, *field_names: str) -> dict:
        """Delete fields (clearing a saved API key) and return the result."""
        if field_names:
            from google.cloud.firestore_v1 import DELETE_FIELD

            def _write() -> None:
                self._client.collection(self.name).document(self.doc_id).set(
                    {name: DELETE_FIELD for name in field_names}, merge=True
                )

            await asyncio.to_thread(_write)
        return await self.get()


def _parse_all(snapshots: Any, key_field: str, collection_name: str) -> list[dict]:
    """Every document, DROPPING any single one that cannot be parsed.

    Adopted from the Flutter client, where `InterviewRepository._parseDocs` has always
    worked this way and says why: one malformed record must not break the whole
    dashboard. Here a list comprehension over `stream()` meant a single document —
    hand-edited in the console, written by an older build, or half-written by a failed
    batch — could raise and empty a recruiter's entire templates list, with the symptom
    reading as "you have nothing" rather than "one row is broken".

    Logged with the id, so a persistently unreadable document is findable rather than
    merely absent. Never silent.
    """
    parsed: list[dict] = []
    for snapshot in snapshots:
        try:
            parsed.append(_with_id(snapshot, key_field))
        except Exception as exc:  # noqa: BLE001 - one bad row must not empty a list
            logger.warning(
                "%s: skipping unreadable document %s: %s",
                collection_name,
                getattr(snapshot, "id", "?"),
                exc,
            )
    return parsed


def _with_id(snapshot: Any, key_field: str) -> dict:
    """A document's data with its id guaranteed present under `key_field`.

    The Firestore document id is authoritative. A stored body whose id field
    disagrees (possible for anything hand-edited in the console) would otherwise
    produce an object the client cannot address, since it round-trips that field
    back on save.
    """
    return {**(snapshot.to_dict() or {}), key_field: snapshot.id}

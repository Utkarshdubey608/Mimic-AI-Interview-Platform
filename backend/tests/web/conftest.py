"""In-memory storage for the web surface's tests.

Without this, anything that reaches `get_store` makes a real Firestore round trip:
`gemini.resolve_key` reads the saved-key document on every call, so a handful of
unit tests turned the suite from six seconds into eighty. Worse, the tests would
then depend on a live project and on whatever happens to be in it.

`get_store` caches its result in a module-level `_store`, so seeding that is enough
to redirect every caller regardless of how they imported it — patching
`app.web.store.get_store` would miss the modules that did
`from app.web.store import get_store` at import time.

The fake implements the same interface as `Collection` / `SingletonDocument`, so a
test can seed data and assert on writes. Anything that genuinely needs Firestore
should be a separate, explicitly-marked integration check — not a unit test.
"""

from __future__ import annotations

import copy
from typing import Any

import pytest

from app.web.store import db as store_db


def _at_path(doc: dict, field: str) -> Any:
    """Read a possibly-dotted field path, as Firestore does.

    `where("candidate.email", ...)` is a real query on this data, so the fake has to
    resolve it too — otherwise a test would pass against a lookup production performs
    differently.
    """
    current: Any = doc
    for part in field.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


class FakeCollection:
    """A dict standing in for one Firestore collection.

    Documents are deep-copied on the way in and out, which matters: the real client
    returns a fresh dict per read, and a test that mutated a shared reference would
    pass against the fake and fail in production.
    """

    def __init__(self, name: str, *, key_field: str = "id") -> None:
        self.name = name
        self.key_field = key_field
        self.docs: dict[str, dict] = {}
        self._next_id = 0

    async def get(self, doc_id: str) -> dict | None:
        if not doc_id:
            return None
        found = self.docs.get(doc_id)
        return copy.deepcopy(found) if found else None

    async def all(self) -> list[dict]:
        return [copy.deepcopy(doc) for doc in self.docs.values()]

    async def where(self, field: str, op: str, value: Any) -> list[dict]:
        if op != "==":
            raise NotImplementedError(f"fake store supports '==' only, got {op!r}")
        return [
            copy.deepcopy(doc) for doc in self.docs.values() if _at_path(doc, field) == value
        ]

    async def owned_by(self, recruiter_id: str) -> list[dict]:
        if not recruiter_id:
            return []
        return await self.where("recruiterId", "==", recruiter_id)

    async def put(self, doc: dict) -> dict:
        doc_id = str(doc.get(self.key_field) or "")
        if not doc_id:
            raise ValueError(f"{self.name}: document has no {self.key_field}")
        self.docs[doc_id] = copy.deepcopy(doc)
        return doc

    async def patch(self, doc_id: str, fields: dict) -> None:
        if not doc_id or not fields:
            return
        self.docs.setdefault(doc_id, {self.key_field: doc_id}).update(
            copy.deepcopy(fields)
        )

    async def add(self, doc: dict) -> dict:
        self._next_id += 1
        doc_id = f"{self.name}-{self._next_id}"
        stored = {**copy.deepcopy(doc), self.key_field: doc_id}
        self.docs[doc_id] = stored
        return copy.deepcopy(stored)

    async def delete(self, doc_id: str) -> None:
        self.docs.pop(doc_id, None)

    async def put_many(self, docs: list[dict]) -> int:
        for doc in docs:
            await self.put(doc)
        return len(docs)


class FakeSingleton:
    def __init__(self, name: str, *, doc_id: str = "global") -> None:
        self.name = name
        self.doc_id = doc_id
        self.doc: dict = {}

    async def get(self) -> dict:
        return copy.deepcopy(self.doc)

    async def merge(self, fields: dict) -> dict:
        self.doc.update(copy.deepcopy(fields))
        return await self.get()

    async def unset(self, *field_names: str) -> dict:
        for name in field_names:
            self.doc.pop(name, None)
        return await self.get()


class FakeStore:
    """Mirrors `WebStore`'s attributes, so a missing one fails loudly here too."""

    def __init__(self) -> None:
        prefix = store_db.PREFIX
        self.templates = FakeCollection(f"{prefix}templates")
        self.question_sets = FakeCollection(f"{prefix}question_sets")
        # Owner-scoped, unlike question_sets — it holds answer keys. See db.py.
        self.mcq_sets = FakeCollection(f"{prefix}mcq_sets")
        self.invite_email_templates = FakeCollection(f"{prefix}invite_email_templates")
        self.sessions = FakeCollection(f"{prefix}sessions")
        self.reports = FakeCollection(f"{prefix}reports", key_field="sessionId")
        self.pipelines = FakeCollection(f"{prefix}pipelines")
        self.pipeline_candidates = FakeCollection(f"{prefix}pipeline_candidates")
        self.feedback = FakeCollection(f"{prefix}feedback", key_field="sessionId")
        self.leads = FakeCollection(f"{prefix}leads")
        self.voice_jobs = FakeCollection(f"{prefix}voice_jobs")
        self.settings = FakeSingleton(f"{prefix}settings")


@pytest.fixture
def authed_client(request: pytest.FixtureRequest):
    """A `TestClient` whose requests arrive as an already-verified user.

    Overriding the dependency rather than minting a token: verifying a real Firebase
    ID token needs the live Admin SDK and a real signed credential, neither of which
    belongs in a unit test. The token path itself is covered by asserting the 401
    when no header is sent.

    Parameterise the caller with `@pytest.mark.parametrize` on `authed_user`, or use
    the default recruiter identity.
    """
    from fastapi.testclient import TestClient

    from app.main import create_app
    from app.security import AuthedUser, require_firebase_user
    from app.web.deps import web_user_from_query

    marker = request.node.get_closest_marker("authed_user")
    user = (
        marker.args[0]
        if marker and marker.args
        else AuthedUser(
            uid="uid-recruiter",
            email="recruiter@talbotiq.com",
            claims={"email_verified": True},
        )
    )

    app = create_app()
    app.state.settings = hermetic_settings()
    # BOTH auth entry points. `web_user_from_query` calls `require_firebase_user` as
    # a plain function rather than through Depends — it has to, because it decides
    # between the header and the query parameter first — so overriding only the
    # latter would leave the `?token=` routes (the face cache, the WebSocket
    # upgrades) still demanding a real Firebase token.
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    client = TestClient(app)
    client.authed_user = user  # type: ignore[attr-defined]
    try:
        yield client
    finally:
        app.dependency_overrides.clear()


# Every vendor credential a web route consults. Blanked by default so a unit test
# asserts on the code, not on whichever keys happen to sit in the developer's .env.
# This has bitten twice: an ambient EMAIL_APP_PASSWORD once satisfied a requirement a
# test asserted was missing, and adding HUME_API_KEY later broke an unconfigured-Hume
# test on one machine while passing on another.
VENDOR_KEYS = (
    "gemini_api_key",
    "hume_api_key",
    "deepgram_api_key",
    "tavus_api_key",
    "daily_api_key",
    "aws_access_key_id",
    "aws_secret_access_key",
    "brevo_api_key",
    "brevo_webhook_secret",
    "firebase_storage_bucket",
    "email_app_password",
    "smtp_pass",
)


def hermetic_settings(**overrides):
    """Settings with every vendor credential blank unless a test asks for one.

    A test that needs a configured vendor states so explicitly, which is also what
    makes the test readable — the precondition is on the page instead of in a file
    that is not checked in.
    """
    from app.config import Settings

    base = Settings()
    blanked = {key: "" for key in VENDOR_KEYS}
    return base.model_copy(update={**blanked, **overrides})


class FakeDocument:
    def __init__(self, collection: "FakeFirestoreCollection", doc_id: str) -> None:
        self._collection = collection
        self.id = doc_id

    def delete(self) -> None:
        self._collection.deleted.append(self.id)
        self._collection.docs.pop(self.id, None)

    def set(self, data: dict, merge: bool = False) -> None:
        if merge:
            self._collection.docs.setdefault(self.id, {}).update(copy.deepcopy(data))
        else:
            self._collection.docs[self.id] = copy.deepcopy(data)

    def get(self):
        raise NotImplementedError(
            "a web unit test read the shared interviews collection; seed it explicitly"
        )


class FakeFirestoreCollection:
    def __init__(self, name: str) -> None:
        self.name = name
        self.docs: dict[str, dict] = {}
        self.deleted: list[str] = []

    def document(self, doc_id: str) -> FakeDocument:
        return FakeDocument(self, doc_id)


class FakeFirestoreClient:
    """Stands in for the shared (non-web) Firestore client.

    `fake_store` only covers the `web_*` collections. A handful of web routes also
    touch the SHARED `interviews` collection — the one the Flutter app reads — through
    `interview_invite.interviews()`, which goes straight to `firebase.get_db`. Without
    this, those tests silently read and wrote the live Firebase project: the pipeline
    move-back test was doing exactly that, and passed only because the developer's real
    credentials happened to be loaded.
    """

    def __init__(self) -> None:
        self.collections: dict[str, FakeFirestoreCollection] = {}

    def collection(self, name: str) -> FakeFirestoreCollection:
        return self.collections.setdefault(name, FakeFirestoreCollection(name))


@pytest.fixture(autouse=True)
def fake_firestore(monkeypatch) -> FakeFirestoreClient:
    """No web unit test reaches the real project, for any collection."""
    from app import firebase

    client = FakeFirestoreClient()
    monkeypatch.setattr(firebase, "get_db", lambda settings: client)
    # Modules that did `from app.firebase import get_db` at import time hold their own
    # reference, so patching the source module alone would miss them.
    for module_name in ("app.web.services.interview_invite", "app.interviews"):
        try:
            module = __import__(module_name, fromlist=["get_db"])
        except ImportError:
            continue
        if hasattr(module, "get_db"):
            monkeypatch.setattr(module, "get_db", lambda settings: client)
    return client


@pytest.fixture(autouse=True)
def fake_store() -> FakeStore:
    """Redirect the web store to memory for every test in this package.

    Autouse so a new test cannot accidentally reach the live project — that is a
    slow, flaky dependency and, on a shared Firebase project, a destructive one.
    """
    store = FakeStore()
    previous = store_db._store
    store_db._store = store
    try:
        yield store
    finally:
        store_db._store = previous

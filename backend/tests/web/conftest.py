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
from datetime import datetime, timezone
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
        # Coding interview mode. Mirrors WebStore; a collection missing here is an
        # AttributeError at request time rather than a failing assertion.
        self.coding_problems = FakeCollection(f"{prefix}coding_problems")
        self.code_submissions = FakeCollection(f"{prefix}code_submissions")
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


# What the fake resolves SERVER_TIMESTAMP to.
#
# Fixed rather than `now()` so a test can assert on it, and a real datetime rather than
# the sentinel because Firestore resolves it server-side — a fake that STORED the
# sentinel means anything reading a timestamp back gets an object no parser accepts.
# That is not a hypothetical: it made a round that had just been ended read back as
# open, because `closedAt` came out as a sentinel and degraded to None.
FAKE_SERVER_TIME = datetime(2027, 6, 1, 12, 0, tzinfo=timezone.utc)


def _is_server_timestamp(value) -> bool:
    try:
        from firebase_admin import firestore as admin_firestore

        if value is admin_firestore.SERVER_TIMESTAMP:
            return True
    except Exception:  # noqa: BLE001 - the repr fallback still works
        pass
    return "SERVER_TIMESTAMP" in repr(value)


def _resolved(value):
    """A value as Firestore would STORE it, with sentinels applied."""
    return FAKE_SERVER_TIME if _is_server_timestamp(value) else value


def _is_delete_sentinel(value) -> bool:
    """Whether this is Firestore's DELETE_FIELD.

    Identity-checked against the real sentinel when firebase_admin is importable, with
    a repr fallback so the fake does not hard-depend on it.
    """
    try:
        from firebase_admin import firestore as admin_firestore

        if value is admin_firestore.DELETE_FIELD:
            return True
    except Exception:  # noqa: BLE001 - the fallback below still works
        pass
    return "DELETE_FIELD" in repr(value)


class FakeSnapshot:
    """What `DocumentReference.get()` returns: `.exists`, `.id`, `.to_dict()`.

    Deep-copied on the way out, as the real client is: a route that mutated what it
    read would pass against a shared dict and fail in production.
    """

    def __init__(self, doc_id: str, data: dict | None, reference: Any = None) -> None:
        self.id = doc_id
        self._data = data
        # The real snapshot carries the reference it came from, and batched writes go
        # through it (`batch.update(snapshot.reference, …)`). Without it a query result
        # cannot be written back, which is most of what the round writer does.
        self.reference = reference

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> dict | None:
        return copy.deepcopy(self._data) if self._data is not None else None


class FakeDocument:
    def __init__(self, collection: "FakeFirestoreCollection", doc_id: str) -> None:
        self._collection = collection
        self.id = doc_id

    def delete(self) -> None:
        self._collection.deleted.append(self.id)
        self._collection.docs.pop(self.id, None)

    def set(self, data: dict, merge: bool = False) -> None:
        resolved = {k: _resolved(v) for k, v in copy.deepcopy(data).items()}
        if merge:
            self._collection.docs.setdefault(self.id, {}).update(resolved)
        else:
            self._collection.docs[self.id] = resolved

    def update(self, data: dict) -> None:
        """Merge fields into an existing document, as the Admin SDK's update does.

        The invite route calls this to stamp the send result onto each interview
        after mailing it, so without it the invite path could not be tested past
        the write — which is how a mode missing from MODE_LABELS stayed invisible.

        **Dotted keys write into the nested map**, exactly as Firestore does, because
        that behaviour is the entire point of the outcome writes: `result.outcome`
        must set one key inside `result` and leave the recruiter's evaluation — the
        score, the summary, the candidate's stored answers — untouched. A flat
        `dict.update` would instead create a literal `"result.outcome"` key beside the
        real map, so a test asserting the evaluation survived would pass while
        production silently did something else.
        """
        document = self._collection.docs.setdefault(self.id, {})
        for key, raw in copy.deepcopy(data).items():
            value = _resolved(raw)
            # Firestore's DELETE_FIELD sentinel REMOVES the field rather than storing
            # the sentinel. Modelled because "clear this result" is a real action, and
            # a fake that stored the sentinel would let a test assert the field was
            # gone while production left an unreadable object on the document.
            delete = _is_delete_sentinel(value)
            if "." not in key:
                if delete:
                    document.pop(key, None)
                else:
                    document[key] = value
                continue
            *path, leaf = key.split(".")
            target = document
            for part in path:
                nested = target.get(part)
                if not isinstance(nested, dict):
                    nested = {}
                    target[part] = nested
                target = nested
            if delete:
                target.pop(leaf, None)
            else:
                target[leaf] = value

    def collection(self, name: str) -> "FakeFirestoreCollection":
        """A SUBcollection under this document.

        Needed once rounds became shared: they live at `tests/{testId}/rounds/{roundId}`
        — a subcollection deliberately, because a round is never read outside its test
        and nesting keeps the security rule to a single `recruiterId` check.

        Keyed by full path so two tests' rounds cannot collide, which a flat
        name-keyed store would have let happen silently.
        """
        return self._collection.subcollection(self.id, name)

    def get(self) -> "FakeSnapshot":
        """A snapshot of this document, as the Admin SDK returns.

        This used to raise NotImplementedError, with the message "seed it explicitly" —
        a guard from when NOTHING on the web surface read the shared collections by id,
        so any call here meant a test had wandered into the live project.

        That is no longer true. The sessions list reads `interviews/{id}` for the score
        of an interview taken on the phone, and the report route reads it plus
        `reports/{id}` for one this surface never ran. Both are deliberate reads of
        shared data, so the fake models them. The guard it replaces is still in force
        by other means: `fake_firestore` is autouse, so `get_db` never reaches Firebase
        in a web unit test regardless.

        A missing document is `exists == False`, not an error — which is exactly the
        distinction the routes branch on.
        """
        return FakeSnapshot(self.id, self._collection.docs.get(self.id), self)


class FakeFirestoreCollection:
    def __init__(self, name: str) -> None:
        self.name = name
        self.docs: dict[str, dict] = {}
        self.deleted: list[str] = []
        self._next_id = 0
        self._subcollections: dict[str, "FakeFirestoreCollection"] = {}

    def document(self, doc_id: str | None = None) -> FakeDocument:
        """A reference. With no id, one is minted — as `collection.document()` does.

        The auto-id form is what batched creates use (`batch.set(col.document(), …)`),
        so requiring an id made every batched insert unreachable in a test.
        """
        if doc_id is None:
            self._next_id += 1
            doc_id = f"auto-{self.name.replace('/', '-')}-{self._next_id}"
        return FakeDocument(self, doc_id)

    def subcollection(self, doc_id: str, name: str) -> "FakeFirestoreCollection":
        key = f"{self.name}/{doc_id}/{name}"
        return self._subcollections.setdefault(key, FakeFirestoreCollection(key))

    def add(self, document: dict) -> tuple[object, FakeDocument]:
        """Append with a generated id, returning `(write_result, reference)`.

        The real Admin SDK returns that pair and the invite route indexes `[1]` for
        the reference, so the shape matters as much as the write. Added because the
        MCQ journey test sends a real invite: without `add`, the whole invite path —
        the one where a mode missing from MODE_LABELS made finished papers
        unsendable — could not be exercised by any test at all.
        """
        self._next_id += 1
        doc_id = f"fake-{self.name}-{self._next_id}"
        self.docs[doc_id] = dict(document)
        return (None, FakeDocument(self, doc_id))

    def where(
        self,
        field: str | None = None,
        op: str | None = None,
        value: Any = None,
        *,
        filter: Any = None,  # noqa: A002 - the Admin SDK's own parameter name
    ) -> "FakeQuery":
        """An owner-scoped query, as the routes build.

        Added because the sessions list reads `interviews.where("recruiterId", ...)` to
        find interviews with no web session — the ones taken on the phone. Without it
        that call raised AttributeError, and the route catches everything (it is a
        convenience list that must never blank out the real rows), so the interviews
        came back silently empty and a test asserting they appear could not tell the
        difference between "the feature is broken" and "the fake cannot answer".
        """
        return FakeQuery(self, [_as_filter(field, op, value, filter)])

    def stream(self):
        return [
            FakeSnapshot(doc_id, data, self.document(doc_id))
            for doc_id, data in self.docs.items()
        ]


class FakeQuery:
    """A chain of equality filters over one fake collection."""

    def __init__(
        self, collection: "FakeFirestoreCollection", filters: list[tuple[str, str, Any]]
    ) -> None:
        self._collection = collection
        self._filters = filters

    def where(
        self,
        field: str | None = None,
        op: str | None = None,
        value: Any = None,
        *,
        filter: Any = None,  # noqa: A002
    ) -> "FakeQuery":
        return FakeQuery(
            self._collection, [*self._filters, _as_filter(field, op, value, filter)]
        )

    def order_by(self, field: str, **_kwargs: Any) -> "FakeQuery":
        """Sorting is not modelled — every caller here re-sorts or does not care.

        Returning self rather than raising, because a query that cannot be ordered in a
        test is still the right query; a NotImplementedError would make the fake dictate
        how production code is written.
        """
        return self

    def get(self) -> list["FakeSnapshot"]:
        return self.stream()

    def stream(self) -> list["FakeSnapshot"]:
        matched = []
        for doc_id, data in self._collection.docs.items():
            if all(
                _matches(data, field, op, value) for field, op, value in self._filters
            ):
                matched.append(
                    FakeSnapshot(doc_id, data, self._collection.document(doc_id))
                )
        return matched


def _as_filter(
    field: str | None, op: str | None, value: Any, field_filter: Any
) -> tuple[str, str, Any]:
    """Normalise both `where()` spellings the Admin SDK accepts.

    The positional form is deprecated upstream, and the store and every module written
    since use `filter=FieldFilter(...)`. Supporting only the positional one meant a
    query written the modern way silently missed the fake and reached the real project.
    """
    if field_filter is not None:
        return (
            field_filter.field_path,
            field_filter.op_string,
            field_filter.value,
        )
    return (field or "", op or "==", value)


def _matches(document: dict, field: str, op: str, value: Any) -> bool:
    if op != "==":
        raise NotImplementedError(f"fake firestore supports '==' only, got {op!r}")
    return _at_path(document, field) == value


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

    def batch(self) -> "FakeBatch":
        """A write batch, as `client.batch()` returns.

        Needed once deciding a whole round became a web action: it applies outcomes
        and stamped ranks to every candidate in one go, chunked under Firestore's
        500-write cap.
        """
        return FakeBatch()


class FakeBatch:
    """Queued writes, applied on commit.

    Deferring rather than writing straight through is the point: a test asserting that
    a refused round decision changed NOTHING would pass against a pass-through fake
    even if production had half-applied it.
    """

    def __init__(self) -> None:
        self._queued: list = []

    def set(self, reference: FakeDocument, data: dict, merge: bool = False) -> None:
        self._queued.append(lambda: reference.set(data, merge=merge))

    def update(self, reference: FakeDocument, data: dict) -> None:
        self._queued.append(lambda: reference.update(data))

    def delete(self, reference: FakeDocument) -> None:
        self._queued.append(reference.delete)

    def commit(self) -> None:
        for write in self._queued:
            write()
        self._queued.clear()


@pytest.fixture(autouse=True)
def fake_firestore(monkeypatch) -> FakeFirestoreClient:
    """No web unit test reaches the real project, for any collection."""
    from app import firebase

    client = FakeFirestoreClient()
    monkeypatch.setattr(firebase, "get_db", lambda settings: client)
    # Modules that did `from app.firebase import get_db` at import time hold their own
    # reference, so patching the source module alone would miss them.
    for module_name in (
        "app.web.services.interview_invite",
        "app.interviews",
        # Reports are a SHARED collection now, and `app.reports` binds `get_db` at
        # import time like the others. Without it here, a route reading
        # `reports/{interviewId}` reaches the real project.
        "app.reports",
        # Reads `users/{uid}` for the caller's role, display name and COMPANY. Same
        # import-time binding; without it the company lookup silently returned "" in
        # tests, so a scoping test asserting colleagues share saw an empty list and
        # looked like a scoping bug rather than an unpatched fake.
        "app.web.services.users",
    ):
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

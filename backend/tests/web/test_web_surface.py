"""The web surface's skeleton: mounting, error shape, and the store's guards.

These are the invariants every ported route will rely on, so they are worth
holding down before any route exists.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field

from app import web
from app.config import get_settings
from app.main import create_app
from app.web.errors import _first_validation_message
from app.web.store import PREFIX, Collection, WebStore


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


class _Body(BaseModel):
    """Module-level on purpose.

    This file uses `from __future__ import annotations`, so a route's parameter
    annotation is a string that FastAPI resolves against MODULE globals. A model
    defined inside a test function cannot be found, and the parameter silently
    degrades to a plain body field — which is a real constraint for route code
    too: web request models belong in `app/web/schemas.py`, never inline.
    """

    email: str
    fullName: str = Field(min_length=2)


# ── mounting ──────────────────────────────────────────────────────────────────


def test_health_is_served_under_the_web_prefix(client: TestClient) -> None:
    response = client.get("/api/web/health")
    assert response.status_code == 200

    body = response.json()
    assert body["ok"] is True
    # Field names carried over from the Express response so anything already
    # pointed at it keeps working.
    assert set(body) >= {"ok", "ts", "gemini", "auth", "authMode", "persistence"}
    assert body["persistence"]["backend"] == "firestore"


def test_health_reports_whether_code_execution_is_configured(client: TestClient) -> None:
    """The question an operator could not previously ask without logging in.

    Lives here rather than in `providers.readiness` for two reasons, both of them
    load-bearing: that map is the COMMON surface and the layering test forbids
    importing `app.web` into it, and the Flutter app maps every one of its keys
    onto a Service Status screen for features it does not have.

    Reported as CONFIGURED, not as reachable — see the route's own note.
    """
    body = client.get("/api/web/health").json()

    assert isinstance(body["codeExecution"], bool)
    # A judge URL is what makes the coding track able to run anything at all.
    from app.web.services import coding_judge
    from app.config import Settings

    assert coding_judge.configured(Settings(_env_file=None, judge0_url="http://x:2358"))
    assert not coding_judge.configured(Settings(_env_file=None, judge0_url="  "))


def test_health_stays_200_when_storage_is_unreachable(client: TestClient) -> None:
    """The deploy's health check must not fail over missing credentials.

    A 503 here makes the platform restart or fail the deploy, which cannot fix a
    credential problem and turns degraded-but-serving into a full outage.
    """
    body = client.get("/api/web/health").json()
    assert body["ok"] is True
    # Whether storage is actually configured depends on the environment; either
    # way the report is present and the response is a 200.
    assert isinstance(body["persistence"]["ok"], bool)


def test_the_common_surface_still_answers(client: TestClient) -> None:
    """The mobile/desktop contract is frozen — mounting the web surface must not
    shadow or disturb it."""
    assert client.get("/health").status_code == 200
    # /api/templates is the mobile app's EMAIL templates. The web surface uses
    # that same path for INTERVIEW templates, which is exactly why it is mounted
    # under /api/web — this asserts the collision really is avoided.
    assert client.get("/api/templates").status_code != 404


def test_web_prefix_is_distinct_from_the_common_templates_path() -> None:
    routes = {getattr(r, "path", "") for r in create_app().routes}
    assert "/api/templates" in routes
    assert not any(r.startswith("/api/web/") and r == "/api/templates" for r in routes)


def test_install_is_idempotent_in_shape() -> None:
    """`install()` is the single mount point; it registers one router subtree."""
    app = FastAPI()
    web.install(app)
    paths = {getattr(r, "path", "") for r in app.routes}
    assert "/api/web/health" in paths


# ── error shape ───────────────────────────────────────────────────────────────


def test_web_errors_carry_both_error_and_detail() -> None:
    """The web client reads `error`; the Flutter app reads `detail`. Emit both."""
    app = create_app()

    @app.get("/api/web/_boom")
    async def _boom() -> dict:
        raise HTTPException(status_code=418, detail="Kettle unavailable")

    body = TestClient(app).get("/api/web/_boom").json()
    assert body["error"] == "Kettle unavailable"
    assert body["detail"] == "Kettle unavailable"


def test_unknown_web_path_also_carries_error() -> None:
    """Starlette's router raises its OWN HTTPException for a 404/405, which is the
    base class of FastAPI's — so the handler must be registered against the base
    or these slip through with only `detail`."""
    client = TestClient(create_app())

    not_found = client.get("/api/web/does-not-exist")
    assert not_found.status_code == 404
    assert not_found.json()["error"] == "Not Found"

    wrong_method = client.post("/api/web/health")
    assert wrong_method.status_code == 405
    assert "error" in wrong_method.json()


def test_common_surface_errors_keep_only_detail() -> None:
    """Adding `error` to the mobile surface's responses is out of scope — that
    contract is frozen."""
    app = create_app()

    @app.get("/api/_boom")
    async def _boom() -> dict:
        raise HTTPException(status_code=418, detail="Kettle unavailable")

    body = TestClient(app).get("/api/_boom").json()
    assert body == {"detail": "Kettle unavailable"}


def test_web_validation_errors_name_the_field() -> None:
    """A recruiter reads this string, so it must not be pydantic's nested dump."""
    app = create_app()

    @app.post("/api/web/_check")
    async def _check(payload: _Body) -> dict:
        return {"ok": True}

    response = TestClient(app).post("/api/web/_check", json={})
    assert response.status_code == 422
    message = response.json()["error"]
    assert "email" in message
    assert "body" not in message  # the wrapper location is noise to a user


def test_first_validation_message_falls_back_when_there_are_no_errors() -> None:
    class _Empty:
        def errors(self):
            return []

    assert _first_validation_message(_Empty()) == "Invalid request."


# ── store ─────────────────────────────────────────────────────────────────────


# Collections the web store reaches that are deliberately SHARED with the mobile app,
# and therefore deliberately not `web_`-prefixed.
#
# This list is the whole point of the test below: every entry is a decision to expose
# data to the other client, so adding one is a visible diff that has to be argued for,
# not a prefix somebody quietly dropped.
SHARED_COLLECTIONS = {
    # A report IS the result of one interview, and both clients display reports. See
    # app/reports.py.
    "reports",
    # Invite and notification email templates. This was `web_invite_email_templates`,
    # so a recruiter's saved email was invisible on the other client — while the
    # RENDERING was already unified against a golden fixture. See
    # app/templates_store.py.
    "email_templates",
    # What a candidate thought of the interview. `web_feedback` meant the prompt
    # existed only in the browser. See app/feedback.py.
    "feedback",
    # MCQ papers. Still OWNER-scoped — by a `recruiterId` filter on every query and by
    # `firestore.rules`, which is where it was always enforced. The prefix only stopped
    # the other client from reaching a paper at all. See app/mcq.py.
    "mcq_sets",
    # Reusable per-role interview pipeline templates. A pipeline authored on the web
    # must be usable the moment a recruiter imports a spreadsheet on their phone, and
    # vice versa — the same reason `tests`/`interviews`/`rounds` are unprefixed. Also
    # OWNER-scoped, like `mcq_sets` above. See app/role_configs.py.
    "roleConfigs",
}


def test_every_collection_is_web_prefixed_unless_deliberately_shared() -> None:
    """The prefix is what guarantees no clash with the mobile app's data.

    The exceptions are enumerated rather than pattern-matched: a shared collection is a
    decision about what the other client can read, and it should cost a line here.
    """
    store = WebStore(client=object())
    named = [value for value in vars(store).values() if hasattr(value, "name")]
    assert named, "WebStore exposed no collections"
    for collection in named:
        if collection.name in SHARED_COLLECTIONS:
            continue
        assert collection.name.startswith(PREFIX), (
            f"{collection.name} is neither web-prefixed nor listed as shared. If it is "
            "meant to be shared with the mobile app, add it to SHARED_COLLECTIONS with "
            "the reason; otherwise it needs the prefix."
        )


def test_the_report_collection_is_the_shared_one() -> None:
    """It used to be `web_reports`, which the mobile app could not see by construction.

    The symptom was a recruiter opening a report on their phone for an interview taken
    in a browser and getting nothing — and the web sessions list showing no score for
    an interview taken on a phone.
    """
    store = WebStore(client=object())
    assert store.reports.name == "reports"
    assert not store.reports.name.startswith(PREFIX)


def test_reports_are_keyed_by_session_id() -> None:
    """A report is the result of one session and is only ever looked up by it —
    the JSON store keyed them the same way."""
    store = WebStore(client=object())
    assert store.reports.key_field == "sessionId"
    assert store.sessions.key_field == "id"


def test_users_collection_is_not_recreated() -> None:
    """`users` is the shared Firestore collection both clients already read.
    Mirroring it here would be a second source of truth for the caller's role."""
    store = WebStore(client=object())
    assert not hasattr(store, "users")


def test_owned_by_refuses_a_blank_recruiter_id() -> None:
    """`where('recruiterId', '==', '')` is a valid query that would match every
    document written before ownership was stamped, and hand them over."""
    collection = Collection(client=object(), name="web_templates")
    assert asyncio.run(collection.owned_by("")) == []


def test_get_and_delete_tolerate_a_blank_id() -> None:
    """Route code passes a path parameter straight through; a blank one must not
    become a Firestore call with an empty document path (which raises)."""
    collection = Collection(client=object(), name="web_templates")
    assert asyncio.run(collection.get("")) is None
    asyncio.run(collection.delete(""))  # no raise


def test_put_requires_the_key_field() -> None:
    collection = Collection(client=object(), name="web_templates")
    with pytest.raises(ValueError, match="no id"):
        asyncio.run(collection.put({"role": "Engineer"}))


def test_put_many_of_nothing_writes_nothing() -> None:
    collection = Collection(client=object(), name="web_leads")
    assert asyncio.run(collection.put_many([])) == 0


def test_settings_are_a_single_document() -> None:
    store = WebStore(client=object())
    assert store.settings.doc_id == "global"
    assert store.settings.name == f"{PREFIX}settings"


def test_new_rate_limit_buckets_exist() -> None:
    settings = get_settings()
    assert settings.rate_limit_face > 0
    assert settings.rate_limit_chat > 0


# ── mounting invariants ───────────────────────────────────────────────────────


def test_no_route_is_registered_twice() -> None:
    """A module listed twice in `_MODULES` registers every one of its routes twice.

    FastAPI serves the first match, so the app still works and the tests still pass —
    which is exactly why this needs checking. The duplicates show up in the OpenAPI
    schema, and the shadowed copies are dead code nobody notices.
    """
    from collections import Counter

    from app import web

    seen = Counter(
        (method, getattr(route, "path", ""))
        for route in web.build_router().routes
        for method in getattr(route, "methods", set())
    )
    duplicates = [f"{method} {path}" for (method, path), count in seen.items() if count > 1]
    assert not duplicates, "registered more than once:\n  " + "\n  ".join(duplicates)


def test_every_web_module_is_mounted_once() -> None:
    from app import web

    assert len(web._MODULES) == len(set(web._MODULES))


def test_the_email_template_collection_is_the_shared_one() -> None:
    """One store for invite emails, not two.

    Mobile reads `email_templates` through `/api/templates`; this surface used to keep
    its own `web_invite_email_templates`, so a template saved on one client did not
    exist on the other.
    """
    from app import templates_store

    store = WebStore(client=object())
    assert store.invite_email_templates.name == templates_store.TEMPLATES_COLLECTION
    assert not store.invite_email_templates.name.startswith(PREFIX)


# ── one bad row must not empty a list ─────────────────────────────────────────


def test_a_single_unreadable_document_does_not_empty_the_list(caplog) -> None:
    """Adopted from the Flutter client, where `_parseDocs` has always worked this way.

    A list comprehension over `stream()` meant one malformed document — hand-edited in
    the console, written by an older build, or half-written by a failed batch — could
    raise and empty a recruiter's ENTIRE templates list. The symptom reads as "you have
    nothing", which is indistinguishable from a real empty state and sends somebody
    hunting for deleted data.
    """
    from app.web.store.collections import _parse_all

    class _Good:
        id = "good"

        @staticmethod
        def to_dict():
            return {"name": "fine"}

    class _Bad:
        id = "bad"

        @staticmethod
        def to_dict():
            raise ValueError("corrupt document")

    with caplog.at_level("WARNING"):
        parsed = _parse_all([_Good(), _Bad(), _Good()], "id", "web_templates")

    assert len(parsed) == 2, "the readable rows must survive"
    # And the bad one is findable, not merely absent.
    assert any("bad" in record.message for record in caplog.records)

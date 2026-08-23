"""End-to-end smoke tests. DRY_RUN means no network and no credentials; Firebase
is stubbed with a tiny in-memory fake so template CRUD is exercised too."""

from __future__ import annotations

import os

os.environ["DRY_RUN"] = "true"
os.environ["API_KEY"] = ""
os.environ["FIREBASE_CREDENTIALS_FILE"] = ""
os.environ["FIREBASE_CREDENTIALS_JSON"] = ""

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import mailer, templates_store  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


# --- In-memory stand-in for Firestore -------------------------------------
class _FakeDoc:
    def __init__(self, doc_id: str, data: dict | None):
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self) -> dict | None:
        return self._data


class _FakeRef:
    def __init__(self, store: dict, doc_id: str):
        self._store, self.id = store, doc_id

    def set(self, data: dict) -> None:
        self._store[self.id] = dict(data)

    def get(self) -> _FakeDoc:
        return _FakeDoc(self.id, self._store.get(self.id))


class _FakeQuery:
    def __init__(self, docs: list[_FakeDoc]):
        self._docs = docs

    def where(self, field: str, op: str, value) -> "_FakeQuery":
        assert op == "==", f"fake only supports equality, got {op!r}"
        return _FakeQuery([d for d in self._docs if (d.to_dict() or {}).get(field) == value])

    def stream(self):
        return list(self._docs)


class _FakeCollection(_FakeQuery):
    def __init__(self, store: dict):
        self._store = store
        self._seq = 0

    @property
    def _docs(self) -> list[_FakeDoc]:  # type: ignore[override]
        return [_FakeDoc(k, v) for k, v in self._store.items()]

    def document(self, doc_id: str | None = None) -> _FakeRef:
        if doc_id is None:
            self._seq += 1
            doc_id = f"tpl{self._seq}"
        return _FakeRef(self._store, doc_id)


@pytest.fixture(autouse=True)
def fake_firestore(monkeypatch):
    collection = _FakeCollection({})
    monkeypatch.setattr(templates_store, "_collection", lambda settings: collection)
    return collection


# --- Tests ----------------------------------------------------------------
def test_health_reports_dry_run():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["provider"] == "dry_run"
    assert body["sending_ready"] is True


def test_list_templates_includes_builtins_and_default():
    r = client.get("/api/templates")
    assert r.status_code == 200
    body = r.json()
    ids = [t["id"] for t in body["templates"]]
    assert "builtin:interview_invite" in ids
    assert body["default_template_id"] == "builtin:interview_invite"
    assert "candidate_name" in body["variables"]
    assert body["warning"] is None
    assert sum(1 for t in body["templates"] if t["is_default"]) == 1


def test_create_template_then_it_appears_in_its_owners_list():
    created = client.post(
        "/api/templates",
        json={
            "name": "Custom invite",
            "subject": "Hi {{ candidate_name }} — {{ interview_title }}",
            "body": "<p>Open {{ interview_link }}</p>",
            "owner_email": "Vaishnavi@TalbotIQ.com",
            "recruiter_id": "rec1",
        },
    )
    assert created.status_code == 201, created.text
    tpl = created.json()
    assert tpl["source"] == "custom" and tpl["id"]
    # Stored lowercased so lookups are case-insensitive.
    assert tpl["owner_email"] == "vaishnavi@talbotiq.com"

    mine = client.get(
        "/api/templates", params={"owner_email": "vaishnavi@talbotiq.com"}
    ).json()["templates"]
    assert tpl["id"] in [t["id"] for t in mine]


def test_templates_are_not_visible_to_another_recruiter():
    tpl = client.post(
        "/api/templates",
        json={
            "name": "Private",
            "subject": "s",
            "body": "b",
            "owner_email": "owner@talbotiq.com",
        },
    ).json()

    others = client.get(
        "/api/templates", params={"owner_email": "someone.else@talbotiq.com"}
    ).json()["templates"]
    assert tpl["id"] not in [t["id"] for t in others]
    # They still get every built-in.
    assert all(t["source"] == "builtin" for t in others)

    # Nor can they send with it by guessing the id.
    blocked = client.post(
        "/api/emails/send",
        json={
            "template_id": tpl["id"],
            "owner_email": "someone.else@talbotiq.com",
            "recipients": [{"email": "a@x.com"}],
        },
    )
    assert blocked.status_code == 404


def test_send_with_custom_template_id():
    tpl_id = client.post(
        "/api/templates",
        json={
            "name": "Custom",
            "subject": "Interview: {{ interview_title }}",
            "body": "Hi {{ candidate_name }}, open {{ interview_link }}",
            "is_html": False,
            "owner_email": "vaishnavi@talbotiq.com",
        },
    ).json()["id"]

    sent: list[dict] = []

    def _capture(settings, **kwargs):
        sent.append(kwargs)

    original, mailer.send = mailer.send, _capture
    try:
        r = client.post(
            "/api/emails/send",
            json={
                "template_id": tpl_id,
                "shared_context": {"interview_title": "Backend Screen"},
                "recipients": [
                    {
                        "email": "ada@example.com",
                        "name": "Ada",
                        "context": {"interview_link": "https://x/1"},
                    },
                    {
                        "email": "grace@example.com",
                        "context": {"interview_link": "https://x/2"},
                    },
                ],
            },
        )
    finally:
        mailer.send = original

    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {
        **body,
        "total": 2,
        "sent": 2,
        "failed": 0,
        "template_id": tpl_id,
        "provider": "dry_run",
    }
    assert body["subject_preview"] == "Interview: Backend Screen"

    by_email = {m["to_email"]: m for m in sent}
    assert by_email["ada@example.com"]["body"] == "Hi Ada, open https://x/1"
    # No name given → the local part of the address is used.
    assert by_email["grace@example.com"]["body"] == "Hi grace, open https://x/2"
    assert by_email["ada@example.com"]["is_html"] is False


def test_send_without_template_id_uses_the_default():
    r = client.post(
        "/api/emails/send",
        json={
            "shared_context": {"interview_title": "Flutter Role", "company": "TalbotIQ"},
            "recipients": [{"email": "ada@example.com", "name": "Ada"}],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["template_id"] == "builtin:interview_invite"
    assert body["sent"] == 1
    assert body["subject_preview"] == "You've been invited to an interview: Flutter Role"


def test_send_with_unknown_template_id_is_404():
    r = client.post(
        "/api/emails/send",
        json={"template_id": "builtin:nope", "recipients": [{"email": "a@x.com"}]},
    )
    assert r.status_code == 404


def test_one_bad_recipient_does_not_sink_the_batch():
    def _flaky(settings, **kwargs):
        if kwargs["to_email"] == "bad@example.com":
            raise RuntimeError("mailbox unavailable")

    original, mailer.send = mailer.send, _flaky
    try:
        r = client.post(
            "/api/emails/send",
            json={
                "recipients": [{"email": "good@example.com"}, {"email": "bad@example.com"}],
            },
        )
    finally:
        mailer.send = original

    body = r.json()
    assert body["sent"] == 1 and body["failed"] == 1
    failed = next(x for x in body["results"] if x["status"] == "failed")
    assert failed["email"] == "bad@example.com"
    assert "mailbox unavailable" in failed["error"]


def test_invalid_email_is_rejected_before_sending():
    r = client.post("/api/emails/send", json={"recipients": [{"email": "not-an-email"}]})
    assert r.status_code == 422


def test_send_is_blocked_when_delivery_is_unconfigured(monkeypatch):
    monkeypatch.setattr(mailer, "config_hint", lambda settings: "Set EMAIL_USER…")
    r = client.post("/api/emails/send", json={"recipients": [{"email": "a@x.com"}]})
    assert r.status_code == 503
    assert "EMAIL_USER" in r.json()["detail"]


def test_api_key_is_enforced_when_set(monkeypatch):
    from app import security

    settings = app.state.settings
    monkeypatch.setattr(settings, "api_key", "secret", raising=False)
    monkeypatch.setattr(security, "get_settings", lambda: settings)

    assert client.get("/api/templates").status_code == 401
    assert client.get("/api/templates", headers={"X-API-Key": "secret"}).status_code == 200


def test_the_template_collection_has_one_name() -> None:
    """`Settings.templates_collection` and `templates_store.TEMPLATES_COLLECTION`.

    Two definitions because of an import cycle — `templates_store` imports `config` —
    so they are asserted equal here instead. The web store reaches the collection
    through the constant while the mobile surface goes through Settings, and a drift
    between them would silently split the shared store back into two.
    """
    from app import templates_store
    from app.config import Settings

    assert Settings().templates_collection == templates_store.TEMPLATES_COLLECTION

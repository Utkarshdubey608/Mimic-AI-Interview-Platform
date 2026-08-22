"""The batch metadata document — why a web-created test was invisible on the phone.

The mobile recruiter dashboard pages over the `tests` collection, not `interviews`:
grouping a thousand assignments client-side to list a dozen batches was ruinous, so
each batch gets a tiny `tests/{testId}` document and candidates are read only when a
test is opened.

Nothing on the web surface ever wrote that document. So every batch a recruiter
created in the browser existed as `interviews` rows with a shared `testId` pointing at
a metadata document that did not exist — and the phone, which lists tests, showed
nothing. Mobile's backfill derives them from the assignments, but it is guarded on the
tests list being EMPTY, so it never fired for the recruiter this hurt most: one who
already used the app.

These tests pin the write, its idempotency, and the two places it deliberately does
NOT happen.
"""

from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from app import interviews


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _invite_body(**overrides) -> dict:
    return {
        "mode": "chat",
        "role": "Backend Engineer",
        "source": "tailor",
        "config": {"techCount": 3, "nonTechCount": 2},
        "candidates": [{"email": "ada@example.test", "role": "Backend Engineer"}],
        "origin": "https://app.test",
        "sendEmails": False,
        **overrides,
    }


def _tests_of(fake_firestore) -> dict:
    return fake_firestore.collection(interviews.TESTS_COLLECTION).docs


# ── the write ─────────────────────────────────────────────────────────────────


def test_a_bulk_invite_records_its_batch_metadata(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """The fix for the defect above: the batch is now listable on the phone."""
    response = authed_client.post("/api/web/invites", json=_invite_body())
    assert response.status_code == 201, response.text

    test_id = response.json()["testId"]
    docs = _tests_of(fake_firestore)
    assert test_id in docs, (
        "the batch created no tests/{testId} document, so it is invisible on the "
        "mobile recruiter dashboard"
    )


def test_the_metadata_is_the_shape_the_dart_model_reads(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """Field names come from `TestSummary.fromDoc`; a rename breaks the dashboard.

    `type` is asserted because it is DERIVED from `mode` — the dashboard row icon
    reads it, and mobile's model cannot parse a third value.
    """
    response = authed_client.post("/api/web/invites", json=_invite_body(mode="video"))
    summary = _tests_of(fake_firestore)[response.json()["testId"]]

    assert set(summary) == {"recruiterId", "title", "type", "createdAt", "updatedAt"}
    assert summary["recruiterId"] == "uid-recruiter"
    assert summary["type"] == "video"
    assert "Backend Engineer" in summary["title"]


def test_the_batch_role_names_the_test_not_one_candidates_role(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """A batch is one test, so its title is the batch's role.

    Candidates carry their own `role`, and taking the title from whichever happened to
    be first would name the batch after one person.
    """
    response = authed_client.post(
        "/api/web/invites",
        json=_invite_body(
            role="Platform Engineer",
            candidates=[
                {"email": "ada@example.test", "role": "Platform Engineer"},
                {"email": "grace@example.test", "role": "Platform Engineer"},
            ],
        ),
    )
    summary = _tests_of(fake_firestore)[response.json()["testId"]]
    assert summary["title"].startswith("Platform Engineer")


def test_writing_the_metadata_twice_merges_rather_than_replaces(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """The actual property: a repeat is safe and never REPLACES the document.

    Deliberately not asserting that `createdAt` survives — it does not, and
    `ensure_test_summary` says why. What must hold is that a field another writer put
    there (mobile's `upsertTest` writes the same shape) is still present afterwards, so
    two clients maintaining one document cannot erase each other.
    """
    assert _run(
        interviews_ensure(authed_client, "t-fixed", role="Backend Engineer", mode="chat")
    )

    # Something only the other client writes.
    _tests_of(fake_firestore)["t-fixed"]["someMobileOnlyField"] = "keep me"

    assert _run(
        interviews_ensure(authed_client, "t-fixed", role="Backend Engineer", mode="chat")
    )
    summary = _tests_of(fake_firestore)["t-fixed"]
    assert summary["someMobileOnlyField"] == "keep me", (
        "the second write replaced the document instead of merging, so the two "
        "clients maintaining it would erase each other's fields"
    )
    assert summary["recruiterId"] == "uid-recruiter"


def interviews_ensure(client: TestClient, test_id: str, *, role: str, mode: str):
    """Call the service directly, with the app's settings."""
    from app.config import Settings
    from app.web.services import interview_invite

    return interview_invite.ensure_test_summary(
        Settings(), test_id=test_id, recruiter_id="uid-recruiter", role=role, mode=mode
    )


# ── a recruiter-created session is a shared record too ────────────────────────


def _seed_template(fake_store, **overrides) -> str:
    template = {
        "id": "tpl-1",
        "name": "Backend screen",
        "role": "Backend Engineer",
        "track": "chat",
        "questionSource": "adaptive",
        **overrides,
    }
    _run(fake_store.templates.put(template))
    return template["id"]


def test_a_template_created_session_records_the_shared_assignment(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """The gap this closes: it used to exist only in `web_sessions`.

    No interview document meant no `viaInvite`, so `sync_result` returned early and the
    whole interview — score included — was invisible on the phone.
    """
    template_id = _seed_template(fake_store)
    response = authed_client.post(
        "/api/web/sessions",
        json={
            "templateId": template_id,
            "candidate": {"name": "Ada Lovelace", "email": "ada@example.test"},
        },
    )
    assert response.status_code == 201, response.text
    session_id = response.json()["id"]

    assignment = fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs
    assert session_id in assignment, (
        "the session wrote no interviews/{id}, so the mobile app cannot see it"
    )
    document = assignment[session_id]
    assert document["candidateEmailLower"] == "ada@example.test"
    assert document["candidateName"] == "Ada Lovelace"
    assert document["mode"] == "chat"
    assert document["type"] == "chat"
    assert document["recruiterId"] == "uid-recruiter"


def test_the_session_id_is_the_interview_id(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """One id for one interview, matching what the invite bridge already does.

    It is what lets `sync_result` write the score back without needing a flag to tell
    it where, and what makes the two records addressable as one thing from either
    client.
    """
    template_id = _seed_template(fake_store)
    session_id = authed_client.post(
        "/api/web/sessions",
        json={"templateId": template_id, "candidate": {"email": "ada@example.test"}},
    ).json()["id"]

    assert session_id in fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs
    assert _run(fake_store.sessions.get(session_id))["id"] == session_id


def test_a_standalone_session_groups_under_its_own_id(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """A single session is not a batch, so it is its own test.

    Mobile already understands this shape: interviews created before `testId` existed
    group under their OWN id, and both `TestSummary.fromInterview` and `backfillTests`
    fall back to `i.id` for exactly that case.
    """
    template_id = _seed_template(fake_store)
    session_id = authed_client.post(
        "/api/web/sessions",
        json={"templateId": template_id, "candidate": {"email": "ada@example.test"}},
    ).json()["id"]

    document = fake_firestore.collection(interviews.INTERVIEWS_COLLECTION).docs[session_id]
    assert document["testId"] == session_id
    assert session_id in _tests_of(fake_firestore), (
        "no tests/{testId} document, so the session is invisible on the mobile "
        "recruiter dashboard even though its interview exists"
    )


def test_a_failed_assignment_write_does_not_deny_the_session(
    authed_client: TestClient, fake_store, fake_firestore, monkeypatch
) -> None:
    """The session is what the recruiter asked for, and it runs from `web_sessions`."""
    template_id = _seed_template(fake_store)

    def _explode(_settings):
        raise RuntimeError("firestore unavailable")

    monkeypatch.setattr(interviews, "collection", _explode)

    response = authed_client.post(
        "/api/web/sessions",
        json={"templateId": template_id, "candidate": {"email": "ada@example.test"}},
    )
    assert response.status_code == 201, response.text
    assert _run(fake_store.sessions.get(response.json()["id"])) is not None


# ── where it deliberately does not happen ─────────────────────────────────────


def test_a_blank_test_id_writes_nothing(authed_client: TestClient, fake_firestore) -> None:
    """A blank id would create a document at an unaddressable path."""
    assert not _run(interviews_ensure(authed_client, "", role="R", mode="chat"))
    assert not _tests_of(fake_firestore)


def test_a_failed_metadata_write_does_not_sink_the_batch(
    authed_client: TestClient, fake_store, fake_firestore, monkeypatch
) -> None:
    """A dashboard index is not worth denying a recruiter their invites for.

    Mobile's "Rebuild test list" recovers it from the assignments, so the batch going
    out matters more than its index landing.
    """

    def _explode(_settings):
        raise RuntimeError("firestore unavailable")

    monkeypatch.setattr(interviews, "tests_collection", _explode)

    response = authed_client.post("/api/web/invites", json=_invite_body())
    assert response.status_code == 201, response.text
    assert response.json()["created"], "the invites must still have been created"
    assert not _tests_of(fake_firestore)

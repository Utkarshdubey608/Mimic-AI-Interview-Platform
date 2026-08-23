"""One store for invite emails, read by both clients.

`email_templates` was the mobile surface's; the web surface kept its own
`web_invite_email_templates`. So a recruiter's saved invite email existed on exactly
one client — while the RENDERING was already unified against a golden fixture
(`contracts/invite_email.fixtures.json`). Storage was the half that had not caught up.

The two clients store different shapes for the same thing, and these tests are mostly
about that seam: `body` + `isHtml` here against `bodyHtml` there, and `ownerEmail`
scoping against `recruiterId` scoping. Additive keys are enough for the rest.
"""

from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from app import templates_store


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _create(client: TestClient, **overrides) -> dict:
    body = {
        "name": "Interview invite",
        "subject": "Interview invitation — {{role}}",
        "bodyHtml": "<p>Hi {{candidate_name}},</p><p>{{interview_link}}</p>",
        **overrides,
    }
    response = client.post("/api/web/invite-email-templates", json=body)
    assert response.status_code in (200, 201), response.text
    return response.json()


def _stored(fake_store, template_id: str) -> dict:
    return fake_store.invite_email_templates.docs[template_id]


# ── the seam ──────────────────────────────────────────────────────────────────


def test_a_web_saved_template_is_readable_by_the_mobile_surface(
    authed_client: TestClient, fake_store
) -> None:
    """Both compatibility fields, and each one is load-bearing.

    Without `body` the phone renders an EMPTY email — the body is not an unknown key a
    reader can skip, it is the field. Without `ownerEmail`, `templates_store.list_all`
    cannot find the document at all, which is the very defect this unification closes,
    reintroduced from the other side.
    """
    created = _create(authed_client)
    stored = _stored(fake_store, created["id"])

    assert stored["body"] == stored["bodyHtml"], "the phone would render an empty email"
    assert stored["isHtml"] is True
    assert stored["ownerEmail"] == "recruiter@talbotiq.com"
    # The web's own shape is untouched — the compatibility fields are additive.
    assert stored["sender"]["verifiedSenderEmail"] is not None
    assert stored["cta"]["text"]


def test_the_mobile_reader_resolves_a_web_authored_body() -> None:
    """`unify_body` is the one place the two shapes are reconciled."""
    assert templates_store.unify_body({"bodyHtml": "<p>hi</p>"}) == ("<p>hi</p>", True)
    # This surface's own shape still wins when present.
    assert templates_store.unify_body(
        {"body": "plain text", "isHtml": False, "bodyHtml": "<p>ignored</p>"}
    ) == ("plain text", False)


def test_a_template_with_no_body_at_all_is_empty_not_an_error() -> None:
    """A recruiter's half-finished draft, not a crash."""
    assert templates_store.unify_body({}) == ("", True)
    assert templates_store.unify_body({"body": "   ", "bodyHtml": ""}) == ("", True)


def test_updating_keeps_the_compatibility_fields_in_step(
    authed_client: TestClient, fake_store
) -> None:
    """A stale `body` beside a fresh `bodyHtml` is worse than none: the phone would
    send the OLD email while the browser previewed the new one."""
    created = _create(authed_client)

    updated = authed_client.put(
        f"/api/web/invite-email-templates/{created['id']}",
        json={
            "name": "Interview invite",
            "subject": "Updated — {{role}}",
            "bodyHtml": "<p>Rewritten {{interview_link}}</p>",
        },
    )
    assert updated.status_code == 200, updated.text

    stored = _stored(fake_store, created["id"])
    assert "Rewritten" in stored["bodyHtml"]
    assert stored["body"] == stored["bodyHtml"]
    assert stored["subject"] == "Updated — {{role}}"


def test_duplicating_carries_the_compatibility_fields(
    authed_client: TestClient, fake_store
) -> None:
    created = _create(authed_client)
    copy = authed_client.post(
        f"/api/web/invite-email-templates/{created['id']}/duplicate"
    )
    assert copy.status_code in (200, 201), copy.text

    stored = _stored(fake_store, copy.json()["id"])
    assert stored["body"] == stored["bodyHtml"]
    assert stored["ownerEmail"] == "recruiter@talbotiq.com"


# ── ownership is unchanged ────────────────────────────────────────────────────


def test_another_recruiters_template_is_still_invisible(
    authed_client: TestClient, fake_store
) -> None:
    """Sharing a COLLECTION is not sharing the documents in it.

    These hold a verified sender address, and one recruiter sending under another's is
    exactly what the owner scoping prevents. `recruiterId` stays the authority here —
    `ownerEmail` is written for the other client's query, not as a second gate.
    """
    _run(
        fake_store.invite_email_templates.put(
            {
                "id": "theirs",
                "recruiterId": "someone-else",
                "ownerEmail": "other@elsewhere.test",
                "name": "Theirs",
                "subject": "s",
                "bodyHtml": "<p>b</p>",
            }
        )
    )

    listed = authed_client.get("/api/web/invite-email-templates").json()
    assert "theirs" not in [t["id"] for t in listed]
    assert authed_client.get("/api/web/invite-email-templates/theirs").status_code == 404

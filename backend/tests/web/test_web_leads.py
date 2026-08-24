"""`POST /api/web/leads` — the one public route on this surface.

Public means the validation IS the security boundary, so the bounds are tested
rather than assumed.
"""

from __future__ import annotations

import pytest

from app.web.routes.leads import DEFAULT_SOURCE, build_lead
from app.web.schemas import LeadCreate
from app.web.services.lead_notify import build_notification, notify

NOW = "2026-08-13T12:00:00+00:00"


def _lead(**overrides) -> LeadCreate:
    return LeadCreate.model_validate(
        {
            "firstName": "Ada",
            "lastName": "Lovelace",
            "email": "ada@example.com",
            "hiresPerYear": "10-50",
            **overrides,
        }
    )


def test_build_lead_normalises_the_email() -> None:
    """The email is what a human searches on later, so case must not split rows."""
    lead = build_lead(_lead(email="Ada.Lovelace@Example.COM"), NOW)
    assert lead["email"] == "ada.lovelace@example.com"


def test_build_lead_trims_surrounding_whitespace() -> None:
    lead = build_lead(_lead(firstName="  Ada  ", hiresPerYear=" 10-50 "), NOW)
    assert lead["firstName"] == "Ada"
    assert lead["hiresPerYear"] == "10-50"


def test_source_defaults_when_absent_or_blank() -> None:
    """A lead with no provenance is indistinguishable from a bug in the page that
    submitted it, so blank falls back rather than being stored empty."""
    assert build_lead(_lead(), NOW)["source"] == DEFAULT_SOURCE
    assert build_lead(_lead(source="   "), NOW)["source"] == DEFAULT_SOURCE
    assert build_lead(_lead(source="partner-x"), NOW)["source"] == "partner-x"


def test_created_at_is_recorded() -> None:
    assert build_lead(_lead(), NOW)["createdAt"] == NOW


def test_no_id_is_invented() -> None:
    """Nothing looks a lead up by id, so Firestore generates one on `add` rather
    than this code minting a key only the write would ever use."""
    assert "id" not in build_lead(_lead(), NOW)


@pytest.mark.parametrize(
    "payload",
    [
        pytest.param({"email": "not-an-email"}, id="malformed email"),
        pytest.param({"firstName": ""}, id="blank first name"),
        pytest.param({"lastName": ""}, id="blank last name"),
        pytest.param({"hiresPerYear": ""}, id="blank hires per year"),
        pytest.param({"firstName": "x" * 121}, id="over-long first name"),
        pytest.param({"hiresPerYear": "x" * 121}, id="over-long hires per year"),
        pytest.param({"source": "x" * 121}, id="over-long source"),
    ],
)
def test_invalid_submissions_are_rejected(payload: dict) -> None:
    """Unauthenticated endpoint: every field is bounded, so an oversized or
    malformed submission never reaches storage."""
    with pytest.raises(Exception):
        _lead(**payload)


# ── the notification ──────────────────────────────────────────────────────────
# A submission used to be stored and logged and reach nobody. It is emailed now,
# and what the email SAYS is tested here rather than in a mail server: the builder
# is pure, so these run with no credentials, no event loop and no network.


def _stored(**overrides) -> dict:
    lead = build_lead(_lead(**overrides), NOW)
    return lead


def test_the_subject_carries_the_name_and_the_volume() -> None:
    """"Demo request" alone tells you only that the form works. The name and the
    hiring volume are what make a full inbox triageable."""
    subject, _ = build_notification(_stored())
    assert subject == "Demo request — Ada Lovelace (10-50/yr)"


def test_the_body_contains_every_submitted_field() -> None:
    """The whole point is not having to go and look the record up."""
    _, body = build_notification(_stored())
    for value in ("Ada", "Lovelace", "ada@example.com", "10-50", DEFAULT_SOURCE, NOW):
        assert value in body, value


def test_every_field_is_html_escaped() -> None:
    """These values come from an unauthenticated public form and are rendered as
    HTML in a mail client, which is a browser. The route's own note says nothing it
    stores is ever rendered back to a browser by the API — that stopped being true
    when this notification was added, so escaping is the boundary."""
    _, body = build_notification(_stored(firstName="<script>alert(1)</script>"))
    assert "<script>" not in body
    assert "&lt;script&gt;" in body


def test_the_reply_address_is_the_prospects_own() -> None:
    """Hitting reply should answer the person who filled the form, not start a new
    message to nobody."""
    _, body = build_notification(_stored(email="Ada@Example.com"))
    assert "ada@example.com" in body


def test_a_missing_field_does_not_break_the_subject() -> None:
    """Defensive rather than expected: the schema requires both names, but a
    builder that raises on a partial record turns a notification into a 500."""
    subject, body = build_notification({"email": "x@y.com"})
    assert subject == "Demo request"
    assert "x@y.com" in body


def test_an_emptied_recipient_attempts_no_send() -> None:
    """A deployment setting LEAD_NOTIFY_TO to an empty string is saying "do not
    email me". That is a choice, not a failure, and it must not open an SMTP
    connection to find out.

    Tested against `notify` directly rather than through the route: the app builds
    its Settings once at startup, so patching the environment after a TestClient
    exists proves nothing — an earlier version of this test did exactly that and
    passed for the wrong reason until its stub returned the wrong type.
    """
    import asyncio

    from app import mailer
    from app.config import Settings

    calls: list[dict] = []

    real = mailer.send
    mailer.send = lambda settings, **kw: calls.append(kw)  # type: ignore[assignment]
    try:
        asyncio.run(notify(Settings(lead_notify_to=""), _stored()))
    finally:
        mailer.send = real  # type: ignore[assignment]

    assert calls == []

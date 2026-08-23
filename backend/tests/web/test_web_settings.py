"""Recruiter settings: key masking, key resolution, and the avatar config.

The invariant that matters most: **no route here ever returns a raw key**. The rest
covers the precedence rules, which decide which credential actually runs a candidate
interview.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.web.routes.settings import (
    MAX_AI_NAME,
    MAX_CALL_SECONDS,
    MAX_FALLBACK_QUESTIONS,
    MIN_CALL_SECONDS,
    normalise_avatar_config,
)
from app.web.services import app_settings

REAL_KEY = "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345"


# ── masking ───────────────────────────────────────────────────────────────────


def test_a_long_key_shows_only_its_ends() -> None:
    assert app_settings.mask(REAL_KEY) == "AIza…2345"


def test_a_short_key_is_masked_entirely() -> None:
    """`first4…last4` on a six-character value would echo the whole thing back,
    which defeats the point of masking."""
    assert app_settings.mask("abc123") == "…"
    assert app_settings.mask("a") == "…"


def test_a_blank_key_masks_to_none() -> None:
    assert app_settings.mask("") is None
    assert app_settings.mask("   ") is None
    assert app_settings.mask(None) is None


# ── Gemini key resolution ─────────────────────────────────────────────────────


def test_a_saved_key_beats_the_environment(fake_store) -> None:
    fake_store.settings.doc = {"geminiApiKey": "saved-key"}
    settings = Settings(gemini_api_key="env-key")

    assert asyncio.run(app_settings.gemini_key(settings)) == "saved-key"
    status = asyncio.run(app_settings.gemini_status(settings))
    assert status["source"] == "saved"


def test_the_environment_is_used_when_nothing_is_saved(fake_store) -> None:
    settings = Settings(gemini_api_key="env-key")
    assert asyncio.run(app_settings.gemini_key(settings)) == "env-key"
    assert asyncio.run(app_settings.gemini_status(settings))["source"] == "env"


def test_no_key_anywhere_reports_none(fake_store) -> None:
    settings = Settings(gemini_api_key="")
    status = asyncio.run(app_settings.gemini_status(settings))
    assert status["geminiKeySet"] is False
    assert status["source"] == "none"


# ── the write paths are GONE ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    "method,path",
    [
        ("put", "/api/web/settings/gemini-key"),
        ("delete", "/api/web/settings/gemini-key"),
        ("put", "/api/web/settings/tavus-key"),
        ("delete", "/api/web/settings/tavus-key"),
    ],
)
def test_no_route_can_write_a_credential(
    authed_client: TestClient, fake_store, method: str, path: str
) -> None:
    """There were THREE ways to set a vendor key from a browser, and all are removed.

    Two named routes plus a third copy riding on the avatar config. Each let one
    authenticated recruiter change the credential that scores and runs every other
    recruiter's candidate interviews on the deployment — which is exactly what
    "credentials never reach the browser" exists to prevent. The mobile client never
    had any of them.

    Keys come from the environment now, and this asserts there is no longer a route
    that says otherwise.
    """
    response = authed_client.request(method.upper(), path, json={"apiKey": REAL_KEY})
    assert response.status_code in (404, 405), (
        f"{method.upper()} {path} still exists — a credential can be written from a "
        "browser"
    )


def test_applying_an_avatar_config_cannot_smuggle_a_key(
    authed_client: TestClient, fake_store
) -> None:
    """The third write path, which was the easiest to miss.

    `normalise_avatar_config` accepted a `tavusKey` from the request body, so applying
    an avatar was a way to set the credential without going near a route named for it.
    """
    authed_client.put(
        "/api/web/settings/avatar",
        json={"replicaId": "r1", "tavusKey": "smuggled-key"},
    )
    stored = fake_store.settings.doc.get("avatar") or {}
    assert stored.get("tavusKey") in (None, ""), "a key reached the store from a body"
    assert "smuggled-key" not in str(fake_store.settings.doc)


# ── Tavus key resolution ──────────────────────────────────────────────────────


def test_tavus_key_precedence(fake_store) -> None:
    """Three sources, in the order candidate interviews actually resolve them."""
    settings = Settings(tavus_api_key="env-key")

    fake_store.settings.doc = {}
    assert asyncio.run(app_settings.tavus_key(settings)) == "env-key"

    fake_store.settings.doc = {"avatar": {"tavusKey": "avatar-key"}}
    assert asyncio.run(app_settings.tavus_key(settings)) == "avatar-key"

    fake_store.settings.doc = {"tavusApiKey": "global-key", "avatar": {"tavusKey": "avatar-key"}}
    assert asyncio.run(app_settings.tavus_key(settings)) == "global-key"


# ── avatar config normalisation ───────────────────────────────────────────────


def test_a_blank_field_becomes_none_not_empty_string() -> None:
    """A blank customGreeting would make the avatar open the call with silence."""
    config = normalise_avatar_config({"replicaId": "r1", "customGreeting": "   "})
    assert config["customGreeting"] is None
    assert config["replicaId"] == "r1"


def test_long_fields_are_capped() -> None:
    config = normalise_avatar_config({"replicaId": "r1", "aiName": "x" * 200})
    assert len(config["aiName"]) == MAX_AI_NAME


def test_call_duration_is_bounded() -> None:
    """Tavus rejects a call under a minute and caps at two hours."""
    assert normalise_avatar_config({"replicaId": "r", "maxCallDuration": 30})["maxCallDuration"] is None
    assert normalise_avatar_config({"replicaId": "r", "maxCallDuration": MIN_CALL_SECONDS})["maxCallDuration"] == MIN_CALL_SECONDS
    assert normalise_avatar_config({"replicaId": "r", "maxCallDuration": 99999})["maxCallDuration"] == MAX_CALL_SECONDS
    assert normalise_avatar_config({"replicaId": "r", "maxCallDuration": "an hour"})["maxCallDuration"] is None


def test_recording_is_only_ever_true_or_absent() -> None:
    """`False` and "not configured" mean the same thing to Tavus, so storing False
    would imply a choice the recruiter did not make."""
    assert normalise_avatar_config({"replicaId": "r", "enableRecording": True})["enableRecording"] is True
    assert normalise_avatar_config({"replicaId": "r", "enableRecording": False})["enableRecording"] is None
    assert normalise_avatar_config({"replicaId": "r"})["enableRecording"] is None


def test_fallback_questions_are_filtered_and_capped() -> None:
    config = normalise_avatar_config(
        {"replicaId": "r", "fallbackQuestions": ["  Q1  ", "", None, 42, *["Q"] * 50]}
    )
    assert len(config["fallbackQuestions"]) == MAX_FALLBACK_QUESTIONS
    assert config["fallbackQuestions"][0] == "Q1"


def test_a_non_list_fallback_is_ignored() -> None:
    assert normalise_avatar_config({"replicaId": "r", "fallbackQuestions": "Q"})["fallbackQuestions"] is None


# ── avatar status + routes ────────────────────────────────────────────────────


def test_configured_needs_both_a_replica_and_a_key(fake_store) -> None:
    """Reporting either alone as configured would promise a feature that then fails
    at interview time."""
    settings = Settings(tavus_api_key="")

    fake_store.settings.doc = {"avatar": {"replicaId": "r1"}}
    assert asyncio.run(app_settings.avatar_status(settings))["configured"] is False

    fake_store.settings.doc = {"avatar": {"replicaId": "r1", "tavusKey": "k"}}
    assert asyncio.run(app_settings.avatar_status(settings))["configured"] is True

    fake_store.settings.doc = {"tavusApiKey": "k", "avatar": {}}
    assert asyncio.run(app_settings.avatar_status(settings))["configured"] is False


def test_applying_a_config_without_a_replica_is_rejected(authed_client: TestClient) -> None:
    response = authed_client.put("/api/web/settings/avatar", json={"language": "English"})
    assert response.status_code == 400
    assert "replica is required" in response.json()["error"]


def test_reapplying_a_config_keeps_a_previously_stored_key(
    authed_client: TestClient, fake_store
) -> None:
    """Re-applying from the Setup page must not clear the key and break every
    candidate interview.

    The key can no longer ARRIVE in the request body — that was one of three ways to
    write a credential from a browser — so it is seeded here as a deployment that
    already has one. What matters is unchanged: `save_avatar` carries it forward.
    """
    fake_store.settings.doc = {"avatar": {"replicaId": "r1", "tavusKey": "k1"}}

    authed_client.put("/api/web/settings/avatar", json={"replicaId": "r2"})

    assert fake_store.settings.doc["avatar"]["tavusKey"] == "k1"
    assert fake_store.settings.doc["avatar"]["replicaId"] == "r2"


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/web/settings"),
        ("get", "/api/web/settings/avatar"),
        ("put", "/api/web/settings/gemini-key"),
        ("put", "/api/web/settings/tavus-key"),
        ("put", "/api/web/settings/avatar"),
        ("delete", "/api/web/settings/gemini-key"),
        ("delete", "/api/web/settings/tavus-key"),
        ("delete", "/api/web/settings/avatar"),
    ],
)
def test_no_settings_route_ever_returns_a_raw_key(
    authed_client: TestClient, fake_store, method: str, path: str
) -> None:
    """The invariant. Every route, every verb, on a store that holds real keys."""
    fake_store.settings.doc = {
        "geminiApiKey": REAL_KEY,
        "tavusApiKey": "tavus-secret-value-12345",
        "avatar": {"replicaId": "r1", "tavusKey": "tavus-secret-value-12345"},
    }

    # `request` rather than the per-verb helpers: those reject `json=` on GET and
    # DELETE, and the point of this test is that the body makes no difference.
    response = authed_client.request(
        method.upper(), path, json={"apiKey": REAL_KEY, "replicaId": "r1"}
    )
    assert response.status_code < 500
    body = response.text
    assert REAL_KEY not in body
    assert "tavus-secret-value-12345" not in body


def test_settings_require_a_token() -> None:
    from app.main import create_app

    assert TestClient(create_app()).get("/api/web/settings").status_code == 401

"""Phase 3: the REST proxy routes.

Google, Tavus and Deepgram are mocked at the httpx transport layer, so the real
request-building, auth-header and error-mapping code runs. What matters here is
that credentials go up and never come back, that the client cannot choose the
model or the upstream, and that oversized payloads are refused before we forward
them to a vendor that bills us.
"""

from __future__ import annotations

import os

os.environ.setdefault("DRY_RUN", "true")
os.environ.setdefault("API_KEY", "")

import json  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.providers import base  # noqa: E402
from app.security import AuthedUser, require_firebase_user  # noqa: E402

USER = AuthedUser(uid="u-1", email="user@example.com", claims={})

KEYS = dict(
    gemini_api_key="AIza-gemini",
    tavus_api_key="tavus-secret",
    deepgram_api_key="dg-secret",
)


@pytest.fixture
def client(monkeypatch):
    """App with every vendor mocked. `state['calls']` records what we sent."""
    app = create_app()
    app.state.settings = Settings(_env_file=None, **KEYS)

    state: dict = {"calls": [], "routes": {}}

    def handler(request: httpx.Request) -> httpx.Response:
        state["calls"].append(
            {
                "method": request.method,
                "url": str(request.url),
                "headers": dict(request.headers),
                "content": request.content,
            }
        )
        for fragment, response in state["routes"].items():
            if fragment in str(request.url):
                return response
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(
        base, "_client", httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    app.dependency_overrides[require_firebase_user] = lambda: USER

    test_client = TestClient(app, raise_server_exceptions=False)
    test_client.state = state  # type: ignore[attr-defined]
    return test_client


def last(client) -> dict:
    return client.state["calls"][-1]


def sent_json(client) -> dict:
    return json.loads(last(client)["content"] or b"{}")


# --- every route is authenticated -----------------------------------------
PROTECTED = [
    ("get", "/api/tavus/replicas"),
    ("get", "/api/tavus/personas"),
    ("post", "/api/tavus/conversations"),
    ("get", "/api/tavus/conversations/c1"),
    ("get", "/api/tavus/conversations/c1/verbose"),
    ("post", "/api/tavus/conversations/c1/end"),
    ("post", "/api/tavus/conversations/c1/interactions"),
    ("post", "/api/gemini/generate"),
    ("post", "/api/deepgram/transcribe"),
]


@pytest.mark.parametrize(("method", "path"), PROTECTED)
def test_no_route_is_reachable_without_a_verified_user(client, method, path):
    """The router applies auth once, so a new endpoint cannot forget it."""
    client.app.dependency_overrides.clear()
    # GET takes no body in TestClient; POST routes need one to reach the guard.
    kwargs = {"json": {}} if method == "post" else {}
    response = getattr(client, method)(path, **kwargs)
    assert response.status_code == 401, f"{path} was reachable unauthenticated"
    assert not client.state["calls"], "an unauthenticated call reached the vendor"


# --- Tavus -----------------------------------------------------------------
def test_stock_replicas_are_labelled_so_the_picker_can_group_them(client):
    """The stock endpoint does not label its results, and the client can no
    longer tell which upstream call a replica came from."""

    def handler(request: httpx.Request) -> httpx.Response:
        if "replica_type=stock" in str(request.url):
            return httpx.Response(200, json={"data": [{"replica_id": "s1"}]})
        return httpx.Response(200, json={"data": [{"replica_id": "c1"}]})

    base._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    data = client.get("/api/tavus/replicas").json()["data"]
    by_id = {r["replica_id"]: r for r in data}
    assert by_id["s1"]["replica_type"] == "stock"
    assert "replica_type" not in by_id["c1"]


def test_replicas_merge_custom_and_stock_without_duplicates(client):
    def handler(request: httpx.Request) -> httpx.Response:
        client.state["calls"].append({"url": str(request.url), "headers": {}, "content": b""})
        if "replica_type=stock" in str(request.url):
            return httpx.Response(200, json={"data": [{"replica_id": "shared"}, {"replica_id": "s1"}]})
        return httpx.Response(200, json={"data": [{"replica_id": "shared"}, {"replica_id": "c1"}]})

    base._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    ids = [r["replica_id"] for r in client.get("/api/tavus/replicas").json()["data"]]
    assert ids == ["shared", "c1", "s1"]


def test_replicas_survive_one_upstream_failing(client):
    def handler(request: httpx.Request) -> httpx.Response:
        if "replica_type=stock" in str(request.url):
            return httpx.Response(500, json={"error": "boom"})
        return httpx.Response(200, json={"data": [{"replica_id": "c1"}]})

    base._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    response = client.get("/api/tavus/replicas")
    # A recruiter with only custom replicas must still get a populated picker.
    assert response.status_code == 200
    assert [r["replica_id"] for r in response.json()["data"]] == ["c1"]


def test_tavus_key_is_sent_upstream_and_never_returned(client):
    body = client.get("/api/tavus/personas").json()
    assert last(client)["headers"]["x-api-key"] == "tavus-secret"
    assert "tavus-secret" not in json.dumps(body)


def test_ending_a_call_posts_to_end_and_never_deletes(client):
    client.post("/api/tavus/conversations/c1/end")
    call = last(client)
    # DELETE would destroy the transcript the results pipeline still needs.
    assert call["method"] == "POST"
    assert call["url"].endswith("/conversations/c1/end")


def test_verbose_conversation_requests_the_transcript(client):
    client.get("/api/tavus/conversations/c1/verbose")
    assert "verbose=true" in last(client)["url"]


def test_interaction_requires_text(client):
    assert client.post("/api/tavus/conversations/c1/interactions", json={}).status_code == 422
    assert not client.state["calls"]


def test_interaction_builds_the_overwrite_context_envelope(client):
    client.post("/api/tavus/conversations/c1/interactions", json={"text": "Next question"})
    payload = sent_json(client)
    assert payload["event_type"] == "conversation.overwrite_context"
    assert payload["properties"]["context"] == "Next question"


# --- Gemini ----------------------------------------------------------------
def _contents() -> dict:
    return {"contents": [{"parts": [{"text": "score this"}]}]}


def test_generate_requires_contents(client):
    assert client.post("/api/gemini/generate", json={}).status_code == 422
    assert not client.state["calls"]


def test_model_is_chosen_by_the_server_not_the_caller(client):
    client.app.state.settings = Settings(_env_file=None, gemini_model="gemini-2.5-flash", **{k: v for k, v in KEYS.items() if k != "gemini_model"})
    client.post("/api/gemini/generate", json={**_contents(), "model": "gemini-9-ultra"})
    # A client cannot switch to a pricier model or reach a different API.
    assert "gemini-2.5-flash:generateContent" in last(client)["url"]
    assert "gemini-9-ultra" not in last(client)["url"]


def test_safety_settings_are_applied_when_the_caller_omits_them(client):
    client.post("/api/gemini/generate", json=_contents())
    settings = sent_json(client)["safetySettings"]
    assert {s["category"] for s in settings} == {
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
    }


def test_caller_supplied_safety_settings_are_respected(client):
    custom = [{"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"}]
    client.post("/api/gemini/generate", json={**_contents(), "safetySettings": custom})
    assert sent_json(client)["safetySettings"] == custom


def test_gemini_key_is_sent_upstream_and_never_returned(client):
    body = client.post("/api/gemini/generate", json=_contents()).json()
    assert last(client)["headers"]["x-goog-api-key"] == "AIza-gemini"
    assert "AIza-gemini" not in json.dumps(body)


# --- Deepgram --------------------------------------------------------------
def test_transcribe_forwards_raw_audio_and_its_content_type(client):
    client.post(
        "/api/deepgram/transcribe",
        content=b"RIFFfake-wav-bytes",
        headers={"Content-Type": "audio/wav"},
    )
    call = last(client)
    assert call["content"] == b"RIFFfake-wav-bytes"
    assert call["headers"]["content-type"] == "audio/wav"
    assert call["headers"]["authorization"] == "Token dg-secret"
    # Both are required for scoring and per-question slicing.
    assert "punctuate=true" in call["url"] and "smart_format=true" in call["url"]


def test_transcribe_rejects_an_empty_body_before_calling_the_vendor(client):
    assert client.post("/api/deepgram/transcribe", content=b"").status_code == 422
    assert not client.state["calls"]


def test_transcribe_language_is_forwarded(client):
    client.post(
        "/api/deepgram/transcribe",
        content=b"x",
        params={"language": "es-ES"},
        headers={"Content-Type": "audio/wav"},
    )
    assert "language=es-ES" in last(client)["url"]


# --- unconfigured providers ------------------------------------------------
@pytest.mark.parametrize(
    ("method", "path", "env_var"),
    [
        ("get", "/api/tavus/personas", "TAVUS_API_KEY"),
        ("post", "/api/gemini/generate", "GEMINI_API_KEY"),
    ],
)
def test_a_missing_key_is_503_naming_the_env_var(client, method, path, env_var):
    client.app.state.settings = Settings(_env_file=None)
    kwargs = {"json": _contents()} if method == "post" else {}
    response = getattr(client, method)(path, **kwargs)
    assert response.status_code == 503
    assert env_var in response.json()["detail"]
    assert not client.state["calls"]


def test_an_allowed_model_may_be_requested(client):
    """Recruiters legitimately choose between flash and pro."""
    client.post("/api/gemini/generate", params={"model": "gemini-3.1-pro-preview"}, json=_contents())
    assert "gemini-3.1-pro-preview:generateContent" in last(client)["url"]


def test_a_disallowed_model_falls_back_instead_of_erroring(client):
    # A stale client should still get a scored interview, just on the default.
    client.post(
        "/api/gemini/generate", params={"model": "gemini-9-ultra"}, json=_contents()
    )
    assert "gemini-3.6-flash:generateContent" in last(client)["url"]


def test_the_models_prefix_is_tolerated(client):
    client.post(
        "/api/gemini/generate", params={"model": "models/gemini-3.1-pro-preview"}, json=_contents()
    )
    assert "gemini-3.1-pro-preview:generateContent" in last(client)["url"]


# --- Tavus session defaults (org infrastructure, server-side) --------------
def test_org_defaults_are_merged_into_a_new_conversation(client):
    """The S3 destination and timeouts used to be text fields in the app."""
    client.app.state.settings = Settings(
        _env_file=None,
        tavus_enable_recording=True,
        tavus_recording_s3_bucket="acme-interviews",
        tavus_recording_s3_region="ap-south-1",
        tavus_aws_assume_role_arn="arn:aws:iam::1:role/tavus",
        **KEYS,
    )
    client.post("/api/tavus/conversations", json={"replica_id": "r1"})
    props = sent_json(client)["properties"]

    assert props["recording_s3_bucket_name"] == "acme-interviews"
    assert props["recording_s3_bucket_region"] == "ap-south-1"
    assert props["aws_assume_role_arn"] == "arn:aws:iam::1:role/tavus"
    assert props["enable_recording"] is True
    assert props["participant_absent_timeout"] == 300


def test_no_s3_target_is_sent_when_recording_is_off(client):
    client.app.state.settings = Settings(
        _env_file=None,
        tavus_enable_recording=False,
        tavus_recording_s3_bucket="acme-interviews",
        **KEYS,
    )
    client.post("/api/tavus/conversations", json={"replica_id": "r1"})
    props = sent_json(client)["properties"]
    assert props["enable_recording"] is False
    # A partial S3 target is rejected by Tavus, so send none of it.
    assert "recording_s3_bucket_name" not in props


def test_per_interview_properties_win_over_org_defaults(client):
    """The interview's own duration must not be clobbered by a global default."""
    client.post(
        "/api/tavus/conversations",
        json={"replica_id": "r1", "properties": {"max_call_duration": 1800}},
    )
    props = sent_json(client)["properties"]
    assert props["max_call_duration"] == 1800
    # …and the org defaults still arrive alongside it.
    assert "enable_transcription" in props


def test_a_client_cannot_choose_its_own_recording_destination(client):
    """Recording writes to org storage using the org's AWS role. A client that
    could pick the bucket would have that role write wherever it liked."""
    client.app.state.settings = Settings(
        _env_file=None,
        tavus_enable_recording=True,
        tavus_recording_s3_bucket="acme-interviews",
        **KEYS,
    )
    client.post(
        "/api/tavus/conversations",
        json={
            "replica_id": "r1",
            "properties": {
                "recording_s3_bucket_name": "attacker-bucket",
                "aws_assume_role_arn": "arn:aws:iam::999:role/attacker",
                "enable_recording": False,
            },
        },
    )
    props = sent_json(client)["properties"]
    assert props["recording_s3_bucket_name"] == "acme-interviews"
    # The server has no role ARN configured, so the field must be ABSENT rather
    # than carrying the caller's — a locked field is dropped, never passed through.
    assert props.get("aws_assume_role_arn") is None
    # Nor can a caller silently turn recording off for an org that requires it.
    assert props["enable_recording"] is True


def test_locking_does_not_block_legitimate_per_interview_properties(client):
    client.post(
        "/api/tavus/conversations",
        json={
            "replica_id": "r1",
            "properties": {"max_call_duration": 900, "language": "Spanish"},
        },
    )
    props = sent_json(client)["properties"]
    assert props["max_call_duration"] == 900
    assert props["language"] == "Spanish"

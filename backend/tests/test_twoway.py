"""The two-way interview: a live recruiter ↔ candidate call.

Two properties carry the security of this track and get the most attention:

1. **Only the recruiter gets an owner token.** Ownership is what admits people
   past Daily's lobby, so a candidate holding one could let themselves — and
   anyone else — into the call.
2. **Only the recruiter can create the room.** The candidate's join answers 409
   until it exists, which is what the app polls on. A candidate who could create
   it would be sitting in a room the recruiter has no owner token for.

No network: Daily is mocked at the HTTP layer, so the real request building,
auth-header and error-mapping code stays in the path.
"""

from __future__ import annotations

import os

os.environ.setdefault("DRY_RUN", "true")
os.environ.setdefault("API_KEY", "")

import json  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import interviews  # noqa: E402
from app.config import Settings  # noqa: E402
from app.interviews import Interview  # noqa: E402
from app.main import create_app  # noqa: E402
from app.providers import base  # noqa: E402
from app.providers.daily import room_name_for  # noqa: E402
from app.security import AuthedUser, require_firebase_user  # noqa: E402

CANDIDATE = AuthedUser(uid="cand-1", email="Candidate@Example.com", claims={})
RECRUITER = AuthedUser(uid="rec-1", email="rec@example.com", claims={})
STRANGER = AuthedUser(uid="who-1", email="nobody@example.com", claims={})

ROOM_URL = "https://talbotiq.daily.co/room-int-1"


def make_interview(**overrides) -> Interview:
    fields = dict(
        id="int-1",
        recruiter_id="rec-1",
        candidate_email_lower="candidate@example.com",
        candidate_name="Casey",
        recruiter_name="Priya",
        title="Final panel",
        prompt="",
        round_kind="two_way",
    )
    fields.update(overrides)
    return Interview(**fields)


@pytest.fixture
def client(monkeypatch):
    app = create_app()
    app.state.settings = Settings(
        _env_file=None, daily_api_key="daily-test", daily_domain="talbotiq.daily.co"
    )

    state: dict = {
        "interview": make_interview(),
        "user": RECRUITER,
        "sent": [],          # requests that reached Daily
        "saved": [],         # writes that reached Firestore
        "room_exists": False,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        body = json.loads(request.content or b"{}")
        state["sent"].append(
            {"method": request.method, "path": path, "json": body}
        )

        if request.method == "GET" and path.startswith("/v1/rooms/"):
            if not state["room_exists"]:
                return httpx.Response(404, json={"error": "not-found"})
            return httpx.Response(200, json={"name": "room-int-1", "url": ROOM_URL})

        if request.method == "POST" and path == "/v1/rooms":
            state["room_exists"] = True
            return httpx.Response(200, json={"name": "room-int-1", "url": ROOM_URL})

        if request.method == "POST" and path == "/v1/meeting-tokens":
            owner = body.get("properties", {}).get("is_owner")
            return httpx.Response(
                200, json={"token": f"tok-{'owner' if owner else 'guest'}"}
            )

        if request.method == "DELETE" and path.startswith("/v1/rooms/"):
            state["room_exists"] = False
            return httpx.Response(200, json={"deleted": True})

        return httpx.Response(500, json={"error": "unexpected"})

    monkeypatch.setattr(
        base, "_client", httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    monkeypatch.setattr(interviews, "fetch", lambda _s, _id: state["interview"])
    monkeypatch.setattr(
        interviews,
        "save_evaluation",
        lambda _s, interview_id, *, result: state["saved"].append(
            {"id": interview_id, "result": result}
        ),
    )
    app.dependency_overrides[require_firebase_user] = lambda: state["user"]

    test_client = TestClient(app, raise_server_exceptions=False)
    test_client.state = state  # type: ignore[attr-defined]
    return test_client


def host(client):
    return client.post("/api/interviews/int-1/twoway/host")


def join(client):
    return client.post("/api/interviews/int-1/twoway/join")


def complete(client):
    return client.post("/api/interviews/int-1/twoway/complete")


# --- the ordering that makes the flow work --------------------------------
def test_the_candidate_waits_until_the_recruiter_opens_the_room(client):
    client.state["user"] = CANDIDATE

    response = join(client)

    # 409, not 404: the interview exists and is theirs — the interviewer simply
    # is not there yet. The app polls on exactly this.
    assert response.status_code == 409
    assert "has not started" in response.json()["detail"]
    # No token was minted for a room that does not exist.
    assert not any(s["path"] == "/v1/meeting-tokens" for s in client.state["sent"])


def test_the_recruiter_opening_the_call_creates_the_room(client):
    response = host(client)

    assert response.status_code == 200
    body = response.json()
    assert body["roomUrl"] == ROOM_URL
    assert body["isOwner"] is True
    assert body["token"] == "tok-owner"
    assert any(
        s["method"] == "POST" and s["path"] == "/v1/rooms"
        for s in client.state["sent"]
    )


def test_the_candidate_can_join_once_the_room_exists(client):
    host(client)
    client.state["user"] = CANDIDATE

    response = join(client)

    assert response.status_code == 200
    assert response.json()["token"] == "tok-guest"
    assert room_name_for("int-1") in response.json()["roomUrl"]


# --- ownership is the authorisation model ---------------------------------
def test_the_candidate_never_receives_an_owner_token(client):
    host(client)
    client.state["user"] = CANDIDATE
    join(client)

    minted = [s for s in client.state["sent"] if s["path"] == "/v1/meeting-tokens"]
    candidate_token = minted[-1]["json"]["properties"]
    # An owner can admit knockers past the lobby and eject people. The candidate
    # must never be one — asserted both on the wire to Daily and in what the app
    # is told, because the app uses `isOwner` to decide which controls to show.
    assert candidate_token["is_owner"] is False
    assert join(client).json()["isOwner"] is False


def test_a_candidate_cannot_open_the_call(client):
    client.state["user"] = CANDIDATE

    response = host(client)

    assert response.status_code == 403
    # Nothing was created, so the recruiter still opens a fresh room later.
    assert not any(s["path"] == "/v1/rooms" for s in client.state["sent"])


def test_a_stranger_gets_nothing(client):
    client.state["user"] = STRANGER
    assert host(client).status_code == 403
    assert join(client).status_code == 403
    assert complete(client).status_code == 403
    assert client.state["sent"] == []


# --- re-joining -----------------------------------------------------------
def test_hosting_twice_returns_the_same_room(client):
    first = host(client).json()
    second = host(client).json()

    # A recruiter whose connection dropped must return to the SAME call, not
    # open a second empty one beside it.
    assert first["roomUrl"] == second["roomUrl"]
    creates = [
        s for s in client.state["sent"]
        if s["method"] == "POST" and s["path"] == "/v1/rooms"
    ]
    assert len(creates) == 1, "the room is created once and then reused"


# --- ending ---------------------------------------------------------------
def test_ending_deletes_the_room_and_awaits_the_recruiter_review(client):
    host(client)

    response = complete(client)

    assert response.status_code == 200
    assert response.json()["awaitingReview"] is True
    assert any(s["method"] == "DELETE" for s in client.state["sent"])

    saved = client.state["saved"][-1]["result"]
    # A human ran this interview, so a human scores it. No score, and crucially
    # NO error — "awaiting review" is not a failure.
    assert "overallScore" not in saved
    assert saved["evaluatedBy"] == ""
    assert saved["evaluationError"] == ""
    assert saved["awaitingRecruiterReview"] is True


def test_only_the_recruiter_can_end_the_call(client):
    host(client)
    client.state["user"] = CANDIDATE
    assert complete(client).status_code == 403
    assert client.state["saved"] == []


# --- guards ---------------------------------------------------------------
def test_a_non_two_way_round_is_refused(client):
    # Minting a Daily token for a résumé round would spend on a call nobody is
    # going to have.
    client.state["interview"] = make_interview(round_kind="resume")
    assert host(client).status_code == 400
    assert join(client).status_code == 400
    assert client.state["sent"] == []


def test_an_expired_round_stops_the_candidate_but_not_the_recruiter(client):
    from datetime import datetime, timedelta, timezone

    host(client)
    client.state["interview"] = make_interview(
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1)
    )

    client.state["user"] = CANDIDATE
    assert join(client).status_code == 409

    # The owning recruiter may still get in — they need to be able to preview
    # and to reopen a call that overran.
    client.state["user"] = RECRUITER
    assert join(client).status_code == 200


def test_an_unconfigured_key_is_503_not_a_confusing_vendor_error(client):
    client.app.state.settings = Settings(_env_file=None, daily_api_key="")
    response = host(client)
    assert response.status_code == 503
    assert "DAILY_API_KEY" in response.json()["detail"]


def test_an_unknown_interview_is_404(client, monkeypatch):
    def missing(_s, _id):
        raise interviews.InterviewNotFound("nope")

    monkeypatch.setattr(interviews, "fetch", missing)
    assert host(client).status_code == 404


# --- provider details -----------------------------------------------------
def test_the_room_name_is_derived_not_stored():
    # Both sides compute the same name from the same id, so there is nothing to
    # keep in sync and a re-join always finds the same room.
    assert room_name_for("abc123") == "room-abc123"


def test_rooms_are_private_with_a_lobby_and_an_expiry(client):
    host(client)
    create = next(
        s for s in client.state["sent"]
        if s["method"] == "POST" and s["path"] == "/v1/rooms"
    )
    props = create["json"]["properties"]

    assert create["json"]["privacy"] == "private"
    # Daily's built-in lobby: the candidate knocks, the recruiter admits.
    assert props["enable_knocking"] is True
    # Self-expiring, so an abandoned interview does not leave a room open for
    # anyone who still has the URL.
    assert props["exp"] > 0
    assert props["eject_at_room_exp"] is True
    # Recording is a paid Daily feature and is deliberately not requested.
    assert "enable_recording" not in props


def test_the_api_key_reaches_daily_and_never_the_caller(client):
    body = host(client).json()
    assert "daily-test" not in json.dumps(body)


def test_the_token_outlives_the_room(client):
    # A token expiring first would fail a re-join into a room that is still
    # perfectly alive.
    from app.providers.daily import ROOM_TTL_SECONDS, TOKEN_TTL_SECONDS

    assert TOKEN_TTL_SECONDS > ROOM_TTL_SECONDS


# --- the engine switch ----------------------------------------------------
# `TWOWAY_ENGINE` has to mean the same thing here as it does on the web surface
# (`app.web.__init__`). When it did not, a deployment on LiveKit left the mobile
# app talking to a Daily domain the website had already abandoned, and the app
# could not join a call the browser joined fine.
LIVEKIT_URL = "wss://lk.talbotiq.internal"


@pytest.fixture
def livekit_client(client, monkeypatch):
    """The same fixture, switched to LiveKit.

    LiveKit is stubbed at the CLIENT rather than the HTTP layer: its SDK signs
    and speaks its own protocol, so a MockTransport would test nothing real. What
    matters here is the ROUTING decision — which client the router picks and
    which URL it hands back — so that is what is asserted.
    """
    from app.providers import livekit as livekit_provider

    client.app.state.settings = Settings(
        _env_file=None,
        twoway_engine="livekit",
        livekit_url=LIVEKIT_URL,
        livekit_api_key="lk-key",
        livekit_api_secret="lk-secret",
        # Deliberately still set: if the router leaks back to Daily, the response
        # will say so rather than fail for want of configuration.
        daily_api_key="daily-test",
        daily_domain="talbotiq.daily.co",
    )

    calls = client.state["livekit"] = []

    async def ensure_room(self, room_name, *, now_seconds):
        calls.append(("ensure_room", room_name))
        client.state["room_exists"] = True
        return {"url": LIVEKIT_URL, "name": room_name}

    async def room_exists(self, room_name):
        return bool(client.state["room_exists"])

    async def mint_token(self, *, room_name, is_owner, user_name, now_seconds):
        calls.append(("mint_token", room_name, is_owner))
        return f"lk-{'owner' if is_owner else 'guest'}"

    async def delete_room(self, room_name):
        calls.append(("delete_room", room_name))
        client.state["room_exists"] = False

    for name, fn in (
        ("ensure_room", ensure_room),
        ("room_exists", room_exists),
        ("mint_token", mint_token),
        ("delete_room", delete_room),
    ):
        monkeypatch.setattr(livekit_provider.LiveKitClient, name, fn)

    client.state["room_exists"] = False
    return client


def test_livekit_engine_hands_back_the_ws_endpoint_not_a_daily_room(livekit_client):
    body = host(livekit_client).json()

    assert body["roomUrl"] == LIVEKIT_URL
    assert body["token"] == "lk-owner"
    # Nothing was asked of Daily — the whole point of the switch.
    assert not livekit_client.state["sent"]


def test_livekit_gives_both_sides_the_same_endpoint(livekit_client):
    host(livekit_client)
    livekit_client.state["user"] = CANDIDATE

    body = join(livekit_client).json()

    # LiveKit identifies the room from the token, so host and join must answer
    # the identical URL — a per-room URL here would send the two parties to
    # different places.
    assert body["roomUrl"] == LIVEKIT_URL
    assert body["isOwner"] is False
    assert body["token"] == "lk-guest"


def test_livekit_keeps_the_candidate_waiting_until_the_room_exists(livekit_client):
    livekit_client.state["user"] = CANDIDATE

    response = join(livekit_client)

    assert response.status_code == 409
    assert "has not started" in response.json()["detail"]


def test_livekit_ends_the_call_by_deleting_the_room(livekit_client):
    host(livekit_client)

    assert complete(livekit_client).status_code == 200
    assert ("delete_room", room_name_for("int-1")) in livekit_client.state["livekit"]
    # Still a human-scored round: ending it records an awaiting-review evaluation
    # rather than a score, exactly as the Daily engine does.
    assert livekit_client.state["saved"][-1]["result"]["awaitingRecruiterReview"]

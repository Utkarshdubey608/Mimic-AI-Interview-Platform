"""The live-transcription relays and the voice token.

The relay's one non-obvious requirement is frame typing: Deepgram sends results as TEXT
frames, and relaying them as binary turns the JSON into an ArrayBuffer the browser's
`JSON.parse` chokes on. The symptom is a transcript that silently never commits, which is
exactly the kind of failure that reaches production. So the relay is exercised against a
stand-in upstream rather than only reasoned about.
"""

from __future__ import annotations

import asyncio
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.security import AuthedUser, require_firebase_user
from app.web.deps import web_user_from_query
from app.web.routes import ws_deepgram
from app.web.services import voice_setup

CANDIDATE = AuthedUser(uid="uid-cand", email="ada@example.test", claims={})


# ── upstream request shape ────────────────────────────────────────────────────


def test_the_upstream_url_carries_the_transcription_options() -> None:
    query = parse_qs(urlparse(ws_deepgram.upstream_url()).query)

    assert query["model"] == ["nova-3"]
    # Captions appear as the candidate speaks rather than after each utterance.
    assert query["interim_results"] == ["true"]
    # Deliberate: the speech metrics count fillers, so Deepgram must not remove them.
    assert query["filler_words"] == ["true"]
    assert query["vad_events"] == ["true"]


def test_the_upstream_host_is_deepgram() -> None:
    assert urlparse(ws_deepgram.upstream_url()).netloc == "api.deepgram.com"


# ── the relay, against a stand-in upstream ────────────────────────────────────


class _FakeUpstream:
    """Enough of a `websockets` connection to drive the relay.

    Records what was sent up, and yields what the test queues coming down — so the
    frame-type assertions below are about real relay behaviour, not a mock's opinion.
    """

    def __init__(self, incoming: list) -> None:
        self.sent: list = []
        self._incoming = list(incoming)
        self.closed = False

    async def send(self, data) -> None:
        self.sent.append(data)

    async def close(self) -> None:
        self.closed = True

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> None:
        self.closed = True

    def __aiter__(self):
        async def _gen():
            for message in self._incoming:
                yield message
            # Then block, so the relay ends via the client's disconnect rather than an
            # upstream close — which is the ordinary case.
            await asyncio.sleep(3600)

        return _gen()


def _app_with_upstream(monkeypatch, upstream: _FakeUpstream, *, key: str = "dg-key") -> FastAPI:
    import websockets

    async def _connect(*args, **kwargs):
        return upstream

    monkeypatch.setattr(websockets, "connect", _connect)

    app = create_app()
    app.state.settings = Settings(deepgram_api_key=key)
    app.dependency_overrides[require_firebase_user] = lambda: CANDIDATE
    app.dependency_overrides[web_user_from_query] = lambda: CANDIDATE
    # The WebSocket routes resolve their caller through their own dependency, so it
    # needs its own override — see `ws_user` for why it cannot reuse the HTTP one.
    app.dependency_overrides[ws_deepgram.ws_user] = lambda: CANDIDATE
    return app


@pytest.mark.parametrize(
    "path", ["/api/web/avatar/deepgram", "/api/web/interview/deepgram"]
)
def test_results_come_back_as_text_frames(monkeypatch, path: str) -> None:
    """The bug this guards: relaying Deepgram's JSON as binary makes the browser's
    `JSON.parse` fail, and the transcript silently never commits."""
    upstream = _FakeUpstream(['{"channel":{"alternatives":[{"transcript":"hello"}]}}'])
    app = _app_with_upstream(monkeypatch, upstream)

    with TestClient(app).websocket_connect(f"{path}?token=x") as socket:
        message = socket.receive()

    assert "text" in message, "Deepgram's JSON must be relayed as a TEXT frame"
    assert "hello" in message["text"]


def test_binary_frames_stay_binary(monkeypatch) -> None:
    upstream = _FakeUpstream([b"\x00\x01\x02"])
    app = _app_with_upstream(monkeypatch, upstream)

    with TestClient(app).websocket_connect("/api/web/avatar/deepgram?token=x") as socket:
        message = socket.receive()

    assert message.get("bytes") == b"\x00\x01\x02"


def test_audio_is_forwarded_upstream(monkeypatch) -> None:
    upstream = _FakeUpstream([])
    app = _app_with_upstream(monkeypatch, upstream)

    with TestClient(app).websocket_connect("/api/web/avatar/deepgram?token=x") as socket:
        socket.send_bytes(b"audio-chunk")
        socket.send_text('{"type":"CloseStream"}')

    assert b"audio-chunk" in upstream.sent
    # Control messages go up as TEXT — Deepgram parses them as JSON.
    assert '{"type":"CloseStream"}' in upstream.sent


def test_an_oversized_frame_is_dropped_not_forwarded(monkeypatch) -> None:
    """A metered vendor should not receive a frame that can only be a client fault."""
    upstream = _FakeUpstream([])
    app = _app_with_upstream(monkeypatch, upstream)

    with TestClient(app).websocket_connect("/api/web/avatar/deepgram?token=x") as socket:
        socket.send_bytes(b"x" * (ws_deepgram.MAX_FRAME_BYTES + 1))
        socket.send_bytes(b"ok")

    assert upstream.sent == [b"ok"]


def test_a_client_disconnect_closes_the_upstream(monkeypatch) -> None:
    """Telling Deepgram the stream ended makes it flush its final result, rather than
    dropping the tail of what the candidate said."""
    upstream = _FakeUpstream([])
    app = _app_with_upstream(monkeypatch, upstream)

    with TestClient(app).websocket_connect("/api/web/avatar/deepgram?token=x"):
        pass

    assert upstream.closed is True


# ── authentication ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path", ["/api/web/avatar/deepgram", "/api/web/interview/deepgram"]
)
def test_an_unauthenticated_socket_is_refused_before_it_opens(path: str) -> None:
    """Authenticated BEFORE accept, so an unauthenticated caller never holds an open
    connection."""
    from starlette.websockets import WebSocketDisconnect

    client = TestClient(create_app())
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(path) as socket:
            socket.receive()


def test_an_unconfigured_deepgram_closes_cleanly(monkeypatch) -> None:
    from starlette.websockets import WebSocketDisconnect

    app = _app_with_upstream(monkeypatch, _FakeUpstream([]), key="")

    with pytest.raises(WebSocketDisconnect):
        with TestClient(app).websocket_connect("/api/web/avatar/deepgram?token=x") as socket:
            socket.receive()


# ── the voice token's locked setup ────────────────────────────────────────────


def _template(**overrides) -> dict:
    return {
        "id": "t1",
        "role": "Backend",
        "track": "voice",
        "questionSource": "fixed",
        "timing": {"numberOfQuestions": 4, "prepSeconds": 30, "answerSeconds": 120},
        "voice": {"voiceId": "Charon"},
        **overrides,
    }


def _session(**overrides) -> dict:
    return {
        "id": "s1",
        "track": "voice",
        "candidate": {"name": "Ada"},
        "questions": [{"id": "q0", "text": "Tell me about Kafka."}],
        **overrides,
    }


def test_the_setup_is_audio_out_with_transcription_on() -> None:
    """Input transcription IS the record the interview is scored from — without it there
    is nothing to evaluate.

    It IS a bare `{}` again, and the language constraint moved rather than vanished. The
    hints that used to live here were never read: AudioTranscriptionConfig "has no
    fields", so an unconstrained recogniser went on picking its own language — Devanagari
    for English interviews, and Spanish for a candidate saying "EC2". The constraint now
    sits in `speechConfig.languageCode`, asserted below, which is the field Google
    documents for it.
    """
    setup = voice_setup.build_live_setup(_session(), _template(), model="models/live")

    assert setup["generationConfig"]["responseModalities"] == ["AUDIO"]
    assert setup["inputAudioTranscription"] == {}
    assert setup["generationConfig"]["speechConfig"]["languageCode"]
    assert setup["outputAudioTranscription"] == {}


def test_the_configured_voice_is_locked_in() -> None:
    setup = voice_setup.build_live_setup(_session(), _template(), model="models/live")
    voice = setup["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]
    assert voice["voiceName"] == "Charon"


def test_a_missing_voice_falls_back_rather_than_failing_a_launch() -> None:
    setup = voice_setup.build_live_setup(_session(), _template(voice={}), model="models/live")
    voice = setup["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]
    assert voice["voiceName"] == voice_setup.DEFAULT_VOICE


def test_the_question_script_is_locked_into_the_instruction() -> None:
    """A tampered client cannot rewrite it — the token carries this copy."""
    setup = voice_setup.build_live_setup(_session(), _template(), model="models/live")
    instruction = setup["systemInstruction"]["parts"][0]["text"]

    assert "Tell me about Kafka" in instruction
    assert "Do NOT invent, add, skip, reorder, or rephrase" in instruction


def test_barge_in_is_enabled_with_the_tuned_padding() -> None:
    """20ms was found to clip word onsets and cost recognition accuracy."""
    setup = voice_setup.build_live_setup(_session(), _template(), model="models/live")
    detection = setup["realtimeInputConfig"]["automaticActivityDetection"]

    assert detection["prefixPaddingMs"] == 150


def test_a_thinking_pause_does_not_end_the_answer() -> None:
    """The candidate must be able to go quiet mid-answer without losing their turn.

    At 500ms an ordinary pause — drawing breath, recalling a specific — committed
    end-of-turn and the interview moved on, which candidates reported as the system
    skipping their question.
    """
    setup = voice_setup.build_live_setup(_session(), _template(), model="models/live")
    detection = setup["realtimeInputConfig"]["automaticActivityDetection"]

    assert detection["silenceDurationMs"] == voice_setup.THINKING_PAUSE_MS
    assert detection["silenceDurationMs"] >= 1200


def test_the_interviewer_does_not_deliberate_before_speaking() -> None:
    """Thinking time is dead air to a candidate, and there is nothing here to think about."""
    setup = voice_setup.build_live_setup(_session(), _template(), model="models/live")
    assert setup["generationConfig"]["thinkingConfig"]["thinkingBudget"] == 0


def test_session_resumption_is_enabled() -> None:
    """A candidate on a train will reconnect, and resumption does not burn another use."""
    setup = voice_setup.build_live_setup(_session(), _template(), model="models/live")
    assert setup["sessionResumption"] == {}


def test_the_session_window_covers_the_interview_plus_a_grace_period() -> None:
    """A token expiring at the interview's nominal length would cut a candidate off
    mid-answer — the interview's own cap should end it, not the credential."""
    minutes = voice_setup.session_minutes(_template(), buffer_minutes=10)
    # 4 questions x 150s = 10 minutes, plus the buffer.
    assert minutes == 20


def test_a_template_with_no_timing_still_gets_a_workable_window() -> None:
    minutes = voice_setup.session_minutes({"timing": {}}, buffer_minutes=5)
    assert minutes >= 5


def test_the_candidate_placeholder_name_is_not_spoken() -> None:
    """An interviewer greeting someone as "Candidate" out loud is worse than no name."""
    setup = voice_setup.build_live_setup(
        _session(candidate={"name": "Candidate"}), _template(), model="models/live"
    )
    assert "Candidate," not in setup["systemInstruction"]["parts"][0]["text"]

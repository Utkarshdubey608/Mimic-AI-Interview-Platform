// lib/core/services/gemini_live_service.dart
//
// Real-time VOICE INTERVIEW engine (Gemini Live native-audio), ON-DEVICE.
//
// Unlike the WebView-based chat/video tracks, this track owns the microphone
// directly and speaks to the Gemini Live API over a raw WebSocket, streaming
// the candidate's mic audio up and playing the interviewer's audio back. The
// Live model runs the interview naturally (greeting -> "are you ready?" ->
// questions in order -> wrap-up) from the strict, caller-authored system
// instruction; we surface both sides as live captions via Live's built-in
// input/output transcription.
//
// This mirrors the WEBSITE reference (server/services/voice.ts +
// src/features/interview/useVoiceSession.ts) but collapses the server relay
// into the device: the browser build streamed mic PCM to OUR backend, which
// held the Gemini key and relayed to Live. Here the app talks to Gemini Live
// directly.
//
// !!! SECURITY ---------------------------------------------------------------
// This still connects DIRECTLY to Gemini, but no longer with an API key. The
// backend mints a short-lived EPHEMERAL TOKEN (`/api/rt/gemini-token`) that is
// locked to one session's configuration, and the device connects with that. So:
//
//   * no vendor key ships with the app or appears in traffic;
//   * the token is single-use and expires with the interview;
//   * the model, voice and interviewer instruction are sealed INTO the token.
//
// That last point is why a relay is unnecessary. Because the token carries the
// whole BidiGenerateContentSetup, Google IGNORES whatever setup frame the client
// sends — so a tampered build cannot replace the interviewer's instructions with
// "tell me the answers". Verified against the live API; see
// backend/spikes/RESULTS.md.
//
// Consequence for this file: the setup frame below is a protocol formality, not
// configuration. Do not put an instruction, model or voice in it expecting them
// to take effect — they will be discarded. Session config belongs in
// backend/app/voice.py.
// ---------------------------------------------------------------------------
//
// !!! QA: cannot be runtime-tested in this environment. It needs (1) a real
// Gemini API key with Live access and (2) a physical device microphone +
// speaker. Everything below implements the real BidiGenerateContent protocol;
// it must be validated on-device against a live key.

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:record/record.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'package:talbotiq/core/net/live_token.dart';

/// High-level call phase surfaced to the UI. Mirrors the website's VoicePhase
/// (minus the browser-only "thinking" affordance, which we fold into greeting).
///
/// Terminal states: [ended] is a GENUINE graceful finish (user End, hard
/// max-duration cap, or idle watchdog) and is the ONLY state the host should
/// score. [interrupted] is an unexpected transport drop mid-interview
/// (connection lost) and must NOT be scored. [error] is an engine/transport
/// failure and must NOT be scored either.
enum GeminiLiveState {
  connecting,
  greeting,
  listening,
  speaking,
  ended,
  interrupted,
  error,
}

/// Who a caption line belongs to.
enum CaptionRole { interviewer, candidate }

/// Identifies interviewer audio leaking from a phone speaker into the mic.
/// Gemini labels all input transcription as the user, so without this guard a
/// repeated interviewer question becomes a candidate answer.
bool isLikelyInterviewerPlaybackEcho(String input, String interviewer) {
  List<String> tokens(String value) => value
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9\s]'), ' ')
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .toList();

  final heard = tokens(input);
  final spoken = tokens(interviewer);
  // Never suppress ordinary acknowledgements such as "yes" or "sounds good".
  if (heard.length < 4 || spoken.length < 4) return false;
  if (heard.length <= 6 &&
      heard.any(
        const {
          'yes',
          'yeah',
          'yep',
          'ready',
          'sure',
          'okay',
          'ok',
          'absolutely',
        }.contains,
      )) {
    return false;
  }
  final heardText = heard.join(' ');
  final spokenText = spoken.join(' ');
  if (spokenText.contains(heardText)) return true;

  final overlap = heard.toSet().intersection(spoken.toSet()).length;
  // Live ASR often gives us only a fragment of the echoed question.
  return overlap / heard.length >= 0.85;
}

/// Ping-pong playback state for the "idle" (non-active) player — see
/// [GeminiLiveService._advance].
enum _IdleClipState { none, preparing, ready }

/// Events emitted on [GeminiLiveService.events]. Sealed so the UI can switch
/// exhaustively.
sealed class GeminiLiveEvent {
  const GeminiLiveEvent();
}

/// The call phase changed.
class GeminiLiveStateChanged extends GeminiLiveEvent {
  final GeminiLiveState state;
  const GeminiLiveStateChanged(this.state);
}

/// A live caption line (streaming partial -> final flush) for one speaker.
/// While [isFinal] is false this replaces the speaker's most recent non-final
/// line in place; when true it commits that line.
class GeminiLiveCaption extends GeminiLiveEvent {
  final CaptionRole role;
  final String text;
  final bool isFinal;
  const GeminiLiveCaption(this.role, this.text, this.isFinal);
}

/// The candidate barged in over the interviewer (VAD interrupt). The UI should
/// treat any in-flight interviewer caption as discarded; playback is stopped
/// internally.
class GeminiLiveInterrupted extends GeminiLiveEvent {
  const GeminiLiveInterrupted();
}

/// A non-fatal-or-fatal error message for display. Usually followed by a
/// [GeminiLiveStateChanged] to [GeminiLiveState.error]/[ended].
class GeminiLiveErrorEvent extends GeminiLiveEvent {
  final String message;
  const GeminiLiveErrorEvent(this.message);
}

/// Direct-to-Gemini Live voice interview engine. One instance per interview.
///
/// Lifecycle: [connect] -> (listen to [events]) -> [mute]/[end] -> [dispose].
/// Owns and tears down ALL resources: the WebSocket, the mic stream + recorder,
/// the audio player, and its internal subscriptions.
class GeminiLiveService {
  /// [maxDuration] is a HARD wall-clock cap: when it elapses the interview is
  /// ended like a normal graceful finish (mirrors voice.ts's maxDurationMs,
  /// default ~18 min). [idleTimeout] is the listening-phase idle watchdog: if
  /// the candidate produces no speech for this long while it is their turn, the
  /// interview is finalized gracefully (mirrors voice.ts's idle watchdog).
  GeminiLiveService({
    this.maxDuration = const Duration(minutes: 18),
    this.idleTimeout = const Duration(seconds: 90),
  });

  /// Hard wall-clock cap on the whole interview (see [GeminiLiveService]).
  final Duration maxDuration;

  /// Listening-phase idle watchdog window (see [GeminiLiveService]).
  final Duration idleTimeout;

  // ---- protocol constants -------------------------------------------------

  /// Native-audio Live model. Callers may override via [connect].
  static const String defaultModel =
      'models/gemini-2.5-flash-native-audio-preview-09-2025';

  /// A reasonable default prebuilt voice. Callers may override via [connect].
  static const String defaultVoiceName = 'Aoede';

  // Mic capture format: PCM16 mono 16 kHz (what Gemini Live expects on input).
  static const int _inputSampleRate = 16000;
  // Interviewer audio comes back as PCM16 mono 24 kHz.
  static const int _outputSampleRate = 24000;

  // ---- resources (all disposed) -------------------------------------------

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _socketSub;

  final AudioRecorder _recorder = AudioRecorder();
  StreamSubscription<Uint8List>? _micSub;

  // Two AudioPlayer instances used in a ping-pong pattern for gapless-ish
  // playback: while one plays the current interviewer-audio segment, the
  // other's source for the NEXT segment is prepared in the background (see
  // _advance/_onPlayerComplete below). This overlaps the setSource latency —
  // on iOS/macOS/Linux, audioplayers' setSourceBytes writes the bytes to a
  // temp file and awaits native prepare before the source is playable — with
  // the PREVIOUS segment's playback instead of paying it serially between
  // segments, which is what caused the audible gap/stutter between every
  // ~0.5s chunk of interviewer speech.
  final List<AudioPlayer> _players = [AudioPlayer(), AudioPlayer()];
  final List<StreamSubscription<void>?> _playerCompleteSubs = [null, null];

  final StreamController<GeminiLiveEvent> _events =
      StreamController<GeminiLiveEvent>.broadcast();

  // Hard max-duration cap (armed on connect) and listening-phase idle watchdog
  // (armed while it is the candidate's turn). BOTH are cancelled in dispose /
  // end / any terminal path so no timer outlives the session.
  Timer? _maxDurationTimer;
  Timer? _idleTimer;

  /// Broadcast stream of call events. Subscribe BEFORE calling [connect] to
  /// avoid missing the initial [GeminiLiveState.connecting] event.
  Stream<GeminiLiveEvent> get events => _events.stream;

  // ---- state --------------------------------------------------------------

  bool _muted = false;
  bool _setupComplete = false; // Gemini acked setup; safe to stream audio
  bool _greeted = false; // first interviewer utterance has played (greeting)
  bool _disposed = false;
  bool _endedByUser = false; // graceful End tapped; suppress close-as-error
  bool _finished = false; // a terminal event has been emitted

  bool _audioSessionReady = false;

  // Streaming playback: queued WAV segments of the current interviewer turn.
  // ~0.5s of PCM24k mono is enough of a lead-in to play smoothly while the rest
  // is still generating.
  static const int _minFlushBytes = 24000;
  final List<Uint8List> _clipQueue = [];
  bool _playing = false;

  // Ping-pong playback state (see _advance/_onPlayerComplete): which of
  // _players is currently active, and whether the OTHER ("idle") player
  // already has the next clip prepared (or is in the middle of preparing it).
  int _activePlayer = 0;
  _IdleClipState _idleState = _IdleClipState.none;
  // Bumped on every _clearAudioQueue (barge-in/teardown) so a setSourceBytes
  // future that resolves AFTER a clear is discarded instead of resurrecting a
  // clip that should have been dropped.
  int _playbackGeneration = 0;

  /// True once the model has signalled turnComplete, so the queue draining is
  /// the end of the reply (and not just a lull between chunks).
  bool _turnAudioComplete = false;

  // Debug-only mic telemetry (see sendAudioChunk).
  int _micChunks = 0;
  int _micBytes = 0;
  int _micPeak = 0;

  /// True only when the terminal [GeminiLiveState.ended] was reached because
  /// [maxDuration] elapsed (rather than the candidate tapping End, or the idle
  /// watchdog) — lets the host UI explain why the call submitted itself.
  bool endedByTimeout = false;

  // Wall-clock moment [connect] armed the max-duration timer, so the host UI
  // can render a countdown via [remaining] without needing a per-tick event.
  DateTime? _connectedAt;

  /// Time left before [maxDuration] force-ends the call, or null before
  /// [connect] armed the timer. Derived from elapsed wall-clock time, so it is
  /// correct however often the caller polls it.
  Duration? get remaining {
    final startedAt = _connectedAt;
    if (startedAt == null) return null;
    final left = maxDuration - DateTime.now().difference(startedAt);
    return left.isNegative ? Duration.zero : left;
  }

  GeminiLiveState _state = GeminiLiveState.connecting;
  GeminiLiveState get state => _state;

  bool get isMuted => _muted;

  // Per-turn transcription buffers (accumulate across streamed fragments, flush
  // as `final` on turnComplete) — mirrors voice.ts pendingInterviewer/Candidate.
  final StringBuffer _pendingInterviewer = StringBuffer();
  final StringBuffer _pendingCandidate = StringBuffer();

  // Echo can reach the recorder shortly after the output queue has drained.
  String _lastInterviewerText = '';
  DateTime? _lastInterviewerAudioAt;
  static const _echoGraceWindow = Duration(milliseconds: 1200);
  DateTime? _playbackEndedAt;
  static const _micEchoGateTail = Duration(milliseconds: 500);

  // Per-turn PCM24k output accumulator. Chunks are cut into ~0.5s WAV segments
  // as they arrive (see _enqueueAudio) rather than buffered for the whole
  // turn, so the interviewer starts speaking well before the full reply has
  // finished generating. Segments are played back via a two-player ping-pong
  // (see _advance) so the next segment's decode/prepare overlaps the current
  // segment's playback instead of creating an audible gap between segments.
  final BytesBuilder _outBuffer = BytesBuilder(copy: false);

  // =========================================================================
  // Public API
  // =========================================================================

  /// Opens the Live session: connects the WebSocket, sends the setup message,
  /// starts the mic stream, and kicks off the interviewer's greeting turn.
  ///
  /// [grant] is a token minted by the backend for THIS interview. It carries the
  /// whole session configuration — model, voice, and the interviewer's
  /// instruction — so there is nothing to pass here beyond the grant itself. See
  /// the security note at the top of this file.
  ///
  /// Mint the grant immediately before calling: its connect window is short, and
  /// a stale grant is refused by Google.
  ///
  /// Throws only for programmer errors (e.g. a stale grant); transport/engine
  /// failures are surfaced on [events] as [GeminiLiveErrorEvent] + error state.
  Future<void> connect({
    required LiveTokenGrant grant,
    List<String> languageHints = const ['en-IN', 'en-US', 'en-GB', 'en-AU'],
    String kickoffPrompt =
        'Begin the interview now: greet me and ask if I am ready to begin.',
  }) async {
    if (grant.isStale) {
      throw ArgumentError(
        'This voice session token has expired before connecting. '
        'Mint a fresh one immediately before calling connect().',
      );
    }
    if (_channel != null) return; // already connected/connecting

    _emitState(GeminiLiveState.connecting);

    // The token travels in an `access_token` query parameter — the form Google
    // documents for ephemeral tokens, and the only one available on Flutter web
    // (browsers cannot set headers on a WebSocket). The endpoint comes from the
    // grant rather than a constant here: token-authenticated Live lives on a
    // different API version from the key-authenticated one, and that mapping
    // should be changeable without shipping a new build.
    final uri = grant.socketUri;

    try {
      final channel = WebSocketChannel.connect(uri);
      _channel = channel;
      // `ready` completes on a successful upgrade; it throws on failure so we
      // don't start streaming into a dead socket.
      await channel.ready;
      if (_disposed) {
        await _teardownSocket();
        return;
      }

      _socketSub = channel.stream.listen(
        _onSocketData,
        onError: _onSocketError,
        onDone: _onSocketDone,
        cancelOnError: false,
      );

      // Hard wall-clock cap: once connected, guarantee the interview ends
      // gracefully after [maxDuration] no matter what the model does.
      _armMaxDurationTimer();

      // languageHints is accepted for API stability / future use but is not
      // injected into the raw setup — see the QA note in _sendSetup.
      _sendSetup(model: grant.model);
      // Remember the kickoff so we can send it exactly once, after setupComplete.
      _kickoffPrompt = kickoffPrompt;
    } catch (e) {
      _fail('Could not connect to the voice service: $e');
    }
  }

  String _kickoffPrompt = '';

  /// Forwards one PCM16 mono 16 kHz mic chunk to Gemini as realtimeInput.
  /// No-op while muted, before setup completes, or after teardown. Normally
  /// driven internally by the mic stream, but exposed for testing / custom
  /// capture pipelines.
  void sendAudioChunk(Uint8List pcm16) {
    if (_disposed || _muted || !_setupComplete) return;
    // Do not forward the microphone while the interviewer is audible. On many
    // phones the generic recorder/player pair cannot share hardware AEC, so
    // forwarding here sends the interviewer's own PCM back to Gemini as the
    // candidate. A short tail lets the room acoustics settle before listening.
    final playbackJustEnded =
        _playbackEndedAt != null &&
        DateTime.now().difference(_playbackEndedAt!) < _micEchoGateTail;
    if (_hasPendingAudio || playbackJustEnded) return;
    final channel = _channel;
    if (channel == null) return;
    final b64 = base64Encode(pcm16);

    // `mediaChunks` — NOT `audio`. BidiGenerateContentRealtimeInput has carried
    // `media_chunks` since the API shipped; `audio` is a newer alias that not
    // every model/revision accepts. Protobuf silently DISCARDS unrecognised
    // fields, so sending the wrong one produces no error at all: the
    // interviewer still speaks (its kickoff is plain text) while the
    // candidate's audio is dropped on the floor — i.e. "it can't hear me".
    _sendJson({
      'realtimeInput': {
        'mediaChunks': [
          {'mimeType': 'audio/pcm;rate=$_inputSampleRate', 'data': b64},
        ],
      },
    });

    if (kDebugMode) {
      _micChunks++;
      _micBytes += pcm16.lengthInBytes;
      // Peak amplitude over this chunk (PCM16 little-endian), so the log
      // distinguishes "mic is delivering silence" from "mic is fine but Gemini
      // isn't transcribing" — without it, both look identical.
      var peak = 0;
      for (var i = 0; i + 1 < pcm16.lengthInBytes; i += 2) {
        var v = pcm16[i] | (pcm16[i + 1] << 8);
        if (v >= 0x8000) v -= 0x10000;
        final a = v.abs();
        if (a > peak) peak = a;
      }
      if (peak > _micPeak) _micPeak = peak;
      // Roughly once a second at 16 kHz mono.
      if (_micChunks % 30 == 0) {
        debugPrint(
          'debug[live]: mic chunks=$_micChunks bytes=$_micBytes '
          'peak=$_micPeak/32767 muted=$_muted',
        );
        _micPeak = 0;
      }
    }
  }

  /// Mutes/unmutes the microphone. While muted, captured chunks are dropped so
  /// the interviewer hears silence (the mic stream itself stays open so unmute
  /// is instant).
  void mute(bool muted) {
    _muted = muted;
  }

  /// Candidate-initiated graceful end: signal end-of-audio, then close. Emits
  /// [GeminiLiveState.ended]. Safe to call multiple times.
  Future<void> end() => _finishGracefully();

  /// Shared graceful-finish path for EVERY genuine completion: the candidate's
  /// End button, the hard max-duration cap, and the idle watchdog. Flushes the
  /// mic/playback, emits the terminal [GeminiLiveState.ended] (which the host
  /// scores), and closes the socket. Setting [_endedByUser] here also ensures
  /// the subsequent socket onDone is treated as a graceful close, never an
  /// interruption. Idempotent.
  Future<void> _finishGracefully() async {
    if (_endedByUser || _finished) return;
    _endedByUser = true;
    _cancelTimers();
    // Tell Live the audio input is finished (best effort).
    if (_setupComplete) {
      _sendJson({
        'realtimeInput': {'audioStreamEnd': true},
      });
    }
    await _stopMic();
    await _stopPlayback();
    _emitState(GeminiLiveState.ended, terminal: true);
    await _teardownSocket();
  }

  /// Releases every resource. Idempotent. Does NOT emit `ended` (that is the
  /// job of [end] or a server-side finish) — this is the unmount teardown.
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _cancelTimers();
    await _stopMic();
    try {
      await _recorder.dispose();
    } catch (_) {}
    await _stopPlayback();
    for (final sub in _playerCompleteSubs) {
      await sub?.cancel();
    }
    _playerCompleteSubs[0] = null;
    _playerCompleteSubs[1] = null;
    for (final p in _players) {
      try {
        await p.dispose();
      } catch (_) {}
    }
    await _teardownSocket();
    if (!_events.isClosed) await _events.close();
  }

  // =========================================================================
  // WebSocket protocol
  // =========================================================================

  /// The setup message MUST be the first frame after the socket opens — the
  /// server will not send `setupComplete` (and therefore will not accept audio)
  /// until it arrives.
  ///
  /// Its CONTENTS, however, are ignored. The ephemeral token carries the whole
  /// BidiGenerateContentSetup — model, AUDIO modality + voice, the interviewer
  /// instruction, input/output transcription, and server-side VAD — and Google
  /// takes the effective setup entirely from the token when it was minted
  /// without a fieldMask. That is exactly what stops a tampered client from
  /// rewriting the interview, so this frame deliberately carries nothing but the
  /// model it is already locked to.
  ///
  /// To change any of that configuration, edit `backend/app/voice.py`. Adding
  /// fields here has no effect and would falsely imply the client is in control.
  void _sendSetup({required String model}) {
    _sendJson({
      'setup': {'model': model.startsWith('models/') ? model : 'models/$model'},
    });
  }

  void _onSocketData(dynamic data) {
    if (_disposed) return;
    // Live frames arrive as UTF-8 JSON, delivered as either a String or binary
    // (List<int>) frame depending on the platform WS implementation.
    final Map<String, dynamic>? msg = _decodeFrame(data);
    if (msg == null) return;

    if (msg.containsKey('setupComplete')) {
      _onSetupComplete();
      return;
    }

    final sc = msg['serverContent'];
    if (sc is Map) {
      _onServerContent(sc.cast<String, dynamic>());
    }

    // `goAway` warns the connection is about to be closed by the server; the
    // subsequent onDone handles the actual teardown. Nothing to do here beyond
    // logging in debug.
    if (kDebugMode && msg.containsKey('goAway')) {
      debugPrint('debug[live]: goAway received — server closing soon');
    }
  }

  Map<String, dynamic>? _decodeFrame(dynamic data) {
    try {
      final String text;
      if (data is String) {
        text = data;
      } else if (data is List<int>) {
        text = utf8.decode(data);
      } else if (data is Uint8List) {
        text = utf8.decode(data);
      } else {
        return null;
      }
      final decoded = jsonDecode(text);
      return decoded is Map<String, dynamic> ? decoded : null;
    } catch (e) {
      if (kDebugMode) debugPrint('debug[live]: frame decode failed: $e');
      return null;
    }
  }

  Future<void> _onSetupComplete() async {
    if (_setupComplete) return;
    _setupComplete = true;
    if (kDebugMode) debugPrint('debug[live]: setupComplete — audio accepted');
    // Set the session BEFORE the mic starts and before any playback, so the
    // first interviewer utterance cannot clobber the input path.
    await _configureAudioSession();
    _emitState(GeminiLiveState.greeting);
    // Native audio only speaks when prompted — send the opening turn now.
    if (_kickoffPrompt.isNotEmpty) {
      _sendClientText(_kickoffPrompt);
    }
    // Start capturing the mic only once Gemini is ready to receive audio.
    await _startMic();
  }

  void _onServerContent(Map<String, dynamic> sc) {
    // 1) Interviewer audio out (PCM24k) — accumulate for this turn.
    final modelTurn = sc['modelTurn'];
    if (modelTurn is Map) {
      final parts = modelTurn['parts'];
      if (parts is List) {
        for (final part in parts) {
          if (part is Map) {
            final inline = part['inlineData'];
            if (inline is Map && inline['data'] is String) {
              _outBuffer.add(base64Decode(inline['data'] as String));
              // Start speaking as soon as there's a lead-in buffer rather than
              // waiting for the whole turn.
              _turnAudioComplete = false;
              _enqueueAudio(force: false);
            }
          }
        }
      }
    }

    // 2) Streaming transcripts -> partial captions.
    final outT = sc['outputTranscription'];
    if (outT is Map && outT['text'] is String) {
      _pendingInterviewer.write(outT['text']);
      _lastInterviewerText = _pendingInterviewer.toString();
      _lastInterviewerAudioAt = DateTime.now();
      _emit(
        GeminiLiveCaption(
          CaptionRole.interviewer,
          _pendingInterviewer.toString(),
          false,
        ),
      );
    }
    var inputWasPlaybackEcho = false;
    final inT = sc['inputTranscription'];
    if (inT is Map && inT['text'] is String) {
      final fragment = inT['text'] as String;
      final outputWasRecentlyAudible =
          _hasPendingAudio ||
          (_lastInterviewerAudioAt != null &&
              DateTime.now().difference(_lastInterviewerAudioAt!) <=
                  _echoGraceWindow);
      inputWasPlaybackEcho =
          outputWasRecentlyAudible &&
          isLikelyInterviewerPlaybackEcho(fragment, _lastInterviewerText);
      if (inputWasPlaybackEcho) {
        if (kDebugMode) {
          debugPrint('debug[live]: ignored interviewer playback in input ASR');
        }
      } else {
        _pendingCandidate.write(fragment);
        // The candidate is speaking -> it's their turn.
        _emitState(GeminiLiveState.listening);
        // Candidate produced speech -> the call is NOT idle. Reset the watchdog
        // so a long/thoughtful answer is never cut off mid-sentence. (We key the
        // watchdog off VAD-detected speech captions, not raw mic chunks, since the
        // mic streams continuously and would otherwise never let it expire.)
        _armIdleWatchdog();
        _emit(
          GeminiLiveCaption(
            CaptionRole.candidate,
            _pendingCandidate.toString(),
            false,
          ),
        );
      }
    }

    // 3) Barge-in: candidate interrupted the interviewer. Drop buffered/playing
    //    interviewer audio and its partial caption.
    // Gemini may pair `interrupted` with the echoed input frame. The source of
    // that barge-in is our own playback, so do not cut the interviewer off.
    if (sc['interrupted'] == true && !inputWasPlaybackEcho) {
      _pendingInterviewer.clear();
      _outBuffer.clear();
      _turnAudioComplete = true;
      // Drop queued segments too — with streaming playback the rest of the
      // interrupted reply is still sitting in the queue and would otherwise
      // keep talking over the candidate.
      unawaited(_clearAudioQueue());
      _emit(const GeminiLiveInterrupted());
      _emitState(GeminiLiveState.listening);
    }

    // 4) Turn boundary: finalize captions and play the interviewer's audio.
    if (sc['turnComplete'] == true) {
      final cand = _pendingCandidate.toString().trim();
      if (cand.isNotEmpty) {
        _pendingCandidate.clear();
        _emit(GeminiLiveCaption(CaptionRole.candidate, cand, true));
      }
      final interviewer = _pendingInterviewer.toString().trim();
      if (interviewer.isNotEmpty) {
        _pendingInterviewer.clear();
        _emit(GeminiLiveCaption(CaptionRole.interviewer, interviewer, true));
      }
      // Queue whatever is left of this turn; the queue draining now marks the
      // handover to the candidate.
      _turnAudioComplete = true;
      _enqueueAudio(force: true);
      // Nothing was generated (e.g. a text-only turn) — hand over immediately
      // instead of waiting for a completion event that will never fire.
      if (!_hasPendingAudio && !_finished) {
        _emitState(GeminiLiveState.listening);
      }
    }
  }

  void _sendClientText(String text) {
    _sendJson({
      'clientContent': {
        'turns': [
          {
            'role': 'user',
            'parts': [
              {'text': text},
            ],
          },
        ],
        'turnComplete': true,
      },
    });
  }

  void _sendJson(Map<String, dynamic> payload) {
    final channel = _channel;
    if (channel == null || _disposed) return;
    try {
      channel.sink.add(jsonEncode(payload));
    } catch (e) {
      if (kDebugMode) debugPrint('debug[live]: send failed: $e');
    }
  }

  void _onSocketError(Object error, StackTrace _) {
    if (_disposed || _finished) return;
    _fail('Voice connection error: $error');
  }

  void _onSocketDone() {
    // A graceful terminal (user End, max-duration cap, or idle watchdog) has
    // already set `_finished`/`_endedByUser` and emitted `ended`; ignore the
    // follow-on close. Any OTHER close is an unexpected mid-interview drop.
    if (_disposed || _finished) return;
    if (_endedByUser) return;
    // Not user-initiated and not after a genuine finish -> the connection was
    // lost mid-interview. Emit a DISTINCT terminal state so the UI can show an
    // "interrupted — connection lost" screen and the host does NOT score a
    // partial/aborted interview (only [GeminiLiveState.ended] is scored).
    //
    // TODO(resilience): port voice.ts's reconnect grace window (keep the
    //   interview alive across a transient drop and resume) — out of scope for
    //   this on-device MVP, which surfaces any drop as interrupted.
    _interrupt('Interview interrupted — connection lost.');
  }

  // =========================================================================
  // Microphone (PCM16 @ 16 kHz) -> realtimeInput
  // =========================================================================

  Future<void> _startMic() async {
    if (_disposed || _micSub != null) return;
    try {
      final hasPerm = await _recorder.hasPermission();
      if (!hasPerm) {
        _fail('Microphone permission is required for the voice interview.');
        return;
      }
      // Raw PCM16 mono 16 kHz — exactly what Gemini Live expects on input.
      final stream = await _recorder.startStream(
        const RecordConfig(
          encoder: AudioEncoder.pcm16bits,
          sampleRate: _inputSampleRate,
          numChannels: 1,
          // Echo cancellation helps when playing the interviewer through a
          // loudspeaker so it isn't re-captured as candidate speech.
          echoCancel: true,
          noiseSuppress: true,
        ),
      );
      if (_disposed) {
        await _recorder.stop();
        return;
      }
      if (kDebugMode) {
        debugPrint(
          'debug[live]: mic stream started '
          '(pcm16 ${_inputSampleRate}Hz mono)',
        );
      }
      _micSub = stream.listen(
        sendAudioChunk,
        onError: (Object e, StackTrace _) {
          // Continuing after a capture failure creates a live-looking session
          // which can only submit silence after the idle timeout.
          _fail('Microphone capture stopped: $e');
        },
        cancelOnError: false,
      );
    } catch (e) {
      _fail('Could not start the microphone: $e');
    }
  }

  Future<void> _stopMic() async {
    await _micSub?.cancel();
    _micSub = null;
    try {
      if (await _recorder.isRecording()) await _recorder.stop();
    } catch (_) {}
  }

  // =========================================================================
  // Interviewer audio playback (PCM24k -> WAV -> BytesSource)
  // =========================================================================

  /// Configures the player for SIMULTANEOUS record + playback, once.
  ///
  /// This is a two-way call, but audioplayers defaults to a music-playback
  /// session: on Android `audioFocus: AndroidAudioFocus.gain` requests
  /// EXCLUSIVE focus, and on iOS the category defaults to `playback`, which
  /// deactivates recording outright. Either one silences the microphone the
  /// moment the interviewer's first utterance plays — which is exactly the
  /// failure mode where the greeting is audible and nothing the candidate says
  /// is ever heard afterwards.
  ///
  /// So: voice-communication usage, speaker output, and NO audio-focus grab, so
  /// the recorder keeps the input path.
  Future<void> _configureAudioSession() async {
    if (_audioSessionReady) return;
    _audioSessionReady = true;
    try {
      final ctx = AudioContext(
        android: const AudioContextAndroid(
          isSpeakerphoneOn: true,
          stayAwake: true,
          contentType: AndroidContentType.speech,
          usageType: AndroidUsageType.voiceCommunication,
          // Critical: do NOT take exclusive focus away from the recorder.
          audioFocus: AndroidAudioFocus.none,
        ),
        iOS: AudioContextIOS(
          // playAndRecord is required; the default `playback` category tears
          // down the mic.
          category: AVAudioSessionCategory.playAndRecord,
          options: const {
            AVAudioSessionOptions.defaultToSpeaker,
            AVAudioSessionOptions.allowBluetooth,
          },
        ),
      );
      // Both ping-pong players share the session (see _players above).
      await Future.wait(_players.map((p) => p.setAudioContext(ctx)));
      if (kDebugMode) {
        debugPrint('debug[live]: audio session set for record+playback');
      }
    } catch (e) {
      // Never fatal: worst case we fall back to the default session and the
      // caller still hears the interviewer.
      if (kDebugMode) debugPrint('debug[live]: audio session setup failed: $e');
    }
  }

  /// Cuts whatever audio has accumulated into a clip and queues it for
  /// playback.
  ///
  /// Called BOTH as chunks stream in (once there is a lead-in buffer) and at
  /// turnComplete for the remainder. Previously the whole turn was buffered and
  /// only played on turnComplete, so the candidate heard nothing until the model
  /// had finished generating the entire reply — dead air after every answer,
  /// which is what made the conversation feel one-way. Now the interviewer
  /// starts talking about half a second in.
  void _enqueueAudio({required bool force}) {
    if (_disposed) return;
    final len = _outBuffer.length;
    if (len == 0) return;
    if (!force && len < _minFlushBytes) return;

    final pcm = _outBuffer.takeBytes(); // clears the builder
    _clipQueue.add(_pcmToWav(pcm, sampleRate: _outputSampleRate));

    // The first interviewer utterance is the greeting; later ones are normal
    // speaking turns.
    _emitState(_greeted ? GeminiLiveState.speaking : GeminiLiveState.greeting);
    _greeted = true;

    _ensurePlayerListeners();
    _advance();
  }

  void _ensurePlayerListeners() {
    for (var i = 0; i < _players.length; i++) {
      _playerCompleteSubs[i] ??= _players[i].onPlayerComplete.listen(
        (_) => _onPlayerComplete(i),
      );
    }
  }

  /// True while any interviewer-audio segment is still playing, being
  /// prepared on the idle player, or waiting in the raw queue. Using
  /// `_playing`/`_clipQueue` alone would miss a segment that is mid-flight on
  /// the idle player (see [_advance]) and could hand the turn back to the
  /// candidate one segment early.
  bool get _hasPendingAudio =>
      _playing || _idleState != _IdleClipState.none || _clipQueue.isNotEmpty;

  /// Drives playback forward. Two responsibilities, kept in one place so every
  /// caller (a new clip arriving, a player finishing, an idle-player prepare
  /// finishing) sees the same state machine:
  ///  1. If nothing is playing, start the next queued clip (or promote an
  ///     already-prepared idle clip — see the race note below).
  ///  2. If something IS playing, prepare the next queued clip on the OTHER
  ///     player ahead of time, so the handover on completion is a fast
  ///     resume() instead of a fresh play() (setSource + resume).
  void _advance() {
    if (_disposed) return;

    if (!_playing) {
      if (_idleState == _IdleClipState.ready) {
        // Race: the active player finished WHILE a clip was still being
        // prepared on the idle player; _onPlayerComplete saw "preparing" and
        // waited (see there) instead of handing over early, so promote it now
        // that it's actually ready.
        _idleState = _IdleClipState.none;
        _activePlayer = 1 - _activePlayer;
        _playing = true;
        unawaited(
          _players[_activePlayer].resume().catchError((e) {
            if (kDebugMode) debugPrint('debug[live]: resume failed: $e');
            _playing = false;
            _advance();
          }),
        );
        _advance(); // opportunistically start preparing the new idle slot
        return;
      }
      if (_idleState == _IdleClipState.none && _clipQueue.isNotEmpty) {
        // Cold start (first clip of a turn, or the queue was fully drained
        // and refilled) — unavoidable setSource+resume latency, same as the
        // very first segment always had.
        _playing = true;
        final wav = _clipQueue.removeAt(0);
        unawaited(_startActive(wav));
      }
      // Else: idleState == preparing (wait for its callback) or nothing
      // queued at all — nothing to do.
      return;
    }

    // Already playing: opportunistically prepare the NEXT clip on the idle
    // player, once.
    if (_idleState != _IdleClipState.none || _clipQueue.isEmpty) return;
    _idleState = _IdleClipState.preparing;
    final wav = _clipQueue.removeAt(0);
    final gen = _playbackGeneration;
    final idle = _players[1 - _activePlayer];
    idle
        .setSourceBytes(wav, mimeType: 'audio/wav')
        .then((_) {
          if (_disposed || gen != _playbackGeneration) return;
          _idleState = _IdleClipState.ready;
          // The active player may have already finished while this was
          // preparing — advance() now promotes it if so.
          _advance();
        })
        .catchError((e) {
          if (kDebugMode) debugPrint('debug[live]: idle prepare failed: $e');
          if (_disposed || gen != _playbackGeneration) return;
          _idleState = _IdleClipState.none;
          // Don't drop the audio — put it back and let the (slower) cold-start
          // path pick it up once the active player finishes.
          _clipQueue.insert(0, wav);
          _advance();
        });
  }

  Future<void> _startActive(Uint8List wav) async {
    final player = _players[_activePlayer];
    try {
      await player.play(BytesSource(wav, mimeType: 'audio/wav'));
    } catch (e) {
      _playing = false;
      if (kDebugMode) debugPrint('debug[live]: playback failed: $e');
      // A failed chunk must not strand the rest of the interview audio.
      _advance();
    }
  }

  void _onPlayerComplete(int idx) {
    if (_disposed || idx != _activePlayer) return;
    _playing = false;
    if (_idleState == _IdleClipState.preparing) {
      // The next clip is still being decoded/prepared — do NOT hand the turn
      // back to the candidate here; the prepare's own _advance() call will
      // promote it to active the instant it's ready (see _hasPendingAudio).
      return;
    }
    if (_idleState == _IdleClipState.ready || _clipQueue.isNotEmpty) {
      _advance();
      return;
    }
    // Nothing queued, nothing in flight, AND the model finished the turn ->
    // candidate's turn.
    if (!_finished && _turnAudioComplete) {
      _playbackEndedAt = DateTime.now();
      _emitState(GeminiLiveState.listening);
    }
  }

  /// Drops queued + in-flight interviewer audio (barge-in, or teardown).
  Future<void> _clearAudioQueue() async {
    _playbackGeneration++; // invalidate any in-flight idle-player prepare
    _clipQueue.clear();
    _playing = false;
    _idleState = _IdleClipState.none;
    await _stopPlayback();
  }

  Future<void> _stopPlayback() async {
    for (final p in _players) {
      try {
        await p.stop();
      } catch (_) {}
    }
  }

  /// Wraps raw little-endian PCM16 mono samples in a 44-byte WAV header so
  /// audioplayers' [BytesSource] can decode it.
  Uint8List _pcmToWav(Uint8List pcm, {required int sampleRate}) {
    const int channels = 1;
    const int bitsPerSample = 16;
    final int byteRate = sampleRate * channels * (bitsPerSample ~/ 8);
    final int blockAlign = channels * (bitsPerSample ~/ 8);
    final int dataLen = pcm.length;
    final int fileLen = 44 + dataLen;

    final header = BytesBuilder();
    void writeString(String s) => header.add(ascii.encode(s));
    void writeUint32(int v) {
      final b = ByteData(4)..setUint32(0, v, Endian.little);
      header.add(b.buffer.asUint8List());
    }

    void writeUint16(int v) {
      final b = ByteData(2)..setUint16(0, v, Endian.little);
      header.add(b.buffer.asUint8List());
    }

    writeString('RIFF');
    writeUint32(fileLen - 8); // chunk size
    writeString('WAVE');
    writeString('fmt ');
    writeUint32(16); // subchunk1 size (PCM)
    writeUint16(1); // audio format = PCM
    writeUint16(channels);
    writeUint32(sampleRate);
    writeUint32(byteRate);
    writeUint16(blockAlign);
    writeUint16(bitsPerSample);
    writeString('data');
    writeUint32(dataLen);

    final out = BytesBuilder(copy: false);
    out.add(header.takeBytes());
    out.add(pcm);
    return out.takeBytes();
  }

  // =========================================================================
  // Event emission helpers
  // =========================================================================

  void _emitState(GeminiLiveState state, {bool terminal = false}) {
    if (_finished) return;
    if (state == _state && !terminal) return;
    _state = state;
    if (terminal) _finished = true;
    // The idle watchdog only governs the candidate's turn: arm it when we enter
    // listening, cancel it in every other (incl. terminal) phase. It is also
    // re-armed on each candidate speech caption (see _onServerContent).
    if (!terminal && state == GeminiLiveState.listening) {
      _armIdleWatchdog();
    } else {
      _cancelIdleWatchdog();
    }
    _emit(GeminiLiveStateChanged(state));
  }

  // =========================================================================
  // Watchdog timers: hard max-duration cap + listening-phase idle watchdog
  // =========================================================================

  void _armMaxDurationTimer() {
    _connectedAt = DateTime.now();
    _maxDurationTimer?.cancel();
    _maxDurationTimer = Timer(maxDuration, () {
      if (_disposed || _finished) return;
      // Hard cap reached -> end like any normal graceful finish.
      endedByTimeout = true;
      unawaited(_finishGracefully());
    });
  }

  void _armIdleWatchdog() {
    if (_disposed || _finished) return;
    _idleTimer?.cancel();
    _idleTimer = Timer(idleTimeout, () {
      if (_disposed || _finished) return;
      // The candidate went silent for the whole window during their turn ->
      // finalize gracefully (a completed-but-quiet interview, not an error).
      unawaited(_finishGracefully());
    });
  }

  void _cancelIdleWatchdog() {
    _idleTimer?.cancel();
    _idleTimer = null;
  }

  /// Cancels ALL watchdog timers. Called from dispose and every terminal path
  /// so no timer outlives the session (and the mic is never left open).
  void _cancelTimers() {
    _maxDurationTimer?.cancel();
    _maxDurationTimer = null;
    _cancelIdleWatchdog();
  }

  /// Terminal signal for an unexpected mid-interview drop (connection lost).
  /// Distinct from [_finishGracefully]: emits [GeminiLiveState.interrupted] so
  /// the host does NOT score the aborted interview. Best-effort local cleanup.
  void _interrupt(String message) {
    if (_finished) return;
    _cancelTimers();
    _emit(GeminiLiveErrorEvent(message));
    _emitState(GeminiLiveState.interrupted, terminal: true);
    unawaited(_stopMic());
    unawaited(_stopPlayback());
    unawaited(_teardownSocket());
  }

  void _emit(GeminiLiveEvent event) {
    if (!_events.isClosed) _events.add(event);
  }

  void _fail(String message) {
    if (_finished) return;
    _cancelTimers();
    _emit(GeminiLiveErrorEvent(message));
    _emitState(GeminiLiveState.error, terminal: true);
    // Best-effort local cleanup so a failed session doesn't leave the mic open.
    unawaited(_stopMic());
    unawaited(_stopPlayback());
    unawaited(_teardownSocket());
  }

  Future<void> _teardownSocket() async {
    await _socketSub?.cancel();
    _socketSub = null;
    try {
      await _channel?.sink.close();
    } catch (_) {}
    _channel = null;
  }
}

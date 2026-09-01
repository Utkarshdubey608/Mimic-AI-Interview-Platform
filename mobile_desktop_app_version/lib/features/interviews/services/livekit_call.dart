// lib/features/interviews/services/livekit_call.dart
//
// The live recruiter ↔ candidate call, on LiveKit — the device half of the
// two-way interview track.
//
// This is the Flutter counterpart of the website's `useLiveKitCall` hook
// (src/features/interview/useLiveKitCall.ts) and deliberately exposes the same
// surface — join / leave / participants / localParticipant / toggleMic /
// toggleCam / muted / camOff / callState / error — so the two clients behave
// the same way in the same room. It is a [ChangeNotifier] rather than a hook;
// the screen rebuilds from it with a ListenableBuilder.
//
// !!! WHY THIS EXISTS AT ALL ------------------------------------------------
// The app used to join the two-way call by pointing a WebView at a Daily room
// URL, because Daily serves a whole prebuilt call UI at that address. LiveKit
// does not: the URL it hands out is a `wss://` signalling endpoint, and the
// client is expected to own the media and the UI. So switching engines is not a
// config change on this side — it needs a real client, which is this file.
//
// Two deliberate differences from the Daily path it replaces, both inherited
// from the engine and both matching the website:
//
//   * NO LOBBY. Daily gated entry on knock-and-admit; a LiveKit token is
//     authorised when it is minted, so a participant is in the room the moment
//     they connect. The waiting the candidate still does is the backend's 409
//     poll (the room does not exist until the recruiter hosts), which is the
//     same gate as before and lives in [TwoWayService].
//   * NO CLIENT RECORDING. Recording, where it is enabled, is LiveKit Egress on
//     the server. Nothing here writes a file.
// ---------------------------------------------------------------------------

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';

import 'package:talbotiq/core/utils/desktop_platform.dart';

/// Where the call is in its lifecycle. Mirrors the website's `CallState`.
///
/// [left] is a normal finish — including the far side ending the call, which
/// LiveKit delivers as a disconnect. [error] is a failure to get in at all.
enum CallState { idle, joining, joined, left, error }

/// A live LiveKit call. One instance per screen: [join] builds the room,
/// [leave] and [dispose] tear it down (both idempotent).
class LiveKitCall extends ChangeNotifier {
  Room? _room;
  EventsListener<RoomEvent>? _events;

  /// Guards against a second [join] racing the first — the screen's retry and
  /// its initial connect can otherwise both be in flight.
  bool _joining = false;
  bool _disposed = false;

  CallState _state = CallState.idle;
  String? _error;
  List<RemoteParticipant> _participants = const [];
  LocalParticipant? _local;
  bool _muted = false;
  bool _camOff = false;

  CallState get callState => _state;
  String? get error => _error;

  /// Everyone else in the room. The two-way track caps this at one person, but
  /// the list is kept general so the UI does not have to assume it.
  List<RemoteParticipant> get participants => _participants;
  LocalParticipant? get localParticipant => _local;
  bool get muted => _muted;
  bool get camOff => _camOff;

  /// Joins [url] (the `wss://` endpoint) with [token].
  ///
  /// Camera and microphone are requested from the OS first: LiveKit publishes
  /// from native capture devices rather than through a WebView, so a denied
  /// permission has to be reported here as a plain refusal rather than surface
  /// later as an unexplained empty tile.
  Future<void> join(
    String url,
    String token, {
    bool mic = true,
    bool cam = true,
  }) async {
    if (_joining || _room != null) return;
    _joining = true;
    _error = null;
    _set(CallState.joining);

    try {
      await _ensureCapturePermissions(mic: mic, cam: cam);
    } catch (e) {
      _joining = false;
      _fail(e.toString());
      return;
    }

    // adaptiveStream/dynacast keep an interview on a phone network affordable:
    // the SFU stops sending what nothing is rendering. Same options the web
    // client uses, so both sides negotiate alike.
    final room = Room(
      roomOptions: const RoomOptions(adaptiveStream: true, dynacast: true),
    );
    _room = room;

    // Room is itself a ChangeNotifier for membership/state; the event listener
    // covers the track-level changes (mute, subscribe) it does not announce.
    room.addListener(_refresh);
    final events = room.createListener();
    _events = events;
    events
      ..on<TrackSubscribedEvent>((_) => _refresh())
      ..on<TrackUnsubscribedEvent>((_) => _refresh())
      ..on<TrackMutedEvent>((_) => _refresh())
      ..on<TrackUnmutedEvent>((_) => _refresh())
      ..on<LocalTrackPublishedEvent>((_) => _refresh())
      ..on<LocalTrackUnpublishedEvent>((_) => _refresh())
      // The recruiter ending the interview deletes the room, which lands here
      // for the candidate. A finished call is not an error.
      ..on<RoomDisconnectedEvent>((_) {
        if (_state != CallState.error) _set(CallState.left);
      });

    try {
      await room.connect(url, token);
      await room.localParticipant?.setMicrophoneEnabled(mic);
      await room.localParticipant?.setCameraEnabled(cam);

      // leave()/dispose() may have raced the connect above. If the field no
      // longer points at this room, it has already been torn down — do not
      // resurrect it as 'joined'.
      if (_room != room) return;
      _refresh();
      _set(CallState.joined);
    } catch (e) {
      await _teardown(room);
      _fail(_readable(e));
    } finally {
      _joining = false;
    }
  }

  /// Leaves the call. Safe to call when not in one.
  Future<void> leave() async {
    final room = _room;
    _room = null;
    await _teardown(room);
    _participants = const [];
    _local = null;
    _set(CallState.left);
  }

  Future<void> toggleMic() async {
    final local = _room?.localParticipant;
    if (local == null) return;
    await local.setMicrophoneEnabled(!local.isMicrophoneEnabled());
    _refresh();
  }

  Future<void> toggleCam() async {
    final local = _room?.localParticipant;
    if (local == null) return;
    await local.setCameraEnabled(!local.isCameraEnabled());
    _refresh();
  }

  /// Flips to the other camera. A phone-only affordance the website has no need
  /// for — a candidate holding a handset is the common case here.
  Future<void> switchCamera() async {
    final publications =
        _room?.localParticipant?.videoTrackPublications ?? const [];
    for (final publication in publications) {
      // Only the camera: a screen share is also a video track, and restarting
      // that one would drop what is being shared.
      if (publication.source != TrackSource.camera) continue;
      final track = publication.track;
      if (track is! LocalVideoTrack) continue;
      final options = track.currentOptions;
      final isFront = options is CameraCaptureOptions &&
          options.cameraPosition == CameraPosition.front;
      try {
        await track.setCameraPosition(
          isFront ? CameraPosition.back : CameraPosition.front,
        );
      } catch (e) {
        debugPrint('LiveKitCall: could not switch camera ($e)');
      }
      return;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    final room = _room;
    _room = null;
    // Effect teardown cannot await — fire and forget, as the web client does.
    unawaited(_teardown(room));
    super.dispose();
  }

  // --- internals ------------------------------------------------------------

  /// Ask the OS for the capture devices, as a native app must.
  ///
  /// Desktop is skipped deliberately: permission_handler has no camera/mic
  /// implementation on Windows and Linux, so calling it there fails the join
  /// for a permission the platform grants at first use anyway (macOS prompts
  /// from its entitlements).
  Future<void> _ensureCapturePermissions({
    required bool mic,
    required bool cam,
  }) async {
    if (kIsWeb || isDesktopPlatform) return;

    final wanted = <Permission>[
      if (mic) Permission.microphone,
      if (cam) Permission.camera,
    ];
    if (wanted.isEmpty) return;

    final statuses = await wanted.request();
    final denied = statuses.entries.where((e) => !e.value.isGranted).toList();
    if (denied.isEmpty) return;

    final needsMic = denied.any((e) => e.key == Permission.microphone);
    final needsCam = denied.any((e) => e.key == Permission.camera);
    final what = needsMic && needsCam
        ? 'Camera and microphone access are'
        : needsMic
            ? 'Microphone access is'
            : 'Camera access is';
    throw Exception(
      '$what required to join the interview. Grant the permission in your '
      'device settings and try again.',
    );
  }

  /// Mirror the room's state onto this notifier. The room is the source of
  /// truth; nothing here caches anything it can read back.
  void _refresh() {
    final room = _room;
    if (room == null || _disposed) return;
    _participants = room.remoteParticipants.values.toList(growable: false);
    _local = room.localParticipant;
    _muted = !(room.localParticipant?.isMicrophoneEnabled() ?? false);
    _camOff = !(room.localParticipant?.isCameraEnabled() ?? false);
    _notify();
  }

  Future<void> _teardown(Room? room) async {
    final events = _events;
    _events = null;
    await events?.dispose();
    if (room == null) return;
    room.removeListener(_refresh);
    try {
      await room.disconnect();
    } catch (e) {
      debugPrint('LiveKitCall: disconnect failed ($e)');
    }
    try {
      await room.dispose();
    } catch (e) {
      debugPrint('LiveKitCall: dispose failed ($e)');
    }
  }

  void _fail(String message) {
    _error = message;
    _set(CallState.error);
  }

  void _set(CallState next) {
    if (_state == next) return;
    _state = next;
    _notify();
  }

  void _notify() {
    if (_disposed) return;
    notifyListeners();
  }

  /// LiveKit's exceptions stringify with their class name attached, which is
  /// noise in front of a candidate mid-interview.
  static String _readable(Object e) {
    if (e is ConnectException) {
      final message = e.message.trim();
      return message.isEmpty
          ? 'Could not connect to the interview room.'
          : message;
    }
    if (e is MediaConnectException) {
      return 'Could not open your camera or microphone. Check that no other '
          'app is using them.';
    }
    return e.toString().replaceAll('Exception: ', '');
  }
}

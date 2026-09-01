// lib/features/interviews/services/twoway_service.dart
//
// The live recruiter ↔ candidate call (the two-way interview track).
//
// The device never holds a vendor API key: it asks the backend for a room URL
// and a short-lived token, and joins with those.
//
// WHICH ENGINE is the backend's decision (`TWOWAY_ENGINE`), not the app's, and
// the same decision the website's client reads — the two must land in the same
// room on the same media server or they are not in the same call. The app tells
// the two apart by the URL it is handed, which is the honest signal: LiveKit
// answers a `wss://` signalling endpoint that needs a real client
// ([LiveKitCall]), Daily answers an `https://` page that serves its own prebuilt
// call UI in a WebView. See [TwoWayGrant.isLiveKit].
//
// The ordering is the part worth understanding. Only the RECRUITER can open the
// call; the candidate's [join] answers 409 until they have. That is a normal
// state of this flow, not an error — the candidate can be waiting minutes before
// the interviewer arrives — so it surfaces as [TwoWayNotStarted] for the waiting
// screen to poll on, rather than as a failure to show them.

import 'package:talbotiq/core/net/backend_client.dart';

/// The interviewer has not opened the call yet. Poll and try again.
class TwoWayNotStarted implements Exception {
  final String message;
  const TwoWayNotStarted(this.message);

  @override
  String toString() => message;
}

/// Everything needed to join the call. No vendor API key is part of it.
class TwoWayGrant {
  /// LiveKit: the `wss://` signalling endpoint (identical for both parties —
  /// the room is named inside [token]). Daily: the room's own `https://` page.
  final String roomUrl;
  final String token;

  /// True only for the recruiter. Ownership is what admits the person waiting in
  /// the lobby, so this decides which controls the app shows.
  final bool isOwner;

  const TwoWayGrant({
    required this.roomUrl,
    required this.token,
    required this.isOwner,
  });

  /// Whether this call runs on LiveKit, and so needs the native client rather
  /// than a WebView.
  ///
  /// Read off the scheme rather than a flag from the server: the scheme is what
  /// actually decides whether the URL can be loaded as a page, and it cannot
  /// drift out of step with the URL the way a separate field could.
  bool get isLiveKit {
    final scheme = Uri.tryParse(roomUrl)?.scheme.toLowerCase();
    return scheme == 'wss' || scheme == 'ws';
  }

  /// DAILY ONLY — the URL to load in the WebView: the room, with the token
  /// applied. Meaningless for LiveKit, whose endpoint is not a page; guard with
  /// [isLiveKit] before using it.
  ///
  /// Daily's prebuilt UI reads `?t=` and joins with that identity, which is what
  /// gives the recruiter the admit control and leaves the candidate knocking.
  String get joinUrl {
    if (roomUrl.isEmpty) return '';
    final separator = roomUrl.contains('?') ? '&' : '?';
    return '$roomUrl$separator t=$token'.replaceAll(' ', '');
  }

  factory TwoWayGrant.fromJson(Map<String, dynamic> json) {
    final url = (json['roomUrl'] as String?)?.trim() ?? '';
    final token = (json['token'] as String?)?.trim() ?? '';
    if (url.isEmpty || token.isEmpty) {
      throw const BackendException(
        'The server did not return a usable call link.',
      );
    }
    return TwoWayGrant(
      roomUrl: url,
      token: token,
      isOwner: json['isOwner'] == true,
    );
  }
}

class TwoWayService {
  TwoWayService({BackendClient? backend}) : _injectedBackend = backend;

  final BackendClient? _injectedBackend;
  BackendClient get _backend => _injectedBackend ?? backendClient;

  bool get enabled => _backend.isConfigured;

  /// Recruiter: opens the call, creating the room. Idempotent — re-joining after
  /// a dropped connection returns the same room rather than opening a second one.
  Future<TwoWayGrant> host(String interviewId) async {
    final json =
        await _backend.postJson('/api/interviews/$interviewId/twoway/host');
    return TwoWayGrant.fromJson(json);
  }

  /// Candidate: joins once the recruiter has opened the call.
  ///
  /// Throws [TwoWayNotStarted] while the room does not exist yet, which is the
  /// waiting screen's cue to keep polling rather than to show an error.
  Future<TwoWayGrant> join(String interviewId) async {
    try {
      final json =
          await _backend.postJson('/api/interviews/$interviewId/twoway/join');
      return TwoWayGrant.fromJson(json);
    } on BackendException catch (e) {
      // 409 is "not started yet" OR "this round is closed". Both are conflicts,
      // so the message is what separates them — and the closed case must NOT be
      // polled on forever, which is why only the former maps to TwoWayNotStarted.
      if (e.statusCode == 409 && e.message.contains('has not started')) {
        throw TwoWayNotStarted(e.message);
      }
      rethrow;
    }
  }

  /// Recruiter: ends the call. Deletes the room, which ejects the candidate too,
  /// and marks the interview as awaiting the recruiter's own review.
  Future<void> complete(String interviewId) =>
      _backend.postJson('/api/interviews/$interviewId/twoway/complete');
}

final twoWayService = TwoWayService();

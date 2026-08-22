// lib/core/net/backend_client.dart
//
// The single door to the TalbotIQ backend. Every service that used to hold a
// vendor API key talks through this instead: it attaches the signed-in user's
// Firebase ID token, builds URLs from BackendConfig, and turns the backend's
// error envelope into a message worth showing a person.
//
// Deliberately transport-only. It knows about auth, JSON and errors; it does
// NOT know what a Tavus conversation or a Gemini prompt is. Each service owns
// its own paths and payloads, so this file stays small as they migrate.
//
// Layered on top of ApiClient, which already owns the timeout and the
// conservative 429/503 retry policy (including "never blindly retry a POST").

import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'package:talbotiq/core/net/api_client.dart';
import 'package:talbotiq/core/net/backend_config.dart';
import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/core/net/live_token.dart';

/// A failure from the backend, already reduced to something showable.
///
/// The backend never forwards vendor error bodies, so [message] is safe to put
/// in front of a user — it is either our own `detail` string or a transport
/// message from [ApiClient].
class BackendException implements Exception {
  const BackendException(
    this.message, {
    this.statusCode,
    this.provider,
    this.isTimeout = false,
  });

  final String message;
  final int? statusCode;

  /// Which upstream failed, when the backend could attribute it ("Gemini").
  final String? provider;

  final bool isTimeout;

  /// The feature has no credentials configured on the server. Callers should
  /// hide or disable the feature rather than offering a retry.
  bool get isNotConfigured => statusCode == 503;

  /// The user's sign-in is stale. Nothing to retry until they sign in again.
  bool get isAuthError => statusCode == 401;

  /// Rate limited. Backing off and retrying is reasonable.
  bool get isRateLimited => statusCode == 429;

  @override
  String toString() => 'BackendException(${statusCode ?? 'network'}): $message';
}

class BackendClient {
  BackendClient({
    ApiClient? client,
    FirebaseAuth? auth,
    String? baseUrl,
    Future<String> Function()? tokenProvider,
  })  : _api = client ??
            ApiClient(
              // Scoring a full interview transcript is slow; the backend's own
              // read timeout is 120s, so give it room to answer.
              timeout: const Duration(seconds: 120),
            ),
        _injectedAuth = auth,
        _baseUrl = baseUrl ?? BackendConfig.baseUrl,
        _tokenProvider = tokenProvider;

  final ApiClient _api;
  final String _baseUrl;

  /// Resolved lazily, never in the constructor: reaching for
  /// `FirebaseAuth.instance` eagerly would throw wherever Firebase has not been
  /// initialised — including in tests that inject [_tokenProvider] and never
  /// need Firebase at all.
  final FirebaseAuth? _injectedAuth;
  FirebaseAuth get _auth => _injectedAuth ?? FirebaseAuth.instance;

  /// Overrides where the ID token comes from. Exists so tests need no Firebase;
  /// production always leaves it null and goes through [_firebaseIdToken].
  final Future<String> Function()? _tokenProvider;

  /// False when no backend URL was compiled in — callers should surface
  /// [BackendConfig.configHint] rather than failing with a network error.
  bool get isConfigured => _baseUrl.isNotEmpty;

  // ── auth ────────────────────────────────────────────────────────────────

  /// The token to send. Delegates to Firebase unless a provider was injected.
  Future<String> _idToken() =>
      _tokenProvider?.call() ?? _firebaseIdToken();

  /// The current user's Firebase ID token.
  ///
  /// Not cached: the SDK caches internally and refreshes when the token is
  /// within five minutes of expiry, so asking every request is cheap and always
  /// yields a valid token. Caching it here would reintroduce the expiry bugs
  /// the SDK exists to avoid.
  Future<String> _firebaseIdToken() async {
    final user = _auth.currentUser;
    if (user == null) {
      throw const BackendException(
        'You are signed out. Sign in and try again.',
        statusCode: 401,
      );
    }
    try {
      final token = await user.getIdToken();
      if (token == null || token.isEmpty) {
        throw const BackendException(
          'Could not refresh your sign-in. Sign in again.',
          statusCode: 401,
        );
      }
      return token;
    } on FirebaseAuthException catch (e) {
      throw BackendException(
        'Could not refresh your sign-in: ${e.message ?? e.code}',
        statusCode: 401,
      );
    }
  }

  /// An ID token for a WebSocket handshake.
  ///
  /// Browsers cannot set headers on a WebSocket, so any socket the app opens to
  /// our own backend must carry the token another way. Exposed for that case
  /// only — prefer the request helpers everywhere else.
  Future<String> socketToken() => _idToken();

  /// Names which client this is, so the server can honour an interview a
  /// recruiter restricted to particular devices.
  ///
  /// A header rather than a field on each request body: it applies to every route
  /// at once, and no launch payload had to change to add it.
  ///
  /// ⚠️ Self-reported, and the server treats it that way. This is what stops a
  /// candidate opening the wrong client by accident; it is not a security control,
  /// and nothing that matters — access, attempts, scoring — is gated on it. See
  /// `interviews.DEVICES` in the backend for the whole argument.
  static const String deviceHeader = 'X-Talbotiq-Device';

  /// `desktop` for a Windows/macOS/Linux build, `mobile` otherwise.
  ///
  /// Flutter web builds of this app report `mobile` rather than `web`: `web` means
  /// the React application, which is a different client with a different runtime,
  /// and claiming to be it would let this app through a browser-only restriction it
  /// cannot actually satisfy.
  static String get clientDevice => isDesktopPlatform ? 'desktop' : 'mobile';

  Future<Map<String, String>> _headers({String? contentType}) async => {
        'Authorization': 'Bearer ${await _idToken()}',
        deviceHeader: clientDevice,
        if (contentType != null) 'Content-Type': contentType,
      };

  // ── requests ────────────────────────────────────────────────────────────

  Uri _uri(String path, [Map<String, String>? query]) {
    final uri = Uri.parse('$_baseUrl${path.startsWith('/') ? path : '/$path'}');
    if (query == null || query.isEmpty) return uri;
    return uri.replace(queryParameters: {...uri.queryParameters, ...query});
  }

  Future<Map<String, dynamic>> getJson(
    String path, {
    Map<String, String>? query,
  }) async {
    _assertConfigured();
    return _decode(await _guard(
      () async => _api.get(_uri(path, query), headers: await _headers()),
    ));
  }

  Future<Map<String, dynamic>> postJson(
    String path, {
    Object? body,
    Map<String, String>? query,
  }) async {
    _assertConfigured();
    return _decode(await _guard(
      () async => _api.post(
        _uri(path, query),
        headers: await _headers(contentType: 'application/json'),
        body: body == null ? null : jsonEncode(body),
      ),
    ));
  }

  Future<Map<String, dynamic>> putJson(
    String path, {
    Object? body,
    Map<String, String>? query,
  }) async {
    _assertConfigured();
    return _decode(await _guard(
      () async => _api.put(
        _uri(path, query),
        headers: await _headers(contentType: 'application/json'),
        body: body == null ? null : jsonEncode(body),
      ),
    ));
  }

  /// GETs a JSON **array**.
  ///
  /// Separate from [getJson] rather than folded into it: `_decode` returns a map, and
  /// a route that answers a list (`/api/mcq-sets`) would otherwise fail with "the
  /// server returned an unexpected response" — a message that sends somebody debugging
  /// the server instead of the client.
  Future<List<Map<String, dynamic>>> getJsonList(
    String path, {
    Map<String, String>? query,
  }) async {
    _assertConfigured();
    final response = await _guard(
      () async => _api.get(_uri(path, query), headers: await _headers()),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      // Reuse the error envelope: `_decode` raises with the backend's own `detail`,
      // which is the truest message available.
      _decode(response);
    }
    final text = _utf8Body(response);
    if (text.isEmpty) return const [];
    final decoded = jsonDecode(text);
    if (decoded is! List) {
      throw BackendException(
        'The server returned an unexpected response.',
        statusCode: response.statusCode,
      );
    }
    return decoded.whereType<Map>().map(Map<String, dynamic>.from).toList();
  }

  /// DELETEs, tolerating an empty body.
  ///
  /// A 204 is the normal success here and carries nothing, so this cannot go through
  /// `_decode` — which requires a body and would turn every successful delete into an
  /// error.
  Future<void> deleteJson(String path, {Map<String, String>? query}) async {
    _assertConfigured();
    final response = await _guard(
      () async => _api.delete(_uri(path, query), headers: await _headers()),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      _decode(response);
    }
  }

  /// POSTs raw bytes — audio, where the body IS the payload.
  Future<Map<String, dynamic>> postBytes(
    String path,
    List<int> bytes, {
    required String contentType,
    Map<String, String>? query,
  }) async {
    _assertConfigured();
    return _decode(await _guard(
      () async => _api.post(
        _uri(path, query),
        headers: await _headers(contentType: contentType),
        body: bytes,
      ),
    ));
  }

  // ── typed helpers ───────────────────────────────────────────────────────

  /// Mints a short-lived, locked Gemini Live token for [interviewId].
  ///
  /// The model, voice and interviewer instruction are chosen by the server and
  /// sealed into the token — this call cannot influence them, which is what
  /// makes connecting straight to Google safe. Mint immediately before
  /// connecting: the grant's connect window is short (see [LiveTokenGrant]).
  Future<LiveTokenGrant> mintLiveToken({required String interviewId}) async {
    final json = await postJson(
      '/api/rt/gemini-token',
      body: {'interview_id': interviewId},
    );
    return LiveTokenGrant.fromJson(json);
  }

  /// Mints a token for a single voice sample (the recruiter's voice picker).
  ///
  /// The voice and the spoken line are locked into the token, and the session is
  /// capped at a couple of minutes, so a leaked preview grant buys very little.
  Future<LiveTokenGrant> mintPreviewToken({
    required String voiceName,
    String? sampleText,
  }) async {
    final json = await postJson(
      '/api/rt/gemini-preview-token',
      body: {
        'voice_name': voiceName,
        if (sampleText != null && sampleText.trim().isNotEmpty)
          'sample_text': sampleText.trim(),
      },
    );
    return LiveTokenGrant.fromJson(json);
  }

  /// Server-reported feature availability, replacing the old per-key
  /// "Test Connection" buttons. Never throws — a diagnostics call that fails
  /// should not take a screen down with it.
  Future<Map<String, bool>> providerReadiness() async {
    try {
      final json = await getJson('/health');
      final providers = json['providers'];
      if (providers is Map) {
        return {
          for (final entry in providers.entries)
            entry.key.toString(): entry.value == true,
        };
      }
    } catch (e) {
      debugPrint('providerReadiness failed: $e');
    }
    return const {};
  }

  // ── plumbing ────────────────────────────────────────────────────────────

  void _assertConfigured() {
    if (isConfigured) return;
    // Derived from this client's own base URL, not BackendConfig — an injected
    // empty baseUrl must give the same actionable message as a release build
    // that was compiled without the define.
    throw BackendException(
      BackendConfig.configHint ??
          'No backend URL is configured. Rebuild with '
              '--dart-define=BACKEND_BASE_URL=https://your-backend',
    );
  }

  /// Runs a request, translating [ApiException] into [BackendException] so
  /// callers only ever handle one error type.
  Future<http.Response> _guard(Future<http.Response> Function() send) async {
    try {
      return await send();
    } on ApiException catch (e) {
      throw BackendException(
        e.isTimeout
            ? 'The server took too long to respond. Check your connection.'
            : e.message,
        statusCode: e.statusCode,
        isTimeout: e.isTimeout,
      );
    }
  }

  /// The response body as UTF-8, which is what the backend actually sends.
  ///
  /// NOT `response.body`: that decodes using the charset in the Content-Type
  /// header and falls back to **latin-1** when there is none — and FastAPI's
  /// JSONResponse sends a bare `application/json`, no charset. Every non-ASCII
  /// character therefore came back mangled ("José" → "JosÃ©"), which matters most
  /// for the text this client moves in bulk: extracted résumés, interview
  /// summaries, anything a person typed. The asymmetry is easy to miss because
  /// the `http` package defaults REQUEST bodies to UTF-8 — only responses guess.
  ///
  /// `allowMalformed` so a genuinely corrupt body degrades to replacement
  /// characters instead of throwing inside a decode we cannot retry.
  String _utf8Body(http.Response response) {
    if (response.bodyBytes.isEmpty) return '';
    return utf8.decode(response.bodyBytes, allowMalformed: true);
  }

  /// Decodes a success body, or raises the backend's error envelope.
  ///
  /// The backend answers errors as `{detail, provider?, upstream_status?}` and
  /// deliberately omits the vendor's own text, so `detail` is both safe and the
  /// most useful thing to show.
  Map<String, dynamic> _decode(http.Response response) {
    final ok = response.statusCode >= 200 && response.statusCode < 300;

    Map<String, dynamic>? body;
    final text = _utf8Body(response);
    if (text.isNotEmpty) {
      try {
        final decoded = jsonDecode(text);
        if (decoded is Map<String, dynamic>) body = decoded;
      } catch (_) {
        // Fall through: a non-JSON body is handled below.
      }
    }

    if (ok) {
      if (body != null) return body;
      throw BackendException(
        'The server returned an unexpected response.',
        statusCode: response.statusCode,
      );
    }

    final detail = body?['detail'];
    throw BackendException(
      detail is String && detail.trim().isNotEmpty
          ? detail
          : 'The server returned HTTP ${response.statusCode}.',
      statusCode: response.statusCode,
      provider: body?['provider'] as String?,
    );
  }

  void close() => _api.close();
}

/// The shared client every migrated service uses by default.
///
/// Created lazily, never at import time: constructing it eagerly would reach for
/// `FirebaseAuth.instance` before `Firebase.initializeApp()` has run. Services
/// take an optional `BackendClient` in their constructor so tests can inject a
/// stub instead of reaching for this.
BackendClient get backendClient => _sharedClient ??= BackendClient();
BackendClient? _sharedClient;

@visibleForTesting
void setBackendClientForTesting(BackendClient? client) => _sharedClient = client;

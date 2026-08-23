// lib/core/net/api_client.dart
//
// A thin, shared HTTP client used by every outbound service (Gemini, Tavus,
// Deepgram, the TalbotIQ backend). It exists to enforce three things that
// the raw `http` calls previously got wrong:
//
//   1. A mandatory request timeout. Bare `http.get/post` never time out, so a
//      stalled TCP connection (captive portal, dead third-party host) hangs the
//      awaiting future forever and the UI spins with no error.
//   2. A single, conservative retry policy. We retry ONLY on server-signalled
//      transient failures (429 / 503) with exponential backoff. We deliberately
//      do NOT auto-retry on timeout for POST, because the server may already
//      have processed a non-idempotent request (e.g. Tavus conversation create)
//      and a blind retry would double-charge / double-create.
//   3. Typed, non-leaky errors ([ApiException]) that carry the status code and
//      transient/auth classification without embedding raw upstream bodies.
//
// Services keep their own auth headers and payload shapes; this only owns the
// transport concerns.

import 'dart:async';

import 'package:http/http.dart' as http;

/// A transport-level failure with enough structure for callers to react
/// (retry, surface a friendly message, fast-fail on auth) without parsing
/// strings or leaking upstream response bodies to the UI.
class ApiException implements Exception {
  const ApiException(
    this.message, {
    this.statusCode,
    this.isTimeout = false,
  });

  final String message;
  final int? statusCode;
  final bool isTimeout;

  /// Server-signalled transient conditions that are safe to retry.
  bool get isTransient =>
      isTimeout ||
      statusCode == 429 ||
      (statusCode != null && statusCode! >= 500);

  /// Bad/expired/insufficient credentials — never worth retrying.
  bool get isAuthError => statusCode == 401 || statusCode == 403;

  @override
  String toString() =>
      'ApiException(${isTimeout ? 'timeout' : statusCode ?? 'network'}): $message';
}

/// Small HTTP helper with a request timeout and selective retry/backoff on 429
/// and 503 responses. Deliberately does NOT retry a POST after a timeout (the
/// server may have already processed it), so callers never double-submit.
class ApiClient {
  ApiClient({
    http.Client? client,
    Duration timeout = const Duration(seconds: 30),
    int maxRetries = 2,
  })  : _client = client ?? http.Client(),
        _timeout = timeout,
        _maxRetries = maxRetries;

  final http.Client _client;
  final Duration _timeout;
  final int _maxRetries;

  Future<http.Response> get(Uri url, {Map<String, String>? headers}) =>
      _send(() => _client.get(url, headers: headers), idempotent: true);

  Future<http.Response> post(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
  }) =>
      _send(() => _client.post(url, headers: headers, body: body),
          idempotent: false);

  /// PUT, retried like GET rather than like POST.
  ///
  /// `idempotent: true` because a PUT *replaces* — sending the same body twice
  /// leaves the same state, so a retry after a transient 503 cannot duplicate
  /// anything. That is exactly the property POST lacks, which is why the policy
  /// above refuses to retry it.
  Future<http.Response> put(
    Uri url, {
    Map<String, String>? headers,
    Object? body,
  }) =>
      _send(() => _client.put(url, headers: headers, body: body),
          idempotent: true);

  Future<http.Response> delete(Uri url, {Map<String, String>? headers}) =>
      _send(() => _client.delete(url, headers: headers), idempotent: true);

  /// Sends a [http.StreamedRequest]/[http.MultipartRequest] with the same
  /// timeout + transient-retry policy. Used for file uploads.
  Future<http.Response> sendMultipart(
    http.BaseRequest Function() build, {
    bool idempotent = false,
  }) =>
      _send(() async {
        final streamed = await _client.send(build());
        return http.Response.fromStream(streamed);
      }, idempotent: idempotent);

  /// Core loop: apply the timeout, retry only transient server responses
  /// (429/503) with backoff. Timeouts on non-idempotent requests are surfaced
  /// immediately so we never risk a duplicate side effect.
  Future<http.Response> _send(
    Future<http.Response> Function() run, {
    required bool idempotent,
  }) async {
    var attempt = 0;
    while (true) {
      attempt++;
      try {
        final resp = await run().timeout(_timeout);
        final transient = resp.statusCode == 429 || resp.statusCode == 503;
        if (transient && attempt <= _maxRetries) {
          await Future<void>.delayed(_backoff(attempt));
          continue;
        }
        return resp;
      } on TimeoutException {
        // Only safe to retry a timeout when the request is idempotent.
        if (idempotent && attempt <= _maxRetries) {
          await Future<void>.delayed(_backoff(attempt));
          continue;
        }
        throw const ApiException('Request timed out. Check your connection.',
            isTimeout: true);
      } on http.ClientException catch (e) {
        if (idempotent && attempt <= _maxRetries) {
          await Future<void>.delayed(_backoff(attempt));
          continue;
        }
        throw ApiException('Network error: ${e.message}');
      }
    }
  }

  Duration _backoff(int attempt) =>
      Duration(milliseconds: 500 * (1 << (attempt - 1)));

  void close() => _client.close();
}

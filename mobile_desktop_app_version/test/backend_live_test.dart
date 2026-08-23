// test/backend_live_test.dart
//
// Phase 6 integration check: does BackendClient actually talk to a real running
// backend? The unit tests stub HTTP, so they cannot catch a URL that is joined
// wrongly, an error envelope whose shape drifted, or a header the server rejects.
//
// SKIPPED unless a backend is reachable, so `flutter test` stays offline and fast:
//
//   cd backend && .venv/bin/uvicorn app.main:app --port 8000
//   flutter test test/backend_live_test.dart
//
// Auth is not exercised here — a real Firebase ID token needs a signed-in user.
// Every /api route answers 401 without one, which is itself worth asserting.

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:talbotiq/core/net/api_client.dart';
import 'package:talbotiq/core/net/backend_client.dart';

const _baseUrl = 'http://127.0.0.1:8000';

Future<bool> _backendIsUp() async {
  try {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
    final request = await client.getUrl(Uri.parse('$_baseUrl/health'));
    final response = await request.close();
    await response.drain();
    client.close();
    return response.statusCode == 200;
  } catch (_) {
    return false;
  }
}

void main() {
  late bool up;

  setUpAll(() async {
    up = await _backendIsUp();
    if (!up) {
      // ignore: avoid_print
      print('SKIPPING: no backend at $_baseUrl — start uvicorn to run these.');
    }
  });

  BackendClient client({String token = 'not-a-real-token'}) => BackendClient(
        client: ApiClient(client: null, timeout: const Duration(seconds: 10)),
        baseUrl: _baseUrl,
        tokenProvider: () async => token,
      );

  test('health reports which providers the server has configured', () async {
    if (!up) return;
    final readiness = await client().providerReadiness();
    // Whatever is configured, the server must answer with the keys it knows.
    expect(readiness.keys, containsAll(<String>['gemini', 'tavus', 'deepgram']));

    // `hume` IS reported, and this asserted the opposite for a long time without
    // anybody noticing — the test returns early when no backend is reachable, so it
    // silently passed on every offline run and only failed the first time somebody had
    // a server up.
    //
    // What was actually discontinued is Hume's batch PROSODY API, not the key: the
    // server still reports whether one is configured, and `avatar/status` treats the
    // flag as "Hume or the Gemini audio fallback". `providers.readiness` also says in
    // its own comment that keys are ADDED rather than removed, precisely because this
    // client maps the dict generically and a removal would silently disable a feature.
    expect(readiness.containsKey('hume'), isTrue);
  }, timeout: const Timeout(Duration(seconds: 20)));

  test('a bogus token is rejected, and the message is showable', () async {
    if (!up) return;
    // Proves the header reaches the server in the form it expects: it gets far
    // enough to try verifying the token rather than failing on a malformed
    // request.
    await expectLater(
      client().postJson('/api/gemini/generate', body: {'contents': []}),
      throwsA(isA<BackendException>().having(
        (e) => e.statusCode,
        'statusCode',
        anyOf(401, 503),
      )),
    );
  }, timeout: const Timeout(Duration(seconds: 20)));

  test('minting a Live token without a real user is refused', () async {
    if (!up) return;
    await expectLater(
      client().mintLiveToken(interviewId: 'does-not-exist'),
      throwsA(isA<BackendException>()),
    );
  }, timeout: const Timeout(Duration(seconds: 20)));

  test('an unknown path gives a clean 404, not a crash', () async {
    if (!up) return;
    await expectLater(
      client().getJson('/api/nope'),
      throwsA(isA<BackendException>()
          .having((e) => e.statusCode, 'statusCode', 404)),
    );
  }, timeout: const Timeout(Duration(seconds: 20)));
}

// test/mcq_store_test.dart
//
// The MCQ runtime's behaviour, against a stubbed backend.
//
// Three things are worth pinning, and each corresponds to a way a candidate can lose
// work or be scored on the wrong thing:
//
//   * autosave is DEBOUNCED, and carries the whole answer map — so a dropped request
//     costs nothing and a fast worker does not generate a request per tap;
//   * submit carries the final answers WITH it — so answering the last question and
//     pressing submit immediately cannot be scored without it;
//   * a failed submit returns the candidate to their paper, not to an error screen
//     with their answers behind it.

import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:talbotiq/core/net/api_client.dart';
import 'package:talbotiq/core/net/backend_client.dart';
import 'package:talbotiq/features/interviews/candidate/mcq/mcq_models.dart';
import 'package:talbotiq/features/interviews/candidate/mcq/mcq_store.dart';

/// Answers each path with whatever was queued for it, and records every request.
class _Routes extends http.BaseClient {
  final Map<String, int> statuses = {};
  final Map<String, String> bodies = {};
  final List<http.Request> seen = [];

  void reply(String pathSuffix, {int status = 200, Map<String, dynamic>? json}) {
    statuses[pathSuffix] = status;
    bodies[pathSuffix] = jsonEncode(json ?? {'ok': true});
  }

  List<http.Request> to(String pathSuffix) =>
      seen.where((r) => r.url.path.endsWith(pathSuffix)).toList();

  Map<String, dynamic> bodyOf(http.Request request) =>
      jsonDecode(request.body) as Map<String, dynamic>;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request is http.Request) seen.add(request);
    final match = statuses.keys.firstWhere(
      (suffix) => request.url.path.endsWith(suffix),
      orElse: () => '',
    );
    return http.StreamedResponse(
      Stream.value(utf8.encode(match.isEmpty ? '{}' : bodies[match]!)),
      match.isEmpty ? 404 : statuses[match]!,
      request: request,
    );
  }
}

const _paper = {
  'interviewId': 'iv-1',
  'name': 'Backend Screening',
  'status': 'in_progress',
  'questions': [
    {
      'id': 'q1',
      'text': 'Which is prime?',
      'type': 'single',
      'options': [
        {'id': 'a', 'text': '4'},
        {'id': 'b', 'text': '7'},
      ],
      'points': 1,
    },
    {
      'id': 'q2',
      'text': 'Which are idempotent?',
      'type': 'multi',
      'options': [
        {'id': 'get', 'text': 'GET'},
        {'id': 'put', 'text': 'PUT'},
        {'id': 'post', 'text': 'POST'},
      ],
      'points': 2,
    },
    {
      'id': 'q3',
      'text': 'Pair them',
      'type': 'match',
      'prompts': [
        {'id': 'p1', 'text': '200'},
      ],
      'matches': [
        {'id': 'm1', 'text': 'OK'},
        {'id': 'm2', 'text': 'Not Found'},
      ],
      'points': 1,
    },
  ],
  'answers': <String, dynamic>{},
};

void main() {
  late _Routes routes;
  late McqStore store;

  McqQuestion q(String id) => store.paper!.questions.firstWhere((x) => x.id == id);

  setUp(() async {
    routes = _Routes();
    routes.reply('/mcq', json: Map<String, dynamic>.from(_paper));
    routes.reply('/mcq/answers', json: {'ok': true, 'saved': 1, 'total': 3});
    routes.reply('/mcq/submit', json: {'submitted': true});
    store = McqStore(
      interviewId: 'iv-1',
      client: BackendClient(
        client: ApiClient(client: routes, maxRetries: 0),
        baseUrl: 'https://backend.test',
        tokenProvider: () async => 'test-id-token',
      ),
      // Short enough to await in a test, long enough to still be a debounce.
      autosaveDelay: const Duration(milliseconds: 30),
    );
    await store.load();
  });

  group('the clock', () {
    // A candidate was told "15 min" on their interviews screen and then handed a
    // paper with no clock on it. These pin the two halves of the fix: the deadline
    // comes from the SERVER, and it is measured from load rather than recomputed
    // from a device clock the candidate can change.

    test('an untimed paper has no clock at all', () {
      // Not zero — zero means "time is up" and would hand the paper in on open.
      expect(store.remaining, isNull);
      expect(store.isTimeUp, isFalse);
    });

    test('a timed paper counts down from what the server said is left', () async {
      routes.reply('/mcq', json: {..._paper, 'totalSeconds': 900,
        'remainingSeconds': 300});
      await store.load();

      final left = store.remaining!;
      // Anchored at load, so it is 300 seconds minus however long this test took.
      expect(left.inSeconds, lessThanOrEqualTo(300));
      expect(left.inSeconds, greaterThan(295));
      expect(store.isTimeUp, isFalse);
    });

    test('the total alone does not start a clock', () async {
      // `remainingSeconds` is the only number a client may trust — a paper that
      // reports a length but no remaining time gets no clock rather than a fresh
      // one, which would restart on every reopen.
      routes.reply('/mcq', json: {..._paper, 'totalSeconds': 900});
      await store.load();

      expect(store.paper!.totalSeconds, 900);
      expect(store.remaining, isNull);
    });

    test('an expired attempt reads as time up, not as negative time', () async {
      routes.reply('/mcq', json: {..._paper, 'totalSeconds': 900,
        'remainingSeconds': 0});
      await store.load();

      expect(store.remaining, Duration.zero);
      expect(store.isTimeUp, isTrue);
    });

    test('reopening picks the clock up where the server left it', () async {
      routes.reply('/mcq', json: {..._paper, 'totalSeconds': 900,
        'remainingSeconds': 600});
      await store.load();
      expect(store.remaining!.inSeconds, greaterThan(595));

      // Same paper, later: the server says five minutes, not ten.
      routes.reply('/mcq', json: {..._paper, 'totalSeconds': 900,
        'remainingSeconds': 300});
      await store.load();
      expect(store.remaining!.inSeconds, lessThanOrEqualTo(300));
    });
  });

  group('loading', () {
    test('the paper arrives answerable and unanswered', () {
      expect(store.phase, McqPhase.ready);
      expect(store.total, 3);
      expect(store.answered, 0);
    });

    test('an already-submitted paper opens read-only', () async {
      routes.reply('/mcq', json: {..._paper, 'status': 'submitted'});
      await store.load();
      expect(store.phase, McqPhase.submitted);

      store.choose(q('q1'), 'b');
      expect(store.answered, 0, reason: 'a submitted paper cannot be edited');
    });

    test('a paper that will not load offers a retry rather than a blank screen', () async {
      routes.reply('/mcq', status: 409, json: {'detail': 'This assessment is no longer available.'});
      await store.load();
      expect(store.phase, McqPhase.failed);
      expect(store.error, contains('no longer available'));
    });

    test('answers already stored are restored', () async {
      routes.reply('/mcq', json: {
        ..._paper,
        'answers': {
          'q1': ['b'],
        },
      });
      await store.load();
      expect(store.selectionFor(q('q1')), ['b']);
      expect(store.answered, 1);
    });
  });

  group('choosing', () {
    test('single-select replaces, and tapping the same option clears it', () {
      store.choose(q('q1'), 'a');
      expect(store.selectionFor(q('q1')), ['a']);
      store.choose(q('q1'), 'b');
      expect(store.selectionFor(q('q1')), ['b'], reason: 'single-select replaces');
      store.choose(q('q1'), 'b');
      expect(store.selectionFor(q('q1')), isEmpty, reason: 'a mis-tap must be undoable');
    });

    test('multi-select toggles', () {
      store.choose(q('q2'), 'get');
      store.choose(q('q2'), 'put');
      expect(store.selectionFor(q('q2')), ['get', 'put']);
      store.choose(q('q2'), 'get');
      expect(store.selectionFor(q('q2')), ['put']);
    });

    test('deselecting everything is stored as empty, not removed', () async {
      // The difference matters on the wire: a REMOVED key leaves whatever the server
      // already had, so a candidate who changed their mind would be scored on the
      // answer they withdrew.
      store.choose(q('q2'), 'get');
      store.choose(q('q2'), 'get');
      await store.saveNow();
      final sent = routes.bodyOf(routes.to('/mcq/answers').last)['answers'] as Map;
      expect(sent.containsKey('q2'), isTrue);
      expect(sent['q2'], isEmpty);
    });

    test('a pairing records one prompt at a time and can be cleared', () {
      store.pair(q('q3'), 'p1', 'm2');
      expect(store.pairingFor(q('q3')), {'p1': 'm2'});
      store.pair(q('q3'), 'p1', null);
      expect(store.pairingFor(q('q3')), isEmpty);
    });
  });

  group('autosave', () {
    test('several quick taps become one request', () async {
      store.choose(q('q1'), 'a');
      store.choose(q('q1'), 'b');
      store.choose(q('q2'), 'get');
      expect(routes.to('/mcq/answers'), isEmpty, reason: 'nothing goes out mid-burst');

      await Future<void>.delayed(const Duration(milliseconds: 90));
      expect(routes.to('/mcq/answers'), hasLength(1));
    });

    test('the save carries every answer, not a delta', () async {
      store.choose(q('q1'), 'b');
      store.choose(q('q2'), 'put');
      store.pair(q('q3'), 'p1', 'm1');
      await store.saveNow();

      final sent = routes.bodyOf(routes.to('/mcq/answers').last)['answers'] as Map;
      expect(sent.keys.toSet(), {'q1', 'q2', 'q3'});
      expect(sent['q3'], {'p1': 'm1'});
    });

    test('a failed save is silent and loses nothing', () async {
      routes.reply('/mcq/answers', status: 503, json: {'detail': 'unavailable'});
      store.choose(q('q1'), 'b');
      await store.saveNow();

      // No error surfaced — the paper is still answerable and the candidate has
      // nothing to act on.
      expect(store.error, isNull);
      expect(store.phase, McqPhase.ready);
      expect(store.selectionFor(q('q1')), ['b']);

      // And the next save sends it again, because the whole map goes every time.
      routes.reply('/mcq/answers', json: {'ok': true});
      await store.saveNow();
      final sent = routes.bodyOf(routes.to('/mcq/answers').last)['answers'] as Map;
      expect(sent['q1'], ['b']);
    });
  });

  group('submitting', () {
    test('the final answers travel with the submit', () async {
      // No autosave has fired: the candidate answered and pressed submit at once.
      store.choose(q('q1'), 'b');
      final ok = await store.submit();

      expect(ok, isTrue);
      expect(store.phase, McqPhase.submitted);
      final sent = routes.bodyOf(routes.to('/mcq/submit').last)['answers'] as Map;
      expect(sent['q1'], ['b'], reason: 'a submit must not depend on a prior autosave');
    });

    test('a failed submit returns the candidate to their paper', () async {
      routes.reply('/mcq/submit', status: 503, json: {'detail': 'Service unavailable'});
      store.choose(q('q1'), 'b');

      final ok = await store.submit();
      expect(ok, isFalse);
      expect(store.phase, McqPhase.ready, reason: 'their answers are still on screen');
      expect(store.error, isNotNull);
      expect(store.selectionFor(q('q1')), ['b']);
    });

    test('submitting twice does not send twice', () async {
      await store.submit();
      await store.submit();
      expect(routes.to('/mcq/submit'), hasLength(1));
    });

    test('a pending autosave is cancelled by submitting', () async {
      store.choose(q('q1'), 'b');
      await store.submit();
      await Future<void>.delayed(const Duration(milliseconds: 90));
      expect(routes.to('/mcq/answers'), isEmpty,
          reason: 'a save landing after submit would be refused and is pointless');
    });
  });
}

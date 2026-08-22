// test/mcq_authoring_test.dart
//
// A recruiter's own paper, over `/api/mcq-sets`.
//
// The authoring model is the MIRROR of the candidate one: it carries the answer key,
// because the recruiter who wrote the paper is entitled to it. `mcq_contract_test.dart`
// asserts the other half — that the candidate model has nowhere for a key to land.
// Both properties are needed, and neither implies the other.
//
// What is pinned here is the round trip: what the editor sends, and what it makes of
// what comes back. A pairing is the interesting case, because the client edits it as
// rows while the server stores it as two columns and a mapping — and that translation
// is where a mis-keyed paper would come from.

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:talbotiq/core/net/api_client.dart';
import 'package:talbotiq/core/net/backend_client.dart';
import 'package:talbotiq/features/recruiter/models/mcq_set.dart';
import 'package:talbotiq/features/recruiter/store/mcq_sets_store.dart';

class _Routes extends http.BaseClient {
  final List<http.Request> seen = [];
  final Map<String, ({int status, String body})> replies = {};

  void reply(String method, String pathSuffix, {int status = 200, Object? json}) {
    replies['$method $pathSuffix'] = (
      status: status,
      body: json == null ? '' : jsonEncode(json),
    );
  }

  List<http.Request> to(String method, String pathSuffix) => seen
      .where((r) => r.method == method && r.url.path.endsWith(pathSuffix))
      .toList();

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    if (request is http.Request) seen.add(request);
    final key = replies.keys.firstWhere(
      (k) =>
          k.startsWith('${request.method} ') &&
          request.url.path.endsWith(k.substring(request.method.length + 1)),
      orElse: () => '',
    );
    final reply = key.isEmpty ? (status: 404, body: '{"detail":"no route"}') : replies[key]!;
    return http.StreamedResponse(
      Stream.value(utf8.encode(reply.body)),
      reply.status,
      request: request,
    );
  }
}

Map<String, dynamic> _storedPaper({bool ready = true, List<String> faults = const []}) => {
      'id': 'set-1',
      'name': 'Backend Screening',
      'ready': ready,
      'faults': faults,
      'sections': [
        {'id': 's1', 'name': 'Aptitude', 'instructions': 'No calculator.', 'passage': 'A train…'},
      ],
      'questions': [
        {
          'id': 'q1',
          'sectionId': 's1',
          'type': 'single',
          'text': 'Which is prime?',
          'topic': 'Numbers',
          'points': 2,
          'options': [
            {'id': 'a', 'text': '4'},
            {'id': 'b', 'text': '7'},
          ],
          'correctOptionIds': ['b'],
          'explanation': '7 has no other divisors.',
        },
        {
          'id': 'q2',
          'type': 'match',
          'text': 'Pair them',
          'prompts': [
            {'id': 'p1', 'text': '200'},
            {'id': 'p2', 'text': '404'},
          ],
          'matches': [
            {'id': 'm1', 'text': 'OK'},
            {'id': 'm2', 'text': 'Not Found'},
          ],
          'correctPairs': {'p1': 'm1', 'p2': 'm2'},
        },
      ],
    };

void main() {
  late _Routes routes;
  late McqSetsStore store;

  setUp(() {
    routes = _Routes();
    store = McqSetsStore(
      client: BackendClient(
        client: ApiClient(client: routes, maxRetries: 0),
        baseUrl: 'https://backend.test',
        tokenProvider: () async => 'test-id-token',
      ),
    );
  });

  group('the model', () {
    test('an authored paper keeps its answer key', () {
      // The recruiter wrote it. Stripping the key here would make the editor unable to
      // show which answer is marked, and re-saving would erase it.
      final paper = McqSet.fromJson(_storedPaper());
      expect(paper.questions.first.correctOptionIds, ['b']);
      expect(paper.questions.last.correctPairs, {'p1': 'm1', 'p2': 'm2'});
      expect(paper.questions.first.explanation, isNotNull);
    });

    test('a pairing is sent as rows, not as three parallel lists', () {
      // The client edits pairs as rows; the server splits them into two columns and a
      // mapping. Sending the split from here would be a second implementation of the
      // one translation that decides whether the key is right.
      final wire = McqSet.fromJson(_storedPaper()).toJson();
      final pairing = (wire['questions'] as List).last as Map<String, dynamic>;
      expect(pairing['pairs'], [
        {'promptId': 'p1', 'left': '200', 'matchId': 'm1', 'right': 'OK'},
        {'promptId': 'p2', 'left': '404', 'matchId': 'm2', 'right': 'Not Found'},
      ]);
      expect(pairing.containsKey('correctPairs'), isFalse);
      expect(pairing.containsKey('options'), isFalse);
    });

    test('readiness is never sent back', () {
      // It is the server's answer, recomputed on every read. Echoing it would invite
      // somebody to trust the client's copy.
      final wire = McqSet.fromJson(_storedPaper()).toJson();
      expect(wire.containsKey('ready'), isFalse);
      expect(wire.containsKey('faults'), isFalse);
    });

    test('a legacy section tag is read as a section id', () {
      // `section` held "technical"/"non_technical" before sections were first-class,
      // and those names ARE ids in the prebuilt library — so no migration is needed.
      final question = McqQuestionDraft.fromJson({
        'id': 'q',
        'text': 'x',
        'section': 'technical',
        'category': 'Algorithms',
      });
      expect(question.sectionId, 'technical');
      expect(question.topic, 'Algorithms');
    });

    test('an empty optional field reads as absent, not as an empty string', () {
      // The difference reaches the wire: `toJson` omits an absent field, so a blank
      // explanation does not overwrite a stored one with "".
      final question = McqQuestionDraft.fromJson({
        'id': 'q',
        'text': 'x',
        'code': '   ',
        'explanation': '',
      });
      expect(question.code, isNull);
      expect(question.explanation, isNull);
      expect(question.toJson().containsKey('code'), isFalse);
    });
  });

  group('the store', () {
    test('the list is fetched and parsed', () async {
      routes.reply('GET', '/api/mcq-sets', json: [_storedPaper()]);
      await store.refresh();
      expect(store.sets, hasLength(1));
      expect(store.sets.first.name, 'Backend Screening');
      expect(store.error, isNull);
    });

    test('a failed list is state, not an exception', () async {
      // So the page can offer a retry rather than crash on a network blip.
      routes.reply('GET', '/api/mcq-sets', status: 503, json: {'detail': 'unavailable'});
      await store.refresh();
      expect(store.error, contains('unavailable'));
      expect(store.sets, isEmpty);
    });

    test('a new paper POSTs and an existing one PUTs', () async {
      routes.reply('POST', '/api/mcq-sets', json: _storedPaper());
      routes.reply('PUT', '/api/mcq-sets/set-1', json: _storedPaper());
      routes.reply('GET', '/api/mcq-sets', json: [_storedPaper()]);

      await store.save(const McqSet(id: '', name: 'New'));
      expect(routes.to('POST', '/api/mcq-sets'), hasLength(1));

      await store.save(const McqSet(id: 'set-1', name: 'Edited'));
      expect(routes.to('PUT', '/api/mcq-sets/set-1'), hasLength(1));
    });

    test('a save reports what the server said about readiness', () async {
      routes.reply('POST', '/api/mcq-sets',
          json: _storedPaper(ready: false, faults: ['Question 1 has no correct answer marked.']));
      routes.reply('GET', '/api/mcq-sets', json: []);

      final stored = await store.save(const McqSet(id: '', name: 'Draft'));
      expect(stored.ready, isFalse);
      expect(stored.faults, hasLength(1));
    });

    test('a failed save throws rather than going quiet', () async {
      // Unlike autosave on the candidate side. This one is the recruiter pressing
      // Save, and silence would leave them believing a paper exists that does not.
      routes.reply('POST', '/api/mcq-sets', status: 400, json: {'detail': 'The set needs a name.'});
      await expectLater(
        store.save(const McqSet(id: '', name: '')),
        throwsA(isA<BackendException>()),
      );
    });

    test('deleting tolerates a 204 with no body', () async {
      // The normal success here carries nothing, so it cannot go through the JSON
      // decoder — which would turn every successful delete into an error.
      routes.reply('DELETE', '/api/mcq-sets/set-1', status: 204);
      routes.reply('GET', '/api/mcq-sets', json: []);
      await store.delete('set-1');
      expect(routes.to('DELETE', '/api/mcq-sets/set-1'), hasLength(1));
    });

    test('generation returns questions for review and reports what was dropped', () async {
      // A recruiter who asked for 20 and received 17 is entitled to know the difference
      // was thrown away for being unusable, not that the model was asked for 17.
      routes.reply('POST', '/api/mcq-sets/generate', json: {
        'questions': [(_storedPaper()['questions'] as List).first],
        'requested': 10,
        'dropped': 9,
      });
      final generated = await store.generate(
        role: 'Backend engineer',
        topics: ['HTTP'],
        style: 'technical',
        technicalCount: 10,
        nonTechnicalCount: 0,
      );
      expect(generated.questions, hasLength(1));
      expect(generated.dropped, 9);
      // Nothing was saved: generation returns, and saving is a separate act.
      expect(routes.to('POST', '/api/mcq-sets'), isEmpty);
    });

    test('topics come back as a plain list', () async {
      routes.reply('POST', '/api/mcq-sets/suggest-topics',
          json: {'role': 'Backend engineer', 'topics': ['HTTP', 'SQL']});
      expect(await store.suggestTopics('Backend engineer'), ['HTTP', 'SQL']);
    });
  });
}

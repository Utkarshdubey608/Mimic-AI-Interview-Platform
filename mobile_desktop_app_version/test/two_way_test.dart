// test/two_way_test.dart
//
// The live recruiter ↔ candidate interview.
//
// The properties worth locking down are the ones that let this track exist
// alongside the AI ones without special-casing everything downstream:
//
//   * a two-way round needs no AI script, but IS a live session;
//   * "waiting for the interviewer" is a distinct outcome from a failure, so the
//     app can poll on it instead of showing an error;
//   * the recruiter's stars become the same 0-100 score every other track
//     writes, so the leaderboard, the shortlist and advancing all just work;
//   * it is never offered to the AI retry, because with no recording there is
//     nothing to re-score.

import 'dart:convert';

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:talbotiq/core/net/api_client.dart';
import 'package:talbotiq/core/net/backend_client.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/features/interviews/services/twoway_service.dart';

class _StubHttp extends http.BaseClient {
  int status = 200;
  String body = '{}';
  final List<http.BaseRequest> requests = [];

  http.BaseRequest get last => requests.last;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add(request);
    return http.StreamedResponse(
      Stream.value(utf8.encode(body)), status, request: request);
  }
}

void main() {
  group('the round kind', () {
    test('a live round is a session, but not an AI one', () {
      // Both flags matter and they are not the same question: it IS a live
      // session the candidate joins, and it has NO script to configure.
      expect(RoundKind.twoWay.isInterview, isTrue);
      expect(RoundKind.twoWay.usesAiInterviewer, isFalse);
      expect(RoundKind.twoWay.isRecruiterScored, isTrue);
      // No AI track to launch — a human is the interviewer.
      expect(RoundKind.twoWay.interviewType, isNull);
    });

    test('the AI tracks are unchanged by its arrival', () {
      for (final k in [RoundKind.chat, RoundKind.video, RoundKind.voice]) {
        expect(k.usesAiInterviewer, isTrue, reason: '$k');
        expect(k.isRecruiterScored, isFalse, reason: '$k');
      }
      expect(RoundKind.resume.usesAiInterviewer, isFalse);
      expect(RoundKind.resume.isRecruiterScored, isFalse);
    });

    test('wire values round-trip, including the new one', () {
      for (final k in RoundKind.values) {
        expect(RoundKindX.fromWire(k.wire), k, reason: k.name);
      }
      expect(RoundKind.twoWay.wire, 'two_way');
    });

    test('an unknown kind still degrades to chat', () {
      expect(RoundKindX.fromWire('telepathy'), RoundKind.chat);
    });
  });

  group('joining the call', () {
    late _StubHttp stub;
    late TwoWayService service;

    setUp(() {
      stub = _StubHttp();
      service = TwoWayService(
        backend: BackendClient(
          client: ApiClient(client: stub, maxRetries: 0),
          baseUrl: 'https://backend.test',
          tokenProvider: () async => 'test-id-token',
        ),
      );
    });

    test('the recruiter hosts, the candidate joins — different routes', () async {
      stub.body = jsonEncode({
        'roomUrl': 'https://talbotiq.daily.co/room-int-1',
        'token': 'tok',
        'isOwner': true,
      });
      await service.host('int-1');
      expect(stub.last.url.path, '/api/interviews/int-1/twoway/host');

      await service.join('int-1');
      expect(stub.last.url.path, '/api/interviews/int-1/twoway/join');
    });

    test('"not started yet" is its own outcome, not a failure', () async {
      // This is what the waiting screen polls on. If it arrived as a generic
      // error the candidate would be shown a red screen for a normal state.
      stub.status = 409;
      stub.body = jsonEncode({
        'detail': 'Your interviewer has not started this interview yet.',
      });

      await expectLater(
        service.join('int-1'),
        throwsA(isA<TwoWayNotStarted>()),
      );
    });

    test('a CLOSED round is a hard 409, never polled on forever', () async {
      // Also a 409, but the candidate must be told rather than left waiting for
      // something that is never going to happen.
      stub.status = 409;
      stub.body = jsonEncode({'detail': 'This interview has expired.'});

      await expectLater(
        service.join('int-1'),
        throwsA(isA<BackendException>()
            .having((e) => e, 'not a wait signal', isNot(isA<TwoWayNotStarted>()))),
      );
    });

    test('the grant carries the token into the room URL', () async {
      stub.body = jsonEncode({
        'roomUrl': 'https://talbotiq.daily.co/room-int-1',
        'token': 'tok-abc',
        'isOwner': false,
      });
      final grant = await service.join('int-1');

      // Daily's prebuilt UI reads `?t=`, which is what gives the recruiter the
      // admit control and leaves the candidate knocking.
      expect(grant.joinUrl, 'https://talbotiq.daily.co/room-int-1?t=tok-abc');
      expect(grant.isOwner, isFalse);
    });

    test('a grant missing its room or token is refused', () async {
      // Better a clear error than a WebView loading about:blank.
      stub.body = jsonEncode({'roomUrl': '', 'token': 'tok'});
      await expectLater(
          service.join('int-1'), throwsA(isA<BackendException>()));
    });
  });

  group('which engine the call runs on', () {
    // The backend picks (TWOWAY_ENGINE) and the app reads the choice off the URL
    // it is handed. This is the branch that decides between the native LiveKit
    // client and the Daily WebView, and getting it wrong is not subtle: a
    // `wss://` endpoint loaded as a web page is a blank screen.
    TwoWayGrant grantFor(String roomUrl) => TwoWayGrant.fromJson({
          'roomUrl': roomUrl,
          'token': 'tok-abc',
          'isOwner': false,
        });

    test('a wss endpoint means LiveKit — the same engine the web app uses', () {
      expect(grantFor('wss://lk.talbotiq.internal').isLiveKit, isTrue);
      // ws:// too, which is what a local LiveKit server answers on.
      expect(grantFor('ws://localhost:7880').isLiveKit, isTrue);
    });

    test('a Daily room page is NOT LiveKit, and keeps the WebView path', () {
      final grant = grantFor('https://talbotiq.daily.co/room-int-1');

      expect(grant.isLiveKit, isFalse);
      expect(grant.joinUrl, 'https://talbotiq.daily.co/room-int-1?t=tok-abc');
    });

    test('LiveKit needs no token in the URL — it is inside the token', () {
      // The `?t=` trick is Daily's prebuilt UI reading its own query string.
      // LiveKit takes the token as a connect argument, so appending it to the
      // endpoint would be meaningless at best.
      final grant = grantFor('wss://lk.talbotiq.internal');
      expect(grant.roomUrl, 'wss://lk.talbotiq.internal');
      expect(grant.token, 'tok-abc');
    });
  });

  group('the recruiter scores it themselves', () {
    late FakeFirebaseFirestore db;
    late InterviewRepository repo;

    setUp(() {
      db = FakeFirebaseFirestore();
      repo = InterviewRepository(firestore: db);
    });

    Future<String> seedEndedCall() async {
      final ref = await db.collection('interviews').add({
        'recruiterId': 'rec-1',
        'testId': 't-1',
        'roundId': 'r-1',
        'roundKind': 'two_way',
        'candidateEmailLower': 'a@b.com',
        'title': 'Final panel',
        'type': 'chat',
        'status': 'completed',
        // What the backend writes when the call ends.
        'result': {
          'evaluatedBy': '',
          'evaluationError': '',
          'awaitingRecruiterReview': true,
        },
      });
      return ref.id;
    }

    Future<Interview> read(String id) async =>
        Interview.fromDoc(await db.collection('interviews').doc(id).get());

    test('an ended call awaits a review — it has NOT failed', () async {
      final i = await read(await seedEndedCall());

      expect(i.awaitingRecruiterReview, isTrue);
      // The distinction that keeps a "Scoring failed" badge off a round where
      // nothing went wrong.
      expect(i.evaluationFailed, isFalse);
      expect(i.hasScore, isFalse);
    });

    test('stars become the same 0-100 score every other track writes', () async {
      final id = await seedEndedCall();

      await repo.saveTwoWayReview(id, stars: 4, notes: 'Strong on systems.');
      final i = await read(id);

      // 4/5 → 80/100, so it ranks against AI-scored rounds with no special case
      // anywhere downstream.
      expect(i.result!['overallScore'], 80);
      expect(i.evaluatedBy, 'manual');
      expect(i.twoWayStars, 4);
      expect(i.twoWayNotes, 'Strong on systems.');
      // The review IS the score, so it is no longer awaiting one.
      expect(i.awaitingRecruiterReview, isFalse);
      expect(i.hasScore, isTrue);
    });

    test('a scored live round ranks on the leaderboard', () async {
      final id = await seedEndedCall();
      await repo.saveTwoWayReview(id, stars: 5);

      final page = await repo.fetchLeaderboardPage(
          recruiterId: 'rec-1', testId: 't-1', roundId: 'r-1');

      expect(page.items.single.id, id);
      expect(page.items.single.result!['overallScore'], 100);
    });

    test('an unscored live round is absent from the leaderboard', () async {
      await seedEndedCall();
      final page = await repo.fetchLeaderboardPage(
          recruiterId: 'rec-1', testId: 't-1', roundId: 'r-1');
      // No score means no rank — the same rule every other track follows.
      expect(page.items, isEmpty);
    });

    test('stars are clamped, so a bad call site cannot write 200/100', () async {
      final id = await seedEndedCall();
      await repo.saveTwoWayReview(id, stars: 9);
      expect((await read(id)).result!['overallScore'], 100);
    });

    test('reviewing preserves an outcome already published', () async {
      final id = await seedEndedCall();
      await repo.setOutcome(id,
          outcome: RoundOutcome.selected, rank: 1, note: 'See you Thursday');

      await repo.saveTwoWayReview(id, stars: 3, notes: 'Fine.');
      final i = await read(id);

      // Dotted-path writes, so scoring does not clobber what the candidate has
      // already been told.
      expect(i.outcome, RoundOutcome.selected);
      expect(i.candidateNote, 'See you Thursday');
      expect(i.twoWayStars, 3);
    });
  });

  group('the AI retry never touches it', () {
    late FakeFirebaseFirestore db;
    late InterviewRepository repo;

    setUp(() {
      db = FakeFirebaseFirestore();
      repo = InterviewRepository(firestore: db);
    });

    test('a live round is not retryable even with stored responses', () async {
      // No recording means no transcript, so there is nothing for a model to
      // re-read. Its route back is the recruiter's own review.
      final ref = await db.collection('interviews').add({
        'recruiterId': 'rec-1',
        'testId': 't-1',
        'roundKind': 'two_way',
        'candidateEmailLower': 'a@b.com',
        'title': 'Final panel',
        'type': 'chat',
        'status': 'completed',
        'result': {
          'evaluatedBy': '',
          'evaluationError': 'something went wrong',
          'responses': [
            {'question': 'Q', 'answer': 'A'}
          ],
        },
      });

      final i = Interview.fromDoc(await db.collection('interviews').doc(ref.id).get());
      expect(i.canRetryEvaluation, isFalse);

      final retryable = await repo.fetchRetryableEvaluations(
          recruiterId: 'rec-1', testId: 't-1');
      expect(retryable, isEmpty);
    });

    test('an AI round in the same state IS retryable', () async {
      // The control: proves the exclusion above is about the KIND, not about
      // some other field being wrong.
      await db.collection('interviews').add({
        'recruiterId': 'rec-1',
        'testId': 't-1',
        'roundKind': 'chat',
        'candidateEmailLower': 'b@b.com',
        'title': 'Tech round',
        'type': 'chat',
        'status': 'completed',
        'result': {
          'evaluatedBy': '',
          'evaluationError': 'timed out',
          'responses': [
            {'question': 'Q', 'answer': 'A'}
          ],
        },
      });

      final retryable = await repo.fetchRetryableEvaluations(
          recruiterId: 'rec-1', testId: 't-1');
      expect(retryable.length, 1);
    });
  });

  group('a single-round test can be a live interview', () {
    // REGRESSION: single-round mode used an InterviewType toggle, and two-way is
    // not an InterviewType — so "Live" could not be offered there at all. The
    // toggle is now kind-based, which only works if the kind is PERSISTED:
    // without `roundKind` the document carries `type: chat`, effectiveRoundKind
    // falls back to it, and the candidate is routed into a chat interview with
    // no questions.
    Interview singleRound({RoundKind? roundKind}) => Interview(
          id: 'i-1',
          testId: 't-1',
          recruiterId: 'rec-1',
          recruiterEmail: 'rec@co.com',
          candidateEmail: 'a@b.com',
          candidateEmailLower: 'a@b.com',
          // What the form writes for a live round: the harmless default, because
          // `type` cannot say "two-way".
          type: InterviewType.chat,
          roundKind: roundKind,
          title: 'Final panel',
          prompt: '',
          questions: const [],
          avatar: const AvatarConfig(replicaId: ''),
          durationMinutes: 30,
          status: InterviewStatus.assigned,
        );

    test('the kind is what routes the candidate, not the type', () {
      final live = singleRound(roundKind: RoundKind.twoWay);
      expect(live.effectiveRoundKind, RoundKind.twoWay);
      // Not chat — which is what it would be if the kind were not written.
      expect(live.type, InterviewType.chat);
    });

    test('without the kind it would fall back to a chat interview', () {
      // The failure mode the write guards against, asserted so it cannot creep
      // back in silently.
      expect(singleRound().effectiveRoundKind, RoundKind.chat);
    });

    test('a live single-round test carries no round id and still works', () {
      // Single-round tests have no timeline, so `roundId` is empty — the kind has
      // to stand on its own.
      final live = singleRound(roundKind: RoundKind.twoWay);
      expect(live.hasRound, isFalse);
      expect(live.effectiveRoundKind.isRecruiterScored, isTrue);
      expect(live.effectiveRoundKind.usesAiInterviewer, isFalse);
    });

    test('the kind survives a Firestore round trip', () async {
      final db = FakeFirebaseFirestore();
      final repo = InterviewRepository(firestore: db);
      final id = await repo.create(singleRound(roundKind: RoundKind.twoWay));

      final read = Interview.fromDoc(
          await db.collection('interviews').doc(id).get());
      expect(read.roundKind, RoundKind.twoWay);
      expect(read.effectiveRoundKind, RoundKind.twoWay);
    });

    test('an AI single-round test still writes no kind at all', () async {
      // Backward compatibility: a chat/video/voice test must keep producing the
      // same document it always did.
      final db = FakeFirebaseFirestore();
      final repo = InterviewRepository(firestore: db);
      final id = await repo.create(singleRound());

      final raw = (await db.collection('interviews').doc(id).get()).data()!;
      expect(raw.containsKey('roundKind'), isFalse);
    });
  });
}

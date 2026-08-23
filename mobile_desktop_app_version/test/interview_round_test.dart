// test/interview_round_test.dart
//
// Step 1 of custom timelines: the `tests/{testId}/rounds` layer.
//
// Two things here are worth locking down with tests rather than eyeballing:
//
//   1. ROUND STATE IS DERIVED, not stored. `stateAt` is the single definition of
//      scheduled/open/closed for both the recruiter UI and the candidate gate, so
//      every branch of it is covered — including the one that matters most,
//      "closedAt wins over a closesAt still in the future" (that IS "end round
//      now").
//   2. BACKWARD COMPATIBILITY. Interviews created before rounds existed carry no
//      roundId/roundOrder/roundKind. They must keep working as the single
//      implicit round of a one-round test, and must not start writing those
//      fields — otherwise "no migration needed" is not true.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/models/test_summary.dart';
import 'package:talbotiq/features/interviews/recruiter/round_notify_page.dart';
import 'package:talbotiq/features/interviews/recruiter/round_timeline_page.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';

void main() {
  const recruiter = 'rec-1';
  const testId = 'test-1';

  InterviewRound round({
    String id = 'r1',
    int order = 0,
    RoundKind kind = RoundKind.chat,
    DateTime? opensAt,
    DateTime? closesAt,
    DateTime? closedAt,
    RoundClosedBy? closedBy,
    Map<String, dynamic> config = const {},
  }) =>
      InterviewRound(
        id: id,
        testId: testId,
        recruiterId: recruiter,
        order: order,
        title: 'Round ${order + 1}',
        kind: kind,
        config: config,
        opensAt: opensAt,
        closesAt: closesAt,
        closedAt: closedAt,
        closedBy: closedBy,
      );

  group('round state is derived from the clock', () {
    final now = DateTime.utc(2026, 8, 10, 12);
    final past = now.subtract(const Duration(days: 1));
    final future = now.add(const Duration(days: 1));

    test('no window at all → open until ended by hand', () {
      expect(round().stateAt(now), RoundState.open);
    });

    test('before opensAt → scheduled', () {
      expect(round(opensAt: future).stateAt(now), RoundState.scheduled);
    });

    test('inside the window → open', () {
      expect(
        round(opensAt: past, closesAt: future).stateAt(now),
        RoundState.open,
      );
    });

    test('past closesAt → closed without anyone writing anything', () {
      expect(round(closesAt: past).stateAt(now), RoundState.closed);
    });

    test('closedAt wins over a closesAt still in the future', () {
      // "End round now" on a round scheduled to run another day.
      final r = round(closesAt: future, closedAt: now, closedBy: RoundClosedBy.manual);
      expect(r.stateAt(now), RoundState.closed);
      expect(r.wasEndedManually, isTrue);
    });

    test('willAutoClose only when a future deadline is still pending', () {
      // Unlike stateAt(now), willAutoClose reads the real wall clock (it
      // drives a live "closes in 2d" UI hint, not a point-in-time query), so
      // its future/past must be relative to DateTime.now() — not the fixed
      // `now` above, which this suite's other cases inject explicitly into
      // stateAt() and so never actually elapses.
      final realFuture = DateTime.now().add(const Duration(days: 1));
      final realPast = DateTime.now().subtract(const Duration(days: 1));
      expect(round(closesAt: realFuture).willAutoClose, isTrue);
      expect(round(closesAt: realPast).willAutoClose, isFalse);
      expect(round().willAutoClose, isFalse);
      expect(
          round(closesAt: realFuture, closedAt: now).willAutoClose, isFalse);
    });
  });

  group('what the recruiter reads off the status chip', () {
    final now = DateTime.utc(2026, 8, 10, 12);

    test('an open round says how long is left', () {
      expect(
        roundStateLabel(
            round(closesAt: now.add(const Duration(days: 3, hours: 5))), now),
        'Open · closes in 3d',
      );
      expect(
        roundStateLabel(round(closesAt: now.add(const Duration(hours: 5))), now),
        'Open · closes in 5h',
      );
    });

    test('an open-ended round just says Open', () {
      expect(roundStateLabel(round(), now), 'Open');
    });

    test('a scheduled round counts down to opening', () {
      expect(
        roundStateLabel(round(opensAt: now.add(const Duration(days: 2))), now),
        'Opens in 2d',
      );
    });

    test('a manual end is distinguished from a deadline passing', () {
      expect(
        roundStateLabel(
          round(
              closesAt: now.add(const Duration(days: 5)),
              closedAt: now,
              closedBy: RoundClosedBy.manual),
          now,
        ),
        'Ended by you',
      );
      expect(
        roundStateLabel(
            round(closesAt: now.subtract(const Duration(minutes: 1))), now),
        'Closed',
      );
    });

    test('the label describes the instant it renders for, not the real clock',
        () {
      // Same round read at two moments: open with time left, then closed. A row
      // that consulted DateTime.now() internally could not produce both.
      final r = round(closesAt: now.add(const Duration(hours: 2)));
      expect(roundStateLabel(r, now), 'Open · closes in 2h');
      expect(roundStateLabel(r, now.add(const Duration(hours: 3))), 'Closed');
    });

    test('durations round down, so a chip never overstates the time left', () {
      expect(formatDurationShort(const Duration(hours: 47)), '1d');
      expect(formatDurationShort(const Duration(minutes: 59)), '59m');
      expect(formatDurationShort(const Duration(seconds: 30)), '<1m');
      expect(formatDurationShort(const Duration(seconds: -30)), '<1m');
    });
  });

  group('who gets pre-ticked for the shortlist email', () {
    // This decides whose name is pre-selected on a screen that sends rejection
    // emails, so every branch is covered — an off-by-one here is a real person
    // wrongly told they did not get through.
    Interview scored(String email, int? score) => Interview(
          id: 'i-$email',
          testId: testId,
          recruiterId: recruiter,
          recruiterEmail: 'rec@co.com',
          candidateEmail: email,
          candidateEmailLower: email,
          type: InterviewType.chat,
          title: 'T',
          prompt: '',
          questions: const [],
          avatar: const AvatarConfig(replicaId: ''),
          durationMinutes: 15,
          status: InterviewStatus.completed,
          result: score == null ? null : {'overallScore': score},
        );

    // Best first, as the leaderboard returns them.
    final ranked = [
      scored('a@b.com', 90),
      scored('b@b.com', 75),
      scored('c@b.com', 60),
      scored('d@b.com', 30),
    ];

    InterviewRound withAdvance(AdvanceMode mode, num? value) =>
        round().copyWith(advance: RoundAdvance(mode: mode, value: value));

    test('manual pre-selects nobody', () {
      expect(shortlistFor(withAdvance(AdvanceMode.manual, null), ranked),
          isEmpty);
      // Even with a stale value left over from switching modes.
      expect(shortlistFor(withAdvance(AdvanceMode.manual, 3), ranked), isEmpty);
    });

    test('topN takes the first N', () {
      expect(
        shortlistFor(withAdvance(AdvanceMode.topN, 2), ranked)
            .map((i) => i.candidateEmailLower),
        ['a@b.com', 'b@b.com'],
      );
    });

    test('topN larger than the field selects everyone, not an error', () {
      expect(shortlistFor(withAdvance(AdvanceMode.topN, 99), ranked).length, 4);
    });

    test('a topN of zero or null selects nobody', () {
      expect(shortlistFor(withAdvance(AdvanceMode.topN, 0), ranked), isEmpty);
      expect(shortlistFor(withAdvance(AdvanceMode.topN, null), ranked), isEmpty);
    });

    test('threshold is inclusive of the bar', () {
      expect(
        shortlistFor(withAdvance(AdvanceMode.threshold, 60), ranked)
            .map((i) => i.candidateEmailLower),
        ['a@b.com', 'b@b.com', 'c@b.com'],
        reason: 'a candidate who scored exactly the bar has met it',
      );
    });

    test('threshold with no bar selects nobody rather than everybody', () {
      // Guarding on null instead of defaulting to 0: a missing bar must not
      // silently shortlist the entire round.
      expect(shortlistFor(withAdvance(AdvanceMode.threshold, null), ranked),
          isEmpty);
    });

    test('an unscored candidate never clears a threshold', () {
      final withUnscored = [...ranked, scored('e@b.com', null)];
      final picked = shortlistFor(
          withAdvance(AdvanceMode.threshold, 0), withUnscored);
      expect(picked.map((i) => i.candidateEmailLower),
          isNot(contains('e@b.com')));
    });
  });

  test('a rebuilt test summary keeps the pipeline title, not its round title',
      () {
    final assignment = Interview(
      id: 'assignment-1',
      testId: testId,
      roundId: 'round-2',
      recruiterId: recruiter,
      recruiterEmail: 'rec@co.com',
      candidateEmail: 'candidate@co.com',
      candidateEmailLower: 'candidate@co.com',
      type: InterviewType.voice,
      title: 'Final voice round',
      testTitle: 'Staff engineer hiring',
      prompt: '',
      questions: const [],
      avatar: const AvatarConfig(replicaId: ''),
      durationMinutes: 15,
      status: InterviewStatus.assigned,
    );

    final summary = TestSummary.fromInterview(assignment);

    expect(summary.title, 'Staff engineer hiring');
    expect(summary.titleVersion, TestSummary.titleSchemaVersion);
  });

  group('round kind', () {
    test('a résumé round has no interview track to launch', () {
      expect(RoundKind.resume.interviewType, isNull);
      expect(RoundKind.resume.isInterview, isFalse);
    });

    test('the other kinds map onto the interview types', () {
      expect(RoundKind.video.interviewType, InterviewType.video);
      expect(RoundKind.chat.interviewType, InterviewType.chat);
      expect(RoundKind.voice.interviewType, InterviewType.voice);
    });

    test('wire values round-trip', () {
      for (final k in RoundKind.values) {
        expect(RoundKindX.fromWire(k.wire), k);
      }
    });
  });

  group('assignTo copies the round onto a candidate', () {
    test('window comes from the round, not from new fields', () {
      final opens = DateTime.utc(2026, 8, 11);
      final closes = DateTime.utc(2026, 8, 18);
      final i = round(opensAt: opens, closesAt: closes, order: 2).assignTo(
        candidateEmail: '  Asha@Example.COM ',
        recruiterEmail: 'rec@co.com',
        testTitle: 'Backend Engineer',
      );

      expect(i.availableFrom, opens);
      expect(i.expiresAt, closes);
      expect(i.roundId, 'r1');
      expect(i.roundOrder, 2);
      expect(i.candidateEmailLower, 'asha@example.com');
      expect(i.status, InterviewStatus.assigned);
    });

    test('a résumé round assigns as a résumé-collecting assignment', () {
      final i = round(kind: RoundKind.resume).assignTo(
        candidateEmail: 'a@b.com',
        recruiterEmail: 'rec@co.com',
        testTitle: 'Backend Engineer',
      );

      expect(i.roundKind, RoundKind.resume);
      expect(i.collectResume, isTrue);
      // `type` cannot express "résumé", so it holds the harmless default and
      // routing switches on roundKind instead.
      expect(i.effectiveRoundKind, RoundKind.resume);
    });

    test('config is read out at assignment, so later round edits do not leak', () {
      final r = round(config: {
        'prompt': 'Ask about Dart.',
        'questions': ['Why Flutter?'],
        'durationMinutes': 30,
        'maxAttempts': 2,
      });
      final i = r.assignTo(
        candidateEmail: 'a@b.com',
        recruiterEmail: 'rec@co.com',
        testTitle: 'T',
      );

      expect(i.prompt, 'Ask about Dart.');
      expect(i.questions, ['Why Flutter?']);
      expect(i.durationMinutes, 30);
      expect(i.maxAttempts, 2);

      // Mutating the round's config map afterwards must not reach the
      // already-built assignment.
      r.config['prompt'] = 'Ask about Go.';
      expect(i.prompt, 'Ask about Dart.');
    });
  });

  group('shared delivery config merged under a round\'s own content', () {
    // How the multi-round create form composes each round: the test's shared
    // delivery settings first, the round's own content on top. Asserted here
    // because getting the precedence backwards is invisible until a candidate
    // gets round 1's questions in round 3.
    const shared = {
      'language': 'Spanish',
      'avatar': {'replicaId': 'rep-1', 'personaId': 'per-1'},
      'maxAttempts': 2,
      'integrity': {'detectTabSwitch': true},
      'prompt': 'SHARED PROMPT',
      'durationMinutes': 15,
    };

    test('the round wins on content, shared wins on delivery', () {
      final roundOwn = {
        'prompt': 'Round 2 brief',
        'questions': ['Round 2 question'],
        'durationMinutes': 45,
      };
      final merged = {...shared, ...roundOwn};

      final i = round(order: 1, kind: RoundKind.video, config: merged).assignTo(
        candidateEmail: 'a@b.com',
        recruiterEmail: 'rec@co.com',
        testTitle: 'Backend Engineer',
      );

      // Content: the round's.
      expect(i.prompt, 'Round 2 brief');
      expect(i.questions, ['Round 2 question']);
      expect(i.durationMinutes, 45);
      // Delivery: the test's, without the round having to restate it.
      expect(i.language, 'Spanish');
      expect(i.avatar.replicaId, 'rep-1');
      expect(i.avatar.personaId, 'per-1');
      expect(i.maxAttempts, 2);
      expect(i.integrity?['detectTabSwitch'], isTrue);
    });

    test('a résumé round inherits none of the delivery config', () {
      // It has no session to deliver, so carrying an avatar would be noise on
      // the document and a lie on the screen.
      final i = round(kind: RoundKind.resume, config: const {}).assignTo(
        candidateEmail: 'a@b.com',
        recruiterEmail: 'rec@co.com',
        testTitle: 'Backend Engineer',
      );

      expect(i.avatar.replicaId, '');
      expect(i.questions, isEmpty);
      expect(i.collectResume, isTrue);
      expect(i.roundKind, RoundKind.resume);
    });

    test('two rounds off one shared config keep separate questions', () {
      final r1 = round(order: 0, kind: RoundKind.chat, config: {
        ...shared,
        'questions': ['Q for round 1'],
      });
      final r2 = round(id: 'r2', order: 1, kind: RoundKind.chat, config: {
        ...shared,
        'questions': ['Q for round 2'],
      });

      final a = r1.assignTo(
          candidateEmail: 'a@b.com',
          recruiterEmail: 'r@co.com',
          testTitle: 'T');
      final b = r2.assignTo(
          candidateEmail: 'a@b.com',
          recruiterEmail: 'r@co.com',
          testTitle: 'T');

      expect(a.questions, ['Q for round 1']);
      expect(b.questions, ['Q for round 2']);
      // Same interviewer either way.
      expect(a.avatar.replicaId, b.avatar.replicaId);
      expect(a.language, b.language);
    });
  });

  group('a round\'s config survives being edited', () {
    // The configuration screen hydrates a round by going through
    // `assignTo` and saves by writing a config map back. If those two disagree
    // about a key, the field silently resets every time the round is reopened —
    // which is invisible until a recruiter loses work. This asserts the seam.
    test('every content key round-trips through assignTo', () {
      final original = round(
        order: 2,
        kind: RoundKind.video,
        config: {
          'prompt': 'Probe distributed systems.',
          'questions': ['Q1', 'Q2', 'Q3'],
          'adaptive': false,
          'collectResume': true,
          'language': 'Spanish',
          'durationMinutes': 45,
          'maxAttempts': 3,
          'avatar': {'replicaId': 'rep-9', 'personaId': 'per-9'},
        },
      );

      // Hydrate (what the form does when it opens).
      final hydrated = original.assignTo(
        candidateEmail: '',
        recruiterEmail: '',
        testTitle: original.title,
      );
      // Save (what the form does when it writes back).
      final saved = InterviewRound.configFromInterview(hydrated);

      expect(saved['prompt'], 'Probe distributed systems.');
      expect(saved['questions'], ['Q1', 'Q2', 'Q3']);
      expect(saved['collectResume'], isTrue);
      expect(saved['language'], 'Spanish');
      expect(saved['durationMinutes'], 45);
      expect(saved['maxAttempts'], 3);
      expect((saved['avatar'] as Map)['replicaId'], 'rep-9');
      expect((saved['avatar'] as Map)['personaId'], 'per-9');
    });

    test('reopening a round twice does not drift', () {
      final config = {
        'prompt': 'Stay on architecture.',
        'questions': ['Only question'],
        'language': 'French',
        'durationMinutes': 20,
        'avatar': {'replicaId': 'rep-1'},
      };
      var current = round(kind: RoundKind.chat, config: config);

      // Three open-and-save cycles. Anything the hydrator drops would erode.
      for (var i = 0; i < 3; i++) {
        final asInterview = current.assignTo(
            candidateEmail: '', recruiterEmail: '', testTitle: current.title);
        current = current.copyWith(
            config: InterviewRound.configFromInterview(asInterview));
      }

      expect(current.config['prompt'], 'Stay on architecture.');
      expect(current.config['questions'], ['Only question']);
      expect(current.config['language'], 'French');
      expect(current.config['durationMinutes'], 20);
      expect((current.config['avatar'] as Map)['replicaId'], 'rep-1');
    });
  });

  group('pre-timeline interviews keep working', () {
    late FakeFirebaseFirestore db;

    setUp(() => db = FakeFirebaseFirestore());

    test('a document with no round fields reads as the single implicit round',
        () async {
      await db.collection('interviews').doc('old-1').set({
        'recruiterId': recruiter,
        'testId': testId,
        'candidateEmail': 'a@b.com',
        'candidateEmailLower': 'a@b.com',
        'title': 'Legacy',
        'type': 'video',
        'status': 'assigned',
      });

      final i = Interview.fromDoc(await db.collection('interviews').doc('old-1').get());

      expect(i.hasRound, isFalse);
      expect(i.roundId, '');
      expect(i.roundOrder, isNull);
      expect(i.roundKind, isNull);
      // Derived, so grouping and routing never have to special-case null.
      expect(i.effectiveRoundOrder, 0);
      expect(i.effectiveRoundKind, RoundKind.video);
    });

    test('creating a non-timeline interview writes no round fields', () {
      final map = Interview(
        id: '',
        testId: testId,
        recruiterId: recruiter,
        recruiterEmail: 'rec@co.com',
        candidateEmail: 'a@b.com',
        candidateEmailLower: 'a@b.com',
        type: InterviewType.chat,
        title: 'T',
        prompt: '',
        questions: const [],
        avatar: const AvatarConfig(replicaId: ''),
        durationMinutes: 15,
        status: InterviewStatus.assigned,
      ).toCreateMap();

      expect(map.containsKey('roundId'), isFalse);
      expect(map.containsKey('roundOrder'), isFalse);
      expect(map.containsKey('roundKind'), isFalse);
    });

    test('an edit never moves an assignment between rounds', () {
      final map = round(order: 3)
          .assignTo(
            candidateEmail: 'a@b.com',
            recruiterEmail: 'rec@co.com',
            testTitle: 'T',
          )
          .toUpdateMap();

      expect(map.containsKey('roundId'), isFalse);
      expect(map.containsKey('roundOrder'), isFalse);
      expect(map.containsKey('testId'), isFalse);
    });
  });

  group('repository', () {
    late FakeFirebaseFirestore db;
    late InterviewRepository repo;

    setUp(() {
      db = FakeFirebaseFirestore();
      repo = InterviewRepository(firestore: db);
    });

    Future<String> seedAssignment({
      required String roundId,
      int roundOrder = 0,
      String status = 'assigned',
      DateTime? expiresAt,
    }) async {
      final ref = await db.collection('interviews').add({
        'recruiterId': recruiter,
        'testId': testId,
        'roundId': roundId,
        'roundOrder': roundOrder,
        'candidateEmail': 'a@b.com',
        'candidateEmailLower': 'a@b.com',
        'title': 'T',
        'type': 'chat',
        'status': status,
        'createdAt': Timestamp.now(),
        if (expiresAt != null) 'expiresAt': Timestamp.fromDate(expiresAt),
      });
      return ref.id;
    }

    test('rounds are listed in timeline order, not creation order', () async {
      await repo.createRound(round(id: 'x', order: 2, kind: RoundKind.video));
      await repo.createRound(round(id: 'y', order: 0, kind: RoundKind.resume));
      await repo.createRound(round(id: 'z', order: 1, kind: RoundKind.chat));

      final rounds = await repo.fetchRounds(testId: testId, recruiterId: recruiter);

      expect(rounds.map((r) => r.order), [0, 1, 2]);
      expect(rounds.map((r) => r.kind),
          [RoundKind.resume, RoundKind.chat, RoundKind.video]);
      // testId is recoverable even though rounds live in a subcollection.
      expect(rounds.every((r) => r.testId == testId), isTrue);
    });

    test('listing rounds filters on recruiterId, which rules depend on',
        () async {
      // REGRESSION: watchRounds ordered by `order` with no recruiterId equality.
      // firestore.rules grants round reads via `resource.data.recruiterId ==
      // uid`, and a LIST query has to be provable from its own constraints —
      // Firestore will not read documents to find out whether the rule would
      // have allowed them. The live app got PERMISSION_DENIED on every timeline.
      //
      // SCOPE NOTE: fake_cloud_firestore enforces no rules, so this test CANNOT
      // reproduce the denial — it passed before the fix. What it does is pin the
      // `where` clause in place by making it observable as a data filter, so
      // removing it fails here instead of only in production.
      await repo.createRound(round(id: 'mine', order: 0));
      await db
          .collection('tests')
          .doc(testId)
          .collection('rounds')
          .add({
        'testId': testId,
        'recruiterId': 'someone-else',
        'order': 1,
        'title': 'Not mine',
        'kind': 'chat',
      });

      final rounds =
          await repo.fetchRounds(testId: testId, recruiterId: recruiter);

      expect(rounds.length, 1);
      expect(rounds.single.recruiterId, recruiter);
      expect(rounds.single.title, isNot('Not mine'));
    });

    test('a blank recruiterId lists nothing rather than everything', () async {
      await repo.createRound(round(id: 'r1'));
      expect(await repo.fetchRounds(testId: testId, recruiterId: ''), isEmpty);
      expect(
        await repo.watchRounds(testId: testId, recruiterId: '').first,
        isEmpty,
      );
    });

    test('adopting pre-timeline candidates does not duplicate them', () async {
      // THE BUG THIS FIXES: assign a single-round test, then add a round. The
      // original assignment carries no roundId, so assignCandidatesToRound
      // cannot recognise its owner and creates a SECOND document — the candidate
      // sees the same test twice, both launchable.
      final legacy = await db.collection('interviews').add({
        'recruiterId': recruiter,
        'testId': testId,
        'candidateEmail': 'Asha@B.com',
        'candidateEmailLower': 'asha@b.com',
        'candidateName': 'Asha',
        'title': 'Backend Engineer',
        'type': 'video',
        'status': 'completed',
        // Already took it — this is why adoption edits in place instead of
        // deleting and recreating.
        'result': {'overallScore': 82},
        'createdAt': Timestamp.now(),
      });

      final closes = DateTime.utc(2026, 9, 1);
      final rid = await repo.createRound(
          round(id: 'r1', kind: RoundKind.video, closesAt: closes));
      final r = (await repo.getRound(testId, rid))!;

      expect(
        await repo.countLegacyAssignments(
            testId: testId, recruiterId: recruiter),
        1,
      );

      final moved = await repo.adoptLegacyAssignments(r);
      expect(moved, 1);

      // Still ONE document for this candidate, now inside the round.
      final all = await repo.fetchRecruiterPage(
          recruiterId: recruiter, testId: testId);
      expect(all.items.length, 1, reason: 'adoption must not create a copy');

      final adopted = Interview.fromDoc(
          await db.collection('interviews').doc(legacy.id).get());
      expect(adopted.roundId, rid);
      expect(adopted.roundOrder, 0);
      expect(adopted.roundKind, RoundKind.video);
      // Their completed interview survived.
      expect(adopted.result?['overallScore'], 82);
      expect(adopted.status, InterviewStatus.completed);
      // And they are now governed by the round's window.
      expect(adopted.expiresAt!.isAtSameMomentAs(closes), isTrue);

      // Nothing left to adopt, so pressing again is a no-op.
      expect(
        await repo.countLegacyAssignments(
            testId: testId, recruiterId: recruiter),
        0,
      );
      expect(await repo.adoptLegacyAssignments(r), 0);
    });

    test('adoption leaves other rounds and other recruiters alone', () async {
      final r1 = await repo.createRound(round(id: 'r1', order: 0));
      // Already in a round — not legacy.
      await db.collection('interviews').add({
        'recruiterId': recruiter,
        'testId': testId,
        'roundId': r1,
        'candidateEmailLower': 'inround@b.com',
        'title': 'T',
        'type': 'chat',
        'status': 'assigned',
      });
      // Another recruiter's round-less assignment on the same testId.
      await db.collection('interviews').add({
        'recruiterId': 'someone-else',
        'testId': testId,
        'candidateEmailLower': 'theirs@b.com',
        'title': 'T',
        'type': 'chat',
        'status': 'assigned',
      });

      expect(
        await repo.countLegacyAssignments(
            testId: testId, recruiterId: recruiter),
        0,
        reason: 'neither an in-round nor another recruiter\'s doc is legacy',
      );
    });

    test('endRound closes the round AND locks its candidates out', () async {
      // The round is scheduled to run for another week.
      final closes = DateTime.now().add(const Duration(days: 7));
      final id = await repo.createRound(round(id: 'r1', closesAt: closes));
      final r = (await repo.getRound(testId, id))!;

      final live = await seedAssignment(roundId: id, expiresAt: closes);
      final done = await seedAssignment(
          roundId: id, status: 'completed', expiresAt: closes);

      await repo.endRound(r);

      final after = (await repo.getRound(testId, id))!;
      expect(after.closedAt, isNotNull);
      expect(after.wasEndedManually, isTrue);
      expect(after.isClosed, isTrue);

      // Writing closedAt alone would not have stopped the candidate: their
      // device only ever checks their own expiresAt.
      final liveDoc = await db.collection('interviews').doc(live).get();
      final newExpiry = (liveDoc.data()!['expiresAt'] as Timestamp).toDate();
      expect(newExpiry.isBefore(closes), isTrue,
          reason: 'expiresAt must be pulled back to the moment of closure');
      expect(Interview.fromDoc(liveDoc).isExpired, isTrue);

      // A finished interview is left alone — nothing to lock out, and at scale
      // those are most of the writes.
      final doneDoc = await db.collection('interviews').doc(done).get();
      expect(
        (doneDoc.data()!['expiresAt'] as Timestamp).toDate().isAtSameMomentAs(closes),
        isTrue,
      );
    });

    test('moving a round deadline pushes it onto assigned candidates', () async {
      final id = await repo.createRound(round(id: 'r1'));
      final assignment = await seedAssignment(roundId: id);

      final extended = DateTime.utc(2026, 9, 1);
      await repo.updateRound((await repo.getRound(testId, id))!
          .copyWith(closesAt: extended, title: 'Renamed'));

      final doc = await db.collection('interviews').doc(assignment).get();
      // `Timestamp.toDate()` hands back a LOCAL DateTime, so compare instants —
      // `==` on DateTime also compares the timezone flag.
      expect(
        (doc.data()!['expiresAt'] as Timestamp).toDate().isAtSameMomentAs(extended),
        isTrue,
      );
    });

    test('deleting a round removes its assignments, not the whole test',
        () async {
      final r1 = await repo.createRound(round(id: 'r1', order: 0));
      final r2 = await repo.createRound(round(id: 'r2', order: 1));
      await seedAssignment(roundId: r1);
      await seedAssignment(roundId: r1);
      final survivor = await seedAssignment(roundId: r2, roundOrder: 1);

      final removed = await repo.deleteRound((await repo.getRound(testId, r1))!);

      expect(removed, 2);
      expect((await repo.getRound(testId, r1)), isNull);
      expect((await repo.fetchRounds(testId: testId, recruiterId: recruiter)).length, 1);
      expect((await db.collection('interviews').doc(survivor).get()).exists,
          isTrue);
    });

    test('reordering rewrites the candidates’ copy of the order', () async {
      final r1 = await repo.createRound(round(id: 'r1', order: 0));
      final r2 = await repo.createRound(round(id: 'r2', order: 1));
      final inFirst = await seedAssignment(roundId: r1, roundOrder: 0);
      final inSecond = await seedAssignment(roundId: r2, roundOrder: 1);

      // Swap them.
      await repo.reorderRounds(
        testId: testId,
        recruiterId: recruiter,
        orderedRoundIds: [r2, r1],
      );

      final rounds = await repo.fetchRounds(testId: testId, recruiterId: recruiter);
      expect(rounds.map((r) => r.id), [r2, r1]);

      // The denormalised copy is what the candidate's device shows, so it has to
      // move too — a copy that is never refreshed is worse than no copy.
      final a = await db.collection('interviews').doc(inFirst).get();
      final b = await db.collection('interviews').doc(inSecond).get();
      expect(a.data()!['roundOrder'], 1);
      expect(b.data()!['roundOrder'], 0);
    });

    test('a gap in the order does not collide a newly added round', () async {
      // Reproduces what "delete the middle round, then add one" leaves behind.
      await repo.createRound(round(id: 'a', order: 0));
      await repo.createRound(round(id: 'c', order: 2));
      final existing = await repo.fetchRounds(testId: testId, recruiterId: recruiter);

      final next = existing.isEmpty
          ? 0
          : existing.map((r) => r.order).reduce((a, b) => a > b ? a : b) + 1;
      expect(next, 3, reason: 'a length-based value would be 2 and collide');

      await repo.createRound(round(id: 'd', order: next, kind: RoundKind.video));
      final after = await repo.fetchRounds(testId: testId, recruiterId: recruiter);
      expect(after.map((r) => r.order), [0, 2, 3]);
      expect(after.last.kind, RoundKind.video);
    });

    test('assigning candidates to a round skips whoever is already in it',
        () async {
      final id = await repo.createRound(round(id: 'r1'));
      final r = (await repo.getRound(testId, id))!;

      // Someone already took this round.
      await db.collection('interviews').add({
        'recruiterId': recruiter,
        'testId': testId,
        'roundId': id,
        'candidateEmail': 'taken@b.com',
        'candidateEmailLower': 'taken@b.com',
        'status': 'completed',
        'result': {'overallScore': 91},
        'type': 'chat',
        'title': 'T',
      });

      final added = await repo.assignCandidatesToRound(
        round: r,
        recruiterEmail: 'rec@co.com',
        testTitle: 'Backend Engineer',
        candidates: {'taken@b.com': 'Taken', 'fresh@b.com': 'Fresh'},
      );

      expect(added, 1, reason: 'only the new candidate is assigned');
      expect(
        await repo.countForRecruiter(
            recruiterId: recruiter, testId: testId, roundId: id),
        2,
      );

      // The completed candidate's result survived — re-assigning must never
      // reset someone who already took the round.
      final existing = await repo.fetchRecruiterPage(
          recruiterId: recruiter, testId: testId, roundId: id);
      final taken = existing.items
          .firstWhere((i) => i.candidateEmailLower == 'taken@b.com');
      expect(taken.result?['overallScore'], 91);
      expect(taken.status, InterviewStatus.completed);
    });

    test('fetchTestCandidates dedupes across rounds and keeps names', () async {
      final r1 = await repo.createRound(round(id: 'r1', order: 0));
      final r2 = await repo.createRound(round(id: 'r2', order: 1));

      // Same person in both rounds; the later assignment has no name.
      for (final (rid, name) in [(r1, 'Asha R'), (r2, null)]) {
        await db.collection('interviews').add({
          'recruiterId': recruiter,
          'testId': testId,
          'roundId': rid,
          'candidateEmail': 'asha@b.com',
          'candidateEmailLower': 'asha@b.com',
          if (name != null) 'candidateName': name,
          'type': 'chat',
          'title': 'T',
          'status': 'assigned',
        });
      }
      await db.collection('interviews').add({
        'recruiterId': recruiter,
        'testId': testId,
        'roundId': r1,
        'candidateEmail': 'bo@b.com',
        'candidateEmailLower': 'bo@b.com',
        'type': 'chat',
        'title': 'T',
        'status': 'assigned',
      });

      final found = await repo.fetchTestCandidates(
          testId: testId, recruiterId: recruiter);

      expect(found.length, 2);
      // A nameless later round must not blank out a name an earlier one has.
      expect(found['asha@b.com'], 'Asha R');
      expect(found['bo@b.com'], isNull);
    });

    test('the leaderboard ranks by score and omits the unscored', () async {
      final rid = await repo.createRound(round(id: 'r1'));

      Future<void> seedScored(String email, int? score) =>
          db.collection('interviews').add({
            'recruiterId': recruiter,
            'testId': testId,
            'roundId': rid,
            'candidateEmail': email,
            'candidateEmailLower': email,
            'title': 'T',
            'type': 'chat',
            'status': score == null ? 'assigned' : 'completed',
            if (score != null) 'result': {'overallScore': score},
          });

      await seedScored('mid@b.com', 55);
      await seedScored('top@b.com', 91);
      await seedScored('low@b.com', 12);
      await seedScored('nothing@b.com', null);
      // A result map with a null score: real Firestore WOULD rank this one
      // (null sorts, absent does not), which is why the query filters
      // explicitly rather than relying on the field's absence.
      await db.collection('interviews').add({
        'recruiterId': recruiter,
        'testId': testId,
        'roundId': rid,
        'candidateEmailLower': 'nullscore@b.com',
        'title': 'T',
        'type': 'chat',
        'status': 'completed',
        'result': {'overallScore': null, 'summary': 'half-written'},
      });

      final page = await repo.fetchLeaderboardPage(
          recruiterId: recruiter, testId: testId, roundId: rid);

      expect(
        page.items.map((i) => i.candidateEmailLower),
        ['top@b.com', 'mid@b.com', 'low@b.com'],
      );
      // Neither the unscored candidate nor the null-score one gets a rank. The
      // UI has to report that gap — this asserts the gap is real.
      expect(page.items.length, 3);
      expect(
        await repo.countForRecruiter(
            recruiterId: recruiter, testId: testId, roundId: rid),
        5,
        reason: 'the round has 5 candidates; only 3 have a rank',
      );
    });

    test('the leaderboard ranks a whole test when no round is given', () async {
      // What a test created before timelines needs: no roundId on its documents.
      for (final (email, score) in [('a@b.com', 30), ('b@b.com', 80)]) {
        await db.collection('interviews').add({
          'recruiterId': recruiter,
          'testId': testId,
          'candidateEmail': email,
          'candidateEmailLower': email,
          'title': 'T',
          'type': 'video',
          'status': 'completed',
          'result': {'overallScore': score},
        });
      }

      final page = await repo.fetchLeaderboardPage(
          recruiterId: recruiter, testId: testId);

      expect(page.items.map((i) => i.candidateEmailLower),
          ['b@b.com', 'a@b.com']);
      expect(page.items.every((i) => i.hasRound), isFalse);
    });

    test('the leaderboard never crosses into another recruiter or test',
        () async {
      final rid = await repo.createRound(round(id: 'r1'));
      await db.collection('interviews').add({
        'recruiterId': 'someone-else',
        'testId': testId,
        'roundId': rid,
        'candidateEmailLower': 'other@b.com',
        'title': 'T',
        'type': 'chat',
        'result': {'overallScore': 99},
      });
      await db.collection('interviews').add({
        'recruiterId': recruiter,
        'testId': 'a-different-test',
        'candidateEmailLower': 'elsewhere@b.com',
        'title': 'T',
        'type': 'chat',
        'result': {'overallScore': 98},
      });
      await db.collection('interviews').add({
        'recruiterId': recruiter,
        'testId': testId,
        'roundId': rid,
        'candidateEmailLower': 'mine@b.com',
        'title': 'T',
        'type': 'chat',
        'result': {'overallScore': 40},
      });

      final page = await repo.fetchLeaderboardPage(
          recruiterId: recruiter, testId: testId, roundId: rid);

      expect(page.items.map((i) => i.candidateEmailLower), ['mine@b.com']);
    });

    test('the leaderboard pages, carrying a cursor', () async {
      final rid = await repo.createRound(round(id: 'r1'));
      for (var i = 0; i < 5; i++) {
        await db.collection('interviews').add({
          'recruiterId': recruiter,
          'testId': testId,
          'roundId': rid,
          'candidateEmailLower': 'c$i@b.com',
          'title': 'T',
          'type': 'chat',
          'result': {'overallScore': i * 10},
        });
      }

      final first = await repo.fetchLeaderboardPage(
          recruiterId: recruiter, testId: testId, roundId: rid, limit: 2);
      expect(first.items.map((i) => i.result!['overallScore']), [40, 30]);
      expect(first.hasMore, isTrue);

      final second = await repo.fetchLeaderboardPage(
        recruiterId: recruiter,
        testId: testId,
        roundId: rid,
        limit: 2,
        startAfter: first.lastDoc,
      );
      expect(second.items.map((i) => i.result!['overallScore']), [20, 10]);
      expect(second.hasMore, isTrue);

      final third = await repo.fetchLeaderboardPage(
        recruiterId: recruiter,
        testId: testId,
        roundId: rid,
        limit: 2,
        startAfter: second.lastDoc,
      );
      expect(third.items.map((i) => i.result!['overallScore']), [0]);
      expect(third.hasMore, isFalse);
    });

    test('paged reads can scope to one round, or span all of them', () async {
      final r1 = await repo.createRound(round(id: 'r1', order: 0));
      final r2 = await repo.createRound(round(id: 'r2', order: 1));
      await seedAssignment(roundId: r1);
      await seedAssignment(roundId: r1);
      await seedAssignment(roundId: r2, roundOrder: 1);

      final justR1 = await repo.fetchRecruiterPage(
          recruiterId: recruiter, testId: testId, roundId: r1);
      expect(justR1.items.length, 2);
      expect(justR1.items.every((i) => i.roundId == r1), isTrue);

      final everything = await repo.fetchRecruiterPage(
          recruiterId: recruiter, testId: testId);
      expect(everything.items.length, 3);

      expect(
        await repo.countForRecruiter(
            recruiterId: recruiter, testId: testId, roundId: r2),
        1,
      );
    });
  });
}

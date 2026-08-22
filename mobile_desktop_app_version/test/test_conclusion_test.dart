// test/test_conclusion_test.dart
//
// The END of a candidate's run at a test: the recruiter's final decision plus
// the message they wrote, released to the people who have finished.
//
// What is worth locking down here is not "does the field save". It is the four
// ways this feature does real harm if it is subtly wrong:
//
//   1. Telling the WRONG PERSON. A conclusion is published to a ticked list, and
//      every candidate is several documents — a publish that reaches one extra
//      person has told somebody their application is over.
//   2. Telling somebody NOTHING. A conclusion written to one round only is one
//      the candidate may never open, and their screen groups rounds by job.
//   3. Losing it to a RETAKE. `clearResult` wipes `result` so a candidate can sit
//      a round again; a conclusion living in `result` would silently vanish.
//   4. Concluding a candidate MID-RUN. "Finished" has to mean every assignment
//      they hold is complete, not "one of them is".

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/test_conclusion.dart';
import 'package:talbotiq/features/interviews/recruiter/candidate_grouping.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';

void main() {
  const recruiter = 'rec-1';
  const testId = 'test-1';

  group('the outcome enum', () {
    test('wire values round-trip', () {
      for (final outcome in TestOutcome.values) {
        expect(TestOutcomeX.fromWire(outcome.wire), outcome);
      }
    });

    test('an unknown value degrades to on hold, never to a rejection', () {
      // A newer build writing an outcome this one has never heard of must not
      // read as "not selected" on somebody's screen.
      expect(TestOutcomeX.fromWire('hired_immediately'), TestOutcome.onHold);
      expect(TestOutcomeX.fromWire(null), TestOutcome.onHold);
      expect(TestOutcomeX.fromWire(''), TestOutcome.onHold);
    });

    test('the candidate wording promises nothing and blames nobody', () {
      final cleared = TestOutcome.cleared.candidateLabel.toLowerCase();
      // Clearing every round is not a job offer.
      for (final word in ['offer', 'hired', 'congratulations']) {
        expect(cleared.contains(word), isFalse, reason: 'cleared says "$word"');
      }
      final rejected = TestOutcome.notSelected.candidateLabel.toLowerCase();
      for (final word in ['fail', 'failed', 'rejected', 'unsuccessful']) {
        expect(rejected.contains(word), isFalse,
            reason: 'not-selected says "$word"');
      }
    });

    test('each outcome prefills a different message, naming the job', () {
      final messages = {
        for (final o in TestOutcome.values) o: o.defaultMessage('Backend Eng')
      };
      expect(messages.values.toSet(), hasLength(TestOutcome.values.length));
      for (final message in messages.values) {
        expect(message, contains('Backend Eng'));
        expect(message.trim(), isNotEmpty);
      }
    });

    test('a blank test title does not produce a dangling quote', () {
      final message = TestOutcome.cleared.defaultMessage('   ');
      expect(message, isNot(contains('""')));
      expect(message, contains('this process'));
    });
  });

  group('parsing a stored conclusion', () {
    test('no map, or a map with no outcome, is no conclusion', () {
      // "No conclusion" and "on hold" are different things: one has not been
      // published, the other says the recruiter is still deciding.
      expect(TestConclusion.fromMap(null), isNull);
      expect(TestConclusion.fromMap(const {}), isNull);
      expect(TestConclusion.fromMap(const {'message': 'hi'}), isNull);
      expect(TestConclusion.fromMap(const {'outcome': ''}), isNull);
      expect(TestConclusion.fromMap(const {'outcome': 7}), isNull);
    });

    test('a full map parses, and a partial one still yields something usable',
        () {
      final full = TestConclusion.fromMap({
        'outcome': 'cleared',
        'message': '  See you Tuesday.  ',
        'publishedByName': ' Sam ',
        'publishedAt': Timestamp.fromDate(DateTime.utc(2026, 8, 20)),
      })!;
      expect(full.outcome, TestOutcome.cleared);
      expect(full.message, 'See you Tuesday.');
      expect(full.publishedByName, 'Sam');
      // Firestore hands timestamps back in local time, so compare the instant.
      expect(full.publishedAt!.isAtSameMomentAs(DateTime.utc(2026, 8, 20)),
          isTrue);

      // Only the outcome: publishing the decision alone is allowed.
      final bare = TestConclusion.fromMap(const {'outcome': 'not_selected'})!;
      expect(bare.outcome, TestOutcome.notSelected);
      expect(bare.message, '');
      expect(bare.publishedByName, '');
      expect(bare.publishedAt, isNull);
    });
  });

  group('a concluded run does not leave rounds "Under review"', () {
    // THE BUG, from a real screen: a candidate held a published conclusion
    // saying "You cleared every round", and both rounds underneath it still said
    // "Under review". `outcome` defaults to pending when nobody decided the
    // round, and the conclusion is a separate, later statement — so the two
    // contradicted each other and the candidate had to work out which was true.
    Interview round({
      Map<String, dynamic>? result,
      Map<String, dynamic>? conclusion,
    }) =>
        Interview(
          id: 'i-1',
          testId: testId,
          roundId: 'r1',
          roundOrder: 0,
          recruiterId: recruiter,
          recruiterEmail: 'rec@co.com',
          candidateEmail: 'a@b.com',
          candidateEmailLower: 'a@b.com',
          type: InterviewType.chat,
          title: 'Résumé screen',
          prompt: '',
          questions: const [],
          avatar: const AvatarConfig(replicaId: ''),
          durationMinutes: 15,
          status: InterviewStatus.completed,
          result: result,
          resultPublished: true,
          conclusion: conclusion,
        );

    test('an undecided round defers to the conclusion', () {
      final undecided = round(
        result: const {'overallScore': 80, 'evaluatedBy': 'ai'},
        conclusion: const {'outcome': 'cleared'},
      );
      // The round itself still reads as pending — nothing has been decided about
      // it — but it must not SAY so next to a published final result.
      expect(undecided.outcome, RoundOutcome.pending);
      expect(undecided.showsOwnOutcome, isFalse);
    });

    test('a round with a real decision keeps showing it', () {
      // "Not moving forward" on round 2 explains a conclusion in a way the
      // conclusion on its own does not, so it is never suppressed.
      final decided = round(
        result: const {'outcome': 'not_selected'},
        conclusion: const {'outcome': 'not_selected'},
      );
      expect(decided.showsOwnOutcome, isTrue);
      expect(decided.outcome, RoundOutcome.notSelected);
    });

    test('with no conclusion, "Under review" is the honest answer', () {
      // A run still in progress: pending is exactly right, and suppressing it
      // would leave the candidate with no status at all.
      expect(round(result: const {'overallScore': 80}).showsOwnOutcome, isTrue);
      expect(round().showsOwnOutcome, isTrue);
    });
  });

  group('grouping a test into candidate runs', () {
    Interview row(
      String email, {
      String id = '',
      String roundId = '',
      int? roundOrder,
      InterviewStatus status = InterviewStatus.completed,
      String? name,
      Map<String, dynamic>? conclusion,
    }) =>
        Interview(
          id: id.isEmpty ? '$email-$roundId' : id,
          testId: testId,
          roundId: roundId,
          roundOrder: roundOrder,
          recruiterId: recruiter,
          recruiterEmail: 'rec@co.com',
          candidateEmail: email,
          candidateEmailLower: email.toLowerCase(),
          candidateName: name,
          type: InterviewType.chat,
          title: 'Round',
          prompt: '',
          questions: const [],
          avatar: const AvatarConfig(replicaId: ''),
          durationMinutes: 15,
          status: status,
          conclusion: conclusion,
        );

    test('one run per person, rounds in order', () {
      final runs = runsFor([
        row('a@b.com', roundId: 'r2', roundOrder: 1),
        row('b@b.com', roundId: 'r1', roundOrder: 0),
        row('a@b.com', roundId: 'r1', roundOrder: 0),
      ]);

      expect(runs.map((r) => r.emailLower), ['a@b.com', 'b@b.com']);
      expect(runs.first.rounds.map((i) => i.roundId), ['r1', 'r2']);
    });

    test('a run is finished only when EVERY round they hold is complete', () {
      final done = runsFor([
        row('a@b.com', roundId: 'r1', roundOrder: 0),
        row('a@b.com', roundId: 'r2', roundOrder: 1),
      ]).single;
      expect(done.isFinished, isTrue);
      expect(done.completedRounds, 2);

      // THE ONE THAT MATTERS: they cleared round 1 and have round 2 waiting.
      // Concluding them here ends a process they are still in.
      final midRun = runsFor([
        row('a@b.com', roundId: 'r1', roundOrder: 0),
        row('a@b.com',
            roundId: 'r2',
            roundOrder: 1,
            status: InterviewStatus.assigned),
      ]).single;
      expect(midRun.isFinished, isFalse);
      expect(midRun.completedRounds, 1);
    });

    test('an in-progress round is not a finished one', () {
      final run = runsFor([
        row('a@b.com', roundId: 'r1', status: InterviewStatus.inProgress),
      ]).single;
      expect(run.isFinished, isFalse);
    });

    test('a single-round test finishes the same way a pipeline does', () {
      // The whole point of doing this for both: a one-round test's assignment
      // carries no roundId at all.
      final run = runsFor([row('a@b.com')]).single;
      expect(run.isFinished, isTrue);
      expect(run.rounds, hasLength(1));
    });

    test('a name written on a later round only is still found', () {
      final run = runsFor([
        row('a@b.com', roundId: 'r1', roundOrder: 0),
        row('a@b.com', roundId: 'r2', roundOrder: 1, name: 'Asha'),
      ]).single;
      expect(run.displayName, 'Asha');
    });

    test('with no name at all, the email is what is shown', () {
      expect(runsFor([row('a@b.com')]).single.displayName, 'a@b.com');
    });

    test('the conclusion is read off whichever round carries it', () {
      final run = runsFor([
        row('a@b.com', roundId: 'r1', roundOrder: 0),
        row('a@b.com',
            roundId: 'r2',
            roundOrder: 1,
            conclusion: const {'outcome': 'cleared'}),
      ]).single;
      expect(run.hasConclusion, isTrue);
      expect(run.conclusion!.outcome, TestOutcome.cleared);
    });

    test('no conclusion anywhere reads as none', () {
      expect(runsFor([row('a@b.com', roundId: 'r1')]).single.hasConclusion,
          isFalse);
    });
  });

  group('who got selected, on the recruiter side', () {
    // Publishing told the candidates and then told the recruiter nothing: the
    // answer to "who did we select" had to be re-derived by reading a tick-list.
    // The panel reads it off the runs, so it cannot drift from what was published.
    Interview assignment(String email, String roundId, Map<String, dynamic>? c) =>
        Interview(
          id: '$email-$roundId',
          testId: testId,
          roundId: roundId,
          roundOrder: roundId == 'r1' ? 0 : 1,
          recruiterId: recruiter,
          recruiterEmail: 'rec@co.com',
          candidateEmail: email,
          candidateEmailLower: email,
          candidateName: email == 'asha@b.com' ? 'Asha' : null,
          type: InterviewType.chat,
          title: 'Round',
          prompt: '',
          questions: const [],
          avatar: const AvatarConfig(replicaId: ''),
          durationMinutes: 15,
          status: InterviewStatus.completed,
          conclusion: c,
        );

    final runs = runsFor([
      // Two rounds each, the conclusion copied onto both — as published.
      assignment('asha@b.com', 'r1', const {'outcome': 'cleared'}),
      assignment('asha@b.com', 'r2', const {'outcome': 'cleared'}),
      assignment('bo@b.com', 'r1', const {'outcome': 'not_selected'}),
      assignment('cy@b.com', 'r1', const {'outcome': 'on_hold'}),
      assignment('dee@b.com', 'r1', null),
    ]);

    List<CandidateRun> withOutcome(TestOutcome outcome) =>
        runs.where((r) => r.conclusion?.outcome == outcome).toList();

    test('the selected list is one entry per person, not per round', () {
      final selected = withOutcome(TestOutcome.cleared);
      expect(selected, hasLength(1));
      expect(selected.single.displayName, 'Asha');
      expect(selected.single.rounds, hasLength(2));
    });

    test('the other outcomes are separated from it', () {
      expect(withOutcome(TestOutcome.notSelected).map((r) => r.emailLower),
          ['bo@b.com']);
      expect(withOutcome(TestOutcome.onHold).map((r) => r.emailLower),
          ['cy@b.com']);
    });

    test('somebody nobody has decided on appears in no list', () {
      // They are still in the test, and must not be counted as an outcome.
      final decided = [
        for (final o in TestOutcome.values) ...withOutcome(o),
      ].map((r) => r.emailLower);
      expect(decided, isNot(contains('dee@b.com')));
      expect(runs.map((r) => r.emailLower), contains('dee@b.com'));
    });

    test('the addresses are the ones a recruiter would write to', () {
      expect(withOutcome(TestOutcome.cleared).map((r) => r.email).join(', '),
          'asha@b.com');
    });
  });

  group('publishing a conclusion', () {
    late FakeFirebaseFirestore db;
    late InterviewRepository repo;

    setUp(() {
      db = FakeFirebaseFirestore();
      repo = InterviewRepository(firestore: db);
    });

    Future<String> seed({
      required String email,
      String roundId = '',
      int roundOrder = 0,
      String status = 'completed',
      String testIdOverride = testId,
    }) async {
      final doc = await db.collection('interviews').add({
        'recruiterId': recruiter,
        'testId': testIdOverride,
        if (roundId.isNotEmpty) 'roundId': roundId,
        if (roundId.isNotEmpty) 'roundOrder': roundOrder,
        'candidateEmail': email,
        'candidateEmailLower': email.toLowerCase(),
        'title': 'Round ${roundOrder + 1}',
        'type': 'chat',
        'status': status,
        'result': {'overallScore': 80, 'evaluatedBy': 'ai'},
        'createdAt': Timestamp.now(),
      });
      return doc.id;
    }

    Future<Interview> read(String id) async =>
        Interview.fromDoc(await db.collection('interviews').doc(id).get());

    test('every round of the chosen candidate is told, and nobody else is',
        () async {
      final asha1 = await seed(email: 'asha@b.com', roundId: 'r1');
      final asha2 = await seed(email: 'asha@b.com', roundId: 'r2', roundOrder: 1);
      final bo = await seed(email: 'bo@b.com', roundId: 'r1');

      final all = await repo.fetchTestAssignments(
          testId: testId, recruiterId: recruiter);
      final asha = runsFor(all).firstWhere((r) => r.emailLower == 'asha@b.com');

      final written = await repo.publishConclusion(
        assignments: asha.rounds,
        conclusion: const TestConclusion(
          outcome: TestOutcome.cleared,
          message: 'We will call you this week.',
          publishedByName: 'Sam',
        ),
      );

      // Two documents for one candidate — the count the UI reports separately.
      expect(written, 2);
      for (final id in [asha1, asha2]) {
        final saved = (await read(id)).testConclusion!;
        expect(saved.outcome, TestOutcome.cleared);
        expect(saved.message, 'We will call you this week.');
        expect(saved.publishedByName, 'Sam');
      }
      // The person nobody ticked has been told nothing.
      expect((await read(bo)).hasConclusion, isFalse);
    });

    test('it does not touch the round scoring it sits beside', () async {
      final id = await seed(email: 'asha@b.com', roundId: 'r1');
      await repo.publishConclusion(
        assignments: [await read(id)],
        conclusion: const TestConclusion(outcome: TestOutcome.notSelected),
      );

      final saved = await read(id);
      // The recruiter's evaluation is untouched — a decision about the whole
      // test must not destroy the record of one round.
      expect(saved.result?['overallScore'], 80);
      expect(saved.result?['evaluatedBy'], 'ai');
      expect(saved.status, InterviewStatus.completed);
    });

    test('a retake clears the round result and KEEPS the conclusion', () async {
      // Why `conclusion` is not stored inside `result`: clearResult deletes that
      // whole map so a candidate can sit the round again.
      final id = await seed(email: 'asha@b.com', roundId: 'r1');
      await repo.publishConclusion(
        assignments: [await read(id)],
        conclusion: const TestConclusion(outcome: TestOutcome.cleared),
      );

      await repo.clearResult(id);

      final saved = await read(id);
      expect(saved.result, isNull);
      expect(saved.status, InterviewStatus.assigned);
      expect(saved.testConclusion?.outcome, TestOutcome.cleared);
    });

    test('publishing again replaces the decision rather than adding one',
        () async {
      final id = await seed(email: 'asha@b.com', roundId: 'r1');
      await repo.publishConclusion(
        assignments: [await read(id)],
        conclusion: const TestConclusion(
            outcome: TestOutcome.onHold, message: 'Still deciding.'),
      );
      await repo.publishConclusion(
        assignments: [await read(id)],
        conclusion: const TestConclusion(
            outcome: TestOutcome.cleared, message: 'Decided — well done.'),
      );

      final saved = (await read(id)).testConclusion!;
      expect(saved.outcome, TestOutcome.cleared);
      expect(saved.message, 'Decided — well done.');
    });

    test('withdrawing removes it entirely, leaving no half-published state',
        () async {
      final id = await seed(email: 'asha@b.com', roundId: 'r1');
      final other = await seed(email: 'bo@b.com', roundId: 'r1');
      for (final target in [id, other]) {
        await repo.publishConclusion(
          assignments: [await read(target)],
          conclusion: const TestConclusion(outcome: TestOutcome.notSelected),
        );
      }

      final cleared = await repo.clearConclusion([await read(id)]);

      expect(cleared, 1);
      final saved = await read(id);
      expect(saved.conclusion, isNull);
      expect(saved.hasConclusion, isFalse);
      // Withdrawing from one candidate leaves everyone else's alone.
      expect((await read(other)).hasConclusion, isTrue);
    });

    test('an empty list writes nothing rather than everything', () async {
      final id = await seed(email: 'asha@b.com', roundId: 'r1');
      expect(
        await repo.publishConclusion(
          assignments: const [],
          conclusion: const TestConclusion(outcome: TestOutcome.cleared),
        ),
        0,
      );
      expect(await repo.clearConclusion(const []), 0);
      expect((await read(id)).hasConclusion, isFalse);
    });

    test('fetchTestAssignments is scoped to one test and one recruiter',
        () async {
      await seed(email: 'asha@b.com', roundId: 'r1');
      await seed(email: 'other@b.com', testIdOverride: 'another-test');
      await db.collection('interviews').add({
        'recruiterId': 'someone-else',
        'testId': testId,
        'candidateEmailLower': 'theirs@b.com',
        'title': 'T',
        'type': 'chat',
        'status': 'completed',
      });

      final mine = await repo.fetchTestAssignments(
          testId: testId, recruiterId: recruiter);
      expect(mine.map((i) => i.candidateEmailLower), ['asha@b.com']);

      // A blank id lists nothing rather than everything.
      expect(
          await repo.fetchTestAssignments(testId: '', recruiterId: recruiter),
          isEmpty);
      expect(await repo.fetchTestAssignments(testId: testId, recruiterId: ''),
          isEmpty);
    });
  });
}

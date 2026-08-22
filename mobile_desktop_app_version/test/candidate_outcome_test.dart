// test/candidate_outcome_test.dart
//
// What a candidate is allowed to see, and how their rounds are ordered.
//
// The first group is the important one. This screen used to publish the
// recruiter's entire internal evaluation — the score, the AI's "Strong Hire"
// verdict, its summary, its list of the candidate's weaknesses. The result page
// is now an ALLOWLIST of three fields, and the test asserts the other five are
// absent from the rendered widget tree, so adding a field to `result` cannot
// quietly put it in front of a candidate again.

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:talbotiq/features/interviews/candidate/candidate_home.dart';
import 'package:talbotiq/features/interviews/candidate/candidate_result_page.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';

Interview interview({
  String id = 'i-1',
  String testId = 't-1',
  String title = 'Tech round',
  String testTitle = 'Senior Flutter Engineer',
  String roundId = 'r-1',
  int? roundOrder = 0,
  DateTime? createdAt,
  InterviewStatus status = InterviewStatus.completed,
  bool published = true,
  Map<String, dynamic>? result,
}) =>
    Interview(
      id: id,
      testId: testId,
      roundId: roundId,
      roundOrder: roundOrder,
      recruiterId: 'rec-1',
      recruiterEmail: 'rec@co.com',
      recruiterName: 'Acme',
      candidateEmail: 'a@b.com',
      candidateEmailLower: 'a@b.com',
      type: InterviewType.chat,
      title: title,
      testTitle: testTitle,
      prompt: '',
      questions: const [],
      avatar: const AvatarConfig(replicaId: ''),
      durationMinutes: 15,
      status: status,
      createdAt: createdAt,
      resultPublished: published,
      result: result,
    );

/// A full recruiter-side result — everything the AI and the recruiter recorded.
const _recruiterResult = {
  'overallScore': 87,
  'recommendation': 'Strong Hire',
  'summary': 'Excellent systems depth, hire immediately.',
  'strengths': ['Deep Flutter knowledge'],
  'improvements': ['Rambles under pressure'],
  'evaluatedBy': 'ai',
  'outcome': 'selected',
  'rank': 3,
  'rankOf': 40,
  'candidateNote': 'We will be in touch to schedule the next round.',
};

Future<void> _pump(WidgetTester t, Interview i) => t.pumpWidget(
      MaterialApp(home: CandidateResultPage(interview: i)),
    );

void main() {
  group('the candidate sees the outcome and nothing else', () {
    testWidgets('the recruiter\'s evaluation never reaches the screen',
        (t) async {
      await _pump(t, interview(result: _recruiterResult));

      // Allowed.
      expect(find.text('Moving forward'), findsOneWidget);
      expect(find.text('Ranked 3 of 40'), findsOneWidget);
      expect(
          find.text('We will be in touch to schedule the next round.'),
          findsOneWidget);

      // Not allowed — these are the recruiter's working notes.
      expect(find.textContaining('87'), findsNothing);
      expect(find.textContaining('Strong Hire'), findsNothing);
      expect(find.textContaining('Excellent systems depth'), findsNothing);
      expect(find.textContaining('Deep Flutter knowledge'), findsNothing);
      expect(find.textContaining('Rambles under pressure'), findsNothing);
      expect(find.textContaining('out of 100'), findsNothing);
    });

    testWidgets('a rejection says so plainly, without the score', (t) async {
      await _pump(
        t,
        interview(result: {
          ..._recruiterResult,
          'outcome': 'not_selected',
          'candidateNote': 'Thank you for your time.',
        }),
      );

      expect(find.text('Not moving forward'), findsOneWidget);
      expect(find.text('Thank you for your time.'), findsOneWidget);
      expect(find.textContaining('87'), findsNothing);
    });

    testWidgets('a legacy result with no outcome reads as under review',
        (t) async {
      // Published before outcomes existed. It must NOT fall back to showing the
      // old score — that is the exact leak being closed.
      await _pump(t, interview(result: {
        'overallScore': 87,
        'summary': 'Excellent systems depth.',
        'recommendation': 'Strong Hire',
      }));

      expect(find.text('Under review'), findsOneWidget);
      expect(find.textContaining('87'), findsNothing);
      expect(find.textContaining('Strong Hire'), findsNothing);
    });

    testWidgets('rank and note are optional', (t) async {
      await _pump(t, interview(result: {'outcome': 'selected'}));

      expect(find.text('Moving forward'), findsOneWidget);
      expect(find.textContaining('Ranked'), findsNothing);
      expect(find.textContaining('A note from'), findsNothing);
    });

    testWidgets('the round is named so "you are through" has a subject',
        (t) async {
      await _pump(t, interview(roundOrder: 1, result: {'outcome': 'selected'}));
      expect(find.text('Round 2 · Tech round'), findsOneWidget);
    });
  });

  group('reading the outcome off a document', () {
    test('an absent outcome is pending, not selected', () {
      expect(interview(result: const {}).outcome, RoundOutcome.pending);
      expect(interview(result: const {}).hasOutcome, isFalse);
    });

    test('an unknown value degrades to pending rather than guessing', () {
      final i = interview(result: const {'outcome': 'shortlisted_maybe'});
      expect(i.outcome, RoundOutcome.pending);
    });

    test('wire values round-trip', () {
      for (final o in RoundOutcome.values) {
        expect(RoundOutcomeX.fromWire(o.wire), o);
      }
    });
  });

  group('grouping a candidate\'s rounds by the job', () {
    test('rounds of one test are listed in running order', () {
      final groups = groupByTest([
        interview(id: 'b', roundId: 'r2', roundOrder: 1, title: 'Tech round'),
        interview(id: 'a', roundId: 'r1', roundOrder: 0, title: 'Résumé screen'),
      ]);

      expect(groups.length, 1);
      expect(groups.single.title, 'Senior Flutter Engineer');
      expect(groups.single.rounds.map((i) => i.title),
          ['Résumé screen', 'Tech round']);
    });

    test('separate jobs stay separate, newest application first', () {
      final groups = groupByTest([
        interview(
            id: 'old',
            testId: 't-old',
            testTitle: 'Backend Engineer',
            createdAt: DateTime.utc(2026, 1, 1)),
        interview(
            id: 'new',
            testId: 't-new',
            testTitle: 'Senior Flutter Engineer',
            createdAt: DateTime.utc(2026, 8, 1)),
      ]);

      expect(groups.map((g) => g.title),
          ['Senior Flutter Engineer', 'Backend Engineer']);
    });

    test('a pre-timeline assignment is its own group under its own title', () {
      // No testId and no round: it is the single implicit round of a one-round
      // test, and `title` IS the job.
      final groups = groupByTest([
        interview(
            id: 'legacy',
            testId: '',
            roundId: '',
            roundOrder: null,
            testTitle: '',
            title: 'Backend Engineer'),
      ]);

      expect(groups.single.title, 'Backend Engineer');
      expect(groups.single.rounds.single.hasRound, isFalse);
    });

    test('several pre-timeline assignments do not collapse into one group', () {
      // They all have an empty testId; keying on that would merge unrelated
      // jobs under one heading.
      final groups = groupByTest([
        interview(id: 'x', testId: '', roundId: '', testTitle: '', title: 'Job A'),
        interview(id: 'y', testId: '', roundId: '', testTitle: '', title: 'Job B'),
      ]);
      expect(groups.length, 2);
    });

    test('same round order falls back to creation time', () {
      // A test with no timeline gives every assignment order 0.
      final groups = groupByTest([
        interview(
            id: 'second',
            roundId: '',
            roundOrder: null,
            title: 'Second',
            createdAt: DateTime.utc(2026, 8, 2)),
        interview(
            id: 'first',
            roundId: '',
            roundOrder: null,
            title: 'First',
            createdAt: DateTime.utc(2026, 8, 1)),
      ]);
      expect(groups.single.rounds.map((i) => i.title), ['First', 'Second']);
    });
  });

  group('recording outcomes', () {
    late FakeFirebaseFirestore db;
    late InterviewRepository repo;

    setUp(() {
      db = FakeFirebaseFirestore();
      repo = InterviewRepository(firestore: db);
    });

    Future<String> seed(int score) async {
      final ref = await db.collection('interviews').add({
        'recruiterId': 'rec-1',
        'testId': 't-1',
        'roundId': 'r-1',
        'candidateEmailLower': 'a@b.com',
        'title': 'Tech round',
        'type': 'chat',
        'status': 'completed',
        'result': {
          'overallScore': score,
          'summary': 'internal write-up',
          'evaluatedBy': 'ai',
          'responses': [
            {'question': 'Q', 'answer': 'A'}
          ],
        },
      });
      return ref.id;
    }

    test('setting an outcome preserves the recruiter\'s evaluation', () async {
      final id = await seed(87);

      await repo.setOutcome(id,
          outcome: RoundOutcome.selected,
          rank: 2,
          rankOf: 10,
          note: 'See you next round',
          publish: true);

      final i = Interview.fromDoc(
          await db.collection('interviews').doc(id).get());

      expect(i.outcome, RoundOutcome.selected);
      expect(i.rank, 2);
      expect(i.candidateNote, 'See you next round');
      expect(i.resultPublished, isTrue);
      // The evaluation is written with dotted paths, so none of it is destroyed
      // by recording a decision about the candidate.
      expect(i.result!['overallScore'], 87);
      expect(i.result!['summary'], 'internal write-up');
      expect(i.storedResponses.length, 1);
    });

    test('a bulk publish stamps ranks from leaderboard position', () async {
      final top = await seed(90);
      final mid = await seed(70);
      final low = await seed(40);

      final ranked = [
        for (final id in [top, mid, low])
          Interview.fromDoc(await db.collection('interviews').doc(id).get()),
      ];

      final n = await repo.applyRoundOutcomes(
        ranked: ranked,
        selectedIds: {top, mid},
        noteForSelected: 'Congratulations',
        noteForRejected: 'Thank you',
      );
      expect(n, 3);

      Future<Interview> read(String id) async => Interview.fromDoc(
          await db.collection('interviews').doc(id).get());

      final first = await read(top);
      expect(first.outcome, RoundOutcome.selected);
      // Stamped, not computed on read — a re-score of someone else must not
      // silently move this candidate's rank afterwards.
      expect(first.rank, 1);
      expect(first.rankOf, 3);
      expect(first.candidateNote, 'Congratulations');
      expect(first.resultPublished, isTrue);

      final last = await read(low);
      expect(last.outcome, RoundOutcome.notSelected);
      expect(last.rank, 3);
      expect(last.candidateNote, 'Thank you');
    });

    test('publishing and advancing moves exactly the shortlist forward',
        () async {
      // The gap this closes: outcomes said "moving forward" but nobody was
      // assigned anywhere, so the candidate was told they were through and then
      // nothing appeared.
      final top = await seed(90);
      final mid = await seed(70);
      final low = await seed(40);

      Future<Interview> read(String id) async => Interview.fromDoc(
          await db.collection('interviews').doc(id).get());
      final ranked = [await read(top), await read(mid), await read(low)];

      // Round 1's outcomes.
      await repo.applyRoundOutcomes(
          ranked: ranked, selectedIds: {top, mid});

      // ...and the same shortlist into round 2, exactly as the notify screen
      // does it.
      final nextId = await repo.createRound(InterviewRound(
        id: '',
        testId: 't-1',
        recruiterId: 'rec-1',
        order: 1,
        title: 'Final panel',
        kind: RoundKind.video,
        config: const {
          'questions': ['Why us?'],
          'avatar': {'replicaId': 'rep-1'},
        },
      ));
      final next = (await repo.getRound('t-1', nextId))!;

      final advanced = await repo.assignCandidatesToRound(
        round: next,
        recruiterEmail: 'rec@co.com',
        testTitle: 'Senior Flutter Engineer',
        candidates: {
          for (final i in ranked.where((i) => i.id == top || i.id == mid))
            i.candidateEmailLower: i.candidateName,
        },
      );

      // The three seeded candidates all share one email, so this collapses to a
      // single assignment — what matters is that the REJECTED candidate's email
      // is never passed in, which the map comprehension above enforces.
      expect(advanced, greaterThan(0));

      final inNext = await repo.fetchRecruiterPage(
          recruiterId: 'rec-1', testId: 't-1', roundId: nextId);
      expect(inNext.items, isNotEmpty);
      expect(inNext.items.every((i) => i.roundId == nextId), isTrue);
      // They arrive with the next round's own config, not round 1's.
      expect(inNext.items.first.questions, ['Why us?']);
      expect(inNext.items.first.roundKind, RoundKind.video);
      expect(inNext.items.first.status, InterviewStatus.assigned);

      // Publishing twice must not hand anyone the same round again.
      final again = await repo.assignCandidatesToRound(
        round: next,
        recruiterEmail: 'rec@co.com',
        testTitle: 'Senior Flutter Engineer',
        candidates: {'a@b.com': null},
      );
      expect(again, 0, reason: 'already in that round');
    });

    test('being added to a later round clears the rounds before it', () async {
      // THE BUG: a candidate sitting in round 2 went on reading "Under review"
      // against round 1 for ever. Nothing ever wrote round 1's outcome — only
      // the notify screen did, and adding candidates from the timeline does not
      // go through it — and `RoundOutcome` defaults to pending.
      final finishedRound1 = await seed(80);

      final nextId = await repo.createRound(InterviewRound(
        id: '',
        testId: 't-1',
        recruiterId: 'rec-1',
        order: 1,
        title: 'Final panel',
        kind: RoundKind.chat,
        config: const {'questions': ['Q']},
      ));
      final next = (await repo.getRound('t-1', nextId))!;

      await repo.assignCandidatesToRound(
        round: next,
        recruiterEmail: 'rec@co.com',
        testTitle: 'T',
        candidates: const {'a@b.com': 'Asha'},
      );

      final round1 = Interview.fromDoc(
          await db.collection('interviews').doc(finishedRound1).get());
      expect(round1.outcome, RoundOutcome.selected);
      // Published with it: an outcome the candidate cannot see does not fix the
      // screen this exists for.
      expect(round1.resultPublished, isTrue);
      // And the recruiter's evaluation in the same map is untouched.
      expect(round1.result!['overallScore'], 80);
      expect(round1.result!['summary'], 'internal write-up');
    });

    test('it never overwrites a decision the recruiter already made', () async {
      // A recruiter marks somebody "not moving forward", then bulk-adds every
      // candidate in the test to the next round. Their decision stands.
      final rejected = await seed(30);
      await repo.setOutcome(rejected,
          outcome: RoundOutcome.notSelected, publish: true);

      final nextId = await repo.createRound(InterviewRound(
        id: '',
        testId: 't-1',
        recruiterId: 'rec-1',
        order: 1,
        title: 'Final panel',
        kind: RoundKind.chat,
        config: const {'questions': ['Q']},
      ));
      await repo.assignCandidatesToRound(
        round: (await repo.getRound('t-1', nextId))!,
        recruiterEmail: 'rec@co.com',
        testTitle: 'T',
        candidates: const {'a@b.com': null},
      );

      final round1 = Interview.fromDoc(
          await db.collection('interviews').doc(rejected).get());
      expect(round1.outcome, RoundOutcome.notSelected);
    });

    test('a round the candidate has not finished is left alone', () async {
      // They have not cleared it, so saying they did would be a lie — and it
      // would publish a result for an interview that has not happened.
      final unfinished = await seed(0);
      // Assigned and unscored, as a round nobody has sat looks.
      await repo.clearResult(unfinished);

      final nextId = await repo.createRound(InterviewRound(
        id: '',
        testId: 't-1',
        recruiterId: 'rec-1',
        order: 1,
        title: 'Final panel',
        kind: RoundKind.chat,
        config: const {'questions': ['Q']},
      ));
      await repo.assignCandidatesToRound(
        round: (await repo.getRound('t-1', nextId))!,
        recruiterEmail: 'rec@co.com',
        testTitle: 'T',
        candidates: const {'a@b.com': null},
      );

      final round1 = Interview.fromDoc(
          await db.collection('interviews').doc(unfinished).get());
      expect(round1.hasOutcome, isFalse);
      expect(round1.resultPublished, isFalse);
    });

    test('nobody else in the test is settled by it', () async {
      final mine = await seed(80);
      final theirs = await seed(80);
      await db.collection('interviews').doc(theirs).update({
        'candidateEmail': 'other@b.com',
        'candidateEmailLower': 'other@b.com',
      });

      final nextId = await repo.createRound(InterviewRound(
        id: '',
        testId: 't-1',
        recruiterId: 'rec-1',
        order: 1,
        title: 'Final panel',
        kind: RoundKind.chat,
        config: const {'questions': ['Q']},
      ));
      await repo.assignCandidatesToRound(
        round: (await repo.getRound('t-1', nextId))!,
        recruiterEmail: 'rec@co.com',
        testTitle: 'T',
        candidates: const {'a@b.com': null},
      );

      expect(
        Interview.fromDoc(await db.collection('interviews').doc(mine).get())
            .hasOutcome,
        isTrue,
      );
      expect(
        Interview.fromDoc(await db.collection('interviews').doc(theirs).get())
            .hasOutcome,
        isFalse,
        reason: 'only the candidates being advanced are settled',
      );
    });

    test('assigning the FIRST round settles nothing', () async {
      // There is nothing before round 1, and a test with no timeline is one
      // implicit round — this must not reach back into it.
      final only = await seed(80);
      final firstId = await repo.createRound(InterviewRound(
        id: '',
        testId: 't-1',
        recruiterId: 'rec-1',
        order: 0,
        title: 'Screen',
        kind: RoundKind.chat,
        config: const {'questions': ['Q']},
      ));
      await repo.assignCandidatesToRound(
        round: (await repo.getRound('t-1', firstId))!,
        recruiterEmail: 'rec@co.com',
        testTitle: 'T',
        candidates: const {'a@b.com': null},
      );

      expect(
        Interview.fromDoc(await db.collection('interviews').doc(only).get())
            .hasOutcome,
        isFalse,
      );
    });

    test('a rejected candidate is never advanced', () async {
      final winner = await seed(90);
      final loser = await seed(20);

      Future<Interview> read(String id) async => Interview.fromDoc(
          await db.collection('interviews').doc(id).get());
      // Distinct emails, so "who was advanced" is actually observable.
      await db.collection('interviews').doc(loser).update({
        'candidateEmail': 'loser@b.com',
        'candidateEmailLower': 'loser@b.com',
      });
      final ranked = [await read(winner), await read(loser)];

      await repo.applyRoundOutcomes(
          ranked: ranked, selectedIds: {winner});

      final nextId = await repo.createRound(InterviewRound(
        id: '',
        testId: 't-1',
        recruiterId: 'rec-1',
        order: 1,
        title: 'Final panel',
        kind: RoundKind.chat,
        config: const {'questions': ['Q']},
      ));
      final next = (await repo.getRound('t-1', nextId))!;

      final shortlisted = ranked.where((i) => i.id == winner);
      await repo.assignCandidatesToRound(
        round: next,
        recruiterEmail: 'rec@co.com',
        testTitle: 'T',
        candidates: {
          for (final i in shortlisted) i.candidateEmailLower: i.candidateName,
        },
      );

      final inNext = await repo.fetchRecruiterPage(
          recruiterId: 'rec-1', testId: 't-1', roundId: nextId);
      expect(inNext.items.map((i) => i.candidateEmailLower), ['a@b.com']);
      expect(
        inNext.items.any((i) => i.candidateEmailLower == 'loser@b.com'),
        isFalse,
        reason: 'a rejected candidate must never be given the next round',
      );
    });

    test('publish:false records the decision without releasing it', () async {
      final id = await seed(80);
      final ranked = [
        Interview.fromDoc(await db.collection('interviews').doc(id).get())
      ];

      await repo.applyRoundOutcomes(
          ranked: ranked, selectedIds: {id}, publish: false);

      final i = Interview.fromDoc(
          await db.collection('interviews').doc(id).get());
      expect(i.outcome, RoundOutcome.selected);
      // Decided, not yet visible — so a recruiter can settle a whole round and
      // release it in one go.
      expect(i.resultPublished, isFalse);
    });
  });
}

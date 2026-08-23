// test/round_decision_tally_test.dart
//
// "Who is still waiting on a decision?" — the count behind the dashboard's
// pending-decision card and the timeline's badge.
//
// The rule being pinned: SCORED candidates with no outcome. Two things follow
// from that and both have bitten before:
//
//   * A completed-but-unscored candidate is NOT waiting. Nothing can decide
//     them, so counting them in would leave a badge nobody could ever clear.
//   * A count that cannot be read is UNKNOWN, never zero. An offline device
//     must not report a clean pipeline.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/recruiter/round_timeline_page.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';

void main() {
  late FakeFirebaseFirestore db;
  late InterviewRepository repo;

  const rec = 'rec1';
  const test1 = 't1';
  const round1 = 'r1';

  setUp(() {
    db = FakeFirebaseFirestore();
    repo = InterviewRepository(firestore: db);
  });

  Future<void> candidate({
    String roundId = round1,
    String testId = test1,
    int? score,
    String? outcome,
  }) =>
      db.collection('interviews').add({
        'recruiterId': rec,
        'testId': testId,
        'roundId': roundId,
        'candidateEmailLower': 'c${DateTime.fromMillisecondsSinceEpoch(0)}',
        'status': 'completed',
        'result': {
          if (score != null) 'overallScore': score,
          if (outcome != null) 'outcome': outcome,
        },
      });

  Future<RoundDecisionTally> tally() => repo.countRoundDecision(
        recruiterId: rec,
        testId: test1,
        roundId: round1,
      );

  test('an empty round owes nothing', () async {
    final t = await tally();
    expect(t.isKnown, isTrue);
    expect(t.pending, 0);
    expect(t.hasPending, isFalse);
  });

  test('scored and undecided is what "waiting" means', () async {
    await candidate(score: 80);
    await candidate(score: 55);

    final t = await tally();
    expect(t.scored, 2);
    expect(t.decided, 0);
    expect(t.pending, 2);
    expect(t.hasPending, isTrue);
  });

  test('both outcomes count as decided — including "not moving forward"',
      () async {
    // A rejection IS a decision. Counting only the advances would leave every
    // finished round claiming its rejected candidates were still waiting.
    await candidate(score: 90, outcome: 'selected');
    await candidate(score: 40, outcome: 'not_selected');
    await candidate(score: 61);

    final t = await tally();
    expect(t.scored, 3);
    expect(t.decided, 2);
    expect(t.pending, 1);
  });

  test('a completed candidate with no score is not waiting on anything',
      () async {
    await candidate(); // sat it, scoring failed or never ran
    await candidate(score: 70);

    final t = await tally();
    expect(t.scored, 1);
    expect(t.pending, 1, reason: 'the unscored one is not counted');
  });

  test('another round of the same test is not counted', () async {
    await candidate(score: 80); // round 1, waiting
    await candidate(roundId: 'r2', score: 80); // round 2, its own business

    final t = await tally();
    expect(t.scored, 1);
    expect(t.pending, 1);
  });

  test('another test entirely is not counted', () async {
    await candidate(score: 80);
    await candidate(testId: 't2', score: 80);

    expect((await tally()).pending, 1);
  });

  test('a decision made for everyone clears the count', () async {
    await candidate(score: 80, outcome: 'selected');
    await candidate(score: 30, outcome: 'not_selected');

    final t = await tally();
    expect(t.pending, 0);
    expect(t.hasPending, isFalse);
  });

  group('unknown, not zero', () {
    test('an unknown tally reports no pending and admits it', () {
      const t = RoundDecisionTally.unknown();
      expect(t.isKnown, isFalse);
      expect(t.pending, 0);
      expect(t.hasPending, isFalse,
          reason: 'a caller must not show "0 waiting" from an unknown count');
    });

    test('missing ids read as unknown rather than as an empty round', () async {
      expect((await repo.countRoundDecision(
              recruiterId: rec, testId: test1, roundId: ''))
          .isKnown, isFalse);
      expect((await repo.countRoundDecision(
              recruiterId: '', testId: test1, roundId: round1))
          .isKnown, isFalse);
    });

    test('more decided than scored never reads as negative', () {
      // Defensive: an outcome written onto an unscored assignment (the
      // clearEarlierRoundsFor path does exactly that) must not push the count
      // below zero and out of "nothing waiting".
      const t = RoundDecisionTally(scored: 2, decided: 5);
      expect(t.pending, 0);
    });
  });

  group('the words a round reads in', () {
    final now = DateTime.utc(2026, 8, 24, 12, 0);

    // `closedBy` is what separates "you ended this" from "the deadline passed",
    // and it is only stored when a recruiter presses the button.
    InterviewRound round({
      DateTime? closesAt,
      DateTime? closedAt,
      RoundClosedBy? closedBy,
    }) =>
        InterviewRound(
          id: 'r1',
          testId: test1,
          recruiterId: rec,
          order: 0,
          title: 'Screening',
          kind: RoundKind.chat,
          closesAt: closesAt,
          closedAt: closedAt,
          closedBy: closedBy,
        );

    InterviewRound endedByHand() => round(
          closedAt: now.subtract(const Duration(hours: 1)),
          closedBy: RoundClosedBy.manual,
        );

    test('an open round is unaffected by any decision count', () {
      final open = round(closesAt: now.add(const Duration(days: 2)));
      expect(
        roundStatusLine(open, now, const RoundDecisionTally(scored: 9, decided: 0)),
        startsWith('Open'),
      );
    });

    test('a closed round with people waiting says how many', () {
      // The line that makes an auto-closed round distinguishable from a
      // finished one. Before this they read identically.
      final closed = round(closesAt: now.subtract(const Duration(hours: 1)));
      expect(
        roundStatusLine(closed, now, const RoundDecisionTally(scored: 12, decided: 0)),
        'Closed · 12 to decide',
      );
    });

    test('ended by hand keeps saying so, and adds the count', () {
      final closed = endedByHand();
      expect(
        roundStatusLine(closed, now, const RoundDecisionTally(scored: 4, decided: 1)),
        'Ended by you · 3 to decide',
      );
    });

    test('everybody decided reads as Done', () {
      final closed = endedByHand();
      expect(
        roundStatusLine(closed, now, const RoundDecisionTally(scored: 5, decided: 5)),
        'Done',
      );
    });

    test('a closed round nobody sat is not "Done" — there was nothing to do', () {
      final closed = endedByHand();
      expect(
        roundStatusLine(closed, now, const RoundDecisionTally(scored: 0, decided: 0)),
        'Ended by you',
      );
    });

    test('an unknown count never claims Done', () {
      // Offline, or an index missing. Saying "Done" here would tell the
      // recruiter a decision was made that may not have been.
      final closed = endedByHand();
      expect(roundStatusLine(closed, now, null), 'Ended by you');
      expect(roundStatusLine(closed, now, const RoundDecisionTally.unknown()),
          'Ended by you');
    });
  });
}

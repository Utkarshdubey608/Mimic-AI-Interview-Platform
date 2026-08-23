// test/reopen_round_test.dart
//
// The undo for "End round now".
//
// Ending a round writes two things: the flags on the round, and an `expiresAt`
// of NOW onto every unfinished candidate — the second is the one that actually
// locks them out, because it is the only thing their device reads. So the undo
// has to unwind both; clearing `closedAt` alone reopens a round that every
// candidate still cannot enter.
//
// The other trap is the clock. A round whose own deadline has passed is closed
// no matter what the flags say, so reopening one of those has to be given a new
// window — and the caller has to choose it, because silently dropping a
// deadline changes the round's design behind the recruiter's back.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';

/// Firestore hands timestamps back in local time; these tests are written in
/// UTC. Compare the instant, not the flag.
Matcher sameInstantAs(DateTime expected) => predicate<DateTime>(
    (actual) => actual.isAtSameMomentAs(expected), 'is $expected');

void main() {
  late FakeFirebaseFirestore db;
  late InterviewRepository repo;

  const rec = 'rec1';
  const testId = 't1';
  const roundId = 'r1';
  final now = DateTime.utc(2026, 8, 24, 12, 0);

  setUp(() {
    db = FakeFirebaseFirestore();
    repo = InterviewRepository(firestore: db);
  });

  InterviewRound round({DateTime? closesAt, DateTime? opensAt}) =>
      InterviewRound(
        id: roundId,
        testId: testId,
        recruiterId: rec,
        order: 0,
        title: 'Screening',
        kind: RoundKind.chat,
        opensAt: opensAt,
        closesAt: closesAt,
      );

  Future<void> seedRound({DateTime? closesAt}) =>
      db.collection('tests').doc(testId).collection('rounds').doc(roundId).set({
        'recruiterId': rec,
        'order': 0,
        'title': 'Screening',
        'kind': 'chat',
        if (closesAt != null) 'closesAt': Timestamp.fromDate(closesAt),
        'closedAt': Timestamp.fromDate(now),
        'closedBy': 'manual',
      });

  Future<String> seedCandidate({
    String status = 'assigned',
    String? outcome,
  }) async {
    final ref = await db.collection('interviews').add({
      'recruiterId': rec,
      'testId': testId,
      'roundId': roundId,
      'candidateEmailLower': 'ada@x.com',
      'status': status,
      // What endRound stamped: access revoked as of the moment it closed.
      'expiresAt': Timestamp.fromDate(now),
      if (outcome != null) 'result': {'outcome': outcome, 'overallScore': 70},
    });
    return ref.id;
  }

  Future<Map<String, dynamic>> readRound() async {
    final doc = await db
        .collection('tests')
        .doc(testId)
        .collection('rounds')
        .doc(roundId)
        .get();
    return doc.data()!;
  }

  test('it clears the flags that closed the round', () async {
    await seedRound(closesAt: now.add(const Duration(days: 2)));
    await repo.reopenRound(round(closesAt: now.add(const Duration(days: 2))));

    final r = await readRound();
    expect(r['closedAt'], isNull);
    expect(r['closedBy'], isNull);
  });

  test('an unfinished candidate gets their access back', () async {
    // The half of the undo that actually matters to the person taking it.
    final deadline = now.add(const Duration(days: 2));
    await seedRound(closesAt: deadline);
    final id = await seedCandidate();

    await repo.reopenRound(round(closesAt: deadline));

    final doc = await db.collection('interviews').doc(id).get();
    expect((doc.data()!['expiresAt'] as Timestamp).toDate(),
        sameInstantAs(deadline),
        reason: 'expiresAt must be the round window again, not the close time');
  });

  test('the round keeps its own deadline when it is still ahead', () async {
    // The straight undo: nothing about the round's design changes.
    final deadline = now.add(const Duration(days: 2));
    await seedRound(closesAt: deadline);

    await repo.reopenRound(round(closesAt: deadline));

    final r = await readRound();
    expect((r['closesAt'] as Timestamp).toDate(), sameInstantAs(deadline));
  });

  test('clearDeadline reopens it open-ended', () async {
    final passed = now.subtract(const Duration(days: 1));
    await seedRound(closesAt: passed);
    final id = await seedCandidate();

    await repo.reopenRound(round(closesAt: passed), clearDeadline: true);

    final r = await readRound();
    expect(r['closesAt'], isNull);
    expect(r['closedAt'], isNull);
    // And the candidate is no longer expired — there is nothing to expire.
    final doc = await db.collection('interviews').doc(id).get();
    expect(doc.data()!['expiresAt'], isNull);
  });

  test('a new deadline is written and propagated', () async {
    final passed = now.subtract(const Duration(days: 1));
    final extended = now.add(const Duration(days: 3));
    await seedRound(closesAt: passed);
    final id = await seedCandidate();

    await repo.reopenRound(round(closesAt: passed), newClosesAt: extended);

    final r = await readRound();
    expect((r['closesAt'] as Timestamp).toDate(), sameInstantAs(extended));
    final doc = await db.collection('interviews').doc(id).get();
    expect((doc.data()!['expiresAt'] as Timestamp).toDate(),
        sameInstantAs(extended));
  });

  test('a decision already published is left alone', () async {
    // Reopening a round means "let them keep going", not "unsay what the
    // candidates were told".
    final deadline = now.add(const Duration(days: 2));
    await seedRound(closesAt: deadline);
    final id = await seedCandidate(status: 'completed', outcome: 'selected');

    await repo.reopenRound(round(closesAt: deadline));

    final doc = await db.collection('interviews').doc(id).get();
    expect((doc.data()!['result'] as Map)['outcome'], 'selected');
    // Completed assignments are not rewritten at all — the interview is over.
    expect((doc.data()!['expiresAt'] as Timestamp).toDate(), sameInstantAs(now));
  });

  group('does reopening need a new deadline?', () {
    test('yes when the round\'s own deadline has passed', () {
      expect(
        round(closesAt: now.subtract(const Duration(minutes: 1)))
            .reopenNeedsDeadline(now),
        isTrue,
      );
    });

    test('no when the deadline is still ahead', () {
      expect(
        round(closesAt: now.add(const Duration(minutes: 1)))
            .reopenNeedsDeadline(now),
        isFalse,
      );
    });

    test('no when it never had one — it was only ever closed by hand', () {
      expect(round().reopenNeedsDeadline(now), isFalse);
    });

    test('the deadline landing exactly now counts as passed', () {
      expect(round(closesAt: now).reopenNeedsDeadline(now), isTrue);
    });
  });
}

// test/candidate_grouping_test.dart
//
// One candidate in three rounds is three `interviews` documents. The recruiter's
// all-rounds list read those as three candidates, which is the bug these
// helpers close, so what is asserted here is the display invariant: a person's
// rounds are adjacent, in round order, and counted as ONE candidate.

import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/recruiter/candidate_grouping.dart';

void main() {
  Interview assignment(
    String email, {
    String roundId = '',
    int? roundOrder,
    String? emailLower,
    String? id,
  }) =>
      Interview(
        id: id ?? '$email-${roundId.isEmpty ? 'legacy' : roundId}',
        testId: 't1',
        roundId: roundId,
        roundOrder: roundOrder,
        recruiterId: 'rec',
        recruiterEmail: 'rec@co.com',
        candidateEmail: email,
        candidateEmailLower: emailLower ?? email.toLowerCase(),
        type: InterviewType.chat,
        title: 'Round',
        prompt: '',
        questions: const [],
        avatar: const AvatarConfig(replicaId: ''),
        durationMinutes: 15,
        status: InterviewStatus.assigned,
      );

  List<String> ids(List<Interview> rows) => rows.map((i) => i.id).toList();

  group('groupRoundsByCandidate', () {
    test("a candidate's rounds become adjacent, in round order", () {
      // As the query returns them: newest first, so rounds are interleaved and
      // each person's later round arrives BEFORE their earlier one.
      final rows = [
        assignment('a@b.com', roundId: 'r2', roundOrder: 1),
        assignment('b@b.com', roundId: 'r2', roundOrder: 1),
        assignment('a@b.com', roundId: 'r1', roundOrder: 0),
        assignment('b@b.com', roundId: 'r1', roundOrder: 0),
      ];

      expect(
        ids(groupRoundsByCandidate(rows)),
        ['a@b.com-r1', 'a@b.com-r2', 'b@b.com-r1', 'b@b.com-r2'],
      );
    });

    test('candidates keep their incoming (newest-first) order', () {
      final rows = [
        assignment('newest@b.com', roundId: 'r1', roundOrder: 0),
        assignment('older@b.com', roundId: 'r2', roundOrder: 1),
        assignment('older@b.com', roundId: 'r1', roundOrder: 0),
      ];

      expect(ids(groupRoundsByCandidate(rows)).first, 'newest@b.com-r1');
    });

    test('nothing is dropped or duplicated', () {
      final rows = [
        assignment('a@b.com', roundId: 'r1', roundOrder: 0),
        assignment('a@b.com', roundId: 'r2', roundOrder: 1),
        assignment('c@b.com', roundId: 'r1', roundOrder: 0),
      ];
      final grouped = groupRoundsByCandidate(rows);
      expect(grouped, hasLength(rows.length));
      expect(ids(grouped).toSet(), ids(rows).toSet());
    });

    test('matches on the lower-cased email, not what the recruiter typed', () {
      final rows = [
        assignment('A.B@Co.com', roundId: 'r2', roundOrder: 1,
            emailLower: 'a.b@co.com'),
        assignment('a.b@co.com', roundId: 'r1', roundOrder: 0),
      ];

      expect(distinctCandidateCount(rows), 1);
      expect(ids(groupRoundsByCandidate(rows)),
          ['a.b@co.com-r1', 'A.B@Co.com-r2']);
    });

    test('pre-timeline rows, which all report round 0, keep arrival order', () {
      // `List.sort` is not stable, so equal round orders need the explicit
      // tie-break — otherwise these two could swap between rebuilds.
      final first = assignment('a@b.com', id: 'a@b.com-first');
      final second = assignment('a@b.com', id: 'a@b.com-second');
      final grouped = groupRoundsByCandidate([first, second]);
      expect(ids(grouped), [first.id, second.id]);
    });

    test('a round-less row sorts ahead of the rounds added later', () {
      // "Assign a single-round test, then add rounds": the original assignment
      // carries no roundId and is treated as round 1.
      final rows = [
        assignment('a@b.com', roundId: 'r2', roundOrder: 1),
        assignment('a@b.com'),
      ];
      expect(ids(groupRoundsByCandidate(rows)),
          ['a@b.com-legacy', 'a@b.com-r2']);
    });

    test('an empty page groups to nothing', () {
      expect(groupRoundsByCandidate(const []), isEmpty);
    });
  });

  group('distinctCandidateCount', () {
    test('counts people, not assignments', () {
      final rows = [
        assignment('a@b.com', roundId: 'r1', roundOrder: 0),
        assignment('a@b.com', roundId: 'r2', roundOrder: 1),
        assignment('a@b.com', roundId: 'r3', roundOrder: 2),
        assignment('b@b.com', roundId: 'r1', roundOrder: 0),
      ];
      expect(rows, hasLength(4));
      expect(distinctCandidateCount(rows), 2);
    });

    test('falls back to normalising candidateEmail when the copy is missing', () {
      final rows = [
        assignment('A@B.com', roundId: 'r1', roundOrder: 0, emailLower: ''),
        assignment('a@b.com', roundId: 'r2', roundOrder: 1),
      ];
      expect(distinctCandidateCount(rows), 1);
    });
  });
}

// test/final_result_prefill_test.dart
//
// The final-result screen's starting point, and what counts as "finished".
//
// Two bugs are pinned here, both reported from a real pipeline whose last round
// had closed:
//
//   1. "Nobody has finished yet." A run was only finished when every round was
//      COMPLETED, so the people who never submitted were never finished — and a
//      round that closed on them left the whole screen empty with no way
//      forward. A closed round is over for everyone in it.
//   2. The screen then asked the recruiter to tick, from scratch, who had
//      cleared the process — a decision they had already made round by round.
//      It now starts from the pipeline's own answer.

import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/test_conclusion.dart';
import 'package:talbotiq/features/interviews/recruiter/candidate_grouping.dart';
import 'package:talbotiq/shared/models/app_models.dart';

final _now = DateTime.utc(2026, 8, 24, 12, 0);

Interview _round(
  String email, {
  required int order,
  InterviewStatus status = InterviewStatus.completed,
  DateTime? expiresAt,
  String? outcome,
  Map<String, dynamic>? conclusion,
}) =>
    Interview(
      id: '$email-r$order',
      testId: 't1',
      roundId: 'r$order',
      roundOrder: order,
      recruiterId: 'rec',
      recruiterEmail: 'rec@co.com',
      candidateEmail: email,
      candidateEmailLower: email,
      candidateName: email.split('@').first,
      type: InterviewType.chat,
      title: 'Round ${order + 1}',
      prompt: '',
      questions: const [],
      avatar: const AvatarConfig(replicaId: ''),
      durationMinutes: 15,
      status: status,
      expiresAt: expiresAt,
      result: outcome == null ? null : {'overallScore': 70, 'outcome': outcome},
      conclusion: conclusion,
    );

CandidateRun _run(List<Interview> rounds) => runsFor(rounds).single;

void main() {
  group('when is a candidate finished?', () {
    test('every round completed — the easy case', () {
      expect(_run([_round('a@x.com', order: 0)]).isFinishedAt(_now), isTrue);
    });

    test('a round they never submitted, still open, is not finished', () {
      final run = _run([
        _round('a@x.com',
            order: 0,
            status: InterviewStatus.assigned,
            expiresAt: _now.add(const Duration(days: 2))),
      ]);
      expect(run.isFinishedAt(_now), isFalse,
          reason: 'they can still sit it — concluding now would cut it short');
    });

    test('a CLOSED round they never submitted IS finished', () {
      // The reported bug. Its expiry is in the past — which is what both a
      // passed deadline and an early "end round now" leave behind.
      final run = _run([
        _round('a@x.com',
            order: 0,
            status: InterviewStatus.assigned,
            expiresAt: _now.subtract(const Duration(hours: 1))),
      ]);
      expect(run.isFinishedAt(_now), isTrue);
    });

    test('a round with no deadline at all, unsubmitted, is not finished', () {
      // Nothing has closed it, so there is nothing to conclude.
      final run = _run([
        _round('a@x.com', order: 0, status: InterviewStatus.assigned),
      ]);
      expect(run.isFinishedAt(_now), isFalse);
    });

    test('mixed: one round sat, one closed unsubmitted — finished', () {
      final run = _run([
        _round('a@x.com', order: 0, outcome: 'selected'),
        _round('a@x.com',
            order: 1,
            status: InterviewStatus.assigned,
            expiresAt: _now.subtract(const Duration(minutes: 5))),
      ]);
      expect(run.isFinishedAt(_now), isTrue);
    });

    test('mixed: one round sat, one still open — not finished', () {
      final run = _run([
        _round('a@x.com', order: 0, outcome: 'selected'),
        _round('a@x.com',
            order: 1,
            status: InterviewStatus.assigned,
            expiresAt: _now.add(const Duration(days: 1))),
      ]);
      expect(run.isFinishedAt(_now), isFalse);
    });
  });

  group('what the last round decided', () {
    test('advanced out of the last round they hold', () {
      final run = _run([
        _round('a@x.com', order: 0, outcome: 'selected'),
        _round('a@x.com', order: 1, outcome: 'selected'),
      ]);
      expect(run.latestOutcome, RoundOutcome.selected);
      expect(run.advancedFromLastRound, isTrue);
    });

    test('turned down in their last round, whatever the earlier ones said', () {
      // Cleared round 1, dropped in round 2 — the pipeline's answer is round 2.
      final run = _run([
        _round('a@x.com', order: 0, outcome: 'selected'),
        _round('a@x.com', order: 1, outcome: 'not_selected'),
      ]);
      expect(run.advancedFromLastRound, isFalse);
    });

    test('an undecided last round is not an advance', () {
      final run = _run([_round('a@x.com', order: 0)]);
      expect(run.latestOutcome, RoundOutcome.pending);
      expect(run.advancedFromLastRound, isFalse);
    });
  });

  group('the final-result pre-fill', () {
    test('advanced becomes cleared, everyone else not selected', () {
      final ada = _run([_round('ada@x.com', order: 0, outcome: 'selected')]);
      final bo = _run([_round('bo@x.com', order: 0, outcome: 'not_selected')]);
      final cy = _run([_round('cy@x.com', order: 0)]);

      expect(conclusionPrefill([ada, bo, cy]), {
        'ada@x.com': TestOutcome.cleared,
        'bo@x.com': TestOutcome.notSelected,
        'cy@x.com': TestOutcome.notSelected,
      });
    });

    test('an already-published conclusion wins over the rounds', () {
      // Re-opening the screen shows the state of the world; it does not propose
      // to overwrite what somebody was already told.
      final held = _run([
        _round('h@x.com',
            order: 0,
            outcome: 'selected',
            conclusion: {
              'outcome': 'on_hold',
              'message': 'sitting tight',
              'publishedAt': null,
            }),
      ]);

      expect(conclusionPrefill([held])['h@x.com'], TestOutcome.onHold);
    });

    test('an empty pipeline pre-fills nothing', () {
      expect(conclusionPrefill(const []), isEmpty);
    });
  });
}

// test/round_pipeline_status_test.dart
//
// The "which round is this test on?" reduction behind the recruiter dashboard's
// multi-round row. Pure clock-and-ordering logic, so it is tested here rather
// than through the widget.

import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';

final _now = DateTime.utc(2026, 8, 23, 12, 0);

InterviewRound _round({
  required int order,
  String? title,
  DateTime? opensAt,
  DateTime? closesAt,
  DateTime? closedAt,
  RoundKind kind = RoundKind.chat,
}) =>
    InterviewRound(
      id: 'r$order',
      testId: 't1',
      recruiterId: 'rec1',
      order: order,
      title: title ?? 'Round ${order + 1}',
      kind: kind,
      opensAt: opensAt,
      closesAt: closesAt,
      closedAt: closedAt,
    );

void main() {
  test('a test with no rounds has no pipeline to describe', () {
    // A legacy single-interview test predates the timeline entirely; dressing
    // it up as "round 1 of 1" would invent structure that isn't there.
    expect(RoundPipelineStatus.from(const [], _now), isNull);
  });

  test('a single round is a pipeline but not a multi-round one', () {
    final s = RoundPipelineStatus.from([_round(order: 0)], _now)!;
    expect(s.total, 1);
    expect(s.isMultiRound, isFalse);
  });

  group('the current round', () {
    test('is the open one, with earlier rounds counted as closed', () {
      final s = RoundPipelineStatus.from([
        _round(order: 0, closedAt: _now.subtract(const Duration(days: 3))),
        _round(order: 1, title: 'Technical screen'),
        _round(order: 2, opensAt: _now.add(const Duration(days: 5))),
      ], _now)!;

      expect(s.stage, PipelineStage.active);
      expect(s.currentIndex, 1);
      expect(s.current.title, 'Technical screen');
      expect(s.closedCount, 1);
      expect(s.positionLabel, 'Round 2 of 3');
    });

    test('is the FIRST open round when two are open at once', () {
      // Round 1 left open by mistake while round 2 opened on schedule. The
      // recruiter needs pointing at the stale one, not the newest.
      final s = RoundPipelineStatus.from([
        _round(order: 0, title: 'Résumé screen', kind: RoundKind.resume),
        _round(order: 1, title: 'Technical screen'),
      ], _now)!;

      expect(s.stage, PipelineStage.active);
      expect(s.current.title, 'Résumé screen');
    });

    test('is the next scheduled round when nothing is open yet', () {
      final s = RoundPipelineStatus.from([
        _round(order: 0, closedAt: _now.subtract(const Duration(days: 1))),
        _round(order: 1, opensAt: _now.add(const Duration(days: 2))),
      ], _now)!;

      expect(s.stage, PipelineStage.upcoming);
      expect(s.currentIndex, 1);
      expect(s.stateLabel, 'Opens in 2d');
    });

    test('is the last round once every round has closed', () {
      final s = RoundPipelineStatus.from([
        _round(order: 0, closedAt: _now.subtract(const Duration(days: 9))),
        _round(order: 1, closesAt: _now.subtract(const Duration(days: 2))),
      ], _now)!;

      expect(s.stage, PipelineStage.complete);
      expect(s.currentIndex, 1);
      expect(s.closedCount, 2);
      expect(s.stateLabel, 'All rounds closed');
      expect(s.summaryLabel, '2 rounds · All rounds closed');
    });
  });

  test('rounds are re-sorted, so a half-applied reorder cannot mislabel', () {
    // Fed deliberately out of order: the query sorts by `order`, but trusting
    // the caller would report "round 1 of 3" for the round sitting at order 2.
    final s = RoundPipelineStatus.from([
      _round(order: 2, title: 'Final'),
      _round(order: 0, closedAt: _now.subtract(const Duration(days: 4))),
      _round(order: 1, title: 'Technical screen'),
    ], _now)!;

    expect(s.rounds.map((r) => r.order), [0, 1, 2]);
    expect(s.currentIndex, 1);
    expect(s.current.title, 'Technical screen');
  });

  group('the deadline reading', () {
    test('an open round with a deadline says how long is left', () {
      final s = RoundPipelineStatus.from([
        _round(order: 0, closesAt: _now.add(const Duration(days: 2, hours: 5))),
      ], _now)!;
      // Rounds down, per formatDurationShort — never claims more time than left.
      expect(s.stateLabel, 'Open · 2d left');
    });

    test('an open-ended round just reads as open', () {
      final s = RoundPipelineStatus.from([_round(order: 0)], _now)!;
      expect(s.stateLabel, 'Open');
    });

    test('the summary names the round the recruiter should look at', () {
      final s = RoundPipelineStatus.from([
        _round(order: 0, closedAt: _now.subtract(const Duration(days: 1))),
        _round(
            order: 1,
            title: 'Technical screen',
            closesAt: _now.add(const Duration(hours: 6))),
      ], _now)!;

      expect(s.summaryLabel, 'Round 2 of 2 · Technical screen · Open · 6h left');
    });
  });

  test('a long pipeline still reports a sane position', () {
    // There is no cap on rounds in the builder, so the dashboard strip has to
    // cope with a pipeline far longer than the usual three or four.
    final rounds = [
      for (var k = 0; k < 12; k++)
        _round(
          order: k,
          closedAt: k < 7 ? _now.subtract(const Duration(days: 1)) : null,
        ),
    ];
    final s = RoundPipelineStatus.from(rounds, _now)!;

    expect(s.total, 12);
    expect(s.closedCount, 7);
    expect(s.currentIndex, 7);
    expect(s.positionLabel, 'Round 8 of 12');
  });

  test('a closedAt in the past beats a closesAt in the future', () {
    // Ending a round by hand closes it regardless of its scheduled window;
    // the pipeline must not report it as still open.
    final s = RoundPipelineStatus.from([
      _round(
        order: 0,
        closesAt: _now.add(const Duration(days: 5)),
        closedAt: _now.subtract(const Duration(hours: 1)),
      ),
    ], _now)!;

    expect(s.stage, PipelineStage.complete);
    expect(s.closedCount, 1);
  });

  group('the round a decision is owed on', () {
    test('nothing is closed yet, so nothing is owed', () {
      final s = RoundPipelineStatus.from([
        _round(order: 0, closesAt: _now.add(const Duration(days: 2))),
        _round(order: 1),
      ], _now)!;

      expect(s.latestClosedIndex, isNull);
      expect(s.latestClosed, isNull);
    });

    test('a round past its deadline counts exactly like one closed by hand', () {
      // The asymmetry this pins: nothing is written when a deadline passes, so
      // an auto-closed round used to sit undecided in silence while a
      // hand-closed one prompted.
      final auto = RoundPipelineStatus.from([
        _round(order: 0, closesAt: _now.subtract(const Duration(hours: 1))),
      ], _now)!;
      final byHand = RoundPipelineStatus.from([
        _round(order: 0, closedAt: _now.subtract(const Duration(hours: 1))),
      ], _now)!;

      expect(auto.latestClosedIndex, 0);
      expect(byHand.latestClosedIndex, 0);
    });

    test('with two rounds closed it is the LATER one that is waiting', () {
      // Putting anybody into round 2 settles round 1, so round 1 is not what
      // the recruiter is being asked about.
      final s = RoundPipelineStatus.from([
        _round(order: 0, closedAt: _now.subtract(const Duration(days: 3))),
        _round(order: 1, closedAt: _now.subtract(const Duration(days: 1))),
        _round(order: 2, opensAt: _now.add(const Duration(days: 1))),
      ], _now)!;

      expect(s.latestClosedIndex, 1);
      expect(s.latestClosed?.id, 'r1');
      // ...and the pipeline still reads as pending, not finished.
      expect(s.stage, PipelineStage.upcoming);
    });

    test('a closed round is still the one owed while a LATER one is open', () {
      // Round 2 opening does not settle round 1: candidates can be advanced
      // into an already-open round, and whoever was not advanced is still
      // waiting to be told.
      final s = RoundPipelineStatus.from([
        _round(order: 0, closedAt: _now.subtract(const Duration(days: 1))),
        _round(order: 1, closesAt: _now.add(const Duration(days: 4))),
      ], _now)!;

      expect(s.latestClosedIndex, 0);
      expect(s.currentIndex, 1, reason: 'the OPEN round is still the current one');
    });

    test('every round closed — the last one is the decision', () {
      final s = RoundPipelineStatus.from([
        for (var k = 0; k < 3; k++)
          _round(order: k, closedAt: _now.subtract(Duration(days: 3 - k))),
      ], _now)!;

      expect(s.stage, PipelineStage.complete);
      expect(s.latestClosedIndex, 2);
    });
  });
}

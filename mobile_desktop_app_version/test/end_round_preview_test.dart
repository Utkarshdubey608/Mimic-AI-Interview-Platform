// test/end_round_preview_test.dart
//
// The preview shown BEFORE a round is ended: what ending it would decide.
//
// The failure it exists for: the old confirm dialog said "the round closes
// immediately for 18 candidate(s)" and nothing else. The recruiter committed to
// the outcome without seeing a name, and the advance rule they had written
// weeks earlier ("top 3", "60 or above") was applied later, on another screen,
// to a list they had not looked at.
//
// So the rules pinned here are:
//
//   * The pre-tick comes from the round's OWN advance rule — the same function
//     the review screen uses, so the preview cannot promise one thing and the
//     next screen do another.
//   * Candidates who never submitted are listed and tickable. No rule reaches
//     them, but a recruiter waiving a round for one person needs to say so, and
//     before this there was no screen on which they could.
//   * Cancelling and "end it with nobody advancing" are different answers.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/core/theme/app_theme.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/shared/models/app_models.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/end_round_preview_sheet.dart';

Interview _candidate(String name, {int? score}) => Interview(
      id: 'i-$name',
      testId: 't1',
      roundId: 'r1',
      recruiterId: 'rec1',
      recruiterEmail: 'rec@co.com',
      candidateEmail: '$name@x.com',
      candidateEmailLower: '$name@x.com',
      candidateName: name,
      type: InterviewType.chat,
      title: 'Screening',
      prompt: '',
      questions: const [],
      avatar: const AvatarConfig(replicaId: ''),
      durationMinutes: 15,
      status: score == null
          ? InterviewStatus.assigned
          : InterviewStatus.completed,
      result: score == null ? null : {'overallScore': score},
    );

InterviewRound _round({
  AdvanceMode mode = AdvanceMode.topN,
  double? value = 2,
  String title = 'Screening',
}) =>
    InterviewRound(
      id: 'r1',
      testId: 't1',
      recruiterId: 'rec1',
      order: 0,
      title: title,
      kind: RoundKind.chat,
      advance: RoundAdvance(mode: mode, value: value),
    );

void main() {
  final ranked = [
    _candidate('Ada', score: 91),
    _candidate('Bo', score: 74),
    _candidate('Cy', score: 52),
  ];
  final notSubmitted = [_candidate('Dee'), _candidate('Eve')];

  group('scoring helpers', () {
    test('a candidate with no result has no score', () {
      expect(scoreOf(_candidate('x')), isNull);
      expect(scoreOf(_candidate('y', score: 60)), 60);
    });

    test('notSubmittedIn picks out exactly the unscored', () {
      final all = [...ranked, ...notSubmitted];
      expect(notSubmittedIn(all).map((i) => i.candidateName),
          ['Dee', 'Eve']);
    });
  });

  Future<Set<String>?> open(
    WidgetTester tester, {
    required InterviewRound round,
    List<Interview>? ranked,
    List<Interview>? notSubmitted,
    InterviewRound? nextRound,
    required Future<void> Function(WidgetTester t) act,
  }) async {
    Set<String>? result;
    var returned = false;

    await tester.pumpWidget(MaterialApp(
      theme: WarmSurfaces.theme(AppTheme.darkTheme),
      home: Scaffold(
        body: Builder(builder: (context) {
          return TextButton(
            onPressed: () async {
              result = await EndRoundPreviewSheet.show(
                context,
                round: round,
                ranked: ranked ?? const [],
                notSubmitted: notSubmitted ?? const [],
                nextRound: nextRound,
              );
              returned = true;
            },
            child: const Text('open'),
          );
        }),
      ),
    ));

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    await act(tester);
    await tester.pumpAndSettle();

    expect(returned, isTrue, reason: 'the sheet never returned');
    return result;
  }

  group('the preview', () {
    testWidgets('a top-N rule pre-ticks the top N, and says so',
        (tester) async {
      final result = await open(
        tester,
        round: _round(mode: AdvanceMode.topN, value: 2),
        ranked: ranked,
        notSubmitted: notSubmitted,
        nextRound: _round(title: 'AI interview'),
        act: (t) async {
          expect(find.text('2 of 5 would advance to "AI interview".'),
              findsOneWidget);
          expect(find.textContaining('top 2 by score'), findsOneWidget);
          await t.tap(find.text('End round'));
        },
      );

      expect(result, {'i-Ada', 'i-Bo'});
    });

    testWidgets('a threshold rule pre-ticks everyone over the bar',
        (tester) async {
      final result = await open(
        tester,
        round: _round(mode: AdvanceMode.threshold, value: 70),
        ranked: ranked,
        act: (t) async {
          expect(find.text('2 of 3 would be marked as moving forward.'),
              findsOneWidget);
          await t.tap(find.text('End round'));
        },
      );

      expect(result, {'i-Ada', 'i-Bo'});
    });

    testWidgets('a manual rule pre-ticks nobody', (tester) async {
      // The recruiter said they would pick; pre-ticking names would put words
      // in their mouth.
      final result = await open(
        tester,
        round: _round(mode: AdvanceMode.manual, value: null),
        ranked: ranked,
        act: (t) async {
          expect(find.textContaining('nobody is pre-selected'), findsOneWidget);
          await t.tap(find.text('End round'));
        },
      );

      expect(result, isEmpty,
          reason: 'ending with nobody advancing is a real outcome');
    });

    testWidgets('the pre-tick can be edited either way', (tester) async {
      final result = await open(
        tester,
        round: _round(mode: AdvanceMode.topN, value: 2),
        ranked: ranked,
        act: (t) async {
          await t.tap(find.text('Bo')); // drop the rule's second pick
          await t.pump();
          await t.tap(find.text('Cy')); // and promote the third
          await t.pump();
          await t.tap(find.text('End round'));
        },
      );

      expect(result, {'i-Ada', 'i-Cy'});
    });

    testWidgets('somebody who never submitted can still be advanced',
        (tester) async {
      final result = await open(
        tester,
        round: _round(mode: AdvanceMode.manual, value: null),
        ranked: ranked,
        notSubmitted: notSubmitted,
        act: (t) async {
          expect(find.text('No submission'), findsNWidgets(2));
          await t.tap(find.text('Dee'));
          await t.pump();
          await t.tap(find.text('End round'));
        },
      );

      expect(result, {'i-Dee'});
    });

    testWidgets('it says what ending the round costs the unfinished',
        (tester) async {
      await open(
        tester,
        round: _round(),
        ranked: ranked,
        notSubmitted: notSubmitted,
        act: (t) async {
          expect(find.textContaining('2 candidates have not submitted'),
              findsOneWidget);
          expect(find.textContaining('takes their access away'), findsOneWidget);
          await t.tap(find.text('Cancel'));
        },
      );
    });

    testWidgets('cancelling is not the same as advancing nobody',
        (tester) async {
      final result = await open(
        tester,
        round: _round(),
        ranked: ranked,
        act: (t) async => t.tap(find.text('Cancel')),
      );

      expect(result, isNull,
          reason: 'null means the round was never ended at all');
    });

    testWidgets('an empty round is still closeable', (tester) async {
      final result = await open(
        tester,
        round: _round(),
        act: (t) async {
          expect(find.text('Nobody is in this round yet.'), findsOneWidget);
          await t.tap(find.text('End round'));
        },
      );

      expect(result, isEmpty);
    });

    testWidgets('rows are ranked, so the order matches the decision',
        (tester) async {
      await open(
        tester,
        round: _round(),
        ranked: ranked,
        act: (t) async {
          final adaY = t.getCenter(find.text('Ada')).dy;
          final cyY = t.getCenter(find.text('Cy')).dy;
          expect(adaY, lessThan(cyY), reason: 'best score first');
          expect(find.text('1'), findsOneWidget);
          expect(find.text('91'), findsOneWidget);
          await t.tap(find.text('Cancel'));
        },
      );
    });
  });
}

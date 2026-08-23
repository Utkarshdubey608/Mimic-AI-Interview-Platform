// test/round_step_tile_test.dart
//
// The shared timeline step. Worth widget-testing because it is now the SINGLE
// renderer for a round in three places — the create form's builder, the edit
// form's round list, and the live timeline screen — so a regression here shows up
// everywhere at once. It is also the only round UI with no Firebase in its path,
// which makes it the one that can actually be tested.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/round_step_tile.dart';

InterviewRound _round({
  String title = 'Résumé screen',
  RoundKind kind = RoundKind.resume,
  DateTime? opensAt,
  DateTime? closesAt,
  Map<String, dynamic> config = const {},
}) =>
    InterviewRound(
      id: 'r1',
      testId: 't1',
      recruiterId: 'rec-1',
      order: 0,
      title: title,
      kind: kind,
      config: config,
      opensAt: opensAt,
      closesAt: closesAt,
    );

Future<void> _pump(WidgetTester tester, Widget child) => tester.pumpWidget(
      MaterialApp(home: Scaffold(body: SingleChildScrollView(child: child))),
    );

void main() {
  testWidgets('shows the step position, kind and question count', (t) async {
    await _pump(
      t,
      RoundStepTile(
        round: _round(
          title: 'Tech round',
          kind: RoundKind.chat,
          config: const {'questions': ['a', 'b', 'c']},
        ),
        position: 2,
        total: 4,
      ),
    );

    expect(find.text('2'), findsOneWidget);
    expect(find.text('Tech round'), findsOneWidget);
    // The sequence has to be legible from the row itself.
    expect(find.text('Step 2 of 4 · Chat interview · 3 question(s)'),
        findsOneWidget);
  });

  testWidgets('a résumé round reports no question count', (t) async {
    await _pump(t, RoundStepTile(round: _round(), position: 1, total: 2));
    // It has no session, so "0 question(s)" would be noise pretending to be data.
    expect(find.text('Step 1 of 2 · Résumé screen'), findsOneWidget);
  });

  testWidgets('an untitled draft is labelled rather than blank', (t) async {
    await _pump(
      t,
      RoundStepTile(round: _round(title: ''), position: 1, total: 1),
    );
    expect(find.text('Untitled round'), findsOneWidget);
  });

  group('the window line', () {
    test('says so plainly when there are no dates', () {
      expect(roundWindowLabel(_round()), 'No dates — closed by hand');
    });

    test('renders one-sided windows', () {
      expect(
        roundWindowLabel(_round(opensAt: DateTime(2026, 8, 12, 9))),
        'From 2026-08-12 09:00',
      );
      expect(
        roundWindowLabel(_round(closesAt: DateTime(2026, 8, 20, 17, 30))),
        'Until 2026-08-20 17:30',
      );
    });

    test('renders a full window as a range', () {
      expect(
        roundWindowLabel(_round(
          opensAt: DateTime(2026, 8, 12, 9),
          closesAt: DateTime(2026, 8, 20, 17),
        )),
        '2026-08-12 09:00 → 2026-08-20 17:00',
      );
    });
  });

  test('each kind has exactly one icon', () {
    // Shared so the same kind can never show two different icons across the
    // three screens that render it.
    final icons = {
      for (final k in RoundKind.values) k: roundKindIcon(k),
    };
    expect(icons.values.toSet().length, RoundKind.values.length);
    expect(icons[RoundKind.resume], Icons.description_outlined);
    expect(icons[RoundKind.video], Icons.videocam_outlined);
  });

  testWidgets('the state chip and candidate count appear when supplied',
      (t) async {
    await _pump(
      t,
      RoundStepTile(
        round: _round(),
        position: 1,
        total: 1,
        stateLabel: 'Open · closes in 3d',
        stateColor: Colors.green,
        assignedCount: 12,
      ),
    );
    expect(find.text('Open · closes in 3d'), findsOneWidget);
    expect(find.text('12 candidate(s)'), findsOneWidget);
  });

  testWidgets('a negative count is hidden, not shown as -1', (t) async {
    // Callers pass -1 while a count() aggregate is still in flight.
    await _pump(
      t,
      RoundStepTile(round: _round(), position: 1, total: 1, assignedCount: -1),
    );
    expect(find.textContaining('candidate(s)'), findsNothing);
  });

  testWidgets('the highlight label marks the round worth pointing at',
      (t) async {
    await _pump(
      t,
      RoundStepTile(
        round: _round(),
        position: 1,
        total: 3,
        highlight: true,
        highlightLabel: 'assigned on save',
      ),
    );
    expect(find.text('· assigned on save'), findsOneWidget);
  });

  testWidgets('tapping the step invokes the configure callback', (t) async {
    var taps = 0;
    await _pump(
      t,
      RoundStepTile(
        round: _round(),
        position: 1,
        total: 1,
        onTap: () => taps++,
      ),
    );
    await t.tap(find.text('Résumé screen'));
    expect(taps, 1, reason: 'the whole step is the configure affordance');
  });

  testWidgets('trailing actions are rendered where the caller puts them',
      (t) async {
    await _pump(
      t,
      RoundStepTile(
        round: _round(),
        position: 1,
        total: 1,
        trailing: const Icon(Icons.drag_handle),
      ),
    );
    expect(find.byIcon(Icons.drag_handle), findsOneWidget);
  });
}

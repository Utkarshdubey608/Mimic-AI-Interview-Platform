// test/countdown_badge_test.dart
//
// The countdown that hands an MCQ paper in.
//
// Two things here are worth a widget test rather than an eyeball, because both
// are the kind of bug that only shows up on a real paper at a real deadline:
//
//   1. `onExpired` fires ONCE. It submits, and a callback that kept firing while
//      the clock sat at zero would submit repeatedly.
//   2. A null remaining time draws NOTHING. An untimed session must not show a
//      clock, and neither must one whose deadline is not known yet.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/shared/widgets/countdown_badge.dart';

void main() {
  Widget host(CountdownBadge badge) =>
      MaterialApp(home: Scaffold(body: Center(child: badge)));

  testWidgets('it shows minutes and seconds, and ticks', (tester) async {
    var left = const Duration(seconds: 125);
    await tester.pumpWidget(host(CountdownBadge(remaining: () => left)));

    expect(find.text('2:05'), findsOneWidget);

    left = const Duration(seconds: 64);
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('1:04'), findsOneWidget);

    // Padded, so the pill does not read "1:4".
    left = const Duration(seconds: 61);
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('1:01'), findsOneWidget);
  });

  testWidgets('no remaining time draws no clock', (tester) async {
    await tester.pumpWidget(host(CountdownBadge(remaining: () => null)));
    expect(find.byIcon(Icons.hourglass_bottom), findsNothing);
    expect(find.byType(Text), findsNothing);
  });

  testWidgets('onExpired fires exactly once, however long it sits at zero',
      (tester) async {
    var left = const Duration(seconds: 2);
    var fired = 0;
    await tester.pumpWidget(host(CountdownBadge(
      remaining: () => left,
      onExpired: () => fired++,
    )));
    expect(fired, 0);

    left = Duration.zero;
    await tester.pump(const Duration(seconds: 1));
    expect(fired, 1);

    // Five more seconds of sitting at zero must not submit five more times.
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(seconds: 1));
    }
    expect(fired, 1);
  });

  testWidgets('an already-expired clock fires without waiting a tick',
      (tester) async {
    // A paper reopened after its deadline. Waiting a second to notice would let
    // the candidate answer one more question.
    var fired = 0;
    await tester.pumpWidget(host(CountdownBadge(
      remaining: () => Duration.zero,
      onExpired: () => fired++,
    )));

    expect(fired, 1);
    expect(find.text('0:00'), findsOneWidget);
  });

  testWidgets('it warns in the error colour under the threshold',
      (tester) async {
    var left = const Duration(seconds: 90);
    await tester.pumpWidget(host(CountdownBadge(
      remaining: () => left,
      warnBelow: const Duration(minutes: 1),
    )));

    final context = tester.element(find.byType(CountdownBadge));
    final scheme = Theme.of(context).colorScheme;

    Color colourOf() =>
        (tester.widget<Text>(find.byType(Text)).style!.color)!;
    expect(colourOf(), scheme.onSurfaceVariant);

    left = const Duration(seconds: 45);
    await tester.pump(const Duration(seconds: 1));
    expect(colourOf(), scheme.error);
  });

  testWidgets('its ticker stops when it leaves the tree', (tester) async {
    // A timer outliving the widget is what turns a countdown into a crash on a
    // screen that has already been disposed.
    var fired = 0;
    await tester.pumpWidget(host(CountdownBadge(
      remaining: () => const Duration(seconds: 1),
      onExpired: () => fired++,
    )));
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    await tester.pump(const Duration(seconds: 5));

    expect(fired, 0, reason: 'nothing should tick after dispose');
    // No pending-timer failure from the test framework is the real assertion.
  });
}

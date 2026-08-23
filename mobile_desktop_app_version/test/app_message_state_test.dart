// test/app_message_state_test.dart
//
// The four states a list can be in, and the one distinction that actually costs
// something when it is collapsed.
//
// Mobile had ONE message widget and a bare spinner, so "the load failed" and "there is
// nothing here" rendered as the same thing. A recruiter told "no tests" by a request
// that 503'd goes looking for deleted data, and the real cause — an expired sign-in, a
// misconfigured deployment — is invisible. Web named four states; these are the mobile
// counterparts.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';

Future<void> _pump(WidgetTester t, Widget child) =>
    t.pumpWidget(MaterialApp(home: Scaffold(body: child)));

void main() {
  group('an error is not an empty state', () {
    testWidgets('it names the failure and offers a retry', (t) async {
      var retried = 0;
      await _pump(
        t,
        AppErrorState(
          title: 'Could not load your tests',
          detail: 'Authentication is unavailable: Firebase is not configured.',
          onRetry: () => retried++,
        ),
      );

      expect(find.text('Could not load your tests'), findsOneWidget);
      // The server's own message, verbatim. "Check your connection" over a 503 that
      // said precisely what was wrong sends people debugging the wrong thing.
      expect(
        find.textContaining('Firebase is not configured'),
        findsOneWidget,
      );

      await t.tap(find.text('Try again'));
      expect(retried, 1);
    });

    testWidgets('with no retry it still says what happened', (t) async {
      await _pump(
        t,
        const AppErrorState(title: 'Could not load', detail: 'Upstream timed out.'),
      );
      expect(find.text('Try again'), findsNothing);
      expect(find.text('Upstream timed out.'), findsOneWidget);
    });
  });

  group('a filter that matched nothing is not an empty account', () {
    testWidgets('it names the query back', (t) async {
      // Without it, somebody cannot tell whether they mistyped or the thing is
      // genuinely absent.
      await _pump(t, const AppNoResults(query: 'backend'));
      expect(find.textContaining('backend'), findsOneWidget);
    });

    testWidgets('the fix offered is clearing the filter, not creating something',
        (t) async {
      var cleared = 0;
      await _pump(t, AppNoResults(query: 'x', onClear: () => cleared++));

      await t.tap(find.text('Clear the search'));
      expect(cleared, 1);
    });

    testWidgets('it copes with no query at all', (t) async {
      await _pump(t, const AppNoResults());
      expect(find.text('Nothing matches'), findsOneWidget);
    });
  });

  group('an empty state offers the thing that fills it', () {
    testWidgets('the action is rendered when given', (t) async {
      await _pump(
        t,
        AppEmptyState(
          icon: Icons.inbox_outlined,
          title: 'No interviews yet',
          description: 'Create one and assign it to a candidate email.',
          action: FilledButton(onPressed: () {}, child: const Text('Create')),
        ),
      );
      expect(find.text('No interviews yet'), findsOneWidget);
      expect(find.text('Create'), findsOneWidget);
    });

    testWidgets('and omitted cleanly when there is nothing to offer', (t) async {
      await _pump(
        t,
        const AppEmptyState(
          icon: Icons.inbox_outlined,
          title: 'Nothing here',
          description: 'It will appear when it does.',
        ),
      );
      expect(find.byType(FilledButton), findsNothing);
    });
  });

  group('loading is shaped like the content', () {
    testWidgets('a skeleton list renders the rows that are coming', (t) async {
      // Preferred over a centred spinner for a LIST: it shows how much is arriving and
      // where, so the page does not jump when it lands.
      await _pump(t, const AppSkeletonList(rows: 4));
      await t.pump(const Duration(milliseconds: 100));

      // Two bars per row — a title and a subtitle.
      expect(find.byType(AppSkeleton), findsNWidgets(8));
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });
  });

  group('the original still works', () {
    testWidgets('sixteen call sites use it and it is right for a plain message',
        (t) async {
      await _pump(
        t,
        const AppMessageState(
          icon: Icons.info_outline,
          title: 'Nothing to report',
          subtitle: 'Come back later.',
        ),
      );
      expect(find.text('Nothing to report'), findsOneWidget);
    });
  });
}

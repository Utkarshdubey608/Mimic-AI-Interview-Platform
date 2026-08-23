// test/recruiter_ui_layout_test.dart
//
// Layout tests for the shared recruiter components, pumped in the context they
// actually live in: inside a vertically scrolling column, where the incoming
// height constraint is infinite.
//
// This exists because RecruiterMetricStrip shipped broken. A Row with
// CrossAxisAlignment.stretch is fine on a bounded page and throws
// "BoxConstraints forces an infinite height" inside a SingleChildScrollView —
// which blanked the entire analytics screen. flutter analyze, the unit suite
// and a release build all passed it straight through, because a layout
// overflow is a runtime failure and nothing was rendering these widgets.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/core/theme/app_theme.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

/// Renders [child] the way the recruiter pages do: unbounded height, phone
/// width, real app theme.
Future<void> _pumpScrolling(
  WidgetTester tester,
  Widget child, {
  Size size = const Size(360, 720),
  ThemeData? theme,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(MaterialApp(
    theme: theme ?? AppTheme.darkTheme,
    home: Scaffold(
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [Padding(padding: const EdgeInsets.all(16), child: child)],
        ),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

const _threeMetrics = [
  RecruiterMetric(value: '100%', label: 'Completion'),
  RecruiterMetric(value: '72.5', label: 'Avg. score'),
  RecruiterMetric(value: '2', label: 'Evaluated'),
];

void main() {
  group('RecruiterMetricStrip', () {
    testWidgets('lays out inside a scrolling column', (tester) async {
      await _pumpScrolling(
          tester, const RecruiterMetricStrip(metrics: _threeMetrics));

      expect(tester.takeException(), isNull);
      for (final m in _threeMetrics) {
        expect(find.text(m.value), findsOneWidget);
        expect(find.text(m.label), findsOneWidget);
      }
    });

    testWidgets('survives a very narrow phone', (tester) async {
      await _pumpScrolling(
        tester,
        const RecruiterMetricStrip(metrics: _threeMetrics),
        size: const Size(300, 640),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('gives every cell the same width', (tester) async {
      await _pumpScrolling(
          tester, const RecruiterMetricStrip(metrics: _threeMetrics));

      final widths = [
        for (final m in _threeMetrics) tester.getSize(find.text(m.value)).width,
      ];
      // Values differ in length, so compare the cells rather than the glyphs:
      // each cell centre should be evenly spaced across the strip.
      final centres = [
        for (final m in _threeMetrics) tester.getCenter(find.text(m.value)).dx,
      ];
      expect(centres[1] - centres[0], closeTo(centres[2] - centres[1], 1.0));
      expect(widths.every((w) => w > 0), isTrue);
    });

    testWidgets('renders in the light theme too', (tester) async {
      await _pumpScrolling(
        tester,
        const RecruiterMetricStrip(metrics: _threeMetrics),
        theme: AppTheme.lightTheme,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('an empty list renders nothing rather than an empty panel',
        (tester) async {
      await _pumpScrolling(tester, const RecruiterMetricStrip(metrics: []));
      expect(tester.takeException(), isNull);
      expect(find.byType(RecruiterPanel), findsNothing);
    });
  });

  group('warm dashboard blocks', () {
    testWidgets('hero block with three circle actions', (tester) async {
      await _pumpScrolling(
        tester,
        RecruiterHeroBlock(
          kicker: 'Your workspace',
          value: '12',
          unit: 'tests',
          caption: '4 video · 3 voice · 5 chat',
          actions: [
            RecruiterCircleAction(
                icon: Icons.add_rounded, label: 'Create', onPressed: () {}),
            RecruiterCircleAction(
                icon: Icons.folder_outlined, label: 'Library', onPressed: () {}),
            RecruiterCircleAction(
                icon: Icons.autorenew_rounded,
                label: 'Rebuild',
                onPressed: () {}),
          ],
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('12'), findsOneWidget);
      expect(find.text('Create'), findsOneWidget);
    });

    testWidgets('hero block actions survive a narrow phone', (tester) async {
      // Four fixed-width circles plus their gaps exceed a 300dp card, so this
      // has to degrade rather than overflow.
      await _pumpScrolling(
        tester,
        RecruiterHeroBlock(
          kicker: 'Your workspace',
          value: '3',
          unit: 'tests',
          actions: [
            for (final l in ['Create', 'Library', 'Rebuild', 'Archive'])
              RecruiterCircleAction(
                  icon: Icons.add_rounded, label: l, onPressed: () {}),
          ],
        ),
        size: const Size(300, 720),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('a long hero figure ellipsises instead of overflowing',
        (tester) async {
      await _pumpScrolling(
        tester,
        const RecruiterHeroBlock(
          kicker: 'Your workspace',
          value: '1234567890',
          unit: 'candidates screened',
        ),
        size: const Size(300, 640),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('profile header truncates a long name', (tester) async {
      await _pumpScrolling(
        tester,
        const RecruiterProfileHeader(
          initial: 'A',
          title: 'Good afternoon, bartholomew-maximilian',
          subtitle: 'AI candidate screening',
          actions: [Icon(Icons.logout_rounded)],
        ),
        size: const Size(300, 640),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('renders in the light theme too', (tester) async {
      await _pumpScrolling(
        tester,
        RecruiterHeroBlock(
          kicker: 'Your workspace',
          value: '3',
          unit: 'tests',
          actions: [
            RecruiterCircleAction(
                icon: Icons.add_rounded, label: 'Create', onPressed: () {}),
          ],
        ),
        theme: AppTheme.lightTheme,
      );
      expect(tester.takeException(), isNull);
    });
  });

  group('other shared surfaces in an unbounded column', () {
    testWidgets('a long list row title truncates instead of overflowing',
        (tester) async {
      await _pumpScrolling(
        tester,
        RecruiterListRow(
          icon: Icons.folder_outlined,
          title: 'An interview test with a very long name indeed, far longer '
              'than any phone is wide',
          subtitle: 'Chat · 2 candidates · 2 done · 2026-08-22 22:42',
          onTap: () {},
        ),
        size: const Size(300, 640),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('RecruiterStatCard at the width the funnel strip uses',
        (tester) async {
      await _pumpScrolling(
        tester,
        const SizedBox(
          width: 138,
          child: RecruiterStatCard(
            icon: Icons.analytics_outlined,
            label: 'In progress',
            value: '0',
            footnote: '0% completed',
          ),
        ),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('RecruiterSegmentedProgress from 1 to 12 segments',
        (tester) async {
      // A pipeline has no round cap, so the bar has to survive a long one:
      // 12 segments plus their 3px gaps must still fit a phone column.
      for (final n in [1, 2, 4, 12]) {
        await _pumpScrolling(
          tester,
          RecruiterSegmentedProgress(
            segments: [
              for (var k = 0; k < n; k++)
                k < n - 1
                    ? RecruiterSegmentState.done
                    : RecruiterSegmentState.current,
            ],
            currentColor: const Color(0xFF86EFAC),
          ),
          size: const Size(300, 640),
        );
        expect(tester.takeException(), isNull, reason: '$n segments');
      }
    });

    testWidgets('an empty segment list occupies its height without throwing',
        (tester) async {
      await _pumpScrolling(
        tester,
        const RecruiterSegmentedProgress(
            segments: [], currentColor: Color(0xFF86EFAC)),
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('buttons and pills lay out at 300dp', (tester) async {
      await _pumpScrolling(
        tester,
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            RecruiterPrimaryButton(
                label: 'Save & publish', expand: true, onPressed: () {}),
            const SizedBox(height: 8),
            RecruiterSecondaryButton(
                label: 'All candidates',
                icon: Icons.people_alt_outlined,
                expand: true,
                onPressed: () {}),
            const SizedBox(height: 8),
            RecruiterPillBar(pills: [
              RecruiterFilterPill(
                  label: 'All', count: 1, selected: true, onTap: () {}),
              RecruiterFilterPill(
                  label: 'Video', count: 0, selected: false, onTap: () {}),
            ]),
          ],
        ),
        size: const Size(300, 640),
      );
      expect(tester.takeException(), isNull);
    });
  });
}

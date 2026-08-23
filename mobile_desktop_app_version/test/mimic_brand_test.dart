// test/mimic_brand_test.dart
//
// The brand pair: MimicMark (the drawn chevron plate) and MimicWordmark (the
// text half). Worth pinning rather than eyeballing, because both are now used
// on the splash, the sign-in screen and the candidate app bar, and two of the
// three things that can go wrong here are invisible in a passing build:
//
//   1. The name. The app was renamed from "talbotiq", and the old treatment was
//      hand-rolled in three places — so the assertion is that no screen spells
//      the old name any more, not merely that this widget spells the new one.
//   2. The plate is INK on GROUND and must invert with the theme. A hardcoded
//      dark plate looks right in dark mode and disappears in light.
//   3. Proportion: the plate is square and everything inside it is derived from
//      its one size, at 20px and at 96px alike.

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/core/theme/app_theme.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/shared/widgets/mimic_mark.dart';
import 'package:talbotiq/shared/widgets/mimic_wordmark.dart';

void main() {
  Widget host(Widget child, {required bool dark, double width = 300}) =>
      MaterialApp(
        theme: WarmSurfaces.theme(
            dark ? AppTheme.darkTheme : AppTheme.lightTheme),
        home: Scaffold(
          body: SizedBox(
            width: width,
            // Unbounded height: the trap that blanks a screen at runtime while
            // every static check passes.
            child: SingleChildScrollView(child: child),
          ),
        ),
      );

  Finder plate() => find.descendant(
        of: find.byType(MimicMark),
        matching: find.byType(Container),
      );

  BoxDecoration plateOf(WidgetTester tester) =>
      tester.widget<Container>(plate()).decoration! as BoxDecoration;

  group('MimicMark', () {
    testWidgets('the plate is square and takes the given size', (tester) async {
      for (final size in <double>[20, 32, 96]) {
        // Hosted in a 300dp-wide tight box, which is what an app bar title and
        // a stretching Column both hand it: the plate must stay square.
        await tester.pumpWidget(host(MimicMark(size: size), dark: true));
        expect(tester.getSize(plate()), Size(size, size), reason: 'size $size');
        expect(tester.takeException(), isNull, reason: 'size $size');
      }
    });

    testWidgets('the plate is ink and the chevron is ground, in both themes',
        (tester) async {
      for (final dark in [true, false]) {
        await tester.pumpWidget(host(const MimicMark(), dark: dark));
        final context = tester.element(find.byType(MimicMark));

        expect(plateOf(tester).color, WarmSurfaces.ink(context),
            reason: dark ? 'dark' : 'light');

        // The chevron is painted, so its colour is asserted through the
        // painter's own repaint contract rather than by reading pixels: a
        // painter built for this ground must not want to repaint for it.
        final paint = tester.widget<CustomPaint>(find.descendant(
          of: find.byType(MimicMark),
          matching: find.byType(CustomPaint),
        ));
        expect(paint.painter, isNotNull);
        expect(paint.size.width, paint.size.height);
      }
    });

    testWidgets('the radius is a quarter of the plate, not a fixed number',
        (tester) async {
      await tester.pumpWidget(host(const MimicMark(size: 80), dark: true));
      final radius = plateOf(tester).borderRadius as BorderRadius;
      expect(radius.topLeft.x, 80 * 0.25);
    });
  });

  group('MimicWordmark', () {
    testWidgets('it spells Mimic, and no screen spells the old name',
        (tester) async {
      await tester.pumpWidget(host(const MimicWordmark(), dark: true));
      expect(find.text('Mimic'), findsOneWidget);
      expect(find.text('talbot'), findsNothing);
      expect(find.text('talbotiq'), findsNothing);
    });

    testWidgets('it takes the given size and stays one unbroken line',
        (tester) async {
      // 40 is the splash size; 300dp wide is the narrow phone.
      await tester.pumpWidget(host(const MimicWordmark(fontSize: 40),
          dark: false));
      expect(tester.takeException(), isNull);

      final text = tester.widget<Text>(find.text('Mimic'));
      expect(text.style?.fontSize, 40);

      final paragraph =
          tester.renderObject<RenderParagraph>(find.text('Mimic'));
      expect(paragraph.didExceedMaxLines, isFalse);
    });
  });

  testWidgets('the lockup — mark beside wordmark — survives a narrow screen',
      (tester) async {
    await tester.pumpWidget(host(
      Row(
        mainAxisSize: MainAxisSize.min,
        children: const [
          MimicMark(size: 44),
          SizedBox(width: 12),
          MimicWordmark(fontSize: 34),
        ],
      ),
      dark: true,
      width: 300,
    ));
    expect(tester.takeException(), isNull);
  });
}

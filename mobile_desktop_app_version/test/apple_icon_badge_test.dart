// test/apple_icon_badge_test.dart
//
// AppleIconBadge is handed a fill colour by its caller and has to pick a glyph
// colour that survives it. It used to hardcode white, which was fine while the
// callers passed saturated Material colours and became invisible the moment
// they passed the design language's light pastels.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/accent_palette.dart';
import 'package:talbotiq/core/theme/app_theme.dart';
import 'package:talbotiq/shared/widgets/apple_ui.dart';

Future<Color> _glyphColour(WidgetTester tester, Color fill) async {
  await tester.pumpWidget(MaterialApp(
    theme: AppTheme.darkTheme,
    home: Scaffold(
      body: Center(
        child: AppleIconBadge(icon: Icons.palette_outlined, color: fill),
      ),
    ),
  ));
  return tester.widget<Icon>(find.byIcon(Icons.palette_outlined)).color!;
}

void main() {
  testWidgets('a light pastel fill gets a dark glyph', (tester) async {
    // Every selectable accent is a light pastel, so all of them must.
    for (final accent in AppAccent.values) {
      final glyph = await _glyphColour(tester, accent.block);
      expect(glyph, AppColors.blockInk, reason: accent.label);
    }
  });

  testWidgets('a dark fill still gets a white glyph', (tester) async {
    // The widget is shared, so callers passing a saturated dark colour keep
    // the behaviour they had.
    expect(await _glyphColour(tester, const Color(0xFF1D4ED8)), Colors.white);
    expect(await _glyphColour(tester, Colors.black), Colors.white);
  });

  testWidgets('the danger red keeps a white glyph', (tester) async {
    // Used for "My Recordings"; it is light enough to be worth pinning rather
    // than assuming.
    final glyph = await _glyphColour(tester, AppColors.danger);
    final expected =
        ThemeData.estimateBrightnessForColor(AppColors.danger) ==
                Brightness.dark
            ? Colors.white
            : AppColors.blockInk;
    expect(glyph, expected);
  });
}

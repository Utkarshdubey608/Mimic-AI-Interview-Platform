// test/accent_palette_test.dart
//
// The accent is the one thing a recruiter can recolour, so two properties have
// to hold: the choice actually reaches the widgets, and no choice can produce
// an unreadable block.

import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/accent_palette.dart';
import 'package:talbotiq/core/theme/app_theme.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

void main() {
  group('wire format', () {
    test('every accent round-trips', () {
      for (final a in AppAccent.values) {
        expect(AppAccentX.fromWire(a.wire), a);
      }
    });

    test('an unknown or absent value falls back rather than throwing', () {
      // Prefs written by an older build, or a value we later removed.
      expect(AppAccentX.fromWire('chartreuse'), AppAccent.peach);
      expect(AppAccentX.fromWire(null), AppAccent.peach);
    });

    test('the fallback is caller-chosen, so the secondary keeps its default',
        () {
      expect(
        AppAccentX.fromWire(null, fallback: AppAccent.lavender),
        AppAccent.lavender,
      );
    });
  });

  group('readability', () {
    test('near-black ink is legible on every accent block', () {
      // The blocks always carry AppColors.blockInk. WCAG AA for normal text is
      // 4.5:1; these are large/semibold on a solid field, but holding the full
      // AA bar is what makes the setting safe to expose at all.
      final ink = AppColors.blockInk;
      for (final a in AppAccent.values) {
        final ratio = _contrast(ink, a.block);
        expect(ratio, greaterThan(4.5), reason: '${a.label} ratio $ratio');
      }
    });

    test('no two accents are the same colour', () {
      final seen = <int>{};
      for (final a in AppAccent.values) {
        expect(seen.add(a.block.toARGB32()), isTrue, reason: a.label);
      }
    });
  });

  group('the choice reaches the theme', () {
    test('the warm theme carries the chosen accent as primary', () {
      for (final a in AppAccent.values) {
        final t = WarmSurfaces.theme(AppTheme.darkTheme, accent: a);
        expect(t.colorScheme.primary, a.block, reason: a.label);
        // The block always keeps its constant ink, whichever colour it is.
        expect(t.colorScheme.onPrimary, AppColors.blockInk);
      }
    });

    test('primary and secondary land in their own slots', () {
      final t = WarmSurfaces.theme(
        AppTheme.darkTheme,
        accent: AppAccent.clay,
        secondary: AppAccent.sky,
      );
      expect(t.colorScheme.primary, AppAccent.clay.block);
      expect(t.colorScheme.secondary, AppAccent.sky.block);
      // Both are blocks, so both carry the same constant ink.
      expect(t.colorScheme.onPrimary, AppColors.blockInk);
      expect(t.colorScheme.onSecondary, AppColors.blockInk);
    });

    test('a secondary choice does not disturb the primary', () {
      for (final secondary in AppAccent.values) {
        final t = WarmSurfaces.theme(
          AppTheme.darkTheme,
          accent: AppAccent.peach,
          secondary: secondary,
        );
        expect(t.colorScheme.primary, AppAccent.peach.block,
            reason: secondary.label);
        expect(t.floatingActionButtonTheme.backgroundColor,
            AppAccent.peach.block);
      }
    });

    test('it reaches the buttons and the FAB, not just the scheme', () {
      final t = WarmSurfaces.theme(AppTheme.darkTheme, accent: AppAccent.mint);
      expect(t.floatingActionButtonTheme.backgroundColor, AppAccent.mint.block);
      expect(t.progressIndicatorTheme.color, AppAccent.mint.block);
    });

    test('the ground stays black regardless of accent', () {
      // Recolouring the block must not tint the page.
      for (final a in AppAccent.values) {
        final t = WarmSurfaces.theme(AppTheme.darkTheme, accent: a);
        expect(t.scaffoldBackgroundColor, AppColors.warmBackground);
      }
    });
  });

  testWidgets('WarmSurfaces reads both accents from the theme', (tester) async {
    Color? primary;
    Color? secondary;
    await tester.pumpWidget(MaterialApp(
      theme: WarmSurfaces.theme(
        AppTheme.darkTheme,
        accent: AppAccent.sky,
        secondary: AppAccent.butter,
      ),
      home: Builder(builder: (context) {
        primary = WarmSurfaces.block(context);
        secondary = WarmSurfaces.blockSecondary(context);
        return const SizedBox.shrink();
      }),
    ));
    expect(primary, AppAccent.sky.block);
    expect(secondary, AppAccent.butter.block);
  });
}

/// WCAG relative-luminance contrast ratio.
double _contrast(Color a, Color b) {
  final la = _luminance(a), lb = _luminance(b);
  final hi = max(la, lb), lo = min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

double _luminance(Color c) {
  double channel(double v) =>
      v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

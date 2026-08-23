// test/status_tones_test.dart
//
// Status colours follow the user's two accents now. The property that makes
// that safe is not "they look nice" but "states that appear as alternatives to
// each other stay distinguishable at EVERY accent pairing" — so it is checked
// across all of them rather than at the defaults.

import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/accent_palette.dart';
import 'package:talbotiq/core/theme/app_theme.dart';
import 'package:talbotiq/core/theme/status_tones.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

/// Resolves the tones under one accent pairing.
Future<Map<String, Color>> _tones(
  WidgetTester tester, {
  required AppAccent accent,
  required AppAccent secondary,
  ThemeData? base,
}) async {
  final out = <String, Color>{};
  await tester.pumpWidget(MaterialApp(
    theme: WarmSurfaces.theme(
      base ?? AppTheme.darkTheme,
      accent: accent,
      secondary: secondary,
    ),
    home: Builder(builder: (context) {
      out['ready'] = StatusTone.ready(context);
      out['pending'] = StatusTone.pending(context);
      out['failed'] = StatusTone.failed(context);
      out['neutral'] = StatusTone.neutral(context);
      return const SizedBox.shrink();
    }),
  ));
  return out;
}

/// All distinct accent pairings.
Iterable<(AppAccent, AppAccent)> get _pairs sync* {
  for (final a in AppAccent.values) {
    for (final b in AppAccent.values) {
      if (a != b) yield (a, b);
    }
  }
}

void main() {
  testWidgets('ready and pending never collide when the accents differ',
      (tester) async {
    // These two appear side by side in a list ("Results available" next to
    // "Awaiting evaluation"), so they are the pairing that matters most.
    for (final (a, b) in _pairs) {
      final t = await _tones(tester, accent: a, secondary: b);
      expect(t['ready'], isNot(t['pending']), reason: '${a.label}/${b.label}');
    }
  });

  testWidgets('failure is never paintable in an accent', (tester) async {
    // "This expired" must not be able to wear the celebratory colour.
    for (final (a, b) in _pairs) {
      final t = await _tones(tester, accent: a, secondary: b);
      // On black the danger red is used as-is; the point is that it never
      // becomes the accent, whatever the user picked.
      expect(t['failed'], AppColors.danger, reason: '${a.label}/${b.label}');
      expect(t['failed'], isNot(t['ready']));
      expect(t['failed'], isNot(t['pending']));
    }
  });

  testWidgets('every tone stays legible on the page ground', (tester) async {
    // A status colour is used as TEXT on the ground, so it has to clear a
    // contrast bar there — not just look right on a block.
    for (final (a, b) in _pairs) {
      final t = await _tones(tester, accent: a, secondary: b);
      for (final e in t.entries) {
        final ratio = _contrast(e.value, AppColors.warmBackground);
        expect(ratio, greaterThan(3.0),
            reason: '${e.key} on black at ${a.label}/${b.label} = $ratio');
      }
    }
  });

  testWidgets('failure stays red-ish in light mode, not an accent',
      (tester) async {
    // It is darkened for legibility there, so identity is checked by hue
    // rather than by the exact constant.
    for (final (a, b) in _pairs) {
      final t = await _tones(tester,
          accent: a, secondary: b, base: AppTheme.lightTheme);
      final failed = HSLColor.fromColor(t['failed']!);
      expect(failed.hue, closeTo(HSLColor.fromColor(AppColors.danger).hue, 8),
          reason: 'hue drifted at ${a.label}/${b.label}');
      expect(t['failed'], isNot(t['ready']));
    }
  });

  testWidgets('the light theme keeps them legible too', (tester) async {
    for (final (a, b) in _pairs) {
      final t = await _tones(tester,
          accent: a, secondary: b, base: AppTheme.lightTheme);
      for (final e in t.entries) {
        final ratio = _contrast(e.value, const Color(0xFFF6F3EE));
        // Same 3:1 bar the implementation walks toward — light mode is where
        // an un-darkened pastel sat at 1.4:1 and was unreadable.
        expect(ratio, greaterThan(2.9),
            reason: '${e.key} on cream at ${a.label}/${b.label} = $ratio');
      }
    }
  });

  group('score bands', () {
    testWidgets('the three bands are mutually distinct', (tester) async {
      for (final (a, b) in _pairs) {
        await tester.pumpWidget(MaterialApp(
          theme: WarmSurfaces.theme(AppTheme.darkTheme,
              accent: a, secondary: b),
          home: Builder(builder: (context) {
            final high = StatusTone.forScore(context, 90);
            final mid = StatusTone.forScore(context, 60);
            final low = StatusTone.forScore(context, 20);
            expect({high, mid, low}.length, 3,
                reason: 'bands collapsed at ${a.label}/${b.label}');
            return const SizedBox.shrink();
          }),
        ));
      }
    });

    testWidgets('the boundaries land in the band they document',
        (tester) async {
      await tester.pumpWidget(MaterialApp(
        theme: WarmSurfaces.theme(AppTheme.darkTheme),
        home: Builder(builder: (context) {
          expect(StatusTone.forScore(context, 75), StatusTone.ready(context));
          expect(StatusTone.forScore(context, 74),
              StatusTone.borderline(context));
          expect(StatusTone.forScore(context, 55),
              StatusTone.borderline(context));
          expect(StatusTone.forScore(context, 54), StatusTone.failed(context));
          return const SizedBox.shrink();
        }),
      ));
    });
  });

  testWidgets('ranked() returns exactly the number of buckets asked for',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: WarmSurfaces.theme(AppTheme.darkTheme),
      home: Builder(builder: (context) {
        for (final n in [0, 1, 2, 3, 5, 8]) {
          expect(StatusTone.ranked(context, n).length, n, reason: 'n=$n');
        }
        // Up to three buckets, every colour is distinct.
        expect(StatusTone.ranked(context, 3).toSet().length, 3);
        return const SizedBox.shrink();
      }),
    ));
  });
}

double _contrast(Color a, Color b) {
  final la = _luminance(a), lb = _luminance(b);
  return (max(la, lb) + 0.05) / (min(la, lb) + 0.05);
}

double _luminance(Color c) {
  double ch(double v) =>
      v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

// lib/core/theme/status_tones.dart
//
// Semantic status colours, expressed in terms of the user's chosen accents.
//
// The earlier rule here was "status colours never follow the accent", on the
// grounds that a recruiter must still tell "open" from "upcoming" after
// recolouring. That reasoning was right about DISTINGUISHABILITY and wrong
// about the conclusion: statuses have to differ from each other, but they do
// not have to be fixed hues. Pinning them meant most of the colour on screen
// ignored the user's choice — a green "Results available" chip on a screen with
// no other green in it.
//
// So the states map onto DISTINCT slots instead:
//
//   ready / done / positive   → the user's PRIMARY accent
//   pending / in progress     → the user's SECONDARY accent
//   failed / expired          → a fixed danger red
//   inactive / neutral        → muted ink
//
// Because primary and secondary are separate settings, any two adjacent states
// still read apart; Settings flags the case where a user sets both the same.
// Danger stays fixed on purpose: "this failed" must not be paintable in a
// celebratory colour, and red-for-failure is the one colour convention worth
// protecting from customisation.

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

class StatusTone {
  StatusTone._();

  /// Minimum contrast a status colour must reach against the page, as text.
  /// 3:1 is the WCAG bar for large/bold text, which is what these are.
  static const double _minContrast = 3.0;

  /// Finished, available, cleared, passing — the good outcome.
  static Color ready(BuildContext c) => _onGround(c, WarmSurfaces.block(c));

  /// Under way, awaiting a result, scheduled — not done, not wrong.
  static Color pending(BuildContext c) =>
      _onGround(c, WarmSurfaces.blockSecondary(c));

  /// Darkens [tone] until it is readable as text on the current ground.
  ///
  /// The accents are light pastels. On the black ground they contrast strongly
  /// as-is; on the light ground a pastel status label sits at about 1.4:1 —
  /// present in the layout and invisible to read. Rather than pick a second
  /// hand-tuned palette for light mode, this walks the colour toward the ink
  /// until it clears the bar, so any accent added later is handled too.
  static Color _onGround(BuildContext c, Color tone) {
    final bg = WarmSurfaces.ground(c);
    if (_contrast(tone, bg) >= _minContrast) return tone;

    var out = tone;
    // Bounded: 12 steps of 12% reaches the ink well before running out, and a
    // loop with no bound in a build method is a hang waiting to happen.
    for (var i = 0; i < 12; i++) {
      out = Color.lerp(out, AppColors.blockInk, 0.12)!;
      if (_contrast(out, bg) >= _minContrast) break;
    }
    return out;
  }

  static double _contrast(Color a, Color b) {
    final la = _luminance(a), lb = _luminance(b);
    return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
  }

  static double _luminance(Color c) {
    double channel(double v) => v <= 0.03928
        ? v / 12.92
        : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
    return 0.2126 * channel(c.r) +
        0.7152 * channel(c.g) +
        0.0722 * channel(c.b);
  }

  /// Expired, rejected, failed, below the bar. The HUE is deliberately not
  /// configurable; it still goes through [_onGround], because the soft red sits
  /// at 2.5:1 on the light ground and "expired" is not a label to render
  /// half-legibly.
  static Color failed(BuildContext c) => _onGround(c, AppColors.danger);

  /// Not started, closed, unknown, or simply not applicable.
  static Color neutral(BuildContext c) => WarmSurfaces.inkMuted(c);

  /// The middle band of a three-way judgement — between [ready] and [failed].
  /// Same colour as [pending]: "borderline" and "not finished" never appear as
  /// alternatives to each other, so they can safely share a slot.
  static Color borderline(BuildContext c) => pending(c);

  /// A 0-100 score's band. High takes the accent, mid the secondary, low the
  /// fixed danger — three visually distinct slots at any accent pairing.
  static Color forScore(BuildContext c, num score) {
    if (score >= 75) return ready(c);
    if (score >= 55) return borderline(c);
    return failed(c);
  }

  /// Colours for a categorical breakdown of [n] buckets ordered best-to-worst.
  ///
  /// Two user accents cannot yield five distinguishable hues, so the extremes
  /// take the configurable slots and the middle falls back to a fixed tone.
  /// Charts are the one place this language accepts a fixed hue.
  static List<Color> ranked(BuildContext c, int n) {
    switch (n) {
      case 0:
        return const [];
      case 1:
        return [ready(c)];
      case 2:
        return [ready(c), failed(c)];
      case 3:
        return [ready(c), borderline(c), failed(c)];
      default:
        return [
          ready(c),
          pending(c),
          AppColors.pastelYellow,
          failed(c),
          neutral(c),
          // Anything beyond five buckets repeats the neutral rather than
          // inventing hues that carry no meaning.
          for (var k = 5; k < n; k++) neutral(c),
        ].take(n).toList();
    }
  }
}

// lib/core/theme/accent_palette.dart
//
// The user-selectable accent for the recruiter interface.
//
// The design language is deliberately monochrome except for ONE solid pastel
// block per screen — the hero, the primary button, the selected chip. That is
// the only thing this setting changes, which is why offering a choice is safe:
// swapping the block cannot break contrast anywhere, because every block always
// carries the same near-black ink and always sits on the same neutral ground.
//
// Each option therefore only has to answer "what colour is the block?". There
// is no per-option foreground, no per-option surface, and no theme to re-tune.
//
// The same six serve as both the PRIMARY block (hero, primary button, selected
// chip) and the SECONDARY one (chart bars, meters, trend lines). One enum, two
// slots — a scheme is just a pair.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/theme/design_tokens.g.dart';

/// The accents a recruiter can pick between.
enum AppAccent { peach, lavender, mint, sky, butter, clay }

extension AppAccentX on AppAccent {
  /// Stored in prefs, so these strings are a wire format — renaming one
  /// silently resets everybody's choice to the default.
  String get wire => name;

  static AppAccent fromWire(String? v, {AppAccent fallback = AppAccent.peach}) =>
      AppAccent.values.firstWhere((a) => a.name == v, orElse: () => fallback);

  /// From the generated table, so web and Flutter name the accents identically.
  String get label => TokenBlock.accentLabels[name]!;

  /// The solid block colour. All six are tuned to the same rough lightness so
  /// the near-black ink on top stays comfortably readable on every one — that
  /// is the constraint that makes this a safe setting rather than a way to
  /// build an unreadable screen.
  Color get block => TokenBlock.accents[name]!;
}

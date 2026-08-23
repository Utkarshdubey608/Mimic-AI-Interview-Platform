// lib/core/theme/warm_surfaces.dart
//
// The app's surface set: true black in dark mode, warm off-white in light, both
// carrying solid full-strength pastel blocks.
//
// Why its own object rather than colours written into AppTheme directly: every
// widget reads from here, so re-skinning the app is a change to this file
// rather than a sweep across every screen — and the two user-selectable accent
// slots can be threaded through without call sites knowing about them.
//
// [theme] is installed once on MaterialApp (see main.dart), so every screen and
// every pushed route inherits it. RecruiterScaffold installs it again over the
// recruiter screens; with one app-wide theme that is a no-op, and it keeps
// those screens correct if the app is ever split into differing sections
// again — which is why the per-screen install is worth keeping.
//
// Ground vs. surface vs. surfaceHigh is a strict hierarchy — a card sits on the
// ground, an inner chip sits on the card. Skipping a level (a surfaceHigh chip
// directly on the ground) reads as a mistake, because the contrast step is
// tuned for one level at a time.

import 'package:flutter/material.dart';
import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/accent_palette.dart';

class WarmSurfaces {
  WarmSurfaces._();

  static bool isDark(BuildContext c) =>
      Theme.of(c).brightness == Brightness.dark;

  // ── Grounds and surfaces ────────────────────────────────────────────────

  /// The page background.
  static Color ground(BuildContext c) =>
      isDark(c) ? AppColors.warmBackground : const Color(0xFFF6F3EE);

  /// A card or panel sitting on [ground].
  static Color surface(BuildContext c) =>
      isDark(c) ? AppColors.warmSurface : Colors.white;

  /// A chip, input or nested block sitting on [surface].
  static Color surfaceHigh(BuildContext c) =>
      isDark(c) ? AppColors.warmSurfaceHigh : const Color(0xFFEDE8E0);

  /// The bottom bar's fill. Dark in BOTH themes — on light it is the black
  /// pill from the reference; on black it is lifted just enough to separate.
  static Color navBar(BuildContext c) =>
      isDark(c) ? AppColors.navBarDark : AppColors.blockInk;

  /// Hairline borders and separators.
  static Color stroke(BuildContext c) =>
      isDark(c) ? AppColors.warmBorder : const Color(0xFFE2DCD2);

  /// The fainter rule used between list rows inside one card.
  static Color separator(BuildContext c) => isDark(c)
      ? AppColors.warmBorder
      : const Color(0xFFE2DCD2).withValues(alpha: 0.7);

  // ── Type ────────────────────────────────────────────────────────────────

  /// Primary text.
  static Color ink(BuildContext c) =>
      isDark(c) ? AppColors.textLight : const Color(0xFF1A1613);

  /// Secondary text and metadata.
  static Color inkMuted(BuildContext c) =>
      isDark(c) ? AppColors.textMuted : const Color(0xFF6B635A);

  /// Tertiary text — timestamps, footnotes, inactive glyphs.
  static Color inkSubtle(BuildContext c) =>
      isDark(c) ? AppColors.textSubtle : const Color(0xFF9A9188);

  // ── Blocks ──────────────────────────────────────────────────────────────

  /// The featured block colour, as chosen by the user in Settings. Carried on
  /// `colorScheme.primary` by [theme], so any widget inside a themed page reads
  /// the live choice rather than a constant.
  static Color block(BuildContext c) => Theme.of(c).colorScheme.primary;

  /// The supporting block colour — chart bars, meters, trend lines. Kept apart
  /// from [block] so those do not disappear into the primary accent.
  static Color blockSecondary(BuildContext c) =>
      Theme.of(c).colorScheme.secondary;

  /// Ink for text and glyphs sitting ON a pastel block. Constant in both
  /// themes: the block itself is always light, so it never inverts.
  static const Color onBlock = AppColors.blockInk;

  /// A solid block that reads as "selected" — cream on dark, ink on light, so
  /// the selected thing is always the highest-contrast element in its row.
  static Color selectedBlock(BuildContext c) =>
      isDark(c) ? AppColors.blockCream : AppColors.blockInk;

  /// Text on [selectedBlock].
  static Color onSelectedBlock(BuildContext c) =>
      isDark(c) ? AppColors.blockInk : AppColors.blockCream;

  // ── Composites ──────────────────────────────────────────────────────────

  /// Standard card decoration: warm surface, hairline, generous radius.
  static BoxDecoration card(BuildContext c, {double radius = 20}) =>
      BoxDecoration(
        color: surface(c),
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: stroke(c)),
      );

  /// Re-points [base] at the warm surfaces.
  ///
  /// Installed once per recruiter page (see RecruiterScaffold) rather than on
  /// MaterialApp, because the candidate side keeps the cooler treatment and the
  /// two roles share one MaterialApp. Anything the page opens with the page's
  /// context — nested Scaffolds, dialogs, bottom sheets — inherits this,
  /// because Flutter's modal routes capture the ambient theme.
  static ThemeData theme(
    ThemeData base, {
    AppAccent accent = AppAccent.peach,
    AppAccent secondary = AppAccent.lavender,
  }) {
    final dark = base.brightness == Brightness.dark;
    final block = accent.block;
    final blockTwo = secondary.block;
    final bg = dark ? AppColors.warmBackground : const Color(0xFFF6F3EE);
    final surf = dark ? AppColors.warmSurface : Colors.white;
    final surfHigh = dark ? AppColors.warmSurfaceHigh : const Color(0xFFEDE8E0);
    final line = dark ? AppColors.warmBorder : const Color(0xFFE2DCD2);
    final onSurf = dark ? AppColors.textLight : const Color(0xFF1A1613);
    final onSurfVar = dark ? AppColors.textMuted : const Color(0xFF6B635A);

    return base.copyWith(
      scaffoldBackgroundColor: bg,
      canvasColor: bg,
      dividerColor: line,
      // EVERY role, not just the ones this language reads directly. Anything
      // left un-overridden keeps the base theme's value, and a screen reaching
      // for it leaks the old palette — `primaryContainer` stayed a dark
      // emerald and painted green discs across the candidate dashboard long
      // after the rest of the app had turned black.
      colorScheme: base.colorScheme.copyWith(
        primary: block,
        onPrimary: AppColors.blockInk,
        // A "container" of the accent is a tint of it on the page, not the
        // solid block: solid is reserved for the one featured element.
        primaryContainer: block.withValues(alpha: 0.16),
        onPrimaryContainer: onSurf,
        secondary: blockTwo,
        onSecondary: AppColors.blockInk,
        secondaryContainer: blockTwo.withValues(alpha: 0.16),
        onSecondaryContainer: onSurf,
        tertiary: blockTwo,
        onTertiary: AppColors.blockInk,
        tertiaryContainer: blockTwo.withValues(alpha: 0.16),
        onTertiaryContainer: onSurf,
        surface: surf,
        onSurface: onSurf,
        surfaceContainerLowest: bg,
        surfaceContainerLow: surf,
        surfaceContainer: surf,
        surfaceContainerHigh: surfHigh,
        surfaceContainerHighest: surfHigh,
        surfaceDim: bg,
        surfaceBright: surfHigh,
        onSurfaceVariant: onSurfVar,
        outline: line,
        outlineVariant: line,
        error: AppColors.danger,
        onError: AppColors.blockInk,
        errorContainer: AppColors.danger.withValues(alpha: 0.16),
        onErrorContainer: onSurf,
        // Tooltips and snackbars invert; without these they stay on whatever
        // the base theme had and read as a different app.
        inverseSurface: onSurf,
        onInverseSurface: bg,
        shadow: Colors.black,
        scrim: Colors.black,
      ),
      appBarTheme: base.appBarTheme.copyWith(
        backgroundColor: bg,
        foregroundColor: onSurf,
        titleTextStyle: base.appBarTheme.titleTextStyle?.copyWith(
          color: onSurf,
          fontWeight: FontWeight.w700,
        ),
        iconTheme: IconThemeData(color: onSurfVar, size: 21),
        actionsIconTheme: IconThemeData(color: onSurfVar, size: 21),
      ),
      cardTheme: base.cardTheme.copyWith(
        color: surf,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: line),
        ),
      ),
      dividerTheme: base.dividerTheme.copyWith(color: line),
      inputDecorationTheme: base.inputDecorationTheme.copyWith(
        fillColor: surf,
        hintStyle: TextStyle(color: inkSubtleFor(dark), fontSize: 14),
        labelStyle: TextStyle(color: onSurfVar, fontSize: 14),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide(color: block, width: 1.5),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide(color: line),
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide(color: line),
        ),
      ),
      bottomSheetTheme: base.bottomSheetTheme.copyWith(
        backgroundColor: surf,
        shape: RoundedRectangleBorder(
          borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
          side: BorderSide(color: line),
        ),
      ),
      dialogTheme: base.dialogTheme.copyWith(
        backgroundColor: surf,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(26),
          side: BorderSide(color: line),
        ),
        titleTextStyle: base.dialogTheme.titleTextStyle?.copyWith(color: onSurf),
        contentTextStyle:
            base.dialogTheme.contentTextStyle?.copyWith(color: onSurfVar),
      ),
      chipTheme: base.chipTheme.copyWith(
        backgroundColor: surf,
        selectedColor: surfHigh,
        side: BorderSide(color: line),
        labelStyle: TextStyle(
          fontSize: 12.5,
          fontWeight: FontWeight.w500,
          color: onSurf,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: block,
          foregroundColor: AppColors.blockInk,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          textStyle: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            fontFamily: 'Inter',
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: block,
          foregroundColor: AppColors.blockInk,
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          textStyle: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            fontFamily: 'Inter',
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: onSurf,
          backgroundColor: surf,
          side: BorderSide(color: line),
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          textStyle: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            fontFamily: 'Inter',
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: onSurfVar),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: block),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: block,
        foregroundColor: AppColors.blockInk,
        elevation: 2,
      ),
    );
  }

  /// [inkSubtle] without a BuildContext, for theme construction.
  static Color inkSubtleFor(bool dark) =>
      dark ? AppColors.textSubtle : const Color(0xFF9A9188);
}

// lib/core/theme/design_tokens.dart
//
// The non-colour half of the minimal-dark design language: the spacing step,
// the corner radii, the hairline border widths and the (deliberately sparse)
// shadow set. Colours live in AppColors; typography lives in AppTheme's
// TextTheme. This file exists so a screen never re-picks a pixel value.
//
// Why a scale and not free numbers: the reference language reads as
// "structured" rather than "airy" because every gap is one of a small set.
// Two panels 14px apart and 18px apart look like a mistake; both at 16 look
// intentional. DesktopTokens covers the same ground for the desktop-only
// widgets and is left alone — this is the shared/mobile scale.

import 'package:flutter/material.dart';
import 'package:talbotiq/core/constants/colors.dart';

/// The spacing step. Only these values; nothing between them.
class AppSpacing {
  AppSpacing._();

  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;

  /// Standard horizontal page gutter on phones.
  static const double page = 16;

  /// Bottom padding that clears the floating nav bar. The bar is 64 tall with
  /// a 12 inset, and sits inside SafeArea, so scrolling content needs roughly
  /// that plus breathing room or the last panel tucks under it.
  static const double navClearance = 116;
}

/// Corner radii. Generously rounded — soft, friendly surfaces read as
/// "premium product" on a phone, where a tight radius reads as a data table.
/// The language still leans on contrast and hairlines rather than shadow, so
/// nothing here is a full pill except genuinely pill-shaped things.
class AppRadius {
  AppRadius._();

  /// Chips, badges, small pills.
  static const double xs = 8;

  /// Filter pills and small tiles.
  static const double sm = 12;

  /// Inputs, buttons and inner surfaces.
  static const double md = 18;

  /// The standard card/panel radius.
  static const double card = 20;

  /// Sheets, dialogs, large containers.
  static const double lg = 26;

  /// Bottom sheets' top corners, the floating nav bar.
  static const double xl = 32;

  static BorderRadius all(double r) => BorderRadius.circular(r);
  static const BorderRadius cardAll = BorderRadius.all(Radius.circular(card));
}

/// Hairline borders. One width, two weights of presence.
class AppBorders {
  AppBorders._();

  static const double width = 1.0;

  /// The standard hairline around a card, theme-aware.
  static Border card(BuildContext context) => Border.all(
        color: strokeColor(context),
        width: width,
      );

  /// The colour of a card's hairline for the active theme.
  static Color strokeColor(BuildContext context) {
    final theme = Theme.of(context);
    return theme.brightness == Brightness.dark
        ? AppColors.border
        : theme.colorScheme.outlineVariant.withValues(alpha: 0.5);
  }

  /// The fainter stroke used for list separators and nested surfaces.
  static Color separatorColor(BuildContext context) {
    final theme = Theme.of(context);
    return theme.brightness == Brightness.dark
        ? AppColors.separator
        : theme.colorScheme.outlineVariant.withValues(alpha: 0.35);
  }
}

/// Shadows, used sparingly — only for things that genuinely float above the
/// page (the nav bar, menus, sheets). Cards get a border, not a shadow.
class AppShadows {
  AppShadows._();

  static List<BoxShadow> floating(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return [
      BoxShadow(
        color: Colors.black.withValues(alpha: isDark ? 0.25 : 0.06),
        blurRadius: 16,
        offset: const Offset(0, 4),
      ),
    ];
  }
}

/// Surface colour helpers, so `isDark ? AppColors.x : scheme.y` isn't
/// re-typed in every build method.
class AppSurfaces {
  AppSurfaces._();

  /// A card / panel's fill.
  static Color card(BuildContext context) {
    final theme = Theme.of(context);
    return theme.brightness == Brightness.dark
        ? AppColors.cardBg
        : theme.colorScheme.surface;
  }

  /// A surface nested inside a card (icon chips, inputs, selected states).
  static Color elevated(BuildContext context) {
    final theme = Theme.of(context);
    return theme.brightness == Brightness.dark
        ? AppColors.surfaceElevated
        : theme.colorScheme.surfaceContainerHighest;
  }

  /// Primary text.
  static Color text(BuildContext context) {
    final theme = Theme.of(context);
    return theme.brightness == Brightness.dark
        ? AppColors.textLight
        : theme.colorScheme.onSurface;
  }

  /// Secondary / metadata text.
  static Color muted(BuildContext context) {
    final theme = Theme.of(context);
    return theme.brightness == Brightness.dark
        ? AppColors.textMuted
        : theme.colorScheme.onSurfaceVariant;
  }

  /// Tertiary text — timestamps, footnotes, disabled glyphs.
  static Color subtle(BuildContext context) {
    final theme = Theme.of(context);
    return theme.brightness == Brightness.dark
        ? AppColors.textSubtle
        : theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.6);
  }
}

// lib/core/theme/desktop_tokens.dart
//
// The desktop-only names, now delegating to the shared scale.
//
// This file used to hold its OWN spacing and its own 14px card radius,
// deliberately tighter than the app's 20px. That made three opinions on shape
// in one product — 4px on web, 14px on Flutter desktop, 20px on Flutter mobile
// — and a recruiter moving between a laptop and a phone saw two different
// products. Phase 3 of the parity plan folds it into the one scale.
//
// The names survive because ~40 call sites use them and renaming those is churn
// with no user-visible benefit. The VALUES now come from
// contracts/design-tokens.json via design_tokens.g.dart.

import 'package:talbotiq/core/theme/design_tokens.g.dart';

class DesktopTokens {
  DesktopTokens._();

  // Spacing scale.
  static const double space4 = TokenSpace.xs;
  static const double space8 = TokenSpace.sm;
  static const double space12 = TokenSpace.md;
  static const double space16 = TokenSpace.lg;
  static const double space24 = TokenSpace.xxl;
  static const double space32 = TokenSpace.xxxl;

  /// The one card radius, shared with mobile and with the web client.
  static const double cardRadius = TokenRadius.card;

  // Top nav. Retired in Phase 6 when the desktop spine replaces it, but still
  // referenced until then.
  static const double topNavHeight = TokenLayout.topNavHeight;

  /// Content column cap on very wide/ultrawide windows, so cards do not
  /// stretch into unreadable ribbons.
  static const double pageMaxWidth = TokenLayout.pageMax;
  static const double pagePadding = TokenLayout.pagePadDesktop;
  static const double pagePaddingCompact = TokenLayout.pagePadDesktopCompact;

  /// Page horizontal padding scaled down on the narrower end of the desktop
  /// range (1280px-class windows), without collapsing to a phone gutter.
  static double pagePaddingFor(double width) =>
      width < TokenLayout.desktopCompactBelow ? pagePaddingCompact : pagePadding;
}

// GENERATED FILE — DO NOT EDIT.
//
// Source:    contracts/design-tokens.json
// Generator: scripts/gen-tokens.mjs
//
// Edit the source and re-run the generator. `node scripts/gen-tokens.mjs --check`
// gates the build, so a hand-edit here fails CI rather than silently
// un-sharing the web and Flutter design systems.

import 'dart:ui' show Color;

/// The four surface roles and the three ink weights, for one ground.
///
/// A card sits on [ground]; a chip sits on [surface]. The hierarchy is strict —
/// a [surfaceHigh] chip placed directly on the ground reads as a mistake,
/// because each contrast step is tuned for exactly one level.
class GroundTokens {
  final Color ground;
  final Color surface;
  final Color surfaceHigh;
  final Color stroke;
  final Color strokeStrong;
  final Color strokeInput;
  final Color separator;
  final Color ink;
  final Color inkBody;
  final Color inkMuted;
  final Color inkSubtle;
  final Color navBar;

  const GroundTokens({
    required this.ground,
    required this.surface,
    required this.surfaceHigh,
    required this.stroke,
    required this.strokeStrong,
    required this.strokeInput,
    required this.separator,
    required this.ink,
    required this.inkBody,
    required this.inkMuted,
    required this.inkSubtle,
    required this.navBar,
  });
}

const GroundTokens kGroundDark = GroundTokens(
  ground: Color(0xFF000000),
  surface: Color(0xFF101010),
  surfaceHigh: Color(0xFF1C1C1C),
  stroke: Color(0x1FFFFFFF),
  strokeStrong: Color(0x33FFFFFF),
  strokeInput: Color(0xFF686868),
  separator: Color(0x1FFFFFFF),
  ink: Color(0xFFF4F4F6),
  inkBody: Color(0xFFCACACE),
  inkMuted: Color(0xFF8A8A93),
  inkSubtle: Color(0xFF67676F),
  navBar: Color(0xFF141414),
);

const GroundTokens kGroundLight = GroundTokens(
  ground: Color(0xFFF6F3EE),
  surface: Color(0xFFFFFFFF),
  surfaceHigh: Color(0xFFEDE8E0),
  stroke: Color(0xFFE2DCD2),
  strokeStrong: Color(0xFFB6B0A8),
  strokeInput: Color(0xFF8A857E),
  separator: Color(0xB3E2DCD2),
  ink: Color(0xFF1A1613),
  inkBody: Color(0xFF3A352F),
  inkMuted: Color(0xFF6B635A),
  inkSubtle: Color(0xFF8C837B),
  navBar: Color(0xFF141210),
);

class TokenGroundDark {
  TokenGroundDark._();
  static const Color ground = Color(0xFF000000);
  static const Color surface = Color(0xFF101010);
  static const Color surfaceHigh = Color(0xFF1C1C1C);
  static const Color stroke = Color(0x1FFFFFFF);
  static const Color strokeStrong = Color(0x33FFFFFF);
  static const Color strokeInput = Color(0xFF686868);
  static const Color separator = Color(0x1FFFFFFF);
  static const Color ink = Color(0xFFF4F4F6);
  static const Color inkBody = Color(0xFFCACACE);
  static const Color inkMuted = Color(0xFF8A8A93);
  static const Color inkSubtle = Color(0xFF67676F);
  static const Color navBar = Color(0xFF141414);
}

class TokenGroundLight {
  TokenGroundLight._();
  static const Color ground = Color(0xFFF6F3EE);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceHigh = Color(0xFFEDE8E0);
  static const Color stroke = Color(0xFFE2DCD2);
  static const Color strokeStrong = Color(0xFFB6B0A8);
  static const Color strokeInput = Color(0xFF8A857E);
  static const Color separator = Color(0xB3E2DCD2);
  static const Color ink = Color(0xFF1A1613);
  static const Color inkBody = Color(0xFF3A352F);
  static const Color inkMuted = Color(0xFF6B635A);
  static const Color inkSubtle = Color(0xFF8C837B);
  static const Color navBar = Color(0xFF141210);
}

/// The spacing step. Only these values; nothing between them.
class TokenSpace {
  TokenSpace._();
  static const double xs = 4.0;
  static const double sm = 8.0;
  static const double md = 12.0;
  static const double lg = 16.0;
  static const double xl = 20.0;
  static const double xxl = 24.0;
  static const double xxxl = 32.0;
  static const double page = 16.0;
  static const double navClearance = 116.0;
}

/// Corner radii. A stadium is half its own height and is not listed.
class TokenRadius {
  TokenRadius._();
  static const double badge = 8.0;
  static const double pill = 12.0;
  static const double input = 18.0;
  static const double card = 20.0;
  static const double sheet = 26.0;
  static const double xl = 32.0;
}

class TokenBorder {
  TokenBorder._();
  static const double width = 1.0;
}

/// The user-selectable accents. Keys are a WIRE FORMAT — renaming one
/// silently resets everybody's stored choice to the default.
class TokenBlock {
  TokenBlock._();
  static const Color ink = Color(0xFF141210);
  static const Color cream = Color(0xFFF3EFE7);
  static const String defaultPrimary = 'peach';
  static const String defaultSecondary = 'lavender';

  static const Map<String, Color> accents = {
    'peach': Color(0xFFF5C9A8),
    'lavender': Color(0xFFC4B8EC),
    'mint': Color(0xFFA8DCC0),
    'sky': Color(0xFFA9CFEA),
    'butter': Color(0xFFEEDB9A),
    'clay': Color(0xFFE3B0A3),
  };

  static const Map<String, String> accentLabels = {
    'peach': 'Peach',
    'lavender': 'Lavender',
    'mint': 'Mint',
    'sky': 'Sky',
    'butter': 'Butter',
    'clay': 'Clay',
  };
}

/// Status maps to a SLOT, not a hue — see contracts/design-tokens.json.
class TokenStatus {
  TokenStatus._();
  static const Color fixedDanger = Color(0xFFF87171);
  static const double minContrast = 4.5;
  static const int scoreReady = 75;
  static const int scoreBorderline = 55;
}

/// Category tints for the interview formats. The canonical set is Flutter's
/// RoundKind; [formatAliases] folds the legacy web TrackType values onto it.
class TokenFormat {
  TokenFormat._();
  static const Map<String, Color> light = {
    'resume': Color(0xFF0F726A),
    'chat': Color(0xFFA84F09),
    'video': Color(0xFF157839),
    'voice': Color(0xFF4338CA),
    'two_way': Color(0xFF0369A1),
    'mcq': Color(0xFFBE185D),
  };
  static const Map<String, Color> dark = {
    'resume': Color(0xFF45C7B8),
    'chat': Color(0xFFE9A23B),
    'video': Color(0xFF5CC98A),
    'voice': Color(0xFF9B8CFF),
    'two_way': Color(0xFF5BB3E8),
    'mcq': Color(0xFFF97BB0),
  };

  static const Map<String, String> labels = {
    'resume': 'Résumé screen',
    'chat': 'Chat interview',
    'video': 'Video interview',
    'voice': 'Voice interview',
    'two_way': 'Live interview',
    'mcq': 'Assessment',
  };

  static const Map<String, String> aliases = {
    'chatbot': 'chat',
    'video_avatar': 'video',
    'twoway': 'two_way',
  };

  /// Resolves a stored track value to a canonical format key.
  static String canonical(String key) => aliases[key] ?? key;
}

/// The nav chrome: the phone's floating bar and the desktop spine.
///
/// Dark in BOTH themes, which is why it is not part of a ground. A spine
/// that followed the ground would be a white rectangle in a dark room.
class TokenChrome {
  TokenChrome._();
  static const Color bar = Color(0xFF141414);
  static const Color surface = Color(0xFF1F1F1F);
  static const Color stroke = Color(0x1FFFFFFF);
  static const Color ink = Color(0xFFF3EFE7);
  static const Color inkMuted = Color(0xFF9A9A93);
}

class TokenType {
  TokenType._();
  static const String ui = 'Inter';
  static const String mono = 'Chivo Mono';
}

class TokenLayout {
  TokenLayout._();
  static const double pageMax = 1600.0;
  static const double pageMaxReading = 880.0;
  static const double pagePad = 16.0;
  static const double pagePadWide = 24.0;
  static const double pagePadDesktop = 32.0;
  static const double pagePadDesktopCompact = 20.0;
  static const double desktopCompactBelow = 1360.0;
  static const double topNavHeight = 68.0;
  static const double spineWidth = 240.0;
  static const double spineWidthCollapsed = 64.0;
}

class TokenMotion {
  TokenMotion._();
  static const Duration instant = Duration(milliseconds: 90);
  static const Duration fast = Duration(milliseconds: 150);
  static const Duration base = Duration(milliseconds: 240);
  static const Duration slow = Duration(milliseconds: 420);
  static const Duration cinematic = Duration(milliseconds: 720);
}

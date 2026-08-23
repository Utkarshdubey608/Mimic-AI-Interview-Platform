// lib/core/constants/colors.dart
import 'package:flutter/material.dart';

import 'package:talbotiq/core/theme/design_tokens.g.dart';

class AppColors {
  // Material Design 3 Minimal Dark Palette - Near-Black & Restrained Pastels
  static const Color background = Color(0xFF0F0F12);       // Near-black primary background
  static const Color backgroundDarker = Color(0xFF141418); // Darker surface / inputs
  static const Color backgroundBlack = Color(0xFF0A0A0D);  // Deepest background

  // Flat surfaces and clean hairline borders
  static const Color cardBg = Color(0xFF18181D);           // Flat dark surface
  static const Color surfaceElevated = Color(0xFF202026);   // Slightly lighter dark surface
  static const Color surfaceOverlay = Color(0xFF26262E);    // Layered surface
  static const Color border = Color(0x1AFFFFFF);           // Subtle 10% hairline border
  static const Color borderLight = Color(0x0EFFFFFF);      // Ultra-subtle 6% border
  static const Color separator = Color(0x14FFFFFF);        // Thin list separator
  
  // Soft Pastel Accents (Reference Design Language)
  static const Color pastelYellow = Color(0xFFFEF08A);     // Soft Pastel Yellow (Planning/Accent Card)
  static const Color pastelYellowDark = Color(0xFF1C1917); // Dark contrast text on pastel yellow
  static const Color pastelMint = Color(0xFF86EFAC);       // Soft Mint / Light Green
  static const Color pastelMintBg = Color(0x1F86EFAC);     // Translucent Mint Tint
  static const Color pastelMintText = Color(0xFF86EFAC);   // Mint text
  static const Color pastelCyan = Color(0xFF7DD3FC);       // Light Cyan
  static const Color pastelCyanBg = Color(0x1F7DD3FC);     // Translucent Cyan Tint
  static const Color pastelCyanText = Color(0xFF7DD3FC);   // Cyan text
  static const Color pastelLavender = Color(0xFFDDD6FE);   // Soft Purple / Lavender
  static const Color pastelLavenderBg = Color(0x1FDDD6FE); // Translucent Lavender Tint
  static const Color pastelLavenderText = Color(0xFFC4B5FD);
  static const Color pastelPeach = Color(0xFFFDBA74);      // Muted Orange / Peach
  static const Color pastelPeachBg = Color(0x1FFDBA74);    // Translucent Peach Tint

  // Brand accents (Clean modern emerald & indigo)
  static const Color primary = Color(0xFF86EFAC);         // Restrained soft mint/emerald
  static const Color primaryHover = Color(0xFF4ADE80);
  static const Color primaryLight = Color(0xFF064E3B);
  static const Color accent = Color(0xFF818CF8);           // Soft Indigo Accent
  static const Color accentLight = Color(0x20818CF8);
  
  // Feedback colors
  static const Color success = Color(0xFF86EFAC);          // Success mint
  static const Color successBg = Color(0xFF064E3B);
  static const Color successBorder = Color(0xFF047857);
  
  static const Color warning = Color(0xFFFDE047);          // Soft Yellow warnings
  static const Color warningBg = Color(0xFF78350F);
  static const Color warningBorder = Color(0xFFB45309);
  
  static const Color danger = Color(0xFFF87171);           // Soft Red
  static const Color dangerBg = Color(0xFF7F1D1D);
  static const Color dangerBorder = Color(0xFF991B1B);
  
  // Grays / Neutral text
  static const Color textLight = Color(0xFFF4F4F6);        // Crisp off-white (Primary)
  static const Color textMuted = Color(0xFF8A8A93);        // Muted gray (Secondary)
  static const Color textSubtle = Color(0xFF52525B);       // Subtle gray (Tertiary)
  static const Color textDark = Color(0xFF0F172A);         // Deep text
  
  // ── Recruiter surfaces + solid pastel blocks ────────────────────────────
  // Dark mode is TRUE BLACK, not a tinted near-black: on an OLED panel the
  // page disappears and only the pastel blocks and cards read, which is the
  // whole effect. Light mode stays warm cream, matching the reference's light
  // screen. Kept as their own names so this cannot shift the candidate side's
  // neutrals.
  static const Color warmBackground = TokenGroundDark.ground;   // Pure black ground
  static const Color warmSurface = TokenGroundDark.surface;      // Card, just off black
  static const Color warmSurfaceHigh = TokenGroundDark.surfaceHigh;  // Nested surface
  // A hairline needs more presence on pure black than on a tinted ground,
  // otherwise a card has no edge at all.
  static const Color warmBorder = TokenGroundDark.stroke;        // ~12% white hairline

  // The bottom bar is dark in BOTH themes — a black pill carrying a light
  // selected chip, per the reference. On the black page it is lifted just
  // enough to read as a floating element.
  static const Color navBarDark = TokenGroundDark.navBar;
  static const Color navBarOnDark = Color(0xFFF3EFE7);

  // Solid pastel blocks — painted at full strength, with near-black ink on top.
  static const Color blockPeach = Color(0xFFF5C9A8);       // Apricot hero block
  static const Color blockLavender = Color(0xFFB9AEE8);    // Periwinkle block
  static const Color blockCream = TokenBlock.cream;              // Off-white block
  static const Color blockInk = TokenBlock.ink;                  // Ink used on any block

  // Analytics panel accents
  static const Color analyticsBase = Color(0xFF0F0F12);
  static const Color analyticsCard = Color(0xFF18181D);
  static const Color analyticsBorder = Color(0x1AFFFFFF);
  static const Color analyticsText = Color(0xFFF4F4F6);
  static const Color analyticsMuted = Color(0xFF8A8A93);
  static const Color analyticsTeal = Color(0xFF2DD4BF);
}

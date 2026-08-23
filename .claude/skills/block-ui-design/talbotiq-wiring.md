# How this repo wires the language

App-specific companion to SKILL.md. Read that first for the language itself;
this is only where the pieces live in `mobile_desktop_app_version/`.

The **whole app** wears this language — recruiter, candidate, auth, settings.
`WarmSurfaces.theme(...)` is applied to both `theme:` and `darkTheme:` on
`MaterialApp` in `main.dart`, so every screen and every pushed route inherits it.

`RecruiterScaffold` / `RecruiterTheme` still install it over the recruiter
screens. With one app-wide theme that is a no-op; it is kept because it costs
nothing and keeps those screens correct if the app is ever split into sections
with differing looks again.

## Files

| File | Holds |
|---|---|
| `lib/core/theme/warm_surfaces.dart` | `WarmSurfaces` — the four surface roles, both block slots, and `theme(base, accent:, secondary:)` which derives the full ThemeData |
| `lib/core/theme/accent_palette.dart` | `AppAccent` — the six selectable pastels, their wire format, and `.block` |
| `lib/core/theme/status_tones.dart` | `StatusTone` — semantic states in terms of the user's accents, darkened for a light ground |
| `lib/core/theme/design_tokens.dart` | `AppSpacing`, `AppRadius`, `AppBorders`, `AppShadows` |
| `lib/core/constants/colors.dart` | `AppColors` — raw values, incl. the semantic `pastel*` set. Read via WarmSurfaces, not directly |
| `lib/features/recruiter/views/widgets/recruiter_ui.dart` | Every shared component, plus `RecruiterScaffold` / `RecruiterTheme` |
| `lib/shared/widgets/floating_nav_bar.dart` | The bottom bar (dark in both themes) |
| `lib/features/settings/sections/appearance_section.dart` | The primary + secondary colour pickers |
| `lib/main.dart` | Installs the theme app-wide from the user's two accent choices |
| `lib/shared/widgets/apple_ui.dart` | Settings' cards/rows. `AppleIconBadge` picks its glyph colour from the fill's brightness |
| `lib/shared/providers/app_store.dart` | Persists `accent` and `secondaryAccent` |

## Rules

- New recruiter screen → `RecruiterScaffold`, never a bare `Scaffold`.
- A screen rendering several Scaffolds itself → wrap its build in
  `RecruiterTheme` once (see `views/runner/conversation_runner_page.dart`).
- Colours via `WarmSurfaces.*(context)`. Blocks via `WarmSurfaces.block(context)`
  and `.blockSecondary(context)`.
- Status meaning via `StatusTone` (`lib/core/theme/status_tones.dart`):
  `ready` / `pending` / `failed` / `neutral` / `forScore` / `ranked`. These DO
  follow the user's accents — see the skill for why that is safe.
  `scoreColor()` / `statusColor()` in `recruiter_ui.dart` delegate to it.
- `StatusBadge` carries a `BadgeTone`, not a colour, so a const factory can
  still name a meaning and let `build` resolve it.
- Category tints (test type, library section, 5-way chart buckets) stay on the
  fixed `AppColors.pastel*` set — they distinguish kinds, not states.
- `report_pdf.dart` is print output (`pw.*` widgets), deliberately excluded.
- `desktop_tokens.dart` is the separate desktop-only scale, also excluded.

## Watch out for

`Colors.white` glyphs or text sitting on a caller-supplied fill. The language's
fills are light pastels, so a hardcoded white glyph disappears. Derive it —
`ThemeData.estimateBrightnessForColor(fill)` — as `AppleIconBadge` does.

## Tests

- `test/recruiter_ui_layout_test.dart` — every shared component, pumped at
  300–360dp in a scrolling column, both themes. Add new components here.
- `test/floating_nav_bar_test.dart` — nav layout, proportions, a11y, truncation.
- `test/accent_palette_test.dart` — WCAG AA on all options, both slots reach the
  theme, wire-format fallbacks.
- `test/apple_icon_badge_test.dart` — glyph contrast against light and dark fills.
- `test/status_tones_test.dart` — ready≠pending at all 30 accent pairings,
  failure never an accent, every tone legible as text on both grounds.

## Gotcha

This repo is **not** `dart format` clean at HEAD. Running it produces a large
unrelated diff — match surrounding style by hand instead.

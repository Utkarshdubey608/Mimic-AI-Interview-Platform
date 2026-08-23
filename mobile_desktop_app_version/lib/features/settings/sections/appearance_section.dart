// lib/views/settings/appearance_section.dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:talbotiq/core/theme/accent_palette.dart';
import 'package:talbotiq/shared/providers/app_store.dart';
import 'package:talbotiq/shared/widgets/apple_ui.dart';

/// Settings category: light/dark appearance.
class AppearanceSection extends StatelessWidget {
  const AppearanceSection({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Listen only to the theme mode; read (non-listening) for the setters.
    final themeMode = context.select<AppStore, ThemeMode>((s) => s.themeMode);
    final accent = context.select<AppStore, AppAccent>((s) => s.accent);
    final secondary =
        context.select<AppStore, AppAccent>((s) => s.secondaryAccent);
    final store = context.read<AppStore>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AppleSectionCard(
          title: 'Appearance',
          subtitle: 'Customize the look and feel of Mimic.',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'THEME',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.8,
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: _ThemeOptionCard(
                      title: 'Light mode',
                      icon: Icons.light_mode_outlined,
                      selected: themeMode == ThemeMode.light,
                      onTap: () => store.setThemeMode(ThemeMode.light),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: _ThemeOptionCard(
                      title: 'Dark mode',
                      icon: Icons.dark_mode_outlined,
                      selected: themeMode == ThemeMode.dark,
                      onTap: () => store.setThemeMode(ThemeMode.dark),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              Text(
                'PRIMARY COLOUR',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.8,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'The featured card, the primary button and the selected tab.',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 14),
              // A wrap, not a row: six swatches do not fit one phone line, and
              // this is the kind of control that should never scroll sideways.
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  for (final option in AppAccent.values)
                    _AccentSwatch(
                      accent: option,
                      selected: option == accent,
                      onTap: () => store.setAccent(option),
                    ),
                ],
              ),
              const SizedBox(height: 24),
              Text(
                'SECONDARY COLOUR',
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.8,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Charts, meters and progress bars. Pick something distinct '
                'from the primary so the two read apart.',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 14),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  for (final option in AppAccent.values)
                    _AccentSwatch(
                      accent: option,
                      selected: option == secondary,
                      // Flagged rather than blocked: matching both is a
                      // legitimate choice for a monochrome look, it just makes
                      // charts recede into the hero.
                      warn: option == accent,
                      onTap: () => store.setSecondaryAccent(option),
                    ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ThemeOptionCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  const _ThemeOptionCard({
    required this.title,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
        decoration: BoxDecoration(
          color: selected
              ? theme.colorScheme.primary.withOpacity(0.08)
              : theme.colorScheme.surfaceContainerHighest.withOpacity(0.5),
          border: Border.all(
            color: selected
                ? theme.colorScheme.primary
                : theme.colorScheme.outline.withOpacity(0.12),
            width: selected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 28,
              color: selected
                  ? theme.colorScheme.primary
                  : theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: TextStyle(
                fontSize: 14,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color: selected
                    ? theme.colorScheme.primary
                    : theme.colorScheme.onSurface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One accent choice: the block colour itself, with its name under it, so the
/// swatch previews exactly what the setting paints.
class _AccentSwatch extends StatelessWidget {
  final AppAccent accent;
  final bool selected;
  final VoidCallback onTap;

  /// Marks a choice that is allowed but probably not what the user wants —
  /// currently, a secondary that matches the primary.
  final bool warn;

  const _AccentSwatch({
    required this.accent,
    required this.selected,
    required this.onTap,
    this.warn = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Semantics(
      label: accent.label,
      button: true,
      selected: selected,
      child: Tooltip(
        message: accent.label,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: accent.block,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    // The ring is drawn in the block's own ink, so the
                    // selected swatch reads the same way on every colour.
                    color: selected
                        ? theme.colorScheme.onSurface
                        : Colors.transparent,
                    width: 2,
                  ),
                ),
                child: selected
                    ? const Icon(Icons.check_rounded,
                        size: 22, color: Color(0xFF141210))
                    : warn
                        ? const Icon(Icons.remove_rounded,
                            size: 18, color: Color(0x66141210))
                        : null,
              ),
              const SizedBox(height: 6),
              Text(
                accent.label,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: selected
                      ? theme.colorScheme.onSurface
                      : theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

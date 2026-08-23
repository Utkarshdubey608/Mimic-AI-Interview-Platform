// lib/features/settings/sections/preferences_section.dart
//
// Settings category (recruiter desktop only): Font Size. Controls the
// AppStore.desktopFontScale value that main.dart applies once, at the
// MaterialApp root, via MediaQuery.textScaler — so this one slider reaches
// every desktop screen, dialog and dynamically created page without any of
// them needing their own font-size branch.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:talbotiq/shared/providers/app_store.dart';
import 'package:talbotiq/shared/widgets/apple_ui.dart';

class PreferencesSection extends StatelessWidget {
  const PreferencesSection({super.key});

  @override
  Widget build(BuildContext context) {
    final scale = context.select<AppStore, double>((s) => s.desktopFontScale);
    final store = context.read<AppStore>();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AppleSectionCard(
          title: 'Font size',
          subtitle: 'Adjust the size of text across the desktop application.',
          child: _FontSizeSlider(scale: scale, onChanged: store.setDesktopFontScale),
        ),
      ],
    );
  }
}

class _FontSizeSlider extends StatelessWidget {
  final double scale;
  final ValueChanged<double> onChanged;
  const _FontSizeSlider({required this.scale, required this.onChanged});

  // Guidance values from the brief: readable steps that scale typography
  // without touching spacing/component dimensions, so layouts stay stable.
  static const _scales = [0.90, 1.00, 1.10, 1.20];
  static const _labels = ['Small', 'Medium', 'Large', 'Extra large'];

  int get _index {
    var closest = 1; // Medium — sane fallback for a legacy/unexpected value.
    var bestDiff = double.infinity;
    for (var i = 0; i < _scales.length; i++) {
      final diff = (_scales[i] - scale).abs();
      if (diff < bestDiff) {
        bestDiff = diff;
        closest = i;
      }
    }
    return closest;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final idx = _index;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('A',
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: scheme.onSurfaceVariant, fontSize: 13)),
            Expanded(
              child: SliderTheme(
                data: SliderTheme.of(context).copyWith(
                  activeTrackColor: scheme.primary,
                  inactiveTrackColor: scheme.outlineVariant.withValues(alpha: 0.4),
                  thumbColor: scheme.primary,
                  overlayColor: scheme.primary.withValues(alpha: 0.12),
                  trackHeight: 4,
                ),
                child: Slider(
                  value: idx.toDouble(),
                  min: 0,
                  max: (_scales.length - 1).toDouble(),
                  divisions: _scales.length - 1,
                  label: _labels[idx],
                  onChanged: (v) => onChanged(_scales[v.round()]),
                ),
              ),
            ),
            Text('A',
                style: theme.textTheme.bodyMedium
                    ?.copyWith(color: scheme.onSurfaceVariant, fontSize: 22)),
          ],
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6),
          child: Row(
            children: [
              for (var i = 0; i < _labels.length; i++)
                Expanded(
                  child: Text(
                    i == 1 ? '${_labels[i]}\n(Default)' : _labels[i],
                    textAlign: i == 0
                        ? TextAlign.left
                        : (i == _labels.length - 1 ? TextAlign.right : TextAlign.center),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: i == idx ? scheme.primary : scheme.onSurfaceVariant,
                      fontWeight: i == idx ? FontWeight.w700 : FontWeight.w500,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

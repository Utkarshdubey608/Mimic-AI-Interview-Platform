// lib/features/interviews/recruiter/widgets/recruiter_action_bar.dart
//
// The labelled action row that sits under a recruiter screen's app bar.

import 'package:flutter/material.dart';
import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

/// One action in a [RecruiterActionBar].
class RecruiterAction {
  final String label;
  final IconData icon;

  /// Null disables the action — it stays visible but greyed, so a recruiter can
  /// see it exists and is simply not available yet.
  final VoidCallback? onPressed;

  /// Tints the button with the error colour. For actions that destroy data.
  final bool destructive;

  const RecruiterAction({
    required this.label,
    required this.icon,
    required this.onPressed,
    this.destructive = false,
  });
}

class RecruiterActionBar extends StatelessWidget {
  /// In order of how often they are used, NOT how prominent they are. Put any
  /// destructive action last so it is never adjacent to the one meant instead.
  final List<RecruiterAction> actions;

  const RecruiterActionBar({super.key, required this.actions});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    if (actions.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 2, bottom: 6),
          child: Text(
            'ACTIONS',
            style: TextStyle(
              fontSize: 10.5,
              color: isDark ? AppColors.textSubtle : theme.colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.0,
            ),
          ),
        ),
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: WarmSurfaces.surface(context),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: WarmSurfaces.stroke(context),
            ),
          ),
          child: Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final action in actions) _ActionPill(action: action),
            ],
          ),
        ),
      ],
    );
  }
}

class _ActionPill extends StatelessWidget {
  final RecruiterAction action;
  const _ActionPill({required this.action});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final enabled = action.onPressed != null;
    // Read from the scheme, not from AppColors directly: under the dark theme
    // these resolve to the same pastels (error IS AppColors.danger, primary IS
    // the mint), but going through the scheme keeps the light theme correct and
    // keeps the widget honest about where its colours come from.
    final accent = action.destructive
        ? theme.colorScheme.error
        : theme.colorScheme.primary;
    final color = enabled ? accent : WarmSurfaces.inkSubtle(context);

    return Material(
      color: WarmSurfaces.surface(context),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        side: BorderSide(
          color: enabled
              ? color.withValues(alpha: 0.35)
              : WarmSurfaces.stroke(context),
        ),
      ),
      child: InkWell(
        onTap: action.onPressed,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(action.icon, size: 14, color: color),
              const SizedBox(width: 5),
              Text(
                action.label,
                style: TextStyle(
                  color: color,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
// lib/features/interviews/candidate/results/widgets/strengths_watchpoints_panel.dart
//
// The candidate's strengths and watch points, each behind a disclosure so the
// report opens as a summary rather than a wall of tags.
//
// The two halves were near-identical copies that had drifted apart (different
// border colours, one commented "radius: 16" while setting 30). They are one
// widget now, taking only the accent and the copy that actually differ — so a
// change to the shape cannot land on one and miss the other.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/core/theme/status_tones.dart';

class StrengthsWatchpointsPanel extends StatelessWidget {
  final List<String> strengths;
  final List<String> watchPoints;

  const StrengthsWatchpointsPanel({
    super.key,
    required this.strengths,
    required this.watchPoints,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _DisclosurePanel(
          title: 'Strengths',
          icon: Icons.check_circle_outline_rounded,
          accent: StatusTone.ready(context),
          items: strengths,
        ),
        const SizedBox(height: AppSpacing.md),
        _DisclosurePanel(
          title: 'Watch points',
          icon: Icons.error_outline_rounded,
          // Not the failure tone: these are things to look at, not failures.
          accent: StatusTone.pending(context),
          items: watchPoints,
        ),
      ],
    );
  }
}

class _DisclosurePanel extends StatelessWidget {
  final String title;
  final IconData icon;
  final Color accent;
  final List<String> items;

  const _DisclosurePanel({
    required this.title,
    required this.icon,
    required this.accent,
    required this.items,
  });

  /// What the collapsed row shows, so the panel is useful without opening it.
  String get _preview {
    if (items.isEmpty) return 'None';
    if (items.length <= 2) return items.join(', ');
    return '${items.take(2).join(', ')} +${items.length - 2} more';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      decoration: WarmSurfaces.card(context, radius: AppRadius.card),
      clipBehavior: Clip.antiAlias,
      child: Theme(
        // ExpansionTile draws its own divider; the card's border already
        // separates it from the page.
        data: theme.copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          initiallyExpanded: false,
          tilePadding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg, vertical: AppSpacing.sm),
          childrenPadding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.xl),
          iconColor: WarmSurfaces.inkMuted(context),
          collapsedIconColor: WarmSurfaces.inkMuted(context),
          leading: Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(color: accent, shape: BoxShape.circle),
            child: Icon(icon, color: WarmSurfaces.onBlock, size: 18),
          ),
          title: Text(
            title,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.2,
              color: WarmSurfaces.ink(context),
            ),
          ),
          subtitle: Text(
            _preview,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 12.5,
              color: WarmSurfaces.inkMuted(context),
            ),
          ),
          children: [
            Align(
              alignment: Alignment.centerLeft,
              child: items.isEmpty
                  ? Text(
                      'Nothing recorded.',
                      style: TextStyle(
                        fontSize: 12.5,
                        color: WarmSurfaces.inkSubtle(context),
                      ),
                    )
                  : Wrap(
                      spacing: AppSpacing.sm,
                      runSpacing: AppSpacing.sm,
                      children: [
                        for (final item in items) _Tag(text: item, accent: accent),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  final String text;
  final Color accent;

  const _Tag({required this.text, required this.accent});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.sm - 2),
      decoration: BoxDecoration(
        color: accent.withValues(alpha: 0.12),
        border: Border.all(color: accent.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 12.5,
          fontWeight: FontWeight.w600,
          color: accent,
        ),
      ),
    );
  }
}

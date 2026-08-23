// lib/features/interviews/recruiter/widgets/round_step_tile.dart
//
// One step of a test's timeline, styled with minimal dark design language.

import 'package:flutter/material.dart';
import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

/// The icon for a round kind. Shared so the same kind never shows two icons.
IconData roundKindIcon(RoundKind kind) {
  switch (kind) {
    case RoundKind.resume:
      return Icons.description_outlined;
    case RoundKind.chat:
      return Icons.chat_bubble_outline_rounded;
    case RoundKind.video:
      return Icons.videocam_outlined;
    case RoundKind.voice:
      return Icons.mic_none_outlined;
    case RoundKind.twoWay:
      return Icons.groups_outlined;
    case RoundKind.mcq:
      return Icons.fact_check_outlined;
  }
}

/// A round's window in words, or an honest statement that it has none.
String roundWindowLabel(InterviewRound round) {
  final opens = round.opensAt;
  final closes = round.closesAt;
  if (opens == null && closes == null) return 'No dates — closed by hand';
  if (opens != null && closes != null) {
    return '${formatDateTime(opens)} → ${formatDateTime(closes)}';
  }
  if (opens != null) return 'From ${formatDateTime(opens)}';
  return 'Until ${formatDateTime(closes!)}';
}

class RoundStepTile extends StatelessWidget {
  final InterviewRound round;

  /// 1-based position in the timeline, and how many steps there are.
  final int position;
  final int total;

  /// Draws the connector down to the next step. False on the last one.
  final bool showConnector;

  /// Emphasises this step.
  final bool highlight;

  /// Short reason for the emphasis, e.g. "assigned on save".
  final String? highlightLabel;

  /// A status chip to show, when the caller has a clock to derive it from.
  final String? stateLabel;
  final Color? stateColor;

  /// Assigned candidates. Negative hides it.
  final int assignedCount;

  /// This screen's actions: a menu, a drag handle, a remove button.
  final Widget? trailing;

  final VoidCallback? onTap;

  const RoundStepTile({
    super.key,
    required this.round,
    required this.position,
    required this.total,
    this.showConnector = false,
    this.highlight = false,
    this.highlightLabel,
    this.stateLabel,
    this.stateColor,
    this.assignedCount = -1,
    this.trailing,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final accentColor = isDark ? AppColors.pastelMintText : theme.colorScheme.primary;

    final questions = (round.config['questions'] as List?)?.length ?? 0;
    final detail = round.kind.usesAiInterviewer
        ? '${round.kind.label} · $questions question(s)'
        : round.kind == RoundKind.mcq && (round.config['mcqSetId'] as String?)?.isNotEmpty == true
            ? '${round.kind.label} · paper attached'
            : round.kind.label;

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The step marker and the line joining it to the next step.
          Column(
            children: [
              Container(
                width: 26,
                height: 26,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: WarmSurfaces.surfaceHigh(context),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: highlight
                        ? accentColor
                        : (WarmSurfaces.stroke(context)),
                    width: highlight ? 1.5 : 1,
                  ),
                ),
                child: Text(
                  '$position',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: highlight ? accentColor : (isDark ? AppColors.textLight : theme.colorScheme.onSurface),
                  ),
                ),
              ),
              if (showConnector)
                Expanded(
                  child: Container(
                    width: 1.5,
                    margin: const EdgeInsets.symmetric(vertical: 3),
                    color: WarmSurfaces.separator(context),
                  ),
                ),
            ],
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: showConnector ? 8 : 0),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: onTap,
                  borderRadius: BorderRadius.circular(16),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    decoration: BoxDecoration(
                      color: WarmSurfaces.surface(context),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: highlight
                            ? accentColor.withValues(alpha: 0.5)
                            : (WarmSurfaces.stroke(context)),
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          roundKindIcon(round.kind),
                          size: 16,
                          color: isDark ? AppColors.textMuted : theme.colorScheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Flexible(
                                    child: Text(
                                      round.title.isEmpty ? 'Untitled round' : round.title,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 13.5,
                                        fontWeight: FontWeight.w600,
                                        color: isDark ? AppColors.textLight : theme.colorScheme.onSurface,
                                      ),
                                    ),
                                  ),
                                  if (highlightLabel != null) ...[
                                    const SizedBox(width: 6),
                                    Text(
                                      '· $highlightLabel',
                                      style: TextStyle(
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w500,
                                        color: accentColor,
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Step $position of $total · $detail',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 11.5,
                                  color: isDark ? AppColors.textMuted : theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Row(
                                children: [
                                  Icon(
                                    Icons.schedule_rounded,
                                    size: 11,
                                    color: isDark ? AppColors.textSubtle : theme.colorScheme.onSurfaceVariant,
                                  ),
                                  const SizedBox(width: 4),
                                  Expanded(
                                    child: Text(
                                      roundWindowLabel(round),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: 10.5,
                                        color: isDark ? AppColors.textSubtle : theme.colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              if (stateLabel != null || assignedCount >= 0) ...[
                                const SizedBox(height: 5),
                                Wrap(
                                  spacing: 6,
                                  runSpacing: 4,
                                  crossAxisAlignment: WrapCrossAlignment.center,
                                  children: [
                                    if (stateLabel != null)
                                      _chip(theme, stateLabel!, stateColor ?? accentColor),
                                    if (assignedCount >= 0)
                                      Text(
                                        '$assignedCount candidate(s)',
                                        style: TextStyle(
                                          fontSize: 10.5,
                                          color: isDark ? AppColors.textMuted : theme.colorScheme.onSurfaceVariant,
                                        ),
                                      ),
                                  ],
                                ),
                              ],
                            ],
                          ),
                        ),
                        if (trailing != null) trailing!,
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _chip(ThemeData theme, String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          border: Border.all(color: color.withValues(alpha: 0.3)),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(
          text,
          style: TextStyle(
            color: color,
            fontSize: 10,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
}


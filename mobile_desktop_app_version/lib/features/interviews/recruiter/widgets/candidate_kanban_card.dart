// lib/features/interviews/recruiter/widgets/candidate_kanban_card.dart
//
// One candidate's card on the Candidates Kanban — read-only, one per
// `CandidateRun`, placed in the column of their CURRENT (most recent) round.
// Styled after `InterviewCard`'s visual language so the board reads as part of
// the same screen rather than a bolted-on view.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/recruiter/candidate_grouping.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/interview_card.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

class CandidateKanbanCard extends StatelessWidget {
  final CandidateRun run;

  /// Resolves a role-category slug to its human display name. Optional — the
  /// raw slug is shown while the category list is still loading.
  final String? Function(String slug)? categoryLabel;

  final VoidCallback onTap;

  const CandidateKanbanCard({
    super.key,
    required this.run,
    required this.onTap,
    this.categoryLabel,
  });

  Widget _pill(ThemeData theme, String text, Color color, {IconData? icon}) =>
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          border: Border.all(color: color.withValues(alpha: 0.3)),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 10.5, color: color),
              const SizedBox(width: 3.5),
            ],
            Text(
              text,
              style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: color),
            ),
          ],
        ),
      );

  /// The current round's score, or why there isn't one yet — mirroring
  /// `InterviewCard`'s own score pill exactly, so the same interview reads the
  /// same way whichever view it is seen in.
  Widget? _scoreBadge(ThemeData theme, Interview current, bool isDark) {
    if (current.evaluationFailed) {
      return _pill(theme, 'Scoring failed', AppColors.danger, icon: Icons.error_outline);
    }
    if (current.awaitingRecruiterReview) {
      return _pill(theme, 'Awaiting score', AppColors.warning, icon: Icons.star_outline);
    }
    if (current.awaitingEvaluation) {
      return _pill(
        theme,
        'Not scored',
        isDark ? AppColors.textSubtle : theme.colorScheme.onSurfaceVariant,
      );
    }
    final score = current.result?['overallScore'];
    if (score == null) return null;
    return _pill(
      theme,
      'Score: $score',
      isDark ? AppColors.pastelMintText : theme.colorScheme.primary,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    // The candidate's CURRENT round — the most recently assigned one. A
    // pipeline only assigns the next round once a candidate has advanced, so
    // the last entry is always where they stand right now.
    final current = run.rounds.last;

    final rawCategory = current.roleCategory?.trim();
    final roleLabel = (rawCategory == null || rawCategory.isEmpty)
        ? 'Role not specified'
        : (categoryLabel?.call(rawCategory) ?? rawCategory);

    final roundTitle = current.hasRound
        ? roundLabelFor(current)
        : current.effectiveRoundKind.label;

    final segments = [
      for (var i = 0; i < run.rounds.length; i++)
        run.rounds[i].status == InterviewStatus.completed
            ? RecruiterSegmentState.done
            : (i == run.rounds.length - 1
                ? RecruiterSegmentState.current
                : RecruiterSegmentState.idle),
    ];

    final scoreBadge = _scoreBadge(theme, current, isDark);
    final accent = isDark ? AppColors.pastelCyanText : theme.colorScheme.primary;

    return Container(
      decoration: BoxDecoration(
        color: WarmSurfaces.surface(context),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: WarmSurfaces.stroke(context)),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  run.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.2,
                    color: isDark ? AppColors.textLight : theme.colorScheme.onSurface,
                  ),
                ),
                if (run.displayName != run.email) ...[
                  const SizedBox(height: 2),
                  Text(
                    run.email,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11.5,
                      color: isDark ? AppColors.textMuted : theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                _pill(theme, roleLabel, accent),
                const SizedBox(height: 8),
                Text(
                  roundTitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: isDark ? AppColors.textMuted : theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                if (run.rounds.length > 1) ...[
                  const SizedBox(height: 8),
                  RecruiterSegmentedProgress(segments: segments, currentColor: accent),
                ],
                if (scoreBadge != null) ...[
                  const SizedBox(height: 8),
                  scoreBadge,
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

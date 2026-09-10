// lib/features/interviews/recruiter/widgets/interview_card.dart
//
// One candidate row on a test's candidate list — extracted from
// `test_candidates_page.dart`'s private `_InterviewCard` (pure code motion, no
// visual change) so the Candidates Kanban's card can share its visual language
// and so both share the extracted `showInterviewDetailSheet`.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/test_conclusion.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/interview_detail_sheet.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';

/// "Round 2 · Technical screen" — which round of the test this row is.
///
/// `interview.title` is the ROUND's title (see `InterviewRound.assignTo`), and
/// falls back to the test's title for a round that was never named or for a
/// pre-timeline document. In that case the kind is the only informative half,
/// so it is used instead of echoing the test name that is already in the app
/// bar.
String roundLabelFor(Interview i) {
  final n = i.effectiveRoundOrder + 1;
  final title = i.title.trim();
  final generic = title.isEmpty || title == i.testTitle.trim();
  return 'Round $n · ${generic ? i.effectiveRoundKind.label : title}';
}

class InterviewCard extends StatelessWidget {
  final Interview interview;
  final List<Interview> groupInterviews;
  final int index;

  /// Name the round on this row. True in a test's all-rounds view, where a
  /// candidate has one row per round and the round is the only thing that tells
  /// those rows apart.
  final bool showRound;

  /// This row is another round of the candidate on the row above: it indents,
  /// drops the avatar, and leads with the round instead of repeating a name and
  /// email that are already directly above it.
  final bool continuation;

  const InterviewCard({
    super.key,
    required this.interview,
    required this.groupInterviews,
    required this.index,
    this.showRound = false,
    this.continuation = false,
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
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final name = interview.candidateName?.isNotEmpty == true
        ? interview.candidateName!
        : interview.candidateEmail;
    final hasName = interview.candidateName?.isNotEmpty == true;

    final roundLabel = interview.hasRound ? roundLabelFor(interview) : null;
    final conclusion = interview.testConclusion;
    final qs = interview.questions.length;
    final titleText = continuation ? (roundLabel ?? interview.title) : name;
    final subtitleText = [
      if (!continuation && hasName) interview.candidateEmail,
      if (!continuation && showRound && roundLabel != null) roundLabel,
      if (qs > 0)
        '$qs Qs'
      else if (roundLabel == null)
        interview.effectiveRoundKind.label,
    ].join(' · ');

    final score = interview.result != null
        ? interview.result!['overallScore']
        : null;

    return Container(
      margin: continuation ? const EdgeInsets.only(left: 20) : EdgeInsets.zero,
      decoration: BoxDecoration(
        color: continuation
            ? (WarmSurfaces.surfaceHigh(context).withValues(alpha: 0.3))
            : (WarmSurfaces.surface(context)),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: WarmSurfaces.stroke(context)),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => showInterviewDetailSheet(
            context,
            groupInterviews: groupInterviews,
            initialIndex: index,
            repo: context.read<InterviewRepository>(),
          ),
          child: Padding(
            padding: EdgeInsets.all(continuation ? 10 : 13),
            child: Row(
              children: [
                if (continuation)
                  SizedBox(
                    width: 28,
                    height: 28,
                    child: Center(
                      child: Icon(
                        Icons.subdirectory_arrow_right,
                        size: 16,
                        color: isDark
                            ? AppColors.textSubtle
                            : theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  )
                else
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: WarmSurfaces.surfaceHigh(context),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: isDark
                            ? AppColors.pastelCyan.withValues(alpha: 0.3)
                            : theme.colorScheme.primary.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Center(
                      child: Text(
                        name.isNotEmpty ? name[0].toUpperCase() : 'C',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: isDark
                              ? AppColors.pastelCyanText
                              : theme.colorScheme.primary,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ),
                SizedBox(width: continuation ? 8 : 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        titleText,
                        style: TextStyle(
                          fontSize: continuation ? 13.5 : 14.5,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -0.2,
                          color: isDark
                              ? AppColors.textLight
                              : theme.colorScheme.onSurface,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (subtitleText.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          subtitleText,
                          style: TextStyle(
                            fontSize: 12,
                            color: isDark
                                ? AppColors.textMuted
                                : theme.colorScheme.onSurfaceVariant,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _StatusChip(status: interview.status),
                    if (interview.evaluationFailed) ...[
                      const SizedBox(height: 5),
                      _pill(
                        theme,
                        'Scoring failed',
                        AppColors.danger,
                        icon: Icons.error_outline,
                      ),
                    ] else if (interview.awaitingRecruiterReview) ...[
                      const SizedBox(height: 5),
                      _pill(
                        theme,
                        'Awaiting score',
                        AppColors.warning,
                        icon: Icons.star_outline,
                      ),
                    ] else if (interview.awaitingEvaluation) ...[
                      const SizedBox(height: 5),
                      _pill(
                        theme,
                        'Not scored',
                        isDark
                            ? AppColors.textSubtle
                            : theme.colorScheme.onSurfaceVariant,
                      ),
                    ] else if (score != null) ...[
                      const SizedBox(height: 5),
                      _pill(
                        theme,
                        'Score: $score',
                        isDark
                            ? AppColors.pastelMintText
                            : theme.colorScheme.primary,
                      ),
                    ],
                    if (!continuation && conclusion != null) ...[
                      const SizedBox(height: 5),
                      _pill(
                        theme,
                        conclusion.outcome.recruiterLabel,
                        conclusion.outcome == TestOutcome.cleared
                            ? (isDark
                                  ? AppColors.pastelMintText
                                  : theme.colorScheme.primary)
                            : (isDark
                                  ? AppColors.textSubtle
                                  : theme.colorScheme.onSurfaceVariant),
                        icon: Icons.flag_outlined,
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final InterviewStatus status;
  const _StatusChip({required this.status});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    Color color;
    switch (status) {
      case InterviewStatus.completed:
        color = isDark ? AppColors.pastelMintText : AppColors.success;
        break;
      case InterviewStatus.inProgress:
        color = isDark ? AppColors.pastelCyanText : AppColors.accent;
        break;
      case InterviewStatus.assigned:
        color = isDark
            ? AppColors.textMuted
            : theme.colorScheme.onSurfaceVariant;
        break;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.25), width: 1),
      ),
      child: Text(
        status.label,
        style: TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}

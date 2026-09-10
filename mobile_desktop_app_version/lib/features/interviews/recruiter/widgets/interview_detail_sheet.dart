// lib/features/interviews/recruiter/widgets/interview_detail_sheet.dart
//
// The candidate detail bottom sheet — extracted from
// `test_candidates_page.dart`'s (now-public) `InterviewCard` so both the flat
// candidate list and the Candidates Kanban open the identical detail
// experience without duplicating it. Pure code motion: the body below matches
// the original `_showDetail` exactly, with `context.read<InterviewRepository>()`
// replaced by the injected [repo] so a caller that already holds one (or that
// wants to inject a test double) does not need a BuildContext wired to
// Provider at the exact call site.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/features/interviews/candidate/live_interview_page.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/recruiter/create_interview_page.dart';
import 'package:talbotiq/features/interviews/recruiter/evaluate_interview_page.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/two_way_review_sheet.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';

/// Opens the candidate detail sheet for one interview within
/// [groupInterviews] — a candidate's own rounds in round order (as
/// `candidate_grouping.dart` produces), or a single-item list for a
/// round-scoped view — starting on [initialIndex].
///
/// [onChanged] is invoked after an action here could have changed the
/// underlying data (delete, clear-result, a saved two-way review, or
/// returning from Edit) so a caller holding its own copy of the rows can
/// decide whether to refresh. It is optional and safe to omit: the original
/// card never refreshed its parent list on these actions, so passing null
/// preserves that exact behaviour.
void showInterviewDetailSheet(
  BuildContext context, {
  required List<Interview> groupInterviews,
  required int initialIndex,
  required InterviewRepository repo,
  VoidCallback? onChanged,
}) {
  final theme = Theme.of(context);
  int activeIndex = initialIndex;

  showModalBottomSheet(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (sheetContext) => StatefulBuilder(
      builder: (sheetContext, setStateSheet) {
        final i = groupInterviews[activeIndex];
        final completed = i.status == InterviewStatus.completed;

        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Candidate Navigation Header
                if (groupInterviews.length > 1) ...[
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      IconButton(
                        icon: const Icon(
                          Icons.arrow_back_ios_rounded,
                          size: 16,
                        ),
                        onPressed: activeIndex > 0
                            ? () => setStateSheet(() => activeIndex--)
                            : null,
                      ),
                      Text(
                        'Candidate ${activeIndex + 1} of ${groupInterviews.length}',
                        style: theme.textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: theme.colorScheme.primary,
                        ),
                      ),
                      IconButton(
                        icon: const Icon(
                          Icons.arrow_forward_ios_rounded,
                          size: 16,
                        ),
                        onPressed: activeIndex < groupInterviews.length - 1
                            ? () => setStateSheet(() => activeIndex++)
                            : null,
                      ),
                    ],
                  ),
                  const Divider(height: 16),
                ],
                Text(
                  i.title,
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    _buildDetailBadge(
                      sheetContext,
                      i.type.label,
                      theme.colorScheme.primaryContainer.withValues(
                        alpha: 0.4,
                      ),
                      theme.colorScheme.primary,
                    ),
                    const SizedBox(width: 8),
                    _buildDetailBadge(
                      sheetContext,
                      i.status.label,
                      theme.colorScheme.secondaryContainer.withValues(
                        alpha: 0.4,
                      ),
                      theme.colorScheme.secondary,
                    ),
                  ],
                ),
                const Divider(height: 32),
                if (i.candidateName?.isNotEmpty == true)
                  _kv(sheetContext, 'Name', i.candidateName!),
                _kv(sheetContext, 'Email', i.candidateEmail),
                _kv(sheetContext, 'Duration', '${i.durationMinutes} min'),
                _kv(
                  sheetContext,
                  'Attempts',
                  i.maxAttempts == null
                      ? 'Unlimited'
                      : '${i.attemptsUsed}/${i.maxAttempts}',
                ),
                if (i.availableFrom != null)
                  _kv(sheetContext, 'From', formatDateTime(i.availableFrom!)),
                if (i.expiresAt != null)
                  _kv(
                    sheetContext,
                    'Expires',
                    '${formatDateTime(i.expiresAt!)}${i.isExpired ? '  (expired)' : ''}',
                  ),
                _kv(
                  sheetContext,
                  'Result status',
                  i.status != InterviewStatus.completed
                      ? 'Not taken yet'
                      : (i.result == null ||
                            (i.result!['evaluatedBy'] as String? ?? '')
                                .isEmpty)
                      // No score yet — either AI scoring hasn't landed
                      // (see candidate_video_shell.dart's placeholder
                      // result) or nobody has evaluated it manually.
                      ? 'Awaiting evaluation'
                      : i.resultPublished
                      ? 'Published'
                      : 'Draft — not published',
                ),
                if (i.result != null && i.result!['overallScore'] != null)
                  _kv(
                    sheetContext,
                    'Overall score',
                    '${i.result!['overallScore']}/100',
                  ),
                const Divider(height: 24),
                Text(
                  'Prompt',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest
                        .withValues(alpha: 0.3),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: theme.colorScheme.outline.withValues(alpha: 0.5),
                    ),
                  ),
                  child: Text(
                    i.prompt.isEmpty
                        ? 'No custom prompt configured.'
                        : i.prompt,
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Questions',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 6),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest
                        .withValues(alpha: 0.3),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: theme.colorScheme.outline.withValues(alpha: 0.5),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: i.questions.isEmpty
                        ? [
                            Text(
                              'No questions configured.',
                              style: theme.textTheme.bodyMedium,
                            ),
                          ]
                        : i.questions
                              .asMap()
                              .entries
                              .map(
                                (e) => Padding(
                                  padding: const EdgeInsets.only(bottom: 6),
                                  child: Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '${e.key + 1}. ',
                                        style: TextStyle(
                                          fontWeight: FontWeight.w600,
                                          color: theme.colorScheme.primary,
                                        ),
                                      ),
                                      Expanded(
                                        child: Text(
                                          e.value,
                                          style: theme.textTheme.bodyMedium,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              )
                              .toList(),
                  ),
                ),
                const SizedBox(height: 24),
                // A two-way round is a live call with this candidate. Before
                // it happens, joining is the action; after, scoring it is —
                // there is no recording, so the recruiter who was in the room
                // is the only scorer.
                if (i.effectiveRoundKind == RoundKind.twoWay) ...[
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: FilledButton.icon(
                      onPressed: () {
                        Navigator.pop(sheetContext);
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) =>
                                LiveInterviewPage(interview: i, isHost: true),
                          ),
                        );
                      },
                      icon: const Icon(Icons.videocam_outlined, size: 18),
                      label: Text(
                        completed
                            ? 'Rejoin live interview'
                            : 'Join live interview',
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: OutlinedButton.icon(
                      onPressed: () {
                        Navigator.pop(sheetContext);
                        _openTwoWayReview(context, i, repo, onChanged);
                      },
                      icon: const Icon(Icons.star_outline, size: 18),
                      label: Text(
                        i.twoWayStars != null
                            ? 'Edit your score (${i.twoWayStars}/5)'
                            : 'Score this interview',
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                if (completed && i.effectiveRoundKind != RoundKind.twoWay)
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: FilledButton.icon(
                      onPressed: () {
                        Navigator.pop(sheetContext);
                        Navigator.of(context)
                            .push(
                              MaterialPageRoute(
                                builder: (_) => EvaluateInterviewPage(
                                  interview: i,
                                  groupInterviews: groupInterviews,
                                  initialIndex: activeIndex,
                                ),
                              ),
                            )
                            .then((_) => onChanged?.call());
                      },
                      icon: const Icon(Icons.fact_check_outlined, size: 18),
                      label: Text(
                        i.resultPublished
                            ? 'Review / edit result'
                            : 'Evaluate & publish',
                      ),
                    ),
                  ),
                if (i.result != null) ...[
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 48,
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      // Clears the answers/report but keeps the candidate
                      // assigned, so they can retake — unlike "Delete", which
                      // removes them from the test entirely.
                      onPressed: () =>
                          _confirmClearResult(context, i, repo, onChanged),
                      icon: const Icon(Icons.restart_alt_rounded, size: 18),
                      label: const Text('Delete response (allow retake)'),
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: SizedBox(
                        height: 48,
                        child: OutlinedButton.icon(
                          onPressed: () {
                            Navigator.pop(sheetContext);
                            Navigator.of(context)
                                .push(
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        CreateInterviewPage(existing: i),
                                  ),
                                )
                                .then((_) => onChanged?.call());
                          },
                          icon: const Icon(Icons.edit_outlined, size: 18),
                          label: const Text('Edit'),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: SizedBox(
                        height: 48,
                        child: OutlinedButton.icon(
                          onPressed: () =>
                              _confirmDelete(context, i, repo, onChanged),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: theme.colorScheme.error,
                            side: BorderSide(
                              color: theme.colorScheme.error.withValues(
                                alpha: 0.5,
                              ),
                            ),
                          ),
                          icon: const Icon(Icons.delete_outline, size: 18),
                          label: const Text('Delete'),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    ),
  );
}

Widget _kv(BuildContext context, String k, String v) {
  final theme = Theme.of(context);
  return Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 110,
          child: Text(
            k,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
        Expanded(
          child: Text(
            v,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurface,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    ),
  );
}

Widget _buildDetailBadge(
  BuildContext context,
  String text,
  Color bgColor,
  Color textColor,
) {
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: bgColor,
      borderRadius: BorderRadius.circular(8),
    ),
    child: Text(
      text,
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        color: textColor,
      ),
    ),
  );
}

/// Opens the star-and-notes sheet for a live interview the recruiter ran.
Future<void> _openTwoWayReview(
  BuildContext context,
  Interview i,
  InterviewRepository repo,
  VoidCallback? onChanged,
) async {
  final messenger = ScaffoldMessenger.of(context);
  final review = await showTwoWayReviewSheet(context, i);
  if (review == null) return;
  try {
    await repo.saveTwoWayReview(
      i.id,
      stars: review.stars,
      notes: review.notes,
    );
    onChanged?.call();
    messenger.showSnackBar(
      const SnackBar(
        content: Text('Score saved. Publish it from the round when ready.'),
      ),
    );
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text('Could not save: $e')));
  }
}

/// Wipes this candidate's answers + AI report and returns them to "assigned"
/// so they can sit the test again. Keeps the assignment itself.
Future<void> _confirmClearResult(
  BuildContext context,
  Interview i,
  InterviewRepository repo,
  VoidCallback? onChanged,
) async {
  final messenger = ScaffoldMessenger.of(context);
  final name = i.candidateName?.trim().isNotEmpty == true
      ? i.candidateName!.trim()
      : i.candidateEmail;
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Delete this response?'),
      content: Text(
        "$name's answers and AI report for this test will be permanently "
        'deleted, and they will be able to take it again. The assignment '
        'itself is kept.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: Text(
            'Delete response',
            style: TextStyle(color: Theme.of(ctx).colorScheme.error),
          ),
        ),
      ],
    ),
  );
  if (ok != true) return;
  try {
    await repo.clearResult(i.id);
    if (context.mounted) Navigator.pop(context); // close the detail sheet
    onChanged?.call();
    messenger.showSnackBar(
      const SnackBar(
        content: Text('Response deleted; candidate can retake.'),
      ),
    );
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text('Could not delete: $e')));
  }
}

Future<void> _confirmDelete(
  BuildContext context,
  Interview i,
  InterviewRepository repo,
  VoidCallback? onChanged,
) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (_) => AlertDialog(
      title: const Text('Remove candidate from pipeline?'),
      content: Text(
        'This deletes the assignment AND any response for "${i.title}". '
        'The candidate will no longer see this pipeline at all. To wipe only '
        'their answers and let them retake, use "Delete response" instead.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('Delete'),
        ),
      ],
    ),
  );
  if (ok != true) return;
  await repo.delete(i.id);
  if (context.mounted) Navigator.pop(context); // close the detail sheet
  onChanged?.call();
}

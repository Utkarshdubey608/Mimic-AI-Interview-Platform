// lib/features/interviews/candidate/candidate_conclusion_page.dart
//
// The end of the story, from the candidate's side.
//
// `candidate_result_page.dart` tells them about ONE round. This tells them how
// the whole thing ended — which, before it existed, nothing did: a candidate who
// cleared every round was told "moving forward" on the last one and then heard
// nothing, because the final word lived in the recruiter's inbox.
//
// The same allowlist rule as the round result screen, for the same reason: the
// only things shown here are the outcome the recruiter chose and the message
// they wrote. No score, no rank, no AI summary, no per-round verdicts. Anything
// new that lands on the assignment stays invisible here until somebody
// deliberately adds it.
//
// The rounds are listed by NAME only. Being told what you completed is part of
// the closure; being told how each one was graded is not.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/test_conclusion.dart';

class CandidateConclusionPage extends StatelessWidget {
  /// The job this concludes.
  final String testTitle;

  final TestConclusion conclusion;

  /// The candidate's own rounds of this test, earliest first. Named, never
  /// scored.
  final List<Interview> rounds;

  const CandidateConclusionPage({
    super.key,
    required this.testTitle,
    required this.conclusion,
    this.rounds = const [],
  });

  ({IconData icon, Color color}) _style(ThemeData theme) {
    switch (conclusion.outcome) {
      case TestOutcome.cleared:
        return (
          icon: Icons.emoji_events_outlined,
          color: theme.colorScheme.primary
        );
      case TestOutcome.notSelected:
        // onSurfaceVariant, not error: this is a decision, not a fault, and red
        // on somebody's rejection is a small cruelty.
        return (
          icon: Icons.info_outline,
          color: theme.colorScheme.onSurfaceVariant
        );
      case TestOutcome.onHold:
        return (
          icon: Icons.hourglass_empty,
          color: theme.colorScheme.secondary
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final style = _style(theme);
    final completed = rounds
        .where((i) => i.status == InterviewStatus.completed)
        .toList();

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(title: Text(testTitle)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Final result',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 8),
                  _outcomeCard(theme, style),
                  if (conclusion.message.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    _messageCard(theme),
                  ],
                  if (completed.length > 1) ...[
                    const SizedBox(height: 16),
                    _roundsCard(theme, completed),
                  ],
                  const SizedBox(height: 16),
                  Text(
                    _footer(),
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _outcomeCard(ThemeData theme, ({IconData icon, Color color}) style) =>
      Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: style.color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: style.color.withValues(alpha: 0.3)),
        ),
        child: Column(
          children: [
            Icon(style.icon, size: 40, color: style.color),
            const SizedBox(height: 12),
            Text(
              conclusion.outcome.candidateLabel,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
                color: style.color,
              ),
            ),
            if (conclusion.publishedAt != null) ...[
              const SizedBox(height: 8),
              Text(
                formatDateTime(conclusion.publishedAt!),
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      );

  Widget _messageCard(ThemeData theme) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color:
              theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
              color: theme.colorScheme.outlineVariant.withValues(alpha: 0.4)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              conclusion.publishedByName.isEmpty
                  ? 'A message for you'
                  : 'A message from ${conclusion.publishedByName}',
              style: theme.textTheme.labelLarge
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 8),
            Text(conclusion.message, style: theme.textTheme.bodyMedium),
          ],
        ),
      );

  /// What they got through. Shown only for a multi-round run — listing the one
  /// round of a single-round test back to somebody is noise.
  Widget _roundsCard(ThemeData theme, List<Interview> completed) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
              color: theme.colorScheme.outlineVariant.withValues(alpha: 0.4)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'You completed ${completed.length} rounds',
              style: theme.textTheme.labelLarge
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 10),
            for (var i = 0; i < completed.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    Icon(Icons.check_circle_outline,
                        size: 15, color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Round ${i + 1} · ${completed[i].title}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      );

  String _footer() {
    switch (conclusion.outcome) {
      case TestOutcome.cleared:
        return 'There is nothing left for you to do here.';
      case TestOutcome.notSelected:
        return 'Thank you for the time you gave this process.';
      case TestOutcome.onHold:
        return 'You will see an update on this screen.';
    }
  }
}

// lib/features/interviews/candidate/candidate_result_page.dart
//
// What the candidate is told about a round they finished.
//
// Three things only: whether they are moving forward, optionally where they
// placed, and optionally a note the recruiter wrote for them.
//
// This screen used to publish the recruiter's entire working evaluation — the
// score out of 100, the AI's "Strong Hire"/"No Hire" verdict, its summary, its
// list of the candidate's strengths and its "areas to improve". All of that is
// internal: it is a language model's opinion, written in hiring vocabulary, kept
// for the recruiter to review and edit. Handing it to the candidate published a
// judgement nobody had written for them and that the recruiter may not agree
// with.
//
// So the fields below are an ALLOWLIST, not a filter. Anything new that lands in
// `result` stays invisible here until somebody deliberately adds it.

import 'package:flutter/material.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';

class CandidateResultPage extends StatelessWidget {
  final Interview interview;
  const CandidateResultPage({super.key, required this.interview});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final outcome = interview.outcome;
    final note = interview.candidateNote;
    final rank = interview.rank;
    // This round was never decided on its own, and the whole run has since been
    // concluded. Showing "Under review" here would contradict the final result
    // the candidate has already been given — so the round reports what is
    // actually true of it (it is finished) and points at the answer.
    final supersededByConclusion = !interview.showsOwnOutcome;

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(title: Text(interview.displayTestTitle)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Which stage this is about — a candidate may have finished
                  // several, and "you're through" means nothing without it.
                  if (interview.hasRound)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text(
                        'Round ${interview.effectiveRoundOrder + 1} · '
                        '${interview.title}',
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ),
                  if (supersededByConclusion)
                    _closedCard(theme)
                  else
                    _outcomeCard(theme, outcome, rank),
                  if (note.isNotEmpty) ...[
                    const SizedBox(height: 16),
                    _noteCard(theme, note),
                  ],
                  const SizedBox(height: 16),
                  Text(
                    supersededByConclusion
                        ? 'Your final result for this test is on your '
                            'interviews screen.'
                        : _footerFor(outcome),
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

  ({IconData icon, Color color}) _style(ThemeData theme, RoundOutcome o) {
    switch (o) {
      case RoundOutcome.selected:
        return (icon: Icons.check_circle_outline, color: theme.colorScheme.primary);
      case RoundOutcome.notSelected:
        // onSurfaceVariant, not error: this is a decision, not a fault, and red
        // reads as "something went wrong".
        return (
          icon: Icons.info_outline,
          color: theme.colorScheme.onSurfaceVariant
        );
      case RoundOutcome.pending:
        return (icon: Icons.hourglass_empty, color: theme.colorScheme.secondary);
    }
  }

  Widget _outcomeCard(ThemeData theme, RoundOutcome outcome, int? rank) {
    final style = _style(theme, outcome);
    final rankOf = interview.rankOf;

    return Container(
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
            outcome.candidateLabel,
            textAlign: TextAlign.center,
            style: theme.textTheme.titleLarge?.copyWith(
              fontWeight: FontWeight.bold,
              color: style.color,
            ),
          ),
          // Optional, and only when the recruiter chose to share it.
          if (rank != null) ...[
            const SizedBox(height: 10),
            Text(
              rankOf != null ? 'Ranked $rank of $rankOf' : 'Ranked $rank',
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ],
      ),
    );
  }

  /// The stand-in for an outcome card on a round the recruiter never decided
  /// separately, once the whole run has been concluded.
  ///
  /// Deliberately says nothing about how the round went: it was not judged on its
  /// own, and inferring a verdict from the conclusion would be putting words in
  /// the recruiter's mouth on the one screen where that matters most.
  Widget _closedCard(ThemeData theme) {
    final color = theme.colorScheme.primary;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Column(
        children: [
          Icon(Icons.task_alt, size: 40, color: color),
          const SizedBox(height: 12),
          Text(
            'Round complete',
            textAlign: TextAlign.center,
            style: theme.textTheme.titleLarge
                ?.copyWith(fontWeight: FontWeight.bold, color: color),
          ),
          const SizedBox(height: 8),
          Text(
            'This test has finished and your final result has been published.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }

  Widget _noteCard(ThemeData theme, String note) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest
              .withValues(alpha: 0.3),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
              color: theme.colorScheme.outlineVariant.withValues(alpha: 0.4)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'A note from ${interview.recruiterName ?? 'the recruiter'}',
              style: theme.textTheme.labelLarge
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 8),
            Text(note, style: theme.textTheme.bodyMedium),
          ],
        ),
      );

  String _footerFor(RoundOutcome outcome) {
    switch (outcome) {
      case RoundOutcome.selected:
        return 'Your next round will appear on your interviews screen when it '
            'opens.';
      case RoundOutcome.notSelected:
        return 'Thank you for taking the time to interview.';
      case RoundOutcome.pending:
        return '${interview.recruiterName ?? 'The recruiter'} is still '
            'reviewing. You will see an update here.';
    }
  }
}

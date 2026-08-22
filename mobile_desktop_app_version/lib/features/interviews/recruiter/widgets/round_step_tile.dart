// lib/features/interviews/recruiter/widgets/round_step_tile.dart
//
// One step of a test's timeline, drawn the same way everywhere it appears:
//
//   * the create form's timeline builder (drafts, not yet saved),
//   * the edit form's "rounds in this test" list,
//   * the timeline screen that runs a live test.
//
// One widget for all three so a round LOOKS like the same thing wherever a
// recruiter meets it. The variable parts are passed in rather than branched on
// internally: [trailing] carries whatever actions that screen offers, and [now]
// is optional because a draft round has no lifecycle to report yet.
//
// The numbered badge plus the connector beneath it is what makes a list of these
// read as a sequence rather than as unrelated cards.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';

/// The icon for a round kind. Shared so the same kind never shows two icons.
IconData roundKindIcon(RoundKind kind) {
  switch (kind) {
    case RoundKind.resume:
      return Icons.description_outlined;
    case RoundKind.chat:
      return Icons.chat_bubble_outline;
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

  /// Emphasises this step — round 1 in the builder (the only one candidates get
  /// on save), or the round an assignment being edited belongs to.
  final bool highlight;

  /// Short reason for the emphasis, e.g. "assigned on save".
  final String? highlightLabel;

  /// A status chip to show, when the caller has a clock to derive it from.
  final String? stateLabel;
  final Color? stateColor;

  /// Assigned candidates. Negative hides it — used while a count is in flight,
  /// or where the number is meaningless (an unsaved draft).
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
    final cs = theme.colorScheme;

    final questions = (round.config['questions'] as List?)?.length ?? 0;
    // `usesAiInterviewer`, not `isInterview`. A question count is only meaningful
    // for a round with a SCRIPT — an MCQ round's questions live on the paper it
    // references, so counting `config['questions']` would report zero on a full
    // forty-question assessment, and a two-way round's list is never read by
    // anyone.
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
                width: 28,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: cs.primary.withValues(alpha: highlight ? 0.2 : 0.1),
                  shape: BoxShape.circle,
                  border: highlight
                      ? Border.all(
                          color: cs.primary.withValues(alpha: 0.6), width: 1.5)
                      : null,
                ),
                child: Text('$position',
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: cs.primary,
                    )),
              ),
              if (showConnector)
                Expanded(
                  child: Container(
                    width: 2,
                    margin: const EdgeInsets.symmetric(vertical: 4),
                    color: cs.primary.withValues(alpha: 0.18),
                  ),
                ),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: showConnector ? 10 : 0),
              child: InkWell(
                onTap: onTap,
                borderRadius: BorderRadius.circular(18),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: cs.surfaceContainerHighest.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                      color: highlight
                          ? cs.primary.withValues(alpha: 0.45)
                          : cs.outline.withValues(alpha: 0.12),
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(roundKindIcon(round.kind),
                          size: 16, color: cs.onSurfaceVariant),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    round.title.isEmpty
                                        ? 'Untitled round'
                                        : round.title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                        fontWeight: FontWeight.w600),
                                  ),
                                ),
                                if (highlightLabel != null) ...[
                                  const SizedBox(width: 6),
                                  Text('· $highlightLabel',
                                      style: theme.textTheme.bodySmall?.copyWith(
                                        fontSize: 10,
                                        color: cs.primary,
                                      )),
                                ],
                              ],
                            ),
                            const SizedBox(height: 1),
                            Text(
                              'Step $position of $total · $detail',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.bodySmall
                                  ?.copyWith(color: cs.onSurfaceVariant),
                            ),
                            Row(
                              children: [
                                Icon(Icons.schedule,
                                    size: 11, color: cs.onSurfaceVariant),
                                const SizedBox(width: 4),
                                Expanded(
                                  child: Text(
                                    roundWindowLabel(round),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      fontSize: 10,
                                      color: cs.onSurfaceVariant,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            if (stateLabel != null || assignedCount >= 0) ...[
                              const SizedBox(height: 6),
                              Wrap(
                                spacing: 8,
                                runSpacing: 4,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  if (stateLabel != null)
                                    _chip(theme, stateLabel!,
                                        stateColor ?? cs.primary),
                                  if (assignedCount >= 0)
                                    Text('$assignedCount candidate(s)',
                                        style: theme.textTheme.bodySmall
                                            ?.copyWith(
                                                fontSize: 10,
                                                color: cs.onSurfaceVariant)),
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
        ],
      ),
    );
  }

  Widget _chip(ThemeData theme, String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.14),
          border: Border.all(color: color.withValues(alpha: 0.35)),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(text,
            style: TextStyle(
                color: color, fontSize: 10, fontWeight: FontWeight.bold)),
      );
}

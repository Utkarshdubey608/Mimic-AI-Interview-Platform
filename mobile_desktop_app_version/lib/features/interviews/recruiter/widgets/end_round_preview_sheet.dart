// lib/features/interviews/recruiter/widgets/end_round_preview_sheet.dart
//
// "If I end this round now, what happens?" — shown before a round is closed,
// not after.
//
// It replaces a confirm dialog that stated a number and nothing else ("the
// round closes immediately for 18 candidate(s)"). Ending a round is the moment
// the outcome is decided, and the recruiter was being asked to commit to it
// while looking at no names at all — the advance rule they wrote weeks earlier
// (top 5, or a 60 bar) was applied later, on a different screen, to a list they
// had not seen.
//
// So this shows the decision itself, editable:
//
//   * Everyone in the round, ranked by score, PRE-TICKED by the round's own
//     advance rule — the same function the notify screen pre-ticks with, so the
//     preview cannot promise something the next screen then contradicts.
//   * Candidates who have NOT submitted, listed too and tickable. They are
//     unticked and no rule reaches them, but a recruiter who interviewed
//     somebody off-platform, or who is waiving a round for one person, needs a
//     way to say so. Leaving them out of the screen made that impossible.
//   * What ending it costs: anyone unfinished loses access. Said plainly,
//     because it is irreversible for the candidate mid-answer even though the
//     round itself can be reopened.
//
// Returns the ticked ids. The caller ends the round and carries them into the
// review screen — nothing is published or emailed from here.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/status_tones.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/recruiter/advance_rule.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

/// A candidate's score, or null when they have not submitted one.
int? scoreOf(Interview i) => (i.result?['overallScore'] as num?)?.round();

/// Everyone in [all] with no score, in the order given.
///
/// "Not submitted" rather than "not scored" in the UI: from the recruiter's side
/// the two are the same thing, and a candidate whose scoring FAILED still shows
/// here rather than vanishing from the decision entirely.
List<Interview> notSubmittedIn(List<Interview> all) =>
    all.where((i) => scoreOf(i) == null).toList();

class EndRoundPreviewSheet extends StatefulWidget {
  final InterviewRound round;

  /// The round they would advance INTO, named so the preview can say where.
  final InterviewRound? nextRound;

  /// Scored candidates, best first.
  final List<Interview> ranked;

  /// Candidates with no score yet.
  final List<Interview> notSubmitted;

  const EndRoundPreviewSheet({
    super.key,
    required this.round,
    required this.ranked,
    required this.notSubmitted,
    this.nextRound,
  });

  /// Opens the preview. Returns the ticked interview ids, or null if the
  /// recruiter backed out — so "end it with nobody advancing" (an empty set)
  /// stays tellable from "don't end it".
  static Future<Set<String>?> show(
    BuildContext context, {
    required InterviewRound round,
    required List<Interview> ranked,
    required List<Interview> notSubmitted,
    InterviewRound? nextRound,
  }) {
    return showModalBottomSheet<Set<String>>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (_) => EndRoundPreviewSheet(
        round: round,
        ranked: ranked,
        notSubmitted: notSubmitted,
        nextRound: nextRound,
      ),
    );
  }

  @override
  State<EndRoundPreviewSheet> createState() => _EndRoundPreviewSheetState();
}

class _EndRoundPreviewSheetState extends State<EndRoundPreviewSheet> {
  late final Set<String> _ticked = {
    for (final i in shortlistFor(widget.round, widget.ranked)) i.id,
  };

  int get _total => widget.ranked.length + widget.notSubmitted.length;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final next = widget.nextRound;
    final unfinished = widget.notSubmitted.length;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.xl, 0, AppSpacing.xl, AppSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'End "${widget.round.title}"?',
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            Text(
              next == null
                  ? '${_ticked.length} of $_total would be marked as moving '
                      'forward.'
                  : '${_ticked.length} of $_total would advance to '
                      '"${next.title}".',
              style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: StatusTone.pending(context)),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              advanceRuleExplanation(widget.round),
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: WarmSurfaces.inkMuted(context)),
            ),
            if (unfinished > 0) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                '$unfinished ${unfinished == 1 ? 'candidate has' : 'candidates have'} '
                'not submitted. Ending the round takes their access away — tick '
                'anyone you are moving on regardless.',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.error),
              ),
            ],
            const SizedBox(height: AppSpacing.md),
            Flexible(
              child: _total == 0
                  ? Padding(
                      padding:
                          const EdgeInsets.symmetric(vertical: AppSpacing.xxl),
                      child: Text(
                        'Nobody is in this round yet.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                            color: WarmSurfaces.inkMuted(context)),
                      ),
                    )
                  : ListView(
                      shrinkWrap: true,
                      children: [
                        if (widget.ranked.isNotEmpty)
                          _SectionLabel(
                              'Submitted · ${widget.ranked.length}'),
                        for (var k = 0; k < widget.ranked.length; k++)
                          _CandidateRow(
                            interview: widget.ranked[k],
                            rank: k + 1,
                            ticked: _ticked.contains(widget.ranked[k].id),
                            onToggle: () => _toggle(widget.ranked[k].id),
                          ),
                        if (widget.notSubmitted.isNotEmpty)
                          _SectionLabel(
                              'Not submitted · ${widget.notSubmitted.length}'),
                        for (final i in widget.notSubmitted)
                          _CandidateRow(
                            interview: i,
                            rank: null,
                            ticked: _ticked.contains(i.id),
                            onToggle: () => _toggle(i.id),
                          ),
                      ],
                    ),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: RecruiterPrimaryButton(
                    label: 'End round',
                    icon: Icons.flag_outlined,
                    // Enabled with nothing ticked: "nobody got through" is a
                    // real outcome, and a round with no submissions has to be
                    // closeable at all.
                    onPressed: () =>
                        Navigator.of(context).pop({..._ticked}),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                RecruiterSecondaryButton(
                  label: 'Cancel',
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  void _toggle(String id) => setState(() {
        if (!_ticked.remove(id)) _ticked.add(id);
      });
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(
            top: AppSpacing.md, bottom: AppSpacing.xs),
        child: Text(
          text.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 1.0,
            color: WarmSurfaces.inkSubtle(context),
          ),
        ),
      );
}

class _CandidateRow extends StatelessWidget {
  final Interview interview;

  /// Position by score, or null for somebody with no score.
  final int? rank;
  final bool ticked;
  final VoidCallback onToggle;

  const _CandidateRow({
    required this.interview,
    required this.rank,
    required this.ticked,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final score = scoreOf(interview);
    final name = (interview.candidateName?.trim().isNotEmpty ?? false)
        ? interview.candidateName!.trim()
        : interview.candidateEmail;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onToggle,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.xs, vertical: AppSpacing.sm - 2),
          child: Row(
            children: [
              Checkbox(
                value: ticked,
                onChanged: (_) => onToggle(),
                visualDensity: VisualDensity.compact,
              ),
              const SizedBox(width: AppSpacing.xs),
              if (rank != null)
                SizedBox(
                  width: 24,
                  child: Text(
                    '$rank',
                    style: TextStyle(
                      fontFamily: 'Chivo Mono',
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: WarmSurfaces.inkSubtle(context),
                    ),
                  ),
                ),
              Expanded(
                child: Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: WarmSurfaces.ink(context),
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                score == null ? 'No submission' : '$score',
                style: TextStyle(
                  fontFamily: score == null ? null : 'Chivo Mono',
                  fontSize: score == null ? 11.5 : 13,
                  fontWeight: FontWeight.w700,
                  color: score == null
                      ? WarmSurfaces.inkSubtle(context)
                      : WarmSurfaces.ink(context),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

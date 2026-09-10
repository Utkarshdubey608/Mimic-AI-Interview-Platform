// lib/features/interviews/recruiter/candidate_kanban_view.dart
//
// Read-only Kanban board over the SAME `Interview` rows `TestCandidatesPage`
// has already loaded and paginated — no second Firestore read. One column per
// round, one card per CANDIDATE (via `runsFor` — see `candidate_grouping.dart`),
// placed in the column of their CURRENT (most recently assigned) round.
//
// Deliberately not a drag target: advancing a candidate to the next round is a
// recruiter decision made from the round timeline (criteria, notifications,
// the end-round review), not a card move with no consequence attached.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/models/test_summary.dart';
import 'package:talbotiq/features/interviews/recruiter/candidate_grouping.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/candidate_kanban_card.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/interview_detail_sheet.dart';
import 'package:talbotiq/features/interviews/services/candidate_import_service.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';

class CandidateKanbanView extends StatefulWidget {
  /// The rows `TestCandidatesPage` already has in memory — same input as its
  /// own list body, not a fresh query.
  final List<Interview> rows;

  final TestSummary test;

  /// When set, every row belongs to this one round already (the page's own
  /// query was scoped to it), so the board renders a single column.
  final InterviewRound? round;

  /// Invoked after an action in the detail sheet could have changed the
  /// underlying data, so the caller can decide whether to refresh its rows.
  final VoidCallback? onChanged;

  const CandidateKanbanView({
    super.key,
    required this.rows,
    required this.test,
    this.round,
    this.onChanged,
  });

  @override
  State<CandidateKanbanView> createState() => _CandidateKanbanViewState();
}

class _CandidateKanbanViewState extends State<CandidateKanbanView> {
  /// slug → display name, fetched once for this board. A raw slug is shown
  /// until it resolves — never blank, never invented.
  Map<String, String>? _categoryNames;

  @override
  void initState() {
    super.initState();
    _loadCategories();
  }

  Future<void> _loadCategories() async {
    try {
      final cats = await candidateImportService.categories();
      if (!mounted) return;
      setState(() => _categoryNames = {for (final c in cats) c.slug: c.displayName});
    } catch (_) {
      if (mounted) setState(() => _categoryNames = {});
    }
  }

  String? _categoryLabel(String slug) => _categoryNames?[slug];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final runs = runsFor(widget.rows);
    if (runs.isEmpty) {
      return Center(
        child: Text(
          'No candidates to show on the board yet.',
          style: theme.textTheme.bodyMedium
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      );
    }

    // Round-scoped: every run holds exactly this one round, so there is only
    // ever one column, and its title is the round's own — no need to infer it
    // from what the loaded rows happen to agree on.
    final round = widget.round;
    if (round != null) {
      return _board(context, [(round.title, runs)]);
    }

    // Group by the CURRENT round's order — the highest-order entry each
    // candidate holds, matching `CandidateRun.latestOutcome`'s own notion of
    // "current": a pipeline only ever assigns the next round once a candidate
    // has advanced out of the last one.
    final byOrder = <int, List<CandidateRun>>{};
    for (final run in runs) {
      if (run.rounds.isEmpty) continue;
      final order = run.rounds.last.effectiveRoundOrder;
      byOrder.putIfAbsent(order, () => []).add(run);
    }
    final orders = byOrder.keys.toList()..sort();
    final columns = [
      for (final order in orders) (_columnTitle(order, byOrder[order]!), byOrder[order]!),
    ];
    return _board(context, columns);
  }

  /// The round's own title when every run's current round here agrees on one,
  /// else a generic "Round N".
  String _columnTitle(int order, List<CandidateRun> runs) {
    final titles = <String>{
      for (final run in runs)
        if (run.rounds.last.roundTitle?.trim().isNotEmpty ?? false)
          run.rounds.last.roundTitle!.trim(),
    };
    if (titles.length == 1) return titles.first;
    return 'Round ${order + 1}';
  }

  Widget _board(BuildContext context, List<(String, List<CandidateRun>)> columns) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (title, runs) in columns) ...[
            _column(context, title, runs),
            const SizedBox(width: 12),
          ],
        ],
      ),
    );
  }

  Widget _column(BuildContext context, String title, List<CandidateRun> runs) {
    final theme = Theme.of(context);
    return SizedBox(
      width: 280,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  '${runs.length}',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          Expanded(
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: WarmSurfaces.surfaceHigh(context).withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(16),
              ),
              child: runs.isEmpty
                  ? Center(
                      child: Text(
                        'Nobody here',
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                      ),
                    )
                  : ListView.separated(
                      itemCount: runs.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, i) {
                        final run = runs[i];
                        return CandidateKanbanCard(
                          run: run,
                          categoryLabel: _categoryLabel,
                          onTap: () => showInterviewDetailSheet(
                            context,
                            groupInterviews: run.rounds,
                            initialIndex: run.rounds.length - 1,
                            repo: context.read<InterviewRepository>(),
                            onChanged: widget.onChanged,
                          ),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

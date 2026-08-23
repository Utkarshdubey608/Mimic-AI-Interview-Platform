// lib/features/interviews/candidate/practice_history_page.dart
//
// Candidate-facing history of their own practice attempts, plus a read-only
// detail view of the AI report generated when each attempt first ran.
//
// Source of truth is AppStore.interviewResults, filtered to isPractice — the
// practice track runs through launchVideoConversation -> ResultsPage, which
// persists a finished InterviewResult (score, transcript, ATS scorecard
// result) to SharedPreferences. Recruiter-ASSIGNED interviews land in the same
// list, so they are excluded here: their result belongs to the recruiter until
// published. Nothing is re-analysed on this page — the stored scorecard is
// simply re-rendered, so opening an old attempt costs no API calls.
//
// Entries live entirely on-device and can be deleted individually.
//
// Styling follows the recruiter analytics design language via the shared
// primitives in recruiter_ui.dart, so the page is theme-correct in both light
// and dark modes.
//
// This file is the LIST only. One attempt's report lives in
// practice/practice_report_page.dart, and the date/duration formatting both
// screens share is in practice/practice_formatters.dart.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/shared/models/app_models.dart';
import 'package:talbotiq/shared/providers/app_store.dart';
import 'package:talbotiq/shared/widgets/desktop_page_container.dart';
import 'package:talbotiq/shared/widgets/logout_button.dart';
import 'package:talbotiq/shared/widgets/section_header.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'package:talbotiq/features/interviews/candidate/practice/practice_formatters.dart';
import 'package:talbotiq/features/interviews/candidate/practice/practice_report_page.dart';

class PracticeHistoryPage extends StatelessWidget {
  const PracticeHistoryPage({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Practice attempts only — never recruiter-assigned interviews.
    final results = context
        .watch<AppStore>()
        .interviewResults
        .where((r) => r.isPractice)
        .toList();

    if (isDesktopPlatform) return _buildDesktop(context, results);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('Practice history'),
        actions: const [LogoutButton(), SizedBox(width: 4)],
      ),
      body: _body(context, results),
    );
  }

  /// Same content/logic as mobile — only the chrome around it changes: a
  /// page header instead of an AppBar, matching the desktop shell's top-nav
  /// pattern (which already owns Logout via the profile menu).
  Widget _buildDesktop(BuildContext context, List<InterviewResult> results) {
    return DesktopPageContainer(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SectionHeader(
            title: 'Practice history',
            subtitle: 'Your own practice attempts and their AI reports.',
            isPageTitle: true,
          ),
          const SizedBox(height: 24),
          Expanded(child: _body(context, results)),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, List<InterviewResult> results) {
    return results.isEmpty
        ? const RecruiterEmptyState(
            icon: Icons.history_rounded,
            title: 'No practice attempts yet',
            description:
                'Finish a practice interview from the Practice tab and it '
                'will appear here with its score and full AI report.',
          )
        : ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              const RecruiterSectionTitle('At a glance'),
              const SizedBox(height: 12),
              _summaryStats(context, results),
              const SizedBox(height: 28),
              RecruiterSectionTitle('All attempts (${results.length})'),
              const SizedBox(height: 12),
              for (final r in results) ...[
                _AttemptTile(
                  result: r,
                  onDelete: () => _confirmDelete(context, r),
                ),
                const SizedBox(height: 10),
              ],
            ],
          );
  }

  /// Deletes one stored attempt after confirming. History is local-only, so
  /// this is permanent — there is no server copy to restore from.
  Future<void> _confirmDelete(BuildContext context, InterviewResult r) async {
    final theme = Theme.of(context);
    final store = context.read<AppStore>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this attempt?'),
        content: Text(
          'This removes "${r.name.isEmpty ? 'Practice interview' : r.name}" '
          '(${formatAttemptDate(r.createdAt)}) and its AI report from this '
          'device. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Cancel',
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Delete',
                style: TextStyle(color: theme.colorScheme.error)),
          ),
        ],
      ),
    );
    if (ok == true) store.deleteInterviewResult(r.id);
  }

  Widget _summaryStats(BuildContext context, List<InterviewResult> results) {
    final scored = results.where((r) => r.score > 0).toList();
    final avg = scored.isEmpty
        ? 0
        : (scored.fold<int>(0, (a, r) => a + r.score) / scored.length).round();
    final best = scored.isEmpty
        ? 0
        : scored.map((r) => r.score).reduce((a, b) => a > b ? a : b);
    return RecruiterResponsiveGrid(
      children: [
        RecruiterStatCard(
          icon: Icons.fact_check_outlined,
          label: 'Attempts',
          value: '${results.length}',
        ),
        RecruiterStatCard(
          icon: Icons.trending_up_rounded,
          label: 'Average score',
          value: scored.isEmpty ? '—' : '$avg',
          footnote: scored.isEmpty
              ? 'not scored yet'
              : 'across ${scored.length} scored',
          color: scored.isEmpty ? null : scoreColor(context, avg),
        ),
        RecruiterStatCard(
          icon: Icons.emoji_events_outlined,
          label: 'Best score',
          value: scored.isEmpty ? '—' : '$best',
          color: scored.isEmpty ? null : scoreColor(context, best),
        ),
      ],
    );
  }
}

/// One attempt row: date/time, score, duration, status, and a tap target that
/// opens the stored AI report.
class _AttemptTile extends StatelessWidget {
  final InterviewResult result;
  final VoidCallback onDelete;
  const _AttemptTile({required this.result, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scored = result.scorecard != null;
    final color = scoreColor(context, result.score);

    return RecruiterPanel(
      padding: const EdgeInsets.all(16),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => PracticeReportPage(result: result),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Score chip
              Container(
                width: 48,
                height: 48,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Text(
                  result.score > 0 ? '${result.score}' : '—',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: color,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      result.name.isEmpty ? 'Practice interview' : result.name,
                      style: theme.textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.bold),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      formatAttemptDate(result.createdAt),
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Delete attempt',
                visualDensity: VisualDensity.compact,
                icon: Icon(Icons.delete_outline_rounded,
                    size: 20, color: theme.colorScheme.error),
                onPressed: onDelete,
              ),
              Icon(Icons.chevron_right_rounded,
                  color: theme.colorScheme.onSurfaceVariant),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              RecruiterBadge(
                text: scored ? 'AI scored' : 'Not scored',
                color: scored
                    ? theme.colorScheme.primary
                    : theme.colorScheme.onSurfaceVariant,
              ),
              if (result.scorecard?.hiringRecommendation.isNotEmpty ?? false)
                RecruiterBadge(
                  text: result.scorecard!.hiringRecommendation,
                  color: color,
                ),
              _metaChip(context, Icons.schedule_outlined,
                  formatAttemptDuration(result.transcript)),
              _metaChip(context, Icons.speed_outlined, '${result.wpm} wpm'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _metaChip(BuildContext context, IconData icon, String text) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest
            .withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 4),
          Text(
            text,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

/// Read-only view of one stored attempt: the AI scorecard, strengths /
/// watch-points, speech metrics and the transcript. Re-renders what was
/// generated when the interview first ran — it never calls Gemini again.

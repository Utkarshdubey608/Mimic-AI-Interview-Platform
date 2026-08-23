// lib/features/recruiter/views/report_page.dart
//
// Scored candidate report: an at-a-glance metric row, overall gauge + AI
// summary, per-KPI radar/bars, a per-question (or conversation) accordion and
// an integrity note. Reads the ResultReport from RecruiterStore.
//
// Styling follows the analytics page's design language via the shared
// primitives in recruiter_ui.dart (RecruiterPanel / RecruiterSectionTitle /
// RecruiterStatCard / RecruiterResponsiveGrid): translucent panels on the
// scaffold background, 28px radius, hairline borders, no shadows, and a
// 12px title→content / 28px block→block spacing rhythm. Every colour comes
// from the theme (or the theme-aware warningColor/scoreColor helpers), so the
// page reads correctly in both light and dark modes.

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:printing/printing.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/shared/widgets/response_widgets.dart';
import 'package:talbotiq/features/recruiter/engine/conversation_engine.dart';
import 'package:talbotiq/features/recruiter/models/recruiter_models.dart';
import 'package:talbotiq/features/recruiter/store/recruiter_store.dart';
import 'package:talbotiq/features/recruiter/views/report_pdf.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

class ReportPage extends StatelessWidget {
  final String sessionId;
  const ReportPage({super.key, required this.sessionId});

  String _kpiLabel(InterviewTemplate? template, String kpiId) {
    if (template == null) return kpiId;
    for (final k in template.rubric.kpis) {
      if (k.id == kpiId) return k.label;
    }
    return kpiId;
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<RecruiterStore>();
    final session = store.sessionById(sessionId);
    final report = store.reportFor(sessionId);
    final template =
        session != null ? store.templateById(session.templateId) : null;

    return RecruiterScaffold(
      // Inherit the scaffold background (and let the AppBar inherit too) so
      // this page sits on the same surface as every other recruiter screen.
      appBar: AppBar(
        title: const Text('Interview Report'),
        actions: [
          if (session != null && report != null)
            IconButton(
              tooltip: 'Export / share PDF',
              icon: const Icon(Icons.ios_share),
              onPressed: () => _exportPdf(context, session, template, report),
            ),
        ],
      ),
      body: (session == null || report == null)
          ? const RecruiterEmptyState(
              icon: Icons.hourglass_empty,
              title: 'No report yet',
              description: 'This interview has not been scored.',
            )
          : SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              child: Center(
                child: ConstrainedBox(
                  // Caps line length for the long-form summary/answer text;
                  // a no-op on phones, keeps tablets readable.
                  constraints: const BoxConstraints(maxWidth: 860),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      RecruiterPageHeader(
                        kicker: 'AI Interview Report',
                        title: session.candidateName.isEmpty
                            ? 'Candidate'
                            : session.candidateName,
                        subtitle:
                            '${template?.name ?? ''} · ${TrackType.label(session.track)}',
                      ),
                      const SizedBox(height: 20),
                      if (report.degraded == true) ...[
                        _degradedBanner(context),
                        const SizedBox(height: 20),
                      ],
                      const RecruiterSectionTitle('Overview'),
                      const SizedBox(height: 12),
                      _statRow(context, session, report),
                      const SizedBox(height: 28),
                      const RecruiterSectionTitle('Assessment'),
                      const SizedBox(height: 12),
                      _summaryPanel(context, report),
                      if (template != null) ...[
                        const SizedBox(height: 28),
                        const RecruiterSectionTitle('KPI scores'),
                        const SizedBox(height: 12),
                        _kpiPanel(context, template.rubric, report),
                      ],
                      const SizedBox(height: 28),
                      RecruiterSectionTitle(_isConversation(session)
                          ? 'Conversation breakdown'
                          : 'Per-question breakdown'),
                      const SizedBox(height: 12),
                      if (_isConversation(session))
                        _conversationBreakdown(
                            context, session, template, report)
                      else
                        _perQuestionPanel(context, session, template, report),
                      if (session.tabSwitchCount > 0) ...[
                        const SizedBox(height: 28),
                        const RecruiterSectionTitle('Integrity'),
                        const SizedBox(height: 12),
                        _integrityPanel(context, session),
                      ],
                    ],
                  ),
                ),
              ),
            ),
    );
  }

  // ── Overview ──────────────────────────────────────────────────────────────

  Widget _statRow(
      BuildContext context, InterviewSession session, ResultReport report) {
    final rec = report.recommendation != null
        ? Recommendation.label(report.recommendation!)
        : '—';
    final answered = _isConversation(session)
        ? primaryQuestionGroups(session.transcript ?? []).length
        : session.questions.length;
    return RecruiterResponsiveGrid(
      children: [
        RecruiterStatCard(
          icon: Icons.speed_rounded,
          label: 'Overall score',
          value: '${report.overallScore.round()}',
          footnote: 'out of 100',
          color: scoreColor(context, report.overallScore),
        ),
        RecruiterStatCard(
          icon: Icons.how_to_reg_outlined,
          label: 'Recommendation',
          value: rec,
          color: scoreColor(context, report.overallScore),
        ),
        RecruiterStatCard(
          icon: Icons.forum_outlined,
          label: 'Questions',
          value: '$answered',
          footnote: TrackType.label(session.track),
        ),
        RecruiterStatCard(
          icon: Icons.schedule_outlined,
          label: 'Duration',
          value: _durationLabel(session),
          footnote: _completedLabel(session, report),
        ),
      ],
    );
  }

  Widget _degradedBanner(BuildContext context) {
    final theme = Theme.of(context);
    final warn = warningColor(context);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: warn.withValues(alpha: 0.12),
        border: Border.all(color: warn.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        children: [
          Icon(Icons.info_outline, color: warn, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Heuristic scoring (no Gemini key). Add a Gemini key in Settings '
              'for content-aware scoring.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }

  // ── Assessment ────────────────────────────────────────────────────────────

  Widget _summaryPanel(BuildContext context, ResultReport report) {
    final theme = Theme.of(context);
    final rec = report.recommendation != null
        ? Recommendation.label(report.recommendation!)
        : '—';
    final color = scoreColor(context, report.overallScore);
    return RecruiterPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircularScoreRing(
                score: report.overallScore.round(),
                verdict: rec,
              ),
              const SizedBox(width: 20),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'OVERALL FIT',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '${report.overallScore.round()} / 100',
                      style: theme.textTheme.headlineMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        letterSpacing: -0.5,
                        color: color,
                      ),
                    ),
                    const SizedBox(height: 8),
                    RecruiterBadge(text: rec, color: color),
                  ],
                ),
              ),
            ],
          ),
          if (report.summary.trim().isNotEmpty) ...[
            const SizedBox(height: 20),
            Text(report.summary, style: theme.textTheme.bodyMedium),
          ],
          if ((report.strengths ?? []).isNotEmpty) ...[
            const SizedBox(height: 20),
            _bulletList(context, 'Strengths', report.strengths!,
                theme.colorScheme.primary, Icons.add_rounded),
          ],
          if ((report.improvements ?? []).isNotEmpty) ...[
            const SizedBox(height: 16),
            _bulletList(context, 'Areas to improve', report.improvements!,
                warningColor(context), Icons.arrow_forward_rounded),
          ],
        ],
      ),
    );
  }

  Widget _bulletList(BuildContext context, String title, List<String> items,
      Color color, IconData icon) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style:
              theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 8),
        ...items.map(
          (s) => Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Icon(icon, size: 15, color: color),
                ),
                const SizedBox(width: 8),
                Expanded(child: Text(s, style: theme.textTheme.bodyMedium)),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────

  Widget _kpiPanel(
      BuildContext context, KpiRubric rubric, ResultReport report) {
    final enabled = rubric.kpis.where((k) => k.enabled).toList();
    final entries = enabled
        .map((k) => MapEntry(k.label, report.kpiAverages[k.id] ?? 0))
        .toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    return RecruiterPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // KPI profile radar (needs ≥3 axes to read as a shape). Painter
          // expects a 0–1 scale, so normalise the 0–100 averages.
          if (enabled.length >= 3) ...[
            EmotionRadarChart(
              categoryScores: {
                for (final k in enabled)
                  k.label: ((report.kpiAverages[k.id] ?? 0).toDouble() / 100.0)
                      .clamp(0.0, 1.0),
              },
            ),
            const SizedBox(height: 20),
          ],
          for (final e in entries) _kpiBar(context, e.key, e.value),
        ],
      ),
    );
  }

  Widget _kpiBar(BuildContext context, String label, double value) {
    final theme = Theme.of(context);
    final color = scoreColor(context, value);
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(label, style: theme.textTheme.bodyMedium),
              ),
              const SizedBox(width: 12),
              Text(
                '${value.round()}',
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: color,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(2),
            child: LinearProgressIndicator(
              value: (value / 100).clamp(0, 1),
              minHeight: 4,
              backgroundColor:
                  theme.colorScheme.outlineVariant.withValues(alpha: 0.3),
              valueColor: AlwaysStoppedAnimation(color),
            ),
          ),
        ],
      ),
    );
  }

  // ── Breakdown accordions ──────────────────────────────────────────────────

  Widget _perQuestionPanel(BuildContext context, InterviewSession session,
      InterviewTemplate? template, ResultReport report) {
    return RecruiterPanel(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (int i = 0; i < session.questions.length; i++)
            _accordion(
              context: context,
              index: i,
              question: session.questions[i].text,
              answer: session.questions[i].answerText,
              flagged: session.questions[i].autoSubmitted,
              flagLabel: 'auto-submitted',
              result: _resultFor(report.perQuestion, session.questions[i].id),
              template: template,
              isLast: i == session.questions.length - 1,
            ),
        ],
      ),
    );
  }

  Widget _conversationBreakdown(BuildContext context, InterviewSession session,
      InterviewTemplate? template, ResultReport report) {
    final groups = primaryQuestionGroups(session.transcript ?? []);
    return RecruiterPanel(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (int i = 0; i < groups.length; i++)
            _accordion(
              context: context,
              index: i,
              question: groups[i].question,
              answer: groups[i].answer,
              flagged: groups[i].autoAdvanced,
              flagLabel: 'auto-advanced (time expired)',
              result: _resultFor(report.perQuestion, 'q${groups[i].index}'),
              template: template,
              isLast: i == groups.length - 1,
            ),
        ],
      ),
    );
  }

  PerQuestionResult? _resultFor(
      List<PerQuestionResult> perQuestion, String questionId) {
    for (final p in perQuestion) {
      if (p.questionId == questionId) return p;
    }
    return null;
  }

  /// One expandable question row. Shared by both breakdown modes so the fixed
  /// and conversational tracks look identical.
  Widget _accordion({
    required BuildContext context,
    required int index,
    required String question,
    required String? answer,
    required bool flagged,
    required String flagLabel,
    required PerQuestionResult? result,
    required InterviewTemplate? template,
    required bool isLast,
  }) {
    final theme = Theme.of(context);
    final hasAnswer = answer != null && answer.trim().isNotEmpty;
    return Column(
      children: [
        Theme(
          // Strip ExpansionTile's own top/bottom dividers so the rows read as
          // one continuous list inside the panel.
          data: theme.copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            tilePadding: const EdgeInsets.symmetric(horizontal: 16),
            childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            backgroundColor: Colors.transparent,
            collapsedBackgroundColor: Colors.transparent,
            title: Text(
              'Q${index + 1}. $question',
              style: theme.textTheme.bodyMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
            subtitle: flagged
                ? Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.bolt,
                            size: 13, color: theme.colorScheme.secondary),
                        const SizedBox(width: 4),
                        Text(
                          flagLabel,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  )
                : null,
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  hasAnswer ? answer : '(no answer provided)',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontStyle: hasAnswer ? null : FontStyle.italic,
                  ),
                ),
              ),
              if (result != null && result.kpiScores.isNotEmpty) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final e in result.kpiScores.entries)
                      RecruiterBadge(
                        text: '${_kpiLabel(template, e.key)} ${e.value.round()}',
                        color: scoreColor(context, e.value),
                      ),
                  ],
                ),
              ],
              if (result != null && result.feedback.trim().isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  result.feedback,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ],
          ),
        ),
        if (!isLast)
          Divider(
            height: 1,
            indent: 16,
            endIndent: 16,
            color: theme.colorScheme.outlineVariant.withValues(alpha: 0.3),
          ),
      ],
    );
  }

  // ── Integrity ─────────────────────────────────────────────────────────────

  Widget _integrityPanel(BuildContext context, InterviewSession session) {
    final theme = Theme.of(context);
    return RecruiterPanel(
      child: Row(
        children: [
          Icon(Icons.shield_outlined, color: theme.colorScheme.error),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              '${session.tabSwitchCount} app-switch event(s) logged during the '
              'interview.',
              style: theme.textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  bool _isConversation(InterviewSession session) =>
      session.questions.isEmpty &&
      session.transcript != null &&
      session.transcript!.isNotEmpty;

  /// Elapsed interview time. Sessions store ISO-8601 strings and no explicit
  /// duration, so derive it; falls back to em-dash when either end is missing.
  String _durationLabel(InterviewSession session) {
    final startRaw = session.startedAt ?? session.createdAt;
    final endRaw = session.completedAt;
    if (endRaw == null) return '—';
    final start = DateTime.tryParse(startRaw);
    final end = DateTime.tryParse(endRaw);
    if (start == null || end == null) return '—';
    final d = end.difference(start);
    if (d.isNegative) return '—';
    if (d.inHours > 0) return '${d.inHours}h ${d.inMinutes % 60}m';
    if (d.inMinutes > 0) return '${d.inMinutes}m ${d.inSeconds % 60}s';
    return '${d.inSeconds}s';
  }

  String _completedLabel(InterviewSession session, ResultReport report) {
    final raw = session.completedAt ?? report.generatedAt;
    final dt = DateTime.tryParse(raw);
    if (dt == null) return '';
    return DateFormat('d MMM yyyy, HH:mm').format(dt.toLocal());
  }

  Future<void> _exportPdf(BuildContext context, InterviewSession session,
      InterviewTemplate? template, ResultReport report) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      final bytes = await buildReportPdf(
          session: session, template: template, report: report);
      final safeName =
          (session.candidateName.isEmpty ? 'candidate' : session.candidateName)
              .replaceAll(RegExp(r'[^A-Za-z0-9]+'), '_');
      await Printing.sharePdf(bytes: bytes, filename: 'report_$safeName.pdf');
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text('Could not export PDF: $e')),
      );
    }
  }
}

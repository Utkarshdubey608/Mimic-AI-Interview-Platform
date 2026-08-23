// lib/features/interviews/candidate/practice/practice_report_page.dart
//
// Read-only report for one practice attempt.
//
// Nothing here is re-analysed: the scorecard was produced when the attempt ran
// and persisted to SharedPreferences, so opening an old report costs no API
// calls. Everything is rendered from `InterviewResult`.
//
// Reading order is deliberate — headline, then skills, then the specific answers,
// then the raw transcript. Someone reviewing their own practice wants "how did I
// do / what do I fix / show me exactly what I said", in that order.
//
// What this deliberately does NOT show, though the scorecard carries it:
//
//   * `hiringRecommendation` as a verdict — written for a recruiter deciding
//     whether to advance someone. Practice shows progress, not a hiring call.
//   * `recommendedFollowUpQuestions` — notes for an interviewer, not the
//     candidate; showing them leaks the next round's questions.
//   * `biasWarnings` — a QA signal about the model's own output, meaningless and
//     alarming to a candidate.
//   * anything emotion/prosody-derived — that pipeline is gone, so the fields are
//     empty on every new run.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/services/tavus_service.dart' show isNonDialogueTurn;
import 'package:talbotiq/features/interviews/candidate/practice/practice_formatters.dart';
import 'package:talbotiq/features/interviews/candidate/practice/widgets/question_feedback_panel.dart';
import 'package:talbotiq/features/interviews/candidate/practice/widgets/skill_breakdown_panel.dart';
import 'package:talbotiq/features/interviews/candidate/results/widgets/strengths_watchpoints_panel.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'package:talbotiq/shared/models/app_models.dart';
import 'package:talbotiq/shared/widgets/response_widgets.dart';

class PracticeReportPage extends StatelessWidget {
  const PracticeReportPage({super.key, required this.result});

  final InterviewResult result;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scorecard = result.scorecard;

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Practice report')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 860),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                RecruiterPageHeader(
                  kicker: 'Practice attempt',
                  title: result.name.isEmpty
                      ? 'Practice interview'
                      : result.name,
                  subtitle: formatAttemptDate(result.createdAt),
                ),
                const SizedBox(height: 20),
                ..._overview(context),
                if (scorecard != null)
                  ..._report(context, scorecard)
                else
                  ..._noReport(context),
                if (result.transcript.isNotEmpty) ..._transcript(context),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ── headline ──────────────────────────────────────────────────────────────

  List<Widget> _overview(BuildContext context) {
    final colour = scoreColor(context, result.score);
    return [
      const RecruiterSectionTitle('Overview'),
      const SizedBox(height: 12),
      RecruiterResponsiveGrid(
        children: [
          RecruiterStatCard(
            icon: Icons.speed_rounded,
            label: 'Overall score',
            value: result.score > 0 ? '${result.score}' : '—',
            footnote: 'out of 100',
            color: colour,
          ),
          RecruiterStatCard(
            icon: Icons.insights_outlined,
            label: 'How it went',
            value: practiceVerdict(result.score),
            color: colour,
          ),
          RecruiterStatCard(
            icon: Icons.schedule_outlined,
            label: 'Duration',
            value: formatAttemptDuration(result.transcript),
          ),
          RecruiterStatCard(
            icon: Icons.record_voice_over_outlined,
            label: 'Speaking pace',
            value: result.wpm > 0 ? '${result.wpm}' : '—',
            footnote: result.wpm > 0
                ? 'words/min · ${result.fillers} fillers'
                : 'not measured',
          ),
        ],
      ),
      const SizedBox(height: 28),
    ];
  }

  // ── the report ────────────────────────────────────────────────────────────

  List<Widget> _report(BuildContext context, ATSScorecard sc) {
    final theme = Theme.of(context);
    return [
      if (sc.hiringRecommendationRationale.trim().isNotEmpty) ...[
        const RecruiterSectionTitle('Summary'),
        const SizedBox(height: 12),
        RecruiterPanel(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircularScoreRing(
                score: result.score,
                verdict: practiceVerdict(result.score),
              ),
              const SizedBox(width: 20),
              Expanded(
                child: Text(
                  sc.hiringRecommendationRationale.trim(),
                  style: theme.textTheme.bodyMedium,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 28),
      ],
      const RecruiterSectionTitle('Skill breakdown'),
      const SizedBox(height: 12),
      SkillBreakdownPanel(scorecard: sc),
      if (sc.topStrengths.isNotEmpty || sc.topConcerns.isNotEmpty) ...[
        const SizedBox(height: 28),
        const RecruiterSectionTitle('Strengths & watch-points'),
        const SizedBox(height: 12),
        StrengthsWatchpointsPanel(
          strengths: sc.topStrengths,
          watchPoints: sc.topConcerns,
        ),
      ],
      if (sc.perQuestionAnalysis.isNotEmpty) ...[
        const SizedBox(height: 28),
        const RecruiterSectionTitle('Question by question'),
        const SizedBox(height: 4),
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 12),
          child: Text(
            'Tap a question to see how that answer scored.',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ),
        QuestionFeedbackPanel(analyses: sc.perQuestionAnalysis),
      ],
      ..._caveats(context, sc),
    ];
  }

  /// How much to trust the numbers above.
  ///
  /// Kept last and understated rather than hidden: a report built on a partial
  /// transcript should say so, or a candidate over-reads a low score.
  List<Widget> _caveats(BuildContext context, ATSScorecard sc) {
    final theme = Theme.of(context);
    final notes = <String>[
      ...sc.dataLimitations.where((n) => n.trim().isNotEmpty),
      if (sc.transcriptReliabilityNote.trim().isNotEmpty)
        sc.transcriptReliabilityNote.trim(),
    ];
    if (notes.isEmpty) return const [];

    return [
      const SizedBox(height: 28),
      RecruiterPanel(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.info_outline,
                    size: 16, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 8),
                Text(
                  'About this report',
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            for (final note in notes)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  '• $note',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ),
          ],
        ),
      ),
    ];
  }

  List<Widget> _noReport(BuildContext context) {
    final theme = Theme.of(context);
    return [
      RecruiterPanel(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.info_outline, color: warningColor(context), size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'No AI report was generated for this attempt — scoring may have '
                'failed, or the answers were too short to assess. The transcript '
                'below is still available.',
                style: theme.textTheme.bodyMedium,
              ),
            ),
          ],
        ),
      ),
    ];
  }

  // ── transcript ────────────────────────────────────────────────────────────

  List<Widget> _transcript(BuildContext context) {
    // Excludes Tavus-injected config turns persisted before the parse-time
    // filter existed (see isNonDialogueTurn).
    final turns =
        result.transcript.where((e) => !isNonDialogueTurn(e.text)).toList();
    if (turns.isEmpty) return const [];

    return [
      const SizedBox(height: 28),
      const RecruiterSectionTitle('Full transcript'),
      const SizedBox(height: 12),
      _TranscriptPanel(turns: turns),
    ];
  }
}

/// The raw transcript, collapsed by default.
///
/// A full interview is long enough to bury everything above it, and the report is
/// the point of this screen — the transcript is there to check a detail against.
class _TranscriptPanel extends StatefulWidget {
  const _TranscriptPanel({required this.turns});

  final List<TranscriptEntry> turns;

  @override
  State<_TranscriptPanel> createState() => _TranscriptPanelState();
}

class _TranscriptPanelState extends State<_TranscriptPanel> {
  static const _collapsedCount = 4;
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hidden = widget.turns.length - _collapsedCount;
    final visible = _expanded
        ? widget.turns
        : widget.turns.take(_collapsedCount).toList();

    return RecruiterPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < visible.length; i++) ...[
            if (i > 0) const SizedBox(height: 12),
            _turn(theme, visible[i]),
          ],
          if (hidden > 0) ...[
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => setState(() => _expanded = !_expanded),
                icon: Icon(_expanded ? Icons.expand_less : Icons.expand_more),
                label: Text(_expanded
                    ? 'Show less'
                    : 'Show $hidden more turn${hidden == 1 ? '' : 's'}'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _turn(ThemeData theme, TranscriptEntry e) {
    final isCandidate = e.role == 'candidate';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          isCandidate ? 'You' : 'Interviewer',
          style: theme.textTheme.labelSmall?.copyWith(
            color: isCandidate
                ? theme.colorScheme.primary
                : theme.colorScheme.secondary,
            fontWeight: FontWeight.bold,
            letterSpacing: 0.5,
          ),
        ),
        const SizedBox(height: 4),
        Text(e.text, style: theme.textTheme.bodyMedium),
      ],
    );
  }
}

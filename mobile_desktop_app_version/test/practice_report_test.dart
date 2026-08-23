// test/practice_report_test.dart
//
// Widget tests for the practice report. Beyond "does it render", these pin the
// editorial decisions that are easy to undo by accident:
//
//   * dimension scores come from the scorecard, never derived from the overall
//   * a dimension the model could not assess says so instead of showing a number
//   * recruiter-facing fields (hiring verdict, follow-up questions) stay out
//
// Everything is built from a persisted InterviewResult, so no network or
// Firebase is involved.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:talbotiq/features/interviews/candidate/practice/practice_report_page.dart';
import 'package:talbotiq/shared/models/app_models.dart';

ScoredDimension dimension(
  int score, {
  String evidence = 'Answered with concrete examples.',
  String level = 'strong',
  bool cannotAssess = false,
  String? reason,
}) =>
    ScoredDimension(
      score: score,
      evidenceLevel: level,
      evidenceSummary: evidence,
      quotes: const [],
      flags: const [],
      cannotAssess: cannotAssess,
      cannotAssessReason: reason,
    );

ATSScorecard scorecard({
  List<PerQuestionAnalysis> perQuestion = const [],
  ScoredDimension? technical,
  List<String> dataLimitations = const [],
}) =>
    ATSScorecard(
      overallFitScore: 78,
      overallFitLabel: 'Strong fit',
      overallConfidenceLevel: 'moderate',
      communicationScore: dimension(8, evidence: 'Clear and well structured.'),
      technicalDepthScore: technical ?? dimension(7),
      problemSolvingScore: dimension(6),
      engagementScore: dimension(9),
      consistencyScore: dimension(7),
      communicationProfile: CommunicationProfile(
        overallClarity: dimension(8),
        vocabularyRichness: dimension(7),
        fillerWordImpact: dimension(6),
        pacingAssessment: 'steady',
        structuredThinking: dimension(7),
        note: '',
      ),
      emotionalIntelligenceProfile: EmotionalIntelligenceProfile(
        engagementLevel: dimension(0, cannotAssess: true),
        stressResponse: dimension(0, cannotAssess: true),
        authenticitySignals: '',
        emotionalVariability: '',
        concernFlags: const [],
        dataQualityNote: '',
      ),
      perQuestionAnalysis: perQuestion,
      topStrengths: const ['Clear structure'],
      topConcerns: const ['Could go deeper on trade-offs'],
      recommendedFollowUpQuestions: const ['Ask about their rollback strategy'],
      hiringRecommendation: 'Advance to onsite',
      hiringRecommendationRationale: 'Communicates well and reasons clearly.',
      dataLimitations: dataLimitations,
      transcriptReliabilityNote: '',
      biasWarnings: const ['Possible verbosity bias'],
      analysisTimestamp: 0,
      geminiModel: 'gemini-2.5-flash',
      inputDataQuality: 'good',
    );

InterviewResult result({ATSScorecard? sc, List<TranscriptEntry>? transcript}) =>
    InterviewResult(
      id: 'r1',
      conversationId: 'c1',
      name: 'Backend Engineer practice',
      createdAt: '2026-07-12T10:30:00.000Z',
      score: 78,
      wpm: 132,
      fillers: 9,
      transcript: transcript ??
          [
            TranscriptEntry(
                role: 'avatar',
                text: 'Tell me about yourself.',
                timestamp: 1000,
                questionIdx: 0),
            TranscriptEntry(
                role: 'candidate',
                text: 'I am a backend engineer.',
                timestamp: 9000,
                questionIdx: 0),
          ],
      scorecard: sc,
      isPractice: true,
    );

Future<void> pump(WidgetTester tester, InterviewResult r) async {
  // A full report is taller than the default 800x600 test viewport. Sizing up
  // keeps most of it on screen; `tapAt` below still scrolls for the rest.
  tester.view.physicalSize = const Size(1200, 3000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(MaterialApp(
    theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo)),
    home: PracticeReportPage(result: r),
  ));
  await tester.pumpAndSettle();
}

/// Scrolls [finder] into view before tapping it — the report is a long scroll
/// view, so a target below the fold is built but not hittable.
Future<void> tapAt(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('renders the headline without a scorecard', (tester) async {
    await pump(tester, result());
    expect(find.text('Practice report'), findsOneWidget);
    expect(find.text('Overall score'), findsOneWidget);
    // The attempt still happened, so the transcript stays available.
    expect(find.text('No AI report was generated for this attempt — scoring may have '
        'failed, or the answers were too short to assess. The transcript '
        'below is still available.'), findsOneWidget);
  });

  testWidgets('shows the scorecard\'s own dimension scores', (tester) async {
    await pump(tester, result(sc: scorecard()));

    // 8/10 comes from communicationScore — NOT derived from the overall 78.
    // The old DimensionScoresPanel showed overall+4, a hardcoded 75, etc.
    expect(find.text('Communication'), findsOneWidget);
    expect(find.text('8/10'), findsWidgets);
    expect(find.text('Problem solving'), findsOneWidget);
    expect(find.text('Consistency'), findsOneWidget);
  });

  testWidgets('a dimension that could not be assessed says so', (tester) async {
    await pump(tester, result(
      sc: scorecard(
        technical: dimension(0,
            cannotAssess: true,
            reason: 'No technical questions were asked.'),
      ),
    ));

    expect(find.text('Not assessed'), findsOneWidget);
    expect(
      find.textContaining('No technical questions were asked.'),
      findsOneWidget,
    );
    // It must NOT appear as a scored row alongside the real ones.
    expect(find.text('Technical depth'), findsNothing);
  });

  testWidgets('recruiter-only fields never reach the candidate', (tester) async {
    await pump(tester, result(sc: scorecard()));

    // A hiring verdict is a recruiter's decision, not practice feedback.
    expect(find.textContaining('Advance to onsite'), findsNothing);
    // Follow-up questions would leak the next round's questions.
    expect(find.textContaining('rollback strategy'), findsNothing);
    // Bias warnings are QA signal about the model, not about the candidate.
    expect(find.textContaining('verbosity bias'), findsNothing);
  });

  testWidgets('per-question feedback expands on tap', (tester) async {
    final analysis = PerQuestionAnalysis(
      questionIdx: 0,
      questionText: 'Describe a hard bug you fixed.',
      answerSummary: 'Walked through a race condition in a job queue.',
      relevanceScore: dimension(9),
      clarityScore: dimension(7),
      depthScore: dimension(0, cannotAssess: true),
      dominantEmotions: const [],
      emotionalConsistency: '',
      redFlags: const ['Did not mention how it was verified'],
      strengths: const ['Concrete, specific example'],
      transcriptQuality: 'good',
      transcriptQualityNote: '',
    );

    await pump(tester, result(sc: scorecard(perQuestion: [analysis])));

    expect(find.text('Question by question'), findsOneWidget);
    // Collapsed: the detail is hidden until asked for.
    expect(find.textContaining('race condition'), findsNothing);

    await tapAt(tester, find.textContaining('Describe a hard bug'));

    expect(find.textContaining('race condition'), findsOneWidget);
    // Section labels render uppercased by _label().
    expect(find.text('WHAT WORKED'), findsOneWidget);
    // "redFlags" is reframed — this is the candidate's own review, not a
    // recruiter's note about them.
    expect(find.text('TO WORK ON'), findsOneWidget);
    expect(find.textContaining('RED FLAG'), findsNothing);
    // A dimension the model skipped is labelled, not shown as a zero.
    expect(find.text('Not assessed'), findsWidgets);
  });

  testWidgets('report caveats are surfaced, not hidden', (tester) async {
    await pump(tester, result(
      sc: scorecard(dataLimitations: ['Only two answers were captured.']),
    ));
    expect(find.text('About this report'), findsOneWidget);
    expect(find.textContaining('Only two answers were captured.'),
        findsOneWidget);
  });

  testWidgets('a long transcript collapses', (tester) async {
    final turns = [
      for (var i = 0; i < 10; i++)
        TranscriptEntry(
            role: i.isEven ? 'avatar' : 'candidate',
            text: 'Turn number $i',
            timestamp: 1000 * (i + 1),
            questionIdx: 0),
    ];
    await pump(tester, result(sc: scorecard(), transcript: turns));

    expect(find.text('Turn number 0'), findsOneWidget);
    expect(find.text('Turn number 9'), findsNothing);

    await tapAt(tester, find.textContaining('Show 6 more turns'));
    expect(find.text('Turn number 9'), findsOneWidget);
  });
}

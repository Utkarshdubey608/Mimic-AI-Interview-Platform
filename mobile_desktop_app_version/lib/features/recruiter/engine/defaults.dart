// lib/features/recruiter/engine/defaults.dart
//
// Pure-Dart port of talbotiq-platform `server/store/defaults.ts`. No Flutter
// imports so it stays unit-testable.

import 'package:talbotiq/features/recruiter/models/recruiter_models.dart';

TimingConfig defaultTiming() => const TimingConfig(
      prepSeconds: 30,
      answerSeconds: 120,
      allowSkipPrep: true,
      allowEarlySubmit: true,
      warningThresholdSeconds: 15,
    );

ConversationTimingConfig defaultConversationTiming() =>
    const ConversationTimingConfig(
      thinkingSeconds: 30,
      perQuestionSeconds: 120,
      allowSkipThinking: true,
      allowEarlySubmit: true,
      warningThresholdSeconds: 15,
    );

AdaptiveConfig defaultAdaptive([String role = 'Software Engineer']) =>
    AdaptiveConfig(
      role: role,
      difficulty: DifficultyChoice.mixed,
      style: QuestionStyle.mix,
      numberOfQuestions: 5,
      technicalCount: 3,
      nonTechnicalCount: 2,
      focusTopics: const [],
      // default OFF — numberOfQuestions is the real total; opt in to follow-ups
      allowFollowUps: false,
      maxFollowUpsPerQuestion: 1,
      interviewerTone: 'friendly and professional',
      language: 'English',
    );

IntegrityConfig defaultIntegrity() => const IntegrityConfig(
      enforceFullscreen: false,
      detectTabSwitch: true,
      disablePasteInAnswers: true,
      disableCopy: false,
      maxTabSwitchWarnings: 3,
      logEvents: true,
    );

BrandingConfig defaultBranding() => const BrandingConfig(
      companyName: 'Mimic',
      accentColor: '#0d5c3a',
      welcomeMessage:
          'Welcome to your interview. Find a quiet spot, take a breath, and '
          'answer naturally — there are no trick questions.',
    );

/// Default KPI rubric. IDs are stable slugs (not random) so scores key
/// consistently and custom KPIs added later never collide with these.
KpiRubric defaultRubric() => const KpiRubric(
      scoreScale: 100,
      kpis: [
        KpiDefinition(
          id: 'communication',
          label: 'Communication Clarity',
          description: 'Clear, articulate, easy to follow.',
        ),
        KpiDefinition(
          id: 'relevance',
          label: 'Relevance to Question',
          description: 'Directly answers what was asked.',
        ),
        KpiDefinition(
          id: 'depth',
          label: 'Technical / Domain Depth',
          description: 'Demonstrates real expertise and substance.',
        ),
        KpiDefinition(
          id: 'structure',
          label: 'Structure & Conciseness',
          description: 'Well-organized (e.g. STAR); concise, no rambling.',
        ),
        KpiDefinition(
          id: 'problem_solving',
          label: 'Problem-Solving',
          description: 'Logical reasoning and a sound approach to problems.',
        ),
        KpiDefinition(
          id: 'professionalism',
          label: 'Professionalism / Confidence',
          description: 'Composed, confident, professional tone.',
        ),
      ],
    );

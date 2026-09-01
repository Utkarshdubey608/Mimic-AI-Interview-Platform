// lib/features/recruiter/models/recruiter_models.dart
//
// Native Dart port of the recruiter platform's domain model
// (talbotiq-platform `shared/types.ts`). Hand-written fromJson/toJson matching
// the convention in lib/models/app_models.dart. Closed string-unions from the
// TypeScript source (track, status, recommendation, …) are represented as
// `String` fields with const value holders so the JSON wire format matches the
// original exactly and `flutter analyze` stays clean.

import 'dart:math' as math;

/// Generates a locally-unique id. The web platform used `randomUUID`; on-device
/// a timestamp + random suffix is unique enough for a single-device store.
String recruiterId([String prefix = 'id']) {
  final ms = DateTime.now().microsecondsSinceEpoch;
  final rand = math.Random().nextInt(1 << 32).toRadixString(16);
  return '$prefix-${ms.toRadixString(16)}-$rand';
}

String _nowIso() => DateTime.now().toIso8601String();

// ── String-union value holders ────────────────────────────────────────────

class TrackType {
  // Every mode the platform runs, whichever client created it. All nine are named
  // here because `label` is what a recruiter READS on the templates list, the
  // report page and the exported PDF — and until now six of them read as
  // "Timed Q&A (Chat)", so a coding assessment and a written essay and a live
  // two-way interview were all displayed as the same thing. That is not a
  // cosmetic gap: a recruiter opening a report could not tell from the header
  // what the candidate had actually been asked to do.
  static const String chat = 'chat';
  static const String chatbot = 'chatbot';
  static const String videoAvatar = 'video_avatar';
  static const String voice = 'voice';
  static const String video = 'video';
  static const String twoWay = 'two_way';
  static const String mcq = 'mcq';
  static const String coding = 'coding';
  static const String essay = 'essay';

  /// The modes a recruiter may CREATE from this client — deliberately narrower
  /// than the list above, and not an oversight.
  ///
  /// This feeds one dropdown, on the template editor. The other six modes need a
  /// candidate runtime this app does not have, so offering them here would let a
  /// recruiter build a template that a candidate on this same app then cannot
  /// sit. Displaying a mode and being able to author one are different questions,
  /// and `label` answers the first for all nine.
  static const List<String> all = [chat, chatbot, videoAvatar];

  static String label(String v) {
    switch (v) {
      case chatbot:
        return 'Conversational chatbot';
      case videoAvatar:
        return 'Video avatar';
      case voice:
        return 'Voice interview';
      case video:
        return 'Video interview';
      case twoWay:
        return 'Two-way interview';
      case mcq:
        return 'MCQ assessment';
      case coding:
        return 'Coding assessment';
      case essay:
        return 'Essay writing test';
      case chat:
        return 'Timed Q&A (Chat)';
      default:
        // An unrecognised value is a mode this build predates, not a chat
        // interview. Saying so is more honest than mislabelling it as one, and it
        // is what tells whoever sees it that the app needs updating.
        return 'Interview';
    }
  }
}

class QuestionSource {
  static const String adaptive = 'adaptive';
  static const String fixed = 'fixed';
  static const List<String> all = [adaptive, fixed];
}

class InterviewMode {
  static const String conversational = 'conversational';
  static const String timed = 'timed';
  static const List<String> all = [conversational, timed];
}

class SessionStatus {
  static const String created = 'created';
  static const String systemCheck = 'system_check';
  static const String inProgress = 'in_progress';
  static const String completed = 'completed';
  static const String expired = 'expired';

  static String label(String v) {
    switch (v) {
      case systemCheck:
        return 'System check';
      case inProgress:
        return 'In progress';
      case completed:
        return 'Completed';
      case expired:
        return 'Expired';
      case created:
      default:
        return 'Created';
    }
  }
}

class Recommendation {
  static const String strongYes = 'strong_yes';
  static const String yes = 'yes';
  static const String maybe = 'maybe';
  static const String no = 'no';

  static String label(String v) {
    switch (v) {
      case strongYes:
        return 'Strong yes';
      case yes:
        return 'Yes';
      case maybe:
        return 'Maybe';
      case no:
        return 'No';
      default:
        return v;
    }
  }
}

class QuestionStyle {
  static const String technical = 'technical';
  static const String nonTechnical = 'non_technical';
  static const String mix = 'mix';
  static const List<String> all = [technical, nonTechnical, mix];
}

class DifficultyChoice {
  static const String easy = 'easy';
  static const String medium = 'medium';
  static const String hard = 'hard';
  static const String mixed = 'mixed';
  static const List<String> all = [easy, medium, hard, mixed];
}

// ── Config sub-objects ──────────────────────────────────────────────────────

class TimingConfig {
  final int prepSeconds;
  final int answerSeconds;
  final bool allowSkipPrep;
  final bool allowEarlySubmit;
  final int warningThresholdSeconds;
  final int? numberOfQuestions;
  final int? totalTimeCapSeconds;

  const TimingConfig({
    this.prepSeconds = 30,
    this.answerSeconds = 120,
    this.allowSkipPrep = true,
    this.allowEarlySubmit = true,
    this.warningThresholdSeconds = 15,
    this.numberOfQuestions,
    this.totalTimeCapSeconds,
  });

  factory TimingConfig.fromJson(Map<String, dynamic> json) => TimingConfig(
        prepSeconds: (json['prepSeconds'] as num?)?.toInt() ?? 30,
        answerSeconds: (json['answerSeconds'] as num?)?.toInt() ?? 120,
        allowSkipPrep: json['allowSkipPrep'] ?? true,
        allowEarlySubmit: json['allowEarlySubmit'] ?? true,
        warningThresholdSeconds:
            (json['warningThresholdSeconds'] as num?)?.toInt() ?? 15,
        numberOfQuestions: (json['numberOfQuestions'] as num?)?.toInt(),
        totalTimeCapSeconds: (json['totalTimeCapSeconds'] as num?)?.toInt(),
      );

  Map<String, dynamic> toJson() => {
        'prepSeconds': prepSeconds,
        'answerSeconds': answerSeconds,
        'allowSkipPrep': allowSkipPrep,
        'allowEarlySubmit': allowEarlySubmit,
        'warningThresholdSeconds': warningThresholdSeconds,
        if (numberOfQuestions != null) 'numberOfQuestions': numberOfQuestions,
        if (totalTimeCapSeconds != null)
          'totalTimeCapSeconds': totalTimeCapSeconds,
      };

  TimingConfig copyWith({
    int? prepSeconds,
    int? answerSeconds,
    bool? allowSkipPrep,
    bool? allowEarlySubmit,
    int? warningThresholdSeconds,
    int? numberOfQuestions,
    int? totalTimeCapSeconds,
  }) =>
      TimingConfig(
        prepSeconds: prepSeconds ?? this.prepSeconds,
        answerSeconds: answerSeconds ?? this.answerSeconds,
        allowSkipPrep: allowSkipPrep ?? this.allowSkipPrep,
        allowEarlySubmit: allowEarlySubmit ?? this.allowEarlySubmit,
        warningThresholdSeconds:
            warningThresholdSeconds ?? this.warningThresholdSeconds,
        numberOfQuestions: numberOfQuestions ?? this.numberOfQuestions,
        totalTimeCapSeconds: totalTimeCapSeconds ?? this.totalTimeCapSeconds,
      );
}

class ConversationTimingConfig {
  final int thinkingSeconds;
  final int perQuestionSeconds;
  final int? totalTimeCapSeconds;
  final bool allowSkipThinking;
  final bool allowEarlySubmit;
  final int warningThresholdSeconds;

  const ConversationTimingConfig({
    this.thinkingSeconds = 30,
    this.perQuestionSeconds = 120,
    this.totalTimeCapSeconds,
    this.allowSkipThinking = true,
    this.allowEarlySubmit = true,
    this.warningThresholdSeconds = 15,
  });

  factory ConversationTimingConfig.fromJson(Map<String, dynamic> json) =>
      ConversationTimingConfig(
        thinkingSeconds: (json['thinkingSeconds'] as num?)?.toInt() ?? 30,
        perQuestionSeconds:
            (json['perQuestionSeconds'] as num?)?.toInt() ?? 120,
        totalTimeCapSeconds: (json['totalTimeCapSeconds'] as num?)?.toInt(),
        allowSkipThinking: json['allowSkipThinking'] ?? true,
        allowEarlySubmit: json['allowEarlySubmit'] ?? true,
        warningThresholdSeconds:
            (json['warningThresholdSeconds'] as num?)?.toInt() ?? 15,
      );

  Map<String, dynamic> toJson() => {
        'thinkingSeconds': thinkingSeconds,
        'perQuestionSeconds': perQuestionSeconds,
        if (totalTimeCapSeconds != null)
          'totalTimeCapSeconds': totalTimeCapSeconds,
        'allowSkipThinking': allowSkipThinking,
        'allowEarlySubmit': allowEarlySubmit,
        'warningThresholdSeconds': warningThresholdSeconds,
      };

  ConversationTimingConfig copyWith({
    int? thinkingSeconds,
    int? perQuestionSeconds,
    int? totalTimeCapSeconds,
    bool? allowSkipThinking,
    bool? allowEarlySubmit,
    int? warningThresholdSeconds,
  }) =>
      ConversationTimingConfig(
        thinkingSeconds: thinkingSeconds ?? this.thinkingSeconds,
        perQuestionSeconds: perQuestionSeconds ?? this.perQuestionSeconds,
        totalTimeCapSeconds: totalTimeCapSeconds ?? this.totalTimeCapSeconds,
        allowSkipThinking: allowSkipThinking ?? this.allowSkipThinking,
        allowEarlySubmit: allowEarlySubmit ?? this.allowEarlySubmit,
        warningThresholdSeconds:
            warningThresholdSeconds ?? this.warningThresholdSeconds,
      );
}

class AdaptiveConfig {
  final String role;
  final String? seniority;
  final String difficulty; // DifficultyChoice
  final String? style; // QuestionStyle
  final int numberOfQuestions;
  final int? technicalCount;
  final int? nonTechnicalCount;
  final List<String> focusTopics;
  final bool allowFollowUps;
  final int maxFollowUpsPerQuestion;
  final String? interviewerTone;
  final String? language;

  const AdaptiveConfig({
    this.role = 'Software Engineer',
    this.seniority,
    this.difficulty = DifficultyChoice.mixed,
    this.style = QuestionStyle.mix,
    this.numberOfQuestions = 5,
    this.technicalCount = 3,
    this.nonTechnicalCount = 2,
    this.focusTopics = const [],
    this.allowFollowUps = false,
    this.maxFollowUpsPerQuestion = 1,
    this.interviewerTone = 'friendly and professional',
    this.language = 'English',
  });

  factory AdaptiveConfig.fromJson(Map<String, dynamic> json) => AdaptiveConfig(
        role: json['role'] ?? 'Software Engineer',
        seniority: json['seniority'],
        difficulty: json['difficulty'] ?? DifficultyChoice.mixed,
        style: json['style'] ?? QuestionStyle.mix,
        numberOfQuestions: (json['numberOfQuestions'] as num?)?.toInt() ?? 5,
        technicalCount: (json['technicalCount'] as num?)?.toInt(),
        nonTechnicalCount: (json['nonTechnicalCount'] as num?)?.toInt(),
        focusTopics: json['focusTopics'] != null
            ? List<String>.from(json['focusTopics'])
            : const [],
        allowFollowUps: json['allowFollowUps'] ?? false,
        maxFollowUpsPerQuestion:
            (json['maxFollowUpsPerQuestion'] as num?)?.toInt() ?? 1,
        interviewerTone: json['interviewerTone'] ?? 'friendly and professional',
        language: json['language'] ?? 'English',
      );

  Map<String, dynamic> toJson() => {
        'role': role,
        if (seniority != null) 'seniority': seniority,
        'difficulty': difficulty,
        if (style != null) 'style': style,
        'numberOfQuestions': numberOfQuestions,
        if (technicalCount != null) 'technicalCount': technicalCount,
        if (nonTechnicalCount != null) 'nonTechnicalCount': nonTechnicalCount,
        'focusTopics': focusTopics,
        'allowFollowUps': allowFollowUps,
        'maxFollowUpsPerQuestion': maxFollowUpsPerQuestion,
        if (interviewerTone != null) 'interviewerTone': interviewerTone,
        if (language != null) 'language': language,
      };

  AdaptiveConfig copyWith({
    String? role,
    String? seniority,
    String? difficulty,
    String? style,
    int? numberOfQuestions,
    int? technicalCount,
    int? nonTechnicalCount,
    List<String>? focusTopics,
    bool? allowFollowUps,
    int? maxFollowUpsPerQuestion,
    String? interviewerTone,
    String? language,
  }) =>
      AdaptiveConfig(
        role: role ?? this.role,
        seniority: seniority ?? this.seniority,
        difficulty: difficulty ?? this.difficulty,
        style: style ?? this.style,
        numberOfQuestions: numberOfQuestions ?? this.numberOfQuestions,
        technicalCount: technicalCount ?? this.technicalCount,
        nonTechnicalCount: nonTechnicalCount ?? this.nonTechnicalCount,
        focusTopics: focusTopics ?? this.focusTopics,
        allowFollowUps: allowFollowUps ?? this.allowFollowUps,
        maxFollowUpsPerQuestion:
            maxFollowUpsPerQuestion ?? this.maxFollowUpsPerQuestion,
        interviewerTone: interviewerTone ?? this.interviewerTone,
        language: language ?? this.language,
      );
}

class KpiDefinition {
  final String id;
  final String label;
  final String description;
  final double weight;
  final bool enabled;

  const KpiDefinition({
    required this.id,
    required this.label,
    required this.description,
    this.weight = 1,
    this.enabled = true,
  });

  factory KpiDefinition.fromJson(Map<String, dynamic> json) => KpiDefinition(
        id: json['id'] ?? recruiterId('kpi'),
        label: json['label'] ?? '',
        description: json['description'] ?? '',
        weight: (json['weight'] as num?)?.toDouble() ?? 1,
        enabled: json['enabled'] ?? true,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'label': label,
        'description': description,
        'weight': weight,
        'enabled': enabled,
      };

  KpiDefinition copyWith({
    String? label,
    String? description,
    double? weight,
    bool? enabled,
  }) =>
      KpiDefinition(
        id: id,
        label: label ?? this.label,
        description: description ?? this.description,
        weight: weight ?? this.weight,
        enabled: enabled ?? this.enabled,
      );
}

class KpiRubric {
  final List<KpiDefinition> kpis;
  final int scoreScale;

  const KpiRubric({required this.kpis, this.scoreScale = 100});

  factory KpiRubric.fromJson(Map<String, dynamic> json) => KpiRubric(
        kpis: json['kpis'] != null
            ? (json['kpis'] as List)
                .map((k) => KpiDefinition.fromJson(k))
                .toList()
            : const [],
        scoreScale: (json['scoreScale'] as num?)?.toInt() ?? 100,
      );

  Map<String, dynamic> toJson() => {
        'kpis': kpis.map((k) => k.toJson()).toList(),
        'scoreScale': scoreScale,
      };
}

class BrandingConfig {
  final String companyName;
  final String? logoUrl;
  final String accentColor;
  final String? welcomeMessage;

  const BrandingConfig({
    this.companyName = 'Mimic',
    this.logoUrl,
    this.accentColor = '#0d5c3a',
    this.welcomeMessage,
  });

  factory BrandingConfig.fromJson(Map<String, dynamic> json) => BrandingConfig(
        companyName: json['companyName'] ?? 'Mimic',
        logoUrl: json['logoUrl'],
        accentColor: json['accentColor'] ?? '#0d5c3a',
        welcomeMessage: json['welcomeMessage'],
      );

  Map<String, dynamic> toJson() => {
        'companyName': companyName,
        if (logoUrl != null) 'logoUrl': logoUrl,
        'accentColor': accentColor,
        if (welcomeMessage != null) 'welcomeMessage': welcomeMessage,
      };

  BrandingConfig copyWith({
    String? companyName,
    String? logoUrl,
    String? accentColor,
    String? welcomeMessage,
  }) =>
      BrandingConfig(
        companyName: companyName ?? this.companyName,
        logoUrl: logoUrl ?? this.logoUrl,
        accentColor: accentColor ?? this.accentColor,
        welcomeMessage: welcomeMessage ?? this.welcomeMessage,
      );
}

class IntegrityConfig {
  final bool enforceFullscreen;
  final bool detectTabSwitch;
  final bool disablePasteInAnswers;
  final bool disableCopy;
  final int maxTabSwitchWarnings;
  final bool logEvents;

  const IntegrityConfig({
    this.enforceFullscreen = false,
    this.detectTabSwitch = true,
    this.disablePasteInAnswers = true,
    this.disableCopy = false,
    this.maxTabSwitchWarnings = 3,
    this.logEvents = true,
  });

  factory IntegrityConfig.fromJson(Map<String, dynamic> json) =>
      IntegrityConfig(
        enforceFullscreen: json['enforceFullscreen'] ?? false,
        detectTabSwitch: json['detectTabSwitch'] ?? true,
        disablePasteInAnswers: json['disablePasteInAnswers'] ?? true,
        disableCopy: json['disableCopy'] ?? false,
        maxTabSwitchWarnings:
            (json['maxTabSwitchWarnings'] as num?)?.toInt() ?? 3,
        logEvents: json['logEvents'] ?? true,
      );

  Map<String, dynamic> toJson() => {
        'enforceFullscreen': enforceFullscreen,
        'detectTabSwitch': detectTabSwitch,
        'disablePasteInAnswers': disablePasteInAnswers,
        'disableCopy': disableCopy,
        'maxTabSwitchWarnings': maxTabSwitchWarnings,
        'logEvents': logEvents,
      };

  IntegrityConfig copyWith({
    bool? enforceFullscreen,
    bool? detectTabSwitch,
    bool? disablePasteInAnswers,
    bool? disableCopy,
    int? maxTabSwitchWarnings,
    bool? logEvents,
  }) =>
      IntegrityConfig(
        enforceFullscreen: enforceFullscreen ?? this.enforceFullscreen,
        detectTabSwitch: detectTabSwitch ?? this.detectTabSwitch,
        disablePasteInAnswers:
            disablePasteInAnswers ?? this.disablePasteInAnswers,
        disableCopy: disableCopy ?? this.disableCopy,
        maxTabSwitchWarnings: maxTabSwitchWarnings ?? this.maxTabSwitchWarnings,
        logEvents: logEvents ?? this.logEvents,
      );
}

// ── Question sets ───────────────────────────────────────────────────────────

class FixedQuestion {
  final String id;
  final String text;
  final String? category;
  final String? idealAnswerNotes;

  const FixedQuestion({
    required this.id,
    required this.text,
    this.category,
    this.idealAnswerNotes,
  });

  factory FixedQuestion.fromJson(Map<String, dynamic> json) => FixedQuestion(
        id: json['id'] ?? recruiterId('q'),
        text: json['text'] ?? '',
        category: json['category'],
        idealAnswerNotes: json['idealAnswerNotes'],
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'text': text,
        if (category != null) 'category': category,
        if (idealAnswerNotes != null) 'idealAnswerNotes': idealAnswerNotes,
      };

  FixedQuestion copyWith({
    String? text,
    String? category,
    String? idealAnswerNotes,
  }) =>
      FixedQuestion(
        id: id,
        text: text ?? this.text,
        category: category ?? this.category,
        idealAnswerNotes: idealAnswerNotes ?? this.idealAnswerNotes,
      );
}

class QuestionSet {
  final String id;
  final String name;
  final List<FixedQuestion> questions;
  final String createdAt;
  final String updatedAt;

  const QuestionSet({
    required this.id,
    required this.name,
    required this.questions,
    required this.createdAt,
    required this.updatedAt,
  });

  factory QuestionSet.fromJson(Map<String, dynamic> json) => QuestionSet(
        id: json['id'] ?? recruiterId('set'),
        name: json['name'] ?? '',
        questions: json['questions'] != null
            ? (json['questions'] as List)
                .map((q) => FixedQuestion.fromJson(q))
                .toList()
            : const [],
        createdAt: json['createdAt'] ?? _nowIso(),
        updatedAt: json['updatedAt'] ?? _nowIso(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'questions': questions.map((q) => q.toJson()).toList(),
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  QuestionSet copyWith({
    String? name,
    List<FixedQuestion>? questions,
    String? updatedAt,
  }) =>
      QuestionSet(
        id: id,
        name: name ?? this.name,
        questions: questions ?? this.questions,
        createdAt: createdAt,
        updatedAt: updatedAt ?? this.updatedAt,
      );
}

// ── Templates ───────────────────────────────────────────────────────────────

class InterviewTemplate {
  final String id;
  final String name;
  final String role;
  final String? seniority;
  final String track; // TrackType
  final String questionSource; // QuestionSource
  final String? fixedQuestionSetId;
  final TimingConfig timing;
  final KpiRubric rubric;
  final IntegrityConfig integrity;
  final BrandingConfig branding;
  final String? mode; // InterviewMode
  final AdaptiveConfig? adaptive;
  final bool? fixedAllowFollowUps;
  final ConversationTimingConfig? conversationTiming;
  final String createdAt;
  final String updatedAt;

  const InterviewTemplate({
    required this.id,
    required this.name,
    required this.role,
    this.seniority,
    required this.track,
    required this.questionSource,
    this.fixedQuestionSetId,
    required this.timing,
    required this.rubric,
    required this.integrity,
    required this.branding,
    this.mode,
    this.adaptive,
    this.fixedAllowFollowUps,
    this.conversationTiming,
    required this.createdAt,
    required this.updatedAt,
  });

  factory InterviewTemplate.fromJson(Map<String, dynamic> json) =>
      InterviewTemplate(
        id: json['id'] ?? recruiterId('tpl'),
        name: json['name'] ?? 'Untitled template',
        role: json['role'] ?? 'Software Engineer',
        seniority: json['seniority'],
        track: json['track'] ?? TrackType.chat,
        questionSource: json['questionSource'] ?? QuestionSource.fixed,
        fixedQuestionSetId: json['fixedQuestionSetId'],
        timing: json['timing'] != null
            ? TimingConfig.fromJson(json['timing'])
            : const TimingConfig(),
        rubric: json['rubric'] != null
            ? KpiRubric.fromJson(json['rubric'])
            : const KpiRubric(kpis: []),
        integrity: json['integrity'] != null
            ? IntegrityConfig.fromJson(json['integrity'])
            : const IntegrityConfig(),
        branding: json['branding'] != null
            ? BrandingConfig.fromJson(json['branding'])
            : const BrandingConfig(),
        mode: json['mode'],
        adaptive: json['adaptive'] != null
            ? AdaptiveConfig.fromJson(json['adaptive'])
            : null,
        fixedAllowFollowUps: json['fixedAllowFollowUps'],
        conversationTiming: json['conversationTiming'] != null
            ? ConversationTimingConfig.fromJson(json['conversationTiming'])
            : null,
        createdAt: json['createdAt'] ?? _nowIso(),
        updatedAt: json['updatedAt'] ?? _nowIso(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'role': role,
        if (seniority != null) 'seniority': seniority,
        'track': track,
        'questionSource': questionSource,
        if (fixedQuestionSetId != null) 'fixedQuestionSetId': fixedQuestionSetId,
        'timing': timing.toJson(),
        'rubric': rubric.toJson(),
        'integrity': integrity.toJson(),
        'branding': branding.toJson(),
        if (mode != null) 'mode': mode,
        if (adaptive != null) 'adaptive': adaptive!.toJson(),
        if (fixedAllowFollowUps != null)
          'fixedAllowFollowUps': fixedAllowFollowUps,
        if (conversationTiming != null)
          'conversationTiming': conversationTiming!.toJson(),
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  InterviewTemplate copyWith({
    String? name,
    String? role,
    String? seniority,
    String? track,
    String? questionSource,
    String? fixedQuestionSetId,
    TimingConfig? timing,
    KpiRubric? rubric,
    IntegrityConfig? integrity,
    BrandingConfig? branding,
    String? mode,
    AdaptiveConfig? adaptive,
    bool? fixedAllowFollowUps,
    ConversationTimingConfig? conversationTiming,
    String? updatedAt,
  }) =>
      InterviewTemplate(
        id: id,
        name: name ?? this.name,
        role: role ?? this.role,
        seniority: seniority ?? this.seniority,
        track: track ?? this.track,
        questionSource: questionSource ?? this.questionSource,
        fixedQuestionSetId: fixedQuestionSetId ?? this.fixedQuestionSetId,
        timing: timing ?? this.timing,
        rubric: rubric ?? this.rubric,
        integrity: integrity ?? this.integrity,
        branding: branding ?? this.branding,
        mode: mode ?? this.mode,
        adaptive: adaptive ?? this.adaptive,
        fixedAllowFollowUps: fixedAllowFollowUps ?? this.fixedAllowFollowUps,
        conversationTiming: conversationTiming ?? this.conversationTiming,
        createdAt: createdAt,
        updatedAt: updatedAt ?? this.updatedAt,
      );
}

// ── Sessions ────────────────────────────────────────────────────────────────

class IntegrityEvent {
  final String type;
  final String at;

  const IntegrityEvent({required this.type, required this.at});

  factory IntegrityEvent.fromJson(Map<String, dynamic> json) => IntegrityEvent(
        type: json['type'] ?? 'unknown',
        at: json['at'] ?? _nowIso(),
      );

  Map<String, dynamic> toJson() => {'type': type, 'at': at};
}

class SessionQuestion {
  final String id;
  final String text;
  final String? category;
  final String? idealAnswerNotes; // never rendered on candidate screens
  final String? prepStartedAt;
  final String? answerStartedAt;
  final String? submittedAt;
  final String? answerText;
  final String? videoUrl;
  final bool autoSubmitted;
  final String? draft;

  const SessionQuestion({
    required this.id,
    required this.text,
    this.category,
    this.idealAnswerNotes,
    this.prepStartedAt,
    this.answerStartedAt,
    this.submittedAt,
    this.answerText,
    this.videoUrl,
    this.autoSubmitted = false,
    this.draft,
  });

  factory SessionQuestion.fromJson(Map<String, dynamic> json) =>
      SessionQuestion(
        id: json['id'] ?? recruiterId('sq'),
        text: json['text'] ?? '',
        category: json['category'],
        idealAnswerNotes: json['idealAnswerNotes'],
        prepStartedAt: json['prepStartedAt'],
        answerStartedAt: json['answerStartedAt'],
        submittedAt: json['submittedAt'],
        answerText: json['answerText'],
        videoUrl: json['videoUrl'],
        autoSubmitted: json['autoSubmitted'] ?? false,
        draft: json['draft'],
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'text': text,
        if (category != null) 'category': category,
        if (idealAnswerNotes != null) 'idealAnswerNotes': idealAnswerNotes,
        if (prepStartedAt != null) 'prepStartedAt': prepStartedAt,
        if (answerStartedAt != null) 'answerStartedAt': answerStartedAt,
        if (submittedAt != null) 'submittedAt': submittedAt,
        if (answerText != null) 'answerText': answerText,
        if (videoUrl != null) 'videoUrl': videoUrl,
        'autoSubmitted': autoSubmitted,
        if (draft != null) 'draft': draft,
      };

  SessionQuestion copyWith({
    String? prepStartedAt,
    String? answerStartedAt,
    String? submittedAt,
    String? answerText,
    String? videoUrl,
    bool? autoSubmitted,
    String? draft,
  }) =>
      SessionQuestion(
        id: id,
        text: text,
        category: category,
        idealAnswerNotes: idealAnswerNotes,
        prepStartedAt: prepStartedAt ?? this.prepStartedAt,
        answerStartedAt: answerStartedAt ?? this.answerStartedAt,
        submittedAt: submittedAt ?? this.submittedAt,
        answerText: answerText ?? this.answerText,
        videoUrl: videoUrl ?? this.videoUrl,
        autoSubmitted: autoSubmitted ?? this.autoSubmitted,
        draft: draft ?? this.draft,
      );
}

class Turn {
  final String id;
  final String role; // 'interviewer' | 'candidate'
  final String content;
  final int? questionIndex;
  final bool? isFollowUp;
  final String createdAt;
  final String? thinkingStartedAt;
  final String? answerStartedAt;
  final String? submittedAt;
  final bool? autoAdvanced;
  final String? draft;

  const Turn({
    required this.id,
    required this.role,
    required this.content,
    this.questionIndex,
    this.isFollowUp,
    required this.createdAt,
    this.thinkingStartedAt,
    this.answerStartedAt,
    this.submittedAt,
    this.autoAdvanced,
    this.draft,
  });

  factory Turn.fromJson(Map<String, dynamic> json) => Turn(
        id: json['id'] ?? recruiterId('turn'),
        role: json['role'] ?? 'interviewer',
        content: json['content'] ?? '',
        questionIndex: (json['questionIndex'] as num?)?.toInt(),
        isFollowUp: json['isFollowUp'],
        createdAt: json['createdAt'] ?? _nowIso(),
        thinkingStartedAt: json['thinkingStartedAt'],
        answerStartedAt: json['answerStartedAt'],
        submittedAt: json['submittedAt'],
        autoAdvanced: json['autoAdvanced'],
        draft: json['draft'],
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'role': role,
        'content': content,
        if (questionIndex != null) 'questionIndex': questionIndex,
        if (isFollowUp != null) 'isFollowUp': isFollowUp,
        'createdAt': createdAt,
        if (thinkingStartedAt != null) 'thinkingStartedAt': thinkingStartedAt,
        if (answerStartedAt != null) 'answerStartedAt': answerStartedAt,
        if (submittedAt != null) 'submittedAt': submittedAt,
        if (autoAdvanced != null) 'autoAdvanced': autoAdvanced,
        if (draft != null) 'draft': draft,
      };
}

class InterviewSession {
  final String id;
  final String templateId;
  final String track;
  final String candidateName;
  final String candidateEmail;
  final String status;
  final List<SessionQuestion> questions;
  final int currentIndex;
  final String createdAt;
  final String? startedAt;
  final String? completedAt;
  final List<IntegrityEvent> integrityEvents;
  final int tabSwitchCount;
  final String? resumeText;
  final String? mode;
  final List<Turn>? transcript;
  final int? plannedQuestionCount;
  final int? followUpsThisQuestion;

  const InterviewSession({
    required this.id,
    required this.templateId,
    required this.track,
    required this.candidateName,
    required this.candidateEmail,
    required this.status,
    required this.questions,
    this.currentIndex = 0,
    required this.createdAt,
    this.startedAt,
    this.completedAt,
    this.integrityEvents = const [],
    this.tabSwitchCount = 0,
    this.resumeText,
    this.mode,
    this.transcript,
    this.plannedQuestionCount,
    this.followUpsThisQuestion,
  });

  factory InterviewSession.fromJson(Map<String, dynamic> json) =>
      InterviewSession(
        id: json['id'] ?? recruiterId('sess'),
        templateId: json['templateId'] ?? '',
        track: json['track'] ?? TrackType.chat,
        candidateName: json['candidate']?['name'] ?? json['candidateName'] ?? '',
        candidateEmail:
            json['candidate']?['email'] ?? json['candidateEmail'] ?? '',
        status: json['status'] ?? SessionStatus.created,
        questions: json['questions'] != null
            ? (json['questions'] as List)
                .map((q) => SessionQuestion.fromJson(q))
                .toList()
            : const [],
        currentIndex: (json['currentIndex'] as num?)?.toInt() ?? 0,
        createdAt: json['createdAt'] ?? _nowIso(),
        startedAt: json['startedAt'],
        completedAt: json['completedAt'],
        integrityEvents: json['integrityEvents'] != null
            ? (json['integrityEvents'] as List)
                .map((e) => IntegrityEvent.fromJson(e))
                .toList()
            : const [],
        tabSwitchCount: (json['tabSwitchCount'] as num?)?.toInt() ?? 0,
        resumeText: json['resumeText'],
        mode: json['mode'],
        transcript: json['transcript'] != null
            ? (json['transcript'] as List).map((t) => Turn.fromJson(t)).toList()
            : null,
        plannedQuestionCount: (json['plannedQuestionCount'] as num?)?.toInt(),
        followUpsThisQuestion:
            (json['followUpsThisQuestion'] as num?)?.toInt(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'templateId': templateId,
        'track': track,
        'candidate': {'name': candidateName, 'email': candidateEmail},
        'status': status,
        'questions': questions.map((q) => q.toJson()).toList(),
        'currentIndex': currentIndex,
        'createdAt': createdAt,
        if (startedAt != null) 'startedAt': startedAt,
        if (completedAt != null) 'completedAt': completedAt,
        'integrityEvents': integrityEvents.map((e) => e.toJson()).toList(),
        'tabSwitchCount': tabSwitchCount,
        if (resumeText != null) 'resumeText': resumeText,
        if (mode != null) 'mode': mode,
        if (transcript != null)
          'transcript': transcript!.map((t) => t.toJson()).toList(),
        if (plannedQuestionCount != null)
          'plannedQuestionCount': plannedQuestionCount,
        if (followUpsThisQuestion != null)
          'followUpsThisQuestion': followUpsThisQuestion,
      };

  InterviewSession copyWith({
    String? track,
    String? status,
    List<SessionQuestion>? questions,
    int? currentIndex,
    String? startedAt,
    String? completedAt,
    List<IntegrityEvent>? integrityEvents,
    int? tabSwitchCount,
    String? resumeText,
    String? mode,
    List<Turn>? transcript,
    int? plannedQuestionCount,
    int? followUpsThisQuestion,
  }) =>
      InterviewSession(
        id: id,
        templateId: templateId,
        track: track ?? this.track,
        candidateName: candidateName,
        candidateEmail: candidateEmail,
        status: status ?? this.status,
        questions: questions ?? this.questions,
        currentIndex: currentIndex ?? this.currentIndex,
        createdAt: createdAt,
        startedAt: startedAt ?? this.startedAt,
        completedAt: completedAt ?? this.completedAt,
        integrityEvents: integrityEvents ?? this.integrityEvents,
        tabSwitchCount: tabSwitchCount ?? this.tabSwitchCount,
        resumeText: resumeText ?? this.resumeText,
        mode: mode ?? this.mode,
        transcript: transcript ?? this.transcript,
        plannedQuestionCount: plannedQuestionCount ?? this.plannedQuestionCount,
        followUpsThisQuestion:
            followUpsThisQuestion ?? this.followUpsThisQuestion,
      );
}

// ── Scoring / results ───────────────────────────────────────────────────────

class PerQuestionResult {
  final String questionId;
  final Map<String, double> kpiScores; // keyed by KpiDefinition.id, 0-100
  final String feedback;

  const PerQuestionResult({
    required this.questionId,
    required this.kpiScores,
    required this.feedback,
  });

  factory PerQuestionResult.fromJson(Map<String, dynamic> json) =>
      PerQuestionResult(
        questionId: json['questionId'] ?? '',
        kpiScores: json['kpiScores'] != null
            ? (json['kpiScores'] as Map).map(
                (k, v) => MapEntry(k.toString(), (v as num?)?.toDouble() ?? 0.0),
              )
            : const {},
        feedback: json['feedback'] ?? '',
      );

  Map<String, dynamic> toJson() => {
        'questionId': questionId,
        'kpiScores': kpiScores,
        'feedback': feedback,
      };
}

class ResultReport {
  final String sessionId;
  final List<PerQuestionResult> perQuestion;
  final Map<String, double> kpiAverages;
  final double overallScore;
  final String summary;
  final List<String>? strengths;
  final List<String>? improvements;
  final String? recommendation;
  final String generatedAt;
  final bool? degraded;

  const ResultReport({
    required this.sessionId,
    required this.perQuestion,
    required this.kpiAverages,
    required this.overallScore,
    required this.summary,
    this.strengths,
    this.improvements,
    this.recommendation,
    required this.generatedAt,
    this.degraded,
  });

  factory ResultReport.fromJson(Map<String, dynamic> json) => ResultReport(
        sessionId: json['sessionId'] ?? '',
        perQuestion: json['perQuestion'] != null
            ? (json['perQuestion'] as List)
                .map((p) => PerQuestionResult.fromJson(p))
                .toList()
            : const [],
        kpiAverages: json['kpiAverages'] != null
            ? (json['kpiAverages'] as Map).map(
                (k, v) => MapEntry(k.toString(), (v as num?)?.toDouble() ?? 0.0),
              )
            : const {},
        overallScore: (json['overallScore'] as num?)?.toDouble() ?? 0,
        summary: json['summary'] ?? '',
        strengths: json['strengths'] != null
            ? List<String>.from(json['strengths'])
            : null,
        improvements: json['improvements'] != null
            ? List<String>.from(json['improvements'])
            : null,
        recommendation: json['recommendation'],
        generatedAt: json['generatedAt'] ?? _nowIso(),
        degraded: json['degraded'],
      );

  Map<String, dynamic> toJson() => {
        'sessionId': sessionId,
        'perQuestion': perQuestion.map((p) => p.toJson()).toList(),
        'kpiAverages': kpiAverages,
        'overallScore': overallScore,
        'summary': summary,
        if (strengths != null) 'strengths': strengths,
        if (improvements != null) 'improvements': improvements,
        if (recommendation != null) 'recommendation': recommendation,
        'generatedAt': generatedAt,
        if (degraded != null) 'degraded': degraded,
      };
}

class GeneratedInterviewQuestion {
  final String text;
  final String type; // 'technical' | 'non_technical'
  final String category;
  final String difficulty; // QuestionDifficulty
  final String skillTag;
  final String rationale;

  const GeneratedInterviewQuestion({
    required this.text,
    required this.type,
    required this.category,
    required this.difficulty,
    required this.skillTag,
    required this.rationale,
  });

  factory GeneratedInterviewQuestion.fromJson(Map<String, dynamic> json) =>
      GeneratedInterviewQuestion(
        text: json['text'] ?? '',
        type: json['type'] ?? 'technical',
        category: json['category'] ?? '',
        difficulty: json['difficulty'] ?? 'medium',
        skillTag: json['skillTag'] ?? '',
        rationale: json['rationale'] ?? '',
      );

  Map<String, dynamic> toJson() => {
        'text': text,
        'type': type,
        'category': category,
        'difficulty': difficulty,
        'skillTag': skillTag,
        'rationale': rationale,
      };

  /// Maps a generated question into a storable FixedQuestion, folding the
  /// rationale/skillTag/difficulty into idealAnswerNotes (mirrors the web app).
  FixedQuestion toFixedQuestion() => FixedQuestion(
        id: recruiterId('q'),
        text: text,
        category: category,
        idealAnswerNotes: [
          if (skillTag.isNotEmpty) 'Skill: $skillTag',
          'Difficulty: $difficulty',
          if (rationale.isNotEmpty) 'Why: $rationale',
        ].join(' · '),
      );
}

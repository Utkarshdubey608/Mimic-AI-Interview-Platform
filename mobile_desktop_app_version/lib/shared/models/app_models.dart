// lib/models/app_models.dart

// ── Replicas ──
class TavusReplica {
  final String replicaId;
  final String replicaName;
  final String status;
  final String? thumbnailVideoUrl;
  final double? trainingProgress;
  final String createdAt;
  final String? replicaType;

  TavusReplica({
    required this.replicaId,
    required this.replicaName,
    required this.status,
    this.thumbnailVideoUrl,
    this.trainingProgress,
    required this.createdAt,
    this.replicaType,
  });

  factory TavusReplica.fromJson(Map<String, dynamic> json) {
    return TavusReplica(
      replicaId: json['replica_id'] ?? '',
      replicaName: json['replica_name'] ?? '',
      status: json['status'] ?? 'ready',
      thumbnailVideoUrl: json['thumbnail_video_url'],
      trainingProgress: _parseProgress(json['training_progress']),
      createdAt: json['created_at'] ?? '',
      replicaType: json['replica_type'] ?? 'personal',
    );
  }

  // Tavus returns training_progress as a "done/total" string (e.g. "100/100"),
  // but older/other shapes may send a number. Parse to a percentage [0-100].
  static double? _parseProgress(dynamic raw) {
    if (raw == null) return null;
    if (raw is num) return raw.toDouble();
    if (raw is String) {
      if (raw.contains('/')) {
        final parts = raw.split('/');
        final done = double.tryParse(parts[0].trim());
        final total = double.tryParse(parts[1].trim());
        if (done != null && total != null && total > 0) {
          return (done / total) * 100;
        }
        return done;
      }
      return double.tryParse(raw.trim());
    }
    return null;
  }

  Map<String, dynamic> toJson() => {
    'replica_id': replicaId,
    'replica_name': replicaName,
    'status': status,
    'thumbnail_video_url': thumbnailVideoUrl,
    'training_progress': trainingProgress,
    'created_at': createdAt,
    'replica_type': replicaType,
  };
}

// ── Personas ──
class TavusPersona {
  final String personaId;
  final String personaName;
  final String systemPrompt;
  final String? context;
  final String? defaultReplicaId;
  final String createdAt;

  TavusPersona({
    required this.personaId,
    required this.personaName,
    required this.systemPrompt,
    this.context,
    this.defaultReplicaId,
    required this.createdAt,
  });

  factory TavusPersona.fromJson(Map<String, dynamic> json) {
    return TavusPersona(
      personaId: json['persona_id'] ?? '',
      personaName: json['persona_name'] ?? '',
      systemPrompt: json['system_prompt'] ?? '',
      context: json['context'],
      defaultReplicaId: json['default_replica_id'],
      createdAt: json['created_at'] ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
    'persona_id': personaId,
    'persona_name': personaName,
    'system_prompt': systemPrompt,
    'context': context,
    'default_replica_id': defaultReplicaId,
    'created_at': createdAt,
  };
}

// ── Conversation Properties ──
class ConversationProperties {
  final int maxCallDuration;
  final int participantLeftTimeout;
  final int participantAbsentTimeout;
  final bool enableRecording;
  final bool enableTranscription;
  final String language;
  final bool applyConversationOverride;
  final bool applyGreenscreen;
  final String backgroundUrl;
  final String pipelineMode;

  ConversationProperties({
    this.maxCallDuration = 900,
    this.participantLeftTimeout = 60,
    this.participantAbsentTimeout = 300,
    this.enableRecording = false,
    this.enableTranscription = true,
    this.language = 'English',
    this.applyConversationOverride = false,
    this.applyGreenscreen = false,
    this.backgroundUrl = '',
    this.pipelineMode = 'full',
  });

  factory ConversationProperties.fromJson(Map<String, dynamic> json) {
    return ConversationProperties(
      maxCallDuration: json['max_call_duration'] ?? 900,
      participantLeftTimeout: json['participant_left_timeout'] ?? 60,
      participantAbsentTimeout: json['participant_absent_timeout'] ?? 300,
      enableRecording: json['enable_recording'] ?? false,
      enableTranscription: json['enable_transcription'] ?? true,
      language: json['language'] ?? 'English',
      applyConversationOverride: json['apply_conversation_override'] ?? false,
      applyGreenscreen: json['apply_greenscreen'] ?? false,
      backgroundUrl: json['background_url'] ?? '',
      pipelineMode: json['pipeline_mode'] ?? 'full',
    );
  }

  Map<String, dynamic> toJson() => {
    'max_call_duration': maxCallDuration,
    'participant_left_timeout': participantLeftTimeout,
    'participant_absent_timeout': participantAbsentTimeout,
    'enable_recording': enableRecording,
    'enable_transcription': enableTranscription,
    if (language != 'English') 'language': language,
    'apply_conversation_override': applyConversationOverride,
    'apply_greenscreen': applyGreenscreen,
    if (applyGreenscreen && backgroundUrl.isNotEmpty) 'background_url': backgroundUrl,
  };
}

// ── Conversation ──
class TavusConversation {
  final String conversationId;
  final String conversationName;
  final String status;
  final String conversationUrl;
  final String replicaId;
  final String? personaId;
  final String createdAt;
  final String? endedAt;
  final ConversationProperties? properties;
  final String? callbackUrl;
  final String? conversationalContext;
  final String? customGreeting;

  TavusConversation({
    required this.conversationId,
    required this.conversationName,
    required this.status,
    required this.conversationUrl,
    required this.replicaId,
    this.personaId,
    required this.createdAt,
    this.endedAt,
    this.properties,
    this.callbackUrl,
    this.conversationalContext,
    this.customGreeting,
  });

  factory TavusConversation.fromJson(Map<String, dynamic> json) {
    return TavusConversation(
      conversationId: json['conversation_id'] ?? '',
      conversationName: json['conversation_name'] ?? '',
      status: json['status'] ?? 'connecting',
      conversationUrl: json['conversation_url'] ?? '',
      replicaId: json['replica_id'] ?? '',
      personaId: json['persona_id'],
      createdAt: json['created_at'] ?? '',
      endedAt: json['ended_at'],
      properties: json['properties'] != null
          ? ConversationProperties.fromJson(json['properties'])
          : null,
      callbackUrl: json['callback_url'],
      conversationalContext: json['conversational_context'],
      customGreeting: json['custom_greeting'],
    );
  }

  Map<String, dynamic> toJson() => {
    'conversation_id': conversationId,
    'conversation_name': conversationName,
    'status': status,
    'conversation_url': conversationUrl,
    'replica_id': replicaId,
    'persona_id': personaId,
    'created_at': createdAt,
    'ended_at': endedAt,
    'properties': properties?.toJson(),
    'callback_url': callbackUrl,
    'conversational_context': conversationalContext,
    'custom_greeting': customGreeting,
  };
}

// ── Draft Form ──
class DraftForm {
  final String replicaId;
  final String personaId;
  final String conversationName;
  final String conversationalContext;
  final String customGreeting;
  final String callbackUrl;
  final int maxCallDuration;
  final int participantLeftTimeout;
  final int participantAbsentTimeout;
  final bool enableRecording;
  final bool enableTranscription;
  final bool applyConversationOverride;
  final bool applyGreenscreen;
  final String backgroundUrl;
  final String language;
  final String pipelineMode;

  DraftForm({
    required this.replicaId,
    required this.personaId,
    required this.conversationName,
    required this.conversationalContext,
    required this.customGreeting,
    required this.callbackUrl,
    required this.maxCallDuration,
    required this.participantLeftTimeout,
    required this.participantAbsentTimeout,
    required this.enableRecording,
    required this.enableTranscription,
    required this.applyConversationOverride,
    required this.applyGreenscreen,
    required this.backgroundUrl,
    required this.language,
    required this.pipelineMode,
  });

  factory DraftForm.fromJson(Map<String, dynamic> json) {
    return DraftForm(
      replicaId: json['replica_id'] ?? '',
      personaId: json['persona_id'] ?? '',
      conversationName: json['conversation_name'] ?? '',
      conversationalContext: json['conversational_context'] ?? '',
      customGreeting: json['custom_greeting'] ?? '',
      callbackUrl: json['callback_url'] ?? '',
      maxCallDuration: json['max_call_duration'] ?? 900,
      participantLeftTimeout: json['participant_left_timeout'] ?? 60,
      participantAbsentTimeout: json['participant_absent_timeout'] ?? 300,
      enableRecording: json['enable_recording'] ?? false,
      enableTranscription: json['enable_transcription'] ?? true,
      applyConversationOverride: json['apply_conversation_override'] ?? false,
      applyGreenscreen: json['apply_greenscreen'] ?? false,
      backgroundUrl: json['background_url'] ?? '',
      language: json['language'] ?? 'English',
      pipelineMode: json['pipeline_mode'] ?? 'full',
    );
  }

  Map<String, dynamic> toJson() => {
    'replica_id': replicaId,
    'persona_id': personaId,
    'conversation_name': conversationName,
    'conversational_context': conversationalContext,
    'custom_greeting': customGreeting,
    'callback_url': callbackUrl,
    'max_call_duration': maxCallDuration,
    'participant_left_timeout': participantLeftTimeout,
    'participant_absent_timeout': participantAbsentTimeout,
    'enable_recording': enableRecording,
    'enable_transcription': enableTranscription,
    'apply_conversation_override': applyConversationOverride,
    'apply_greenscreen': applyGreenscreen,
    'background_url': backgroundUrl,
    'language': language,
    'pipeline_mode': pipelineMode,
  };

  // Sensible starting values for a fresh interview session config.
  factory DraftForm.defaults() => DraftForm(
        replicaId: '',
        personaId: '',
        conversationName: 'Mimic interview',
        conversationalContext:
            'You are Alex, a Senior Talent Specialist at Mimic conducting a screening interview. Maintain a warm, professional tone.',
        customGreeting: 'Hello, welcome to your Mimic interview.',
        callbackUrl: '',
        maxCallDuration: 900,
        participantLeftTimeout: 60,
        participantAbsentTimeout: 300,
        enableRecording: false,
        enableTranscription: true,
        applyConversationOverride: false,
        applyGreenscreen: false,
        backgroundUrl: '',
        language: 'English',
        pipelineMode: 'full',
      );

  // Returns a copy with only the provided fields overridden. Lets each
  // settings section update its own fields without clobbering the rest.
  DraftForm copyWith({
    String? replicaId,
    String? personaId,
    String? conversationName,
    String? conversationalContext,
    String? customGreeting,
    String? callbackUrl,
    int? maxCallDuration,
    int? participantLeftTimeout,
    int? participantAbsentTimeout,
    bool? enableRecording,
    bool? enableTranscription,
    bool? applyConversationOverride,
    bool? applyGreenscreen,
    String? backgroundUrl,
    String? language,
    String? pipelineMode,
  }) {
    return DraftForm(
      replicaId: replicaId ?? this.replicaId,
      personaId: personaId ?? this.personaId,
      conversationName: conversationName ?? this.conversationName,
      conversationalContext:
          conversationalContext ?? this.conversationalContext,
      customGreeting: customGreeting ?? this.customGreeting,
      callbackUrl: callbackUrl ?? this.callbackUrl,
      maxCallDuration: maxCallDuration ?? this.maxCallDuration,
      participantLeftTimeout:
          participantLeftTimeout ?? this.participantLeftTimeout,
      participantAbsentTimeout:
          participantAbsentTimeout ?? this.participantAbsentTimeout,
      enableRecording: enableRecording ?? this.enableRecording,
      enableTranscription: enableTranscription ?? this.enableTranscription,
      applyConversationOverride:
          applyConversationOverride ?? this.applyConversationOverride,
      applyGreenscreen: applyGreenscreen ?? this.applyGreenscreen,
      backgroundUrl: backgroundUrl ?? this.backgroundUrl,
      language: language ?? this.language,
      pipelineMode: pipelineMode ?? this.pipelineMode,
    );
  }
}

// ── Draft ──
class Draft {
  final String id;
  final String name;
  final String savedAt;
  final DraftForm form;
  final List<String> questions;

  Draft({
    required this.id,
    required this.name,
    required this.savedAt,
    required this.form,
    required this.questions,
  });

  factory Draft.fromJson(Map<String, dynamic> json) {
    return Draft(
      id: json['id'] ?? '',
      name: json['name'] ?? '',
      savedAt: json['savedAt'] ?? '',
      form: DraftForm.fromJson(json['form'] ?? {}),
      questions: List<String>.from(json['questions'] ?? []),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'savedAt': savedAt,
    'form': form.toJson(),
    'questions': questions,
  };
}

// ── Deepgram Transcript Entry ──
class TranscriptEntry {
  final String text;
  final String role; // 'candidate' | 'avatar'
  final int timestamp; // epoch ms
  final int questionIdx;

  TranscriptEntry({
    required this.text,
    required this.role,
    required this.timestamp,
    required this.questionIdx,
  });

  factory TranscriptEntry.fromJson(Map<String, dynamic> json) {
    return TranscriptEntry(
      text: json['text'] ?? '',
      role: json['role'] ?? 'candidate',
      timestamp: json['timestamp'] ?? DateTime.now().millisecondsSinceEpoch,
      questionIdx: json['questionIdx'] ?? 0,
    );
  }

  Map<String, dynamic> toJson() => {
    'text': text,
    'role': role,
    'timestamp': timestamp,
    'questionIdx': questionIdx,
  };
}

// ── Saved interview recording (local .wav) ──
class SavedRecording {
  final String id;
  final String name; // candidate / conversation name
  final String path; // absolute file path on device
  final String savedAt; // ISO-8601 timestamp
  final int sizeBytes;

  SavedRecording({
    required this.id,
    required this.name,
    required this.path,
    required this.savedAt,
    required this.sizeBytes,
  });

  factory SavedRecording.fromJson(Map<String, dynamic> json) {
    return SavedRecording(
      id: json['id'] ?? '',
      name: json['name'] ?? 'Interview',
      path: json['path'] ?? '',
      savedAt: json['savedAt'] ?? '',
      sizeBytes: json['sizeBytes'] ?? 0,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'path': path,
    'savedAt': savedAt,
    'sizeBytes': sizeBytes,
  };
}

// ── Persisted interview result (history) ──
class InterviewResult {
  final String id;
  final String conversationId;
  final String name;
  final String createdAt; // ISO-8601
  final int score;
  final int wpm;
  final int fillers;
  final List<TranscriptEntry> transcript;
  final ATSScorecard? scorecard;

  /// True when this came from the candidate's own self-serve PRACTICE tab,
  /// false for a recruiter-assigned interview. Both land in the same history
  /// list, so this is what keeps the candidate's Practice History from
  /// exposing an assigned interview's AI report before the recruiter has
  /// published it.
  final bool isPractice;

  InterviewResult({
    required this.id,
    required this.conversationId,
    required this.name,
    required this.createdAt,
    required this.score,
    required this.wpm,
    required this.fillers,
    required this.transcript,
    required this.scorecard,
    this.isPractice = false,
  });

  factory InterviewResult.fromJson(Map<String, dynamic> json) {
    return InterviewResult(
      id: json['id'] ?? '',
      conversationId: json['conversationId'] ?? '',
      name: json['name'] ?? 'Interview',
      createdAt: json['createdAt'] ?? '',
      score: json['score'] ?? 0,
      wpm: json['wpm'] ?? 0,
      fillers: json['fillers'] ?? 0,
      transcript: (json['transcript'] as List?)
              ?.map((e) => TranscriptEntry.fromJson(e))
              .toList() ??
          [],
      scorecard: json['scorecard'] != null
          ? ATSScorecard.fromJson(json['scorecard'])
          : null,
      // Defaults to false for results stored before this field existed: an
      // assigned interview wrongly shown to the candidate would leak an
      // unpublished result, whereas an old practice run merely not appearing
      // in history is cosmetic. Fail closed.
      isPractice: json['isPractice'] == true,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'conversationId': conversationId,
    'name': name,
    'createdAt': createdAt,
    'score': score,
    'wpm': wpm,
    'fillers': fillers,
    'transcript': transcript.map((e) => e.toJson()).toList(),
    'scorecard': scorecard?.toJson(),
    'isPractice': isPractice,
  };
}





// ── Gemini Scored Dimension ──
class ScoredDimension {
  final int score; // 1-10
  final String evidenceLevel; // 'strong' | 'moderate' | 'weak' | 'insufficient'
  final String evidenceSummary;
  final List<String> quotes;
  final List<String> flags;
  final bool cannotAssess;
  final String? cannotAssessReason;

  ScoredDimension({
    required this.score,
    required this.evidenceLevel,
    required this.evidenceSummary,
    required this.quotes,
    required this.flags,
    required this.cannotAssess,
    this.cannotAssessReason,
  });

  factory ScoredDimension.fromJson(Map<String, dynamic> json) {
    return ScoredDimension(
      score: json['score'] ?? 0,
      evidenceLevel: json['evidenceLevel'] ?? 'insufficient',
      evidenceSummary: json['evidenceSummary'] ?? '',
      quotes: List<String>.from(json['quotes'] ?? []),
      flags: List<String>.from(json['flags'] ?? []),
      cannotAssess: json['cannotAssess'] ?? false,
      cannotAssessReason: json['cannotAssessReason'],
    );
  }

  Map<String, dynamic> toJson() => {
    'score': score,
    'evidenceLevel': evidenceLevel,
    'evidenceSummary': evidenceSummary,
    'quotes': quotes,
    'flags': flags,
    'cannotAssess': cannotAssess,
    'cannotAssessReason': cannotAssessReason,
  };
}

// ── Gemini Per-Question Analysis ──
class PerQuestionAnalysis {
  final int questionIdx;
  final String questionText;
  final String answerSummary;
  final ScoredDimension relevanceScore;
  final ScoredDimension clarityScore;
  final ScoredDimension depthScore;
  final List<Map<String, dynamic>> dominantEmotions;
  final String emotionalConsistency;
  final List<String> redFlags;
  final List<String> strengths;
  final String transcriptQuality;
  final String transcriptQualityNote;

  PerQuestionAnalysis({
    required this.questionIdx,
    required this.questionText,
    required this.answerSummary,
    required this.relevanceScore,
    required this.clarityScore,
    required this.depthScore,
    required this.dominantEmotions,
    required this.emotionalConsistency,
    required this.redFlags,
    required this.strengths,
    required this.transcriptQuality,
    required this.transcriptQualityNote,
  });

  factory PerQuestionAnalysis.fromJson(Map<String, dynamic> json) {
    return PerQuestionAnalysis(
      questionIdx: json['questionIdx'] ?? 0,
      questionText: json['questionText'] ?? '',
      answerSummary: json['answerSummary'] ?? '',
      relevanceScore: ScoredDimension.fromJson(json['relevanceScore'] ?? {}),
      clarityScore: ScoredDimension.fromJson(json['clarityScore'] ?? {}),
      depthScore: ScoredDimension.fromJson(json['depthScore'] ?? {}),
      dominantEmotions: (json['dominantEmotions'] as List?)
              ?.map((e) => Map<String, dynamic>.from(e))
              .toList() ??
          [],
      emotionalConsistency: json['emotionalConsistency'] ?? '',
      redFlags: List<String>.from(json['redFlags'] ?? []),
      strengths: List<String>.from(json['strengths'] ?? []),
      transcriptQuality: json['transcriptQuality'] ?? 'medium',
      transcriptQualityNote: json['transcriptQualityNote'] ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
    'questionIdx': questionIdx,
    'questionText': questionText,
    'answerSummary': answerSummary,
    'relevanceScore': relevanceScore.toJson(),
    'clarityScore': clarityScore.toJson(),
    'depthScore': depthScore.toJson(),
    'dominantEmotions': dominantEmotions,
    'emotionalConsistency': emotionalConsistency,
    'redFlags': redFlags,
    'strengths': strengths,
    'transcriptQuality': transcriptQuality,
    'transcriptQualityNote': transcriptQualityNote,
  };
}

// ── Gemini Communication Profile ──
class CommunicationProfile {
  final ScoredDimension overallClarity;
  final ScoredDimension vocabularyRichness;
  final ScoredDimension fillerWordImpact;
  final String pacingAssessment;
  final ScoredDimension structuredThinking;
  final String note;

  CommunicationProfile({
    required this.overallClarity,
    required this.vocabularyRichness,
    required this.fillerWordImpact,
    required this.pacingAssessment,
    required this.structuredThinking,
    required this.note,
  });

  factory CommunicationProfile.fromJson(Map<String, dynamic> json) {
    return CommunicationProfile(
      overallClarity: ScoredDimension.fromJson(json['overallClarity'] ?? {}),
      vocabularyRichness: ScoredDimension.fromJson(json['vocabularyRichness'] ?? {}),
      fillerWordImpact: ScoredDimension.fromJson(json['fillerWordImpact'] ?? {}),
      pacingAssessment: json['pacingAssessment'] ?? '',
      structuredThinking: ScoredDimension.fromJson(json['structuredThinking'] ?? {}),
      note: json['note'] ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
    'overallClarity': overallClarity.toJson(),
    'vocabularyRichness': vocabularyRichness.toJson(),
    'fillerWordImpact': fillerWordImpact.toJson(),
    'pacingAssessment': pacingAssessment,
    'structuredThinking': structuredThinking.toJson(),
    'note': note,
  };
}

// ── Gemini Emotional Intelligence Profile ──
class EmotionalIntelligenceProfile {
  final ScoredDimension engagementLevel;
  final ScoredDimension stressResponse;
  final String authenticitySignals;
  final String emotionalVariability;
  final List<String> concernFlags;
  final String dataQualityNote;

  EmotionalIntelligenceProfile({
    required this.engagementLevel,
    required this.stressResponse,
    required this.authenticitySignals,
    required this.emotionalVariability,
    required this.concernFlags,
    required this.dataQualityNote,
  });

  factory EmotionalIntelligenceProfile.fromJson(Map<String, dynamic> json) {
    return EmotionalIntelligenceProfile(
      engagementLevel: ScoredDimension.fromJson(json['engagementLevel'] ?? {}),
      stressResponse: ScoredDimension.fromJson(json['stressResponse'] ?? {}),
      authenticitySignals: json['authenticitySignals'] ?? '',
      emotionalVariability: json['emotionalVariability'] ?? '',
      concernFlags: List<String>.from(json['concernFlags'] ?? []),
      dataQualityNote: json['dataQualityNote'] ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
    'engagementLevel': engagementLevel.toJson(),
    'stressResponse': stressResponse.toJson(),
    'authenticitySignals': authenticitySignals,
    'emotionalVariability': emotionalVariability,
    'concernFlags': concernFlags,
    'dataQualityNote': dataQualityNote,
  };
}

// ── Gemini ATS Scorecard ──
class ATSScorecard {
  final int? overallFitScore;
  final String overallFitLabel;
  final String overallConfidenceLevel;
  final ScoredDimension communicationScore;
  final ScoredDimension technicalDepthScore;
  final ScoredDimension problemSolvingScore;
  final ScoredDimension engagementScore;
  final ScoredDimension consistencyScore;
  final CommunicationProfile communicationProfile;
  final EmotionalIntelligenceProfile emotionalIntelligenceProfile;
  final List<PerQuestionAnalysis> perQuestionAnalysis;
  final List<String> topStrengths;
  final List<String> topConcerns;
  final List<String> recommendedFollowUpQuestions;
  final String hiringRecommendation;
  final String hiringRecommendationRationale;
  final List<String> dataLimitations;
  final String transcriptReliabilityNote;
  final List<String> biasWarnings;
  final int analysisTimestamp;
  final String geminiModel;
  final String inputDataQuality;

  ATSScorecard({
    this.overallFitScore,
    required this.overallFitLabel,
    required this.overallConfidenceLevel,
    required this.communicationScore,
    required this.technicalDepthScore,
    required this.problemSolvingScore,
    required this.engagementScore,
    required this.consistencyScore,
    required this.communicationProfile,
    required this.emotionalIntelligenceProfile,
    required this.perQuestionAnalysis,
    required this.topStrengths,
    required this.topConcerns,
    required this.recommendedFollowUpQuestions,
    required this.hiringRecommendation,
    required this.hiringRecommendationRationale,
    required this.dataLimitations,
    required this.transcriptReliabilityNote,
    required this.biasWarnings,
    required this.analysisTimestamp,
    required this.geminiModel,
    required this.inputDataQuality,
  });

  factory ATSScorecard.fromJson(Map<String, dynamic> json) {
    return ATSScorecard(
      overallFitScore: json['overallFitScore'],
      overallFitLabel: json['overallFitLabel'] ?? 'Needs Review',
      overallConfidenceLevel: json['overallConfidenceLevel'] ?? 'insufficient',
      communicationScore: ScoredDimension.fromJson(json['communicationScore'] ?? {}),
      technicalDepthScore: ScoredDimension.fromJson(json['technicalDepthScore'] ?? {}),
      problemSolvingScore: ScoredDimension.fromJson(json['problemSolvingScore'] ?? {}),
      engagementScore: ScoredDimension.fromJson(json['engagementScore'] ?? {}),
      consistencyScore: ScoredDimension.fromJson(json['consistencyScore'] ?? {}),
      communicationProfile: CommunicationProfile.fromJson(json['communicationProfile'] ?? {}),
      emotionalIntelligenceProfile: EmotionalIntelligenceProfile.fromJson(json['emotionalIntelligenceProfile'] ?? {}),
      perQuestionAnalysis: (json['perQuestionAnalysis'] as List?)
              ?.map((e) => PerQuestionAnalysis.fromJson(e))
              .toList() ??
          [],
      topStrengths: List<String>.from(json['topStrengths'] ?? []),
      topConcerns: List<String>.from(json['topConcerns'] ?? []),
      recommendedFollowUpQuestions: List<String>.from(json['recommendedFollowUpQuestions'] ?? []),
      hiringRecommendation: json['hiringRecommendation'] ?? 'Hold',
      hiringRecommendationRationale: json['hiringRecommendationRationale'] ?? '',
      dataLimitations: List<String>.from(json['dataLimitations'] ?? []),
      transcriptReliabilityNote: json['transcriptReliabilityNote'] ?? '',
      biasWarnings: List<String>.from(json['biasWarnings'] ?? []),
      analysisTimestamp: json['analysisTimestamp'] ?? DateTime.now().millisecondsSinceEpoch,
      geminiModel: json['geminiModel'] ?? 'gemini-2.5-flash',
      inputDataQuality: json['inputDataQuality'] ?? 'medium',
    );
  }

  Map<String, dynamic> toJson() => {
    'overallFitScore': overallFitScore,
    'overallFitLabel': overallFitLabel,
    'overallConfidenceLevel': overallConfidenceLevel,
    'communicationScore': communicationScore.toJson(),
    'technicalDepthScore': technicalDepthScore.toJson(),
    'problemSolvingScore': problemSolvingScore.toJson(),
    'engagementScore': engagementScore.toJson(),
    'consistencyScore': consistencyScore.toJson(),
    'communicationProfile': communicationProfile.toJson(),
    'emotionalIntelligenceProfile': emotionalIntelligenceProfile.toJson(),
    'perQuestionAnalysis': perQuestionAnalysis.map((e) => e.toJson()).toList(),
    'topStrengths': topStrengths,
    'topConcerns': topConcerns,
    'recommendedFollowUpQuestions': recommendedFollowUpQuestions,
    'hiringRecommendation': hiringRecommendation,
    'hiringRecommendationRationale': hiringRecommendationRationale,
    'dataLimitations': dataLimitations,
    'transcriptReliabilityNote': transcriptReliabilityNote,
    'biasWarnings': biasWarnings,
    'analysisTimestamp': analysisTimestamp,
    'geminiModel': geminiModel,
    'inputDataQuality': inputDataQuality,
  };
}

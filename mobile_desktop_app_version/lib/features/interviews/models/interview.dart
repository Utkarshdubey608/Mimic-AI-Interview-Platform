// lib/features/interviews/models/interview.dart
//
// The focused, Firestore-backed model for a recruiter-created interview assigned
// to a candidate. Deliberately simpler than the recruiter template module: it
// carries exactly what's needed to launch a Tavus video call or a chat runner
// (prompt + questions + avatar) plus the assignment (candidate email) and
// lifecycle status. See features/interviews/services/interview_repository.dart.

import 'package:cloud_firestore/cloud_firestore.dart';

import 'package:talbotiq/features/interviews/models/test_conclusion.dart';

/// Video (Tavus avatar) vs text Chat vs real-time Voice interview.
enum InterviewType { video, chat, voice }

extension InterviewTypeX on InterviewType {
  String get wire {
    switch (this) {
      case InterviewType.video:
        return 'video';
      case InterviewType.chat:
        return 'chat';
      case InterviewType.voice:
        return 'voice';
    }
  }

  String get label {
    switch (this) {
      case InterviewType.video:
        return 'Video interview';
      case InterviewType.chat:
        return 'Chat interview';
      case InterviewType.voice:
        return 'Voice interview';
    }
  }

  static InterviewType fromWire(String? v) {
    switch (v) {
      case 'video':
        return InterviewType.video;
      case 'voice':
        return InterviewType.voice;
      default:
        return InterviewType.chat;
    }
  }
}

/// What a candidate does in one round of a test's timeline.
///
/// A superset of [InterviewType]: `resume` is a submission step with no
/// interview session, `mcq` is a paper the candidate sits, and the other three
/// map 1:1 onto the interview tracks. It is declared here rather than beside
/// [InterviewRound] because the `interviews` document itself carries it —
/// putting it in the round file would make these two models import each other.
enum RoundKind { resume, chat, video, voice, twoWay, mcq }

extension RoundKindX on RoundKind {
  String get wire {
    switch (this) {
      case RoundKind.resume:
        return 'resume';
      case RoundKind.chat:
        return 'chat';
      case RoundKind.video:
        return 'video';
      case RoundKind.voice:
        return 'voice';
      case RoundKind.twoWay:
        return 'two_way';
      case RoundKind.mcq:
        return 'mcq';
    }
  }

  String get label {
    switch (this) {
      case RoundKind.resume:
        return 'Résumé screen';
      case RoundKind.chat:
        return 'Chat interview';
      case RoundKind.video:
        return 'Video interview';
      case RoundKind.voice:
        return 'Voice interview';
      case RoundKind.twoWay:
        return 'Live interview';
      case RoundKind.mcq:
        return 'Assessment';
    }
  }

  /// True when the candidate SITS this round on their device, as opposed to
  /// submitting something to it.
  ///
  /// Only a résumé round is false. An MCQ paper is true even though nobody
  /// conducts it — the candidate opens it, works through it and hands it in,
  /// which is the distinction this flag is actually used for.
  bool get isInterview => this != RoundKind.resume;

  /// True when an AI conducts the interview, so the round needs a script —
  /// questions, a prompt, an avatar or a voice.
  ///
  /// FALSE for a two-way round: a human asks the questions, so there is nothing
  /// to configure and nothing for the model to score afterwards. Kept separate
  /// from [isInterview] because a two-way round IS a live session — it just is
  /// not an AI one, and conflating the two would make the round editor demand
  /// questions nobody will read.
  /// FALSE for MCQ too, and for a sharper reason: an MCQ paper's questions are
  /// authored separately and referenced by id, so a prompt, a question list, an
  /// avatar and a voice are all meaningless on it. A round editor that demanded
  /// them would be asking for a script nobody reads.
  bool get usesAiInterviewer =>
      this != RoundKind.resume &&
      this != RoundKind.twoWay &&
      this != RoundKind.mcq;

  /// True when this round needs an MCQ paper attached to be sendable.
  ///
  /// The paper is referenced by id rather than embedded, because it contains the
  /// ANSWER KEY and the candidate's device must never receive it. See
  /// `features/interviews/candidate/mcq/`.
  bool get needsMcqPaper => this == RoundKind.mcq;

  /// True when the recruiter scores this round by hand.
  ///
  /// Only two-way: they were in the room, and with no recording there is no
  /// transcript for a model to read.
  bool get isRecruiterScored => this == RoundKind.twoWay;

  /// The AI interview track to launch, or null when there is no AI interviewer
  /// (a résumé submission, or a live call with a human).
  InterviewType? get interviewType {
    switch (this) {
      case RoundKind.resume:
        return null;
      case RoundKind.chat:
        return InterviewType.chat;
      case RoundKind.video:
        return InterviewType.video;
      case RoundKind.voice:
        return InterviewType.voice;
      case RoundKind.twoWay:
        return null;
      // Scored by comparison against a stored key, with no model in the loop.
      case RoundKind.mcq:
        return null;
    }
  }

  static RoundKind fromWire(String? v) {
    switch (v) {
      case 'resume':
        return RoundKind.resume;
      case 'video':
        return RoundKind.video;
      case 'voice':
        return RoundKind.voice;
      case 'two_way':
        return RoundKind.twoWay;
      case 'mcq':
        return RoundKind.mcq;
      default:
        return RoundKind.chat;
    }
  }

  static RoundKind fromInterviewType(InterviewType t) {
    switch (t) {
      case InterviewType.video:
        return RoundKind.video;
      case InterviewType.voice:
        return RoundKind.voice;
      case InterviewType.chat:
        return RoundKind.chat;
    }
  }
}

/// What the CANDIDATE is told about a round they finished.
///
/// Deliberately separate from the score. A candidate's question is "did I get
/// through"; the score, the AI summary, the strengths and the "areas to improve"
/// are the recruiter's working notes and are never shown to them. This enum, an
/// optional rank and an optional recruiter note are the entire candidate-facing
/// result — see `candidate_result_page.dart`.
enum RoundOutcome {
  /// Through to the next round.
  selected,

  /// Not going forward.
  notSelected,

  /// Published, but the recruiter has not decided yet. Also what an older
  /// result — published before outcomes existed — reads as, so a legacy
  /// document shows "we'll be in touch" instead of leaking its raw score.
  pending,
}

extension RoundOutcomeX on RoundOutcome {
  String get wire {
    switch (this) {
      case RoundOutcome.selected:
        return 'selected';
      case RoundOutcome.notSelected:
        return 'not_selected';
      case RoundOutcome.pending:
        return 'pending';
    }
  }

  /// Written for the candidate, not the recruiter. No hiring vocabulary.
  String get candidateLabel {
    switch (this) {
      case RoundOutcome.selected:
        return 'Moving forward';
      case RoundOutcome.notSelected:
        return 'Not moving forward';
      case RoundOutcome.pending:
        return 'Under review';
    }
  }

  static RoundOutcome fromWire(String? v) {
    switch (v) {
      case 'selected':
        return RoundOutcome.selected;
      case 'not_selected':
        return RoundOutcome.notSelected;
      default:
        return RoundOutcome.pending;
    }
  }
}

/// Lifecycle of an assigned interview.
enum InterviewStatus { assigned, inProgress, completed }

extension InterviewStatusX on InterviewStatus {
  String get wire {
    switch (this) {
      case InterviewStatus.assigned:
        return 'assigned';
      case InterviewStatus.inProgress:
        return 'in_progress';
      case InterviewStatus.completed:
        return 'completed';
    }
  }

  String get label {
    switch (this) {
      case InterviewStatus.assigned:
        return 'Assigned';
      case InterviewStatus.inProgress:
        return 'In progress';
      case InterviewStatus.completed:
        return 'Completed';
    }
  }

  static InterviewStatus fromWire(String? v) {
    switch (v) {
      case 'in_progress':
        return InterviewStatus.inProgress;
      case 'completed':
        return InterviewStatus.completed;
      default:
        return InterviewStatus.assigned;
    }
  }
}

/// Avatar selection for a video interview (maps to Tavus replica/persona).
class AvatarConfig {
  final String replicaId;
  final String? personaId;

  const AvatarConfig({required this.replicaId, this.personaId});

  factory AvatarConfig.fromMap(Map<String, dynamic>? m) => AvatarConfig(
        replicaId: (m?['replicaId'] as String?) ?? '',
        personaId: m?['personaId'] as String?,
      );

  Map<String, dynamic> toMap() => {
        'replicaId': replicaId,
        if (personaId != null && personaId!.isNotEmpty) 'personaId': personaId,
      };
}

class Interview {
  final String id;

  /// Shared by all candidates created together in one action, so a recruiter
  /// can review + publish a whole "test" at once.
  final String testId;

  /// Which round of the test's timeline this assignment belongs to — the id of a
  /// `tests/{testId}/rounds/{roundId}` document (see [InterviewRound]).
  ///
  /// EMPTY on every interview created before timelines existed. Such a document
  /// is treated as the single implicit round of a one-round test, which is why no
  /// migration is needed: see [hasRound] and [effectiveRoundOrder].
  final String roundId;

  /// The round's position in the timeline, copied here so the recruiter list can
  /// group and sort by round without reading the round documents. Null on
  /// pre-timeline interviews.
  final int? roundOrder;

  /// What the candidate does in this round, copied from the round at assignment.
  ///
  /// Exists because [type] cannot express a résumé round — it only names the
  /// three live interview tracks — and because the candidate's device can then
  /// route the round without reading `tests/{testId}/rounds`, which it has no
  /// permission to read. Null on pre-timeline interviews → derived from [type].
  final RoundKind? roundKind;

  final String recruiterId;
  final String recruiterEmail;

  /// Display name of the recruiter/org that created this interview, shown to
  /// the candidate.
  final String? recruiterName;
  final String candidateEmail;

  /// Normalized (lowercased/trimmed) candidate email — the field candidate
  /// queries + security rules match against.
  final String candidateEmailLower;
  final String? candidateName;

  final InterviewType type;

  /// This assignment's own name. On a multi-round test that is the ROUND's name
  /// ("Résumé screen"), not the job's.
  final String title;

  /// The job the whole test is for ("Senior Flutter Engineer").
  ///
  /// Stored because [title] became the round name, leaving the candidate's
  /// screen with several cards and nothing naming what they had applied for.
  /// Empty on pre-timeline documents, where [title] IS the job — see
  /// [displayTestTitle].
  final String testTitle;
  final String prompt;
  final List<String> questions;

  /// Chat interviews only: when true, the AI generates questions adaptively
  /// (résumé-grounded, with optional follow-ups) instead of using the fixed
  /// [questions] list. Absent/false on every existing doc → fixed behaviour is
  /// preserved unchanged.
  final bool adaptive;

  /// Adaptive settings (an `AdaptiveConfig` JSON map) applied when [adaptive] is
  /// true — role, difficulty, style, numberOfQuestions, allowFollowUps, etc.
  /// Kept as a raw map so this focused model stays free of the recruiter-module
  /// types; the chat launch adapter converts it to an `AdaptiveConfig`.
  final Map<String, dynamic>? adaptiveConfig;

  /// When true, the candidate is asked to provide a résumé (PDF or pasted text)
  /// before a VIDEO interview starts; the text grounds the AI interviewer.
  /// Adaptive chat always collects a résumé via the runner regardless of this
  /// flag. Absent/false on existing docs → no résumé step (unchanged).
  final bool collectResume;

  /// Interview language (full name, e.g. 'English', 'Spanish'). Drives the Tavus
  /// avatar's spoken language and the adaptive chat interviewer. Absent → English
  /// (unchanged behaviour).
  final String language;

  /// Voice track only: the Gemini Live prebuilt voice name (e.g. 'Aoede') and an
  /// optional persona id. Absent → the voice engine's default voice.
  final String? voiceName;
  final String? voicePersonaId;

  /// Optional proctoring/integrity settings (an `IntegrityConfig` JSON map:
  /// detectTabSwitch, disablePasteInAnswers, disableCopy, maxTabSwitchWarnings,
  /// logEvents). Enforced by the chat runner. Absent → sensible defaults.
  final Map<String, dynamic>? integrity;

  /// Optional branding (a `BrandingConfig` JSON map: companyName, accentColor,
  /// welcomeMessage) shown on the candidate welcome screen. Absent → defaults.
  final Map<String, dynamic>? branding;

  /// Chat interviews only: optional per-question countdown timer. A
  /// `ConversationTimingConfig`-shaped JSON map:
  /// { enabled:bool, perQuestionSeconds:int, thinkingSeconds:int,
  ///   allowEarlySubmit:bool, warningThresholdSeconds:int,
  ///   autoSubmitOnExpiry:bool }.
  /// When `enabled` is true the chat launch adapter runs the interview in
  /// `InterviewMode.timed`; the answer clock auto-submits at zero. Absent or
  /// `enabled:false` → the untimed conversational behaviour is preserved
  /// unchanged.
  final Map<String, dynamic>? chatTimer;

  /// Only meaningful for [InterviewType.video].
  final AvatarConfig avatar;
  final int durationMinutes;
  final InterviewStatus status;

  /// Optional access window. The candidate can only launch between
  /// [availableFrom] (if set) and [expiresAt] (if set).
  final DateTime? availableFrom;
  final DateTime? expiresAt;

  /// Max times a candidate may take this interview. null = unlimited.
  final int? maxAttempts;

  /// How many times the candidate has launched it so far.
  final int attemptsUsed;

  /// Which clients this may be taken on: `web`, `mobile`, `desktop`.
  ///
  /// EMPTY MEANS UNRESTRICTED, and so does having all three — the two are one
  /// policy, and the server stores both the same way. Every interview created
  /// before this existed has no field at all, which reads as empty here.
  ///
  /// ⚠️ A policy control, not a security boundary. The server decides; this app
  /// names its own platform in a header and a modified build could name another.
  /// It stops someone opening the wrong client by accident. See
  /// `interviews.DEVICES` in the backend.
  /// The PRECISE track this interview runs on: `chat`, `chatbot`, `video`,
  /// `video_avatar`, `voice`, `two_way`, `mcq`.
  ///
  /// `type` (video | chat) is this app's original two-way bucket and cannot express
  /// six tracks, so the exact one rides here. Empty on every interview created before
  /// this field existed, and on those the web client has to GUESS from `type` — which
  /// is how a recruiter's recorded-video interview once became a Tavus avatar
  /// conversation the moment a candidate opened it in a browser.
  ///
  /// Mirrors `MODE_LABELS` in `backend/app/interviews.py`, the shared vocabulary that
  /// `contracts/interview_document.fixtures.json` pins.
  final String mode;

  final List<String> allowedDevices;

  /// MCQ rounds only: WHICH paper this assignment is of — an id, never the paper.
  ///
  /// Referenced rather than embedded because a paper contains the ANSWER KEY, and
  /// an interview document is readable by the candidate it is assigned to. The
  /// server resolves the id and projects the paper through an allow-list on every
  /// request (`backend/app/mcq_runtime.py`), so the key never reaches a device.
  ///
  /// This is why an MCQ invite carries `questions: []`. Empty on every other track.
  ///
  /// Stored under `screening.mcqSetId`, which is where the web surface has always
  /// written it — a top-level `mcqSetId` is also read, for a document written by
  /// hand or by an older build.
  final String mcqSetId;

  final DateTime? createdAt;
  final DateTime? updatedAt;

  /// Canonical result map (both video + chat). Written unpublished on
  /// completion; the recruiter reviews/edits it and publishes. Shape:
  /// { overallScore:int, summary:String, recommendation:String,
  ///   strengths:[String], improvements:[String], evaluatedBy:'ai'|'manual',
  ///   detail:{...raw} }.
  final Map<String, dynamic>? result;

  /// Whether the result is visible to the candidate. Recruiter-controlled.
  final bool resultPublished;

  /// A résumé submission and its AI score (a `ResumeSubmission` JSON map:
  /// text, charCount, fileName, extractedAt, score).
  ///
  /// READ-ONLY here, and absent from both write maps below on purpose: this field
  /// is written only by the backend with the Admin SDK, and `firestore.rules`
  /// blocks the candidate from touching it. See `resume_submission.dart`.
  final Map<String, dynamic>? resume;

  /// The recruiter's decision about the candidate's WHOLE run at this test, once
  /// released. Null until then.
  ///
  /// Deliberately not inside `result`: `result` is this round's scoring and
  /// `clearResult` wipes it so a candidate can retake, which must not silently
  /// un-tell somebody the outcome of the entire process. See
  /// `test_conclusion.dart`.
  ///
  /// Copied onto EVERY assignment of that candidate in the test, so it is found
  /// from whichever round they open and needs no read the candidate's device is
  /// not permitted to make.
  final Map<String, dynamic>? conclusion;

  // ── Evaluation state ──────────────────────────────────────────────────────
  //
  // Who — if anyone — produced the stored score. `evaluatedBy` is the single
  // source of truth: 'ai', 'manual', or EMPTY meaning nothing has scored this.
  //
  // Empty is deliberately never a score. A heuristic fallback used to be written
  // here as `'ai'`, which put a number derived from answer LENGTH in front of a
  // recruiter looking like a judgement of content, and let it be published to the
  // candidate. Failed scoring now stores no score at all, which is why
  // `overallScore` is absent rather than 0 — a 0 would rank on the leaderboard as
  // if the candidate had earned it.

  String get evaluatedBy => (result?['evaluatedBy'] as String?)?.trim() ?? '';

  /// Why AI scoring failed, when it did and recorded a reason.
  String get evaluationError =>
      (result?['evaluationError'] as String?)?.trim() ?? '';

  bool get isAiScored => evaluatedBy == 'ai';
  bool get isManuallyScored => evaluatedBy == 'manual';

  /// A real score exists — produced by the AI or entered by a recruiter.
  bool get hasScore => evaluatedBy.isNotEmpty && result?['overallScore'] != null;

  /// The candidate finished, but nothing has produced a score.
  ///
  /// Covers both "AI scoring failed" and "the AI never got there" — from the
  /// recruiter's point of view both need the same thing done about them, which is
  /// why [canRetryEvaluation] rather than this decides what the retry button acts
  /// on.
  bool get awaitingEvaluation =>
      status == InterviewStatus.completed &&
      result != null &&
      evaluatedBy.isEmpty;

  /// Scoring failed and said why — the case worth reporting as a FAILURE rather
  /// than as "not scored yet".
  bool get evaluationFailed =>
      awaitingEvaluation &&
      evaluationError.isNotEmpty &&
      !awaitingRecruiterReview;

  /// A two-way round the recruiter has not scored yet.
  ///
  /// Distinct from [evaluationFailed]: nothing went wrong, a human simply has
  /// not filled it in. Without this a two-way round would wear the "Scoring
  /// failed" badge from the moment the call ended until the recruiter got round
  /// to it, which is both wrong and alarming.
  bool get awaitingRecruiterReview =>
      awaitingEvaluation && result?['awaitingRecruiterReview'] == true;

  /// The recruiter's 0-5 star rating of a live interview, or null.
  int? get twoWayStars => (result?['twoWayReview'] as Map?)?['stars'] as int?;

  /// The recruiter's private notes on a live interview. Never shown to the
  /// candidate — `candidateNote` is the field for that.
  String get twoWayNotes =>
      ((result?['twoWayReview'] as Map?)?['notes'] as String?)?.trim() ?? '';

  /// The candidate's raw answers, kept so a failed evaluation can be retried
  /// without making them sit the interview again.
  List<Map<String, dynamic>> get storedResponses => [
        for (final e in (result?['responses'] as List?) ?? const [])
          if (e is Map)
            e.map((k, v) => MapEntry(k.toString(), v)),
      ];

  /// Retryable: nothing scored it, and the answers needed to score it survive.
  /// Without responses there is nothing to feed the scorer, so the only route is
  /// a manual evaluation.
  /// Retryable: an AI scorer could run again, and the answers it needs survive.
  ///
  /// A two-way round is never retryable no matter what it stores — no recording
  /// means no transcript, so there is nothing for a model to read. Its route back
  /// is the recruiter's own review.
  bool get canRetryEvaluation =>
      awaitingEvaluation &&
      storedResponses.isNotEmpty &&
      !effectiveRoundKind.isRecruiterScored;

  // ── What the candidate is told ────────────────────────────────────────────

  /// The recruiter's decision on this round, once published.
  ///
  /// Absent — including on every result published before outcomes existed —
  /// reads as [RoundOutcome.pending] rather than leaking the raw score.
  RoundOutcome get outcome =>
      RoundOutcomeX.fromWire(result?['outcome'] as String?);

  /// True once a recruiter has actually decided, as opposed to defaulting.
  bool get hasOutcome => result?['outcome'] != null;

  /// Whether this round's OWN outcome is worth showing the candidate.
  ///
  /// False for an undecided round of a run that has already been CONCLUDED.
  /// [outcome] defaults to [RoundOutcome.pending] — "Under review" — and a round
  /// still under review sitting beside a published "You cleared every round" is a
  /// contradiction the candidate is left to resolve on their own. The conclusion
  /// is the later and stronger statement, so an undecided round defers to it.
  ///
  /// A round that carries a real decision keeps showing it: "not moving forward"
  /// on round 2 explains a conclusion in a way the conclusion alone does not.
  bool get showsOwnOutcome => hasOutcome || !hasConclusion;

  /// Position on this round's leaderboard, stamped at publish time so it cannot
  /// drift when someone else is scored later. Null when not shared.
  int? get rank => (result?['rank'] as num?)?.toInt();

  /// How many were ranked, for "4 of 32". Null when not shared.
  int? get rankOf => (result?['rankOf'] as num?)?.toInt();

  /// How the candidate's whole run at this test ended, or null while it is still
  /// running. Parsed from [conclusion].
  ///
  /// Independent of [outcome], which is only ever about one round: a candidate
  /// can be "moving forward" on their last round and have no conclusion yet.
  TestConclusion? get testConclusion => TestConclusion.fromMap(conclusion);

  /// True once a recruiter has released a conclusion for this test. Presence IS
  /// publication — see `test_conclusion.dart`.
  bool get hasConclusion => testConclusion != null;

  /// A note the recruiter wrote FOR the candidate. Distinct from `summary`,
  /// which is the AI's internal write-up and is never shown to them.
  String get candidateNote =>
      (result?['candidateNote'] as String?)?.trim() ?? '';

  /// The job to show the candidate. Falls back to [title] for pre-timeline
  /// documents, where the assignment's own name IS the job.
  String get displayTestTitle => testTitle.isNotEmpty ? testTitle : title;

  /// Whether this interview belongs to an explicit round. False for every
  /// pre-timeline document, which is treated as a single implicit round.
  bool get hasRound => roundId.isNotEmpty;

  /// Timeline position, defaulting a pre-timeline interview to the first round so
  /// grouping and sorting never has to special-case null.
  int get effectiveRoundOrder => roundOrder ?? 0;

  /// What the candidate does here. Falls back to [type] for pre-timeline
  /// documents, which were always live interviews.
  /// Whether [effectiveMode] and [type] describe the same interview.
  ///
  /// Not enforced at the write — `type` is the caller's — so this is what a test
  /// asserts instead. A document whose two disagree runs one track on the phone and a
  /// different one in the browser, which is the whole class of bug `mode` exists to
  /// close.
  bool get modeAgreesWithType {
    switch (effectiveMode) {
      case '':
        return true; // a résumé round has no track at all
      case 'video':
      case 'video_avatar':
      case 'two_way':
        return type == InterviewType.video;
      case 'voice':
        return type == InterviewType.voice;
      // `mcq` lands in the chat bucket, matching the server's `type_for_mode`:
      // `mcq` is not in `_VIDEO_MODES`, so an MCQ document carries `type: chat`
      // and routing switches on `mode`. See candidate_home.dart.
      default:
        return type == InterviewType.chat;
    }
  }

  /// The track to WRITE, derived from what this interview actually is.
  ///
  /// `roundKind` is the richest thing this app knows — a round says whether it is a
  /// chat, a video, a voice or a live two-way interview — so it wins where present.
  /// Otherwise `type` is all there is.
  ///
  /// A `resume` round writes NOTHING. A résumé screen is not an interview track, it
  /// has no web runtime, and inventing a mode for it would tell the browser to try to
  /// run one.
  String get effectiveMode {
    if (mode.isNotEmpty) return mode;
    switch (effectiveRoundKind) {
      case RoundKind.chat:
        return 'chat';
      case RoundKind.video:
        return 'video';
      case RoundKind.voice:
        return 'voice';
      case RoundKind.twoWay:
        return 'two_way';
      case RoundKind.mcq:
        return 'mcq';
      case RoundKind.resume:
        return '';
    }
  }

  RoundKind get effectiveRoundKind =>
      roundKind ?? RoundKindX.fromInterviewType(type);

  const Interview({
    required this.id,
    this.testId = '',
    this.roundId = '',
    this.roundOrder,
    this.roundKind,
    required this.recruiterId,
    required this.recruiterEmail,
    this.recruiterName,
    required this.candidateEmail,
    required this.candidateEmailLower,
    this.candidateName,
    required this.type,
    required this.title,
    this.testTitle = '',
    required this.prompt,
    required this.questions,
    this.adaptive = false,
    this.adaptiveConfig,
    this.collectResume = false,
    this.language = 'English',
    this.voiceName,
    this.voicePersonaId,
    this.integrity,
    this.branding,
    this.chatTimer,
    required this.avatar,
    required this.durationMinutes,
    required this.status,
    this.availableFrom,
    this.expiresAt,
    this.maxAttempts,
    this.attemptsUsed = 0,
    this.mode = '',
    this.allowedDevices = const [],
    this.mcqSetId = '',
    this.createdAt,
    this.updatedAt,
    this.result,
    this.resultPublished = false,
    this.resume,
    this.conclusion,
  });

  /// Time-window checks.
  bool get isExpired =>
      expiresAt != null && DateTime.now().isAfter(expiresAt!);
  bool get isNotYetAvailable =>
      availableFrom != null && DateTime.now().isBefore(availableFrom!);
  bool get isWithinWindow => !isExpired && !isNotYetAvailable;

  /// Attempt checks.
  bool get hasAttemptsLeft => maxAttempts == null || attemptsUsed < maxAttempts!;
  int? get attemptsRemaining =>
      maxAttempts == null ? null : (maxAttempts! - attemptsUsed).clamp(0, maxAttempts!);

  /// The candidate may launch only within the window AND with attempts left.
  bool get isAccessible => isWithinWindow && hasAttemptsLeft;

  factory Interview.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    return Interview(
      id: doc.id,
      testId: (d['testId'] as String?) ?? '',
      roundId: (d['roundId'] as String?) ?? '',
      roundOrder: (d['roundOrder'] as num?)?.toInt(),
      // Absent (pre-timeline) must stay null rather than defaulting through
      // fromWire, so `effectiveRoundKind` can fall back to the interview type.
      roundKind: d['roundKind'] == null
          ? null
          : RoundKindX.fromWire(d['roundKind'] as String?),
      recruiterId: (d['recruiterId'] as String?) ?? '',
      recruiterEmail: (d['recruiterEmail'] as String?) ?? '',
      recruiterName: d['recruiterName'] as String?,
      candidateEmail: (d['candidateEmail'] as String?) ?? '',
      candidateEmailLower: (d['candidateEmailLower'] as String?) ??
          (d['candidateEmail'] as String?)?.trim().toLowerCase() ??
          '',
      candidateName: d['candidateName'] as String?,
      type: InterviewTypeX.fromWire(d['type'] as String?),
      title: (d['title'] as String?) ?? 'Interview',
      testTitle: (d['testTitle'] as String?) ?? '',
      prompt: (d['prompt'] as String?) ?? '',
      questions:
          (d['questions'] as List?)?.map((e) => e.toString()).toList() ??
              const [],
      adaptive: (d['adaptive'] as bool?) ?? false,
      adaptiveConfig: (d['adaptiveConfig'] as Map<String, dynamic>?),
      collectResume: (d['collectResume'] as bool?) ?? false,
      language: (d['language'] as String?) ?? 'English',
      voiceName: d['voiceName'] as String?,
      voicePersonaId: d['voicePersonaId'] as String?,
      integrity: d['integrity'] as Map<String, dynamic>?,
      branding: d['branding'] as Map<String, dynamic>?,
      chatTimer: d['chatTimer'] as Map<String, dynamic>?,
      avatar: AvatarConfig.fromMap(d['avatar'] as Map<String, dynamic>?),
      durationMinutes: (d['durationMinutes'] as num?)?.toInt() ?? 15,
      status: InterviewStatusX.fromWire(d['status'] as String?),
      availableFrom: (d['availableFrom'] as Timestamp?)?.toDate(),
      expiresAt: (d['expiresAt'] as Timestamp?)?.toDate(),
      maxAttempts: (d['maxAttempts'] as num?)?.toInt(),
      attemptsUsed: (d['attemptsUsed'] as num?)?.toInt() ?? 0,
      mode: (d['mode'] as String?)?.trim() ?? '',
      allowedDevices: [
        for (final v in (d['allowedDevices'] as List?) ?? const [])
          if (v is String && v.trim().isNotEmpty) v.trim().toLowerCase(),
      ],
      mcqSetId: (((d['screening'] as Map?)?['mcqSetId'] ?? d['mcqSetId'])
                  as String?)
              ?.trim() ??
          '',
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
      updatedAt: (d['updatedAt'] as Timestamp?)?.toDate(),
      result: d['result'] as Map<String, dynamic>?,
      resultPublished: (d['resultPublished'] as bool?) ?? false,
      resume: d['resume'] as Map<String, dynamic>?,
      conclusion: d['conclusion'] as Map<String, dynamic>?,
    );
  }

  /// Payload for a new document. `createdAt`/`updatedAt` use server timestamps.
  Map<String, dynamic> toCreateMap() => {
        'testId': testId,
        // Round fields are written only when this interview belongs to a
        // timeline, so a single-round test's documents stay byte-identical to
        // what the app wrote before rounds existed.
        if (roundId.isNotEmpty) 'roundId': roundId,
        if (roundOrder != null) 'roundOrder': roundOrder,
        if (roundKind != null) 'roundKind': roundKind!.wire,
        'resultPublished': false,
        'recruiterId': recruiterId,
        'recruiterEmail': recruiterEmail,
        if (recruiterName != null && recruiterName!.isNotEmpty)
          'recruiterName': recruiterName,
        'candidateEmail': candidateEmail,
        'candidateEmailLower': candidateEmailLower,
        if (candidateName != null && candidateName!.isNotEmpty)
          'candidateName': candidateName,
        'type': type.wire,
        'title': title,
        if (testTitle.isNotEmpty) 'testTitle': testTitle,
        'prompt': prompt,
        'questions': questions,
        'adaptive': adaptive,
        if (adaptiveConfig != null) 'adaptiveConfig': adaptiveConfig,
        'collectResume': collectResume,
        'language': language,
        if (voiceName != null) 'voiceName': voiceName,
        if (voicePersonaId != null) 'voicePersonaId': voicePersonaId,
        if (integrity != null) 'integrity': integrity,
        if (branding != null) 'branding': branding,
        if (chatTimer != null) 'chatTimer': chatTimer,
        'avatar': avatar.toMap(),
        'durationMinutes': durationMinutes,
        'status': status.wire,
        'availableFrom':
            availableFrom == null ? null : Timestamp.fromDate(availableFrom!),
        'expiresAt': expiresAt == null ? null : Timestamp.fromDate(expiresAt!),
        'maxAttempts': maxAttempts,
        'attemptsUsed': 0,
        // The PRECISE track, so the web client never has to guess it from `type`.
        //
        // NOT derived from `type`, and the two are not redundant: this app's
        // `InterviewType` is video | chat | VOICE, while the server's `type_for_mode`
        // collapses voice into chat — so mobile's bucket is the richer of the two and
        // cannot be reconstructed from the server's. `mode` is the shared vocabulary;
        // `type` stays this app's own.
        //
        // They do have to AGREE, and nothing here can enforce that because `type` is
        // set by the caller. `modeAgreesWithType` is the check, asserted in
        // test/interview_contract_test.dart.
        if (effectiveMode.isNotEmpty) 'mode': effectiveMode,
        // Written only when actually restricted. An absent field and "all three
        // selected" are the same policy, so the common case adds nothing.
        if (allowedDevices.isNotEmpty && allowedDevices.length < 3)
          'allowedDevices': allowedDevices,
        // Nested, matching what the web surface writes, so one interview document
        // means the same thing whichever client created it. Written only for an MCQ
        // round — every other track has no paper and gets no key at all rather than
        // an empty one.
        if (mcqSetId.isNotEmpty) 'screening': {'mcqSetId': mcqSetId},
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      };

  /// Editable fields written on an update (identity + createdAt are preserved).
  ///
  /// `testId` and the three round fields are deliberately absent: which round of
  /// which test an assignment belongs to is identity, not content. Reordering a
  /// timeline rewrites `roundOrder` through
  /// `InterviewRepository.reorderRounds`, not through an interview edit.
  Map<String, dynamic> toUpdateMap() => {
        'candidateEmail': candidateEmail,
        'candidateEmailLower': candidateEmailLower,
        'candidateName': candidateName,
        'type': type.wire,
        'title': title,
        if (testTitle.isNotEmpty) 'testTitle': testTitle,
        'prompt': prompt,
        'questions': questions,
        'adaptive': adaptive,
        'collectResume': collectResume,
        'language': language,
        // Type-specific config written UNCONDITIONALLY (null when absent) so
        // editing an interview to a different type clears stale fields.
        'adaptiveConfig': adaptiveConfig,
        'voiceName': voiceName,
        'voicePersonaId': voicePersonaId,
        'integrity': integrity,
        'branding': branding,
        'chatTimer': chatTimer,
        'avatar': avatar.toMap(),
        'durationMinutes': durationMinutes,
        'availableFrom':
            availableFrom == null ? null : Timestamp.fromDate(availableFrom!),
        'expiresAt': expiresAt == null ? null : Timestamp.fromDate(expiresAt!),
        // attemptsUsed is intentionally omitted so an edit never resets it.
        'maxAttempts': maxAttempts,
        // A DOTTED path, so a `screening` map the web surface wrote keeps its other
        // keys — `mcqConfig` lives there too, and replacing the whole map from here
        // would silently drop the scoring rules a recruiter set in the browser.
        //
        // Deleted rather than blanked when an interview is edited off the MCQ track:
        // an empty string would leave the document claiming a paper that is not
        // there, which reads on the server as "no assessment attached" only by
        // accident.
        'screening.mcqSetId':
            mcqSetId.isEmpty ? FieldValue.delete() : mcqSetId,
        'updatedAt': FieldValue.serverTimestamp(),
      };
}

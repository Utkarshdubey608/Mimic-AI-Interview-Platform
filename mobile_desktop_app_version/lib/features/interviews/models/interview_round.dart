// lib/features/interviews/models/interview_round.dart
//
// One stage of a recruiter-defined hiring timeline, stored at
// `tests/{testId}/rounds/{roundId}`. A "test" used to be a single interview
// handed to a batch of candidates; a test is now a pipeline and THIS is the
// stage inside it — résumé screen, then chat round, then a video round, each
// with its own open/close window.
//
// Two design points worth knowing before editing:
//
//  1. A round's [config] is a TEMPLATE. It is copied onto each candidate's
//     `interviews` document at assignment time (see [assignTo]). Editing a round
//     afterwards therefore never rewrites the questions of a candidate who is
//     already mid-interview.
//  2. Lifecycle is DERIVED, not scheduled. [stateAt] is a pure function of the
//     clock and three timestamps, so "auto-end at expiry" behaves correctly for
//     the candidate gate and the recruiter UI without a cron job existing.
//     Ending a round by hand just records [closedAt].

import 'package:cloud_firestore/cloud_firestore.dart';

import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';

// [RoundKind] itself lives in `interview.dart`, beside [InterviewType] — the
// `interviews` document carries it too, and declaring it here would make the two
// models import each other.

/// Where a round is in its lifecycle. Never stored — always derived from the
/// clock by [InterviewRound.stateAt], so it cannot go stale.
enum RoundState { scheduled, open, closed }

extension RoundStateX on RoundState {
  String get label {
    switch (this) {
      case RoundState.scheduled:
        return 'Scheduled';
      case RoundState.open:
        return 'Open';
      case RoundState.closed:
        return 'Closed';
    }
  }
}

/// How a round stopped accepting submissions. Stored only once a round has
/// actually been closed by hand.
enum RoundClosedBy { manual, auto }

extension RoundClosedByX on RoundClosedBy {
  String get wire => this == RoundClosedBy.manual ? 'manual' : 'auto';

  static RoundClosedBy? fromWire(String? v) {
    switch (v) {
      case 'manual':
        return RoundClosedBy.manual;
      case 'auto':
        return RoundClosedBy.auto;
      default:
        return null;
    }
  }
}

/// What the round is judged against. Currently consumed by résumé scoring; the
/// interview tracks carry their own rubric inside [InterviewRound.config].
class RoundCriteria {
  final List<String> requiredSkills;
  final List<String> niceToHave;

  /// Minimum relevant experience, in years. null = not a criterion.
  final double? minYears;

  /// Score below which a candidate is flagged as not meeting the bar. Advisory
  /// only — it never blocks a submission.
  final int? minScore;

  const RoundCriteria({
    this.requiredSkills = const [],
    this.niceToHave = const [],
    this.minYears,
    this.minScore,
  });

  bool get isEmpty =>
      requiredSkills.isEmpty &&
      niceToHave.isEmpty &&
      minYears == null &&
      minScore == null;

  factory RoundCriteria.fromMap(Map<String, dynamic>? m) => RoundCriteria(
        requiredSkills:
            (m?['requiredSkills'] as List?)?.map((e) => e.toString()).toList() ??
                const [],
        niceToHave:
            (m?['niceToHave'] as List?)?.map((e) => e.toString()).toList() ??
                const [],
        minYears: (m?['minYears'] as num?)?.toDouble(),
        minScore: (m?['minScore'] as num?)?.toInt(),
      );

  Map<String, dynamic> toMap() => {
        'requiredSkills': requiredSkills,
        'niceToHave': niceToHave,
        'minYears': minYears,
        'minScore': minScore,
      };
}

/// Who moves on from this round. Recorded so the recruiter's intent survives,
/// but nothing acts on it automatically yet — advancing is a recruiter action.
enum AdvanceMode { manual, topN, threshold }

extension AdvanceModeX on AdvanceMode {
  String get wire {
    switch (this) {
      case AdvanceMode.manual:
        return 'manual';
      case AdvanceMode.topN:
        return 'topN';
      case AdvanceMode.threshold:
        return 'threshold';
    }
  }

  static AdvanceMode fromWire(String? v) {
    switch (v) {
      case 'topN':
        return AdvanceMode.topN;
      case 'threshold':
        return AdvanceMode.threshold;
      default:
        return AdvanceMode.manual;
    }
  }
}

class RoundAdvance {
  final AdvanceMode mode;

  /// Candidate count for [AdvanceMode.topN], score for
  /// [AdvanceMode.threshold], ignored for [AdvanceMode.manual].
  final num? value;

  const RoundAdvance({this.mode = AdvanceMode.manual, this.value});

  factory RoundAdvance.fromMap(Map<String, dynamic>? m) => RoundAdvance(
        mode: AdvanceModeX.fromWire(m?['mode'] as String?),
        value: m?['value'] as num?,
      );

  Map<String, dynamic> toMap() => {'mode': mode.wire, 'value': value};
}

class InterviewRound {
  /// Document id within `tests/{testId}/rounds`.
  final String id;

  /// Parent test. Denormalised onto the doc so a round can be written back
  /// without the caller having to remember where it came from.
  final String testId;

  /// Owner. Stored on the round ITSELF rather than read from the parent test, so
  /// `firestore.rules` can authorise a round without a `get()` on the test —
  /// which would double the read cost of every round query.
  final String recruiterId;

  /// Position in the timeline, 0-based and contiguous. The list query orders by
  /// this, not by `createdAt`, so rounds can be reordered.
  final int order;

  final String title;
  final RoundKind kind;

  /// The interview configuration this round hands to its candidates: prompt,
  /// questions, adaptive/adaptiveConfig, avatar, language, chatTimer, integrity,
  /// branding, durationMinutes, maxAttempts, collectResume — and `mcqSetId` for
  /// an MCQ round, which has none of the others.
  ///
  /// Kept as a raw map for the same reason [Interview.adaptiveConfig] is: this
  /// focused model stays free of the recruiter-module types. Empty for a résumé
  /// round, which has no session to configure.
  final Map<String, dynamic> config;

  /// The round's own window. Both nullable: a round with neither is open from
  /// creation until it is ended by hand.
  final DateTime? opensAt;
  final DateTime? closesAt;

  /// Set when the round was ended explicitly. Its presence closes the round
  /// regardless of [closesAt].
  final DateTime? closedAt;
  final RoundClosedBy? closedBy;

  final RoundCriteria criteria;
  final RoundAdvance advance;

  final DateTime? createdAt;
  final DateTime? updatedAt;

  const InterviewRound({
    required this.id,
    required this.testId,
    required this.recruiterId,
    required this.order,
    required this.title,
    required this.kind,
    this.config = const {},
    this.opensAt,
    this.closesAt,
    this.closedAt,
    this.closedBy,
    this.criteria = const RoundCriteria(),
    this.advance = const RoundAdvance(),
    this.createdAt,
    this.updatedAt,
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /// The round's state at [now].
  ///
  /// Takes the clock as an argument so this is testable and so a list of rounds
  /// can be rendered against one consistent instant instead of drifting a few
  /// microseconds per row.
  RoundState stateAt(DateTime now) {
    if (closedAt != null) return RoundState.closed;
    if (closesAt != null && now.isAfter(closesAt!)) return RoundState.closed;
    if (opensAt != null && now.isBefore(opensAt!)) return RoundState.scheduled;
    return RoundState.open;
  }

  RoundState get state => stateAt(DateTime.now());

  bool get isOpen => state == RoundState.open;
  bool get isClosed => state == RoundState.closed;
  bool get isScheduled => state == RoundState.scheduled;

  /// True when a recruiter ended this round rather than the clock closing it.
  bool get wasEndedManually => closedBy == RoundClosedBy.manual;

  /// True when reopening this round would need a new deadline to have any
  /// effect: its own deadline has already passed, so clearing `closedAt` alone
  /// leaves the clock closing it again immediately.
  bool reopenNeedsDeadline(DateTime now) =>
      closesAt != null && !now.isBefore(closesAt!);

  /// True when the round has a deadline it has not yet passed — i.e. it will
  /// close on its own. Drives the "closes in 2d" hint.
  bool get willAutoClose =>
      closedAt == null && closesAt != null && DateTime.now().isBefore(closesAt!);

  /// Time until this round closes on its own, or null when it has no future
  /// deadline (already closed, or open-ended).
  Duration? get timeUntilClose {
    if (!willAutoClose) return null;
    return closesAt!.difference(DateTime.now());
  }

  /// Time until a scheduled round opens, or null when it is not scheduled.
  Duration? get timeUntilOpen {
    if (!isScheduled) return null;
    return opensAt!.difference(DateTime.now());
  }

  /// Whether a candidate may act on this round right now. Deliberately just
  /// [isOpen] today; per-candidate gating (attempts, prior-round elimination)
  /// lives on the candidate's own interview document.
  bool get acceptsSubmissions => isOpen;

  // ── Serialisation ─────────────────────────────────────────────────────────

  factory InterviewRound.fromDoc(
    DocumentSnapshot<Map<String, dynamic>> doc, {
    String? testId,
  }) {
    final d = doc.data() ?? const <String, dynamic>{};
    return InterviewRound(
      id: doc.id,
      // Prefer the stored value; fall back to the parent path so a doc written
      // before this field existed still knows its test.
      testId: (d['testId'] as String?)?.isNotEmpty == true
          ? d['testId'] as String
          : (testId ?? doc.reference.parent.parent?.id ?? ''),
      recruiterId: (d['recruiterId'] as String?) ?? '',
      order: (d['order'] as num?)?.toInt() ?? 0,
      title: (d['title'] as String?) ?? 'Round',
      kind: RoundKindX.fromWire(d['kind'] as String?),
      config: (d['config'] as Map<String, dynamic>?) ?? const {},
      opensAt: (d['opensAt'] as Timestamp?)?.toDate(),
      closesAt: (d['closesAt'] as Timestamp?)?.toDate(),
      closedAt: (d['closedAt'] as Timestamp?)?.toDate(),
      closedBy: RoundClosedByX.fromWire(d['closedBy'] as String?),
      criteria: RoundCriteria.fromMap(d['criteria'] as Map<String, dynamic>?),
      advance: RoundAdvance.fromMap(d['advance'] as Map<String, dynamic>?),
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
      updatedAt: (d['updatedAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toCreateMap() => {
        'testId': testId,
        'recruiterId': recruiterId,
        'order': order,
        'title': title,
        'kind': kind.wire,
        'config': config,
        'opensAt': opensAt == null ? null : Timestamp.fromDate(opensAt!),
        'closesAt': closesAt == null ? null : Timestamp.fromDate(closesAt!),
        // A new round is never born closed.
        'closedAt': null,
        'closedBy': null,
        'criteria': criteria.toMap(),
        'advance': advance.toMap(),
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      };

  /// Editable fields. `closedAt`/`closedBy` are omitted on purpose: ending a
  /// round goes through `InterviewRepository.endRound`, so a routine edit (fixing
  /// a typo in the title) can never accidentally reopen a closed round.
  Map<String, dynamic> toUpdateMap() => {
        'order': order,
        'title': title,
        'kind': kind.wire,
        'config': config,
        'opensAt': opensAt == null ? null : Timestamp.fromDate(opensAt!),
        'closesAt': closesAt == null ? null : Timestamp.fromDate(closesAt!),
        'criteria': criteria.toMap(),
        'advance': advance.toMap(),
        'updatedAt': FieldValue.serverTimestamp(),
      };

  InterviewRound copyWith({
    String? id,
    int? order,
    String? title,
    RoundKind? kind,
    Map<String, dynamic>? config,
    DateTime? opensAt,
    bool clearOpensAt = false,
    DateTime? closesAt,
    bool clearClosesAt = false,
    RoundCriteria? criteria,
    RoundAdvance? advance,
  }) =>
      InterviewRound(
        id: id ?? this.id,
        testId: testId,
        recruiterId: recruiterId,
        order: order ?? this.order,
        title: title ?? this.title,
        kind: kind ?? this.kind,
        config: config ?? this.config,
        opensAt: clearOpensAt ? null : (opensAt ?? this.opensAt),
        closesAt: clearClosesAt ? null : (closesAt ?? this.closesAt),
        closedAt: closedAt,
        closedBy: closedBy,
        criteria: criteria ?? this.criteria,
        advance: advance ?? this.advance,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );

  // ── The rounds ⇄ interviews seam ──────────────────────────────────────────

  /// Snapshots an interview's configuration into a round [config] map.
  ///
  /// Lets the existing create-interview form become a round editor without that
  /// screen learning the round document's field layout.
  static Map<String, dynamic> configFromInterview(Interview i) => {
        // An MCQ round's paper. An id, never the paper — see [Interview.mcqSetId].
        // Written only when there is one, so a chat round's config is unchanged.
        if (i.mcqSetId.isNotEmpty) 'mcqSetId': i.mcqSetId,
        'prompt': i.prompt,
        'questions': i.questions,
        'adaptive': i.adaptive,
        'adaptiveConfig': i.adaptiveConfig,
        'collectResume': i.collectResume,
        'language': i.language,
        'voiceName': i.voiceName,
        'voicePersonaId': i.voicePersonaId,
        'integrity': i.integrity,
        'branding': i.branding,
        'chatTimer': i.chatTimer,
        'avatar': i.avatar.toMap(),
        'durationMinutes': i.durationMinutes,
        'maxAttempts': i.maxAttempts,
      };

  /// Builds the `interviews` document for one candidate taking this round.
  ///
  /// This is the copy-at-assignment step: [config] is read out here and never
  /// again, which is what makes a later edit to the round safe. The candidate's
  /// window is the ROUND's window, so a per-round deadline needs no new field on
  /// [Interview] — `availableFrom`/`expiresAt` already mean exactly this.
  ///
  /// [id] is empty because Firestore assigns it on `add`.
  Interview assignTo({
    required String candidateEmail,
    String? candidateName,
    required String recruiterEmail,
    String? recruiterName,
    required String testTitle,
  }) {
    final c = config;
    return Interview(
      id: '',
      testId: testId,
      roundId: id,
      roundOrder: order,
      roundKind: kind,
      recruiterId: recruiterId,
      recruiterEmail: recruiterEmail,
      recruiterName: recruiterName,
      candidateEmail: candidateEmail,
      candidateEmailLower: candidateEmail.trim().toLowerCase(),
      candidateName: candidateName,
      // A résumé round has no session; `type` is a required field on the
      // document, so it holds the harmless default and `roundKind` is what
      // routing actually switches on.
      type: kind.interviewType ?? InterviewType.chat,
      title: title.isNotEmpty ? title : testTitle,
      testTitle: testTitle,
      prompt: (c['prompt'] as String?) ?? '',
      questions:
          (c['questions'] as List?)?.map((e) => e.toString()).toList() ??
              const [],
      adaptive: (c['adaptive'] as bool?) ?? false,
      adaptiveConfig: c['adaptiveConfig'] as Map<String, dynamic>?,
      // A résumé round collects a résumé by definition.
      collectResume:
          kind == RoundKind.resume || (c['collectResume'] as bool?) == true,
      language: (c['language'] as String?) ?? 'English',
      voiceName: c['voiceName'] as String?,
      voicePersonaId: c['voicePersonaId'] as String?,
      integrity: c['integrity'] as Map<String, dynamic>?,
      branding: c['branding'] as Map<String, dynamic>?,
      chatTimer: c['chatTimer'] as Map<String, dynamic>?,
      avatar: AvatarConfig.fromMap(c['avatar'] as Map<String, dynamic>?),
      durationMinutes: (c['durationMinutes'] as num?)?.toInt() ?? 15,
      status: InterviewStatus.assigned,
      availableFrom: opensAt,
      expiresAt: closesAt,
      maxAttempts: (c['maxAttempts'] as num?)?.toInt(),
      // Copied at assignment like everything else here, so editing the round
      // afterwards cannot change which paper an outstanding invite points at —
      // and a candidate mid-assessment cannot have it swapped under them.
      mcqSetId: (c['mcqSetId'] as String?)?.trim() ?? '',
    );
  }
}

// ── Pipeline status ─────────────────────────────────────────────────────────

/// Where a whole multi-round test currently stands.
enum PipelineStage {
  /// A round is accepting submissions right now.
  active,

  /// Nothing is open yet, but a round is scheduled to open.
  upcoming,

  /// Every round has closed — the pipeline is finished.
  complete,
}

/// A test's timeline reduced to the one line a recruiter needs at a glance:
/// which round it is on, out of how many, and what that round is doing.
///
/// Derived from the rounds and the clock, never stored — same reasoning as
/// [InterviewRound.stateAt]. Lives here rather than in the dashboard widget so
/// it can be unit-tested without pumping a frame, because the interesting part
/// is the ordering rules, not the pixels:
///
///  * The current round is the FIRST open one. A recruiter who left round 1
///    open by mistake while round 2 also opened should be pointed at round 1 —
///    that is the one with a stale deadline.
///  * With nothing open, the next SCHEDULED round is what matters ("opens in
///    2d"), so the timeline reads as pending rather than as finished.
///  * Only when no round is open or scheduled is the pipeline complete.
class RoundPipelineStatus {
  /// Every round in the test, in timeline order.
  final List<InterviewRound> rounds;

  /// Index into [rounds] of the round being reported. Always in range when
  /// [rounds] is non-empty.
  final int currentIndex;

  final PipelineStage stage;

  /// The instant this status was derived against.
  final DateTime asOf;

  const RoundPipelineStatus._({
    required this.rounds,
    required this.currentIndex,
    required this.stage,
    required this.asOf,
  });

  /// Reduces [rounds] to a status at [now]. Returns null for a test with no
  /// rounds at all — a legacy single-interview test, which has no pipeline to
  /// describe and should not be dressed up as one.
  static RoundPipelineStatus? from(List<InterviewRound> rounds, DateTime now) {
    if (rounds.isEmpty) return null;

    // Never trust the caller's ordering: the query orders by `order`, but a
    // reorder that half-applied would otherwise mislabel "round 2 of 4".
    final ordered = [...rounds]..sort((a, b) => a.order.compareTo(b.order));

    final openIndex = ordered.indexWhere((r) => r.stateAt(now) == RoundState.open);
    if (openIndex != -1) {
      return RoundPipelineStatus._(
        rounds: ordered,
        currentIndex: openIndex,
        stage: PipelineStage.active,
        asOf: now,
      );
    }

    final scheduledIndex =
        ordered.indexWhere((r) => r.stateAt(now) == RoundState.scheduled);
    if (scheduledIndex != -1) {
      return RoundPipelineStatus._(
        rounds: ordered,
        currentIndex: scheduledIndex,
        stage: PipelineStage.upcoming,
        asOf: now,
      );
    }

    return RoundPipelineStatus._(
      rounds: ordered,
      currentIndex: ordered.length - 1,
      stage: PipelineStage.complete,
      asOf: now,
    );
  }

  int get total => rounds.length;

  InterviewRound get current => rounds[currentIndex];

  /// How many rounds have finished. Drives the progress reading.
  int get closedCount =>
      rounds.where((r) => r.stateAt(asOf) == RoundState.closed).length;

  /// The last round that has finished, or null while none has.
  ///
  /// This is the round a decision is owed on: closing one is the moment the
  /// recruiter has to say who moves on, and if two are closed it is the later
  /// one that is waiting — the earlier one was settled to put anybody into this
  /// one at all. Derived from the clock like everything else here, so a round
  /// that closes on its deadline counts exactly like one closed by hand: that
  /// asymmetry is why an auto-closed round used to sit undecided in silence.
  int? get latestClosedIndex {
    for (var i = rounds.length - 1; i >= 0; i--) {
      if (rounds[i].stateAt(asOf) == RoundState.closed) return i;
    }
    return null;
  }

  /// The round from [latestClosedIndex], or null.
  InterviewRound? get latestClosed {
    final i = latestClosedIndex;
    return i == null ? null : rounds[i];
  }

  /// True for a test that is genuinely a pipeline. A single-round test is
  /// really just "an interview" and reads better without the round furniture.
  bool get isMultiRound => total > 1;

  /// Human position, e.g. "Round 2 of 4".
  String get positionLabel => 'Round ${currentIndex + 1} of $total';

  /// The current round's state as a short word, with its deadline when it has
  /// one — "Open · 2d left", "Opens in 3d", "All rounds closed".
  ///
  /// Both durations are measured against [asOf], NOT against the wall clock.
  /// [InterviewRound.timeUntilClose] and its siblings read `DateTime.now()`
  /// internally, so using them here would date the countdown from a different
  /// instant than the one the stage was decided at — invisible in production,
  /// where they are microseconds apart, and wrong the moment anything renders
  /// against a fixed clock.
  String get stateLabel {
    switch (stage) {
      case PipelineStage.active:
        final closesAt = current.closesAt;
        if (current.closedAt != null ||
            closesAt == null ||
            !asOf.isBefore(closesAt)) {
          return 'Open';
        }
        return 'Open · ${formatDurationShort(closesAt.difference(asOf))} left';
      case PipelineStage.upcoming:
        final opensAt = current.opensAt;
        if (opensAt == null || !asOf.isBefore(opensAt)) return 'Scheduled';
        return 'Opens in ${formatDurationShort(opensAt.difference(asOf))}';
      case PipelineStage.complete:
        return 'All rounds closed';
    }
  }

  /// The whole line shown under a test's title on the dashboard.
  String get summaryLabel {
    if (stage == PipelineStage.complete) {
      return '$total ${total == 1 ? 'round' : 'rounds'} · $stateLabel';
    }
    return '$positionLabel · ${current.title} · $stateLabel';
  }
}

// lib/features/recruiter/analytics/analytics_service.dart
//
// Pure, on-device analytics for the recruiter dashboard. Given the recruiter's
// own interviews (as returned by InterviewRepository.watchForRecruiter), it
// derives an [AnalyticsSummary] entirely from real Interview fields — no
// backend, no fabricated data. Every computation is null-safe and an empty
// input yields an all-zero summary.

import 'package:talbotiq/features/interviews/models/interview.dart';

/// The on-device analytics filter, mirroring the website's AnalyticsPage
/// controls that are feasible against the mobile [Interview] model:
///
///  * [track]     -> Interview.type       (null = All tracks)
///  * [testId]    -> Interview.testId      (null = All tests; the website's
///                                          "template" filter — interviews
///                                          created together share a testId)
///  * [roleQuery] -> Interview.title       (case-insensitive `contains`; the
///                                          website's role/title filter)
///  * [dateFrom]  -> Interview.createdAt   (inclusive lower bound, by day)
///  * [dateTo]    -> Interview.createdAt   (inclusive upper bound, by day)
///
/// The website's duration filter is intentionally absent — the mobile model
/// carries no startedAt/completedAt, so it cannot be computed and is omitted
/// rather than faked.
class AnalyticsFilter {
  /// Selected interview track, or null for "All".
  final InterviewType? track;

  /// Selected test group (distinct Interview.testId), or null for "All tests".
  final String? testId;

  /// Free-text role/title query, matched case-insensitively against
  /// Interview.title. Empty string means "no title filter".
  final String roleQuery;

  /// Inclusive lower/upper bounds applied to Interview.createdAt, or null when
  /// that side is unbounded.
  final DateTime? dateFrom;
  final DateTime? dateTo;

  const AnalyticsFilter({
    this.track,
    this.testId,
    this.roleQuery = '',
    this.dateFrom,
    this.dateTo,
  });

  /// The neutral filter — matches every interview.
  const AnalyticsFilter.none()
      : track = null,
        testId = null,
        roleQuery = '',
        dateFrom = null,
        dateTo = null;

  /// True when at least one facet is constraining the result set.
  bool get isActive =>
      track != null ||
      (testId != null && testId!.isNotEmpty) ||
      roleQuery.trim().isNotEmpty ||
      dateFrom != null ||
      dateTo != null;
}

/// A selectable "test" group in the template/test dropdown: a distinct
/// [testId] present in the recruiter's interviews, labelled by the title of
/// that group and annotated with how many interviews belong to it.
class TestOption {
  final String testId;
  final String label;
  final int count;

  const TestOption({
    required this.testId,
    required this.label,
    required this.count,
  });
}

/// One score-distribution bucket (inclusive lower bound, inclusive upper).
class ScoreBucket {
  final String label;
  final int min;
  final int max;
  final int count;

  const ScoreBucket({
    required this.label,
    required this.min,
    required this.max,
    required this.count,
  });

  ScoreBucket copyWith({int? count}) => ScoreBucket(
        label: label,
        min: min,
        max: max,
        count: count ?? this.count,
      );
}

/// Per-interview-type rollup (video / chat / voice): how many, how many were
/// completed, and the average score among those that have an overallScore.
class TypeStat {
  final InterviewType type;
  final int count;

  /// How many interviews of this type reached [InterviewStatus.completed].
  final int completedCount;

  /// Average overallScore over this type's *scored* interviews, or null when
  /// none of them carry a score yet.
  final double? averageScore;

  /// How many interviews of this type actually contributed a score.
  final int scoredCount;

  const TypeStat({
    required this.type,
    required this.count,
    required this.completedCount,
    required this.averageScore,
    required this.scoredCount,
  });

  String get label => type.label;

  /// completed / count for this type, in the range 0.0–1.0. Zero when this type
  /// has no interviews.
  double get completionRate => count == 0 ? 0 : completedCount / count;
}

/// A single point on the "average score by day" trend.
class TrendPoint {
  final DateTime day; // normalized to midnight local time

  /// Average overallScore across this day's scored interviews, clamped 0–100.
  final double averageScore;

  /// How many scored interviews contributed to [averageScore] on this day.
  final int count;

  const TrendPoint({
    required this.day,
    required this.averageScore,
    required this.count,
  });
}

/// A candidate ranked by their overall score.
class TopCandidate {
  /// The interview this score belongs to — used to open the recruiter's result
  /// view for that candidate.
  final String interviewId;

  /// Best display name available (candidateName, else candidateEmail).
  final String name;
  final String email;
  final int score;
  final String title;

  const TopCandidate({
    required this.interviewId,
    required this.name,
    required this.email,
    required this.score,
    required this.title,
  });
}

/// Funnel counts across the recruiter's interviews.
class FunnelTotals {
  final int assigned; // status == assigned
  final int inProgress; // status == inProgress
  final int completed; // status == completed
  final int published; // resultPublished == true
  final int total; // all interviews

  const FunnelTotals({
    required this.assigned,
    required this.inProgress,
    required this.completed,
    required this.published,
    required this.total,
  });

  const FunnelTotals.zero()
      : assigned = 0,
        inProgress = 0,
        completed = 0,
        published = 0,
        total = 0;
}

/// The immutable, fully-computed dashboard model.
class AnalyticsSummary {
  final FunnelTotals totals;

  /// completed / total, in the range 0.0–1.0. Zero when there are no interviews.
  final double completionRate;

  /// Average overallScore across every interview that has one; null when none
  /// are scored yet.
  final double? averageOverallScore;

  /// How many interviews contributed to [averageOverallScore].
  final int scoredCount;

  /// Five fixed buckets: 0-20, 21-40, 41-60, 61-80, 81-100.
  final List<ScoreBucket> scoreDistribution;

  /// video + chat + voice rollups (always all three present, count 0 when none).
  final List<TypeStat> byType;

  /// recommendation -> count, for strong_yes / yes / maybe / no / unknown.
  /// Always contains all five keys (0 when absent). 'unknown' collects completed
  /// interviews that carry no valid recommendation.
  final Map<String, int> recommendationDistribution;

  /// Average score by day, ascending by day (days with at least one scored
  /// interview).
  final List<TrendPoint> trend;

  /// Up to 10 highest-scoring candidates, descending.
  final List<TopCandidate> topCandidates;

  const AnalyticsSummary({
    required this.totals,
    required this.completionRate,
    required this.averageOverallScore,
    required this.scoredCount,
    required this.scoreDistribution,
    required this.byType,
    required this.recommendationDistribution,
    required this.trend,
    required this.topCandidates,
  });

  bool get isEmpty => totals.total == 0;

  /// The all-zero summary used for an empty interview list.
  factory AnalyticsSummary.empty() => AnalyticsSummary(
        totals: const FunnelTotals.zero(),
        completionRate: 0,
        averageOverallScore: null,
        scoredCount: 0,
        scoreDistribution: AnalyticsService.emptyBuckets(),
        byType: const [
          TypeStat(
              type: InterviewType.video,
              count: 0,
              completedCount: 0,
              averageScore: null,
              scoredCount: 0),
          TypeStat(
              type: InterviewType.chat,
              count: 0,
              completedCount: 0,
              averageScore: null,
              scoredCount: 0),
          TypeStat(
              type: InterviewType.voice,
              count: 0,
              completedCount: 0,
              averageScore: null,
              scoredCount: 0),
        ],
        recommendationDistribution: const {
          'strong_yes': 0,
          'yes': 0,
          'maybe': 0,
          'no': 0,
          'unknown': 0,
        },
        trend: const [],
        topCandidates: const [],
      );
}

/// Stateless computation. [compute] is a pure function of its input.
class AnalyticsService {
  const AnalyticsService();

  /// The canonical (decision) recommendation keys, in display order.
  static const List<String> recommendationKeys = [
    'strong_yes',
    'yes',
    'maybe',
    'no',
  ];

  /// All recommendation buckets in display order, including the catch-all
  /// 'unknown' for completed interviews without a valid recommendation.
  static const List<String> recommendationDisplayKeys = [
    'strong_yes',
    'yes',
    'maybe',
    'no',
    'unknown',
  ];

  /// Fresh set of the five zeroed score buckets.
  static List<ScoreBucket> emptyBuckets() => const [
        ScoreBucket(label: '0-20', min: 0, max: 20, count: 0),
        ScoreBucket(label: '21-40', min: 21, max: 40, count: 0),
        ScoreBucket(label: '41-60', min: 41, max: 60, count: 0),
        ScoreBucket(label: '61-80', min: 61, max: 80, count: 0),
        ScoreBucket(label: '81-100', min: 81, max: 100, count: 0),
      ];

  /// Reads a numeric overallScore from an interview's result, clamped to
  /// 0–100. Returns null when there is no usable score.
  static int? _scoreOf(Interview i) {
    final raw = i.result?['overallScore'];
    if (raw is num) {
      final v = raw.round();
      return v < 0 ? 0 : (v > 100 ? 100 : v);
    }
    return null;
  }

  /// Reads a normalized recommendation key, or null when absent/unknown.
  static String? _recommendationOf(Interview i) {
    final raw = i.result?['recommendation'];
    if (raw is String) {
      final v = raw.trim().toLowerCase();
      if (recommendationKeys.contains(v)) return v;
    }
    return null;
  }

  /// Builds the distinct "test" groups present in [interviews], sorted by
  /// label. Interviews created together share a [Interview.testId]; each group
  /// is labelled by the title of the first interview seen for that id. Blank
  /// testIds are skipped (they cannot be selected). Computed from the FULL,
  /// unfiltered list so the dropdown stays stable as other filters change.
  List<TestOption> testOptions(List<Interview> interviews) {
    final labelFor = <String, String>{};
    final counts = <String, int>{};
    for (final i in interviews) {
      final id = i.testId.trim();
      if (id.isEmpty) continue;
      counts[id] = (counts[id] ?? 0) + 1;
      labelFor.putIfAbsent(id, () {
        final t = i.title.trim();
        return t.isEmpty ? 'Untitled pipeline' : t;
      });
    }
    final out = [
      for (final e in counts.entries)
        TestOption(testId: e.key, label: labelFor[e.key]!, count: e.value),
    ]..sort(
        (a, b) => a.label.toLowerCase().compareTo(b.label.toLowerCase()),
      );
    return out;
  }

  /// Applies [filter] to [interviews], returning the subset that matches every
  /// active facet. Called BEFORE [compute] so every downstream metric/chart
  /// reflects only the filtered set. Pure and null-safe; an inactive filter
  /// returns the input unchanged.
  ///
  /// Date bounds are inclusive and evaluated by calendar day against
  /// createdAt. When a date bound is active, interviews with no createdAt are
  /// excluded (they cannot be placed on the timeline).
  List<Interview> applyFilter(List<Interview> interviews, AnalyticsFilter filter) {
    if (!filter.isActive) return interviews;

    final q = filter.roleQuery.trim().toLowerCase();
    final testId =
        (filter.testId != null && filter.testId!.isNotEmpty) ? filter.testId : null;

    final from = filter.dateFrom == null
        ? null
        : DateTime(
            filter.dateFrom!.year, filter.dateFrom!.month, filter.dateFrom!.day);
    final to = filter.dateTo == null
        ? null
        : DateTime(filter.dateTo!.year, filter.dateTo!.month, filter.dateTo!.day,
            23, 59, 59, 999);
    final hasDateBound = from != null || to != null;

    return interviews.where((i) {
      if (filter.track != null && i.type != filter.track) return false;
      if (testId != null && i.testId.trim() != testId) return false;
      if (q.isNotEmpty && !i.title.toLowerCase().contains(q)) return false;
      if (hasDateBound) {
        final c = i.createdAt;
        if (c == null) return false;
        if (from != null && c.isBefore(from)) return false;
        if (to != null && c.isAfter(to)) return false;
      }
      return true;
    }).toList();
  }

  AnalyticsSummary compute(List<Interview> interviews) {
    if (interviews.isEmpty) return AnalyticsSummary.empty();

    var assigned = 0, inProgress = 0, completed = 0, published = 0;

    final buckets = emptyBuckets();
    final bucketCounts = List<int>.filled(buckets.length, 0);

    var scoreSum = 0;
    var scoredCount = 0;

    var videoCount = 0, chatCount = 0, voiceCount = 0;
    var videoCompleted = 0, chatCompleted = 0, voiceCompleted = 0;
    var videoScoreSum = 0, chatScoreSum = 0, voiceScoreSum = 0;
    var videoScored = 0, chatScored = 0, voiceScored = 0;

    final recs = <String, int>{
      'strong_yes': 0,
      'yes': 0,
      'maybe': 0,
      'no': 0,
      'unknown': 0,
    };

    // day -> [sum of scores, number of scored interviews] for the trend.
    final perDayScoreSum = <DateTime, int>{};
    final perDayScored = <DateTime, int>{};
    final scored = <TopCandidate>[];

    for (final i in interviews) {
      // Funnel.
      switch (i.status) {
        case InterviewStatus.assigned:
          assigned++;
          break;
        case InterviewStatus.inProgress:
          inProgress++;
          break;
        case InterviewStatus.completed:
          completed++;
          break;
      }
      if (i.resultPublished) published++;

      // Type counts (+ per-type completion).
      final isCompleted = i.status == InterviewStatus.completed;
      switch (i.type) {
        case InterviewType.video:
          videoCount++;
          if (isCompleted) videoCompleted++;
          break;
        case InterviewType.chat:
          chatCount++;
          if (isCompleted) chatCompleted++;
          break;
        case InterviewType.voice:
          voiceCount++;
          if (isCompleted) voiceCompleted++;
          break;
      }

      // Score-derived metrics.
      final score = _scoreOf(i);
      if (score != null) {
        scoreSum += score;
        scoredCount++;

        final idx = _bucketIndex(score, buckets);
        bucketCounts[idx]++;

        switch (i.type) {
          case InterviewType.video:
            videoScoreSum += score;
            videoScored++;
            break;
          case InterviewType.chat:
            chatScoreSum += score;
            chatScored++;
            break;
          case InterviewType.voice:
            voiceScoreSum += score;
            voiceScored++;
            break;
        }

        final name = (i.candidateName != null && i.candidateName!.trim().isNotEmpty)
            ? i.candidateName!.trim()
            : i.candidateEmail;
        scored.add(TopCandidate(
          interviewId: i.id,
          name: name,
          email: i.candidateEmail,
          score: score,
          title: i.title,
        ));

        // Trend: average score by the day the interview was created.
        final created = i.createdAt;
        if (created != null) {
          final day = DateTime(created.year, created.month, created.day);
          perDayScoreSum[day] = (perDayScoreSum[day] ?? 0) + score;
          perDayScored[day] = (perDayScored[day] ?? 0) + 1;
        }
      }

      // Recommendation distribution. Completed interviews without a valid
      // recommendation fall into the 'unknown' bucket (matches the website).
      final rec = _recommendationOf(i);
      if (rec != null) {
        recs[rec] = (recs[rec] ?? 0) + 1;
      } else if (isCompleted) {
        recs['unknown'] = (recs['unknown'] ?? 0) + 1;
      }
    }

    final total = interviews.length;

    final distribution = [
      for (var k = 0; k < buckets.length; k++)
        buckets[k].copyWith(count: bucketCounts[k]),
    ];

    final trend = perDayScored.entries
        .map((e) {
          final count = e.value;
          final sum = perDayScoreSum[e.key] ?? 0;
          return TrendPoint(
            day: e.key,
            count: count,
            averageScore: count == 0 ? 0 : sum / count,
          );
        })
        .toList()
      ..sort((a, b) => a.day.compareTo(b.day));

    scored.sort((a, b) => b.score.compareTo(a.score));
    final topCandidates = scored.take(10).toList();

    return AnalyticsSummary(
      totals: FunnelTotals(
        assigned: assigned,
        inProgress: inProgress,
        completed: completed,
        published: published,
        total: total,
      ),
      completionRate: total == 0 ? 0 : completed / total,
      averageOverallScore: scoredCount == 0 ? null : scoreSum / scoredCount,
      scoredCount: scoredCount,
      scoreDistribution: distribution,
      byType: [
        TypeStat(
          type: InterviewType.video,
          count: videoCount,
          completedCount: videoCompleted,
          scoredCount: videoScored,
          averageScore: videoScored == 0 ? null : videoScoreSum / videoScored,
        ),
        TypeStat(
          type: InterviewType.chat,
          count: chatCount,
          completedCount: chatCompleted,
          scoredCount: chatScored,
          averageScore: chatScored == 0 ? null : chatScoreSum / chatScored,
        ),
        TypeStat(
          type: InterviewType.voice,
          count: voiceCount,
          completedCount: voiceCompleted,
          scoredCount: voiceScored,
          averageScore: voiceScored == 0 ? null : voiceScoreSum / voiceScored,
        ),
      ],
      recommendationDistribution: recs,
      trend: trend,
      topCandidates: topCandidates,
    );
  }

  /// Finds the bucket index for a 0–100 score. Falls back to the last bucket
  /// for any out-of-range value (scores are pre-clamped, so this is defensive).
  int _bucketIndex(int score, List<ScoreBucket> buckets) {
    for (var k = 0; k < buckets.length; k++) {
      if (score >= buckets[k].min && score <= buckets[k].max) return k;
    }
    return buckets.length - 1;
  }
}

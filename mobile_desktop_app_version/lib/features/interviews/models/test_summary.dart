// lib/features/interviews/models/test_summary.dart
//
// A "test" is one batch of candidates a recruiter created together — they all
// share an `Interview.testId`. Historically tests existed ONLY as that shared
// id, so listing them meant reading every interview and grouping client-side:
// fine for a handful of candidates, ruinous at a thousand.
//
// This model backs a dedicated `tests/{testId}` collection holding just the
// batch's metadata, so the recruiter dashboard can page over a few dozen tiny
// documents and fetch each test's candidates only when one is opened.
//
// Deliberately metadata-ONLY: no candidateCount / completedCount is stored.
// Denormalised counters would need updating from every add, delete and
// candidate-side completion, and would silently drift when any of those paths
// missed a write. Counts come from Firestore count() aggregates instead, which
// are cheap and cannot go stale.

import 'package:cloud_firestore/cloud_firestore.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';

class TestSummary {
  /// Bump when the denormalised dashboard title needs rebuilding. Version 1
  /// summaries were incorrectly derived from an assignment's round title.
  static const int titleSchemaVersion = 2;

  /// Document id, equal to the `testId` shared by this batch's interviews.
  final String testId;
  final String recruiterId;
  final String title;
  final InterviewType type;
  final DateTime? createdAt;
  final int titleVersion;

  const TestSummary({
    required this.testId,
    required this.recruiterId,
    required this.title,
    required this.type,
    required this.createdAt,
    this.titleVersion = titleSchemaVersion,
  });

  factory TestSummary.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    return TestSummary(
      testId: doc.id,
      recruiterId: (d['recruiterId'] as String?) ?? '',
      title: (d['title'] as String?) ?? 'Interview',
      type: InterviewTypeX.fromWire(d['type'] as String?),
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
      titleVersion: (d['titleVersion'] as num?)?.toInt() ?? 0,
    );
  }

  /// Derives a summary from one of the test's interviews — used when creating a
  /// test and when backfilling tests that predate this collection.
  factory TestSummary.fromInterview(Interview i) => TestSummary(
        testId: i.testId.isNotEmpty ? i.testId : i.id,
        recruiterId: i.recruiterId,
        // Timeline assignments use `title` for their individual round. The
        // dashboard must always name the test/pipeline that owns that round.
        title: i.displayTestTitle,
        type: i.type,
        createdAt: i.createdAt,
      );

  /// Written with merge:true so re-running a backfill is harmless and never
  /// clobbers a `createdAt` that is already correct.
  Map<String, dynamic> toMap() => {
        'recruiterId': recruiterId,
        'title': title,
        'type': type.wire,
        'titleVersion': titleSchemaVersion,
        // Fall back to the server clock when the source interview had no
        // timestamp yet (a pending serverTimestamp write reads back null).
        'createdAt': createdAt != null
            ? Timestamp.fromDate(createdAt!)
            : FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      };
}

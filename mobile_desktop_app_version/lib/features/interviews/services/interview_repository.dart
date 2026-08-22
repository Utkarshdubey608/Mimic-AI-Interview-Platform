// lib/features/interviews/services/interview_repository.dart
//
// Firestore access for the `interviews` collection. Role-scoped queries:
//   - recruiters watch interviews they created (recruiterId == uid)
//   - candidates watch interviews assigned to them (candidateEmailLower == email)
// Security rules (firestore.rules) enforce the same scoping server-side.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/test_conclusion.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/models/test_summary.dart';

/// Owns all Firestore access for the `interviews` collection: CRUD plus the
/// recruiter/candidate query streams and the attempt/status/result mutations.
/// UI and controllers go through this repository — no widget touches Firestore
/// directly.
class InterviewRepository {
  InterviewRepository({FirebaseFirestore? firestore})
      : _db = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _db;

  CollectionReference<Map<String, dynamic>> get _col =>
      _db.collection('interviews');

  /// Per-batch metadata, one doc per `testId` (see [TestSummary]). Lets the
  /// dashboard page over tests instead of reading every interview to group them.
  CollectionReference<Map<String, dynamic>> get _tests =>
      _db.collection('tests');

  static String normalizeEmail(String email) => email.trim().toLowerCase();

  /// Creates a new assigned interview; returns the created id.
  Future<String> create(Interview interview) async {
    final ref = await _col.add(interview.toCreateMap());
    return ref.id;
  }

  // ── Paged reads ───────────────────────────────────────────────────────────
  //
  // `watchForRecruiter` below streams the recruiter's ENTIRE collection. That
  // is fine for the analytics dashboard (which must aggregate everything) but
  // does not scale for the candidate list: 1,000+ candidates means one huge
  // read and 1,000 widgets. The methods here fetch bounded pages instead, and
  // use Firestore's count() aggregate so the UI can still show TRUE totals
  // ("312 candidates") without downloading the rows to count them.

  /// Default candidates per page. Small enough to render instantly, large
  /// enough that a recruiter rarely pages more than once or twice.
  static const int defaultPageSize = 25;

  /// Fetches one page of the recruiter's interviews, newest first.
  ///
  /// Pass [startAfter] (the previous page's [PagedInterviews.lastDoc]) to get
  /// the next page. Optionally narrow to a single [testId], a single [roundId]
  /// within it, or to candidates whose email starts with [emailPrefix].
  ///
  /// Cursor is the document snapshot, not a `createdAt` value: `createdAt` is
  /// a server timestamp and reads back momentarily null on a just-created doc,
  /// which would make a value-based cursor skip or repeat rows.
  Future<PagedInterviews> fetchRecruiterPage({
    required String recruiterId,
    int limit = defaultPageSize,
    DocumentSnapshot<Map<String, dynamic>>? startAfter,
    String? testId,
    String? roundId,
    String? emailPrefix,
  }) async {
    if (recruiterId.isEmpty) return const PagedInterviews.empty();

    // The recruiterId equality must stay on every query: firestore.rules
    // grants recruiter reads via `resource.data.recruiterId == uid`, and
    // dropping it makes the query unprovable and fails with permission-denied.
    Query<Map<String, dynamic>> q =
        _col.where('recruiterId', isEqualTo: recruiterId);
    if (testId != null && testId.isNotEmpty) {
      q = q.where('testId', isEqualTo: testId);
    }
    // Omitting roundId returns EVERY round's assignments, which is what a
    // single-round test wants — its documents carry no roundId at all.
    if (roundId != null && roundId.isNotEmpty) {
      q = q.where('roundId', isEqualTo: roundId);
    }

    final prefix = emailPrefix?.trim().toLowerCase() ?? '';
    if (prefix.isEmpty) {
      q = q.orderBy('createdAt', descending: true);
    } else {
      // A range filter forces its field to be the first orderBy, so an email
      // search is ordered by email rather than recency. \uf8ff is the highest
      // code point Firestore sorts, making [prefix, prefix+\uf8ff) a
      // "starts-with" range.
      q = q
          .where('candidateEmailLower', isGreaterThanOrEqualTo: prefix)
          .where('candidateEmailLower', isLessThan: '$prefix\uf8ff')
          .orderBy('candidateEmailLower');
    }

    if (startAfter != null) q = q.startAfterDocument(startAfter);

    // Ask for one extra row: if it comes back there is another page, and we
    // learn that without a second round trip.
    final snap = await q.limit(limit + 1).get();
    final docs = snap.docs;
    final hasMore = docs.length > limit;
    final pageDocs = hasMore ? docs.sublist(0, limit) : docs;

    return PagedInterviews(
      items: _parseDocs(pageDocs),
      lastDoc: pageDocs.isEmpty ? null : pageDocs.last,
      hasMore: hasMore,
    );
  }

  /// Server-side count of the recruiter's interviews, optionally scoped to one
  /// [testId], one [roundId] and/or [status]. Uses Firestore's count()
  /// aggregate, which bills far less than reading the documents and does not
  /// transfer them, so the UI can show real totals while only holding a page in
  /// memory.
  Future<int> countForRecruiter({
    required String recruiterId,
    String? testId,
    String? roundId,
    InterviewStatus? status,
  }) async {
    if (recruiterId.isEmpty) return 0;
    try {
      Query<Map<String, dynamic>> q =
          _col.where('recruiterId', isEqualTo: recruiterId);
      if (testId != null && testId.isNotEmpty) {
        q = q.where('testId', isEqualTo: testId);
      }
      if (roundId != null && roundId.isNotEmpty) {
        q = q.where('roundId', isEqualTo: roundId);
      }
      if (status != null) {
        q = q.where('status', isEqualTo: status.wire);
      }
      final agg = await q.count().get();
      return agg.count ?? 0;
    } catch (e) {
      // A missing composite index or offline device must not break the list —
      // callers treat -1 as "unknown" and fall back to the loaded count.
      debugPrint('InterviewRepository.countForRecruiter failed: $e');
      return -1;
    }
  }

  /// One page of a round's candidates, best score first.
  ///
  /// Only SCORED candidates are ranked — an unscored candidate has no rank — so
  /// the number of rows here is smaller than the round's candidate count and the
  /// UI has to report the gap rather than looking complete.
  ///
  /// That exclusion is written as an explicit `>= 0` filter rather than left to
  /// Firestore's implicit "documents missing the orderBy field are skipped".
  /// Three reasons: the intent is visible to whoever reads this next, a `result`
  /// map carrying a null `overallScore` would otherwise be RANKED (null sorts,
  /// absent does not), and the implicit behaviour is not reproduced by
  /// fake_cloud_firestore, so relying on it would leave this untestable. Scores
  /// are 0-100, so the bound excludes nothing real, and an inequality on the same
  /// field it orders by needs no additional index.
  ///
  /// Pass a null/empty [roundId] to rank across the whole test, which is what a
  /// test with no timeline needs: its documents carry no roundId at all.
  Future<PagedInterviews> fetchLeaderboardPage({
    required String recruiterId,
    required String testId,
    String? roundId,
    int limit = defaultPageSize,
    DocumentSnapshot<Map<String, dynamic>>? startAfter,
  }) async {
    if (recruiterId.isEmpty || testId.isEmpty) {
      return const PagedInterviews.empty();
    }

    Query<Map<String, dynamic>> q = _col
        .where('recruiterId', isEqualTo: recruiterId)
        .where('testId', isEqualTo: testId);
    if (roundId != null && roundId.isNotEmpty) {
      q = q.where('roundId', isEqualTo: roundId);
    }
    // Dotted path = the nested field, which is where both the interview scorer
    // and the résumé scorer write. Must match the composite index in
    // firestore.indexes.json exactly.
    q = q
        .where('result.overallScore', isGreaterThanOrEqualTo: 0)
        .orderBy('result.overallScore', descending: true);

    if (startAfter != null) q = q.startAfterDocument(startAfter);

    final snap = await q.limit(limit + 1).get();
    final docs = snap.docs;
    final hasMore = docs.length > limit;
    final pageDocs = hasMore ? docs.sublist(0, limit) : docs;

    return PagedInterviews(
      items: _parseDocs(pageDocs),
      lastDoc: pageDocs.isEmpty ? null : pageDocs.last,
      hasMore: hasMore,
    );
  }

  /// Live list of interviews a recruiter created, newest first.
  ///
  /// UNBOUNDED — reads every matching document. Keep this for consumers that
  /// genuinely need the whole corpus (the analytics dashboard aggregates over
  /// it). List UIs should use [fetchRecruiterPage] instead.
  Stream<List<Interview>> watchForRecruiter(String recruiterId) {
    return _col
        .where('recruiterId', isEqualTo: recruiterId)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((s) => _parseDocs(s.docs));
  }

  /// Live list of interviews assigned to a candidate email, newest first.
  Stream<List<Interview>> watchForCandidate(String candidateEmail) {
    return _col
        .where('candidateEmailLower', isEqualTo: normalizeEmail(candidateEmail))
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map((s) => _parseDocs(s.docs));
  }

  /// Parses a snapshot's docs one at a time, dropping any single document that
  /// fails to parse. A malformed record therefore can't break the whole
  /// dashboard — the remaining valid interviews still render.
  List<Interview> _parseDocs(
      Iterable<QueryDocumentSnapshot<Map<String, dynamic>>> docs) {
    final out = <Interview>[];
    for (final doc in docs) {
      try {
        out.add(Interview.fromDoc(doc));
      } catch (e) {
        debugPrint('InterviewRepository: skipping bad doc ${doc.id}: $e');
      }
    }
    return out;
  }

  Future<Interview?> getById(String id) async {
    try {
      final doc = await _col.doc(id).get();
      return doc.exists ? Interview.fromDoc(doc) : null;
    } catch (e) {
      // Permission-denied or a malformed document should surface as "not
      // found" to the caller rather than leaking a raw Firestore/parse error.
      debugPrint('InterviewRepository.getById($id) failed: $e');
      return null;
    }
  }

  /// Updates the editable fields of an existing interview.
  Future<void> update(Interview interview) {
    return _col.doc(interview.id).update(interview.toUpdateMap());
  }

  Future<void> delete(String id) => _col.doc(id).delete();

  /// Records one more attempt (called when the candidate launches).
  Future<void> incrementAttempt(String id) {
    return _col.doc(id).update({
      'attemptsUsed': FieldValue.increment(1),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> updateStatus(String id, InterviewStatus status) {
    return _col.doc(id).update({
      'status': status.wire,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Marks an interview completed and stores an (unpublished) result. The
  /// candidate does not see it until the recruiter publishes.
  Future<void> completeWithResult(String id, Map<String, dynamic> result) {
    return _col.doc(id).update({
      'status': InterviewStatus.completed.wire,
      'result': result,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Marks an interview completed with NO score, recording why.
  ///
  /// The shape here is the whole point: there is no `overallScore` key at all.
  /// Writing 0 would put the candidate on the round leaderboard in last place as
  /// though they had earned it, and would read as a real result everywhere a
  /// score is displayed. Absent means absent.
  ///
  /// [responses] is what makes this recoverable — the candidate's raw answers,
  /// kept so the recruiter can retry scoring instead of asking them to sit the
  /// interview again. Without them the only route left is manual evaluation.
  Future<void> completeWithoutScore(
    String id, {
    String? error,
    List<Map<String, dynamic>> responses = const [],
    bool responsesApproximate = false,
    Map<String, dynamic>? integrity,
  }) {
    return _col.doc(id).update({
      'status': InterviewStatus.completed.wire,
      'result': {
        'summary': '',
        'recommendation': '',
        'strengths': const <String>[],
        'improvements': const <String>[],
        // Empty means "nothing scored this". Never 'ai'.
        'evaluatedBy': '',
        if (error != null && error.trim().isNotEmpty)
          'evaluationError': error.trim(),
        if (responses.isNotEmpty) 'responses': responses,
        if (responsesApproximate) 'responsesApproximate': true,
        if (integrity != null) 'integrity': integrity,
      },
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// The test's (or round's) candidates whose scoring can be retried.
  ///
  /// Reads the completed assignments and filters in memory: whether a result
  /// counts as retryable depends on `result.evaluatedBy` being empty AND
  /// `result.responses` being non-empty, and Firestore cannot express "this
  /// nested field is missing or empty" — an equality on '' would also miss every
  /// document written before the field existed.
  ///
  /// Bounded by how many candidates COMPLETED the round, and only paid when a
  /// recruiter explicitly asks to retry.
  Future<List<Interview>> fetchRetryableEvaluations({
    required String recruiterId,
    required String testId,
    String? roundId,
  }) async {
    if (recruiterId.isEmpty || testId.isEmpty) return const [];

    Query<Map<String, dynamic>> q = _col
        .where('recruiterId', isEqualTo: recruiterId)
        .where('testId', isEqualTo: testId)
        .where('status', isEqualTo: InterviewStatus.completed.wire);
    if (roundId != null && roundId.isNotEmpty) {
      q = q.where('roundId', isEqualTo: roundId);
    }

    final snap = await q.get();
    return _parseDocs(snap.docs)
        .where((i) => i.canRetryEvaluation)
        .toList();
  }

  /// Recruiter saves an edited/manual result (does not change publish state).
  Future<void> saveResult(String id, Map<String, dynamic> result) {
    return _col.doc(id).update({
      'result': result,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// The recruiter's own score for a live (two-way) interview.
  ///
  /// This track has no recording, so there is no transcript and no AI score — the
  /// human who ran the interview is the scorer. [stars] (0-5) is mapped onto the
  /// same 0-100 `overallScore` every other track writes, so a two-way round ranks
  /// on the leaderboard, feeds the shortlist and advances candidates without any
  /// of that machinery learning what a live interview is.
  ///
  /// [notes] are the recruiter's PRIVATE working notes. What the candidate sees
  /// is `result.candidateNote`, written separately when outcomes are published.
  ///
  /// Written with dotted paths so the review never clobbers an outcome, a rank
  /// or a note already recorded on this interview.
  Future<void> saveTwoWayReview(
    String id, {
    required int stars,
    String notes = '',
  }) {
    final clamped = stars.clamp(0, 5);
    return _col.doc(id).update({
      'result.overallScore': clamped * 20,
      'result.evaluatedBy': 'manual',
      // Clears "awaiting your review" — this IS the review.
      'result.awaitingRecruiterReview': false,
      'result.evaluationError': '',
      'result.twoWayReview': {
        'stars': clamped,
        'notes': notes.trim(),
        'reviewedAt': FieldValue.serverTimestamp(),
      },
      'status': InterviewStatus.completed.wire,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Records what the CANDIDATE will be told about this round.
  ///
  /// Written with DOTTED FIELD PATHS (`result.outcome`) rather than by replacing
  /// the `result` map. The map holds the recruiter's evaluation — score, summary,
  /// strengths, the raw answers — and a decision about the candidate must not
  /// destroy any of it.
  ///
  /// [publish] is what actually makes it visible; setting an outcome without
  /// publishing lets a recruiter decide the whole round first and release it in
  /// one go.
  Future<void> setOutcome(
    String id, {
    required RoundOutcome outcome,
    int? rank,
    int? rankOf,
    String? note,
    bool? publish,
  }) {
    return _col.doc(id).update({
      'result.outcome': outcome.wire,
      // null clears a rank that no longer applies — e.g. after a re-score moved
      // everyone around — rather than leaving a stale position on screen.
      'result.rank': rank,
      'result.rankOf': rankOf,
      if (note != null) 'result.candidateNote': note.trim(),
      if (publish != null) 'resultPublished': publish,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Records outcomes for a whole round at once: [selectedIds] move forward,
  /// everyone else in [ranked] does not.
  ///
  /// Ranks come from each candidate's position in [ranked] and are STAMPED here
  /// rather than computed when the candidate looks. A rank that recomputed itself
  /// would shift under them whenever anyone else was re-scored.
  ///
  /// Returns how many were written.
  Future<int> applyRoundOutcomes({
    required List<Interview> ranked,
    required Set<String> selectedIds,
    String? noteForSelected,
    String? noteForRejected,
    bool publish = true,
  }) async {
    if (ranked.isEmpty) return 0;

    const chunk = 400;
    for (var i = 0; i < ranked.length; i += chunk) {
      final end = (i + chunk < ranked.length) ? i + chunk : ranked.length;
      final batch = _db.batch();
      for (var j = i; j < end; j++) {
        final interview = ranked[j];
        final selected = selectedIds.contains(interview.id);
        final note = selected ? noteForSelected : noteForRejected;
        batch.update(_col.doc(interview.id), {
          'result.outcome': (selected
                  ? RoundOutcome.selected
                  : RoundOutcome.notSelected)
              .wire,
          'result.rank': j + 1,
          'result.rankOf': ranked.length,
          if (note != null && note.trim().isNotEmpty)
            'result.candidateNote': note.trim(),
          'resultPublished': publish,
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return ranked.length;
  }

  // ── The end of a candidate's run (see test_conclusion.dart) ───────────────
  //
  // A round outcome answers "did I get through this round". These two answer
  // "so what happened in the end", which for a multi-round test is the only
  // question the candidate has left once they have sat everything.
  //
  // Written onto EVERY assignment the candidate holds in the test, not just the
  // last one. Three reasons, in order of how badly the alternative fails:
  //
  //   1. The candidate's device may only read its own `interviews` documents. A
  //      conclusion stored on the test, or on one designated round, is either
  //      unreadable or requires them to know which round to look at.
  //   2. Their screen groups a job's rounds together and any of them can be the
  //      one they open. A conclusion on one row only is a conclusion they may
  //      never see.
  //   3. The recruiter's candidate list already loads assignments, so a
  //      per-round copy costs it no extra read to show who has been told.
  //
  // The cost is a handful of extra writes per candidate, once, at the very end
  // of a pipeline. That is the cheapest thing here.

  /// Releases [conclusion] to every candidate in [assignments].
  ///
  /// [assignments] is the FLATTENED list of documents to write — every round of
  /// every chosen candidate — so the caller decides who is included and this
  /// cannot accidentally reach a candidate they did not tick. Returns how many
  /// documents were written.
  ///
  /// Visible the instant it lands: there is no draft state (see
  /// `TestConclusion`), which is why the caller confirms before calling.
  Future<int> publishConclusion({
    required List<Interview> assignments,
    required TestConclusion conclusion,
  }) async {
    if (assignments.isEmpty) return 0;
    final payload = conclusion.toMap();

    // Firestore hard-caps a batch at 500 writes; stay well under, as every other
    // batched write in this file does.
    const chunk = 400;
    for (var i = 0; i < assignments.length; i += chunk) {
      final end = (i + chunk < assignments.length) ? i + chunk : assignments.length;
      final batch = _db.batch();
      for (final interview in assignments.sublist(i, end)) {
        batch.update(_col.doc(interview.id), {
          'conclusion': payload,
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return assignments.length;
  }

  /// Withdraws a published conclusion from every document in [assignments].
  ///
  /// The undo for a decision released to the wrong people, or released early.
  /// Deletes the field rather than writing an "on hold" one: an unsent
  /// conclusion and a conclusion saying "we are still deciding" are different
  /// messages, and only the recruiter knows which they meant.
  ///
  /// It cannot un-send an email, and cannot un-read what somebody already saw —
  /// callers say so.
  Future<int> clearConclusion(List<Interview> assignments) async {
    if (assignments.isEmpty) return 0;
    const chunk = 400;
    for (var i = 0; i < assignments.length; i += chunk) {
      final end = (i + chunk < assignments.length) ? i + chunk : assignments.length;
      final batch = _db.batch();
      for (final interview in assignments.sublist(i, end)) {
        batch.update(_col.doc(interview.id), {
          'conclusion': FieldValue.delete(),
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return assignments.length;
  }

  /// Every assignment of one test, unpaged.
  ///
  /// The cost this file otherwise works hard to avoid, and taken deliberately:
  /// deciding how a candidate's RUN ended needs all of their rounds at once, and
  /// a page boundary can fall in the middle of one. Paid once, when a recruiter
  /// opens the conclusion screen for a single test.
  ///
  /// Ownership is on the query, so a stale testId can never reach another
  /// recruiter's data.
  Future<List<Interview>> fetchTestAssignments({
    required String testId,
    required String recruiterId,
  }) async {
    if (testId.isEmpty || recruiterId.isEmpty) return const [];
    final snap = await _col
        .where('recruiterId', isEqualTo: recruiterId)
        .where('testId', isEqualTo: testId)
        .get();
    return _parseDocs(snap.docs);
  }

  /// Show/hide a single candidate's result.
  Future<void> setPublished(String id, bool published) {
    return _col.doc(id).update({
      'resultPublished': published,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }


  // ── Reports (the rich half of a scored interview) ─────────────────────────
  //
  // `reports/{interviewId}`. SHARED with the web client, and deliberately separate
  // from `interviews/{id}.result`:
  //
  //   result   the FLAT summary — score, recommendation, summary, strengths. What
  //            every list, chip and leaderboard reads, so it stays on the assignment.
  //   report   the per-question breakdown, KPI averages and provenance. Too large for
  //            the assignment document and only read when someone opens a full report.
  //
  // It used to be squeezed into `result.detail`, in a shape that disagreed with the
  // one the WEB surface wrote to the same field name — and nothing read either. See
  // `backend/app/reports.py`.

  CollectionReference<Map<String, dynamic>> get _reports =>
      _db.collection('reports');

  /// The scored report for [interviewId], or null.
  ///
  /// Null rather than an exception for a missing one: an interview scored before
  /// reports were shared has none, and so does one whose detail write failed. The
  /// score itself is on the assignment either way, so the caller shows what it has
  /// rather than an error.
  Future<Map<String, dynamic>?> fetchReport(String interviewId) async {
    if (interviewId.isEmpty) return null;
    try {
      final doc = await _reports.doc(interviewId).get();
      return doc.exists ? doc.data() : null;
    } catch (e) {
      debugPrint('InterviewRepository.fetchReport($interviewId) failed: $e');
      return null;
    }
  }

  /// The per-question breakdown from a report document, defensively parsed.
  ///
  /// Written by a language model on the server, so every field is treated as
  /// possibly-absent: a partial write must render as a short list, never throw inside
  /// a ListView builder. Same rule as [_parseDocs].
  static List<({String question, int? score, String feedback})> perQuestionOf(
    Map<String, dynamic>? report,
  ) {
    final raw = report?['perQuestion'];
    if (raw is! List) return const [];
    final out = <({String question, int? score, String feedback})>[];
    for (final entry in raw) {
      if (entry is! Map) continue;
      final question = (entry['question'] as String?)?.trim() ?? '';
      if (question.isEmpty) continue;
      out.add((
        question: question,
        score: (entry['score'] as num?)?.toInt(),
        feedback: (entry['feedback'] as String?)?.trim() ?? '',
      ));
    }
    return out;
  }

  // ── Tests (batch metadata) ────────────────────────────────────────────────

  /// Records/updates the metadata doc for a test. Called when a test is created
  /// or edited, and by [backfillTests]. merge:true keeps this idempotent.
  Future<void> upsertTest(TestSummary test) {
    if (test.testId.isEmpty) return Future.value();
    return _tests.doc(test.testId).set(test.toMap(), SetOptions(merge: true));
  }

  /// One page of the recruiter's tests, newest first.
  Future<PagedTests> fetchTestsPage({
    required String recruiterId,
    int limit = 20,
    DocumentSnapshot<Map<String, dynamic>>? startAfter,
  }) async {
    if (recruiterId.isEmpty) return const PagedTests.empty();
    Query<Map<String, dynamic>> q = _tests
        .where('recruiterId', isEqualTo: recruiterId)
        .orderBy('createdAt', descending: true);
    if (startAfter != null) q = q.startAfterDocument(startAfter);

    final snap = await q.limit(limit + 1).get();
    final docs = snap.docs;
    final hasMore = docs.length > limit;
    final pageDocs = hasMore ? docs.sublist(0, limit) : docs;

    final out = <TestSummary>[];
    for (final d in pageDocs) {
      try {
        out.add(TestSummary.fromDoc(d));
      } catch (e) {
        debugPrint('InterviewRepository: skipping bad test doc ${d.id}: $e');
      }
    }
    return PagedTests(
      items: out,
      lastDoc: pageDocs.isEmpty ? null : pageDocs.last,
      hasMore: hasMore,
    );
  }

  /// Creates the `tests` metadata docs for a recruiter's pre-existing
  /// interviews — the one-off migration for tests created before this
  /// collection existed.
  ///
  /// Reads every interview for the recruiter ONCE (the very cost this
  /// collection exists to avoid, paid a single time), derives one summary per
  /// distinct `testId`, and batch-writes them. Fully idempotent thanks to
  /// merge:true, so a repeat run is harmless and it doubles as a "rebuild the
  /// test index" repair action. Returns how many test docs were written.
  Future<int> backfillTests(String recruiterId) async {
    if (recruiterId.isEmpty) return 0;
    final snap =
        await _col.where('recruiterId', isEqualTo: recruiterId).get();

    // Keep the newest interview per test: its title/type/createdAt is the most
    // representative for the batch.
    final byTest = <String, Interview>{};
    for (final doc in snap.docs) {
      Interview i;
      try {
        i = Interview.fromDoc(doc);
      } catch (e) {
        debugPrint('backfillTests: skipping bad doc ${doc.id}: $e');
        continue;
      }
      final key = i.testId.isNotEmpty ? i.testId : i.id;
      final existing = byTest[key];
      if (existing == null ||
          (i.createdAt != null &&
              (existing.createdAt == null ||
                  i.createdAt!.isAfter(existing.createdAt!)))) {
        byTest[key] = i;
      }
    }
    if (byTest.isEmpty) return 0;

    // Firestore caps a batch at 500 writes; stay well under.
    const chunk = 400;
    final summaries =
        byTest.values.map(TestSummary.fromInterview).toList(growable: false);
    for (var i = 0; i < summaries.length; i += chunk) {
      final end =
          (i + chunk < summaries.length) ? i + chunk : summaries.length;
      final batch = _db.batch();
      for (final t in summaries.sublist(i, end)) {
        batch.set(_tests.doc(t.testId), t.toMap(), SetOptions(merge: true));
      }
      await batch.commit();
    }
    debugPrint('backfillTests: wrote ${summaries.length} test doc(s)');
    return summaries.length;
  }

  /// Clears one candidate's RESPONSE while keeping them assigned to the test:
  /// drops the stored result, un-publishes it, and resets the status so they can
  /// take it again. Distinct from [delete], which removes the assignment
  /// entirely.
  Future<void> clearResult(String id) {
    return _col.doc(id).update({
      'result': FieldValue.delete(),
      'resultPublished': false,
      'status': InterviewStatus.assigned.wire,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Deletes an ENTIRE test: every candidate assignment/response belonging to
  /// [testId], plus the test's own metadata doc. Irreversible.
  ///
  /// Returns how many candidate documents were removed. Ownership is verified
  /// against [recruiterId] on the query, so this can never reach another
  /// recruiter's data even if a stale testId is passed.
  Future<int> deleteTest(String testId, String recruiterId) async {
    if (testId.isEmpty || recruiterId.isEmpty) return 0;

    final q = await _col
        .where('recruiterId', isEqualTo: recruiterId)
        .where('testId', isEqualTo: testId)
        .get();

    // References, not snapshots: a snapshot from `doc().get()` is a
    // DocumentSnapshot, NOT a QueryDocumentSnapshot, so collecting snapshots
    // forced an unsafe downcast on the legacy path below that threw at runtime.
    final refs = q.docs.map((d) => d.reference).toList();

    // Tests created before `testId` was populated group under the interview's
    // OWN id, so that document would not match the query above. Include it, but
    // only after confirming it belongs to this recruiter.
    if (refs.every((r) => r.id != testId)) {
      try {
        final legacy = await _col.doc(testId).get();
        if (legacy.exists && legacy.data()?['recruiterId'] == recruiterId) {
          refs.add(legacy.reference);
        }
      } on FirebaseException catch (e) {
        // EXPECTED for every test created since `testId` existed: there is no
        // interview document at that id, and `firestore.rules` gates reads on
        // `resource.data.recruiterId` — which cannot be evaluated for a missing
        // document, so Firestore answers PERMISSION_DENIED rather than handing
        // back a snapshot with `exists == false`.
        //
        // Letting that propagate aborted the whole delete before a single batch
        // was committed, so "delete test" failed and left everything in place.
        // Absence of a legacy document is not an error.
        debugPrint('deleteTest: no legacy doc at $testId (${e.code})');
      }
    }

    // Firestore hard-caps a batch at 500 writes; stay well under and commit
    // chunk by chunk.
    const chunk = 400;
    for (var i = 0; i < refs.length; i += chunk) {
      final end = (i + chunk < refs.length) ? i + chunk : refs.length;
      final batch = _db.batch();
      for (final ref in refs.sublist(i, end)) {
        batch.delete(ref);
      }
      await batch.commit();
    }

    // Remove the metadata doc last: if anything above fails, the test still
    // shows on the dashboard rather than leaving orphaned candidate rows that
    // nothing links to.
    try {
      await _tests.doc(testId).delete();
    } catch (e) {
      debugPrint('deleteTest: metadata doc cleanup failed for $testId: $e');
    }
    return refs.length;
  }

  /// "End test" — publish results for every candidate of [testId] owned by
  /// [recruiterId], in one batch.
  Future<void> publishTest(String testId, String recruiterId) async {
    final q = await _col
        .where('recruiterId', isEqualTo: recruiterId)
        .where('testId', isEqualTo: testId)
        .get();

    // Only publish candidates who actually took the test: a completed status
    // with a stored result. Untaken/incomplete assignments are left untouched
    // so they aren't wrongly marked published.
    final publishable = q.docs.where((doc) {
      final d = doc.data();
      return d['status'] == InterviewStatus.completed.wire &&
          d['result'] != null;
    }).toList();

    // Firestore hard-caps a batch at 500 writes; chunk well under that and
    // commit each chunk sequentially.
    const int chunkSize = 450;
    for (var i = 0; i < publishable.length; i += chunkSize) {
      final end = (i + chunkSize < publishable.length)
          ? i + chunkSize
          : publishable.length;
      final batch = _db.batch();
      for (final doc in publishable.sublist(i, end)) {
        batch.update(doc.reference, {
          'resultPublished': true,
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
  }

  // ── Rounds (the custom timeline) ──────────────────────────────────────────
  //
  // `tests/{testId}/rounds/{roundId}`. A subcollection rather than a top-level
  // collection: a round is never read outside its test, and nesting keeps the
  // security rule to a single recruiterId check.
  //
  // Round state (scheduled/open/closed) is DERIVED from the clock — see
  // `InterviewRound.stateAt` — so nothing here writes a status field and nothing
  // can go stale. What these methods DO have to keep in step is the candidate's
  // copy of the window: `availableFrom`/`expiresAt` on each assignment were
  // copied from the round when it was assigned, and the candidate's device gates
  // on those (it has no permission to read round documents). Every method that
  // moves a round's window therefore calls [_propagateWindow].

  CollectionReference<Map<String, dynamic>> _roundsOf(String testId) =>
      _tests.doc(testId).collection('rounds');

  /// Creates a round; returns its new id.
  Future<String> createRound(InterviewRound round) async {
    final ref = await _roundsOf(round.testId).add(round.toCreateMap());
    return ref.id;
  }

  Future<InterviewRound?> getRound(String testId, String roundId) async {
    if (testId.isEmpty || roundId.isEmpty) return null;
    try {
      final doc = await _roundsOf(testId).doc(roundId).get();
      return doc.exists ? InterviewRound.fromDoc(doc, testId: testId) : null;
    } catch (e) {
      debugPrint('InterviewRepository.getRound($testId/$roundId) failed: $e');
      return null;
    }
  }

  /// The test's timeline, in running order.
  ///
  /// [recruiterId] is REQUIRED even though the path already scopes to one test.
  /// `firestore.rules` grants round reads via `resource.data.recruiterId ==
  /// uid`, and a LIST query must be provable from its own constraints — Firestore
  /// will not fetch documents to discover whether the rule would have allowed
  /// them. Without this equality the query is unprovable and comes back
  /// PERMISSION_DENIED, which is the same trap [fetchRecruiterPage] documents.
  /// (A single-document read like [getRound] is fine: there, `resource.data` is
  /// the document being read.)
  Future<List<InterviewRound>> fetchRounds({
    required String testId,
    required String recruiterId,
  }) async {
    if (testId.isEmpty || recruiterId.isEmpty) return const [];
    final snap = await _roundsQuery(testId, recruiterId).get();
    return _parseRounds(snap.docs, testId);
  }

  /// Live timeline — what the recruiter's round editor watches, so an "End round
  /// now" from another device is reflected without a manual refresh.
  ///
  /// See [fetchRounds] for why [recruiterId] is not optional.
  Stream<List<InterviewRound>> watchRounds({
    required String testId,
    required String recruiterId,
  }) {
    if (testId.isEmpty || recruiterId.isEmpty) return Stream.value(const []);
    return _roundsQuery(testId, recruiterId)
        .snapshots()
        .map((s) => _parseRounds(s.docs, testId));
  }

  /// The one shape both listing methods use, so the rules-provability filter
  /// cannot be present on one and forgotten on the other.
  Query<Map<String, dynamic>> _roundsQuery(String testId, String recruiterId) =>
      _roundsOf(testId)
          .where('recruiterId', isEqualTo: recruiterId)
          .orderBy('order');

  /// Same one-bad-doc-can't-break-the-list handling as [_parseDocs].
  List<InterviewRound> _parseRounds(
    Iterable<QueryDocumentSnapshot<Map<String, dynamic>>> docs,
    String testId,
  ) {
    final out = <InterviewRound>[];
    for (final doc in docs) {
      try {
        out.add(InterviewRound.fromDoc(doc, testId: testId));
      } catch (e) {
        debugPrint('InterviewRepository: skipping bad round ${doc.id}: $e');
      }
    }
    return out;
  }

  /// Saves an edited round, and pushes the window onto its candidates if the
  /// recruiter moved it.
  ///
  /// The previous document is read first purely to make that decision: without
  /// it, either every edit rewrites every assignment (a thousand writes to fix a
  /// typo in a title) or the caller has to remember to say the dates changed,
  /// which is exactly the kind of thing a caller eventually forgets.
  Future<void> updateRound(InterviewRound round) async {
    final ref = _roundsOf(round.testId).doc(round.id);
    final before = await ref.get();
    await ref.update(round.toUpdateMap());

    final prev = before.exists
        ? InterviewRound.fromDoc(before, testId: round.testId)
        : null;
    final windowMoved = prev == null ||
        prev.opensAt != round.opensAt ||
        prev.closesAt != round.closesAt;
    if (windowMoved) {
      await _propagateWindow(
        recruiterId: round.recruiterId,
        testId: round.testId,
        roundId: round.id,
        availableFrom: round.opensAt,
        expiresAt: round.closesAt,
      );
    }
  }

  /// "End round now" — closes a round ahead of its deadline.
  ///
  /// Writing `closedAt` alone would NOT lock candidates out: their assignment
  /// still carries the original `expiresAt`, and that is the only thing their
  /// device checks. So the same instant is stamped onto every unfinished
  /// assignment in the round, which is what actually ends it.
  Future<void> endRound(InterviewRound round) async {
    await _roundsOf(round.testId).doc(round.id).update({
      'closedAt': FieldValue.serverTimestamp(),
      'closedBy': RoundClosedBy.manual.wire,
      'updatedAt': FieldValue.serverTimestamp(),
    });
    await _propagateWindow(
      recruiterId: round.recruiterId,
      testId: round.testId,
      roundId: round.id,
      availableFrom: round.opensAt,
      // serverTimestamp rather than DateTime.now(): the device clock is the one
      // thing a candidate can trivially change, and this value is what locks
      // them out.
      expiresAt: FieldValue.serverTimestamp(),
    );
  }

  /// Copies a round's window onto its candidates' assignments.
  ///
  /// [expiresAt] is `dynamic` so callers can pass either a concrete `DateTime`
  /// (a scheduled deadline) or `FieldValue.serverTimestamp()` (ending now).
  /// Completed assignments are skipped — the interview is already over, and at a
  /// thousand candidates those are the majority of the writes.
  Future<int> _propagateWindow({
    required String recruiterId,
    required String testId,
    required String roundId,
    required DateTime? availableFrom,
    required dynamic expiresAt,
  }) async {
    if (recruiterId.isEmpty || testId.isEmpty || roundId.isEmpty) return 0;

    final q = await _col
        .where('recruiterId', isEqualTo: recruiterId)
        .where('testId', isEqualTo: testId)
        .where('roundId', isEqualTo: roundId)
        .get();

    final refs = q.docs
        .where((d) => d.data()['status'] != InterviewStatus.completed.wire)
        .map((d) => d.reference)
        .toList();
    if (refs.isEmpty) return 0;

    final payload = {
      'availableFrom':
          availableFrom == null ? null : Timestamp.fromDate(availableFrom),
      'expiresAt': expiresAt is DateTime
          ? Timestamp.fromDate(expiresAt)
          : expiresAt, // null or a FieldValue
      'updatedAt': FieldValue.serverTimestamp(),
    };

    // Firestore hard-caps a batch at 500 writes; stay well under.
    const chunk = 400;
    for (var i = 0; i < refs.length; i += chunk) {
      final end = (i + chunk < refs.length) ? i + chunk : refs.length;
      final batch = _db.batch();
      for (final ref in refs.sublist(i, end)) {
        batch.update(ref, payload);
      }
      await batch.commit();
    }
    return refs.length;
  }

  /// Deletes a round AND every assignment belonging to it. Irreversible.
  ///
  /// Returns how many candidate assignments were removed. Deleting the round
  /// document alone would strand those assignments: they carry a `roundId`
  /// pointing at nothing, so they would vanish from every round-scoped view
  /// while still being served to the candidate.
  Future<int> deleteRound(InterviewRound round) async {
    if (round.testId.isEmpty || round.id.isEmpty) return 0;

    // recruiterId is on the query, so a stale round object can never reach
    // another recruiter's assignments.
    final q = await _col
        .where('recruiterId', isEqualTo: round.recruiterId)
        .where('testId', isEqualTo: round.testId)
        .where('roundId', isEqualTo: round.id)
        .get();

    final refs = q.docs.map((d) => d.reference).toList();
    const chunk = 400;
    for (var i = 0; i < refs.length; i += chunk) {
      final end = (i + chunk < refs.length) ? i + chunk : refs.length;
      final batch = _db.batch();
      for (final ref in refs.sublist(i, end)) {
        batch.delete(ref);
      }
      await batch.commit();
    }

    // The round document goes last: if anything above fails the round still
    // shows in the timeline, rather than leaving assignments nothing links to.
    await _roundsOf(round.testId).doc(round.id).delete();
    return refs.length;
  }

  /// Every distinct candidate across a test, as `emailLower → display name`.
  ///
  /// Reads the test's assignments once. That is the cost this file otherwise
  /// works hard to avoid, but a recruiter adding a round has to be offered the
  /// people already in the pipeline, and there is nowhere cheaper to get them:
  /// candidates are not listed on the test document (deliberately — see
  /// `test_summary.dart`). Paid once per assign action, on one test.
  Future<Map<String, String?>> fetchTestCandidates({
    required String testId,
    required String recruiterId,
  }) async {
    if (testId.isEmpty || recruiterId.isEmpty) return {};
    final snap = await _col
        .where('recruiterId', isEqualTo: recruiterId)
        .where('testId', isEqualTo: testId)
        .get();

    final out = <String, String?>{};
    for (final doc in snap.docs) {
      final d = doc.data();
      final email = (d['candidateEmailLower'] as String?) ??
          (d['candidateEmail'] as String?)?.trim().toLowerCase();
      if (email == null || email.isEmpty) continue;
      // First non-empty name wins; a later round may have been created without
      // one and must not blank out a name an earlier round has.
      final name = (d['candidateName'] as String?)?.trim();
      if (out[email] == null && name != null && name.isNotEmpty) {
        out[email] = name;
      } else {
        out.putIfAbsent(email, () => null);
      }
    }
    return out;
  }

  /// How many of a test's assignments predate its timeline — i.e. carry no
  /// `roundId`. Non-zero means the test was created as a single round and given
  /// rounds afterwards.
  Future<int> countLegacyAssignments({
    required String testId,
    required String recruiterId,
  }) async {
    final docs = await _legacyAssignments(testId: testId, recruiterId: recruiterId);
    return docs.length;
  }

  /// Moves a test's round-LESS assignments into [round], in place.
  ///
  /// This is the repair for "assign a single-round test, then add rounds". Those
  /// original assignments belong to no round, so:
  ///   * `assignCandidatesToRound` cannot recognise their owners as already
  ///     assigned and creates a SECOND document per candidate — the same test
  ///     appears twice on the candidate's screen, both launchable;
  ///   * they never show in a round leaderboard, "end round" never closes them,
  ///     and notifying a round never covers them.
  ///
  /// Adopting rather than deleting-and-recreating is deliberate: these documents
  /// may already hold a completed interview, a transcript and a score. Recreating
  /// would throw that away.
  ///
  /// The round's window is applied too, so an adopted candidate is governed by
  /// the round they are now in. Returns how many were adopted.
  Future<int> adoptLegacyAssignments(InterviewRound round) async {
    final docs = await _legacyAssignments(
        testId: round.testId, recruiterId: round.recruiterId);
    if (docs.isEmpty) return 0;

    const chunk = 400;
    for (var i = 0; i < docs.length; i += chunk) {
      final end = (i + chunk < docs.length) ? i + chunk : docs.length;
      final batch = _db.batch();
      for (final doc in docs.sublist(i, end)) {
        batch.update(doc.reference, {
          'roundId': round.id,
          'roundOrder': round.order,
          'roundKind': round.kind.wire,
          'availableFrom': round.opensAt == null
              ? null
              : Timestamp.fromDate(round.opensAt!),
          'expiresAt': round.closesAt == null
              ? null
              : Timestamp.fromDate(round.closesAt!),
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return docs.length;
  }

  /// The test's assignments that carry no `roundId`.
  ///
  /// Filtered client-side rather than with `where('roundId', isNull: true)`:
  /// pre-timeline documents do not have the field at all, and Firestore cannot
  /// query for an ABSENT field — an equality on null matches only documents that
  /// explicitly store null, which is none of them.
  Future<List<QueryDocumentSnapshot<Map<String, dynamic>>>> _legacyAssignments({
    required String testId,
    required String recruiterId,
  }) async {
    if (testId.isEmpty || recruiterId.isEmpty) return const [];
    final snap = await _col
        .where('recruiterId', isEqualTo: recruiterId)
        .where('testId', isEqualTo: testId)
        .get();
    return snap.docs.where((d) {
      final rid = d.data()['roundId'];
      return rid == null || (rid is String && rid.isEmpty);
    }).toList();
  }

  /// Assigns [candidates] (`emailLower → name`) to [round], skipping anyone
  /// already in it. Returns how many assignments were created.
  ///
  /// Skipping rather than overwriting is what makes this safe to press twice: a
  /// re-assign after adding two more people to the pipeline must not reset the
  /// status or wipe the result of the fifty who already took the round.
  Future<int> assignCandidatesToRound({
    required InterviewRound round,
    required String recruiterEmail,
    String? recruiterName,
    required String testTitle,
    required Map<String, String?> candidates,
  }) async {
    if (candidates.isEmpty || round.testId.isEmpty || round.id.isEmpty) return 0;

    final existing = await _col
        .where('recruiterId', isEqualTo: round.recruiterId)
        .where('testId', isEqualTo: round.testId)
        .where('roundId', isEqualTo: round.id)
        .get();
    final already = existing.docs
        .map((d) => (d.data()['candidateEmailLower'] as String?) ?? '')
        .where((e) => e.isNotEmpty)
        .toSet();

    final pending = candidates.keys.where((e) => !already.contains(e)).toList();

    const chunk = 400;
    for (var i = 0; i < pending.length; i += chunk) {
      final end = (i + chunk < pending.length) ? i + chunk : pending.length;
      final batch = _db.batch();
      for (final email in pending.sublist(i, end)) {
        final interview = round.assignTo(
          candidateEmail: email,
          candidateName: candidates[email],
          recruiterEmail: recruiterEmail,
          recruiterName: recruiterName,
          testTitle: testTitle,
        );
        batch.set(_col.doc(), interview.toCreateMap());
      }
      await batch.commit();
    }

    // Putting somebody INTO a round says they got through the ones before it.
    // Runs for everyone named, not just the new assignments: pressing assign a
    // second time must still settle a candidate whose earlier round was left
    // undecided. Idempotent, and never overwrites a decision.
    await clearEarlierRoundsFor(round: round, emailsLower: candidates.keys);

    return pending.length;
  }

  /// Marks a candidate's earlier rounds as cleared, for everyone in
  /// [emailsLower], on being put into [round].
  ///
  /// Advancing somebody IS the statement that they got through what came before —
  /// there is no other reason to put them in a later round. Without this the
  /// outcome field was simply never written on the earlier assignment, and
  /// `RoundOutcome` defaults to `pending`, so a candidate sitting in round 2 went
  /// on reading "Under review" against round 1 for ever.
  ///
  /// Only writes where there is nothing to lose. The earlier assignment must be
  /// COMPLETED and carry no outcome of its own, so a recruiter who marked
  /// somebody "not moving forward" and then bulk-added everybody to a round does
  /// not have that decision silently rewritten — and a round the candidate has
  /// not finished is left alone, because they have not cleared it.
  ///
  /// `resultPublished` is set with it, because an outcome nobody can see does not
  /// fix the screen this exists for. That releases only the outcome, the rank and
  /// the recruiter's note — never the score or the AI write-up, which are not on
  /// the candidate's result screen at all (see `candidate_result_page.dart`).
  ///
  /// Returns how many assignments were settled.
  Future<int> clearEarlierRoundsFor({
    required InterviewRound round,
    required Iterable<String> emailsLower,
  }) async {
    // Round 1 has nothing before it, and a test with no timeline has one
    // implicit round.
    if (round.order <= 0 || round.testId.isEmpty || round.recruiterId.isEmpty) {
      return 0;
    }
    final wanted = emailsLower
        .map((e) => e.trim().toLowerCase())
        .where((e) => e.isNotEmpty)
        .toSet();
    if (wanted.isEmpty) return 0;

    final snap = await _col
        .where('recruiterId', isEqualTo: round.recruiterId)
        .where('testId', isEqualTo: round.testId)
        .get();

    final refs = <DocumentReference<Map<String, dynamic>>>[];
    for (final doc in snap.docs) {
      final interview = Interview.fromDoc(doc);
      if (!wanted.contains(interview.candidateEmailLower)) continue;
      if (interview.effectiveRoundOrder >= round.order) continue;
      if (interview.status != InterviewStatus.completed) continue;
      if (interview.hasOutcome) continue;
      refs.add(doc.reference);
    }
    if (refs.isEmpty) return 0;

    const chunk = 400;
    for (var i = 0; i < refs.length; i += chunk) {
      final end = (i + chunk < refs.length) ? i + chunk : refs.length;
      final batch = _db.batch();
      for (final ref in refs.sublist(i, end)) {
        // A dotted path, so the recruiter's evaluation in the same map survives.
        batch.update(ref, {
          'result.outcome': RoundOutcome.selected.wire,
          'resultPublished': true,
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return refs.length;
  }

  /// Rewrites the timeline order to match [orderedRoundIds] (index = new order).
  ///
  /// Also rewrites `roundOrder` on the affected assignments. That field is a
  /// denormalised copy, kept because the candidate's device needs to show
  /// "Round 2 of 4" and cannot read round documents to work it out. A copy that
  /// is never refreshed is worse than no copy, so reordering pays for it here.
  Future<void> reorderRounds({
    required String testId,
    required String recruiterId,
    required List<String> orderedRoundIds,
  }) async {
    if (testId.isEmpty || orderedRoundIds.isEmpty) return;

    final batch = _db.batch();
    for (var i = 0; i < orderedRoundIds.length; i++) {
      batch.update(_roundsOf(testId).doc(orderedRoundIds[i]), {
        'order': i,
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    if (recruiterId.isEmpty) return;
    final q = await _col
        .where('recruiterId', isEqualTo: recruiterId)
        .where('testId', isEqualTo: testId)
        .get();

    // One pass over the test's assignments, skipping any whose stored order is
    // already right — a reorder usually moves two rounds, not all of them.
    final updates = <DocumentReference<Map<String, dynamic>>, int>{};
    for (final doc in q.docs) {
      final rid = doc.data()['roundId'] as String?;
      if (rid == null || rid.isEmpty) continue;
      final newOrder = orderedRoundIds.indexOf(rid);
      if (newOrder < 0) continue;
      if ((doc.data()['roundOrder'] as num?)?.toInt() == newOrder) continue;
      updates[doc.reference] = newOrder;
    }
    if (updates.isEmpty) return;

    const chunk = 400;
    final entries = updates.entries.toList();
    for (var i = 0; i < entries.length; i += chunk) {
      final end = (i + chunk < entries.length) ? i + chunk : entries.length;
      final b = _db.batch();
      for (final e in entries.sublist(i, end)) {
        b.update(e.key, {
          'roundOrder': e.value,
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }
      await b.commit();
    }
  }
}

/// One page of interviews plus the cursor needed to fetch the next.
class PagedInterviews {
  final List<Interview> items;

  /// Cursor for the next page — pass as `startAfter`. Null when the page is
  /// empty.
  final DocumentSnapshot<Map<String, dynamic>>? lastDoc;

  /// Whether at least one more document exists after this page.
  final bool hasMore;

  const PagedInterviews({
    required this.items,
    required this.lastDoc,
    required this.hasMore,
  });

  const PagedInterviews.empty()
      : items = const [],
        lastDoc = null,
        hasMore = false;
}

/// One page of test summaries plus the cursor for the next.
class PagedTests {
  final List<TestSummary> items;
  final DocumentSnapshot<Map<String, dynamic>>? lastDoc;
  final bool hasMore;

  const PagedTests({
    required this.items,
    required this.lastDoc,
    required this.hasMore,
  });

  const PagedTests.empty()
      : items = const [],
        lastDoc = null,
        hasMore = false;
}

// lib/features/interviews/candidate/practice/practice_store.dart
//
// A candidate's own practice history, on the server rather than on the device.
//
// It lived in the SharedPreferences blob (`AppStore._interviewResults`), which meant it
// was not really their history at all: it did not survive reinstalling the app, did not
// follow them to a second phone, and was invisible from the web entirely. A candidate's
// own record of their own work should not be a device artifact — the FEATURE is
// platform-specific (there is no web practice tab, and none is needed), but the DATA is
// theirs.
//
// `practice_sessions/{uid}/runs/{runId}`. A subcollection under the uid rather than a
// top-level collection with a `uid` field, because it makes the security rule one
// comparison — `request.auth.uid == uid` — instead of a field check on every document.
//
// Written by the CLIENT, unlike an interview score. That is safe here and deliberate:
// practice is self-serve rehearsal, nothing gates on it, and no recruiter ever reads
// it. An assigned interview's score is the opposite on all three counts, which is why
// that one is written by the server with the Admin SDK.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import 'package:talbotiq/shared/models/app_models.dart';

class PracticeStore {
  PracticeStore({FirebaseFirestore? firestore, String? uid})
      : _injectedDb = firestore,
        _injectedUid = uid;

  final FirebaseFirestore? _injectedDb;

  /// Overrides whose history this is. Exists so a test needs no Firebase Auth at all —
  /// the store needs a UID, not an auth object, and taking the narrower dependency is
  /// both easier to test and honester about what it uses.
  final String? _injectedUid;

  FirebaseFirestore get _db => _injectedDb ?? FirebaseFirestore.instance;

  static const String collectionName = 'practice_sessions';
  static const String runsSubcollection = 'runs';

  /// How many runs a history page shows. A rehearsal log, not an archive.
  static const int pageSize = 50;
  /// Resolved lazily, never in the constructor: reaching for `FirebaseAuth.instance`
  /// eagerly would throw wherever Firebase is not initialised, including in tests that
  /// inject a uid and never need it.
  String? get _uid {
    if (_injectedUid != null) return _injectedUid.isEmpty ? null : _injectedUid;
    return FirebaseAuth.instance.currentUser?.uid;
  }

  CollectionReference<Map<String, dynamic>>? get _runs {
    final uid = _uid;
    if (uid == null) return null;
    return _db.collection(collectionName).doc(uid).collection(runsSubcollection);
  }

  /// Records one practice run. Best-effort.
  ///
  /// Never throws: the candidate has just finished practising and the result is already
  /// on screen. Failing to file it is worth a log, not an error in front of somebody
  /// who did nothing wrong.
  Future<void> save(InterviewResult result) async {
    final runs = _runs;
    if (runs == null) return;
    // ONLY practice. An assigned interview's result belongs on its `interviews`
    // document, written by the server — putting a copy here would be a second source
    // of truth for a score, and one the candidate could edit.
    if (!result.isPractice) return;
    try {
      await runs.doc(result.id).set(result.toJson(), SetOptions(merge: true));
    } catch (e) {
      debugPrint('PracticeStore.save(${result.id}) failed: $e');
    }
  }

  /// This candidate's practice runs, newest first.
  ///
  /// Returns an empty list rather than throwing, and drops any single run that will not
  /// parse — the same rule as `InterviewRepository._parseDocs`, for the same reason: one
  /// malformed record must not blank out a whole history.
  Future<List<InterviewResult>> load() async {
    final runs = _runs;
    if (runs == null) return const [];
    try {
      final snap = await runs
          .orderBy('createdAt', descending: true)
          .limit(pageSize)
          .get();
      final out = <InterviewResult>[];
      for (final doc in snap.docs) {
        try {
          out.add(InterviewResult.fromJson(doc.data()));
        } catch (e) {
          debugPrint('PracticeStore: skipping bad run ${doc.id}: $e');
        }
      }
      return out;
    } catch (e) {
      debugPrint('PracticeStore.load failed: $e');
      return const [];
    }
  }

  Future<void> delete(String runId) async {
    final runs = _runs;
    if (runs == null || runId.isEmpty) return;
    try {
      await runs.doc(runId).delete();
    } catch (e) {
      debugPrint('PracticeStore.delete($runId) failed: $e');
    }
  }

  /// Copies runs already held on THIS device up to the server, once.
  ///
  /// Without it, promoting the store silently discards whatever a candidate had
  /// practised before the change — which from their side is indistinguishable from the
  /// app losing their work.
  ///
  /// Idempotent by document id (`merge: true` on the run's own id), so a repeat is
  /// harmless and a partial run can simply be re-run. Returns how many were uploaded.
  Future<int> migrateLocal(List<InterviewResult> local) async {
    final runs = _runs;
    if (runs == null) return 0;

    final practice = local.where((r) => r.isPractice).toList();
    if (practice.isEmpty) return 0;

    var written = 0;
    // Chunked well under Firestore's 500-write batch cap, as every other batched write
    // in this codebase is.
    const chunk = 400;
    for (var i = 0; i < practice.length; i += chunk) {
      final end = (i + chunk < practice.length) ? i + chunk : practice.length;
      final batch = _db.batch();
      for (final run in practice.sublist(i, end)) {
        batch.set(runs.doc(run.id), run.toJson(), SetOptions(merge: true));
      }
      try {
        await batch.commit();
        written += end - i;
      } catch (e) {
        debugPrint('PracticeStore.migrateLocal chunk failed: $e');
      }
    }
    if (written > 0) {
      debugPrint('PracticeStore: uploaded $written local practice run(s)');
    }
    return written;
  }
}

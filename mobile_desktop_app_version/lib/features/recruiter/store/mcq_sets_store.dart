// lib/features/recruiter/store/mcq_sets_store.dart
//
// A recruiter's MCQ papers, over `/api/mcq-sets`.
//
// Server-backed rather than local, and unlike `RecruiterStore` there is no in-memory
// mirror to fall back on. That is deliberate: a paper holds the ANSWER KEY, and
// `firestore.rules` denies clients the collection outright, so there is no direct
// Firestore path to keep in sync and nothing to reconcile. Every read is the server's
// answer.
//
// The same reasoning explains why `ready`/`faults` are read and never computed here:
// completeness is what stands between a paper and scoring everybody zero, and one
// implementation of that rule (app/mcq_authoring.py) is the only way both clients agree
// on what "usable" means.

import 'package:flutter/foundation.dart';

import 'package:talbotiq/core/net/backend_client.dart';
import 'package:talbotiq/features/recruiter/models/mcq_set.dart';

class McqSetsStore extends ChangeNotifier {
  McqSetsStore({BackendClient? client}) : _injected = client;

  final BackendClient? _injected;
  BackendClient get _client => _injected ?? backendClient;

  static const String _base = '/api/mcq-sets';

  List<McqSet> _sets = const [];
  List<McqSet> get sets => List.unmodifiable(_sets);

  bool _loading = false;
  bool get loading => _loading;

  String? _error;
  String? get error => _error;

  /// Reloads the list. Never throws — the error is state, so the page can offer a
  /// retry instead of a stack trace.
  Future<void> refresh() async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      final rows = await _client.getJsonList(_base);
      _sets = rows.map(McqSet.fromJson).toList();
    } catch (e) {
      _error = _message(e);
    }
    _loading = false;
    notifyListeners();
  }

  /// One paper in full. The list already carries everything, but a paper edited on
  /// another device would be stale — so the editor fetches rather than trusting the row
  /// it was opened from.
  Future<McqSet> fetch(String setId) async =>
      McqSet.fromJson(await _client.getJson('$_base/$setId'));

  /// Creates or updates, and refreshes the list. Returns the stored paper.
  ///
  /// Throws on failure rather than swallowing: this one is the recruiter pressing Save,
  /// and a silent failure would leave them believing a paper exists that does not.
  Future<McqSet> save(McqSet paper) async {
    final json = paper.id.isEmpty
        ? await _client.postJson(_base, body: paper.toJson())
        : await _client.putJson('$_base/${paper.id}', body: paper.toJson());
    final stored = McqSet.fromJson(json);
    await refresh();
    return stored;
  }

  Future<void> duplicate(String setId) async {
    await _client.postJson('$_base/$setId/duplicate');
    await refresh();
  }

  Future<void> delete(String setId) async {
    await _client.deleteJson('$_base/$setId');
    await refresh();
  }

  /// Topics worth testing for a role — one model call, at authoring time.
  Future<List<String>> suggestTopics(String role) async {
    final json = await _client.postJson('$_base/suggest-topics', body: {'role': role});
    return ((json['topics'] as List?) ?? const []).map((e) => e.toString()).toList();
  }

  /// Generates a paper for REVIEW. Nothing is saved.
  ///
  /// Same split as the web: generation costs a model call, and a recruiter who dislikes
  /// the result should not have to delete a set they never wanted. What comes back is
  /// dropped into the editor, where it is edited and saved as a separate act.
  ///
  /// `dropped` is surfaced rather than hidden — a recruiter who asked for 20 and
  /// received 17 is entitled to know the difference was thrown away for being unusable.
  Future<McqGeneration> generate({
    required String role,
    required List<String> topics,
    required String style,
    required int technicalCount,
    required int nonTechnicalCount,
    String difficulty = 'mixed',
    bool allowMulti = false,
  }) async {
    final json = await _client.postJson('$_base/generate', body: {
      'role': role,
      'topics': topics,
      'style': style,
      'technicalCount': technicalCount,
      'nonTechnicalCount': nonTechnicalCount,
      'difficulty': difficulty,
      'allowMulti': allowMulti,
    });
    return McqGeneration(
      questions: ((json['questions'] as List?) ?? const [])
          .whereType<Map>()
          .map((e) => McqQuestionDraft.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
      requested: (json['requested'] as num?)?.toInt() ?? 0,
      dropped: (json['dropped'] as num?)?.toInt() ?? 0,
    );
  }

  static String _message(Object error) {
    final text = error.toString().replaceFirst('Exception: ', '').trim();
    return text.isEmpty ? 'Something went wrong. Please try again.' : text;
  }
}

@immutable
class McqGeneration {
  final List<McqQuestionDraft> questions;
  final int requested;
  final int dropped;

  const McqGeneration({
    required this.questions,
    required this.requested,
    required this.dropped,
  });
}

// lib/features/interviews/candidate/mcq/mcq_store.dart
//
// Sitting an MCQ paper: load it, hold what has been chosen, autosave, hand it in.
//
// A ChangeNotifier rather than state inside the page, for one reason: AUTOSAVE has to
// outlive a rebuild. A candidate who rotates their phone, backgrounds the app, or
// scrolls a long paper must not have a pending save cancelled by a widget disposing.
//
// ── Autosave ────────────────────────────────────────────────────────────────
// Debounced, not per-tap. A candidate working through a 40-question paper generates a
// tap every few seconds, and one request each would be both wasteful and slower than
// the typing. Every change restarts a short timer; the save carries the WHOLE answer
// map, so a dropped request costs nothing — the next one supersedes it.
//
// Failures are silent by design. The paper is still on screen and still answerable, and
// a red banner over a network blip would tell a candidate mid-assessment that something
// is wrong when nothing they can act on is. What is NOT silent is submit: that one is
// the candidate's decision to hand in, and it reports.
//
// ── Nothing here knows the answers ──────────────────────────────────────────
// Scoring happens on the server, against the stored paper. This client sends choices
// and receives "submitted" — see backend/app/mcq_runtime.py. Whether the candidate is
// ever shown a score is `resultPublished`, a recruiter action, exactly as with every
// other track.

import 'dart:async';

import 'package:flutter/foundation.dart';

import 'package:talbotiq/core/net/backend_client.dart';
import 'mcq_models.dart';

/// How long after the last change a save is sent.
///
/// Short enough that closing the lid loses at most a couple of taps, long enough that
/// working quickly through a section is one request rather than ten.
const Duration kMcqAutosaveDelay = Duration(seconds: 2);

enum McqPhase { loading, ready, submitting, submitted, failed }

class McqStore extends ChangeNotifier {
  McqStore({
    required this.interviewId,
    required BackendClient client,
    this.autosaveDelay = kMcqAutosaveDelay,
  }) : _client = client;

  final String interviewId;
  final BackendClient _client;
  final Duration autosaveDelay;

  McqPhase _phase = McqPhase.loading;
  McqPhase get phase => _phase;

  McqPaper? _paper;
  McqPaper? get paper => _paper;

  String? _error;
  String? get error => _error;

  /// `{questionId: [optionId...]}` or `{questionId: {promptId: matchId}}`.
  final Map<String, dynamic> _answers = {};
  Map<String, dynamic> get answers => Map.unmodifiable(_answers);

  Timer? _saveTimer;
  bool _saving = false;

  /// When this attempt runs out, on THIS device's clock.
  ///
  /// Anchored to the server's `remainingSeconds` at load and then measured with
  /// the local clock, which is the combination that survives both problems: the
  /// deadline itself cannot be moved by changing the device clock (the server
  /// decides how much is left), and the countdown does not need a request per
  /// second to tick.
  ///
  /// Null for an untimed paper, and for one whose server did not send a
  /// remaining time — no clock at all is better than a wrong one.
  DateTime? _deadline;

  /// Time left, or null when this paper is untimed. Never negative.
  Duration? get remaining {
    final deadline = _deadline;
    if (deadline == null) return null;
    final left = deadline.difference(DateTime.now());
    return left.isNegative ? Duration.zero : left;
  }

  /// True once a timed paper's clock has run out.
  bool get isTimeUp => remaining == Duration.zero;

  /// True while a save is in flight or queued — what a "saving…" indicator reads.
  bool get isSaving => _saving || (_saveTimer?.isActive ?? false);

  int get answered => _answers.values.where(_isAnswered).length;
  int get total => _paper?.total ?? 0;

  static bool _isAnswered(Object? value) {
    if (value is List) return value.isNotEmpty;
    if (value is Map) return value.isNotEmpty;
    return false;
  }

  /// Fetches the paper. Opening it is what starts the attempt, server-side.
  Future<void> load() async {
    _phase = McqPhase.loading;
    _error = null;
    notifyListeners();
    try {
      final json = await _client.getJson('/api/interviews/$interviewId/mcq');
      final paper = McqPaper.fromJson(json);
      _paper = paper;
      _answers
        ..clear()
        ..addAll(paper.answers);
      // Re-anchored on every load, so reopening the paper picks the clock up
      // where the server says it is rather than restarting it.
      final left = paper.remainingSeconds;
      _deadline =
          left == null ? null : DateTime.now().add(Duration(seconds: left));
      _phase = paper.submitted ? McqPhase.submitted : McqPhase.ready;
    } catch (e) {
      _error = _message(e);
      _phase = McqPhase.failed;
    }
    notifyListeners();
  }

  /// Records a choice on a single- or multi-select question.
  ///
  /// Single-select REPLACES; multi-select toggles. Toggling off is stored as an empty
  /// list rather than a removed key, so the save that follows tells the server the
  /// question was deselected instead of leaving the previous answer standing.
  void choose(McqQuestion question, String optionId) {
    if (_phase == McqPhase.submitted) return;
    final current = List<String>.from((_answers[question.id] as List?) ?? const []);

    if (question.type == McqQuestionType.multi) {
      current.contains(optionId) ? current.remove(optionId) : current.add(optionId);
      _answers[question.id] = current;
    } else {
      _answers[question.id] = current.length == 1 && current.first == optionId
          ? <String>[] // tapping the chosen option again clears it
          : <String>[optionId];
    }
    _touched();
  }

  /// Records one pairing on a match question. A null [matchId] clears that prompt.
  void pair(McqQuestion question, String promptId, String? matchId) {
    if (_phase == McqPhase.submitted) return;
    final current = Map<String, String>.from(
      (_answers[question.id] as Map?)?.cast<String, String>() ?? const {},
    );
    if (matchId == null) {
      current.remove(promptId);
    } else {
      current[promptId] = matchId;
    }
    _answers[question.id] = current;
    _touched();
  }

  List<String> selectionFor(McqQuestion question) =>
      List<String>.from((_answers[question.id] as List?) ?? const []);

  Map<String, String> pairingFor(McqQuestion question) =>
      Map<String, String>.from(
        (_answers[question.id] as Map?)?.cast<String, String>() ?? const {},
      );

  bool isAnswered(McqQuestion question) => _isAnswered(_answers[question.id]);

  void _touched() {
    notifyListeners();
    _saveTimer?.cancel();
    _saveTimer = Timer(autosaveDelay, () => unawaited(saveNow()));
  }

  /// Sends everything chosen so far. Never throws.
  ///
  /// The whole map every time, not a delta: a save that never arrived must not leave a
  /// hole, and the payload is a few hundred bytes.
  Future<void> saveNow() async {
    _saveTimer?.cancel();
    if (_phase == McqPhase.submitted || _saving) return;
    _saving = true;
    notifyListeners();
    try {
      await _client.postJson(
        '/api/interviews/$interviewId/mcq/answers',
        body: {'answers': _answers},
      );
    } catch (e) {
      // Deliberately quiet — see the header. The answers are still held here and the
      // next change, or submit, sends them again.
      debugPrint('McqStore autosave failed: $e');
    }
    _saving = false;
    notifyListeners();
  }

  /// Hands the paper in. Returns true when the server accepted it.
  ///
  /// The final answers travel WITH the submit rather than relying on a prior autosave
  /// having landed: a candidate who answers the last question and submits immediately
  /// must not be scored without it.
  Future<bool> submit() async {
    if (_phase == McqPhase.submitted) return true;
    _saveTimer?.cancel();
    _phase = McqPhase.submitting;
    _error = null;
    notifyListeners();
    try {
      await _client.postJson(
        '/api/interviews/$interviewId/mcq/submit',
        body: {'answers': _answers},
      );
      _phase = McqPhase.submitted;
      notifyListeners();
      return true;
    } catch (e) {
      _error = _message(e);
      // Back to ready, not failed: the paper is intact and the candidate can press
      // submit again. Stranding them on an error screen with their answers behind it
      // is the worst possible response to a network blip at the moment of handing in.
      _phase = McqPhase.ready;
      notifyListeners();
      return false;
    }
  }

  static String _message(Object error) {
    final text = error.toString().replaceFirst('Exception: ', '').trim();
    return text.isEmpty ? 'Something went wrong. Please try again.' : text;
  }

  @override
  void dispose() {
    _saveTimer?.cancel();
    super.dispose();
  }
}

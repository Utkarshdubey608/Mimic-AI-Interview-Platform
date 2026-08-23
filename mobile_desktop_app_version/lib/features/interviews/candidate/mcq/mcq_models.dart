// lib/features/interviews/candidate/mcq/mcq_models.dart
//
// The MCQ paper as a candidate's device receives it.
//
// ── There is no field here for an answer key, and that is the point ─────────
//
// MCQ is the only track whose stored questions contain the answers. The server
// projects a paper through an ALLOW-LIST (`mcq_public_question` in
// backend/app/mcq_scoring.py) so `correctOptionIds` and `correctPairs` never reach a
// device — and this file is the second half of that promise: even if a future server
// bug put a key on the wire, there is nowhere in this model for it to land, so it
// cannot be rendered, logged, or written to disk.
//
// `test/mcq_contract_test.dart` asserts exactly that against the shared golden fixture
// `contracts/mcq_paper.fixtures.json`, which the backend generates. Adding a field to
// this file that mirrors a stored-only field is how that guarantee gets lost, so don't.
//
// Types: `single`, `multi`, `match`. All three are CLOSED — the answer is known before
// the candidate arrives — which is what keeps scoring a comparison rather than a
// judgement. A coding question is a `single` with a snippet attached.

import 'package:flutter/foundation.dart';

/// One selectable option, or one entry in a matching column.
@immutable
class McqOption {
  final String id;
  final String text;

  const McqOption({required this.id, required this.text});

  factory McqOption.fromJson(Map<String, dynamic> json) => McqOption(
        id: (json['id'] ?? '').toString(),
        text: (json['text'] ?? '').toString(),
      );
}

enum McqQuestionType {
  single,
  multi,
  match;

  static McqQuestionType parse(Object? raw) => switch (raw?.toString()) {
        'multi' => McqQuestionType.multi,
        'match' => McqQuestionType.match,
        // Anything unrecognised is treated as single-choice rather than dropped. A
        // question type this build has not learned yet is still a question somebody is
        // being marked on; showing it as a single-select is wrong in the input widget,
        // whereas hiding it is wrong in the score.
        _ => McqQuestionType.single,
      };
}

@immutable
class McqQuestion {
  final String id;
  final String text;
  final McqQuestionType type;

  /// For `single` and `multi`. Empty for a pairing.
  final List<McqOption> options;

  /// For `match`: the left column (what is being matched) and the right (what it may
  /// be matched to). The server reorders the right column before sending it — for a
  /// pairing the authored order IS the answer.
  final List<McqOption> prompts;
  final List<McqOption> matches;

  /// The snippet a code-reading question is about. Visible by necessity: the question
  /// is unanswerable without it, and it carries no key.
  final String? code;

  final double points;

  const McqQuestion({
    required this.id,
    required this.text,
    required this.type,
    this.options = const [],
    this.prompts = const [],
    this.matches = const [],
    this.code,
    this.points = 1,
  });

  factory McqQuestion.fromJson(Map<String, dynamic> json) {
    List<McqOption> list(String key) => ((json[key] as List?) ?? const [])
        .whereType<Map>()
        .map((e) => McqOption.fromJson(Map<String, dynamic>.from(e)))
        .toList();

    final code = (json['code'] ?? '').toString();
    return McqQuestion(
      id: (json['id'] ?? '').toString(),
      text: (json['text'] ?? '').toString(),
      type: McqQuestionType.parse(json['type']),
      options: list('options'),
      prompts: list('prompts'),
      matches: list('matches'),
      code: code.isEmpty ? null : code,
      points: (json['points'] as num?)?.toDouble() ?? 1,
    );
  }

  bool get isPairing => type == McqQuestionType.match;
}

/// A part of a divided paper — an aptitude section, a role-based section.
///
/// Carries the ids of the questions in it rather than the questions themselves: the
/// paper holds one list, and one list cannot disagree with itself about what is on it.
@immutable
class McqSection {
  final String id;
  final String name;
  final List<String> questionIds;
  final String? instructions;

  /// A reading passage the section's questions are about. Shown once, above them,
  /// rather than repeated on each.
  final String? passage;

  const McqSection({
    required this.id,
    required this.name,
    this.questionIds = const [],
    this.instructions,
    this.passage,
  });

  factory McqSection.fromJson(Map<String, dynamic> json) {
    String? nonEmpty(Object? v) {
      final s = (v ?? '').toString();
      return s.isEmpty ? null : s;
    }

    return McqSection(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      questionIds: ((json['questionIds'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
      instructions: nonEmpty(json['instructions']),
      passage: nonEmpty(json['passage']),
    );
  }
}

/// A paper, plus how far the candidate has got with it.
@immutable
class McqPaper {
  final String interviewId;
  final String name;
  final List<McqQuestion> questions;

  /// Empty for an undivided paper. Empty rather than null so callers ask
  /// `sections.isEmpty` instead of null-checking; `isDivided` says what that means.
  final List<McqSection> sections;

  /// `{questionId: [optionId, ...]}` for a choice, `{questionId: {promptId: matchId}}`
  /// for a pairing. What the candidate has chosen so far — restored on a reload, so
  /// closing the lid does not cost them a page of work.
  final Map<String, dynamic> answers;

  final bool submitted;
  final int? totalSeconds;

  /// Seconds left when the server answered, or null for an untimed paper.
  ///
  /// The device is TOLD how much is left rather than working it out from
  /// `startedAt` and its own clock: a phone's clock is the one input a candidate
  /// can trivially change, and computing the deadline locally would hand them the
  /// deadline. 0 means time is up — a state, not a rendering detail.
  final int? remainingSeconds;

  const McqPaper({
    required this.interviewId,
    required this.name,
    required this.questions,
    this.sections = const [],
    this.answers = const {},
    this.submitted = false,
    this.totalSeconds,
    this.remainingSeconds,
  });

  factory McqPaper.fromJson(Map<String, dynamic> json) => McqPaper(
        interviewId: (json['interviewId'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        questions: ((json['questions'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => McqQuestion.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        sections: ((json['sections'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => McqSection.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        answers: Map<String, dynamic>.from((json['answers'] as Map?) ?? const {}),
        submitted: (json['status'] ?? '').toString() == 'submitted' ||
            json['submittedAt'] != null,
        totalSeconds: (json['totalSeconds'] as num?)?.toInt(),
        remainingSeconds: (json['remainingSeconds'] as num?)?.toInt(),
      );

  bool get isDivided => sections.isNotEmpty;

  int get total => questions.length;

  /// Questions in the order they are presented, grouped by section when there is one.
  ///
  /// A question named by no section still appears — at the end. The server orders the
  /// list the same way; this only has to agree with it, and it is written to survive a
  /// manifest that names an id the paper does not contain.
  List<McqQuestion> questionsIn(McqSection section) {
    final byId = {for (final q in questions) q.id: q};
    return [
      for (final id in section.questionIds)
        if (byId[id] != null) byId[id]!,
    ];
  }

  /// Questions belonging to no section. Empty for an undivided paper, where every
  /// question is simply in [questions].
  List<McqQuestion> get unsectioned {
    if (!isDivided) return const [];
    final claimed = {for (final s in sections) ...s.questionIds};
    return questions.where((q) => !claimed.contains(q.id)).toList();
  }
}

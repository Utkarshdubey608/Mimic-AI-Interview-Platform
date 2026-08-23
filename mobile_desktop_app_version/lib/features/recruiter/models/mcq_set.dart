// lib/features/recruiter/models/mcq_set.dart
//
// A recruiter's MCQ paper, as its AUTHOR sees it — answer key included.
//
// This is deliberately the mirror image of
// `features/interviews/candidate/mcq/mcq_models.dart`, which has nowhere for a key to
// land. The distinction is the whole design: the paper is one document, and which
// fields travel depends on who is asking. The server projects it through an allow-list
// for a candidate (`mcq_public_question`) and returns it whole to the recruiter who
// owns it.
//
// So `correctOptionIds` and `correctPairs` belong HERE and must never appear in the
// candidate model. If you find yourself adding one there, the paper is being fetched
// from the wrong endpoint.
//
// ── Saving is permissive; USING is strict ───────────────────────────────────
// A question with no text, no options or no marked answer SAVES. Nobody writes a
// forty-question paper through a sequence of individually valid states. The server
// returns `ready` and `faults` — computed, never stored — and the editor shows them.
// Completeness is enforced when a paper is attached to an interview, which is the
// moment it would otherwise score everyone zero.

import 'package:flutter/foundation.dart';

@immutable
class McqOptionDraft {
  final String id;
  final String text;

  const McqOptionDraft({required this.id, required this.text});

  factory McqOptionDraft.fromJson(Map<String, dynamic> json) => McqOptionDraft(
        id: (json['id'] ?? '').toString(),
        text: (json['text'] ?? '').toString(),
      );

  Map<String, dynamic> toJson() => {'id': id, 'text': text};

  McqOptionDraft copyWith({String? text}) =>
      McqOptionDraft(id: id, text: text ?? this.text);
}

/// One authored question, with its answer.
///
/// `single`, `multi` and `match` — all three CLOSED, so scoring stays a comparison
/// rather than a judgement. A coding question is a `single` with a snippet attached:
/// the candidate reads code and answers a closed question about it, which keeps the
/// result reproducible in a way "run their code" never is.
@immutable
class McqQuestionDraft {
  final String id;
  final String text;

  /// `single`, `multi` or `match`.
  final String type;

  final List<McqOptionDraft> options;
  final List<String> correctOptionIds;

  /// For `match`: the two columns and the pairing between them.
  final List<McqOptionDraft> prompts;
  final List<McqOptionDraft> matches;
  final Map<String, String> correctPairs;

  final String? code;
  final String? topic;
  final String? sectionId;
  final String? explanation;
  final double points;

  const McqQuestionDraft({
    required this.id,
    this.text = '',
    this.type = 'single',
    this.options = const [],
    this.correctOptionIds = const [],
    this.prompts = const [],
    this.matches = const [],
    this.correctPairs = const {},
    this.code,
    this.topic,
    this.sectionId,
    this.explanation,
    this.points = 1,
  });

  bool get isPairing => type == 'match';
  bool get isMulti => type == 'multi';

  factory McqQuestionDraft.fromJson(Map<String, dynamic> json) {
    List<McqOptionDraft> list(String key) => ((json[key] as List?) ?? const [])
        .whereType<Map>()
        .map((e) => McqOptionDraft.fromJson(Map<String, dynamic>.from(e)))
        .toList();

    String? nonEmpty(Object? v) {
      final s = (v ?? '').toString().trim();
      return s.isEmpty ? null : s;
    }

    return McqQuestionDraft(
      id: (json['id'] ?? '').toString(),
      text: (json['text'] ?? '').toString(),
      type: (json['type'] ?? 'single').toString(),
      options: list('options'),
      correctOptionIds: ((json['correctOptionIds'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
      prompts: list('prompts'),
      matches: list('matches'),
      correctPairs: Map<String, String>.from(
        ((json['correctPairs'] as Map?) ?? const {})
            .map((k, v) => MapEntry(k.toString(), v.toString())),
      ),
      code: nonEmpty(json['code']),
      // `category` is the older spelling; the server reads either.
      topic: nonEmpty(json['topic'] ?? json['category']),
      // `section` is the legacy tag, from when a section was a two-value label rather
      // than a first-class object. Those labels ARE ids in the prebuilt library, so
      // reading it as one needs no migration.
      sectionId: nonEmpty(json['sectionId'] ?? json['section']),
      explanation: nonEmpty(json['explanation']),
      points: (json['points'] as num?)?.toDouble() ?? 1,
    );
  }

  /// The wire shape. A pairing sends `pairs` rows rather than three parallel
  /// structures — the server splits them into two columns and a mapping, which is the
  /// one place that split has to be got right.
  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{
      'id': id,
      'text': text,
      'type': type,
      'points': points,
      if (code != null && code!.isNotEmpty) 'code': code,
      if (topic != null && topic!.isNotEmpty) 'topic': topic,
      if (sectionId != null && sectionId!.isNotEmpty) 'sectionId': sectionId,
      if (explanation != null && explanation!.isNotEmpty) 'explanation': explanation,
    };

    if (isPairing) {
      json['pairs'] = [
        for (var i = 0; i < prompts.length; i++)
          {
            'promptId': prompts[i].id,
            'left': prompts[i].text,
            'matchId': i < matches.length ? matches[i].id : '',
            'right': i < matches.length ? matches[i].text : '',
          },
      ];
    } else {
      json['options'] = [for (final o in options) o.toJson()];
      json['correctOptionIds'] = correctOptionIds;
    }
    return json;
  }

  McqQuestionDraft copyWith({
    String? text,
    String? type,
    List<McqOptionDraft>? options,
    List<String>? correctOptionIds,
    List<McqOptionDraft>? prompts,
    List<McqOptionDraft>? matches,
    Map<String, String>? correctPairs,
    String? code,
    String? topic,
    String? sectionId,
    String? explanation,
    double? points,
    bool clearSection = false,
  }) =>
      McqQuestionDraft(
        id: id,
        text: text ?? this.text,
        type: type ?? this.type,
        options: options ?? this.options,
        correctOptionIds: correctOptionIds ?? this.correctOptionIds,
        prompts: prompts ?? this.prompts,
        matches: matches ?? this.matches,
        correctPairs: correctPairs ?? this.correctPairs,
        code: code ?? this.code,
        topic: topic ?? this.topic,
        sectionId: clearSection ? null : (sectionId ?? this.sectionId),
        explanation: explanation ?? this.explanation,
        points: points ?? this.points,
      );
}

@immutable
class McqSectionDraft {
  final String id;
  final String name;
  final String? instructions;

  /// A reading passage the section's questions are about.
  ///
  /// It lives on the SECTION rather than on a question, and that is what makes
  /// comprehension work without a new question type: one passage, several ordinary
  /// questions about it, and nothing in the scorer needs to know passages exist. Two
  /// passages means two sections.
  final String? passage;

  const McqSectionDraft({
    required this.id,
    this.name = '',
    this.instructions,
    this.passage,
  });

  factory McqSectionDraft.fromJson(Map<String, dynamic> json) {
    String? nonEmpty(Object? v) {
      final s = (v ?? '').toString().trim();
      return s.isEmpty ? null : s;
    }

    return McqSectionDraft(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      instructions: nonEmpty(json['instructions']),
      passage: nonEmpty(json['passage']),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        if (instructions != null && instructions!.isNotEmpty) 'instructions': instructions,
        if (passage != null && passage!.isNotEmpty) 'passage': passage,
      };

  McqSectionDraft copyWith({String? name, String? instructions, String? passage}) =>
      McqSectionDraft(
        id: id,
        name: name ?? this.name,
        instructions: instructions ?? this.instructions,
        passage: passage ?? this.passage,
      );
}

@immutable
class McqSet {
  final String id;
  final String name;
  final List<McqSectionDraft> sections;
  final List<McqQuestionDraft> questions;

  /// Whether the paper can be sent out, and why not.
  ///
  /// Computed by the server on every read, never stored — so it cannot go stale
  /// against the questions it describes. The editor shows [faults] rather than blocking
  /// the save, because a draft is a legitimate state and the recruiter is mid-sentence.
  final bool ready;
  final List<String> faults;

  const McqSet({
    required this.id,
    this.name = '',
    this.sections = const [],
    this.questions = const [],
    this.ready = false,
    this.faults = const [],
  });

  factory McqSet.fromJson(Map<String, dynamic> json) => McqSet(
        id: (json['id'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        sections: ((json['sections'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => McqSectionDraft.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        questions: ((json['questions'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => McqQuestionDraft.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        ready: json['ready'] == true,
        faults: ((json['faults'] as List?) ?? const []).map((e) => e.toString()).toList(),
      );

  /// The wire shape for create and update.
  ///
  /// `ready` and `faults` are deliberately absent — they are the server's answer, not
  /// the client's claim, and sending them back would invite somebody to trust them.
  Map<String, dynamic> toJson() => {
        'name': name,
        'sections': [for (final s in sections) s.toJson()],
        'questions': [for (final q in questions) q.toJson()],
      };

  bool get isDivided => sections.isNotEmpty;

  McqSet copyWith({
    String? name,
    List<McqSectionDraft>? sections,
    List<McqQuestionDraft>? questions,
  }) =>
      McqSet(
        id: id,
        name: name ?? this.name,
        sections: sections ?? this.sections,
        questions: questions ?? this.questions,
        ready: ready,
        faults: faults,
      );
}

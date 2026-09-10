// lib/features/interviews/models/role_config.dart
//
// A reusable, per-role multi-round interview pipeline template — `roleConfigs/{id}`.
// SHARED with the web surface (unprefixed collection, same document shape as
// `backend/app/role_configs.py`'s `RoleConfig`/`RoleRoundSpec`): a pipeline authored
// on one client must be usable on the other, the same way `tests/{id}/rounds`
// already is.
//
// A RoleConfig is a TEMPLATE, not a live pipeline — it has no candidates and no
// lifecycle. Materialising one into a real `tests/{testId}/rounds` timeline for a
// batch of candidates happens at import time (see `RoleConfigRepository` and the
// invite flow), by copying each [RoleRoundSpec] into a real [InterviewRound].

import 'package:cloud_firestore/cloud_firestore.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';

/// One template round. Field names mirror [InterviewRound]'s, minus the
/// per-test lifecycle fields a template does not have (id, testId, recruiterId,
/// opensAt/closesAt/closedAt/closedBy) — a template round has no independent
/// existence outside the [RoleConfig] that holds it.
class RoleRoundSpec {
  final int order;
  final String title;
  final RoundKind kind;

  /// Mode-specific config, identical shape to [InterviewRound.config]:
  /// `{prompt, questions, adaptive, adaptiveConfig, screeningSource, mixedConfig,
  /// mcqSetId, avatar, durationMinutes, ...}`. Opaque here — resolved into a real
  /// round's config only at materialisation time.
  final Map<String, dynamic> config;
  final RoundCriteria criteria;
  final RoundAdvance advance;

  const RoleRoundSpec({
    required this.order,
    required this.title,
    required this.kind,
    this.config = const {},
    this.criteria = const RoundCriteria(),
    this.advance = const RoundAdvance(),
  });

  factory RoleRoundSpec.fromMap(Map<String, dynamic>? m, int fallbackOrder) {
    final map = m ?? const <String, dynamic>{};
    return RoleRoundSpec(
      order: (map['order'] as num?)?.toInt() ?? fallbackOrder,
      title: (map['title'] as String?) ?? 'Round ${fallbackOrder + 1}',
      kind: RoundKindX.fromWire(map['kind'] as String?),
      config: (map['config'] as Map<String, dynamic>?) ?? const {},
      criteria: RoundCriteria.fromMap(map['criteria'] as Map<String, dynamic>?),
      advance: RoundAdvance.fromMap(map['advance'] as Map<String, dynamic>?),
    );
  }

  Map<String, dynamic> toMap() => {
        'order': order,
        'title': title,
        'kind': kind.wire,
        'config': config,
        'criteria': criteria.toMap(),
        'advance': advance.toMap(),
      };

  /// A draft [InterviewRound] for the existing round editor
  /// (`CreateInterviewPage.configureRound`) to edit — bridges into the round UI
  /// that already exists rather than building a second one. `id`/`testId`/
  /// `recruiterId` are placeholders; only `order`/`title`/`kind`/`config`/
  /// `criteria`/`advance` are read back via [RoleRoundSpec.fromEditedDraft].
  InterviewRound asEditableDraft() => InterviewRound(
        id: '',
        testId: '',
        recruiterId: '',
        order: order,
        title: title,
        kind: kind,
        config: config,
        criteria: criteria,
        advance: advance,
      );

  factory RoleRoundSpec.fromEditedDraft(InterviewRound r) => RoleRoundSpec(
        order: r.order,
        title: r.title,
        kind: r.kind,
        config: r.config,
        criteria: r.criteria,
        advance: r.advance,
      );

  RoleRoundSpec copyWith({int? order, String? title}) => RoleRoundSpec(
        order: order ?? this.order,
        title: title ?? this.title,
        kind: kind,
        config: config,
        criteria: criteria,
        advance: advance,
      );
}

class RoleConfig {
  final String id;
  final String recruiterId;

  /// A slug from the backend's `app.role_classification` category table (e.g.
  /// `'sde'`, `'consulting'`, `'other'`) — the SAME vocabulary a spreadsheet
  /// import classifies candidates into. Identity, not content: never changed
  /// once created (matches the backend's `role_configs.build_update`, which has
  /// no `roleCategory` parameter).
  final String roleCategory;
  final String displayName;
  final List<RoleRoundSpec> rounds;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  const RoleConfig({
    required this.id,
    required this.recruiterId,
    required this.roleCategory,
    required this.displayName,
    this.rounds = const [],
    this.createdAt,
    this.updatedAt,
  });

  /// Defensive, like every other `fromDoc` in this app: one bad pipeline must
  /// not break the list of them.
  factory RoleConfig.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    final rawRounds = (d['rounds'] as List?) ?? const [];
    return RoleConfig(
      id: doc.id,
      recruiterId: (d['recruiterId'] as String?) ?? '',
      roleCategory: (d['roleCategory'] as String?) ?? '',
      displayName: (d['displayName'] as String?) ?? 'Untitled pipeline',
      rounds: [
        for (var i = 0; i < rawRounds.length; i++)
          RoleRoundSpec.fromMap(rawRounds[i] as Map<String, dynamic>?, i),
      ],
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
      updatedAt: (d['updatedAt'] as Timestamp?)?.toDate(),
    );
  }

  Map<String, dynamic> toCreateMap() => {
        'recruiterId': recruiterId,
        'roleCategory': roleCategory,
        'displayName': displayName,
        'rounds': [for (final r in rounds) r.toMap()],
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      };

  /// Editable fields only — `roleCategory` is identity and is never rewritten
  /// here, matching the backend's `role_configs.build_update`.
  Map<String, dynamic> toUpdateMap() => {
        'displayName': displayName,
        'rounds': [for (final r in rounds) r.toMap()],
        'updatedAt': FieldValue.serverTimestamp(),
      };

  RoleConfig copyWith({String? displayName, List<RoleRoundSpec>? rounds}) =>
      RoleConfig(
        id: id,
        recruiterId: recruiterId,
        roleCategory: roleCategory,
        displayName: displayName ?? this.displayName,
        rounds: rounds ?? this.rounds,
        createdAt: createdAt,
        updatedAt: updatedAt,
      );
}

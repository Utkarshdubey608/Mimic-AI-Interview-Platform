// lib/features/interviews/services/role_config_repository.dart
//
// Firestore access for the shared, unprefixed `roleConfigs` collection — reusable
// per-role interview pipeline templates. Owner-scoped like `tests`/`interviews`:
// every query filters by `recruiterId`, matching `firestore.rules`.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import 'package:talbotiq/features/interviews/models/role_config.dart';

class RoleConfigRepository {
  RoleConfigRepository({FirebaseFirestore? firestore})
    : _db = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _db;

  CollectionReference<Map<String, dynamic>> get _col =>
      _db.collection('roleConfigs');

  Future<String> create(RoleConfig config) async {
    final ref = await _col.add(config.toCreateMap());
    return ref.id;
  }

  Future<void> update(RoleConfig config) =>
      _col.doc(config.id).update(config.toUpdateMap());

  Future<void> delete(String id) => _col.doc(id).delete();

  Future<RoleConfig?> getById(String id) async {
    if (id.isEmpty) return null;
    final snap = await _col.doc(id).get();
    if (!snap.exists) return null;
    return RoleConfig.fromDoc(snap);
  }

  /// Every pipeline this recruiter owns. A recruiter authors a handful of these
  /// (one per role category they hire for), so an unbounded stream is fine —
  /// the same reasoning `InterviewRepository.watchForRecruiter` uses for tests.
  Stream<List<RoleConfig>> watchForRecruiter(String recruiterId) {
    if (recruiterId.isEmpty) return const Stream.empty();
    return _col
        .where('recruiterId', isEqualTo: recruiterId)
        .snapshots()
        .map((snap) {
          final out = <RoleConfig>[];
          for (final doc in snap.docs) {
            try {
              out.add(RoleConfig.fromDoc(doc));
            } catch (e) {
              // One malformed pipeline must not empty the whole list.
              debugPrint('RoleConfigRepository: skipping malformed doc ${doc.id}: $e');
            }
          }
          out.sort(
            (a, b) => a.displayName.toLowerCase().compareTo(b.displayName.toLowerCase()),
          );
          return out;
        });
  }

  /// The pipeline configured for a role category, if any — used at import time
  /// to match a classified candidate to their pipeline (Feature 1F). A
  /// recruiter is expected to have at most one pipeline per category; when more
  /// than one exists (e.g. a duplicate), the most recently updated wins.
  Future<RoleConfig?> findByRoleCategory({
    required String recruiterId,
    required String roleCategory,
  }) async {
    if (recruiterId.isEmpty || roleCategory.isEmpty) return null;
    final snap = await _col
        .where('recruiterId', isEqualTo: recruiterId)
        .where('roleCategory', isEqualTo: roleCategory)
        .get();
    if (snap.docs.isEmpty) return null;
    final configs = [for (final doc in snap.docs) RoleConfig.fromDoc(doc)];
    configs.sort((a, b) {
      final au = a.updatedAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      final bu = b.updatedAt ?? DateTime.fromMillisecondsSinceEpoch(0);
      return bu.compareTo(au);
    });
    return configs.first;
  }
}

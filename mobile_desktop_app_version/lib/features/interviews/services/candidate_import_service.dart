// lib/features/interviews/services/candidate_import_service.dart
//
// Spreadsheet candidate import (Feature 1A-1C), replacing the old on-device
// "regex every email out of a flattened text blob" flow in
// create_interview_page.dart. Calls the SAME backend endpoint the web surface's
// invite wizard uses — one column-aware parser, one role classifier
// (`app.role_classification`), never duplicated in Dart. See
// `backend/app/web/services/invite_extract.py` / `routes/invites.py`.
//
// Same shape as resume_service.dart: a module-level singleton, backend
// injectable for tests.

import 'package:talbotiq/core/net/backend_client.dart';

/// One row the server extracted from an uploaded spreadsheet/CSV/unstructured
/// file.
class ImportedCandidateRow {
  final String email;
  final String role;

  /// A slug from the server's role classifier (`'sde'`, `'consulting'`,
  /// `'other'`, ...), or null when the server predates this field. Recruiter-
  /// editable before import — see `CandidateImportPreviewPage`.
  final String? roleCategory;
  final bool valid;

  const ImportedCandidateRow({
    required this.email,
    required this.role,
    required this.roleCategory,
    required this.valid,
  });

  factory ImportedCandidateRow.fromJson(Map<String, dynamic> json) => ImportedCandidateRow(
        email: (json['email'] as String?)?.trim() ?? '',
        role: (json['role'] as String?)?.trim() ?? '',
        roleCategory: (json['roleCategory'] as String?)?.trim(),
        valid: json['valid'] == true,
      );

  ImportedCandidateRow copyWith({String? role, String? roleCategory}) => ImportedCandidateRow(
        email: email,
        role: role ?? this.role,
        roleCategory: roleCategory,
        valid: valid,
      );
}

class CandidateImportResult {
  final List<ImportedCandidateRow> rows;
  final List<String> warnings;

  const CandidateImportResult({required this.rows, required this.warnings});

  factory CandidateImportResult.fromJson(Map<String, dynamic> json) => CandidateImportResult(
        rows: [
          for (final row in (json['rows'] as List? ?? const []))
            if (row is Map) ImportedCandidateRow.fromJson(Map<String, dynamic>.from(row)),
        ],
        warnings: [
          for (final w in (json['warnings'] as List? ?? const []))
            if (w is String) w,
        ],
      );
}

/// One recognised category from the server's classifier, for populating a
/// picker (the manual-correction dropdown in the import preview, and the role
/// pipeline editor's category select).
class RoleCategoryOption {
  final String slug;
  final String displayName;

  const RoleCategoryOption({required this.slug, required this.displayName});

  factory RoleCategoryOption.fromJson(Map<String, dynamic> json) => RoleCategoryOption(
        slug: (json['slug'] as String?) ?? '',
        displayName: (json['displayName'] as String?) ?? '',
      );
}

class CandidateImportService {
  CandidateImportService({BackendClient? backend}) : _injectedBackend = backend;

  final BackendClient? _injectedBackend;
  BackendClient get _backend => _injectedBackend ?? backendClient;

  bool get enabled => _backend.isConfigured;

  /// Uploads a spreadsheet/CSV/unstructured file and returns extracted,
  /// role-classified candidate rows for the recruiter to review before import.
  /// Creates and sends nothing — the same "review table is the real gate"
  /// contract the web wizard's extract step has.
  Future<CandidateImportResult> extractFromFile({
    required List<int> bytes,
    required String filename,
    String fallbackRole = '',
  }) async {
    final json = await _backend.postMultipart(
      '/api/web/invites/extract',
      fileBytes: bytes,
      fileFilename: filename,
      fields: {if (fallbackRole.trim().isNotEmpty) 'role': fallbackRole.trim()},
    );
    return CandidateImportResult.fromJson(json);
  }

  /// The classifier's known categories, for the manual-correction picker and
  /// the role pipeline editor. Cheap and stable — callers may cache this for
  /// the lifetime of a screen rather than refetching per keystroke.
  Future<List<RoleCategoryOption>> categories() async {
    final list = await _backend.getJsonList('/api/web/role-configs/categories');
    return [for (final json in list) RoleCategoryOption.fromJson(json)];
  }
}

final candidateImportService = CandidateImportService();

// lib/features/interviews/recruiter/candidate_import_preview_page.dart
//
// Feature 1's review step: the recruiter's last look at what the backend's
// role-aware spreadsheet extractor found before any of it becomes a candidate
// row on the create-interview form. Mirrors the web invite wizard's own
// "review table is the real gate" contract — nothing here creates or sends
// anything, it only hands the finalized rows back to the caller.
//
// Per-row role classification is best-effort by design (see the product spec):
// a candidate whose role could not be matched to a configured pipeline is
// still importable, just flagged so the recruiter knows to set one up later.

import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/status_tones.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/core/utils/validators.dart';
import 'package:talbotiq/features/interviews/models/role_config.dart';
import 'package:talbotiq/features/interviews/services/candidate_import_service.dart';
import 'package:talbotiq/features/interviews/services/role_config_repository.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

class CandidateImportPreviewPage extends StatefulWidget {
  final List<ImportedCandidateRow> rows;
  final List<String> warnings;

  const CandidateImportPreviewPage({
    super.key,
    required this.rows,
    required this.warnings,
  });

  @override
  State<CandidateImportPreviewPage> createState() =>
      _CandidateImportPreviewPageState();
}

/// One row's editable state. Kept separate from [ImportedCandidateRow] (which
/// is immutable) so every field on the page — email, raw role, category — can
/// be edited in place with a normal [TextEditingController].
class _EditableRow {
  final TextEditingController email;
  final TextEditingController role;
  String? roleCategory;

  _EditableRow({
    required this.email,
    required this.role,
    required this.roleCategory,
  });

  void dispose() {
    email.dispose();
    role.dispose();
  }
}

class _CandidateImportPreviewPageState
    extends State<CandidateImportPreviewPage> {
  late final List<_EditableRow> _rows;
  final _roleConfigRepo = RoleConfigRepository();

  /// Cached per category, so switching a row back to a category already
  /// looked up (or several rows sharing one) never refetches it.
  final Map<String, Future<RoleConfig?>> _pipelineCache = {};

  List<RoleCategoryOption>? _categories;
  bool _categoriesFailed = false;

  @override
  void initState() {
    super.initState();
    _rows = [
      for (final r in widget.rows)
        _EditableRow(
          email: TextEditingController(text: r.email)..addListener(_refresh),
          role: TextEditingController(text: r.role),
          roleCategory:
              (r.roleCategory != null && r.roleCategory!.trim().isNotEmpty)
                  ? r.roleCategory
                  : null,
        ),
    ];
    _loadCategories();
  }

  /// Re-renders on every keystroke in an email field, so the validity icon and
  /// the "Import N candidates" count track what's actually typed.
  void _refresh() {
    if (mounted) setState(() {});
  }

  Future<void> _loadCategories() async {
    try {
      final cats = await candidateImportService.categories();
      if (!mounted) return;
      setState(() => _categories = cats);
    } catch (_) {
      if (!mounted) return;
      setState(() => _categoriesFailed = true);
    }
  }

  @override
  void dispose() {
    for (final r in _rows) {
      r.dispose();
    }
    super.dispose();
  }

  void _removeRow(int i) {
    setState(() {
      _rows.removeAt(i).dispose();
    });
  }

  bool _isValidEmail(_EditableRow r) =>
      Validators.isValidEmail(r.email.text.trim());

  int get _validCount => _rows.where(_isValidEmail).length;

  /// The pipeline configured for [category] for the signed-in recruiter, or
  /// null when none exists yet. Never blocks import either way — see the class
  /// doc.
  Future<RoleConfig?> _pipelineFor(String category) {
    final recruiterId = FirebaseAuth.instance.currentUser?.uid ?? '';
    return _pipelineCache.putIfAbsent(
      category,
      () => _roleConfigRepo.findByRoleCategory(
        recruiterId: recruiterId,
        roleCategory: category,
      ),
    );
  }

  void _confirm() {
    final result = [
      for (final r in _rows)
        if (_isValidEmail(r))
          ImportedCandidateRow(
            email: r.email.text.trim(),
            role: r.role.text.trim(),
            roleCategory: r.roleCategory,
            valid: true,
          ),
    ];
    Navigator.of(context).pop(result);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RecruiterScaffold(
      appBar: AppBar(
        title: const Text('Review import'),
        elevation: 0,
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: _rows.isEmpty
                  ? const RecruiterEmptyState(
                      icon: Icons.person_off_outlined,
                      title: 'No candidates left',
                      description: 'Every row from this file was removed.',
                    )
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(
                        AppSpacing.page,
                        AppSpacing.lg,
                        AppSpacing.page,
                        AppSpacing.lg,
                      ),
                      children: [
                        if (widget.warnings.isNotEmpty) ...[
                          _buildWarningsBanner(theme),
                          const SizedBox(height: AppSpacing.lg),
                        ],
                        Text(
                          '${_rows.length} candidate'
                          '${_rows.length == 1 ? '' : 's'} found — review '
                          'before importing.',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: WarmSurfaces.inkMuted(context),
                          ),
                        ),
                        const SizedBox(height: AppSpacing.md),
                        for (var i = 0; i < _rows.length; i++) ...[
                          _buildRow(theme, i),
                          const SizedBox(height: AppSpacing.md),
                        ],
                      ],
                    ),
            ),
            _buildBottomBar(theme),
          ],
        ),
      ),
    );
  }

  Widget _buildWarningsBanner(ThemeData theme) {
    final tone = StatusTone.borderline(context);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.12),
        borderRadius: AppRadius.all(AppRadius.md),
        border: Border.all(color: tone.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.warning_amber_outlined, size: 18, color: tone),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final w in widget.warnings)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Text(
                      w,
                      style: theme.textTheme.bodySmall?.copyWith(color: tone),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRow(ThemeData theme, int i) {
    final row = _rows[i];
    final valid = _isValidEmail(row);

    return RecruiterPanel(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                valid ? Icons.check_circle_outline : Icons.error_outline,
                size: 18,
                color: valid ? StatusTone.ready(context) : StatusTone.failed(context),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: RecruiterInput(
                  label: 'Email',
                  controller: row.email,
                  hint: 'candidate@example.com',
                  keyboardType: TextInputType.emailAddress,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              IconButton(
                tooltip: 'Remove',
                icon: const Icon(Icons.delete_outline),
                color: theme.colorScheme.error,
                onPressed: () => _removeRow(i),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          RecruiterInput(
            label: 'Role',
            controller: row.role,
            hint: 'e.g. Senior Flutter Engineer',
          ),
          const SizedBox(height: AppSpacing.sm),
          _buildCategoryPicker(theme, row),
          if (row.roleCategory != null) ...[
            const SizedBox(height: AppSpacing.sm),
            _buildPipelineHint(theme, row.roleCategory!),
          ],
        ],
      ),
    );
  }

  Widget _buildCategoryPicker(ThemeData theme, _EditableRow row) {
    if (_categoriesFailed) {
      return Text(
        'Could not load role categories — role will be imported unclassified.',
        style: theme.textTheme.bodySmall
            ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      );
    }
    final cats = _categories;
    if (cats == null) {
      return const SizedBox(
        height: 20,
        child: Center(
          child: SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const RecruiterLabel('Role category'),
        const SizedBox(height: AppSpacing.sm - 2),
        Container(
          decoration: BoxDecoration(
            color: WarmSurfaces.surface(context),
            borderRadius: AppRadius.all(AppRadius.md),
            border: Border.all(color: WarmSurfaces.stroke(context)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String?>(
              isExpanded: true,
              value: row.roleCategory,
              hint: Text(
                'Role: Not detected',
                style: TextStyle(
                  fontSize: 13.5,
                  color: WarmSurfaces.inkSubtle(context),
                ),
              ),
              items: [
                DropdownMenuItem<String?>(
                  value: null,
                  child: Text(
                    'Not detected',
                    style: TextStyle(color: WarmSurfaces.inkMuted(context)),
                  ),
                ),
                for (final c in cats)
                  DropdownMenuItem<String?>(
                    value: c.slug,
                    child: Text(c.displayName),
                  ),
                // A category the server classified this row into but that
                // isn't in the fetched list (stale cache, race with a newly
                // added category) still has to be a valid dropdown value —
                // otherwise Flutter asserts there is no matching item.
                if (row.roleCategory != null &&
                    !cats.any((c) => c.slug == row.roleCategory))
                  DropdownMenuItem<String?>(
                    value: row.roleCategory,
                    child: Text(row.roleCategory!),
                  ),
              ],
              onChanged: (v) => setState(() => row.roleCategory = v),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPipelineHint(ThemeData theme, String category) {
    return FutureBuilder<RoleConfig?>(
      future: _pipelineFor(category),
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const SizedBox.shrink();
        }
        final config = snapshot.data;
        final tone = config != null
            ? StatusTone.ready(context)
            : WarmSurfaces.inkSubtle(context);
        return Row(
          children: [
            Icon(
              config != null
                  ? Icons.check_circle_outline
                  : Icons.info_outline,
              size: 14,
              color: tone,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                config != null
                    ? 'Pipeline: ${config.displayName}'
                    : 'No pipeline configured for this role yet.',
                style: theme.textTheme.bodySmall?.copyWith(color: tone),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildBottomBar(ThemeData theme) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.page,
        AppSpacing.md,
        AppSpacing.page,
        AppSpacing.lg,
      ),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: WarmSurfaces.stroke(context))),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            RecruiterSecondaryButton(
              label: 'Cancel',
              onPressed: () => Navigator.of(context).pop(),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: RecruiterPrimaryButton(
                label: _validCount == 0
                    ? 'Import candidates'
                    : 'Import $_validCount candidate${_validCount == 1 ? '' : 's'}',
                icon: Icons.file_download_done_outlined,
                expand: true,
                onPressed: _validCount == 0 ? null : _confirm,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

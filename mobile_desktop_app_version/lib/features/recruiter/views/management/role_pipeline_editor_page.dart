// lib/features/recruiter/views/management/role_pipeline_editor_page.dart
//
// Create / edit a [RoleConfig]: pick the role category (fixed once created —
// it is identity, matching the backend's `role_configs.build_update`), name
// the pipeline, and design its rounds.
//
// Rounds are authored through the SAME configuration screen a standalone
// interview uses — `CreateInterviewPage.configureRound` — so a template round
// meets a recruiter with identical fields, labels and validation to a live one.
// This screen only manages the LIST of rounds (add, edit, reorder, duplicate,
// delete); it builds no round-configuration UI of its own.

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/models/role_config.dart';
import 'package:talbotiq/features/interviews/recruiter/create_interview_page.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/round_step_tile.dart';
import 'package:talbotiq/features/interviews/services/candidate_import_service.dart';
import 'package:talbotiq/features/interviews/services/role_config_repository.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

class RolePipelineEditorPage extends StatefulWidget {
  /// Null creates a new pipeline; otherwise edits this one.
  final RoleConfig? existing;

  const RolePipelineEditorPage({super.key, this.existing});

  @override
  State<RolePipelineEditorPage> createState() => _RolePipelineEditorPageState();
}

class _RolePipelineEditorPageState extends State<RolePipelineEditorPage> {
  late final TextEditingController _displayName;
  late List<RoleRoundSpec> _rounds;
  String? _roleCategory;
  bool _saving = false;

  Future<List<RoleCategoryOption>>? _categoriesFuture;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    _displayName = TextEditingController(text: widget.existing?.displayName ?? '');
    _rounds = [...?widget.existing?.rounds];
    _roleCategory = widget.existing?.roleCategory;
    if (!_isEdit) _categoriesFuture = candidateImportService.categories();
  }

  @override
  void dispose() {
    _displayName.dispose();
    super.dispose();
  }

  void _toast(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  void _renumber() {
    for (var i = 0; i < _rounds.length; i++) {
      _rounds[i] = _rounds[i].copyWith(order: i);
    }
  }

  Future<void> _addRound() async {
    final draft = await Navigator.of(context).push<InterviewRound>(
      MaterialPageRoute(
        builder: (_) => CreateInterviewPage.configureRound(
          roundOrder: _rounds.length,
          // Pre-fill from the previous round's delivery config, matching the
          // standalone multi-round builder's own behaviour.
          sharedConfig: _rounds.isEmpty || _rounds.last.config.isEmpty
              ? null
              : _rounds.last.config,
        ),
      ),
    );
    if (draft == null || !mounted) return;
    setState(() => _rounds.add(RoleRoundSpec.fromEditedDraft(draft)));
  }

  Future<void> _editRoundAt(int index) async {
    final updated = await Navigator.of(context).push<InterviewRound>(
      MaterialPageRoute(
        builder: (_) => CreateInterviewPage.configureRound(
          roundDraft: _rounds[index].asEditableDraft(),
        ),
      ),
    );
    if (updated == null || !mounted) return;
    setState(() => _rounds[index] = RoleRoundSpec.fromEditedDraft(updated));
  }

  void _duplicateRoundAt(int index) {
    setState(() {
      final r = _rounds[index];
      _rounds.insert(
        index + 1,
        RoleRoundSpec(
          order: index + 1,
          title: '${r.title} (copy)',
          kind: r.kind,
          config: r.config,
          criteria: r.criteria,
          advance: r.advance,
        ),
      );
      _renumber();
    });
  }

  void _removeRoundAt(int index) {
    if (_rounds.length <= 1) {
      _toast('A pipeline needs at least one round.');
      return;
    }
    setState(() {
      _rounds.removeAt(index);
      _renumber();
    });
  }

  Future<void> _save() async {
    if (_roleCategory == null || _roleCategory!.isEmpty) {
      _toast('Choose a role category.');
      return;
    }
    final name = _displayName.text.trim();
    if (name.isEmpty) {
      _toast('Give the pipeline a name.');
      return;
    }
    if (_rounds.isEmpty) {
      _toast('Add at least one round.');
      return;
    }
    if (_rounds.any((r) => r.title.trim().isEmpty)) {
      _toast('Every round needs a title.');
      return;
    }

    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    try {
      final repo = RoleConfigRepository();
      if (_isEdit) {
        final updated = widget.existing!.copyWith(displayName: name, rounds: _rounds);
        await repo.update(updated);
      } else {
        await repo.create(RoleConfig(
          id: '',
          recruiterId: FirebaseAuth.instance.currentUser?.uid ?? '',
          roleCategory: _roleCategory!,
          displayName: name,
          rounds: _rounds,
        ));
      }
      if (!mounted) return;
      navigator.pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text('Could not save: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return RecruiterScaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'Edit pipeline' : 'New pipeline'),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Save'),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            _categoryField(),
            const SizedBox(height: 16),
            RecruiterInput(
              controller: _displayName,
              label: 'Pipeline name',
              hint: 'e.g. Backend Engineer — standard loop',
            ),
            const SizedBox(height: 24),
            _roundsSection(),
          ],
        ),
      ),
    );
  }

  /// A fixed label once created (identity, matching the backend) or a picker
  /// while creating.
  Widget _categoryField() {
    if (_isEdit) {
      return FutureBuilder<List<RoleCategoryOption>>(
        future: candidateImportService.categories(),
        builder: (context, snapshot) {
          final match = snapshot.data?.where((c) => c.slug == _roleCategory);
          final label = (match != null && match.isNotEmpty)
              ? match.first.displayName
              : (_roleCategory ?? '');
          return RecruiterInput(
            label: 'Role category',
            enabled: false,
            controller: TextEditingController(text: label),
          );
        },
      );
    }
    return FutureBuilder<List<RoleCategoryOption>>(
      future: _categoriesFuture,
      builder: (context, snapshot) {
        final options = snapshot.data ?? const <RoleCategoryOption>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const RecruiterLabel('Role category'),
            const SizedBox(height: 6),
            if (snapshot.connectionState == ConnectionState.waiting)
              const LinearProgressIndicator()
            else if (snapshot.hasError)
              Text(
                'Could not load role categories: ${snapshot.error}',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              )
            else
              DropdownButtonFormField<String>(
                initialValue: _roleCategory,
                isExpanded: true,
                decoration: const InputDecoration(
                  isDense: true,
                  border: OutlineInputBorder(),
                ),
                hint: const Text('Choose a role'),
                items: [
                  for (final c in options)
                    DropdownMenuItem(value: c.slug, child: Text(c.displayName)),
                ],
                onChanged: (v) {
                  if (v == null) return;
                  setState(() {
                    final wasEmpty = _displayName.text.trim().isEmpty;
                    _roleCategory = v;
                    if (wasEmpty) {
                      final match = options.where((c) => c.slug == v);
                      if (match.isNotEmpty) _displayName.text = match.first.displayName;
                    }
                  });
                },
              ),
          ],
        );
      },
    );
  }

  Widget _roundsSection() {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Text(
              'Rounds (${_rounds.length})',
              style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
            ),
            const Spacer(),
            Text(
              'Drag to reorder',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (_rounds.isEmpty)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 20),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: theme.colorScheme.outline.withValues(alpha: 0.2),
              ),
            ),
            child: Text(
              'Add the first round to start this pipeline',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          )
        else
          ReorderableListView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            buildDefaultDragHandles: false,
            itemCount: _rounds.length,
            onReorder: (oldIndex, newIndex) => setState(() {
              final to = newIndex > oldIndex ? newIndex - 1 : newIndex;
              final moved = _rounds.removeAt(oldIndex);
              _rounds.insert(to, moved);
              _renumber();
            }),
            itemBuilder: (context, i) => Padding(
              key: ValueKey('role-round-$i-${_rounds[i].title}'),
              padding: const EdgeInsets.only(bottom: 8),
              child: _roundTile(theme, i),
            ),
          ),
        const SizedBox(height: 10),
        RecruiterSecondaryButton(
          label: 'Add round',
          icon: Icons.add,
          expand: true,
          onPressed: _addRound,
        ),
      ],
    );
  }

  Widget _roundTile(ThemeData theme, int i) => RoundStepTile(
        round: _rounds[i].asEditableDraft(),
        position: i + 1,
        total: _rounds.length,
        showConnector: i < _rounds.length - 1,
        onTap: () => _editRoundAt(i),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            PopupMenuButton<String>(
              tooltip: 'Round actions',
              padding: EdgeInsets.zero,
              onSelected: (v) {
                switch (v) {
                  case 'edit':
                    _editRoundAt(i);
                  case 'duplicate':
                    _duplicateRoundAt(i);
                  case 'remove':
                    _removeRoundAt(i);
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'edit', child: Text('Edit')),
                PopupMenuItem(value: 'duplicate', child: Text('Duplicate')),
                PopupMenuItem(value: 'remove', child: Text('Remove')),
              ],
            ),
            ReorderableDragStartListener(
              index: i,
              child: Icon(
                Icons.drag_handle,
                size: 18,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      );
}

// lib/features/recruiter/views/management/role_pipelines_page.dart
//
// Recruiter-side management: reusable per-role interview pipelines. Lists the
// [RoleConfig]s this recruiter owns (the shared, unprefixed `roleConfigs`
// collection — see role_config_repository.dart) and lets them create, edit,
// duplicate and delete one.
//
// A RoleConfig is a TEMPLATE, not a live pipeline: it has no candidates of its
// own. It is materialised into a real `tests/{testId}/rounds` timeline only at
// candidate-import time, matched by role category — see
// `RoleConfigRepository.findByRoleCategory`.

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'package:talbotiq/features/interviews/models/role_config.dart';
import 'package:talbotiq/features/interviews/services/candidate_import_service.dart';
import 'package:talbotiq/features/interviews/services/role_config_repository.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'role_pipeline_editor_page.dart';

class RolePipelinesPage extends StatefulWidget {
  const RolePipelinesPage({super.key});

  @override
  State<RolePipelinesPage> createState() => _RolePipelinesPageState();
}

class _RolePipelinesPageState extends State<RolePipelinesPage> {
  final _repo = RoleConfigRepository();

  /// slug → display name, fetched once and cached for the lifetime of this
  /// screen. The classifier's category list is small and stable (see
  /// `CandidateImportService.categories`), so there is no need to refetch it
  /// per row or per rebuild.
  Map<String, String>? _categoryNames;

  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';

  @override
  void initState() {
    super.initState();
    _loadCategories();
  }

  Future<void> _loadCategories() async {
    try {
      final cats = await candidateImportService.categories();
      if (!mounted) return;
      setState(() {
        _categoryNames = {for (final c in cats) c.slug: c.displayName};
      });
    } catch (_) {
      // A badge that falls back to the raw slug is not worth an error state.
      if (mounted) setState(() => _categoryNames = {});
    }
  }

  String _categoryLabel(String slug) {
    if (slug.isEmpty) return 'Uncategorised';
    return _categoryNames?[slug] ?? slug;
  }

  Future<void> _openEditor(RoleConfig? existing) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => RolePipelineEditorPage(existing: existing),
      ),
    );
    if (saved == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(existing == null ? 'Pipeline created.' : 'Pipeline saved.'),
        ),
      );
    }
  }

  Future<void> _duplicate(RoleConfig config) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await _repo.create(RoleConfig(
        id: '',
        recruiterId: _uid,
        roleCategory: config.roleCategory,
        displayName: '${config.displayName} (copy)',
        rounds: config.rounds,
      ));
      messenger.showSnackBar(
        SnackBar(content: Text('Duplicated "${config.displayName}".')),
      );
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not duplicate: $e')));
    }
  }

  Future<void> _delete(RoleConfig config) async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this pipeline?'),
        content: Text(
          '"${config.displayName}" will be removed. Any test already built '
          'from it keeps its own rounds — this only removes the reusable '
          'template. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _repo.delete(config.id);
      messenger.showSnackBar(
        SnackBar(content: Text('Deleted "${config.displayName}".')),
      );
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not delete: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RecruiterScaffold(
      appBar: AppBar(title: const Text('Role pipelines')),
      floatingActionButton: RecruiterFab(
        onPressed: () => _openEditor(null),
        tooltip: 'New pipeline',
      ),
      body: SafeArea(
        child: StreamBuilder<List<RoleConfig>>(
          stream: _repo.watchForRecruiter(_uid),
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text('Could not load pipelines: ${snapshot.error}'),
                ),
              );
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final configs = snapshot.data!;
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
              children: [
                const RecruiterPageHeader(
                  kicker: 'Library',
                  title: 'Role pipelines',
                  subtitle:
                      'Reusable multi-round pipelines per role, applied '
                      'automatically when candidates are imported.',
                ),
                const SizedBox(height: 20),
                if (configs.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 48),
                    child: RecruiterEmptyState(
                      icon: Icons.route_outlined,
                      title: 'No role pipelines yet',
                      description:
                          'Build a reusable set of rounds for a role — it is '
                          'applied automatically the next time you import '
                          'candidates classified into that role.',
                    ),
                  )
                else
                  for (final c in configs) ...[
                    RecruiterPanel(
                      onTap: () => _openEditor(c),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  c.displayName,
                                  style: theme.textTheme.titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w700),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  _categoryLabel(c.roleCategory),
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.primary,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  c.rounds.isEmpty
                                      ? 'No rounds yet'
                                      : c.rounds.map((r) => r.title).join(' → '),
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          PopupMenuButton<String>(
                            tooltip: 'Actions',
                            onSelected: (v) {
                              switch (v) {
                                case 'edit':
                                  _openEditor(c);
                                case 'duplicate':
                                  _duplicate(c);
                                case 'delete':
                                  _delete(c);
                              }
                            },
                            itemBuilder: (_) => const [
                              PopupMenuItem(value: 'edit', child: Text('Edit')),
                              PopupMenuItem(
                                  value: 'duplicate', child: Text('Duplicate')),
                              PopupMenuItem(value: 'delete', child: Text('Delete')),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
              ],
            );
          },
        ),
      ),
    );
  }
}

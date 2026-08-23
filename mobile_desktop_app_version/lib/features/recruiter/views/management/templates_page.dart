// lib/features/recruiter/views/management/templates_page.dart
//
// Recruiter-side management: reusable interview-template library. Lists the
// templates already held by [RecruiterStore] and lets the recruiter create,
// edit, duplicate, and delete them. This is an ADDITIVE management surface —
// it does not touch any interview-execution code; it only reads/writes the
// existing RecruiterStore template CRUD that was already ported.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/features/recruiter/models/recruiter_models.dart';
import 'package:talbotiq/features/recruiter/store/recruiter_store.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'template_editor_page.dart';

class TemplatesPage extends StatelessWidget {
  const TemplatesPage({super.key});

  Future<void> _openEditor(BuildContext context,
      {InterviewTemplate? existing}) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TemplateEditorPage(existing: existing),
      ),
    );
  }

  Future<void> _duplicate(BuildContext context, InterviewTemplate t) async {
    final store = context.read<RecruiterStore>();
    final messenger = ScaffoldMessenger.of(context);
    final now = DateTime.now().toIso8601String();
    // Round-trip through JSON so every nested config copies faithfully, then
    // stamp a fresh id/name/timestamps. Uses only public model + store API.
    final json = Map<String, dynamic>.from(t.toJson());
    json['id'] = recruiterId('tpl');
    json['name'] = '${t.name} (copy)';
    json['createdAt'] = now;
    json['updatedAt'] = now;
    final saved = await store.upsertTemplate(InterviewTemplate.fromJson(json));
    messenger.showSnackBar(SnackBar(
      content: Text(saved
          ? 'Duplicated “${t.name}”.'
          : 'Duplicated “${t.name}”, but the save did not stick — it may '
              'disappear on restart. Try again.'),
    ));
  }

  Future<void> _delete(BuildContext context, InterviewTemplate t) async {
    final store = context.read<RecruiterStore>();
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete template?'),
        content: Text(
            '“${t.name}” will be removed. This cannot be undone. Interviews '
            'already created from it are not affected.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: Theme.of(ctx).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final saved = await store.deleteTemplate(t.id);
    messenger.showSnackBar(SnackBar(
      content: Text(saved
          ? 'Deleted “${t.name}”.'
          : 'Removed “${t.name}” from this session, but the change did not '
              'save — it may come back on restart. Try again.'),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<RecruiterStore>();
    final templates = [...store.templates]
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

    return RecruiterScaffold(
      appBar: AppBar(title: const Text('Templates')),
      floatingActionButton: RecruiterFab(
        onPressed: () => _openEditor(context),
        icon: Icons.add,
        tooltip: 'New template',
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            const RecruiterPageHeader(
              kicker: 'Library',
              title: 'Interview templates',
              subtitle:
                  'Reusable interview configurations — track, questions, '
                  'scoring rubric and branding.',
            ),
            const SizedBox(height: 20),
            if (templates.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 48),
                child: RecruiterEmptyState(
                  icon: Icons.dashboard_customize_outlined,
                  title: 'No templates yet',
                  description:
                      'Create a reusable template to standardize how a role '
                      'is interviewed and scored.',
                ),
              )
            else
              for (final t in templates) ...[
                _TemplateCard(
                  template: t,
                  onEdit: () => _openEditor(context, existing: t),
                  onDuplicate: () => _duplicate(context, t),
                  onDelete: () => _delete(context, t),
                ),
                const SizedBox(height: 12),
              ],
          ],
        ),
      ),
    );
  }
}

class _TemplateCard extends StatelessWidget {
  final InterviewTemplate template;
  final VoidCallback onEdit;
  final VoidCallback onDuplicate;
  final VoidCallback onDelete;

  const _TemplateCard({
    required this.template,
    required this.onEdit,
    required this.onDuplicate,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final t = template;
    final sourceLabel = t.questionSource == QuestionSource.adaptive
        ? 'Adaptive'
        : 'Fixed set';
    return RecruiterPanel(
      onTap: onEdit,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t.name,
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w700),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 4),
                Text(
                  t.role,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    RecruiterBadge(
                        text: TrackType.label(t.track),
                        color: theme.colorScheme.primary),
                    RecruiterBadge(
                        text: sourceLabel, color: theme.colorScheme.secondary),
                    RecruiterBadge(
                        text: '${t.rubric.kpis.length} KPIs',
                        color: theme.colorScheme.onSurfaceVariant),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  'Updated ${_short(t.updatedAt)}',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          PopupMenuButton<String>(
            tooltip: 'Actions',
            onSelected: (v) {
              switch (v) {
                case 'edit':
                  onEdit();
                  break;
                case 'duplicate':
                  onDuplicate();
                  break;
                case 'delete':
                  onDelete();
                  break;
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'edit', child: Text('Edit')),
              PopupMenuItem(value: 'duplicate', child: Text('Duplicate')),
              PopupMenuItem(value: 'delete', child: Text('Delete')),
            ],
          ),
        ],
      ),
    );
  }

  String _short(String iso) {
    final d = DateTime.tryParse(iso);
    return d == null ? '—' : formatDateTime(d);
  }
}

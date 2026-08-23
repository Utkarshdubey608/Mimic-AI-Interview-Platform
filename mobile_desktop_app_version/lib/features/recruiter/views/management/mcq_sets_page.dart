// lib/features/recruiter/views/management/mcq_sets_page.dart
//
// A recruiter's MCQ papers: list, create, duplicate, delete.
//
// Server-backed, unlike the question-sets page next door, and the difference is not
// arbitrary. A question set is a list of prompts; an MCQ paper CONTAINS THE ANSWER KEY,
// so `firestore.rules` denies clients the collection outright and every read goes
// through `/api/mcq-sets` with ownership checked server-side. There is no local mirror
// to fall back on and nothing to reconcile.
//
// The "ready" badge is the server's answer, recomputed on every read. A paper that is
// not ready still saves — see the editor — because a draft is a legitimate state.

import 'package:flutter/material.dart';

import 'package:talbotiq/features/recruiter/models/mcq_set.dart';
import 'package:talbotiq/features/recruiter/store/mcq_sets_store.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';
import 'mcq_set_editor_page.dart';

class McqSetsPage extends StatefulWidget {
  const McqSetsPage({super.key, this.store});

  /// Injected by tests. Production builds its own.
  final McqSetsStore? store;

  @override
  State<McqSetsPage> createState() => _McqSetsPageState();
}

class _McqSetsPageState extends State<McqSetsPage> {
  late final McqSetsStore _store;

  @override
  void initState() {
    super.initState();
    _store = widget.store ?? McqSetsStore();
    _store.refresh();
  }

  @override
  void dispose() {
    if (widget.store == null) _store.dispose();
    super.dispose();
  }

  Future<void> _openEditor({McqSet? existing}) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => McqSetEditorPage(store: _store, setId: existing?.id),
      ),
    );
    await _store.refresh();
  }

  Future<void> _duplicate(McqSet paper) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await _store.duplicate(paper.id);
      messenger.showSnackBar(SnackBar(content: Text('Duplicated “${paper.name}”.')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _delete(McqSet paper) async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this assessment?'),
        content: Text(
          '“${paper.name}” will be removed, along with its questions and answers. '
          'This cannot be undone.\n\n'
          'Interviews already sent out that use it will stop working.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _store.delete(paper.id);
      messenger.showSnackBar(SnackBar(content: Text('Deleted “${paper.name}”.')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return RecruiterScaffold(
      appBar: AppBar(title: const Text('Assessments')),
      floatingActionButton: RecruiterFab(
        onPressed: () => _openEditor(),
        icon: Icons.add,
        tooltip: 'New assessment',
      ),
      body: SafeArea(
        child: AnimatedBuilder(
          animation: _store,
          builder: (context, _) {
            if (_store.loading && _store.sets.isEmpty) {
              return const Center(child: CircularProgressIndicator());
            }
            if (_store.error != null && _store.sets.isEmpty) {
              return AppErrorState(
                title: 'Could not load your assessments',
                detail: _store.error!,
                onRetry: _store.refresh,
              );
            }
            return RefreshIndicator(
              onRefresh: _store.refresh,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                children: [
                  const RecruiterPageHeader(
                    kicker: 'Library',
                    title: 'Assessments',
                    subtitle:
                        'Multiple-choice papers. Scored exactly and instantly — no '
                        'model reads them, so the result is reproducible.',
                  ),
                  const SizedBox(height: 20),
                  if (_store.sets.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 48),
                      child: RecruiterEmptyState(
                        icon: Icons.fact_check_outlined,
                        title: 'No assessments yet',
                        description:
                            'Write a paper by hand, or generate one from a role and '
                            'edit what comes back.',
                      ),
                    )
                  else
                    for (final paper in _store.sets)
                      _PaperRow(
                        paper: paper,
                        onOpen: () => _openEditor(existing: paper),
                        onDuplicate: () => _duplicate(paper),
                        onDelete: () => _delete(paper),
                      ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _PaperRow extends StatelessWidget {
  const _PaperRow({
    required this.paper,
    required this.onOpen,
    required this.onDuplicate,
    required this.onDelete,
  });

  final McqSet paper;
  final VoidCallback onOpen;
  final VoidCallback onDuplicate;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RecruiterPanel(
      onTap: onOpen,
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  paper.name.isEmpty ? 'Untitled assessment' : paper.name,
                  style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 6),
                Text(
                  [
                    '${paper.questions.length} question${paper.questions.length == 1 ? '' : 's'}',
                    if (paper.isDivided)
                      '${paper.sections.length} section${paper.sections.length == 1 ? '' : 's'}',
                  ].join(' · '),
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
                const SizedBox(height: 8),
                // Says WHY it is not ready, not merely that it is not. The first fault
                // is enough to act on, and the editor lists the rest — a row with six
                // lines of complaint is unreadable.
                if (paper.ready)
                  RecruiterBadge(
                    text: 'Ready to send',
                    color: theme.colorScheme.primary,
                  )
                else
                  Text(
                    paper.faults.isEmpty ? 'Draft' : paper.faults.first,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.error),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
          PopupMenuButton<String>(
            onSelected: (value) => value == 'duplicate' ? onDuplicate() : onDelete(),
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'duplicate', child: Text('Duplicate')),
              PopupMenuItem(value: 'delete', child: Text('Delete')),
            ],
          ),
        ],
      ),
    );
  }
}

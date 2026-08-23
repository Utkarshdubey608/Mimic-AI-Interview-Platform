// lib/features/recruiter/views/management/question_set_editor_page.dart
//
// Create / edit a [QuestionSet]: rename, add / remove / reorder questions, and
// edit each question's text, category, and ideal-answer notes. Additive UI over
// the ported model + RecruiterStore.upsertQuestionSet; no interview code touched.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/features/recruiter/models/recruiter_models.dart';
import 'package:talbotiq/features/recruiter/store/recruiter_store.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

class QuestionSetEditorPage extends StatefulWidget {
  final QuestionSet? existing;
  const QuestionSetEditorPage({super.key, this.existing});

  @override
  State<QuestionSetEditorPage> createState() => _QuestionSetEditorPageState();
}

class _QuestionSetEditorPageState extends State<QuestionSetEditorPage> {
  late final TextEditingController _name;
  late List<FixedQuestion> _questions;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.existing?.name ?? '');
    _questions = [...?widget.existing?.questions];
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _editQuestion(int index) async {
    final result = await showModalBottomSheet<FixedQuestion>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _QuestionEditSheet(question: _questions[index]),
    );
    if (result != null) setState(() => _questions[index] = result);
  }

  Future<void> _addQuestion() async {
    final blank = FixedQuestion(id: recruiterId('q'), text: '');
    final result = await showModalBottomSheet<FixedQuestion>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _QuestionEditSheet(question: blank),
    );
    if (result != null && result.text.trim().isNotEmpty) {
      setState(() => _questions.add(result));
    }
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Give the set a name.')));
      return;
    }
    final cleaned =
        _questions.where((q) => q.text.trim().isNotEmpty).toList();
    if (cleaned.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Add at least one question.')));
      return;
    }
    final store = context.read<RecruiterStore>();
    final messenger = ScaffoldMessenger.of(context);
    final base = widget.existing;
    final now = DateTime.now().toIso8601String();
    final saved = await store.upsertQuestionSet(QuestionSet(
      id: base?.id ?? recruiterId('set'),
      name: name,
      questions: cleaned,
      createdAt: base?.createdAt ?? now,
      updatedAt: now,
    ));
    if (!mounted) return;
    Navigator.of(context).pop();
    messenger.showSnackBar(SnackBar(
      content: Text(saved
          ? 'Saved “$name”.'
          : 'Applied “$name” for this session, but the save did not stick — '
              'it may not survive a restart. Try again.'),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RecruiterScaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'Edit question set' : 'New question set'),
        actions: [
          TextButton(onPressed: _save, child: const Text('Save')),
          const SizedBox(width: 4),
        ],
      ),
      floatingActionButton: RecruiterFab(
        onPressed: _addQuestion,
        icon: Icons.add,
        tooltip: 'Add question',
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
              child: TextField(
                controller: _name,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Set name',
                  hintText: 'e.g. Backend fundamentals',
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 4),
              child: Row(
                children: [
                  Text('Questions',
                      style: theme.textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w600)),
                  const Spacer(),
                  Text('Drag to reorder',
                      style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant)),
                ],
              ),
            ),
            Expanded(
              child: _questions.isEmpty
                  ? Center(
                      child: Text('No questions yet — tap “Add question”.',
                          style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant)),
                    )
                  : ReorderableListView.builder(
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 96),
                      itemCount: _questions.length,
                      onReorder: (oldIndex, newIndex) {
                        setState(() {
                          if (newIndex > oldIndex) newIndex -= 1;
                          final item = _questions.removeAt(oldIndex);
                          _questions.insert(newIndex, item);
                        });
                      },
                      itemBuilder: (context, i) {
                        final q = _questions[i];
                        return Card(
                          key: ValueKey(q.id),
                          margin: const EdgeInsets.symmetric(
                              horizontal: 4, vertical: 6),
                          child: ListTile(
                            leading: CircleAvatar(
                              radius: 14,
                              backgroundColor:
                                  theme.colorScheme.primaryContainer,
                              child: Text('${i + 1}',
                                  style: TextStyle(
                                      fontSize: 12,
                                      color: theme
                                          .colorScheme.onPrimaryContainer)),
                            ),
                            title: Text(
                              q.text.isEmpty ? '(empty question)' : q.text,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            subtitle: (q.category != null &&
                                    q.category!.trim().isNotEmpty)
                                ? Padding(
                                    padding: const EdgeInsets.only(top: 4),
                                    child: Text('Category: ${q.category}',
                                        style: theme.textTheme.bodySmall),
                                  )
                                : null,
                            onTap: () => _editQuestion(i),
                            trailing: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                IconButton(
                                  tooltip: 'Remove',
                                  icon: Icon(Icons.delete_outline,
                                      color: theme.colorScheme.error),
                                  onPressed: () =>
                                      setState(() => _questions.removeAt(i)),
                                ),
                                ReorderableDragStartListener(
                                  index: i,
                                  child: const Padding(
                                    padding: EdgeInsets.all(8),
                                    child: Icon(Icons.drag_handle),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuestionEditSheet extends StatefulWidget {
  final FixedQuestion question;
  const _QuestionEditSheet({required this.question});

  @override
  State<_QuestionEditSheet> createState() => _QuestionEditSheetState();
}

class _QuestionEditSheetState extends State<_QuestionEditSheet> {
  late final TextEditingController _text;
  late final TextEditingController _category;
  late final TextEditingController _notes;

  @override
  void initState() {
    super.initState();
    _text = TextEditingController(text: widget.question.text);
    _category = TextEditingController(text: widget.question.category ?? '');
    _notes = TextEditingController(text: widget.question.idealAnswerNotes ?? '');
  }

  @override
  void dispose() {
    _text.dispose();
    _category.dispose();
    _notes.dispose();
    super.dispose();
  }

  void _done() {
    final cat = _category.text.trim();
    final notes = _notes.text.trim();
    Navigator.of(context).pop(widget.question.copyWith(
      text: _text.text.trim(),
      category: cat.isEmpty ? null : cat,
      idealAnswerNotes: notes.isEmpty ? null : notes,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Question',
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            TextField(
              controller: _text,
              autofocus: true,
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Question text',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _category,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Category (optional)',
                hintText: 'e.g. System design',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _notes,
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Ideal-answer notes (optional)',
                hintText: 'What a strong answer covers.',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: _done, child: const Text('Done')),
          ],
        ),
      ),
    );
  }
}

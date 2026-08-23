// lib/features/recruiter/views/widgets/question_templates_bar.dart
//
// A small, self-contained control that lets any question-editing screen reuse
// saved question templates instead of retyping questions every time. It renders
// two inline actions — "Use template" and "Save as template" — and owns the
// bottom-sheet picker + save-name dialog.
//
// The unit of reuse is RecruiterStore.questionSets (a named, persisted list of
// questions). Recruiters can additionally pull questions from their full
// InterviewTemplates (set `includeInterviewTemplates: true`), which also carry a
// name that can seed the interview title.
//
// It is deliberately storage-agnostic to its host: the host passes the current
// questions in and receives the chosen questions (and an optional title) back
// via [onApply], so both the recruiter Create-interview page and the candidate
// Practice page can share it without either knowing about the other.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/features/recruiter/models/recruiter_models.dart';
import 'package:talbotiq/features/recruiter/store/recruiter_store.dart';

class QuestionTemplatesBar extends StatelessWidget {
  /// Reads the questions currently entered on the host screen (already trimmed
  /// and empties removed) so they can be saved as a template.
  final List<String> Function() currentQuestions;

  /// Called when the user picks a template. [questions] replaces the host's
  /// question list; [title] is a suggested interview/session title (only sent
  /// for InterviewTemplates) that the host may apply if its title is empty.
  final void Function(List<String> questions, {String? title}) onApply;

  /// When true (recruiter), the picker also lists full InterviewTemplates in
  /// addition to plain question sets.
  final bool includeInterviewTemplates;

  const QuestionTemplatesBar({
    super.key,
    required this.currentQuestions,
    required this.onApply,
    this.includeInterviewTemplates = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Wrap(
      spacing: 4,
      runSpacing: 0,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        TextButton.icon(
          onPressed: () => _openPicker(context),
          icon: const Icon(Icons.dashboard_customize_outlined, size: 18),
          label: const Text('Use template'),
          style: TextButton.styleFrom(
            foregroundColor: theme.colorScheme.primary,
            visualDensity: VisualDensity.compact,
          ),
        ),
        TextButton.icon(
          onPressed: () => _saveAsTemplate(context),
          icon: const Icon(Icons.bookmark_add_outlined, size: 18),
          label: const Text('Save as template'),
          style: TextButton.styleFrom(
            foregroundColor: theme.colorScheme.onSurfaceVariant,
            visualDensity: VisualDensity.compact,
          ),
        ),
      ],
    );
  }

  // ── Save current questions as a new reusable set ──────────────────────────
  Future<void> _saveAsTemplate(BuildContext context) async {
    final questions = currentQuestions();
    final messenger = ScaffoldMessenger.of(context);
    final store = context.read<RecruiterStore>();
    if (questions.isEmpty) {
      messenger.showSnackBar(const SnackBar(
        content: Text('Add at least one question before saving a template.'),
      ));
      return;
    }

    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => _NameDialog(count: questions.length),
    );
    if (name == null || name.trim().isEmpty) return;

    final now = DateTime.now().toIso8601String();
    final set = QuestionSet(
      id: recruiterId('set'),
      name: name.trim(),
      questions: questions
          .map((q) => FixedQuestion(id: recruiterId('q'), text: q))
          .toList(),
      createdAt: now,
      updatedAt: now,
    );
    // Not during build — safe to notify listeners.
    store.upsertQuestionSet(set);
    messenger.showSnackBar(SnackBar(
      content: Text('Saved “${set.name}” — ${questions.length} question'
          '${questions.length == 1 ? '' : 's'}.'),
    ));
  }

  // ── Pick a saved template to apply ────────────────────────────────────────
  Future<void> _openPicker(BuildContext context) async {
    final store = context.read<RecruiterStore>();
    final sets = store.questionSets;
    final templates =
        includeInterviewTemplates ? store.templates : const <InterviewTemplate>[];

    if (sets.isEmpty && templates.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
            'No saved templates yet. Build your questions, then “Save as template”.'),
      ));
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => _PickerSheet(
        sets: sets,
        templates: templates,
        resolveTemplateQuestions: (t) => _templateQuestions(store, t),
        onPick: ({required List<String> questions, String? title}) {
          Navigator.of(ctx).pop();
          onApply(questions, title: title);
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(questions.isEmpty
                ? 'Template applied.'
                : 'Loaded ${questions.length} question'
                    '${questions.length == 1 ? '' : 's'} from template.'),
          ));
        },
      ),
    );
  }

  /// Resolves the fixed questions attached to an InterviewTemplate, if any.
  static List<String> _templateQuestions(
      RecruiterStore store, InterviewTemplate t) {
    final setId = t.fixedQuestionSetId;
    if (setId == null) return const [];
    final set = store.questionSetById(setId);
    if (set == null) return const [];
    return set.questions.map((q) => q.text).toList();
  }
}

class _PickerSheet extends StatelessWidget {
  final List<QuestionSet> sets;
  final List<InterviewTemplate> templates;
  final List<String> Function(InterviewTemplate) resolveTemplateQuestions;
  final void Function({required List<String> questions, String? title}) onPick;

  const _PickerSheet({
    required this.sets,
    required this.templates,
    required this.resolveTemplateQuestions,
    required this.onPick,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.7,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
              child: Text(
                'Use a template',
                style: theme.textTheme.titleLarge
                    ?.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
            Flexible(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                shrinkWrap: true,
                children: [
                  if (templates.isNotEmpty) ...[
                    _SectionLabel(theme: theme, text: 'Interview templates'),
                    for (final t in templates)
                      _TemplateTile(
                        icon: Icons.description_outlined,
                        title: t.name,
                        subtitle: [
                          if (t.role.isNotEmpty) t.role,
                          _questionCountLabel(resolveTemplateQuestions(t).length),
                        ].join(' · '),
                        onTap: () => onPick(
                          questions: resolveTemplateQuestions(t),
                          title: t.name,
                        ),
                      ),
                    const SizedBox(height: 8),
                  ],
                  if (sets.isNotEmpty) ...[
                    _SectionLabel(theme: theme, text: 'Question sets'),
                    for (final s in sets)
                      _TemplateTile(
                        icon: Icons.list_alt_outlined,
                        title: s.name,
                        subtitle: _questionCountLabel(s.questions.length),
                        onTap: () => onPick(
                          questions: s.questions.map((q) => q.text).toList(),
                        ),
                      ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _questionCountLabel(int n) =>
      n == 0 ? 'No fixed questions' : '$n question${n == 1 ? '' : 's'}';
}

class _SectionLabel extends StatelessWidget {
  final ThemeData theme;
  final String text;
  const _SectionLabel({required this.theme, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 8, 4, 8),
      child: Text(
        text.toUpperCase(),
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.secondary,
          fontWeight: FontWeight.w600,
          letterSpacing: 1.2,
        ),
      ),
    );
  }
}

class _TemplateTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _TemplateTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            child: Row(
              children: [
                Icon(icon, size: 20, color: theme.colorScheme.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title.isEmpty ? 'Untitled' : title,
                        style: theme.textTheme.bodyLarge
                            ?.copyWith(fontWeight: FontWeight.w600),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right,
                    size: 20, color: theme.colorScheme.onSurfaceVariant),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NameDialog extends StatefulWidget {
  final int count;
  const _NameDialog({required this.count});

  @override
  State<_NameDialog> createState() => _NameDialogState();
}

class _NameDialogState extends State<_NameDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Save as template'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Save these ${widget.count} question'
            '${widget.count == 1 ? '' : 's'} so you can reuse them later.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _controller,
            autofocus: true,
            textInputAction: TextInputAction.done,
            decoration: const InputDecoration(
              labelText: 'Template name',
              hintText: 'e.g. Backend screen — round 1',
            ),
            onSubmitted: (v) => Navigator.of(context).pop(v),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_controller.text),
          child: const Text('Save'),
        ),
      ],
    );
  }
}

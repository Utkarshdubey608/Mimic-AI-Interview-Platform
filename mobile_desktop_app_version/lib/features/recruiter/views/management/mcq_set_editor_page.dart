// lib/features/recruiter/views/management/mcq_set_editor_page.dart
//
// Writing an MCQ paper: sections, questions, answers.
//
// ── Saving is permissive; USING is strict ───────────────────────────────────
// Save is ALWAYS enabled, even on a paper with a blank question and no marked answer.
// Nobody writes a forty-question paper through a sequence of individually valid states:
// you type a question, then its options, then mark the answer, and every moment in
// between is incomplete. The web editor's first version refused those states and the
// "New set" button answered 400 every time.
//
// So the server stores a draft and returns `faults` — what stands between this paper
// and being sendable — which this page shows as a banner. Completeness is enforced when
// a paper is attached to an interview, which is the moment it would otherwise score
// everybody zero.
//
// ── Three question types, one editor ────────────────────────────────────────
// `single` and `multi` differ only in how many answers may be marked, so they share the
// option list and switch the marker between a radio and a checkbox. `match` is a
// different shape — two columns and a pairing — and gets its own rows.
//
// A code snippet is a field on any type rather than a fourth type: coding and debugging
// are assessed here by READING code and answering a closed question about it, which is
// what keeps scoring a comparison rather than an execution.

import 'package:flutter/material.dart';

import 'package:talbotiq/features/recruiter/models/mcq_set.dart';
import 'package:talbotiq/features/recruiter/store/mcq_sets_store.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'mcq_generate_sheet.dart';

/// Ids minted client-side for new rows.
///
/// Monotonic within the session rather than random: the server mints its own id for
/// anything arriving without one, so these only need to be unique inside one editing
/// session — and a readable id makes a mis-wired pairing obvious in a debug dump.
int _seq = 0;
String _newId(String prefix) => '$prefix${DateTime.now().microsecondsSinceEpoch}-${_seq++}';

class McqSetEditorPage extends StatefulWidget {
  const McqSetEditorPage({super.key, required this.store, this.setId});

  final McqSetsStore store;

  /// Null for a new paper.
  final String? setId;

  @override
  State<McqSetEditorPage> createState() => _McqSetEditorPageState();
}

class _McqSetEditorPageState extends State<McqSetEditorPage> {
  final _nameCtrl = TextEditingController();

  List<McqSectionDraft> _sections = [];
  List<McqQuestionDraft> _questions = [];
  List<String> _faults = const [];

  bool _loading = true;
  bool _saving = false;
  String? _error;

  bool get _isNew => widget.setId == null;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _nameCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (_isNew) {
      // One blank question, so a new paper is not an empty screen with nothing to do.
      // This is exactly the state that has to be savable — see the header.
      _questions = [_blankQuestion()];
      setState(() => _loading = false);
      return;
    }
    try {
      final paper = await widget.store.fetch(widget.setId!);
      _nameCtrl.text = paper.name;
      _sections = [...paper.sections];
      _questions = [...paper.questions];
      _faults = paper.faults;
    } catch (e) {
      _error = '$e';
    }
    if (mounted) setState(() => _loading = false);
  }

  McqQuestionDraft _blankQuestion({String? sectionId}) => McqQuestionDraft(
        id: _newId('q'),
        sectionId: sectionId,
        // Two options, because one option is not a question and a recruiter should not
        // have to add the second before they can see what the row looks like.
        options: [
          McqOptionDraft(id: _newId('o'), text: ''),
          McqOptionDraft(id: _newId('o'), text: ''),
        ],
      );

  McqQuestionDraft _blankPairing({String? sectionId}) => McqQuestionDraft(
        id: _newId('q'),
        type: 'match',
        sectionId: sectionId,
        prompts: [
          McqOptionDraft(id: _newId('p'), text: ''),
          McqOptionDraft(id: _newId('p'), text: ''),
        ],
        matches: [
          McqOptionDraft(id: _newId('m'), text: ''),
          McqOptionDraft(id: _newId('m'), text: ''),
        ],
      );

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final stored = await widget.store.save(McqSet(
        id: widget.setId ?? '',
        name: _nameCtrl.text.trim(),
        sections: _sections,
        questions: _questions,
      ));
      if (!mounted) return;
      setState(() {
        _faults = stored.faults;
        _saving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(stored.ready
              ? 'Saved. This assessment is ready to send.'
              : 'Saved as a draft — ${stored.faults.length} thing${stored.faults.length == 1 ? '' : 's'} still to fix.'),
        ),
      );
      if (_isNew) Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _saving = false;
      });
    }
  }

  Future<void> _generate() async {
    final generated = await showModalBottomSheet<McqGeneration>(
      context: context,
      isScrollControlled: true,
      builder: (_) => McqGenerateSheet(store: widget.store),
    );
    if (generated == null || !mounted) return;

    setState(() {
      // APPENDED, never replacing. A recruiter who generated a second batch to top up
      // a paper must not lose the first, and generated questions are for REVIEW — they
      // land in the editor and are saved as a separate act.
      //
      // Blank rows are dropped on the way in: they were placeholders for a paper the
      // recruiter had not started writing, and keeping them would put empty questions
      // in the middle of a generated paper.
      _questions = [
        ..._questions.where((q) => q.text.trim().isNotEmpty),
        ...generated.questions.map((q) => q.copyWith()),
      ];
    });
    if (generated.dropped > 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '${generated.questions.length} of ${generated.requested} kept — '
            '${generated.dropped} came back unusable and were discarded.',
          ),
        ),
      );
    }
  }

  void _addSection() {
    setState(() => _sections = [..._sections, McqSectionDraft(id: _newId('s'))]);
  }

  void _removeSection(int index) {
    final removed = _sections[index];
    setState(() {
      _sections = [..._sections]..removeAt(index);
      // The questions SURVIVE, unsectioned. Deleting somebody's questions because they
      // reorganised the paper would be the worst possible reading of "remove section".
      _questions = [
        for (final q in _questions)
          q.sectionId == removed.id ? q.copyWith(clearSection: true) : q,
      ];
    });
  }

  void _replace(int index, McqQuestionDraft question) {
    setState(() => _questions = [..._questions]..[index] = question);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const RecruiterScaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null && _questions.isEmpty) {
      return RecruiterScaffold(
        appBar: AppBar(),
        body: AppErrorState(title: 'Could not open this assessment', detail: _error!),
      );
    }

    return RecruiterScaffold(
      appBar: AppBar(
        title: Text(_isNew ? 'New assessment' : 'Edit assessment'),
        actions: [
          IconButton(
            tooltip: 'Generate from a role',
            icon: const Icon(Icons.auto_awesome_outlined),
            onPressed: _generate,
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: FilledButton(
          // Never disabled. A draft is a legitimate state — see the header.
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Save'),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          children: [
            if (_error != null) ...[
              _Banner(
                text: _error!,
                color: Theme.of(context).colorScheme.error,
                icon: Icons.error_outline,
              ),
              const SizedBox(height: 12),
            ],
            if (_faults.isNotEmpty) ...[
              _Banner(
                text: 'Not ready to send yet:\n• ${_faults.join('\n• ')}',
                color: Theme.of(context).colorScheme.tertiary,
                icon: Icons.pending_outlined,
              ),
              const SizedBox(height: 12),
            ],
            TextField(
              controller: _nameCtrl,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Assessment name',
                hintText: 'Backend screening',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 20),
            _SectionsEditor(
              sections: _sections,
              onChanged: (i, s) => setState(() => _sections = [..._sections]..[i] = s),
              onAdd: _addSection,
              onRemove: _removeSection,
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: Text('Questions (${_questions.length})',
                      style: Theme.of(context).textTheme.titleMedium),
                ),
              ],
            ),
            const SizedBox(height: 8),
            for (var i = 0; i < _questions.length; i++)
              _QuestionEditor(
                key: ValueKey(_questions[i].id),
                question: _questions[i],
                number: i + 1,
                sections: _sections,
                onChanged: (q) => _replace(i, q),
                onRemove: () => setState(() => _questions = [..._questions]..removeAt(i)),
                newId: _newId,
              ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: () =>
                      setState(() => _questions = [..._questions, _blankQuestion()]),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Add question'),
                ),
                OutlinedButton.icon(
                  onPressed: () =>
                      setState(() => _questions = [..._questions, _blankPairing()]),
                  icon: const Icon(Icons.compare_arrows, size: 18),
                  label: const Text('Add matching'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, required this.color, required this.icon});

  final String text;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        border: Border.all(color: color.withValues(alpha: 0.35)),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: Theme.of(context).textTheme.bodySmall)),
        ],
      ),
    );
  }
}

class _SectionsEditor extends StatelessWidget {
  const _SectionsEditor({
    required this.sections,
    required this.onChanged,
    required this.onAdd,
    required this.onRemove,
  });

  final List<McqSectionDraft> sections;
  final void Function(int index, McqSectionDraft section) onChanged;
  final VoidCallback onAdd;
  final void Function(int index) onRemove;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Sections', style: theme.textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          sections.isEmpty
              ? 'Optional. Add sections to split the paper — an aptitude part and a '
                  'role-based part are reported separately.'
              : 'A candidate meets these in order. A reading passage belongs to a '
                  'section, so several questions can be about one passage.',
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 10),
        for (var i = 0; i < sections.length; i++)
          Card(
            margin: const EdgeInsets.only(bottom: 10),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          initialValue: sections[i].name,
                          decoration: InputDecoration(
                            labelText: 'Section ${i + 1} name',
                            isDense: true,
                            border: const OutlineInputBorder(),
                          ),
                          onChanged: (v) => onChanged(i, sections[i].copyWith(name: v)),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Remove section',
                        icon: const Icon(Icons.close),
                        // Its questions survive, unsectioned — see `_removeSection`.
                        onPressed: () => onRemove(i),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    initialValue: sections[i].instructions ?? '',
                    decoration: const InputDecoration(
                      labelText: 'Instructions (optional)',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (v) =>
                        onChanged(i, sections[i].copyWith(instructions: v)),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    initialValue: sections[i].passage ?? '',
                    maxLines: 4,
                    minLines: 2,
                    decoration: const InputDecoration(
                      labelText: 'Reading passage (optional)',
                      hintText: 'Shown once, above this section’s questions.',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (v) => onChanged(i, sections[i].copyWith(passage: v)),
                  ),
                ],
              ),
            ),
          ),
        OutlinedButton.icon(
          onPressed: onAdd,
          icon: const Icon(Icons.add, size: 18),
          label: const Text('Add section'),
        ),
      ],
    );
  }
}

class _QuestionEditor extends StatelessWidget {
  const _QuestionEditor({
    super.key,
    required this.question,
    required this.number,
    required this.sections,
    required this.onChanged,
    required this.onRemove,
    required this.newId,
  });

  final McqQuestionDraft question;
  final int number;
  final List<McqSectionDraft> sections;
  final ValueChanged<McqQuestionDraft> onChanged;
  final VoidCallback onRemove;
  final String Function(String prefix) newId;

  void _toggleCorrect(String optionId) {
    if (question.isMulti) {
      final key = [...question.correctOptionIds];
      key.contains(optionId) ? key.remove(optionId) : key.add(optionId);
      onChanged(question.copyWith(correctOptionIds: key));
    } else {
      // Single-answer: marking one unmarks the rest, so a paper cannot end up with two
      // "correct" answers to a question that allows one.
      onChanged(question.copyWith(correctOptionIds: [optionId]));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('$number.', style: theme.textTheme.titleMedium),
                const Spacer(),
                if (!question.isPairing)
                  // Switching to multi keeps the marked answers; switching back keeps
                  // only the first, because a single-answer question with two keys is
                  // exactly the state that scores everybody zero.
                  TextButton.icon(
                    onPressed: () => onChanged(question.copyWith(
                      type: question.isMulti ? 'single' : 'multi',
                      correctOptionIds: question.isMulti
                          ? question.correctOptionIds.take(1).toList()
                          : question.correctOptionIds,
                    )),
                    icon: Icon(
                      question.isMulti ? Icons.check_box : Icons.radio_button_checked,
                      size: 16,
                    ),
                    label: Text(question.isMulti ? 'Multi-answer' : 'One answer'),
                  ),
                IconButton(
                  tooltip: 'Remove question',
                  icon: const Icon(Icons.delete_outline),
                  onPressed: onRemove,
                ),
              ],
            ),
            TextFormField(
              initialValue: question.text,
              maxLines: null,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Question',
                isDense: true,
                border: OutlineInputBorder(),
              ),
              onChanged: (v) => onChanged(question.copyWith(text: v)),
            ),
            const SizedBox(height: 10),
            if (question.isPairing)
              _PairingRows(question: question, onChanged: onChanged, newId: newId)
            else
              _OptionRows(
                question: question,
                onChanged: onChanged,
                onToggleCorrect: _toggleCorrect,
                newId: newId,
              ),
            const SizedBox(height: 10),
            _QuestionExtras(question: question, sections: sections, onChanged: onChanged),
          ],
        ),
      ),
    );
  }
}

class _OptionRows extends StatelessWidget {
  const _OptionRows({
    required this.question,
    required this.onChanged,
    required this.onToggleCorrect,
    required this.newId,
  });

  final McqQuestionDraft question;
  final ValueChanged<McqQuestionDraft> onChanged;
  final ValueChanged<String> onToggleCorrect;
  final String Function(String prefix) newId;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final key = question.correctOptionIds.toSet();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Tap the circle to mark the correct answer.',
          style: theme.textTheme.labelSmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 6),
        for (var i = 0; i < question.options.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                IconButton(
                  tooltip: 'Mark as correct',
                  icon: Icon(
                    question.isMulti
                        ? (key.contains(question.options[i].id)
                            ? Icons.check_box
                            : Icons.check_box_outline_blank)
                        : (key.contains(question.options[i].id)
                            ? Icons.radio_button_checked
                            : Icons.radio_button_unchecked),
                    color: key.contains(question.options[i].id)
                        ? theme.colorScheme.primary
                        : theme.colorScheme.outline,
                  ),
                  onPressed: () => onToggleCorrect(question.options[i].id),
                ),
                Expanded(
                  child: TextFormField(
                    initialValue: question.options[i].text,
                    decoration: InputDecoration(
                      hintText: 'Option ${i + 1}',
                      isDense: true,
                      border: const OutlineInputBorder(),
                    ),
                    onChanged: (v) => onChanged(question.copyWith(
                      options: [...question.options]..[i] =
                          question.options[i].copyWith(text: v),
                    )),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  onPressed: () {
                    final removed = question.options[i].id;
                    onChanged(question.copyWith(
                      options: [...question.options]..removeAt(i),
                      // Drop it from the key too, or the paper keeps an answer naming
                      // an option nobody can pick — which the server would strip on
                      // save, leaving the question silently unanswerable.
                      correctOptionIds:
                          question.correctOptionIds.where((k) => k != removed).toList(),
                    ));
                  },
                ),
              ],
            ),
          ),
        TextButton.icon(
          onPressed: () => onChanged(question.copyWith(
            options: [...question.options, McqOptionDraft(id: newId('o'), text: '')],
          )),
          icon: const Icon(Icons.add, size: 16),
          label: const Text('Add option'),
        ),
      ],
    );
  }
}

class _PairingRows extends StatelessWidget {
  const _PairingRows({
    required this.question,
    required this.onChanged,
    required this.newId,
  });

  final McqQuestionDraft question;
  final ValueChanged<McqQuestionDraft> onChanged;
  final String Function(String prefix) newId;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final rows = question.prompts.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Each row is a correct pair. The candidate sees both columns shuffled — the '
          'order you type them in is never what they see.',
          style: theme.textTheme.labelSmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 6),
        for (var i = 0; i < rows; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                Expanded(
                  child: TextFormField(
                    initialValue: question.prompts[i].text,
                    decoration: InputDecoration(
                      hintText: 'Item ${i + 1}',
                      isDense: true,
                      border: const OutlineInputBorder(),
                    ),
                    onChanged: (v) => onChanged(question.copyWith(
                      prompts: [...question.prompts]..[i] =
                          question.prompts[i].copyWith(text: v),
                    )),
                  ),
                ),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 6),
                  child: Icon(Icons.arrow_forward, size: 16),
                ),
                Expanded(
                  child: TextFormField(
                    initialValue: i < question.matches.length ? question.matches[i].text : '',
                    decoration: InputDecoration(
                      hintText: 'Matches ${i + 1}',
                      isDense: true,
                      border: const OutlineInputBorder(),
                    ),
                    onChanged: (v) {
                      final matches = [...question.matches];
                      while (matches.length <= i) {
                        matches.add(McqOptionDraft(id: newId('m'), text: ''));
                      }
                      matches[i] = matches[i].copyWith(text: v);
                      onChanged(question.copyWith(matches: matches));
                    },
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  onPressed: () {
                    // Both halves of the row go together. Removing one side would
                    // shift the pairing by one and silently re-key every row below it.
                    final prompts = [...question.prompts]..removeAt(i);
                    final matches = [...question.matches];
                    if (i < matches.length) matches.removeAt(i);
                    onChanged(question.copyWith(prompts: prompts, matches: matches));
                  },
                ),
              ],
            ),
          ),
        TextButton.icon(
          onPressed: () => onChanged(question.copyWith(
            prompts: [...question.prompts, McqOptionDraft(id: newId('p'), text: '')],
            matches: [...question.matches, McqOptionDraft(id: newId('m'), text: '')],
          )),
          icon: const Icon(Icons.add, size: 16),
          label: const Text('Add pair'),
        ),
      ],
    );
  }
}

class _QuestionExtras extends StatelessWidget {
  const _QuestionExtras({
    required this.question,
    required this.sections,
    required this.onChanged,
  });

  final McqQuestionDraft question;
  final List<McqSectionDraft> sections;
  final ValueChanged<McqQuestionDraft> onChanged;

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.only(bottom: 8),
      title: Text('Details', style: Theme.of(context).textTheme.labelLarge),
      children: [
        if (sections.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: DropdownButtonFormField<String?>(
              initialValue: sections.any((s) => s.id == question.sectionId)
                  ? question.sectionId
                  : null,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Section',
                isDense: true,
                border: OutlineInputBorder(),
              ),
              items: [
                const DropdownMenuItem(value: null, child: Text('No section')),
                for (final s in sections)
                  DropdownMenuItem(
                    value: s.id,
                    child: Text(s.name.isEmpty ? 'Unnamed section' : s.name),
                  ),
              ],
              onChanged: (v) => v == null
                  ? onChanged(question.copyWith(clearSection: true))
                  : onChanged(question.copyWith(sectionId: v)),
            ),
          ),
        TextFormField(
          initialValue: question.topic ?? '',
          decoration: const InputDecoration(
            labelText: 'Topic (optional)',
            hintText: 'Reported per topic on the score breakdown',
            isDense: true,
            border: OutlineInputBorder(),
          ),
          onChanged: (v) => onChanged(question.copyWith(topic: v)),
        ),
        const SizedBox(height: 10),
        TextFormField(
          initialValue: question.code ?? '',
          maxLines: 6,
          minLines: 2,
          style: const TextStyle(fontFamily: 'monospace'),
          decoration: const InputDecoration(
            labelText: 'Code snippet (optional)',
            hintText: 'For a code-reading question. Shown above the options.',
            isDense: true,
            border: OutlineInputBorder(),
          ),
          onChanged: (v) => onChanged(question.copyWith(code: v)),
        ),
        const SizedBox(height: 10),
        TextFormField(
          initialValue: question.explanation ?? '',
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Why the answer is correct (optional)',
            hintText: 'For your report only — never shown to the candidate.',
            isDense: true,
            border: OutlineInputBorder(),
          ),
          onChanged: (v) => onChanged(question.copyWith(explanation: v)),
        ),
        const SizedBox(height: 10),
        TextFormField(
          initialValue: question.points.toStringAsFixed(0),
          keyboardType: TextInputType.number,
          decoration: const InputDecoration(
            labelText: 'Marks',
            isDense: true,
            border: OutlineInputBorder(),
          ),
          onChanged: (v) {
            final points = double.tryParse(v.trim());
            // Ignored rather than defaulted while it is being typed: an empty field
            // mid-edit must not silently reset a 3-mark question to 1.
            if (points != null && points >= 0) {
              onChanged(question.copyWith(points: points));
            }
          },
        ),
      ],
    );
  }
}

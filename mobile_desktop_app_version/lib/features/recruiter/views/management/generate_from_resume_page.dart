// lib/features/recruiter/views/management/generate_from_resume_page.dart
//
// Recruiter-side: generate a reusable question set from a candidate résumé PDF.
// This is a UI wrapper around the ALREADY-PORTED, unchanged
// `recruiterGeminiService.generateQuestionsFromPdf(...)` — no Gemini prompt or
// logic is modified here. Generated questions are reviewed, optionally
// deselected, and saved as a QuestionSet via the existing store CRUD.

import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/features/recruiter/models/recruiter_models.dart';
import 'package:talbotiq/features/recruiter/services/recruiter_gemini_service.dart';
import 'package:talbotiq/features/recruiter/store/recruiter_store.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

class GenerateFromResumePage extends StatefulWidget {
  const GenerateFromResumePage({super.key});

  @override
  State<GenerateFromResumePage> createState() => _GenerateFromResumePageState();
}

class _GenerateFromResumePageState extends State<GenerateFromResumePage> {
  final _role = TextEditingController();
  String _style = QuestionStyle.mix;
  String _difficulty = DifficultyChoice.mixed;
  int _techCount = 3;
  int _nonTechCount = 2;

  String? _fileName;
  bool _busy = false;
  String? _error;
  List<GeneratedInterviewQuestion> _results = [];
  final Set<int> _selected = {};

  @override
  void dispose() {
    _role.dispose();
    super.dispose();
  }

  Future<void> _pickAndGenerate() async {
    if (!recruiterGeminiService.enabled) {
      setState(() => _error =
          'Generating questions needs a Gemini API key. Add one in Settings first.');
      return;
    }
    final res = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
      withData: true,
    );
    if (!mounted || res == null || res.files.isEmpty) return;
    final f = res.files.first;
    final Uint8List? bytes = f.bytes;
    if (bytes == null) {
      setState(() => _error = 'Could not read the selected file.');
      return;
    }
    if (bytes.lengthInBytes > 10 * 1024 * 1024) {
      setState(() => _error = 'PDF is larger than 10 MB.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _fileName = f.name;
      _results = [];
      _selected.clear();
    });
    try {
      final role = _role.text.trim();
      final questions = await recruiterGeminiService.generateQuestionsFromPdf(
        pdfBase64: base64Encode(bytes),
        style: _style,
        technicalCount: _techCount,
        nonTechnicalCount: _nonTechCount,
        difficulty: _difficulty,
        role: role.isEmpty ? null : role,
      );
      if (!mounted) return;
      setState(() {
        _busy = false;
        _results = questions;
        _selected.addAll(List.generate(questions.length, (i) => i));
        // A successful call that yields no questions (e.g. the requested
        // technical/non-technical split has nothing to match in this résumé)
        // is otherwise indistinguishable from the button doing nothing.
        if (questions.isEmpty) {
          _error = 'No questions could be generated from this résumé for the '
              'requested split. Try adjusting the technical / non-technical '
              'counts or role.';
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.toString().replaceAll('Exception: ', '');
      });
    }
  }

  Future<void> _saveAsSet() async {
    final chosen = [
      for (int i = 0; i < _results.length; i++)
        if (_selected.contains(i)) _results[i],
    ];
    if (chosen.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Select at least one question.')));
      return;
    }
    final nameCtrl = TextEditingController(
      text: _role.text.trim().isEmpty
          ? 'Generated set'
          : '${_role.text.trim()} — generated',
    );
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Save question set'),
        content: TextField(
          controller: nameCtrl,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Set name'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, nameCtrl.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    nameCtrl.dispose();
    if (name == null || name.isEmpty) return;
    if (!mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    final now = DateTime.now().toIso8601String();
    final saved = await context.read<RecruiterStore>().upsertQuestionSet(
          QuestionSet(
            id: recruiterId('set'),
            name: name,
            questions: [for (final q in chosen) q.toFixedQuestion()],
            createdAt: now,
            updatedAt: now,
          ),
        );
    if (!mounted) return;
    Navigator.of(context).pop();
    messenger.showSnackBar(SnackBar(
      content: Text(saved
          ? 'Saved “$name” (${chosen.length} questions).'
          : 'Applied “$name” (${chosen.length} questions) for this session, '
              'but the save did not stick — it may not survive a restart. '
              'Try again.'),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RecruiterScaffold(
      appBar: AppBar(title: const Text('Generate from résumé')),
      floatingActionButton: _results.isEmpty
          ? null
          // Labelled rather than a bare "+": the count is the whole point of
          // this action, so it stays on the button.
          : RecruiterFab(
              onPressed: _saveAsSet,
              icon: Icons.save_outlined,
              tooltip: 'Save ${_selected.length} selected question(s) as a set',
            ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
          children: [
            const RecruiterPageHeader(
              kicker: 'AI',
              title: 'Generate questions',
              subtitle:
                  'Upload a candidate résumé (PDF) and generate tailored '
                  'questions, then save them as a reusable set.',
            ),
            const SizedBox(height: 20),
            TextField(
              controller: _role,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Role (optional)',
                hintText: 'e.g. Senior Backend Engineer',
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _style,
                    decoration: const InputDecoration(labelText: 'Style'),
                    items: const [
                      DropdownMenuItem(
                          value: QuestionStyle.mix, child: Text('Mix')),
                      DropdownMenuItem(
                          value: QuestionStyle.technical,
                          child: Text('Technical')),
                      DropdownMenuItem(
                          value: QuestionStyle.nonTechnical,
                          child: Text('Non-technical')),
                    ],
                    onChanged: (v) => setState(() => _style = v ?? _style),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _difficulty,
                    decoration: const InputDecoration(labelText: 'Difficulty'),
                    items: const [
                      DropdownMenuItem(
                          value: DifficultyChoice.mixed, child: Text('Mixed')),
                      DropdownMenuItem(
                          value: DifficultyChoice.easy, child: Text('Easy')),
                      DropdownMenuItem(
                          value: DifficultyChoice.medium,
                          child: Text('Medium')),
                      DropdownMenuItem(
                          value: DifficultyChoice.hard, child: Text('Hard')),
                    ],
                    onChanged: (v) =>
                        setState(() => _difficulty = v ?? _difficulty),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (_style != QuestionStyle.nonTechnical)
              _CountStepper(
                label: 'Technical questions',
                value: _techCount,
                onChanged: (v) => setState(() => _techCount = v),
              ),
            if (_style != QuestionStyle.technical)
              _CountStepper(
                label: 'Non-technical questions',
                value: _nonTechCount,
                onChanged: (v) => setState(() => _nonTechCount = v),
              ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _busy ? null : _pickAndGenerate,
              icon: _busy
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.upload_file),
              label: Text(_busy ? 'Generating…' : 'Pick PDF & generate'),
            ),
            if (_fileName != null) ...[
              const SizedBox(height: 8),
              Text('File: $_fileName',
                  style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant)),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!,
                  style: TextStyle(color: theme.colorScheme.error)),
            ],
            if (_results.isNotEmpty) ...[
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                      child:
                          RecruiterSectionTitle('${_results.length} generated')),
                  TextButton(
                    onPressed: () => setState(() {
                      if (_selected.length == _results.length) {
                        _selected.clear();
                      } else {
                        _selected
                          ..clear()
                          ..addAll(List.generate(_results.length, (i) => i));
                      }
                    }),
                    child: Text(_selected.length == _results.length
                        ? 'Deselect all'
                        : 'Select all'),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              for (int i = 0; i < _results.length; i++)
                _GeneratedTile(
                  q: _results[i],
                  selected: _selected.contains(i),
                  onToggle: () => setState(() {
                    if (!_selected.remove(i)) _selected.add(i);
                  }),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _CountStepper extends StatelessWidget {
  final String label;
  final int value;
  final ValueChanged<int> onChanged;

  const _CountStepper({
    required this.label,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(label)),
          IconButton(
            icon: const Icon(Icons.remove_circle_outline),
            onPressed: value > 0 ? () => onChanged(value - 1) : null,
          ),
          SizedBox(
            width: 28,
            child: Text('$value', textAlign: TextAlign.center),
          ),
          IconButton(
            icon: const Icon(Icons.add_circle_outline),
            onPressed: value < 20 ? () => onChanged(value + 1) : null,
          ),
        ],
      ),
    );
  }
}

class _GeneratedTile extends StatelessWidget {
  final GeneratedInterviewQuestion q;
  final bool selected;
  final VoidCallback onToggle;

  const _GeneratedTile({
    required this.q,
    required this.selected,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: RecruiterPanel(
        padding: const EdgeInsets.all(12),
        onTap: onToggle,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(value: selected, onChanged: (_) => onToggle()),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(q.text, style: theme.textTheme.bodyLarge),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      RecruiterBadge(
                        text: q.type == 'technical' ? 'Technical' : 'Non-tech',
                        color: theme.colorScheme.primary,
                      ),
                      if (q.category.isNotEmpty)
                        RecruiterBadge(
                            text: q.category,
                            color: theme.colorScheme.secondary),
                      if (q.difficulty.isNotEmpty)
                        RecruiterBadge(
                            text: q.difficulty,
                            color: theme.colorScheme.onSurfaceVariant),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

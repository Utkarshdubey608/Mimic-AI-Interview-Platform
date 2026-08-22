// lib/features/recruiter/views/management/mcq_generate_sheet.dart
//
// Generate an MCQ paper from a role: topics, a split, a difficulty.
//
// Two model calls, both one-time at authoring. Neither runs per candidate — a paper is
// written once and sat by everyone, which is why this mode costs almost nothing to
// operate compared with the open-ended tracks.
//
// Generation RETURNS; it does not save. What comes back goes into the editor for review,
// and saving is a separate act — a model call costs something, and a recruiter who
// dislikes the result should not have to delete a set they never wanted.
//
// The vocabulary here (`style`, a count per section) is deliberately the same one the
// invite wizard and the template editor use, so "Mix, 6 and 4" means one thing wherever
// a recruiter meets it.

import 'package:flutter/material.dart';

import 'package:talbotiq/features/recruiter/store/mcq_sets_store.dart';

class McqGenerateSheet extends StatefulWidget {
  const McqGenerateSheet({super.key, required this.store});

  final McqSetsStore store;

  @override
  State<McqGenerateSheet> createState() => _McqGenerateSheetState();
}

class _McqGenerateSheetState extends State<McqGenerateSheet> {
  final _roleCtrl = TextEditingController();

  List<String> _suggested = const [];
  final Set<String> _chosen = {};
  final _ownTopicCtrl = TextEditingController();

  String _style = 'technical';
  int _technical = 8;
  int _nonTechnical = 4;
  String _difficulty = 'mixed';
  bool _allowMulti = false;

  bool _suggesting = false;
  bool _generating = false;
  String? _error;

  @override
  void dispose() {
    _roleCtrl.dispose();
    _ownTopicCtrl.dispose();
    super.dispose();
  }

  Future<void> _suggest() async {
    final role = _roleCtrl.text.trim();
    if (role.isEmpty) return;
    setState(() {
      _suggesting = true;
      _error = null;
    });
    try {
      final topics = await widget.store.suggestTopics(role);
      if (!mounted) return;
      setState(() {
        _suggested = topics;
        // Pre-selected, because the common case is "yes, those" and a recruiter should
        // not have to tap twelve chips to accept an answer they asked for.
        _chosen
          ..clear()
          ..addAll(topics);
      });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
    if (mounted) setState(() => _suggesting = false);
  }

  void _addOwnTopic() {
    final topic = _ownTopicCtrl.text.trim();
    if (topic.isEmpty) return;
    setState(() {
      if (!_suggested.contains(topic)) _suggested = [..._suggested, topic];
      _chosen.add(topic);
      _ownTopicCtrl.clear();
    });
  }

  Future<void> _generate() async {
    final role = _roleCtrl.text.trim();
    if (role.isEmpty || _chosen.isEmpty) return;
    setState(() {
      _generating = true;
      _error = null;
    });
    try {
      final generated = await widget.store.generate(
        role: role,
        topics: _chosen.toList(),
        style: _style,
        technicalCount: _technical,
        nonTechnicalCount: _nonTechnical,
        difficulty: _difficulty,
        allowMulti: _allowMulti,
      );
      if (mounted) Navigator.of(context).pop(generated);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = '$e';
          _generating = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Generate questions', style: theme.textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(
              'Nothing is saved. The questions land in the editor for you to review.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            if (_error != null) ...[
              Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
              const SizedBox(height: 12),
            ],
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _roleCtrl,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Role',
                      hintText: 'Backend engineer',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => _suggest(),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: _suggesting ? null : _suggest,
                  child: _suggesting
                      ? const SizedBox(
                          width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Topics'),
                ),
              ],
            ),
            if (_suggested.isNotEmpty) ...[
              const SizedBox(height: 14),
              Text('Topics', style: theme.textTheme.labelLarge),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final topic in _suggested)
                    FilterChip(
                      label: Text(topic),
                      selected: _chosen.contains(topic),
                      onSelected: (on) => setState(
                        () => on ? _chosen.add(topic) : _chosen.remove(topic),
                      ),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _ownTopicCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Add your own topic',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => _addOwnTopic(),
                  ),
                ),
                IconButton(onPressed: _addOwnTopic, icon: const Icon(Icons.add)),
              ],
            ),
            const SizedBox(height: 16),
            Text('Shape of the paper', style: theme.textTheme.labelLarge),
            const SizedBox(height: 6),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'technical', label: Text('Technical')),
                ButtonSegment(value: 'non_technical', label: Text('Aptitude')),
                ButtonSegment(value: 'mix', label: Text('Mix')),
              ],
              selected: {_style},
              onSelectionChanged: (s) => setState(() => _style = s.first),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                if (_style != 'non_technical')
                  Expanded(
                    child: _CountField(
                      label: 'Technical',
                      value: _technical,
                      onChanged: (v) => setState(() => _technical = v),
                    ),
                  ),
                if (_style == 'mix') const SizedBox(width: 8),
                if (_style != 'technical')
                  Expanded(
                    child: _CountField(
                      label: 'Aptitude',
                      value: _nonTechnical,
                      onChanged: (v) => setState(() => _nonTechnical = v),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'easy', label: Text('Easy')),
                ButtonSegment(value: 'medium', label: Text('Medium')),
                ButtonSegment(value: 'hard', label: Text('Hard')),
                ButtonSegment(value: 'mixed', label: Text('Mixed')),
              ],
              selected: {_difficulty},
              onSelectionChanged: (s) => setState(() => _difficulty = s.first),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _allowMulti,
              onChanged: (v) => setState(() => _allowMulti = v),
              title: const Text('Allow multi-answer questions'),
              subtitle: const Text(
                'Marked all-or-nothing: a candidate must pick every correct option and '
                'no wrong one.',
              ),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _generating || _chosen.isEmpty || _roleCtrl.text.trim().isEmpty
                  ? null
                  : _generate,
              child: _generating
                  ? const SizedBox(
                      width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Generate'),
            ),
          ],
        ),
      ),
    );
  }
}

class _CountField extends StatelessWidget {
  const _CountField({required this.label, required this.value, required this.onChanged});

  final String label;
  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      initialValue: '$value',
      keyboardType: TextInputType.number,
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        border: const OutlineInputBorder(),
      ),
      onChanged: (v) {
        final parsed = int.tryParse(v.trim());
        // Ignored while the field is empty mid-edit rather than defaulted to a number
        // the recruiter did not choose.
        if (parsed != null && parsed > 0) onChanged(parsed);
      },
    );
  }
}

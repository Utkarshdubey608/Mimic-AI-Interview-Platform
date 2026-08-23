// lib/features/recruiter/views/management/template_editor_page.dart
//
// Create / edit an [InterviewTemplate]. Additive management UI over the
// already-ported RecruiterStore + model layer — it never touches interview
// execution. When [existing] is null it creates a new template (seeded from
// engine defaults); otherwise it edits a copy and upserts on save, preserving
// the original id/createdAt and any config sections this editor does not expose
// (timing, integrity, adaptive, conversationTiming) so nothing is lost.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/features/recruiter/engine/defaults.dart';
import 'package:talbotiq/features/recruiter/models/recruiter_models.dart';
import 'package:talbotiq/features/recruiter/store/recruiter_store.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'adaptive_params_editor.dart';

class TemplateEditorPage extends StatefulWidget {
  final InterviewTemplate? existing;
  const TemplateEditorPage({super.key, this.existing});

  @override
  State<TemplateEditorPage> createState() => _TemplateEditorPageState();
}

class _TemplateEditorPageState extends State<TemplateEditorPage> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _role;
  late final TextEditingController _seniority;
  late final TextEditingController _welcome;

  late String _track;
  late String _questionSource;
  late List<KpiDefinition> _kpis;
  late AdaptiveConfig _adaptive;

  bool get _isEdit => widget.existing != null;

  @override
  void initState() {
    super.initState();
    final t = widget.existing;
    _name = TextEditingController(text: t?.name ?? '');
    _role = TextEditingController(text: t?.role ?? 'Software Engineer');
    _seniority = TextEditingController(text: t?.seniority ?? '');
    _welcome = TextEditingController(
        text: t?.branding.welcomeMessage ?? defaultBranding().welcomeMessage);
    _track = t?.track ?? TrackType.chatbot;
    _questionSource = t?.questionSource ?? QuestionSource.fixed;
    final rubric = t?.rubric ?? defaultRubric();
    // Editable working copy so we never mutate the stored template.
    _kpis = rubric.kpis
        .map((k) => k.copyWith())
        .toList(growable: true);
    if (_kpis.isEmpty) {
      _kpis = defaultRubric().kpis.map((k) => k.copyWith()).toList();
    }
    _adaptive = t?.adaptive ?? defaultAdaptive(t?.role ?? 'Software Engineer');
  }

  @override
  void dispose() {
    _name.dispose();
    _role.dispose();
    _seniority.dispose();
    _welcome.dispose();
    super.dispose();
  }

  double get _enabledWeightTotal => _kpis
      .where((k) => k.enabled && k.weight > 0)
      .fold<double>(0, (s, k) => s + k.weight);

  void _addKpi() {
    setState(() {
      _kpis.add(KpiDefinition(
        id: recruiterId('kpi'),
        label: 'New criterion',
        description: '',
        weight: 1,
      ));
    });
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final enabled = _kpis.where((k) => k.enabled).toList();
    if (enabled.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Enable at least one scoring criterion.')));
      return;
    }
    final store = context.read<RecruiterStore>();
    final messenger = ScaffoldMessenger.of(context);
    final now = DateTime.now().toIso8601String();
    final base = widget.existing;
    final seniority = _seniority.text.trim();
    final welcome = _welcome.text.trim();

    final template = InterviewTemplate(
      id: base?.id ?? recruiterId('tpl'),
      name: _name.text.trim(),
      role: _role.text.trim(),
      seniority: seniority.isEmpty ? null : seniority,
      track: _track,
      questionSource: _questionSource,
      fixedQuestionSetId: base?.fixedQuestionSetId,
      timing: base?.timing ?? defaultTiming(),
      rubric: KpiRubric(
        kpis: _kpis,
        scoreScale: base?.rubric.scoreScale ?? 100,
      ),
      integrity: base?.integrity ?? defaultIntegrity(),
      branding: (base?.branding ?? defaultBranding()).copyWith(
        welcomeMessage: welcome.isEmpty ? null : welcome,
      ),
      mode: base?.mode,
      // Persist adaptive params only for the adaptive source; keep the role in
      // sync so generation targets this template's role. Fixed-source templates
      // preserve whatever adaptive config already existed (if any).
      adaptive: _questionSource == QuestionSource.adaptive
          ? _adaptive.copyWith(role: _role.text.trim())
          : base?.adaptive,
      fixedAllowFollowUps: base?.fixedAllowFollowUps,
      conversationTiming: base?.conversationTiming,
      createdAt: base?.createdAt ?? now,
      updatedAt: now,
    );

    final saved = await store.upsertTemplate(template);
    if (!mounted) return;
    Navigator.of(context).pop();
    messenger.showSnackBar(SnackBar(
      content: Text(saved
          ? 'Saved “${template.name}”.'
          : 'Applied “${template.name}” for this session, but the save did '
              'not stick — it may not survive a restart. Try again.'),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RecruiterScaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'Edit template' : 'New template'),
        actions: [
          TextButton(
            onPressed: _save,
            child: const Text('Save'),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
            children: [
              _sectionLabel('Basics'),
              const SizedBox(height: 8),
              TextFormField(
                controller: _name,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'Template name',
                  hintText: 'e.g. Backend Engineer — Screening',
                ),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Name is required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _role,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: 'Role'),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Role is required' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _seniority,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Seniority (optional)',
                  hintText: 'e.g. Senior',
                ),
              ),
              const SizedBox(height: 20),
              _sectionLabel('Format'),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _track,
                decoration: const InputDecoration(labelText: 'Track'),
                items: [
                  for (final t in TrackType.all)
                    DropdownMenuItem(value: t, child: Text(TrackType.label(t))),
                ],
                onChanged: (v) => setState(() => _track = v ?? _track),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _questionSource,
                decoration: const InputDecoration(labelText: 'Question source'),
                items: const [
                  DropdownMenuItem(
                      value: QuestionSource.fixed,
                      child: Text('Fixed question set')),
                  DropdownMenuItem(
                      value: QuestionSource.adaptive,
                      child: Text('Adaptive (AI-generated)')),
                ],
                onChanged: (v) =>
                    setState(() => _questionSource = v ?? _questionSource),
              ),
              if (_questionSource == QuestionSource.adaptive) ...[
                const SizedBox(height: 16),
                AdaptiveParamsEditor(
                  value: _adaptive,
                  onChanged: (c) => setState(() => _adaptive = c),
                ),
              ],
              const SizedBox(height: 20),
              _sectionLabel('Candidate welcome message'),
              const SizedBox(height: 8),
              TextFormField(
                controller: _welcome,
                maxLines: 3,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  hintText: 'Shown to the candidate before they begin.',
                ),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(child: RecruiterSectionTitle('Scoring rubric')),
                  Text(
                    '${_kpis.where((k) => k.enabled).length} active',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Padding(
                padding: const EdgeInsets.only(left: 4, bottom: 8),
                child: Text(
                  'Weights are normalized across enabled criteria.',
                  style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant),
                ),
              ),
              for (int i = 0; i < _kpis.length; i++)
                _KpiRow(
                  key: ValueKey(_kpis[i].id),
                  kpi: _kpis[i],
                  normalizedPct: _kpis[i].enabled && _enabledWeightTotal > 0
                      ? (_kpis[i].weight / _enabledWeightTotal) * 100
                      : 0,
                  onChanged: (updated) =>
                      setState(() => _kpis[i] = updated),
                  onRemove: _kpis.length > 1
                      ? () => setState(() => _kpis.removeAt(i))
                      : null,
                ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _addKpi,
                icon: const Icon(Icons.add),
                label: const Text('Add criterion'),
              ),
              const SizedBox(height: 32),
              FilledButton(
                onPressed: _save,
                child: Text(_isEdit ? 'Save changes' : 'Create template'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sectionLabel(String text) => RecruiterSectionTitle(text);
}

class _KpiRow extends StatelessWidget {
  final KpiDefinition kpi;
  final double normalizedPct;
  final ValueChanged<KpiDefinition> onChanged;
  final VoidCallback? onRemove;

  const _KpiRow({
    super.key,
    required this.kpi,
    required this.normalizedPct,
    required this.onChanged,
    this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: RecruiterPanel(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Switch(
                  value: kpi.enabled,
                  onChanged: (v) => onChanged(kpi.copyWith(enabled: v)),
                ),
                Expanded(
                  child: TextFormField(
                    initialValue: kpi.label,
                    decoration: const InputDecoration(
                      isDense: true,
                      labelText: 'Criterion',
                      border: InputBorder.none,
                    ),
                    onChanged: (v) => onChanged(kpi.copyWith(label: v)),
                  ),
                ),
                if (onRemove != null)
                  IconButton(
                    tooltip: 'Remove',
                    icon: Icon(Icons.delete_outline,
                        color: theme.colorScheme.error),
                    onPressed: onRemove,
                  ),
              ],
            ),
            TextFormField(
              initialValue: kpi.description,
              decoration: const InputDecoration(
                isDense: true,
                labelText: 'What good looks like (optional)',
              ),
              onChanged: (v) => onChanged(kpi.copyWith(description: v)),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                const Text('Weight'),
                Expanded(
                  child: Slider(
                    value: kpi.weight.clamp(0, 10).toDouble(),
                    min: 0,
                    max: 10,
                    divisions: 20,
                    label: kpi.weight.toStringAsFixed(1),
                    onChanged: kpi.enabled
                        ? (v) => onChanged(kpi.copyWith(weight: v))
                        : null,
                  ),
                ),
                SizedBox(
                  width: 52,
                  child: Text(
                    kpi.enabled ? '${normalizedPct.round()}%' : '—',
                    textAlign: TextAlign.right,
                    style: theme.textTheme.labelLarge?.copyWith(
                      color: theme.colorScheme.primary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

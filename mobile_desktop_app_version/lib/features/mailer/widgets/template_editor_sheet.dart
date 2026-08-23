// lib/features/mailer/widgets/template_editor_sheet.dart
//
// Write a custom email template and save it to the mailer backend. Saved
// templates are bound to the signed-in recruiter's email address, so only they
// see it in the picker afterwards.
//
// Opened either blank ("New template") or seeded from an existing one
// ("Duplicate & edit"), which is how a recruiter customises a built-in.

import 'package:flutter/material.dart';

import 'package:talbotiq/features/mailer/models/email_template.dart';
import 'package:talbotiq/features/mailer/services/mailer_service.dart';
import 'package:talbotiq/features/mailer/widgets/mailer_sheet_header.dart';
import 'package:talbotiq/features/mailer/widgets/template_preview.dart';
import 'package:talbotiq/shared/widgets/custom_buttons.dart';
import 'package:talbotiq/shared/widgets/custom_inputs.dart';

class TemplateEditorSheet extends StatefulWidget {
  const TemplateEditorSheet({
    super.key,
    required this.service,
    required this.ownerEmail,
    this.recruiterId,
    this.seed,
    this.variables = kFallbackTemplateVariables,
    this.previewContext = const {},
  });

  final MailerService service;

  /// Recruiter the new template belongs to.
  final String ownerEmail;
  final String? recruiterId;

  /// Template to copy the initial subject/body from (e.g. a built-in).
  final EmailTemplate? seed;

  /// Placeholders offered as insertable chips.
  final Map<String, String> variables;

  /// Values used by the live preview.
  final Map<String, String> previewContext;

  /// Returns the saved template, or null if the recruiter backed out.
  static Future<EmailTemplate?> show(
    BuildContext context, {
    required MailerService service,
    required String ownerEmail,
    String? recruiterId,
    EmailTemplate? seed,
    Map<String, String> variables = kFallbackTemplateVariables,
    Map<String, String> previewContext = const {},
  }) {
    return showModalBottomSheet<EmailTemplate>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => TemplateEditorSheet(
        service: service,
        ownerEmail: ownerEmail,
        recruiterId: recruiterId,
        seed: seed,
        variables: variables,
        previewContext: previewContext,
      ),
    );
  }

  @override
  State<TemplateEditorSheet> createState() => _TemplateEditorSheetState();
}

class _TemplateEditorSheetState extends State<TemplateEditorSheet> {
  late final TextEditingController _name;
  late final TextEditingController _subject;
  late final TextEditingController _body;
  late bool _isHtml;

  /// Which field a variable chip should be inserted into.
  bool _lastFocusWasSubject = false;

  bool _saving = false;
  bool _showPreview = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final seed = widget.seed;
    _name = TextEditingController(
      text: seed == null ? '' : 'Copy of ${seed.name}',
    );
    _subject = TextEditingController(text: seed?.subject ?? '');
    _body = TextEditingController(text: seed?.body ?? '');
    _isHtml = seed?.isHtml ?? true;
    // Re-render the live preview as the recruiter types.
    _subject.addListener(_onChanged);
    _body.addListener(_onChanged);
  }

  void _onChanged() {
    if (_showPreview && mounted) setState(() {});
  }

  @override
  void dispose() {
    _name.dispose();
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  void _insertVariable(String name) {
    final target = _lastFocusWasSubject ? _subject : _body;
    final token = '{{ $name }}';
    final selection = target.selection;
    final text = target.text;
    // Append when the field has never been focused (selection offset is -1).
    if (selection.start < 0) {
      target.text = text + token;
      target.selection = TextSelection.collapsed(offset: target.text.length);
    } else {
      target.text = text.replaceRange(selection.start, selection.end, token);
      target.selection = TextSelection.collapsed(offset: selection.start + token.length);
    }
    setState(() {});
  }

  Future<void> _save() async {
    if (_saving) return;
    final name = _name.text.trim();
    final subject = _subject.text.trim();
    final body = _body.text.trim();

    String? invalid;
    if (name.isEmpty) {
      invalid = 'Give the template a name.';
    } else if (subject.isEmpty) {
      invalid = 'Add a subject line.';
    } else if (body.isEmpty) {
      invalid = 'Add a message body.';
    }
    if (invalid != null) {
      setState(() => _error = invalid);
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final saved = await widget.service.createTemplate(
        ownerEmail: widget.ownerEmail,
        recruiterId: widget.recruiterId,
        name: name,
        subject: subject,
        body: body,
        isHtml: _isHtml,
      );
      if (!mounted) return;
      Navigator.of(context).pop(saved);
    } on MailerException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ctx = widget.previewContext.isEmpty ? sampleContext() : widget.previewContext;

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.9,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (_, scrollController) => Column(
        children: [
          MailerSheetHeader(
            title: widget.seed == null ? 'New email template' : 'Customise template',
            subtitle: 'Saved to ${widget.ownerEmail} — only you will see it.',
            trailing: TextButton.icon(
              onPressed: () => setState(() => _showPreview = !_showPreview),
              icon: Icon(_showPreview ? Icons.edit_outlined : Icons.visibility_outlined, size: 18),
              label: Text(_showPreview ? 'Edit' : 'Preview'),
            ),
          ),
          Expanded(
            child: _showPreview
                ? Padding(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
                    child: TemplatePreview(
                      subject: _subject.text,
                      body: _body.text,
                      isHtml: _isHtml,
                      context: ctx,
                    ),
                  )
                : ListView(
                    controller: scrollController,
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
                    children: [
                      CustomInputField(
                        label: 'Template name',
                        placeholder: 'e.g. Round 2 invite',
                        controller: _name,
                      ),
                      const SizedBox(height: 16),
                      Focus(
                        onFocusChange: (has) {
                          if (has) _lastFocusWasSubject = true;
                        },
                        child: CustomInputField(
                          label: 'Subject',
                          placeholder: 'You\'ve been invited to {{ interview_title }}',
                          controller: _subject,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Focus(
                        onFocusChange: (has) {
                          if (has) _lastFocusWasSubject = false;
                        },
                        child: CustomInputField(
                          label: _isHtml ? 'Body (HTML)' : 'Body (plain text)',
                          placeholder: 'Hi {{ candidate_name }}, …',
                          controller: _body,
                          maxLines: 10,
                        ),
                      ),
                      const SizedBox(height: 8),
                      _VariableChips(
                        variables: widget.variables,
                        onInsert: _insertVariable,
                      ),
                      CustomToggle(
                        label: 'HTML body',
                        description:
                            'Off sends the body as plain text — useful for strict inbox filters.',
                        checked: _isHtml,
                        onChanged: (v) => setState(() => _isHtml = v),
                      ),
                    ],
                  ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Text(
                _error!,
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.colorScheme.error, fontWeight: FontWeight.w600),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
            child: CustomButton(
              text: 'Save template',
              isLoading: _saving,
              width: double.infinity,
              onPressed: _saving ? () {} : _save,
            ),
          ),
        ],
      ),
    );
  }
}

/// Tappable `{{ variable }}` chips that insert at the cursor.
class _VariableChips extends StatelessWidget {
  const _VariableChips({required this.variables, required this.onInsert});

  final Map<String, String> variables;
  final ValueChanged<String> onInsert;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Tap to insert — filled in per candidate when the email is sent.',
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final entry in variables.entries)
              Tooltip(
                message: entry.value,
                child: ActionChip(
                  label: Text('{{ ${entry.key} }}',
                      style: const TextStyle(fontSize: 11)),
                  onPressed: () => onInsert(entry.key),
                ),
              ),
          ],
        ),
      ],
    );
  }
}


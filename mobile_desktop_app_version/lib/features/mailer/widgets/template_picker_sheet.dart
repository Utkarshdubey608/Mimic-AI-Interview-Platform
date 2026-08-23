// lib/features/mailer/widgets/template_picker_sheet.dart
//
// Pick the email a candidate will receive: the built-in templates that ship
// with the mailer backend, plus the ones this recruiter saved (scoped to their
// email address — nobody else's appear here).
//
// Every row can be previewed with sample values before it's chosen, and any
// template can be duplicated into a custom one via the editor sheet.

import 'package:flutter/material.dart';

import 'package:talbotiq/features/mailer/models/email_template.dart';
import 'package:talbotiq/features/mailer/services/mailer_service.dart';
import 'package:talbotiq/features/mailer/widgets/mailer_sheet_header.dart';
import 'package:talbotiq/features/mailer/widgets/template_editor_sheet.dart';
import 'package:talbotiq/features/mailer/widgets/template_preview.dart';
import 'package:talbotiq/shared/widgets/custom_buttons.dart';

class TemplatePickerSheet extends StatefulWidget {
  const TemplatePickerSheet({
    super.key,
    required this.service,
    required this.ownerEmail,
    this.recruiterId,
    this.selectedId,
    this.previewContext = const {},
  });

  final MailerService service;

  /// The signed-in recruiter — scopes which custom templates are listed.
  final String ownerEmail;
  final String? recruiterId;

  /// Currently chosen template id, pre-selected when the sheet opens.
  final String? selectedId;

  /// Values used when previewing (interview title, recruiter, company).
  final Map<String, String> previewContext;

  /// Returns the chosen template, or null if the recruiter dismissed the sheet.
  static Future<EmailTemplate?> show(
    BuildContext context, {
    required MailerService service,
    required String ownerEmail,
    String? recruiterId,
    String? selectedId,
    Map<String, String> previewContext = const {},
  }) {
    return showModalBottomSheet<EmailTemplate>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => TemplatePickerSheet(
        service: service,
        ownerEmail: ownerEmail,
        recruiterId: recruiterId,
        selectedId: selectedId,
        previewContext: previewContext,
      ),
    );
  }

  @override
  State<TemplatePickerSheet> createState() => _TemplatePickerSheetState();
}

class _TemplatePickerSheetState extends State<TemplatePickerSheet> {
  TemplateCatalog? _catalog;
  String? _error;
  bool _loading = true;
  String? _selectedId;

  @override
  void initState() {
    super.initState();
    _selectedId = widget.selectedId;
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final catalog = await widget.service.listTemplates(ownerEmail: widget.ownerEmail);
      if (!mounted) return;
      setState(() {
        _catalog = catalog;
        _selectedId ??= catalog.defaultTemplateId;
        _loading = false;
      });
    } on MailerException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  Map<String, String> get _previewValues =>
      widget.previewContext.isEmpty ? sampleContext() : widget.previewContext;

  Future<void> _preview(EmailTemplate template) async {
    await showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        insetPadding: const EdgeInsets.all(16),
        child: SizedBox(
          width: 640,
          height: MediaQuery.of(ctx).size.height * 0.75,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        template.name,
                        style: Theme.of(ctx)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.of(ctx).pop(),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Expanded(
                  child: TemplatePreview.of(template, context: _previewValues),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Opens the editor seeded from [seed] (null = blank). A saved template is
  /// added to the list and selected straight away.
  Future<void> _createTemplate({EmailTemplate? seed}) async {
    final created = await TemplateEditorSheet.show(
      context,
      service: widget.service,
      ownerEmail: widget.ownerEmail,
      recruiterId: widget.recruiterId,
      seed: seed,
      variables: _catalog?.variables ?? kFallbackTemplateVariables,
      previewContext: _previewValues,
    );
    if (created == null || !mounted) return;
    setState(() {
      _catalog = TemplateCatalog(
        templates: [...?_catalog?.templates, created],
        defaultTemplateId: _catalog?.defaultTemplateId ?? created.id,
        variables: _catalog?.variables ?? kFallbackTemplateVariables,
        warning: _catalog?.warning,
      );
      _selectedId = created.id;
    });
  }

  void _confirm() {
    final templates = _catalog?.templates ?? const <EmailTemplate>[];
    for (final t in templates) {
      if (t.id == _selectedId) {
        Navigator.of(context).pop(t);
        return;
      }
    }
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (_, scrollController) => Column(
        children: [
          MailerSheetHeader(
            title: 'Email template',
            subtitle: 'Pick what candidates receive, or create your own.',
            trailing: IconButton(
              tooltip: 'New template',
              icon: const Icon(Icons.add),
              onPressed: _loading ? null : () => _createTemplate(),
            ),
          ),
          Expanded(child: _buildBody(scrollController)),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
            child: CustomButton(
              text: 'Use this template',
              width: double.infinity,
              onPressed: _selectedId == null ? () {} : _confirm,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(ScrollController scrollController) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    final theme = Theme.of(context);
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.cloud_off_outlined,
                  size: 36, color: theme.colorScheme.onSurfaceVariant),
              const SizedBox(height: 12),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              CustomButton(
                text: 'Retry',
                variant: ButtonVariant.outline,
                height: 44,
                onPressed: _load,
              ),
            ],
          ),
        ),
      );
    }

    final catalog = _catalog!;
    final builtins = catalog.templates.where((t) => t.isBuiltin).toList();
    final mine = catalog.templates.where((t) => !t.isBuiltin).toList();

    return ListView(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
      children: [
        if (catalog.warning != null) ...[
          _WarningBanner(message: catalog.warning!),
          const SizedBox(height: 12),
        ],
        _GroupLabel('Ready-made'),
        for (final t in builtins) _templateTile(t),
        const SizedBox(height: 16),
        _GroupLabel('My templates'),
        if (mine.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              'None yet. Create one, or duplicate a ready-made template to edit its wording.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          )
        else
          for (final t in mine) _templateTile(t),
        const SizedBox(height: 12),
        CustomButton(
          text: 'New template',
          variant: ButtonVariant.outline,
          width: double.infinity,
          height: 44,
          icon: const Icon(Icons.add, size: 18),
          onPressed: () => _createTemplate(),
        ),
      ],
    );
  }

  Widget _templateTile(EmailTemplate template) {
    final theme = Theme.of(context);
    final selected = template.id == _selectedId;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () => setState(() => _selectedId = template.id),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: selected
                ? theme.colorScheme.primary.withValues(alpha: 0.10)
                : Colors.transparent,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: selected
                  ? theme.colorScheme.primary
                  : theme.colorScheme.outline.withValues(alpha: 0.15),
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                selected ? Icons.radio_button_checked : Icons.radio_button_off,
                size: 20,
                color: selected
                    ? theme.colorScheme.primary
                    : theme.colorScheme.onSurfaceVariant,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            template.name,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodyMedium
                                ?.copyWith(fontWeight: FontWeight.w600),
                          ),
                        ),
                        if (template.isDefault) ...[
                          const SizedBox(width: 6),
                          _Tag(label: 'Default', color: theme.colorScheme.primary),
                        ],
                        if (!template.isHtml) ...[
                          const SizedBox(width: 6),
                          _Tag(
                            label: 'Plain text',
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      template.description?.trim().isNotEmpty == true
                          ? template.description!
                          : template.subject,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Preview',
                icon: const Icon(Icons.visibility_outlined, size: 20),
                onPressed: () => _preview(template),
              ),
              IconButton(
                tooltip: 'Duplicate & edit',
                icon: const Icon(Icons.edit_outlined, size: 20),
                onPressed: () => _createTemplate(seed: template),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GroupLabel extends StatelessWidget {
  const _GroupLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text.toUpperCase(),
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
          letterSpacing: 0.8,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(fontSize: 9, fontWeight: FontWeight.w700, color: color),
      ),
    );
  }
}

/// Shown when the recruiter's saved templates couldn't be read but the
/// built-ins are still usable.
class _WarningBanner extends StatelessWidget {
  const _WarningBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.errorContainer.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.warning_amber_outlined, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(message, style: theme.textTheme.bodySmall),
          ),
        ],
      ),
    );
  }
}

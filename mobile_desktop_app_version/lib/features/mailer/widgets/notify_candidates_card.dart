// lib/features/mailer/widgets/notify_candidates_card.dart
//
// The "email the candidates" block on the Create Interview screen: a toggle,
// the chosen template, and the actions to preview it or pick another. State is
// owned by the page (so saving can read it); this widget only reports changes.
//
// When the toggle is switched on and no template has been picked, the backend's
// default template is resolved and shown — so the recruiter always sees exactly
// which email will go out, and a misconfigured mailer surfaces here rather than
// after the interview is already saved.

import 'package:flutter/material.dart';

import 'package:talbotiq/features/mailer/models/email_template.dart';
import 'package:talbotiq/features/mailer/services/mailer_service.dart';
import 'package:talbotiq/features/mailer/widgets/template_picker_sheet.dart';
import 'package:talbotiq/features/mailer/widgets/template_preview.dart';
import 'package:talbotiq/shared/widgets/custom_buttons.dart';
import 'package:talbotiq/shared/widgets/custom_inputs.dart';

class NotifyCandidatesCard extends StatefulWidget {
  const NotifyCandidatesCard({
    super.key,
    required this.service,
    required this.ownerEmail,
    required this.enabled,
    required this.onEnabledChanged,
    required this.template,
    required this.onTemplateChanged,
    this.recruiterId,
    this.candidateCount = 0,
    this.previewContext = const {},
  });

  final MailerService service;

  /// Signed-in recruiter: owns any template they save, and scopes the list.
  final String ownerEmail;
  final String? recruiterId;

  final bool enabled;
  final ValueChanged<bool> onEnabledChanged;

  /// Null means "use the backend's default template".
  final EmailTemplate? template;
  final ValueChanged<EmailTemplate?> onTemplateChanged;

  /// How many candidates are currently on the form — shown in the summary.
  final int candidateCount;

  /// Interview title / recruiter / company used when previewing.
  final Map<String, String> previewContext;

  @override
  State<NotifyCandidatesCard> createState() => _NotifyCandidatesCardState();
}

class _NotifyCandidatesCardState extends State<NotifyCandidatesCard> {
  bool _resolvingDefault = false;
  String? _error;

  @override
  void didUpdateWidget(NotifyCandidatesCard old) {
    super.didUpdateWidget(old);
    // Just switched on with nothing chosen → show which default will be used.
    if (widget.enabled && !old.enabled && widget.template == null) {
      _resolveDefault();
    }
  }

  Future<void> _resolveDefault() async {
    setState(() {
      _resolvingDefault = true;
      _error = null;
    });
    try {
      final catalog = await widget.service.listTemplates(ownerEmail: widget.ownerEmail);
      if (!mounted) return;
      setState(() => _resolvingDefault = false);
      final fallback = catalog.defaultTemplate;
      if (fallback != null && widget.template == null) {
        widget.onTemplateChanged(fallback);
      }
    } on MailerException catch (e) {
      if (!mounted) return;
      setState(() {
        _resolvingDefault = false;
        _error = e.message;
      });
    }
  }

  Future<void> _pick() async {
    final chosen = await TemplatePickerSheet.show(
      context,
      service: widget.service,
      ownerEmail: widget.ownerEmail,
      recruiterId: widget.recruiterId,
      selectedId: widget.template?.id,
      previewContext: widget.previewContext,
    );
    if (chosen != null) widget.onTemplateChanged(chosen);
  }

  Future<void> _preview() async {
    final template = widget.template;
    if (template == null) return;
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
                  child: TemplatePreview.of(
                    template,
                    context: widget.previewContext.isEmpty
                        ? sampleContext()
                        : widget.previewContext,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        CustomToggle(
          label: 'Email candidates',
          description: widget.candidateCount > 0
              ? 'Send the interview link to all ${widget.candidateCount} candidate'
                  '${widget.candidateCount == 1 ? '' : 's'} when this is saved.'
              : 'Send each candidate their interview link when this is saved.',
          checked: widget.enabled,
          onChanged: widget.onEnabledChanged,
        ),
        if (widget.enabled) ...[
          const SizedBox(height: 8),
          if (_error != null)
            _Banner(
              icon: Icons.error_outline,
              color: theme.colorScheme.error,
              message: _error!,
              action: TextButton(
                onPressed: _resolveDefault,
                child: const Text('Retry'),
              ),
            )
          else
            _templateRow(theme),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: CustomButton(
                  text: widget.template == null ? 'Choose template' : 'Change template',
                  variant: ButtonVariant.outline,
                  height: 44,
                  icon: const Icon(Icons.mail_outline, size: 18),
                  onPressed: _pick,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: CustomButton(
                  text: 'Preview',
                  variant: ButtonVariant.outline,
                  height: 44,
                  icon: const Icon(Icons.visibility_outlined, size: 18),
                  onPressed: widget.template == null ? () {} : _preview,
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _templateRow(ThemeData theme) {
    if (_resolvingDefault) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            SizedBox(width: 12),
            Text('Loading templates…'),
          ],
        ),
      );
    }

    final template = widget.template;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.colorScheme.outline.withValues(alpha: 0.12)),
      ),
      child: Row(
        children: [
          Icon(Icons.description_outlined, size: 20, color: theme.colorScheme.primary),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  template?.name ?? 'Default template',
                  style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                Text(
                  template == null
                      ? 'The built-in interview invite will be used.'
                      : renderTemplate(
                          template.subject,
                          widget.previewContext.isEmpty
                              ? sampleContext()
                              : widget.previewContext,
                        ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ),
          ),
          if (template != null && template.isBuiltin)
            Text(
              'Built-in',
              style: theme.textTheme.labelSmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
        ],
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({
    required this.icon,
    required this.color,
    required this.message,
    this.action,
  });

  final IconData icon;
  final Color color;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(child: Text(message, style: theme.textTheme.bodySmall)),
          if (action != null) action!,
        ],
      ),
    );
  }
}

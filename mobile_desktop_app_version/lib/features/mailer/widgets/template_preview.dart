// lib/features/mailer/widgets/template_preview.dart
//
// Shows what a candidate will actually receive: the subject and body with every
// `{{ placeholder }}` filled in from sample values. Rendering is done locally
// (renderTemplate) so the preview needs no round-trip and works before a
// template is even saved.
//
// HTML bodies render in a WebView on mobile; anywhere the WebView plugin isn't
// available the markup is flattened to readable text instead of failing.

import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'package:talbotiq/features/mailer/models/email_template.dart';

/// The rendered subject + body of [template], filled with [context].
class TemplatePreview extends StatelessWidget {
  const TemplatePreview({
    super.key,
    required this.subject,
    required this.body,
    required this.isHtml,
    required this.context,
  });

  /// Builds a preview straight from a template.
  TemplatePreview.of(
    EmailTemplate template, {
    super.key,
    required this.context,
  })  : subject = template.subject,
        body = template.body,
        isHtml = template.isHtml;

  final String subject;
  final String body;
  final bool isHtml;

  /// Values substituted into the placeholders (see [sampleContext]).
  final Map<String, String> context;

  @override
  Widget build(BuildContext buildContext) {
    final theme = Theme.of(buildContext);
    final renderedSubject = renderTemplate(subject, context);
    final renderedBody = renderTemplate(body, context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Subject',
                style: theme.textTheme.labelSmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              const SizedBox(height: 2),
              Text(
                renderedSubject.isEmpty ? '(no subject)' : renderedSubject,
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Container(
              decoration: BoxDecoration(
                border: Border.all(color: theme.colorScheme.outline.withValues(alpha: 0.2)),
                borderRadius: BorderRadius.circular(16),
                color: Colors.white,
              ),
              child: isHtml
                  ? _HtmlBody(html: renderedBody)
                  : SingleChildScrollView(
                      padding: const EdgeInsets.all(16),
                      child: SelectableText(
                        renderedBody,
                        style: const TextStyle(color: Colors.black87, height: 1.5),
                      ),
                    ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Renders an HTML body. Uses a WebView where the plugin is supported
/// (Android/iOS/macOS); elsewhere it degrades to tag-stripped text so the
/// preview still says something useful.
class _HtmlBody extends StatefulWidget {
  const _HtmlBody({required this.html});

  final String html;

  static bool get _webViewSupported =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS ||
          defaultTargetPlatform == TargetPlatform.macOS);

  @override
  State<_HtmlBody> createState() => _HtmlBodyState();
}

class _HtmlBodyState extends State<_HtmlBody> {
  WebViewController? _controller;

  @override
  void initState() {
    super.initState();
    if (_HtmlBody._webViewSupported) _load();
  }

  @override
  void didUpdateWidget(_HtmlBody old) {
    super.didUpdateWidget(old);
    if (old.html != widget.html) _controller?.loadHtmlString(widget.html);
  }

  void _load() {
    try {
      _controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.disabled)
        ..loadHtmlString(widget.html);
    } catch (_) {
      // No WebView implementation registered on this platform — fall back to
      // the text rendering below rather than showing a broken panel.
      _controller = null;
    }
  }

  /// Flattens markup to something readable: block tags become newlines, the
  /// rest are dropped, and the common entities are decoded.
  String get _asText => widget.html
      .replaceAll(RegExp(r'<(script|style)[^>]*>.*?</\1>', dotAll: true, caseSensitive: false), '')
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'</(p|div|h[1-6]|tr|li)>', caseSensitive: false), '\n')
      .replaceAll(RegExp(r'<[^>]+>'), '')
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll(RegExp(r'\n{3,}'), '\n\n')
      .trim();

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null) {
      return SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: SelectableText(
          _asText,
          style: const TextStyle(color: Colors.black87, height: 1.5),
        ),
      );
    }
    return WebViewWidget(controller: controller);
  }
}

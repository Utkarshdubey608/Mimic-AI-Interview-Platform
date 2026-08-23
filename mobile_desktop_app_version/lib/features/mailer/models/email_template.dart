// lib/features/mailer/models/email_template.dart
//
// An email template the recruiter can pick when notifying candidates. Two
// sources, same shape:
//   - `builtin` — ships with the mailer backend, available to everyone
//   - `custom`  — saved by a recruiter, visible only to that email address
//
// Bodies use `{{ variable }}` placeholders which the backend fills per
// recipient at send time; [renderTemplate] does the same substitution locally
// so the preview matches what a candidate receives.

/// Placeholders a template body may contain, with a human-readable hint. Kept
/// in sync with the backend's `SUPPORTED_VARIABLES` (see /api/templates).
const Map<String, String> kFallbackTemplateVariables = {
  'candidate_name': "The candidate's name (falls back to their email).",
  'candidate_email': "The candidate's email address.",
  'interview_title': 'Title of the interview.',
  'interview_link': 'Link that opens the assigned interview.',
  'recruiter_name': 'Name of the recruiter sending the invite.',
  'company': 'Company / organisation name.',
  'deadline': 'When the interview must be completed by.',
};

class EmailTemplate {
  const EmailTemplate({
    required this.id,
    required this.name,
    required this.subject,
    required this.body,
    this.description,
    this.isHtml = true,
    this.source = 'custom',
    this.isDefault = false,
    this.ownerEmail,
  });

  final String id;
  final String name;
  final String? description;
  final String subject;
  final String body;
  final bool isHtml;

  /// 'builtin' or 'custom'.
  final String source;

  /// The one used when a send names no template.
  final bool isDefault;

  /// Owning recruiter's email; null for built-ins.
  final String? ownerEmail;

  bool get isBuiltin => source == 'builtin';

  factory EmailTemplate.fromJson(Map<String, dynamic> json) => EmailTemplate(
        id: (json['id'] ?? '') as String,
        name: (json['name'] ?? 'Untitled template') as String,
        description: json['description'] as String?,
        subject: (json['subject'] ?? '') as String,
        body: (json['body'] ?? '') as String,
        isHtml: json['is_html'] as bool? ?? true,
        source: (json['source'] ?? 'custom') as String,
        isDefault: json['is_default'] as bool? ?? false,
        ownerEmail: json['owner_email'] as String?,
      );
}

final RegExp _placeholder = RegExp(r'{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}');

/// Substitutes `{{ key }}` with [context]'s value; unknown keys render empty —
/// exactly what the backend does, so previews are faithful.
String renderTemplate(String template, Map<String, String> context) {
  return template.replaceAllMapped(
    _placeholder,
    (m) => context[m.group(1)] ?? '',
  );
}

/// Placeholder values used to preview a template before anything is sent.
Map<String, String> sampleContext({
  String? interviewTitle,
  String? recruiterName,
  String? company,
}) =>
    {
      'candidate_name': 'Ada Lovelace',
      'candidate_email': 'ada@example.com',
      'interview_title':
          (interviewTitle?.trim().isNotEmpty ?? false) ? interviewTitle!.trim() : 'Sample interview',
      'interview_link': 'talbotiq://interview/sample',
      'recruiter_name':
          (recruiterName?.trim().isNotEmpty ?? false) ? recruiterName!.trim() : 'Your recruiter',
      'company': (company?.trim().isNotEmpty ?? false) ? company!.trim() : 'Mimic',
      'deadline': 'this Friday',
    };

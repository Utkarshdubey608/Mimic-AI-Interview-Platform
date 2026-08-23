// lib/features/guide/mimic_guide_service.dart
//
// "Mimic Guide" — the in-app AI HELP ASSISTANT for TalbotIQ recruiters. It is a
// product-help chat (NOT an interview / scoring feature): it explains how to use
// templates, question sets, sessions, scoring and reports.
//
// It mirrors the exact Gemini REST approach used by
// lib/features/recruiter/services/recruiter_gemini_service.dart — raw
// generateContent over the shared [ApiClient] (request timeout + 429/503
// backoff), key travelling in the x-goog-api-key header, ```json-safe parsing.
// The Gemini key is the app's single existing key: we read it from
// [recruiterGeminiService], which AppStore keeps in sync on every change, so the
// guide is enabled exactly when the rest of the Gemini features are.



import 'package:talbotiq/core/net/backend_client.dart';

/// One chat turn in the guide conversation.
class GuideMessage {
  final String role; // 'user' | 'assistant'
  final String text;
  const GuideMessage({required this.role, required this.text});

  bool get isUser => role == 'user';
}

class MimicGuideService {
  MimicGuideService({BackendClient? backend}) : _injectedBackend = backend;

  /// Null in production so the shared client resolves lazily.
  final BackendClient? _injectedBackend;
  BackendClient get _backend => _injectedBackend ?? backendClient;

  // Standard Gemini safety thresholds, matching the other services.
  static const List<Map<String, String>> _safetySettings = [
    {'category': 'HARM_CATEGORY_HARASSMENT', 'threshold': 'BLOCK_ONLY_HIGH'},
    {'category': 'HARM_CATEGORY_HATE_SPEECH', 'threshold': 'BLOCK_ONLY_HIGH'},
    {'category': 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'threshold': 'BLOCK_ONLY_HIGH'},
    {'category': 'HARM_CATEGORY_DANGEROUS_CONTENT', 'threshold': 'BLOCK_ONLY_HIGH'},
  ];

  /// Available whenever the backend has Gemini configured. The client holds no
  /// key to check, and /health is the authority — so this no longer gates.
  bool get enabled => true;

  static const String _systemInstruction = '''
You are "Mimic Guide", the friendly in-app product help assistant for Mimic — an AI-powered recruiting and interview platform. You help RECRUITERS learn how to use the app.

Scope of what you help with:
- Interview templates: creating them, setting the role/seniority, and editing the scoring rubric (KPIs).
- Question sets: writing questions, generating them from a candidate résumé, and organising fixed vs. adaptive/conversational interviews.
- Sessions: running an interview (fixed/timed track or the adaptive conversational track), and what happens during a session.
- Scoring: how KPI-based scoring works, what the recommendation (strong_yes / yes / maybe / no) means, and that scoring is AI-assisted and meant to support — not replace — human judgement.
- Reports: reading a candidate's scorecard, per-question feedback, strengths/concerns, and exporting/sharing a report.
- Settings: session setup, recordings, webhooks, candidate emails and appearance. NOTE: API keys are NOT configurable in the app — they are set on the Mimic server by an administrator, so never tell a recruiter to add or change one.

Style:
- Be concise, warm and practical. Prefer short paragraphs and numbered steps for "how do I…" questions.
- Use plain text only — no markdown headings, tables or code fences. Simple numbered or dashed lists are fine.
- If a question is outside Mimic product help (general trivia, coding help, personal advice), gently redirect: say you are the Mimic product guide and offer a relevant thing you can help with instead.
- Never invent features. If you are unsure whether a specific capability exists, say so and suggest checking the relevant section of the app rather than guessing.
- Never ask the user for API keys, passwords or candidate personal data. There is no place in the app to enter an API key.
''';

  /// Send one chat turn. [history] is the full running conversation, oldest
  /// first, with the user's newest message as the last entry. Returns the
  /// assistant's reply text. Throws [Exception] with a user-facing message on
  /// missing key / transport / empty-response errors.
  Future<String> sendMessage(List<GuideMessage> history) async {
    if (history.isEmpty) {
      throw Exception('Nothing to send.');
    }

    final contents = history
        .map((m) => {
              'role': m.isUser ? 'user' : 'model',
              'parts': [
                {'text': m.text}
              ],
            })
        .toList();

    final body = {
      'systemInstruction': {
        'parts': [
          {'text': _systemInstruction}
        ]
      },
      'contents': contents,
      'generationConfig': {
        'temperature': 0.5,
        'maxOutputTokens': 1200,
      },
      'safetySettings': _safetySettings,
    };

    final Map<String, dynamic> data;
    try {
      data = await _backend.postJson('/api/gemini/generate', body: body);
    } on BackendException catch (e) {
      // BackendException already carries a message written for a person; only
      // add guide-specific phrasing where it helps.
      throw Exception(_friendlyError(e));
    }

    // Empty-but-present candidates/parts (MAX_TOKENS, safety block) must not
    // throw via [0] — treat them as an empty reply.
    String? text;
    final candidates = data['candidates'];
    if (candidates is List && candidates.isNotEmpty) {
      final content = candidates[0]?['content'];
      final parts = content is Map ? content['parts'] : null;
      if (parts is List && parts.isNotEmpty) {
        final t = parts[0]?['text'];
        if (t is String) text = t;
      }
    }
    if (text == null || text.trim().isEmpty) {
      throw Exception(
          'The guide could not produce a reply this time. Please rephrase and try again.');
    }
    return text.trim();
  }

  /// Guide-specific phrasing for the cases worth softening.
  ///
  /// The old version sniffed Gemini's error text for "api key" to tell a
  /// recruiter to fix their key in Settings. There is no key in Settings any
  /// more — a credential problem is now the server's, and the backend already
  /// says so in [BackendException.message], so that branch is gone.
  String _friendlyError(BackendException e) {
    if (e.isNotConfigured) return e.message;
    if (e.isAuthError) return 'Your sign-in expired. Sign in again to use the guide.';
    if (e.isRateLimited) {
      return 'The guide is busy right now. Wait a moment and try again.';
    }
    if (e.isTimeout) return 'The guide took too long to respond. Please try again.';
    return 'The guide request failed. Please try again.';
  }
}

final mimicGuideService = MimicGuideService();

// lib/views/setup/launch_payload.dart
import 'package:talbotiq/shared/models/app_models.dart';

/// The prefix put on a Tavus conversation name, so the candidate's name can be
/// recovered from it later.
const String kConversationNamePrefix = 'Mimic — ';

/// Strips that prefix off a stored conversation name.
///
/// Accepts the legacy 'TalbotIQ — ' form too. Conversations created before the
/// rename still carry it, and dropping that case would leave old recordings and
/// old scorecards named "TalbotIQ — Ada Lovelace" instead of "Ada Lovelace".
String stripConversationPrefix(String name) =>
    name.replaceAll(kConversationNamePrefix, '').replaceAll('TalbotIQ — ', '');

// Builds the Tavus create-conversation request body from the persisted session
// config and question list, personalised for the given candidate. Only the
// non-default properties are included so the payload stays minimal.
Map<String, dynamic> buildConversationPayload({
  required DraftForm config,
  required List<String> questions,
  required String candidateName,
}) {
  final validQs = questions.where((q) => q.trim().isNotEmpty).toList();

  // Numbered questions list injected into the system prompt.
  String numbered = '';
  for (int i = 0; i < validQs.length; i++) {
    numbered += '${i + 1}. ${validQs[i]}\n';
  }

  final systemPrompt = config.conversationalContext.trim().isNotEmpty
      ? config.conversationalContext.trim()
      : 'You are Alex, a Senior Talent Specialist at Mimic conducting a screening interview with $candidateName. Maintain a warm, professional tone.';

  final finalContext = '''
$systemPrompt

INTERVIEW SCRIPT — STRICT RULES:
- Ask ONLY the questions listed below, exactly as written, in this exact order.
- Ask one question at a time and wait for $candidateName to fully finish answering before moving to the next.
- Do NOT invent, add, skip, reorder, or rephrase any questions.
- Do NOT ask any follow-up questions that are not in this list.
- After the final question, briefly thank $candidateName and end the interview.

QUESTIONS:
$numbered''';

  final greeting = config.customGreeting.trim().isNotEmpty
      ? config.customGreeting.trim()
      : "Hello $candidateName, welcome to your Mimic interview. I'm excited to learn more about you today. Are you ready to begin?";

  final Map<String, dynamic> body = {
    'replica_id': config.replicaId.trim(),
    'conversation_name': '$kConversationNamePrefix$candidateName',
    'conversational_context': finalContext,
    'custom_greeting': greeting,
  };

  if (config.personaId.trim().isNotEmpty) {
    body['persona_id'] = config.personaId.trim();
  }
  if (config.callbackUrl.trim().isNotEmpty) {
    body['callback_url'] = config.callbackUrl.trim();
  }

  // Only PER-INTERVIEW properties belong here. Recording destination, session
  // timeouts and transcription are org infrastructure: the backend merges them in
  // when it creates the conversation (see app/providers/tavus.py), so the app
  // neither sends nor knows them.
  final Map<String, dynamic> props = {
    'max_call_duration': config.maxCallDuration,
  };

  if (config.language != 'English') {
    props['language'] = config.language;
  }
  if (config.applyConversationOverride) {
    props['apply_conversation_override'] = true;
  }
  if (config.applyGreenscreen) {
    props['apply_greenscreen'] = true;
    if (config.backgroundUrl.trim().isNotEmpty) {
      props['background_url'] = config.backgroundUrl.trim();
    }
  }
  body['properties'] = props;
  return body;
}

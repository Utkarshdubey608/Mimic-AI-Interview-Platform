// lib/features/interviews/candidate/video_launch.dart
//
// Shared Tavus video launch used by both the assigned-interview flow
// (candidate_home) and the self-serve practice flow (practice_page). Mirrors
// setup_page's pre-launch reset + store seeding, then pushes the
// currentRoute-driven CandidateVideoShell. Callers own key selection,
// validation, loading UI and error handling; this throws on failure.

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/shared/models/app_models.dart';
import 'package:talbotiq/shared/providers/app_store.dart';
import 'package:talbotiq/core/services/tavus_service.dart';
import 'package:talbotiq/features/interviews/shared/launch_payload.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/candidate/candidate_video_shell.dart';

/// Creates the Tavus conversation from [config] + [questions], seeds the
/// AppStore and opens the video shell. The Tavus credential lives on the
/// backend, so there is nothing to key up first.
Future<void> launchVideoConversation({
  required BuildContext context,
  required DraftForm config,
  required List<String> questions,
  required String candidateName,
  Interview? interview,
  String? resumeText,
}) async {
  final store = context.read<AppStore>();

  // Ground the avatar in the candidate's résumé when one was provided.
  final effectiveConfig = (resumeText != null && resumeText.trim().isNotEmpty)
      ? config.copyWith(
          conversationalContext:
              '${config.conversationalContext}\n\n'
              'Candidate résumé (use it to tailor and follow up on your questions):\n'
              '${resumeText.trim()}',
        )
      : config;

  final payload = buildConversationPayload(
    config: effectiveConfig,
    questions: questions,
    candidateName: candidateName,
  );
  final conv = await tavusService.createConversation(payload);

  _resetSessionState(store);
  // Carry the real role + duration so scoring isn't judged against a hardcoded
  // default (falls back to the config for self-serve practice).
  store.setActiveInterviewMeta(
    // An assigned timeline document's `title` is the round. Reports need the
    // interview/pipeline name, with the round shown separately where relevant.
    role: interview?.displayTestTitle ?? config.conversationName,
    durationSeconds: (interview?.durationMinutes ?? 0) > 0
        ? interview!.durationMinutes * 60
        : config.maxCallDuration,
  );
  // Practice == launched with no assigned Interview. Recorded before the call
  // so the finished result can be filed under Practice History (or not).
  store.setActiveInterviewIsPractice(interview == null);
  store.setQuestions(questions);
  store.setCurrentConversation(conv);
  store.setInterviewActive(true);
  store.setCurrentQuestionIdx(0);
  store.navigateTo('/interview');

  if (!context.mounted) return;
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => CandidateVideoShell(interview: interview),
    ),
  );
}

/// Mirror of setup_page's pre-launch reset so a prior session doesn't leak.
void _resetSessionState(AppStore store) {
  store.resetQuestionTimestamps();
  store.setRecordingStartTimestamp(null);
  store.clearSessionTranscript();
  store.updateMetrics(conf: 0, anx: 0, w: 0, f: 0, eng: 0);
  store.resetIntegrity();
  store.resetProcessingStage();
}

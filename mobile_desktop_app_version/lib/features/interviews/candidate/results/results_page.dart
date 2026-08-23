// lib/views/results_page.dart
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:flutter/services.dart'; // for clipboard

import 'package:talbotiq/features/interviews/shared/launch_payload.dart';
import 'package:talbotiq/shared/models/app_models.dart';
import 'package:talbotiq/shared/providers/app_store.dart';
import 'package:talbotiq/core/services/gemini_service.dart';
import 'package:talbotiq/core/services/tavus_service.dart';
import 'package:talbotiq/core/services/deepgram_service.dart';
import 'package:talbotiq/shared/widgets/custom_buttons.dart';
import 'package:talbotiq/shared/widgets/response_widgets.dart';

// Modular components
import 'package:talbotiq/features/interviews/candidate/results/widgets/results_modals.dart';
import 'package:talbotiq/features/interviews/candidate/results/widgets/results_loading_view.dart';
import 'package:talbotiq/features/interviews/candidate/results/widgets/ats_assessment_card.dart';
import 'package:talbotiq/features/interviews/candidate/results/widgets/dimension_scores_panel.dart';
import 'package:talbotiq/features/interviews/candidate/results/widgets/strengths_watchpoints_panel.dart';
import 'package:talbotiq/features/interviews/candidate/results/widgets/results_stats_widgets.dart';
import 'package:talbotiq/core/constants/colors.dart';

class ResultsPage extends StatefulWidget {
  const ResultsPage({super.key});

  @override
  State<ResultsPage> createState() => _ResultsPageState();
}

class _ResultsPageState extends State<ResultsPage> {
  bool _geminiLoading = false;
  String? _geminiError;
  ATSScorecard? _atsScorecard;

  bool _scheduleOpen = false;
  bool _offerOpen = false;


  bool _fetchingTranscript = false;

  // Which pipeline actually produced the transcript Gemini will see —
  // 'tavus' | 'deepgram' | null (not yet resolved). Passed into
  // geminiService.analyze() so its prompt names the real ASR source instead
  // of a hardcoded one that may not match what was actually used.
  String? _transcriptSource;

  // ResultsPage lives inside an IndexedStack (always mounted), so initState
  // runs only once at app startup. We instead react to the /results route
  // becoming active — but only (re)generate for a NEW interview. Results are
  // cached per conversation so navigating away and back does NOT re-run Gemini.
  AppStore? _store;
  String? _loadedConvId;
  bool _onResults = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final store = Provider.of<AppStore>(context, listen: false);
    if (!identical(store, _store)) {
      _store?.removeListener(_onRouteChanged);
      _store = store;
      _store!.addListener(_onRouteChanged);
    }
    _onRouteChanged();
  }

  /// Loads results when the user enters /results. Generation runs once per
  /// interview; for an already-analysed session it restores the cached result
  /// instead of re-running the pipeline.
  void _onRouteChanged() {
    final store = _store;
    if (store == null) return;

    // Only act on a transition INTO /results. The listener fires on every
    // store change, so ignore notifications while already on the page —
    // otherwise viewing a past result would reload the current session.
    final onResults = store.currentRoute == '/results';
    if (!onResults) {
      _onResults = false;
      return;
    }
    if (_onResults) return;
    _onResults = true;

    final convId = store.currentConversation?.conversationId ?? '';
    if (_loadedConvId == convId && convId.isNotEmpty) {
      return; // already showing this session's result
    }

    // A freshly-ended interview is the ONLY trigger for running analysis.
    // `pendingAnalysisConvId` is set in _endInterview (on every platform) and
    // is never persisted, so on an app relaunch it is null — meaning we never
    // regenerate; we restore the saved result instead.
    final isPendingFreshAnalysis =
        store.pendingAnalysisConvId == convId && convId.isNotEmpty;
    if (isPendingFreshAnalysis) {
      final cached = store.interviewResults
          .where((r) => r.conversationId == convId)
          .toList();
      if (cached.isNotEmpty) {
        _loadedConvId = convId;
        _applyResult(cached.first);
      } else {
        _loadedConvId = convId;
        _initResults();
      }
      return;
    }

    // No fresh interview (navigated in, or relaunched): show the matching
    // cached result, otherwise the most recently saved one.
    InterviewResult? toShow;
    if (convId.isNotEmpty) {
      final match =
          store.interviewResults.where((r) => r.conversationId == convId);
      if (match.isNotEmpty) toShow = match.first;
    }
    toShow ??=
        store.interviewResults.isNotEmpty ? store.interviewResults.first : null;
    if (toShow != null) {
      _loadedConvId = toShow.conversationId;
      _applyResult(toShow);
    }
  }

  /// Restores a previously-generated result into the view without re-running
  /// any analysis.
  void _applyResult(InterviewResult r) {
    final store = _store;
    if (store == null) return;
    store.updateTranscriptEntries(r.transcript);
    store.updateMetrics(w: r.wpm, f: r.fillers);
    if (!mounted) return;
    setState(() {
      _atsScorecard = r.scorecard;
      _geminiError = null;
      _geminiLoading = false;
      _fetchingTranscript = false;
    });
  }

  @override
  void dispose() {
    _store?.removeListener(_onRouteChanged);
    super.dispose();
  }

  /// Initialises the results page by fetching the transcript.
  Future<void> _initResults() async {
    final store = Provider.of<AppStore>(context, listen: false);
    store.setProcessingStage(InterviewProcessingStage.fetchingTranscript);
    _transcriptSource = null;

    // Both paths run post-call, never live during the interview. Tavus's own
    // server-side transcript is tried first on every platform; transcribing
    // our own locally-recorded .wav via Deepgram is the fallback (native
    // only — see recording_service.dart) if Tavus's transcript is empty.
    await _ensureTranscript();
    if (!mounted) return;
    store.setProcessingStage(InterviewProcessingStage.evaluating);
  }

  /// Builds the session transcript. Prefers Tavus's own server-side
  /// transcript (sliced per-question — see TavusService.sliceTranscriptByQuestion),
  /// the same source and slicing on every platform. Falls back to
  /// transcribing the candidate's locally-recorded .wav via Deepgram (native
  /// only) if Tavus's transcript is empty/unavailable.
  Future<void> _ensureTranscript() async {
    final store = Provider.of<AppStore>(context, listen: false);

    // Preferred path (all platforms): Tavus's own server-side transcript.
    //
    // Use the key that CREATED this conversation. tavusService already holds
    // it (practice sets it straight on the service from its own form field and
    // A conversation is read back through the backend, which holds the single
    // org Tavus key — so there is no per-account key to match up any more. (This
    // used to juggle two in-memory keys, which is what made Tavus reject a
    // practice conversation as
    // `400 Invalid conversation_id`.)
    final conv = store.currentConversation;
    if (conv != null && conv.conversationId.isNotEmpty) {
      setState(() => _fetchingTranscript = true);
      try {
        final raw = await tavusService.fetchTranscriptWithRetry(
          conv.conversationId,
          maxAttempts: 18,
          initialDelay: const Duration(seconds: 5),
        );
        final sliced = tavusService.sliceTranscriptByQuestion(
          raw,
          store.questions,
        );
        debugPrint(
          'DEBUG: Tavus transcript: ${raw.length} entries, sliced across '
          '${store.questions.length} questions.',
        );

        if (sliced.isNotEmpty) {
          store.clearSessionTranscript();
          for (final e in sliced) {
            store.pushTranscriptEntry(e);
          }
          _transcriptSource = 'tavus';

          // Derive speech metrics from the candidate's turns so the scorecard
          // isn't all zeros.
          final int fillers = store.sessionTranscript
              .where((t) => t.role == 'candidate')
              .fold(0, (acc, e) => acc + deepgramService.countFillers(e.text));
          final int wpm = deepgramService.calcWpm(store.sessionTranscript);
          store.updateMetrics(w: wpm, f: fillers);
        }
      } catch (e) {
        debugPrint('Tavus transcript fetch failed: $e');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Unable to fetch transcript from Tavus: $e'),
              backgroundColor: AppColors.pastelPeach,
            ),
          );
        }
      } finally {
        if (mounted) setState(() => _fetchingTranscript = false);
      }
    }

    // Tavus already gave us a transcript — done.
    if (store.sessionTranscript.isNotEmpty) return;

    // Fallback path (native only): transcribe our own locally-recorded audio.
    final bytes = store.recordingBytes;
    debugPrint('debug[rec]: results recordingBytes=${bytes?.length ?? 0}');
    if (bytes == null || bytes.isEmpty) return;

    setState(() => _fetchingTranscript = true);
    try {
      final entries = await deepgramService.transcribeFromFile(
        bytes,
        language: DeepgramService.localeFor(store.activeInterviewLanguage),
        recordingStartTimestamp: store.recordingStartTimestamp,
        questionTimestamps: store.questionTimestamps,
        questionCount: store.questions.length,
      );
      if (entries.isNotEmpty) {
        store.clearSessionTranscript();
        for (final e in entries) {
          store.pushTranscriptEntry(e);
        }
        _transcriptSource = 'deepgram';
        final int fillers = store.sessionTranscript
            .where((t) => t.role == 'candidate')
            .fold(0, (acc, e) => acc + deepgramService.countFillers(e.text));
        final int wpm = deepgramService.calcWpm(store.sessionTranscript);
        store.updateMetrics(w: wpm > 0 ? wpm : store.wpm, f: fillers);
      }
    } catch (e) {
      debugPrint('Deepgram file transcription failed: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Unable to transcribe recording: $e'),
            backgroundColor: AppColors.pastelPeach,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _fetchingTranscript = false);
    }
  }

  /// Runs the Gemini ATS analysis over the captured transcript.
  Future<void> _runAtsAnalysis() async {
    final store = Provider.of<AppStore>(context, listen: false);

    if (store.sessionTranscript.isEmpty) {
      const msg =
          'Failed: No transcript entries captured. ATS scorecard requires interview dialogue.';
      setState(() {
        _geminiError = msg;
        _geminiLoading = false;
      });
      store.setProcessingStage(InterviewProcessingStage.failed, error: msg);
      return;
    }

    setState(() {
      _geminiLoading = true;
      _geminiError = null;
    });

    try {
      final scorecard = await geminiService.analyze(
        candidateName:
            stripConversationPrefix(
                store.currentConversation?.conversationName ?? 'Candidate'),
        jobRole: store.activeInterviewRole,
        interviewDurationSeconds: store.activeInterviewDurationSeconds > 0
            ? store.activeInterviewDurationSeconds
            : 120,
        transcript: store.sessionTranscript,
        questions: store.questions,
        wpm: store.wpm,
        totalFillers: store.fillers,
        transcriptSource: _transcriptSource,
      );

      if (mounted) {
        setState(() {
          _atsScorecard = scorecard;
        });
      }

      // Persist this finished result to history so it can be revisited /
      // deleted later and is never regenerated on navigation. This must run
      // regardless of mounted — an assigned interview's shell reads the result
      // out of the store, so we cannot skip it if the page was disposed.
      final score = scorecard.overallFitScore ?? 0;
      // For an assigned interview, CandidateVideoShell._maybeStoreResult picks
      // this up (it reacts to interviewResults gaining a matching entry) and
      // carries the stage the rest of the way to sendingToRecruiter/complete.
      store.setProcessingStage(InterviewProcessingStage.sendingToRecruiter);
      store.addInterviewResult(
        InterviewResult(
          id: 'res-${DateTime.now().millisecondsSinceEpoch}',
          conversationId: store.currentConversation?.conversationId ?? '',
          name: stripConversationPrefix(
              store.currentConversation?.conversationName ?? 'Interview'),
          createdAt: DateTime.now().toIso8601String(),
          score: score,
          wpm: store.wpm,
          fillers: store.fillers,
          transcript: List<TranscriptEntry>.from(store.sessionTranscript),
          scorecard: scorecard,
          isPractice: store.activeInterviewIsPractice,
        ),
      );
      // The recording has now been analysed and saved — clear the "pending"
      // bytes so navigating back or relaunching never re-runs analysis.
      store.setRecordingBytes(null);
    } catch (e) {
      // Must run regardless of mounted, same reasoning as the success path
      // above — the candidate-facing pending screen needs this even if
      // ResultsPage itself isn't currently visible.
      final msg = e.toString().replaceAll('Exception: ', '');
      store.setProcessingStage(InterviewProcessingStage.failed, error: msg);
      if (!mounted) return;
      setState(() {
        _geminiError = msg;
      });
    } finally {
      if (mounted) setState(() => _geminiLoading = false);
    }
  }

  /// Maps composite score to verbal candidate fit verdict.
  String _getScoreVerdict(int score) {
    if (score >= 85) return 'Excellent candidate';
    if (score >= 70) return 'Good candidate';
    if (score >= 60) return 'Potential candidate';
    return 'Needs further review';
  }

  /// Copies text report summary to system clipboard.
  void _shareProfile(
    BuildContext context,
    int score,
    String verdict,
    String? jobId,
  ) {
    final theme = Theme.of(context);
    final text =
        'Mimic report — Score: $score/100 — $verdict — Session: ${jobId ?? 'TIQ-demo'}';
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Report details copied to clipboard'),
        backgroundColor: theme.colorScheme.primary,
      ),
    );
  }

  /// Builds the interview transcript card from the session transcript
  /// (produced by transcribing the candidate's recording via Deepgram).
  Widget _buildTranscriptCard(BuildContext context, AppStore store) {
    final theme = Theme.of(context);
    // Excludes Tavus-injected config turns persisted before the
    // parse-time filter existed (see isNonDialogueTurn).
    final entries = store.sessionTranscript
        .where((e) => !isNonDialogueTurn(e.text))
        .toList();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.article_outlined,
                    size: 20, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text(
                  'Interview transcript',
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'Transcript captured from your interview session.',
              style: theme.textTheme.bodyMedium?.copyWith(fontSize: 12),
            ),
            const SizedBox(height: 16),
            if (entries.isEmpty)
              Text(
                'No transcript available for this session.',
                style: theme.textTheme.bodyMedium
                    ?.copyWith(fontStyle: FontStyle.italic),
              )
            else
              ...entries.map((e) {
                final isCandidate = e.role == 'candidate';
                return Container(
                  width: double.infinity,
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.onSurface.withOpacity(0.04),
                    border: Border.all(
                      color: theme.colorScheme.outline.withOpacity(0.12),
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isCandidate ? 'Candidate' : 'Interviewer',
                        style: TextStyle(
                          color: isCandidate
                              ? theme.colorScheme.primary
                              : theme.colorScheme.secondary,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 6),
                      SelectableText(
                        e.text,
                        style: TextStyle(
                          color: theme.colorScheme.onSurface,
                          fontSize: 14,
                          height: 1.5,
                        ),
                      ),
                    ],
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }

  /// Builds recruiter quick actions card layout.
  Widget _buildRecruiterActions(
    BuildContext context,
    int overallScore,
    String verdict,
    String? jobId,
  ) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Recruiter actions',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                CustomButton(
                  text: 'Schedule technical interview',
                  onPressed: () => setState(() => _scheduleOpen = true),
                ),
                CustomButton(
                  text: 'Share profile summary',
                  variant: ButtonVariant.secondary,
                  onPressed: () =>
                      _shareProfile(context, overallScore, verdict, jobId),
                ),
                CustomButton(
                  text: 'Generate AI Offer Rec.',
                  variant: ButtonVariant.secondary,
                  onPressed: () => setState(() => _offerOpen = true),
                ),
                CustomButton(
                  text: 'New session',
                  variant: ButtonVariant.ghost,
                  onPressed: () {
                    final store = Provider.of<AppStore>(context, listen: false);
                    store.reset();
                    store.navigateTo('/setup');
                  },
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final store = Provider.of<AppStore>(context);

    // Unified progressive loading screen for background tasks
    final showLoader = _fetchingTranscript || _geminiLoading;

    if (showLoader) {
      return ResultsLoadingView(
        fetchingTranscript: _fetchingTranscript,
        geminiLoading: _geminiLoading,
        sessionTranscript: store.sessionTranscript,
        atsScorecard: _atsScorecard,
        geminiError: _geminiError,
      );
    }

    final bool noCurrentResult = store.sessionTranscript.isEmpty;

    if (noCurrentResult) {
      // Past attempts are no longer listed here — the Practice History tab is
      // the single place to browse and reopen them, so this page only ever
      // shows the CURRENT session.
      return Scaffold(
        backgroundColor: theme.scaffoldBackgroundColor,
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                'No interview assessment logs found.',
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32),
                child: Text(
                  'The transcript could not be retrieved. Make sure '
                  'transcription was enabled for the session.',
                  style: theme.textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
              ),
              const SizedBox(height: 16),
              CustomButton(
                text: 'Go to Setup',
                onPressed: () => store.navigateTo('/setup'),
              ),
            ],
          ),
        ),
      );
    }

    // Score resolver: the Gemini ATS fit score, or N/A when unavailable — never
    // a fabricated 72, so this headline matches the persisted /
    // candidate-visible score.
    final int? resolvedScore = _atsScorecard?.overallFitScore;
    final int overallScore = resolvedScore ?? 0;
    final String verdict =
        resolvedScore != null ? _getScoreVerdict(resolvedScore) : 'Awaiting score';

    final List<String> strengths = [];
    final List<String> watchPoints = [];

    if (overallScore >= 75) {
      strengths.add('Composed under pressure');
      strengths.add('High engagement signals');
    } else {
      watchPoints.add('Slight confidence fluctuations');
    }
    if (store.wpm >= 110 && store.wpm <= 160) {
      strengths.add('Clear speaking pace');
    } else if (store.wpm > 165) {
      watchPoints.add('Speaking pace slightly fast');
    }
    if (store.fillers <= 3) {
      strengths.add('Minimal vocal fillers');
    } else {
      watchPoints.add('Vocal filler usage noted');
    }

    if (strengths.isEmpty) strengths.add('Completed all questions');
    if (watchPoints.isEmpty) watchPoints.add('No major warning flags detected');

    final isMobile = MediaQuery.of(context).size.width < 768;

    return Scaffold(
      // Must be opaque. This page renders inside CandidateVideoShell's Stack,
      // which has no Scaffold of its own, so a transparent background let the
      // black backdrop behind show through — in light theme that put dark body
      // text and light cards on black, which read as a broken screen.
      backgroundColor: theme.scaffoldBackgroundColor,
      body: Stack(
        children: [
          SingleChildScrollView(
            padding: const EdgeInsets.all(24.0),
            child: Center(
              child: Container(
                constraints: const BoxConstraints(maxWidth: 950),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    isMobile
                        ? Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Interview complete',
                                style: theme.textTheme.labelSmall?.copyWith(
                                  color: theme.colorScheme.primary,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 1.2,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                store.currentConversation?.conversationName ??
                                    'Interview assessment',
                                style: theme.textTheme.headlineLarge?.copyWith(
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                'Comprehensive candidate intelligence powered by conversational AI.',
                                style: theme.textTheme.bodyMedium,
                              ),
                              const SizedBox(height: 12),
                              Row(
                                children: [
                                  Text(
                                    'Session ID: ',
                                    style: theme.textTheme.bodyMedium,
                                  ),
                                  Text(
                                    store.currentConversation?.conversationId ??
                                        'TIQ-demo',
                                    style: TextStyle(
                                      color: theme.colorScheme.onSurface,
                                      fontFamily: 'Courier',
                                      fontSize: 12,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          )
                        : Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      'Interview complete',
                                      style: theme.textTheme.labelSmall
                                          ?.copyWith(
                                            color: theme.colorScheme.primary,
                                            fontWeight: FontWeight.bold,
                                            letterSpacing: 1.2,
                                          ),
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      store
                                              .currentConversation
                                              ?.conversationName ??
                                          'Interview assessment',
                                      style: theme.textTheme.headlineLarge
                                          ?.copyWith(
                                            fontWeight: FontWeight.w700,
                                          ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 6),
                                    Text(
                                      'Comprehensive candidate intelligence powered by conversational AI.',
                                      style: theme.textTheme.bodyMedium,
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 16),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text(
                                    'Session ID',
                                    style: theme.textTheme.bodyMedium,
                                  ),
                                  Text(
                                    store.currentConversation?.conversationId ??
                                        'TIQ-demo',
                                    style: TextStyle(
                                      color: theme.colorScheme.onSurface,
                                      fontFamily: 'Courier',
                                      fontSize: 13,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                    const SizedBox(height: 24),


                    GridPaperResult(
                      children: [
                        StatCard(
                          label: 'Overall score',
                          value: resolvedScore != null
                              ? '$overallScore/100'
                              : 'N/A',
                          valueColor: theme.colorScheme.primary,
                          subTitle: verdict,
                        ),
                        StatCard(
                          label: 'Hiring confidence',
                          value: resolvedScore != null
                              ? '$overallScore%'
                              : 'N/A',
                          valueColor: theme.colorScheme.primary,
                          subTitle: 'Based on speech keys',
                        ),
                        StatCard(
                          label: 'Words / Min',
                          value: '${store.wpm}',
                          valueColor: store.wpm > 100
                              ? theme.colorScheme.primary
                              : theme.colorScheme.error,
                          subTitle: 'Nova-3 speech pace',
                        ),
                        StatCard(
                          label: 'Total fillers',
                          value: '${store.fillers}',
                          valueColor: store.fillers <= 4
                              ? theme.colorScheme.primary
                              : theme.colorScheme.error,
                          subTitle: 'Vocal filler rate',
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),

                    LayoutBuilder(
                      builder: (context, box) {
                        final isDesktop = box.maxWidth > 700;
                        final scoreRingCard = Card(
                          child: Padding(
                            padding: const EdgeInsets.all(24.0),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                CircularScoreRing(
                                  score: overallScore,
                                  verdict: verdict,
                                ),
                                const SizedBox(height: 16),
                                Text(
                                  'Overall score',
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                const SizedBox(height: 12),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                    vertical: 6,
                                  ),
                                  decoration: BoxDecoration(
                                    color: theme.colorScheme.primary
                                        .withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(20),
                                  ),
                                  child: Text(
                                    verdict,
                                    style: TextStyle(
                                      color: theme.colorScheme.primary,
                                      fontSize: 11,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );

                        final dimsCard = DimensionScoresPanel(
                          overallScore: overallScore,
                          fillers: store.fillers,
                        );

                        if (isDesktop) {
                          return Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              SizedBox(width: 220, child: scoreRingCard),
                              const SizedBox(width: 20),
                              Expanded(child: dimsCard),
                            ],
                          );
                        } else {
                          return Column(
                            children: [
                              scoreRingCard,
                              const SizedBox(height: 16),
                              dimsCard,
                            ],
                          );
                        }
                      },
                    ),
                    const SizedBox(height: 24),

                    // Strengths / Watch points tags
                    StrengthsWatchpointsPanel(
                      strengths: strengths,
                      watchPoints: watchPoints,
                    ),
                    const SizedBox(height: 24),

                    AtsAssessmentCard(
                      geminiError: _geminiError,
                      geminiLoading: _geminiLoading,
                      atsScorecard: _atsScorecard,
                      onRetry: _runAtsAnalysis,
                      onNavigateToSettings: () => store.navigateTo('/settings'),
                    ),
                    const SizedBox(height: 24),

                    _buildTranscriptCard(context, store),
                    const SizedBox(height: 24),

                    _buildRecruiterActions(
                      context,
                      overallScore,
                      verdict,
                      null,
                    ),
                    const SizedBox(height: 40),
                  ],
                ),
              ),
            ),
          ),

          if (_scheduleOpen) ...[
            ScheduleInterviewDialog(
              onClose: () => setState(() => _scheduleOpen = false),
            )
          ],

          if (_offerOpen) ...[
            OfferRecommendationDialog(
              score: overallScore,
              verdict: verdict,
              strengths: strengths,
              watchPoints: watchPoints,
              onClose: () => setState(() => _offerOpen = false),
            ),
          ],
        ],
      ),
    );
  }
}

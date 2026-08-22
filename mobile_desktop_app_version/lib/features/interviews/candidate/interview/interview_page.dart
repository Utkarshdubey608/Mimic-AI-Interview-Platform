// lib/views/interview_page.dart
import 'dart:async';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show SystemChrome, SystemUiMode;
import 'package:provider/provider.dart';
import 'package:talbotiq/shared/providers/app_store.dart';
import 'package:talbotiq/core/services/tavus_service.dart';
import 'package:talbotiq/core/services/recording_service.dart';
import 'package:talbotiq/shared/widgets/custom_buttons.dart';
import 'package:talbotiq/features/interviews/candidate/interview/widgets/video_panel.dart';
import 'package:talbotiq/features/interviews/candidate/interview/widgets/question_bar.dart';


/// The main interview view screen that orchestrates the video feed and the
/// bottom question/controls bar: just the video, the current question, and
/// an End Interview action — no side menu.
///
/// The candidate's microphone is recorded to a local .wav for the duration of
/// the call; on end the recording is transcribed by Deepgram on the results
/// page. There is no live transcription during the call.
class InterviewPage extends StatefulWidget {
  const InterviewPage({super.key});

  @override
  State<InterviewPage> createState() => _InterviewPageState();
}

class _InterviewPageState extends State<InterviewPage>
    with TickerProviderStateMixin, WidgetsBindingObserver {
  // Tracks whether we've put the OS chrome (status/nav bars) into immersive
  // mode, so we only call SystemChrome when this actually needs to change —
  // _syncRecordingWithRoute can otherwise fire on every unrelated store
  // notification while the call is active.
  bool _immersive = false;

  bool _autoAdvance = true;
  final bool _avatarSpeaking = false;
  int _revealedIdx = -1;

  // Guards against re-entrant _endInterview calls (e.g. the auto-advance timer
  // firing while the end dialog is open). A second run would call
  // stopAndReadBytes() again and overwrite the recording bytes with null.
  bool _ending = false;

  Timer? _fallbackRevealTimer;
  Timer? _autoAdvanceTimeoutTimer;

  /// Shows the "this call ends by itself" notice for the first few seconds.
  ///
  /// A NOTICE, not a countdown, and that is the whole point. Tavus is given
  /// `max_call_duration` (see `video_launch.dart`), so the call already ends on
  /// its own at the interview's duration — what was missing was telling the
  /// candidate. A live clock on this screen is what has to be avoided: this is a
  /// full-screen video Stack, and a ticker rebuilding it once a second is what
  /// made a countdown here unusable. One `setState` at start and one to dismiss;
  /// nothing repaints per second.
  bool _showDurationNotice = true;
  Timer? _durationNoticeTimer;

  // Local .wav recorder for the candidate's mic (native only). The recording is
  // transcribed by Deepgram on the results page once the call ends.
  final RecordingService _recorder = RecordingService();
  bool _recordingStarted = false;

  // Cached store reference so we can add/remove a route listener safely.
  AppStore? _store;

  /// Initializes the interview state, default variables, and question timers.
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _revealedIdx = 0;
    _resetQuestionTimers();
    // Long enough to read twice, short enough to be out of the way before the
    // first answer.
    _durationNoticeTimer = Timer(const Duration(seconds: 10), () {
      if (mounted) setState(() => _showDurationNotice = false);
    });
  }

  /// Integrity: flag when the candidate leaves the app mid-interview.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final store = _store;
    if (store == null) return;
    final active =
        store.currentRoute == '/interview' && store.interviewActive;
    if (!active) return;
    if (state == AppLifecycleState.paused) {
      store.incrementIntegrityLeftApp();
    } else if (state == AppLifecycleState.resumed &&
        store.integrityLeftAppCount > 0 &&
        mounted) {
      final n = store.integrityLeftAppCount;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Please stay in the interview. Leaving the app was noted '
            '($n time${n == 1 ? '' : 's'}).',
          ),
        ),
      );
    }
  }

  /// Manages routing/lifecycle dependencies and starts recording when active.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final store = Provider.of<AppStore>(context, listen: false);
    if (!identical(store, _store)) {
      _store?.removeListener(_syncRecordingWithRoute);
      _store = store;
      _store!.addListener(_syncRecordingWithRoute);
    }
    _syncRecordingWithRoute();
  }

  /// Starts microphone recording and enters immersive full-screen chrome when
  /// the interview becomes active; restores normal chrome otherwise.
  void _syncRecordingWithRoute() {
    final store = _store;
    if (store == null) return;
    final shouldRun = store.currentRoute == '/interview' && store.interviewActive;
    if (shouldRun) {
      _startRecording();
      _setImmersive(true);
    } else {
      _setImmersive(false);
    }
  }

  /// Hides/restores the OS status and navigation bars so the call fills the
  /// entire screen like a native video-call app. Guarded by [_immersive] so
  /// SystemChrome is only touched on an actual transition, not on every
  /// unrelated store notification while the call is active.
  void _setImmersive(bool value) {
    if (_immersive == value) return;
    _immersive = value;
    SystemChrome.setEnabledSystemUIMode(
      value ? SystemUiMode.immersiveSticky : SystemUiMode.edgeToEdge,
    );
  }

  /// Cleans up active timers, controllers, listeners, and the recorder.
  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _store?.removeListener(_syncRecordingWithRoute);
    _durationNoticeTimer?.cancel();
    _fallbackRevealTimer?.cancel();
    _autoAdvanceTimeoutTimer?.cancel();
    _recorder.dispose();
    _setImmersive(false);
    super.dispose();
  }

  /// Starts recording the candidate's microphone to a local .wav file.
  ///
  /// Native only. On web this is a no-op (the web build does not record).
  void _startRecording() async {
    if (kIsWeb || _recordingStarted) return;
    _recordingStarted = true;
    debugPrint('debug[rec]: _startRecording invoked');
    final ok = await _recorder.start();
    debugPrint('debug[rec]: _recorder.start() returned $ok');
    if (ok) {
      // The true zero-point of the recorded audio's timeline — needed to
      // align Deepgram's per-word offsets to the right question when the
      // results page slices the transcript by question.
      _store?.setRecordingStartTimestamp(DateTime.now().millisecondsSinceEpoch);
    }
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text(
            'Could not start audio recording — the transcript may be unavailable.',
          ),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  /// Cancels and schedules the timeout advance and fallback reveal timers for the current question.
  void _resetQuestionTimers() {
    _fallbackRevealTimer?.cancel();
    _autoAdvanceTimeoutTimer?.cancel();

    final store = Provider.of<AppStore>(context, listen: false);
    final isDemo = store.currentConversation?.conversationUrl == '';

    _fallbackRevealTimer = Timer(Duration(seconds: isDemo ? 4 : 9), () {
      if (mounted) {
        setState(() {
          _revealedIdx = store.currentQuestionIdx;
        });
      }
    });

    if (_autoAdvance) {
      _autoAdvanceTimeoutTimer = Timer(const Duration(seconds: 90), () {
        if (mounted && _autoAdvance) {
          _nextQuestion();
        }
      });
    }
  }

  /// Ends the interview session, finalises the recording, and redirects to
  /// results.
  Future<void> _endInterview() async {
    // Re-entrancy guard: a second invocation (e.g. an auto-advance timer firing
    // while this is running) must not reach stopAndReadBytes() a second time
    // and overwrite the captured recording bytes with null.
    if (_ending) return;
    _ending = true;

    // Cancel the question timers up-front so they cannot re-enter this method
    // (via _nextQuestion) while the confirm dialog / finalisation is in flight.
    _autoAdvanceTimeoutTimer?.cancel();
    _fallbackRevealTimer?.cancel();

    final store = Provider.of<AppStore>(context, listen: false);
    final theme = Theme.of(context);

    final confirmEnd = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: const Text('End Interview?'),
          content: const Text(
            'Are you sure you want to end the interview now and generate the scorecard?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(
                'Cancel',
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
            CustomButton(
              text: 'End Interview',
              variant: ButtonVariant.danger,
              onPressed: () => Navigator.pop(context, true),
            ),
          ],
        );
      },
    );

    if (confirmEnd != true) {
      // User backed out — allow ending again later and re-arm the timers we
      // cancelled above.
      _ending = false;
      if (mounted) _resetQuestionTimers();
      return;
    }
    if (!mounted) return;

    // NB: keep this out of setState — firing provider notifyListeners from
    // inside a setState callback is not allowed.
    store.setInterviewActive(false);

    // Stop the local recording and hand its bytes to the store so the results
    // page can transcribe it via Deepgram's pre-recorded endpoint (native only).
    if (!kIsWeb) {
      final bytes = await _recorder.stopAndReadBytes();
      debugPrint('debug[rec]: endInterview got ${bytes?.length ?? 0} bytes');
      store.setRecordingBytes(bytes);

      // If the user opted to keep recordings, persist this one to device
      // storage so it can be played back / deleted later from Settings.
      if (store.storeLocalRecordings && bytes != null && bytes.isNotEmpty) {
        final name = (store.currentConversation?.conversationName ?? 'Interview')
            .replaceAll('TalbotIQ — ', '');
        final saved = await _recorder.persistLastRecording(name);
        if (saved != null) store.addRecording(saved);
      }
    }

    if (store.currentConversation != null &&
        store.currentConversation!.conversationUrl.isNotEmpty) {
      try {
        await tavusService.endConversation(
          store.currentConversation!.conversationId,
        );
      } catch (e) {
        debugPrint('Tavus end conversation error: $e');
      }
    }

    // Marks this conversation as needing the analysis pipeline (transcript →
    // Gemini → recruiter handoff) on EVERY platform — unlike recordingBytes
    // (native-only), this is what actually gates ResultsPage running the
    // pipeline vs. just restoring a cached result.
    final convId = store.currentConversation?.conversationId ?? '';
    if (convId.isNotEmpty) {
      store.markPendingAnalysis(convId);
    }

    if (mounted) {
      store.navigateTo('/results');
    }
  }

  /// Navigates to the previous question in the interview list.
  void _prevQuestion() {
    final store = Provider.of<AppStore>(context, listen: false);
    if (store.currentQuestionIdx > 0) {
      final prev = store.currentQuestionIdx - 1;
      store.setCurrentQuestionIdx(prev);
      setState(() {
        _revealedIdx = prev;
      });
      _resetQuestionTimers();
    }
  }

  /// Navigates to the next question, or triggers interview wrap-up if finished.
  void _nextQuestion() {
    final store = Provider.of<AppStore>(context, listen: false);
    final total = store.questions.where((q) => q.isNotEmpty).length;

    if (store.currentQuestionIdx + 1 < total) {
      final next = store.currentQuestionIdx + 1;
      store.setCurrentQuestionIdx(next);
      setState(() {
        _revealedIdx = next;
      });
      _resetQuestionTimers();
    } else {
      _endInterview();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final store = Provider.of<AppStore>(context);
    final validQs = store.questions.where((q) => q.isNotEmpty).toList();

    if (store.currentConversation == null) {
      return Scaffold(
        backgroundColor: theme.colorScheme.surface,
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                'No active interview session.',
                style: theme.textTheme.titleMedium,
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

    return Scaffold(
      backgroundColor: Colors.black,
      // No SafeArea around the video itself — it runs edge to edge under the
      // status bar/notch like a native video-call app. Only the bottom
      // control overlay insets for the safe area (see QuestionBar's padding).
      body: Stack(
        fit: StackFit.expand,
        children: [
          VideoPanel(store: store, validQs: validQs),
          // What the candidate was never told: this call hangs up by itself.
          if (_showDurationNotice)
            _DurationNotice(
              seconds: store.activeInterviewDurationSeconds,
              onDismiss: () => setState(() => _showDurationNotice = false),
            ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: QuestionBar(
              store: store,
              validQs: validQs,
              avatarSpeaking: _avatarSpeaking,
              autoAdvance: _autoAdvance,
              revealedIdx: _revealedIdx,
              onToggleAutoAdvance: () {
                setState(() {
                  _autoAdvance = !_autoAdvance;
                  _resetQuestionTimers();
                });
              },
              onShowNow: () {
                setState(() {
                  _revealedIdx = store.currentQuestionIdx;
                });
              },
              onPrevQuestion: _prevQuestion,
              onNextQuestion: _nextQuestion,
              onEndInterview: _endInterview,
            ),
          ),
        ],
      ),
    );
  }
}

/// The one-off "this ends by itself" banner over the video.
///
/// Static text, not a clock. The call's real end is enforced by Tavus's
/// `max_call_duration`, so nothing here has to count — and nothing here may
/// repaint per second, because this sits on top of a live video surface. See
/// `_InterviewPageState._showDurationNotice`.
class _DurationNotice extends StatelessWidget {
  const _DurationNotice({required this.seconds, required this.onDismiss});

  /// The interview's length. Zero or less means no limit was configured, and
  /// then there is nothing to promise.
  final int seconds;

  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    if (seconds <= 0) return const SizedBox.shrink();
    final minutes = (seconds / 60).round();
    return Positioned(
      top: MediaQuery.of(context).padding.top + 12,
      left: 16,
      right: 16,
      child: Material(
        color: Colors.black.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(100),
        child: InkWell(
          borderRadius: BorderRadius.circular(100),
          onTap: onDismiss,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                const Icon(Icons.schedule, size: 16, color: Colors.white70),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    minutes <= 1
                        ? 'This interview ends automatically after 1 minute.'
                        : 'This interview ends automatically after $minutes '
                            'minutes.',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const Icon(Icons.close, size: 15, color: Colors.white54),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// lib/features/interviews/candidate/candidate_home.dart
//
// Candidate landing surface: lists interviews assigned to the signed-in user's
// email (video and chat shown separately) and launches them. Video launches
// reuse the Tavus machinery via a CandidateVideoShell; chat launches reuse the
// recruiter conversation runner via chat_launch_adapter. Shared API keys are
// pulled from Firestore on entry so this device can reach Tavus/Gemini even
// though the candidate never opens Settings.

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/core/deep_link/deep_link_service.dart';
import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/shared/providers/app_store.dart';
import 'package:talbotiq/features/recruiter/store/recruiter_store.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';
import 'package:talbotiq/shared/widgets/desktop_page_container.dart';
import 'package:talbotiq/shared/widgets/logout_button.dart';
import 'package:talbotiq/shared/widgets/section_header.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/test_conclusion.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/features/interviews/services/resume_service.dart';
import 'package:talbotiq/features/interviews/candidate/candidate_conclusion_page.dart';
import 'package:talbotiq/features/interviews/candidate/candidate_result_page.dart';
import 'package:talbotiq/features/interviews/candidate/chat_launch_adapter.dart';
import 'package:talbotiq/features/interviews/candidate/live_interview_page.dart';
import 'package:talbotiq/features/interviews/candidate/resume_intake_page.dart';
import 'package:talbotiq/features/interviews/candidate/system_check_page.dart';
import 'package:talbotiq/features/interviews/candidate/video_launch.dart';
import 'package:talbotiq/features/interviews/candidate/voice_launch.dart';
import 'package:talbotiq/features/interviews/candidate/feedback_prompt.dart';
import 'package:talbotiq/features/interviews/candidate/mcq/mcq_paper_page.dart';
import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/core/theme/status_tones.dart';

class CandidateHome extends StatefulWidget {
  const CandidateHome({super.key});

  @override
  State<CandidateHome> createState() => _CandidateHomeState();
}

class _CandidateHomeState extends State<CandidateHome> {
  bool _launching = false;

  /// Human-readable name of the launch step currently in flight, shown in the
  /// loading overlay. Whatever it last displayed is the step that failed.
  String _launchStage = '';

  void _setStage(String stage) {
    debugPrint('[launch] $stage');
    if (mounted) setState(() => _launchStage = stage);
  }

  String get _email => FirebaseAuth.instance.currentUser?.email ?? '';

  @override
  void initState() {
    super.initState();
    // Consume a deep link (talbotiq://interview/<id>) that arrived before/at
    // launch: fetch the interview and, if it's this candidate's, open it.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _consumePendingDeepLink();
    });
  }

  Future<void> _consumePendingDeepLink() async {
    final id = PendingDeepLink.instance.take();
    if (id == null) return;
    final repo = context.read<InterviewRepository>();
    try {
      final interview = await repo.getById(id);
      if (!mounted || interview == null) return;
      // Only auto-open an interview actually assigned to this candidate.
      if (interview.candidateEmailLower != _email.trim().toLowerCase()) return;
      _open(interview);
    } catch (_) {
      // Ignore — the interview still appears in the list for manual launch.
    }
  }

  String _localPart(String email) {
    final at = email.indexOf('@');
    return at > 0 ? email.substring(0, at) : email;
  }

  /// Shows a launch failure as a blocking dialog rather than a SnackBar.
  /// A failed launch drops the candidate straight back to this list, which on
  /// its own is indistinguishable from "the app just closed the interview" —
  /// a transient SnackBar is far too easy to miss for something that ends the
  /// whole attempt. The full error text is shown (and selectable) so it can
  /// be reported verbatim.
  Future<void> _showLaunchError(String stage, Object error) async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Could not start the interview'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Failed at: $stage',
                  style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 10),
              SelectableText(
                error.toString().replaceAll('Exception: ', ''),
                style: const TextStyle(fontSize: 13),
              ),
              const SizedBox(height: 12),
              Text(
                'If this mentions a network or host error, check this '
                'device’s internet connection and try again.',
                style: TextStyle(
                  fontSize: 12,
                  color: Theme.of(ctx).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  /// Opens whatever [interview] actually is.
  ///
  /// Switches on [Interview.effectiveRoundKind], NOT on `type`: a résumé round
  /// has no interview track, so its document carries the harmless default
  /// `type: chat`. Routing on `type` would drop a candidate into a chat
  /// interview with no questions.
  Future<void> _open(Interview interview) async {
    // Whether finishing this counts as "just did an interview", decided BEFORE
    // opening anything.
    //
    // The prompt used to fire after every _open, so re-opening an already
    // submitted round asked "how was that?" again on the way back — and so did
    // tapping a closed round, where nothing opened at all. Both conditions are
    // exactly what the launchers below already guard on, so they can be read
    // once here rather than threaded back out of seven code paths.
    //
    // Known gap: launching a fresh interview and backing out without finishing
    // still asks. That is the pre-existing behaviour and a far rarer case; the
    // launchers would each have to report completion to close it.
    final worthAsking =
        interview.isAccessible && interview.status != InterviewStatus.completed;
    // MCQ is routed on `mode`, not on `type`, and cannot be folded into the switch
    // below. An MCQ invite reaches here as `type: chat` with an EMPTY questions list —
    // the paper is referenced by id and resolved server-side, so the answer key never
    // leaves the server (see backend/app/mcq_runtime.py). Left to the switch it would
    // open a chat interview with nothing in it.
    //
    // This used to show "open this one in a browser". It no longer has to.
    if (interview.effectiveMode == 'mcq') {
      await _launchMcq(interview);
      if (mounted && worthAsking) {
        await promptForFeedback(context, interviewId: interview.id);
      }
      return;
    }

    // Awaited so ONE hook covers every path. Each branch used to be fire-and-forget,
    // which meant anything that had to happen after an interview finished needed
    // wiring into all five separately — and the fifth is always the one that gets
    // missed.
    switch (interview.effectiveRoundKind) {
      case RoundKind.resume:
        await _submitResume(interview);
      case RoundKind.video:
        await _launchVideo(interview);
      case RoundKind.chat:
        await _launchChat(interview);
      case RoundKind.voice:
        await _launchVoice(interview);
      case RoundKind.twoWay:
        await _joinLiveInterview(interview);
      case RoundKind.mcq:
        // Reachable only for a document whose `roundKind` says mcq but whose
        // `mode` does not — a timeline round written by this app before `mode`
        // was being set. The early return above handles every normal MCQ.
        await _launchMcq(interview);
    }

    // Ask what it was like. Skippable, and its failure is swallowed — see
    // feedback_prompt.dart. The prompt existed only in the browser until now, so a
    // candidate who interviewed on the phone was never asked at all.
    if (mounted && worthAsking) {
      await promptForFeedback(context, interviewId: interview.id);
    }
  }

  /// A two-way round: a live call with a human interviewer.
  ///
  /// No system check and no launch sequence — the WebView and Daily's own UI
  /// handle permissions and devices, and the candidate may well arrive before
  /// the interviewer, so the waiting is the screen's job rather than a blocker
  /// here.
  Future<void> _joinLiveInterview(Interview interview) async {
    if (!_guardAccess(interview)) return;
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => LiveInterviewPage(interview: interview),
    ));
  }

  /// A résumé round: collect the résumé, post it for scoring, confirm.
  ///
  /// There is no session to launch and nothing to reset, so this shares none of
  /// the video/chat launch machinery. The backend owns the extraction, the score
  /// and the Firestore write — this method only moves text and reports what
  /// happened.
  Future<void> _submitResume(Interview interview) async {
    if (_launching) return;
    if (!_guardAccess(interview)) return;

    // Already submitted: offer the result rather than silently letting them
    // overwrite a score the recruiter may have already read.
    if (interview.resume != null &&
        interview.status == InterviewStatus.completed) {
      final again = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Résumé already submitted'),
          content: const Text(
            'You have already submitted a résumé for this round. Submitting '
            'again replaces it and it will be scored again.',
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Leave it')),
            FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Replace')),
          ],
        ),
      );
      if (again != true || !mounted) return;
    }

    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (ctx) => ResumeIntakePage(
          title: interview.title,
          submitLabel: 'Submit résumé',
          subtitle:
              'Upload your résumé as a PDF, or paste the text. It is reviewed '
              'against what this role needs, and ${interview.recruiterName ?? 'the recruiter'} '
              'sees the result.',
          // The intake page stays put until this completes and shows anything
          // thrown, so a failed submit never costs the candidate their text.
          onSubmit: (text) async {
            await resumeService.submitForScoring(
              interviewId: interview.id,
              resumeText: text,
            );
            if (!ctx.mounted) return;
            // Pop the intake first so the confirmation is not stacked on a
            // screen the candidate has finished with.
            Navigator.of(ctx).pop();
            if (mounted) _showResumeSubmitted(interview);
          },
        ),
      ),
    );
  }

  /// Opens a multiple-choice assessment.
  ///
  /// A full-screen page rather than a dialog: a paper is scrolled, revisited and
  /// submitted deliberately, and none of that belongs in something dismissible by
  /// tapping outside it.
  ///
  /// Awaited, so the feedback prompt fires when the candidate leaves — the same hook
  /// every other track gets.
  ///
  /// **`attemptsUsed` is deliberately NOT incremented.** Every other track counts a
  /// launch because a launch consumes the thing: a video call happens once. A paper
  /// is resumable by design — the runtime autosaves precisely so a reload, a dropped
  /// connection or a closed lid costs nothing — and counting each open would lock
  /// somebody out of a paper they were halfway through. What can only happen once is
  /// the SUBMIT, and the server refuses a second one (409) rather than rescoring.
  Future<void> _launchMcq(Interview interview) async {
    // The window still applies: a round the recruiter ended is closed, and the
    // snackbar says so here rather than the candidate meeting a 409 on the paper.
    if (!_guardAccess(interview)) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => McqPaperPage(
          interviewId: interview.id,
          title: interview.displayTestTitle,
        ),
      ),
    );
  }

  /// Confirms a résumé submission without showing the score.
  ///
  /// The number is deliberately withheld: a résumé score is a recruiter's
  /// screening tool, and `resultPublished` — which only the recruiter sets — is
  /// what decides whether a candidate ever sees a result.
  void _showResumeSubmitted(Interview interview) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.check_circle_outline),
        title: const Text('Résumé submitted'),
        content: Text(
          'Your résumé has been sent for "${interview.title}". '
          '${interview.recruiterName ?? 'The recruiter'} will be in touch about '
          'the next round.',
        ),
        actions: [
          FilledButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Done')),
        ],
      ),
    );
  }

  bool _guardAccess(Interview interview) {
    if (interview.isAccessible) return true;
    // A round the recruiter ended early reads as expired here, because ending a
    // round pulls `expiresAt` back to that moment. "Closed" is the honest word
    // for both, and "interview" is the wrong noun for a résumé round.
    final noun = switch (interview.effectiveRoundKind) {
      // "This interview is closed" is the wrong noun for a résumé upload or a
      // multiple-choice paper, and this is the one sentence the candidate gets.
      RoundKind.resume => 'This round',
      RoundKind.mcq => 'This assessment',
      _ => 'This interview',
    };
    final String msg;
    if (interview.isExpired) {
      msg = '$noun is closed.';
    } else if (interview.isNotYetAvailable) {
      msg = '$noun is not open yet.';
    } else {
      msg = 'You have no attempts left.';
    }
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    return false;
  }

  Future<void> _launchVideo(Interview interview) async {
    if (_launching) return;
    if (!_guardAccess(interview)) return;
    final messenger = ScaffoldMessenger.of(context);
    final store = context.read<AppStore>();
    final repo = context.read<InterviewRepository>();

    if (interview.avatar.replicaId.isEmpty) {
      messenger.showSnackBar(const SnackBar(
          content: Text('This interview has no avatar configured.')));
      return;
    }

    // Optional résumé intake (recruiter opt-in) — grounds the avatar's
    // questions. Cancelling the intake aborts the launch.
    String? resumeText;
    if (interview.collectResume) {
      resumeText = await Navigator.of(context).push<String>(
        MaterialPageRoute(
          builder: (ctx) => ResumeIntakePage(
            onSubmit: (t) async => Navigator.of(ctx).pop(t),
          ),
        ),
      );
      if (!mounted) return;
      if (resumeText == null || resumeText.trim().isEmpty) return;
    }

    // Pre-join camera/mic check so a permission denial is handled here (retry /
    // open settings) instead of a dead video panel once the call starts.
    final ready = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (ctx) => SystemCheckPage(
          onReady: () => Navigator.of(ctx).pop(true),
        ),
      ),
    );
    debugPrint('[launch] system check returned: $ready (mounted=$mounted)');
    if (!mounted) return;
    // SystemCheckPage pops `true` only from its "Join interview" button, so
    // anything else means the candidate backed out. That is a cancellation,
    // not an error — abort quietly and leave them on their interview list.
    if (ready != true) return;

    setState(() => _launching = true);
    // Tracks how far the launch got, so a failure can name the exact step
    // instead of a generic "could not start" (this sequence hits Firestore
    // and then Tavus over HTTP — on a flaky/offline device several distinct
    // failures all LOOK identical to the candidate: spinner, then back to
    // the dashboard).
    var stage = 'creating the video session';
    try {
      final config = store.sessionConfig.copyWith(
        conversationalContext: interview.prompt,
        replicaId: interview.avatar.replicaId,
        personaId: interview.avatar.personaId ?? '',
        conversationName: interview.title,
        maxCallDuration: interview.durationMinutes * 60,
        language: interview.language,
      );

      // Carry the interview language so the results page transcribes in the
      // right Deepgram locale.
      store.setActiveInterviewLanguage(interview.language);

      stage = 'creating the Tavus conversation (network)';
      _setStage('Step 1/2 — creating the video session…');
      await launchVideoConversation(
        context: context,
        config: config,
        questions: interview.questions,
        candidateName: interview.candidateName ?? _localPart(_email),
        interview: interview,
        resumeText: resumeText,
      );
      _setStage('Step 2/2 — opening the interview…');
      // The attempt has started — count it. Best-effort: not awaited (so a
      // slow/failed write never delays entering the interview), so it must
      // catch its own errors — an unawaited Future's rejection would
      // otherwise be an uncaught async error even though this call is
      // textually inside this try/catch.
      repo
          .incrementAttempt(interview.id)
          .catchError((e) => debugPrint('incrementAttempt failed: $e'));
    } catch (e, st) {
      debugPrint('[launchVideo] FAILED at "$stage": $e\n$st');
      if (mounted) setState(() => _launching = false);
      await _showLaunchError(stage, e);
    } finally {
      if (mounted) setState(() => _launching = false);
    }
  }

  Future<void> _launchChat(Interview interview) async {
    if (_launching) return;
    if (!_guardAccess(interview)) return;
    final messenger = ScaffoldMessenger.of(context);
    final repo = context.read<InterviewRepository>();
    final recruiterStore = context.read<RecruiterStore>();
    setState(() => _launching = true);
    try {
      // Best-effort — see the video path's comment on why this must catch its
      // own errors despite being unawaited.
      repo
          .incrementAttempt(interview.id)
          .catchError((e) => debugPrint('incrementAttempt failed: $e')); // count this attempt
      if (mounted) setState(() => _launching = false);
      // Build the page HERE, not inside the MaterialPageRoute builder.
      // buildChatRunnerPage() writes an ephemeral template into RecruiterStore
      // (notifyListeners), and a route builder runs during Flutter's build
      // phase — mutating a provider there throws "setState()/markNeedsBuild()
      // called during build" and the route fails to render. Constructing the
      // widget eagerly keeps that write outside the build phase.
      final chatPage = buildChatRunnerPage(
        interview: interview,
        repository: repo,
        recruiterStore: recruiterStore,
      );
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => chatPage),
      );
    } catch (e) {
      messenger.showSnackBar(SnackBar(
          content: Text(
              'Could not start the interview: ${e.toString().replaceAll('Exception: ', '')}')));
    } finally {
      if (mounted) setState(() => _launching = false);
    }
  }

  Future<void> _launchVoice(Interview interview) async {
    if (_launching) return;
    if (!_guardAccess(interview)) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _launching = true);
    try {
      // launchVoiceInterview applies the org keys, runs the Gemini Live call,
      // scores the transcript on completion, and restores the candidate's keys.
      await launchVoiceInterview(context: context, interview: interview);
    } catch (e) {
      messenger.showSnackBar(SnackBar(
          content: Text(
              'Could not start the interview: ${e.toString().replaceAll('Exception: ', '')}')));
    } finally {
      if (mounted) setState(() => _launching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final repo = context.read<InterviewRepository>();
    if (isDesktopPlatform) return _buildDesktop(theme, repo);

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        title: const _Wordmark(subtitle: 'My Interviews'),
        actions: const [
          LogoutButton(),
          SizedBox(width: 4),
        ],
      ),
      body: _body(theme, repo, padding: const EdgeInsets.fromLTRB(16, 16, 16, 32)),
    );
  }

  /// Same StreamBuilder/grouping/launch-overlay as mobile — only the chrome
  /// around it changes: a page header instead of an AppBar, matching the
  /// desktop shell's top-nav pattern (which already owns Logout via the
  /// profile menu, so this doesn't repeat it).
  Widget _buildDesktop(ThemeData theme, InterviewRepository repo) {
    return DesktopPageContainer(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SectionHeader(
            title: 'My Interviews',
            subtitle: 'Interviews assigned to you appear here, grouped by job.',
            isPageTitle: true,
          ),
          const SizedBox(height: 24),
          Expanded(child: _body(theme, repo, padding: const EdgeInsets.only(bottom: 32))),
        ],
      ),
    );
  }

  Widget _body(ThemeData theme, InterviewRepository repo, {required EdgeInsets padding}) {
    return Stack(
      children: [
        StreamBuilder<List<Interview>>(
          stream: repo.watchForCandidate(_email),
          builder: (context, snap) {
            if (snap.hasError) {
              // Never surface the raw error to the candidate — it can leak
              // Firestore internals and composite-index URLs. Log it for
              // developers and show a friendly message instead.
              debugPrint('CandidateHome interviews stream error: ${snap.error}');
              return const AppMessageState(
                icon: Icons.error_outline,
                title: 'Could not load your interviews',
                subtitle: 'Please check your connection and try again.',
              );
            }
            if (!snap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final all = snap.data!;
            if (all.isEmpty) {
              return AppMessageState(
                icon: Icons.inbox_outlined,
                title: 'No interviews assigned',
                subtitle:
                    'Interviews assigned to $_email will appear here.',
              );
            }
            // Grouped by the JOB, with each round in running order beneath it.
            //
            // This used to group by interview kind, which meant a candidate
            // partway through a pipeline saw "Résumé Submissions" and "Chat
            // Interviews" as two unrelated sections with nothing saying one
            // followed the other — and no indication they had advanced. A
            // person applies to a job, not to a chat interview.
            final byTest = groupByTest(all);
            return ListView(
              padding: padding,
              children: [
                for (final group in byTest) ...[
                  _Header(
                      label: group.title,
                      icon: Icons.work_outline),
                  // Above the rounds, not below them: once a decision has been
                  // released it is the only thing on this screen the candidate
                  // came back for. The rounds stay listed underneath — they are
                  // the record of what they did.
                  if (group.conclusion != null)
                    _ConclusionCard(
                      title: group.title,
                      conclusion: group.conclusion!,
                      rounds: group.rounds,
                    ),
                  for (var idx = 0; idx < group.rounds.length; idx++)
                    _AssignedCard(
                      interview: group.rounds[idx],
                      // Position within THIS candidate's own sequence. Not the
                      // test's total round count: they can only see rounds they
                      // have reached, and "Round 2 of 4" would be telling them
                      // about stages that may never be theirs.
                      step: group.rounds.length > 1 ? idx + 1 : null,
                      onLaunch: () => _open(group.rounds[idx]),
                    ),
                  const SizedBox(height: 16),
                ],
              ],
            );
          },
        ),
        if (_launching)
          ColoredBox(
            color: const Color(0xCC000000),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const CircularProgressIndicator(),
                  const SizedBox(height: 20),
                  // The launch sequence can abort at several points that all
                  // look identical (spinner, then back to this list). Naming
                  // the current step on screen means the last step shown IS
                  // the one that failed — no log capture required.
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Text(
                      _launchStage.isEmpty ? 'Starting…' : _launchStage,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// One job, and the rounds of it this candidate has reached, in running order.
class CandidatePipeline {
  final String testId;
  final String title;

  /// Earliest round first, so the list reads as the sequence it is.
  final List<Interview> rounds;

  const CandidatePipeline({
    required this.testId,
    required this.title,
    required this.rounds,
  });

  /// The recruiter's final word on this application, or null while it is still
  /// running.
  ///
  /// Read off the ROUNDS rather than stored separately: a conclusion is copied
  /// onto every assignment the candidate holds in the test (see
  /// `InterviewRepository.publishConclusion`), precisely so that this device —
  /// which may read nothing but its own assignments — can find it from whichever
  /// round it happens to have. The last non-null one wins, so a partially-failed
  /// batch shows the newest decision rather than the one it replaced.
  TestConclusion? get conclusion {
    TestConclusion? found;
    for (final round in rounds) {
      final c = round.testConclusion;
      if (c != null) found = c;
    }
    return found;
  }
}

/// Groups a candidate's assignments by the job they belong to.
///
/// Public and pure so it can be tested without Firebase — this is the ordering a
/// candidate reads their whole application from.
///
/// Ties on round order fall back to `createdAt`, because a test with no timeline
/// gives every assignment `roundOrder` 0 and would otherwise order arbitrarily.
List<CandidatePipeline> groupByTest(List<Interview> all) {
  final byTest = <String, List<Interview>>{};
  for (final i in all) {
    // A pre-timeline assignment may carry no testId; it is its own group rather
    // than being lumped in with every other one under the empty key.
    final key = i.testId.isNotEmpty ? i.testId : i.id;
    byTest.putIfAbsent(key, () => []).add(i);
  }

  final groups = <CandidatePipeline>[];
  for (final entry in byTest.entries) {
    final rounds = [...entry.value]..sort((a, b) {
        final byOrder =
            a.effectiveRoundOrder.compareTo(b.effectiveRoundOrder);
        if (byOrder != 0) return byOrder;
        final at = a.createdAt, bt = b.createdAt;
        if (at == null || bt == null) return 0;
        return at.compareTo(bt);
      });
    groups.add(CandidatePipeline(
      testId: entry.key,
      title: rounds.first.displayTestTitle,
      rounds: rounds,
    ));
  }

  // Most recently started application first — that is the one they are working
  // on. Groups with no timestamp yet sort last rather than jumping to the top.
  groups.sort((a, b) {
    final at = a.rounds.first.createdAt, bt = b.rounds.first.createdAt;
    if (at == null && bt == null) return 0;
    if (at == null) return 1;
    if (bt == null) return -1;
    return bt.compareTo(at);
  });
  return groups;
}

/// The banner that says a job is OVER, sitting above that job's rounds.
///
/// Styled as its own thing rather than as another round card: it is not a stage,
/// nothing launches from it, and a candidate scanning this screen for "did I
/// hear back" should find it without reading the list.
class _ConclusionCard extends StatelessWidget {
  final String title;
  final TestConclusion conclusion;
  final List<Interview> rounds;

  const _ConclusionCard({
    required this.title,
    required this.conclusion,
    required this.rounds,
  });

  @override
  Widget build(BuildContext context) {
    // This is the one thing a candidate opens this screen to find, so it is the
    // screen's single solid block. A "cleared" result takes the accent; the
    // other outcomes stay on a neutral surface — painting a rejection in the
    // brand's celebratory colour would be tone-deaf.
    final cleared = conclusion.outcome == TestOutcome.cleared;
    final block = WarmSurfaces.block(context);

    final icon = switch (conclusion.outcome) {
      TestOutcome.cleared => Icons.emoji_events_outlined,
      TestOutcome.notSelected => Icons.info_outline,
      TestOutcome.onHold => Icons.hourglass_empty,
    };

    final titleColour =
        cleared ? WarmSurfaces.onBlock : WarmSurfaces.ink(context);
    final bodyColour = cleared
        ? WarmSurfaces.onBlock.withValues(alpha: 0.75)
        : WarmSurfaces.inkMuted(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Material(
        color: cleared ? block : WarmSurfaces.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.card + 4),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppRadius.card + 4),
          onTap: () => Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => CandidateConclusionPage(
              testTitle: title,
              conclusion: conclusion,
              rounds: rounds,
            ),
          )),
          child: Container(
            padding: const EdgeInsets.all(AppSpacing.lg + 2),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.card + 4),
              border: cleared
                  ? null
                  : Border.all(color: WarmSurfaces.stroke(context)),
            ),
            child: Row(
              children: [
                Icon(icon, color: titleColour, size: 26),
                const SizedBox(width: AppSpacing.md + 2),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        conclusion.outcome.candidateLabel,
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.3,
                          color: titleColour,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        // A preview, not the message: the full text is one tap
                        // away and truncating somebody's rejection mid-sentence
                        // on a list screen is worse than not showing it.
                        conclusion.message.isEmpty
                            ? 'Tap to read your final result'
                            : conclusion.message,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12.5,
                          height: 1.35,
                          color: bodyColour,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Icon(Icons.chevron_right_rounded, size: 20, color: bodyColour),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AssignedCard extends StatelessWidget {
  final Interview interview;
  final VoidCallback onLaunch;

  /// 1-based position in this candidate's own sequence, or null when the job has
  /// only one stage and numbering it would be noise.
  final int? step;

  const _AssignedCard({
    required this.interview,
    required this.onLaunch,
    this.step,
  });

  /// A résumé round has no session, so several of this card's words change.
  bool get _isResume =>
      interview.effectiveRoundKind == RoundKind.resume;

  /// The published outcome, in the candidate's own words.
  ///
  /// "Not moving forward" is deliberately neutral-coloured rather than red: it is
  /// a decision, not an error, and red on someone's rejection is a small cruelty.
  Widget _outcomeChip(ThemeData theme) {
    final outcome = interview.outcome;
    final color = switch (outcome) {
      RoundOutcome.selected => theme.colorScheme.primary,
      RoundOutcome.notSelected => theme.colorScheme.onSurfaceVariant,
      RoundOutcome.pending => theme.colorScheme.secondary,
    };
    final icon = switch (outcome) {
      RoundOutcome.selected => Icons.check_circle_outline,
      RoundOutcome.notSelected => Icons.info_outline,
      RoundOutcome.pending => Icons.hourglass_empty,
    };

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: color),
        const SizedBox(width: 5),
        Flexible(
          child: Text(
            outcome.candidateLabel,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall
                ?.copyWith(color: color, fontWeight: FontWeight.w600),
          ),
        ),
      ],
    );
  }

  Widget _buildStatusBadge(
      BuildContext context, String text, Color bgColor, Color textColor) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: textColor,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final completed = interview.status == InterviewStatus.completed;
    final accessible = interview.isAccessible;
    final published = interview.resultPublished && interview.result != null;
    final awaiting =
        interview.status == InterviewStatus.completed && !published;

    final typeIcon = switch (interview.effectiveRoundKind) {
      RoundKind.resume => Icons.description_outlined,
      RoundKind.video => Icons.videocam_outlined,
      RoundKind.voice => Icons.record_voice_over_outlined,
      RoundKind.chat => Icons.chat_bubble_outline,
      RoundKind.twoWay => Icons.groups_outlined,
      RoundKind.mcq => Icons.fact_check_outlined,
    };

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      decoration: WarmSurfaces.card(context, radius: AppRadius.card),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        // The card body means "show me this"; only the button means "do this".
        //
        // It used to launch whenever the window was open, so tapping a round
        // you had already submitted dropped you back into the session — which
        // greets you with "Answer submitted" — instead of showing the result
        // sitting right there on the card. Re-taking is still possible, but it
        // now takes a deliberate press on the button.
        onTap: published
            ? () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => CandidateResultPage(interview: interview),
                  ),
                )
            : (accessible && !completed ? onLaunch : null),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  // Solid pastel disc, as every row in the language carries.
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: WarmSurfaces.block(context),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(typeIcon,
                        color: WarmSurfaces.onBlock, size: 21),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  // The title gets the row to itself. It used to share the row
                  // with the action button, which left "Round 1 · resume
                  // screen" truncated to "Round 1 · resume …" on a phone.
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          step == null
                              ? interview.title
                              : 'Round $step · ${interview.title}',
                          style: TextStyle(
                            fontSize: 15.5,
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.2,
                            color: WarmSurfaces.ink(context),
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 3),
                        Text(
                          'from ${interview.recruiterName?.isNotEmpty == true ? interview.recruiterName : interview.recruiterEmail}',
                          style: TextStyle(
                            fontSize: 12.5,
                            color: WarmSurfaces.inkMuted(context),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              // Status first, then the action — reading order matches what a
              // candidate needs: what state is this in, then what can I do.
              Wrap(
                spacing: AppSpacing.sm - 2,
                runSpacing: AppSpacing.xs + 2,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (published && interview.showsOwnOutcome)
                    _outcomeChip(theme),
                  _buildStatusBadge(
                    context,
                    '${interview.questions.length} Qs · ${interview.durationMinutes} min',
                    WarmSurfaces.surfaceHigh(context),
                    WarmSurfaces.inkMuted(context),
                  ),
                  if (published)
                    _buildStatusBadge(
                      context,
                      'Results available',
                      StatusTone.ready(context).withValues(alpha: 0.15),
                      StatusTone.ready(context),
                    )
                  else if (awaiting)
                    _buildStatusBadge(
                      context,
                      'Awaiting evaluation',
                      StatusTone.pending(context).withValues(alpha: 0.15),
                      StatusTone.pending(context),
                    )
                  else if (interview.isExpired)
                    _buildStatusBadge(
                      context,
                      'Expired',
                      StatusTone.failed(context).withValues(alpha: 0.15),
                      StatusTone.failed(context),
                    )
                  else if (interview.isNotYetAvailable)
                    _buildStatusBadge(
                      context,
                      'Scheduled',
                      StatusTone.pending(context).withValues(alpha: 0.15),
                      StatusTone.pending(context),
                    )
                  else if (!interview.hasAttemptsLeft)
                    _buildStatusBadge(
                      context,
                      'No attempts left',
                      StatusTone.failed(context).withValues(alpha: 0.15),
                      StatusTone.failed(context),
                    )
                  else if (interview.maxAttempts != null)
                    _buildStatusBadge(
                      context,
                      '${interview.attemptsRemaining} left',
                      StatusTone.pending(context).withValues(alpha: 0.15),
                      StatusTone.pending(context),
                    ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              Align(
                alignment: Alignment.centerLeft,
                child: _buildActionButton(
                  context,
                  theme,
                  published,
                  awaiting,
                  accessible,
                  completed,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// A non-action state, where a disabled button would misrepresent what the
  /// candidate can do.
  Widget _stateChip(BuildContext context, String label) => Container(
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md, vertical: AppSpacing.sm),
        decoration: BoxDecoration(
          color: WarmSurfaces.surfaceHigh(context),
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: WarmSurfaces.inkMuted(context),
          ),
        ),
      );

  /// The one thing this card lets the candidate do, or a state chip when there
  /// is nothing.
  ///
  /// Order matters, and the closed-round case has to be tested BEFORE the
  /// "already submitted, so offer Replace" case — otherwise a résumé round that
  /// the recruiter has closed still offers to swap a CV they may already have
  /// read.
  Widget _buildActionButton(
    BuildContext context,
    ThemeData theme,
    bool published,
    bool awaiting,
    bool accessible,
    bool completed,
  ) {
    // 1. There is a result to read. Nothing else matters.
    if (published) {
      return FilledButton(
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          minimumSize: Size.zero,
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        ),
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => CandidateResultPage(interview: interview),
          ),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('View Result'),
            SizedBox(width: 4),
            Icon(Icons.arrow_forward, size: 14),
          ],
        ),
      );
    }

    // 2. The round is shut — ended by the recruiter, or past its deadline
    //    (ending pulls `expiresAt` back, so both arrive here identically).
    //    A disabled button would still read as "this is the thing you do
    //    here", so there is no button at all.
    if (!accessible) {
      return _stateChip(
        context,
        completed
            ? 'Submitted'
            : (interview.isNotYetAvailable ? 'Not open yet' : 'Closed'),
      );
    }

    // 3. Open, and already submitted: re-taking or replacing is legitimate
    //    while the window is still open, but only from a deliberate press —
    //    the card body no longer launches.
    // 4. Open and untouched: the normal case.
    return FilledButton(
      style: FilledButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
      onPressed: onLaunch,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // "Launch" is wrong for a résumé round: nothing starts, a file is
          // handed over.
          Text(_isResume
              ? (completed ? 'Replace' : 'Upload')
              : (completed ? 'Re-take' : 'Launch')),
          const SizedBox(width: 4),
          Icon(
            completed
                ? Icons.refresh
                : (_isResume ? Icons.upload_file : Icons.play_arrow),
            size: 14,
          ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final String label;
  final IconData icon;
  const _Header({required this.label, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 16, 4, 12),
      child: Row(
        children: [
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              color: WarmSurfaces.block(context),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 15, color: WarmSurfaces.onBlock),
          ),
          const SizedBox(width: AppSpacing.md - 2),
          Expanded(
            child: Text(
              label.toUpperCase(),
              maxLines: 2,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                letterSpacing: 1.0,
                fontSize: 11.5,
                color: WarmSurfaces.inkSubtle(context),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Wordmark extends StatelessWidget {
  final String subtitle;
  const _Wordmark({required this.subtitle});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        RichText(
          text: TextSpan(
            style: theme.textTheme.titleLarge
                ?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.5),
            children: [
              const TextSpan(text: 'talbot'),
              TextSpan(
                  text: 'iq',
                  style: TextStyle(color: theme.colorScheme.primary)),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Text('· $subtitle',
            style: theme.textTheme.bodyMedium
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      ],
    );
  }
}

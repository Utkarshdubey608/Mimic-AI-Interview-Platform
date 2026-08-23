// lib/features/recruiter/views/runner/conversation_runner_page.dart
//
// On-device candidate runner for the conversational (chatbot) track. A single
// kiosk page that flows through the controller's stages:
// welcome → [résumé step, adaptive only] → system check → chat → scoring →
// completion. Adaptive templates ground the interviewer in the candidate's
// résumé; timed conversational mode shows a thinking/answer countdown.

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:speech_to_text/speech_to_text.dart';

import 'package:talbotiq/shared/widgets/custom_buttons.dart';
import 'package:talbotiq/shared/widgets/custom_inputs.dart';
import 'package:talbotiq/features/recruiter/controllers/conversation_runner_controller.dart';
import 'package:talbotiq/features/recruiter/engine/conversation_engine.dart';
import 'package:talbotiq/features/recruiter/models/recruiter_models.dart';
import 'package:talbotiq/features/recruiter/services/recruiter_gemini_service.dart';
import 'package:talbotiq/features/recruiter/store/recruiter_store.dart';
import 'package:talbotiq/features/recruiter/views/report_page.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

class ConversationRunnerPage extends StatefulWidget {
  final InterviewSession session;
  final InterviewTemplate template;

  /// Optional: run with these questions instead of the template's stored set
  /// (used by the candidate flow launching a Firestore Interview).
  final List<FixedQuestion>? fixedQuestionsOverride;

  /// Optional: fired when scoring completes (e.g. to mirror results to Firestore).
  final void Function(
    InterviewSession completedSession,
    ResultReport report,
    String? scoringError,
  )? onFinished;

  /// Candidate mode hides the result on completion (recruiter publishes it).
  final bool candidateMode;

  /// Recruiter-configured whole-interview time limit, in seconds. Null = none.
  final int? maxDurationSeconds;

  const ConversationRunnerPage({
    super.key,
    required this.session,
    required this.template,
    this.fixedQuestionsOverride,
    this.onFinished,
    this.candidateMode = false,
    this.maxDurationSeconds,
  });

  @override
  State<ConversationRunnerPage> createState() => _ConversationRunnerPageState();
}

class _ConversationRunnerPageState extends State<ConversationRunnerPage> {
  ConversationRunnerController? _c;
  final _answerCtrl = TextEditingController();
  String? _lastTurnId;
  bool _systemCheckAck = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _c ??= ConversationRunnerController(
      session: widget.session,
      template: widget.template,
      store: Provider.of<RecruiterStore>(context, listen: false),
      fixedQuestionsOverride: widget.fixedQuestionsOverride,
      onFinished: widget.onFinished,
      maxDurationSeconds: widget.maxDurationSeconds,
    );
  }

  @override
  void dispose() {
    _answerCtrl.dispose();
    _c?.dispose();
    super.dispose();
  }

  void _syncAnswerField(ConversationRunnerController c) {
    final id = c.engine.awaitingInterviewer?.id;
    if (id != _lastTurnId) {
      _lastTurnId = id;
      final draft = c.engine.awaitingInterviewer?.draft ?? '';
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _answerCtrl.value = TextEditingValue(text: draft);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    // One theme over every stage this page renders. Each stage below builds
    // its own Scaffold, so installing it per stage would be five chances to
    // miss one.
    return RecruiterTheme(child: _buildStages(context));
  }

  Widget _buildStages(BuildContext context) {
    final c = _c!;
    return PopScope(
      // Block back-out while the interview is running AND while it is being
      // scored — popping mid-scoring would dispose the controller under an
      // in-flight Gemini call (see the controller's _disposed guard).
      canPop: c.stage != ConvStage.running && c.stage != ConvStage.scoring,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final navigator = Navigator.of(context);
        final leave = await _confirmLeave();
        if (leave == true) navigator.pop();
      },
      child: ListenableBuilder(
        listenable: c,
        builder: (context, _) {
          switch (c.stage) {
            case ConvStage.welcome:
              return _WelcomeScreen(
                template: widget.template,
                greeting: c.greeting,
                candidateName: c.candidateName,
                adaptive: c.isAdaptive,
                onContinue: c.goToWelcomeNext,
              );
            case ConvStage.resume:
              return _ResumeScreen(onReady: c.setResumeText);
            case ConvStage.systemCheck:
              return _SystemCheckScreen(
                acked: _systemCheckAck,
                onAck: (v) => setState(() => _systemCheckAck = v),
                onContinue: c.goToReadiness,
              );
            case ConvStage.readiness:
              return _ReadinessScreen(
                greeting: c.greeting,
                candidateName: c.candidateName,
                starting: c.starting,
                onReady: c.begin,
              );
            case ConvStage.running:
              _syncAnswerField(c);
              return _ChatStage(
                controller: c,
                template: widget.template,
                answerCtrl: _answerCtrl,
              );
            case ConvStage.scoring:
              return _ScoringScreen(timedOut: c.timedOut);
            case ConvStage.finished:
              return _CompletionScreen(
                sessionId: widget.session.id,
                degraded: c.report?.degraded == true,
                candidateMode: widget.candidateMode,
              );
          }
        },
      ),
    );
  }

  Future<bool?> _confirmLeave() {
    final theme = Theme.of(context);
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Leave interview?'),
        content: const Text(
            'The interview is in progress. Leaving will abandon it without a score.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Stay',
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
          ),
          CustomButton(
            text: 'Leave',
            variant: ButtonVariant.danger,
            onPressed: () => Navigator.pop(ctx, true),
          ),
        ],
      ),
    );
  }
}

// ── Welcome ──────────────────────────────────────────────────────────────────
class _WelcomeScreen extends StatelessWidget {
  final InterviewTemplate template;
  final String greeting;
  final String? candidateName;
  final bool adaptive;
  final VoidCallback onContinue;
  const _WelcomeScreen(
      {required this.template,
      required this.greeting,
      required this.candidateName,
      required this.adaptive,
      required this.onContinue});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final timed = isTimedTemplate(template);
    final hello =
        candidateName != null ? '$greeting, $candidateName' : greeting;
    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(template.branding.companyName.toUpperCase(),
                      style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.secondary,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 1.5)),
                  const SizedBox(height: 10),
                  Text('$hello — welcome',
                      style: theme.textTheme.headlineMedium
                          ?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Text('Conversational interview',
                      style: theme.textTheme.titleMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant)),
                  const SizedBox(height: 12),
                  Text(
                    template.branding.welcomeMessage ??
                        'This is a back-and-forth conversation. Answer naturally — the interviewer may ask follow-ups.',
                    style: theme.textTheme.bodyLarge,
                  ),
                  const SizedBox(height: 24),
                  _rule(context, Icons.chat_bubble_outline,
                      'A conversational interviewer asks one question at a time.'),
                  if (adaptive)
                    _rule(context, Icons.description_outlined,
                        'Questions are tailored to your résumé, which you’ll provide next.'),
                  if (timed)
                    _rule(context, Icons.timer_outlined,
                        'Each question is timed: ${template.conversationTiming!.thinkingSeconds}s to think, ${template.conversationTiming!.perQuestionSeconds}s to answer.')
                  else
                    _rule(context, Icons.self_improvement,
                        'Take your time — this conversation is untimed.'),
                  const SizedBox(height: 28),
                  CustomButton(text: 'Continue', onPressed: onContinue),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _rule(BuildContext context, IconData icon, String text) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: theme.colorScheme.primary),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}

// ── Résumé step (adaptive only) ───────────────────────────────────────────────
class _ResumeScreen extends StatefulWidget {
  final ValueChanged<String> onReady;
  const _ResumeScreen({required this.onReady});

  @override
  State<_ResumeScreen> createState() => _ResumeScreenState();
}

class _ResumeScreenState extends State<_ResumeScreen> {
  final _textCtrl = TextEditingController();
  String? _fileName;
  bool _extracting = false;
  String? _error;

  @override
  void dispose() {
    _textCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickPdf() async {
    if (!recruiterGeminiService.enabled) {
      setState(() => _error =
          'Extracting text from a PDF needs a Gemini key. Add one in Settings, or paste your résumé text below.');
      return;
    }
    final res = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
      withData: true,
    );
    if (!mounted) return;
    if (res == null || res.files.isEmpty) return;
    final f = res.files.first;
    final Uint8List? bytes = f.bytes;
    if (bytes == null) {
      setState(() => _error = 'Could not read the selected file.');
      return;
    }
    if (bytes.lengthInBytes > 10 * 1024 * 1024) {
      setState(() => _error = 'PDF is larger than 10 MB.');
      return;
    }
    setState(() {
      _extracting = true;
      _error = null;
      _fileName = f.name;
    });
    try {
      final text = await recruiterGeminiService.extractResumeText(
          pdfBase64: base64Encode(bytes));
      if (!mounted) return;
      setState(() {
        _extracting = false;
        _textCtrl.text = text;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _extracting = false;
        _error = e.toString().replaceAll('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final canContinue = _textCtrl.text.trim().length >= 30;
    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      appBar: AppBar(
          title: const Text('Your résumé'),
          backgroundColor: theme.colorScheme.surface),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 620),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'The interviewer tailors its questions to your background. Upload a PDF résumé or paste the text below.',
                  style: theme.textTheme.bodyMedium,
                ),
                const SizedBox(height: 16),
                CustomButton(
                  text: _fileName ?? 'Choose PDF résumé',
                  variant: ButtonVariant.outline,
                  isLoading: _extracting,
                  icon: const Icon(Icons.upload_file, size: 18),
                  onPressed: _extracting ? () {} : _pickPdf,
                ),
                const SizedBox(height: 16),
                CustomInputField(
                  label: 'Résumé text',
                  placeholder: 'Paste your résumé text here…',
                  controller: _textCtrl,
                  maxLines: 10,
                  onChanged: (_) => setState(() {}),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(_error!,
                        style: TextStyle(
                            color: theme.colorScheme.error, fontSize: 13)),
                  ),
                const SizedBox(height: 20),
                CustomButton(
                  text: 'Continue',
                  onPressed: canContinue
                      ? () => widget.onReady(_textCtrl.text)
                      : () {},
                ),
                if (!canContinue)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text('Add at least a few lines of résumé text to continue.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                            fontSize: 12,
                            color: theme.colorScheme.onSurfaceVariant)),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── System check ──────────────────────────────────────────────────────────────
class _SystemCheckScreen extends StatelessWidget {
  final bool acked;
  final ValueChanged<bool> onAck;
  final VoidCallback onContinue;
  const _SystemCheckScreen(
      {required this.acked, required this.onAck, required this.onContinue});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      appBar: AppBar(
          title: const Text('System check'),
          backgroundColor: theme.colorScheme.surface),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _check(context, 'You have a stable internet connection'),
                  _check(context, "You're in a quiet, well-lit space"),
                  _check(context, 'You have enough time to finish uninterrupted'),
                  const SizedBox(height: 16),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    value: acked,
                    onChanged: (v) => onAck(v ?? false),
                    title: const Text(
                        'I understand this is a conversational interview and I should answer naturally.'),
                  ),
                  const SizedBox(height: 16),
                  CustomButton(
                    text: 'Continue',
                    onPressed: acked ? onContinue : () {},
                  ),
                  if (!acked)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text('Tick the box above to continue.',
                          style: theme.textTheme.bodyMedium?.copyWith(
                              fontSize: 12,
                              color: theme.colorScheme.onSurfaceVariant)),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _check(BuildContext context, String text) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Icon(Icons.check_circle_outline,
              size: 20, color: theme.colorScheme.primary),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}

// ── Readiness ─────────────────────────────────────────────────────────────────
/// "Are you ready?" step shown after the system check and before questioning.
/// Questioning only starts once the candidate taps "I'm ready"; "I need a
/// moment" simply waits (mirrors the website's readiness Yes/No turn).
class _ReadinessScreen extends StatefulWidget {
  final String greeting;
  final String? candidateName;
  final bool starting;
  final VoidCallback onReady;
  const _ReadinessScreen({
    required this.greeting,
    required this.candidateName,
    required this.starting,
    required this.onReady,
  });

  @override
  State<_ReadinessScreen> createState() => _ReadinessScreenState();
}

class _ReadinessScreenState extends State<_ReadinessScreen> {
  bool _tookAMoment = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = widget.candidateName;
    final hello =
        name != null ? '${widget.greeting}, $name' : widget.greeting;
    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  CircleAvatar(
                    radius: 22,
                    backgroundColor: theme.colorScheme.primary,
                    child: Icon(Icons.record_voice_over,
                        color: theme.colorScheme.onPrimary),
                  ),
                  const SizedBox(height: 20),
                  Text('$hello!',
                      style: theme.textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 10),
                  Text(
                    "I'm really looking forward to our chat. Just relax and "
                    'answer naturally — take your time with each question. '
                    'Are you ready to begin?',
                    style: theme.textTheme.bodyLarge,
                  ),
                  if (_tookAMoment) ...[
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Icon(Icons.favorite_outline,
                            size: 18, color: theme.colorScheme.secondary),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            "No rush — take a breath. Tap \"I'm ready\" whenever "
                            'you\'d like to start.',
                            style: theme.textTheme.bodyMedium?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant),
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 28),
                  CustomButton(
                    text: "I'm ready",
                    isLoading: widget.starting,
                    icon: const Icon(Icons.play_arrow_rounded, size: 20),
                    onPressed: widget.starting ? () {} : widget.onReady,
                  ),
                  const SizedBox(height: 10),
                  CustomButton(
                    text: 'I need a moment',
                    variant: ButtonVariant.outline,
                    onPressed: widget.starting
                        ? () {}
                        : () => setState(() => _tookAMoment = true),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ── Chat stage ────────────────────────────────────────────────────────────────
class _ChatStage extends StatelessWidget {
  final ConversationRunnerController controller;
  final InterviewTemplate template;
  final TextEditingController answerCtrl;

  const _ChatStage({
    required this.controller,
    required this.template,
    required this.answerCtrl,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = controller;
    final engine = c.engine;
    final now = DateTime.now().millisecondsSinceEpoch;

    final timed = engine.isTimed;
    final phase = engine.phase(now);
    final thinking = timed && phase == ConvPhase.thinking;
    final remaining = engine.remainingSeconds(now);
    final total = engine.totalPhaseSeconds(now);
    final warning = timed &&
        remaining <= (template.conversationTiming?.warningThresholdSeconds ?? 15);

    final canType = !c.sending && !thinking;

    // The question the candidate is answering now, kept out of the history feed
    // so it can be shown large + bold in the hero card.
    final current = engine.awaitingInterviewer;
    final history = engine.transcript
        .where((t) => current == null || t.id != current.id)
        .toList();

    // Merge the transcript with display-only acknowledgment bubbles. Each
    // answer's acknowledgment is inserted right after that answer (by ordinal,
    // not by timestamp — the engine stamps the next question with the same
    // time as the answer, so a time sort would misplace it).
    final acks = c.ackBubbles;
    final feed = <_FeedEntry>[];
    var candidateSeen = 0;
    for (final t in history) {
      feed.add(_FeedEntry(turn: t));
      if (t.role == 'candidate') {
        if (candidateSeen < acks.length) {
          feed.add(_FeedEntry(ack: acks[candidateSeen]));
        }
        candidateSeen++;
      }
    }

    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      body: SafeArea(
        child: Column(
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 6),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  RecruiterBadge(
                    text:
                        'Question ${engine.progressCurrent} of ${engine.plannedQuestionCount}',
                    color: theme.colorScheme.secondary,
                  ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (c.overallDeadlineMs != null) ...[
                        _OverallCountdownBadge(deadlineMs: c.overallDeadlineMs!),
                        const SizedBox(width: 8),
                      ],
                      if (timed && phase != null)
                        _TimerPill(
                          thinking: thinking,
                          warning: warning,
                          remaining: remaining,
                        ),
                    ],
                  ),
                ],
              ),
            ),
            if (timed && phase != null && total > 0)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: (remaining / total).clamp(0.0, 1.0),
                    minHeight: 4,
                    backgroundColor:
                        theme.colorScheme.onSurface.withValues(alpha: 0.06),
                    valueColor: AlwaysStoppedAnimation(warning
                        ? theme.colorScheme.error
                        : theme.colorScheme.primary),
                  ),
                ),
              ),
            // Hero: the current question, large + bold.
            _questionCard(context, current, c.sending),
            // History: previous exchanges, quieter.
            Expanded(
              child: feed.isEmpty
                  ? _emptyHistory(context)
                  : ListView(
                      reverse: true,
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
                      children: feed.reversed
                          .map((e) => e.ack != null
                              ? _ackBubble(context, e.ack!)
                              : _bubble(context, e.turn!))
                          .toList(),
                    ),
            ),
            // Input
            _ChatInputBar(
              controller: controller,
              template: template,
              answerCtrl: answerCtrl,
              canType: canType,
              thinking: thinking,
              warning: warning,
            ),
          ],
        ),
      ),
    );
  }

  Widget _questionCard(
      BuildContext context, ConvTurn? current, bool sending) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final showTyping = sending || current == null;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(20, 12, 20, 6),
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            theme.colorScheme.primaryContainer
                .withValues(alpha: isDark ? 0.45 : 0.7),
            theme.colorScheme.secondaryContainer
                .withValues(alpha: isDark ? 0.35 : 0.5),
          ],
        ),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
            color: theme.colorScheme.primary.withValues(alpha: 0.18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 14,
                backgroundColor: theme.colorScheme.primary,
                child: Icon(Icons.record_voice_over,
                    size: 16, color: theme.colorScheme.onPrimary),
              ),
              const SizedBox(width: 10),
              Text('INTERVIEWER',
                  style: theme.textTheme.labelSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.5,
                      color: theme.colorScheme.onSurfaceVariant)),
              if (current?.isFollowUp == true) ...[
                const SizedBox(width: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.secondary.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text('FOLLOW-UP',
                      style: theme.textTheme.labelSmall?.copyWith(
                          fontSize: 9,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 1,
                          color: theme.colorScheme.secondary)),
                ),
              ],
            ],
          ),
          const SizedBox(height: 14),
          if (showTyping)
            Row(
              children: [
                _ThinkingDots(color: theme.colorScheme.primary),
                const SizedBox(width: 12),
                Text('Thinking…',
                    style: theme.textTheme.titleMedium
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ],
            )
          else
            Text(
              current.content,
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w700,
                height: 1.3,
                color: theme.colorScheme.onSurface,
              ),
            ),
        ],
      ),
    );
  }

  Widget _emptyHistory(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.forum_outlined,
                size: 32,
                color: theme.colorScheme.onSurfaceVariant
                    .withValues(alpha: 0.5)),
            const SizedBox(height: 8),
            Text('Your answers will appear here.',
                style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant)),
          ],
        ),
      ),
    );
  }

  Widget _bubble(BuildContext context, ConvTurn t) {
    final theme = Theme.of(context);
    final isInterviewer = t.role == 'interviewer';
    final bg = isInterviewer
        ? theme.colorScheme.surfaceContainerHighest
        : theme.colorScheme.primary.withValues(alpha: 0.16);
    return Align(
      alignment:
          isInterviewer ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.78),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(20),
            topRight: const Radius.circular(20),
            bottomLeft: Radius.circular(isInterviewer ? 4 : 16),
            bottomRight: Radius.circular(isInterviewer ? 16 : 4),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (isInterviewer && t.isFollowUp)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text('FOLLOW-UP',
                    style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.secondary,
                        fontWeight: FontWeight.w600,
                        letterSpacing: 1)),
              ),
            Text(
              t.content.isEmpty ? '(no answer)' : t.content,
              style: theme.textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }

  /// A quiet, display-only interviewer acknowledgment bubble ("Thanks — got
  /// it.") shown between an answer and the next question.
  Widget _ackBubble(BuildContext context, ChatAck ack) {
    final theme = Theme.of(context);
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
            maxWidth: MediaQuery.of(context).size.width * 0.78),
        decoration: BoxDecoration(
          color: theme.colorScheme.secondary.withValues(alpha: 0.12),
          borderRadius: const BorderRadius.only(
            topLeft: Radius.circular(20),
            topRight: Radius.circular(20),
            bottomLeft: Radius.circular(4),
            bottomRight: Radius.circular(20),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.check_rounded,
                size: 16, color: theme.colorScheme.secondary),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                ack.text,
                style: theme.textTheme.bodyMedium?.copyWith(
                    fontStyle: FontStyle.italic,
                    color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One entry in the merged chat feed: either a transcript [turn] or a
/// display-only acknowledgment [ack].
class _FeedEntry {
  final ConvTurn? turn;
  final ChatAck? ack;
  const _FeedEntry({this.turn, this.ack});
}

/// Three pulsing dots — an animated "Thinking…" indicator. Owns an
/// [AnimationController] that repeats while mounted and is disposed with it.
class _ThinkingDots extends StatefulWidget {
  final Color color;
  const _ThinkingDots({required this.color});

  @override
  State<_ThinkingDots> createState() => _ThinkingDotsState();
}

class _ThinkingDotsState extends State<_ThinkingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat();

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _ctrl,
      builder: (context, _) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(3, (i) {
            // Each dot's opacity leads the next by a third of the cycle.
            final phase = (_ctrl.value - i * 0.2) % 1.0;
            final t = (1 - (phase - 0.5).abs() * 2).clamp(0.0, 1.0);
            final opacity = 0.3 + 0.7 * t;
            return Padding(
              padding: EdgeInsets.only(right: i < 2 ? 5 : 0),
              child: Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: widget.color.withValues(alpha: opacity),
                ),
              ),
            );
          }),
        );
      },
    );
  }
}

/// Countdown pill shown in the chat header during timed conversational mode.
class _TimerPill extends StatelessWidget {
  final bool thinking;
  final bool warning;
  final int remaining;
  const _TimerPill(
      {required this.thinking, required this.warning, required this.remaining});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color =
        warning ? theme.colorScheme.error : theme.colorScheme.primary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(thinking ? Icons.lightbulb_outline : Icons.timer,
              size: 16, color: color),
          const SizedBox(width: 6),
          Text('${thinking ? 'Think' : 'Answer'} · ${remaining}s',
              style: TextStyle(
                  fontFeatures: const [FontFeature.tabularFigures()],
                  fontWeight: FontWeight.w600,
                  color: color)),
        ],
      ),
    );
  }
}

/// Whole-interview countdown for the recruiter-configured cap. Distinct from
/// [_TimerPill] (per-question), and self-ticking so an untimed chat isn't
/// rebuilt every second just to advance this clock.
class _OverallCountdownBadge extends StatefulWidget {
  final int deadlineMs;
  const _OverallCountdownBadge({required this.deadlineMs});

  @override
  State<_OverallCountdownBadge> createState() => _OverallCountdownBadgeState();
}

class _OverallCountdownBadgeState extends State<_OverallCountdownBadge> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final left = widget.deadlineMs - DateTime.now().millisecondsSinceEpoch;
    final secs = left <= 0 ? 0 : (left / 1000).floor();
    final warning = secs <= 60;
    final color = warning ? theme.colorScheme.error : theme.colorScheme.primary;
    final m = secs ~/ 60;
    final s = secs % 60;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.hourglass_bottom, size: 16, color: color),
          const SizedBox(width: 6),
          Text(
            '$m:${s.toString().padLeft(2, '0')} left',
            style: TextStyle(
              fontFeatures: const [FontFeature.tabularFigures()],
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

/// Answer input with a voice (speech-to-text) mic. While listening, recognized
/// words stream into the answer field; the candidate can still type/edit.
class _ChatInputBar extends StatefulWidget {
  final ConversationRunnerController controller;
  final InterviewTemplate template;
  final TextEditingController answerCtrl;
  final bool canType;
  final bool thinking;
  final bool warning;

  const _ChatInputBar({
    required this.controller,
    required this.template,
    required this.answerCtrl,
    required this.canType,
    required this.thinking,
    required this.warning,
  });

  @override
  State<_ChatInputBar> createState() => _ChatInputBarState();
}

class _ChatInputBarState extends State<_ChatInputBar> {
  final SpeechToText _speech = SpeechToText();
  bool _speechReady = false;
  bool _listening = false;
  String _base = '';

  @override
  void initState() {
    super.initState();
    _initSpeech();
  }

  Future<void> _initSpeech() async {
    try {
      _speechReady = await _speech.initialize(
        onStatus: (s) {
          if ((s == 'done' || s == 'notListening') && mounted) {
            setState(() => _listening = false);
          }
        },
        onError: (_) {
          if (mounted) setState(() => _listening = false);
        },
      );
    } catch (_) {
      _speechReady = false;
    }
    if (mounted) setState(() {});
  }

  Future<void> _toggleMic() async {
    if (_listening) {
      await _speech.stop();
      if (mounted) setState(() => _listening = false);
      return;
    }
    if (!_speechReady) {
      _speechReady = await _speech.initialize();
      if (!_speechReady) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('Voice input isn\'t available on this device.')));
        }
        return;
      }
    }
    if (!mounted) return;
    _base = widget.answerCtrl.text.trimRight();
    setState(() => _listening = true);
    await _speech.listen(
      onResult: (result) {
        final words = result.recognizedWords;
        final combined = _base.isEmpty ? words : '$_base $words';
        widget.answerCtrl.value = TextEditingValue(
          text: combined,
          selection: TextSelection.collapsed(offset: combined.length),
        );
        widget.controller.saveDraft(combined);
      },
      listenOptions: SpeechListenOptions(
        partialResults: true,
        listenMode: ListenMode.dictation,
      ),
    );
  }

  @override
  void dispose() {
    _speech.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final integrity = widget.template.integrity;
    final canType = widget.canType;
    final thinking = widget.thinking;

    // Stop listening if answering is no longer allowed.
    if (!canType && _listening) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _listening) _toggleMic();
      });
    }

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
            top: BorderSide(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.08))),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (thinking)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Icon(Icons.lightbulb_outline,
                      size: 16, color: theme.colorScheme.secondary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text('Take a moment to think before answering.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                            fontSize: 12,
                            color: theme.colorScheme.onSurfaceVariant)),
                  ),
                  if (widget.template.conversationTiming?.allowSkipThinking ==
                      true)
                    TextButton(
                      onPressed: widget.controller.skipThinking,
                      child: const Text('Start now'),
                    ),
                ],
              ),
            ),
          if (_listening)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Icon(Icons.graphic_eq,
                      size: 16, color: theme.colorScheme.error),
                  const SizedBox(width: 8),
                  Text('Listening… speak your answer',
                      style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.error,
                          fontWeight: FontWeight.w600)),
                ],
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              _MicButton(
                listening: _listening,
                enabled: canType && _speechReady,
                onTap: _toggleMic,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: widget.answerCtrl,
                  enabled: canType,
                  minLines: 1,
                  maxLines: 5,
                  style: theme.textTheme.bodyLarge,
                  textCapitalization: TextCapitalization.sentences,
                  enableInteractiveSelection: !integrity.disableCopy,
                  contextMenuBuilder: integrity.disablePasteInAnswers
                      ? (ctx, state) => const SizedBox.shrink()
                      : null,
                  onChanged: widget.controller.saveDraft,
                  decoration: InputDecoration(
                    hintText:
                        thinking ? 'Thinking time…' : 'Type or speak your answer…',
                    filled: true,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(20),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              _SendButton(
                enabled: canType,
                onSend: () {
                  if (_listening) _speech.stop();
                  widget.controller.submit(widget.answerCtrl.text);
                },
              ),
            ],
          ),
          if (widget.warning)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('Time almost up — your answer will auto-submit.',
                  style: TextStyle(
                      color: theme.colorScheme.error,
                      fontSize: 11,
                      fontWeight: FontWeight.w600)),
            ),
        ],
      ),
    );
  }
}

/// Circular mic toggle; pulses red while listening.
class _MicButton extends StatelessWidget {
  final bool listening;
  final bool enabled;
  final VoidCallback onTap;
  const _MicButton(
      {required this.listening, required this.enabled, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bg = listening
        ? theme.colorScheme.error
        : (enabled
            ? theme.colorScheme.primary.withValues(alpha: 0.12)
            : theme.colorScheme.onSurface.withValues(alpha: 0.06));
    final fg = listening
        ? theme.colorScheme.onError
        : (enabled
            ? theme.colorScheme.primary
            : theme.colorScheme.onSurfaceVariant);
    return Material(
      color: bg,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: enabled ? onTap : null,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Icon(listening ? Icons.mic : Icons.mic_none, color: fg),
        ),
      ),
    );
  }
}

class _SendButton extends StatelessWidget {
  final bool enabled;
  final VoidCallback onSend;
  const _SendButton({required this.enabled, required this.onSend});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Material(
      color: enabled
          ? theme.colorScheme.primary
          : theme.colorScheme.primary.withValues(alpha: 0.3),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: enabled ? onSend : null,
        child: const Padding(
          padding: EdgeInsets.all(12),
          child: Icon(Icons.send, size: 20, color: Colors.white),
        ),
      ),
    );
  }
}

// ── Scoring ────────────────────────────────────────────────────────────────
class _ScoringScreen extends StatelessWidget {
  final bool timedOut;
  const _ScoringScreen({this.timedOut = false});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const CircularProgressIndicator(),
              const SizedBox(height: 20),
              Text(
                timedOut
                    ? 'Time is up. Your interview has been automatically '
                        'submitted. Please wait while we process your responses.'
                    : 'Scoring your interview…',
                textAlign: TextAlign.center,
                style: theme.textTheme.titleMedium,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Completion ────────────────────────────────────────────────────────────────
class _CompletionScreen extends StatelessWidget {
  final String sessionId;
  final bool degraded;

  /// In candidate mode the result is hidden — it's shown only after the
  /// recruiter reviews and publishes it.
  final bool candidateMode;
  const _CompletionScreen({
    required this.sessionId,
    required this.degraded,
    this.candidateMode = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.check_circle,
                    size: 64, color: theme.colorScheme.primary),
                const SizedBox(height: 16),
                Text('All done — thank you!',
                    style: theme.textTheme.headlineSmall
                        ?.copyWith(fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Text(
                    candidateMode
                        ? 'Your responses have been submitted. Results will be '
                            'available once the recruiter publishes them.'
                        : 'The conversation has been scored.',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodyMedium),
                const SizedBox(height: 24),
                if (!candidateMode)
                  CustomButton(
                    text: 'View report',
                    onPressed: () {
                      Navigator.of(context).pushReplacement(
                        MaterialPageRoute(
                          builder: (_) => ReportPage(sessionId: sessionId),
                        ),
                      );
                    },
                  ),
                if (!candidateMode) const SizedBox(height: 10),
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(candidateMode ? 'Done' : 'Back to sessions',
                      style: TextStyle(
                          color: theme.colorScheme.onSurfaceVariant)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

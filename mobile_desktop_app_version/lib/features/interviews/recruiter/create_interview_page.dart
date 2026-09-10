// lib/features/interviews/recruiter/create_interview_page.dart
//
// Where a recruiter configures an interview (prompt + questions + avatar) and
// assigns it to a candidate email. This is the new home for the prompt/avatar
// config that previously lived in Settings. Saving writes an `Interview` doc
// to Firestore (see InterviewRepository), scoped to the current recruiter.

import 'package:file_picker/file_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/shared/models/app_models.dart';
import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/net/backend_client.dart';
import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/core/utils/validators.dart';
import 'package:talbotiq/features/interviews/shared/avatar_picker.dart';
import 'package:talbotiq/core/services/avatar_catalog.dart';
import 'package:talbotiq/shared/widgets/custom_buttons.dart';
import 'package:talbotiq/shared/widgets/custom_inputs.dart';
import 'package:talbotiq/features/auth/auth_service.dart';
import 'package:talbotiq/features/recruiter/views/widgets/question_templates_bar.dart';
import 'package:talbotiq/features/recruiter/voice/voice_catalog.dart';
import 'package:talbotiq/features/recruiter/voice/voice_models.dart';
import 'package:talbotiq/features/recruiter/voice/voice_picker.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/models/test_summary.dart';
import 'package:talbotiq/features/interviews/recruiter/candidate_import_preview_page.dart';
import 'package:talbotiq/features/interviews/recruiter/round_timeline_page.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/round_step_tile.dart';
import 'package:talbotiq/features/interviews/services/candidate_import_service.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/core/deep_link/deep_link_service.dart';
import 'package:talbotiq/features/recruiter/models/mcq_set.dart';
import 'package:talbotiq/features/recruiter/store/mcq_sets_store.dart';
import 'package:talbotiq/features/mailer/models/email_template.dart';
import 'package:talbotiq/features/mailer/services/mailer_service.dart';
import 'package:talbotiq/features/mailer/widgets/notify_candidates_card.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

class CreateInterviewPage extends StatefulWidget {
  /// When provided, the page edits this interview instead of creating a new one.
  final Interview? existing;

  /// Round-configuration mode: this form configures ONE round of a timeline and
  /// returns it via `Navigator.pop`, writing nothing itself.
  ///
  /// This mode exists so a round is configured through the SAME fields, labels,
  /// validation and behaviour as creating a standalone interview of that type.
  /// There was previously a second, simplified round editor; two config surfaces
  /// for one thing meant they drifted, and a recruiter met different options
  /// depending on how they arrived.
  final bool roundConfigMode;

  /// The round being configured. Null in [roundConfigMode] means a new round.
  final InterviewRound? roundDraft;

  /// Timeline position for a new round.
  final int roundOrder;

  /// The test's shared delivery config, used to pre-fill a NEW round so the
  /// recruiter does not re-pick the avatar and language for every stage.
  final Map<String, dynamic>? sharedConfig;

  const CreateInterviewPage({super.key, this.existing})
      : roundConfigMode = false,
        roundDraft = null,
        roundOrder = 0,
        sharedConfig = null;

  /// Opens this form as the configuration screen for one round.
  const CreateInterviewPage.configureRound({
    super.key,
    this.roundDraft,
    this.roundOrder = 0,
    this.sharedConfig,
  })  : roundConfigMode = true,
        existing = null;

  @override
  State<CreateInterviewPage> createState() => _CreateInterviewPageState();
}

class _CreateInterviewPageState extends State<CreateInterviewPage> {
  InterviewType _type = InterviewType.video;

  /// Single stage (the original behaviour) vs a multi-round pipeline.
  ///
  /// The difference that matters is WHEN candidates see anything. Single-round
  /// assigns immediately, as it always has. Multi-round designs the whole
  /// timeline first and then assigns candidates to ROUND 1 ONLY — so a candidate
  /// never sees a half-built test, and never ends up holding both a round-less
  /// assignment and a round one for the same test.
  bool _multiRound = false;

  /// The timeline being built, in running order. Held in memory because rounds
  /// live at `tests/{testId}/rounds` and that test id does not exist until save.
  /// Their `id` is empty until then.
  final List<InterviewRound> _rounds = [];

  // ── Round-configuration mode only ────────────────────────────────────────
  //
  // The kind is held separately from [_type] because a round can be a résumé
  // screen, which is not an interview track at all.
  RoundKind _roundKind = RoundKindX.fromInterviewType(InterviewType.video);
  final _requiredSkillsController = TextEditingController();
  final _niceToHaveController = TextEditingController();
  double? _minYears;
  int? _minScore;
  AdvanceMode _advanceMode = AdvanceMode.manual;
  num? _advanceValue;

  // ── MCQ rounds only ──────────────────────────────────────────────────────
  //
  // Which authored paper this round assigns. An ID, never the paper: it contains
  // the ANSWER KEY, and an interview document is readable by the candidate it is
  // assigned to. The server resolves it per request and projects it through an
  // allow-list. See lib/features/interviews/candidate/mcq/.
  String _mcqSetId = '';

  /// The papers this recruiter has authored, for the picker. Null while loading;
  /// empty means they have not written one yet, which is a different thing and is
  /// said differently.
  List<McqSet>? _mcqSets;
  String? _mcqError;
  bool _mcqLoading = false;

  bool get _isRoundConfig => widget.roundConfigMode;

  /// The rounds already on an EXISTING test, shown in the edit form so a
  /// recruiter can jump straight into configuring one. Null while loading.
  List<InterviewRound>? _existingRounds;

  // Chat track only: fixed question list vs adaptive (AI generates
  // résumé-grounded questions) vs mixed (a fixed portion followed by
  // résumé-adapted ones). Video always uses the fixed list.
  //
  // `_adaptive` stays as a getter derived from this rather than its own field:
  // every place that used to assign it directly (hydration, the toggle) now
  // sets `_questionSource` instead, so the two can never fall out of sync.
  String _questionSource = 'fixed';
  bool get _adaptive => _questionSource == 'adaptive';
  int _adaptiveNumQuestions = 5;
  bool _adaptiveFollowUps = true;

  // Mixed mode's own counts (Feature 3): how many of [_mixedTotal] questions
  // come from the fixed list (built with the same `_questionControllers` as
  // "Fixed list" mode) vs are résumé-adapted afterwards.
  int _mixedTotal = 8;
  int _mixedFixed = 5;
  int _mixedResume = 3;

  /// True when Mixed mode's counts don't add up. Gates Save the same way the
  /// other inline failures in [_save]/[_saveRound] do, but live rather than
  /// only on submit — the three fields interact, and a recruiter should see
  /// the mismatch the moment they create it.
  bool get _mixedCountsInvalid =>
      _questionSource == 'mixed' &&
      (_mixedFixed < 0 ||
          _mixedResume < 0 ||
          _mixedFixed + _mixedResume != _mixedTotal);

  // Video track: ask the candidate for a résumé before the call to ground the
  // avatar's questions.
  bool _collectResume = false;

  // Voice track: selected Gemini Live voice + persona.
  String? _voiceName;
  String? _voicePersonaId;

  // The value actually persisted for a Voice interview/round: an explicit,
  // recognized selection, or else VoiceCatalog's existing default — never
  // null. See VoiceCatalog.resolveVoiceId/resolvePersonaId.
  String get _resolvedVoiceName => VoiceCatalog.resolveVoiceId(_voiceName);

  String get _resolvedVoicePersonaId =>
      VoiceCatalog.resolvePersonaId(_voicePersonaId);

  // Chat proctoring/integrity (enforced by the conversation runner) + branding.
  bool _detectTabSwitch = true;
  bool _disablePaste = true;
  bool _disableCopy = false;
  final _welcomeController = TextEditingController();

  // Chat track: optional per-question countdown timer. When enabled the chat
  // runner runs in timed mode and auto-submits the current answer at zero.
  bool _chatTimerEnabled = false;
  int _chatTimerPerQuestion = 120; // seconds; 30–600
  int _chatTimerThinking = 0; // seconds; 0 = no separate thinking phase
  bool _chatTimerAutoSubmit = true;

  // Interview language (avatar speech + adaptive interviewer).
  String _language = 'English';
  static const List<String> _languages = [
    'English', 'Spanish', 'French', 'German', 'Hindi', 'Portuguese',
    'Italian', 'Japanese', 'Mandarin', 'Arabic', 'Dutch', 'Korean',
  ];

  final _titleController = TextEditingController();
  final _promptController = TextEditingController();
  final _replicaIdController = TextEditingController();
  final _personaIdController = TextEditingController();
  final List<TextEditingController> _candidateEmailControllers = [
    TextEditingController(),
  ];

  /// Role classification for a candidate added via file import (Feature 1),
  /// keyed by that candidate's OWN [TextEditingController] rather than by
  /// index — so the mapping survives inserts/removals in
  /// [_candidateEmailControllers] without index bookkeeping. Absent for every
  /// candidate typed in by hand, which reads as "not classified": role
  /// assignment on import is best-effort, not a requirement.
  final Map<TextEditingController, String> _candidateRoleCategories = {};

  /// The raw role text the import extracted/the recruiter edited for that
  /// candidate, alongside [_candidateRoleCategories].
  final Map<TextEditingController, String> _candidateRawRoles = {};
  final List<TextEditingController> _questionControllers = [
    TextEditingController(),
  ];
  int _durationMinutes = 15;
  DateTime? _availableFrom;
  DateTime? _expiresAt;
  int? _maxAttempts; // null = unlimited

  /// Which clients the candidate may take this on.
  ///
  /// Starts with all three, which the model stores as NO restriction — the two are
  /// one policy. A recruiter narrows it only when the interview genuinely needs a
  /// particular client.
  final Set<String> _allowedDevices = {'web', 'mobile', 'desktop'};

  // Per-test key overrides. When off, candidates run this test on the
  // recruiter's Settings keys; when on, any field filled here is used instead.

  // Candidate invite emails (mailer backend). Off unless the recruiter opts in;
  // a null template means the backend's default is used.
  bool _notifyByEmail = false;
  EmailTemplate? _emailTemplate;
  late final MailerService _mailer;
  String _recruiterEmail = '';

  List<TavusReplica> _replicas = const [];
  bool _loadingReplicas = false;
  bool _saving = false;
  bool _timingAccessExpanded = false;
  bool _advancedExpanded = false;
  String? _error;
  String? _recruiterName;

  bool get _isEdit => widget.existing != null;

  // Sensible default questions pre-filled on a new interview.
  static const _defaultQuestions = [
    'Tell me about yourself and your background.',
    'Describe a challenging problem you solved recently.',
    'How do you handle pressure and tight deadlines?',
    'Where do you see yourself in 3 years?',
    'Do you have any questions for us?',
  ];

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    if (_isRoundConfig) {
      _hydrateForRound();
    } else if (existing != null) {
      _hydrateFrom(existing);
      _recruiterName = existing.recruiterName;
      // Open Advanced when this interview was customised, so reopening it never
      // hides a choice the recruiter already made.
      _advancedExpanded = _advancedDifferences.isNotEmpty;
      _loadExistingRounds(existing);
    } else {
      // Pre-fill the prompt with the app's default interviewer prompt and the
      // five default questions.
      _promptController.text = DraftForm.defaults().conversationalContext;
      _questionControllers
        ..clear()
        ..addAll(_defaultQuestions.map((q) => TextEditingController(text: q)));
    }
    // Resolve the recruiter's display name for the candidate screen.
    final user = FirebaseAuth.instance.currentUser;
    _recruiterName ??= user?.displayName;
    // Their email owns any template they save and scopes the ones they see.
    _recruiterEmail = user?.email ?? '';
    _mailer = MailerService();
    if (_recruiterName == null && user != null) {
      context.read<AuthService>().nameFor(user.uid).then((n) {
        if (n != null && mounted) setState(() => _recruiterName = n);
      });
    }
    _loadReplicas();
  }

  /// Fills this form from the round being configured.
  ///
  /// Routed through [InterviewRound.assignTo] and then [_hydrateFrom] rather than
  /// unpacking `config` by hand. That is the same code path a candidate's
  /// assignment goes through, so every field this form offers is guaranteed to
  /// round-trip — a config key the form can edit but the hydrator forgot would
  /// otherwise silently reset each time the round was reopened.
  void _hydrateForRound() {
    final draft = widget.roundDraft;
    _roundKind = draft?.kind ?? RoundKind.chat;

    // A new round starts from the test's shared delivery config, so the avatar
    // and language are not re-picked per stage.
    final source = draft ??
        InterviewRound(
          id: '',
          testId: '',
          recruiterId: '',
          order: widget.roundOrder,
          title: '',
          kind: _roundKind,
          config: widget.sharedConfig ?? const {},
        );

    _hydrateFrom(source.assignTo(
      candidateEmail: '',
      recruiterEmail: '',
      testTitle: source.title,
    ));

    // assignTo has no notion of these — they are round concepts.
    _titleController.text = draft?.title ?? '';
    _candidateEmailControllers.first.text = '';
    _opensClosesFromRound(source);
    _requiredSkillsController.text =
        source.criteria.requiredSkills.join(', ');
    _niceToHaveController.text = source.criteria.niceToHave.join(', ');
    _minYears = source.criteria.minYears;
    _minScore = source.criteria.minScore;
    _advanceMode = source.advance.mode;
    _advanceValue = source.advance.value;

    // A brand-new AI-run round gets the same starter questions a standalone
    // interview does, rather than an empty list the recruiter must fill blind.
    //
    // `usesAiInterviewer`, not `isInterview`: an MCQ round's questions live on the
    // paper it references, and a two-way round's are asked by a person. Seeding
    // either writes a script no one will ever read.
    if (draft == null && _roundKind.usesAiInterviewer) {
      _promptController.text = DraftForm.defaults().conversationalContext;
      _questionControllers
        ..clear()
        ..addAll(_defaultQuestions.map((q) => TextEditingController(text: q)));
    }
    _advancedExpanded = false;
  }

  void _opensClosesFromRound(InterviewRound r) {
    _availableFrom = r.opensAt;
    _expiresAt = r.closesAt;
  }

  /// Loads the rounds of the test this assignment belongs to, so the edit form
  /// can offer "configure that round" instead of nothing.
  Future<void> _loadExistingRounds(Interview existing) async {
    final testId =
        existing.testId.isNotEmpty ? existing.testId : existing.id;
    final rounds = await context.read<InterviewRepository>().fetchRounds(
          testId: testId,
          recruiterId: existing.recruiterId,
        );
    if (!mounted) return;
    setState(() => _existingRounds = rounds);
  }

  void _hydrateFrom(Interview i) {
    _type = i.type;
    // `effectiveRoundKind` falls back to `type` for pre-timeline documents, so
    // this is right for both a live round and a legacy AI one.
    _roundKind = i.effectiveRoundKind;
    // Both hydration paths land here — the round editor goes through
    // `assignTo` first — so this one line covers reopening a round and editing
    // an existing assignment.
    _mcqSetId = i.mcqSetId;
    // Fetched so the picker can show what is already attached. Fire-and-forget:
    // it sets state when it lands, and the rest of the form does not wait.
    if (_roundKind.needsMcqPaper) _loadMcqSets();
    // Mixed wins over adaptive when both would otherwise apply: a mixed
    // interview is written with `adaptive: false` (see the two write sites),
    // but read it defensively in case a document predates that guarantee.
    if (i.isMixedSource) {
      _questionSource = 'mixed';
      final mc = i.mixedConfig;
      _mixedTotal = (mc?['totalQuestions'] as num?)?.toInt() ?? _mixedTotal;
      _mixedFixed = (mc?['fixedQuestionCount'] as num?)?.toInt() ?? _mixedFixed;
      _mixedResume =
          (mc?['resumeQuestionCount'] as num?)?.toInt() ?? _mixedResume;
    } else {
      _questionSource = i.adaptive ? 'adaptive' : 'fixed';
    }
    _collectResume = i.collectResume;
    _language = _languages.contains(i.language) ? i.language : 'English';
    _voiceName = i.voiceName;
    _voicePersonaId = i.voicePersonaId;
    final integ = i.integrity;
    if (integ != null) {
      _detectTabSwitch = integ['detectTabSwitch'] as bool? ?? true;
      _disablePaste = integ['disablePasteInAnswers'] as bool? ?? true;
      _disableCopy = integ['disableCopy'] as bool? ?? false;
    }
    final brand = i.branding;
    if (brand != null) {
      _welcomeController.text = (brand['welcomeMessage'] as String?) ?? '';
    }
    final timer = i.chatTimer;
    if (timer != null) {
      _chatTimerEnabled = timer['enabled'] as bool? ?? false;
      _chatTimerPerQuestion =
          (timer['perQuestionSeconds'] as num?)?.toInt() ?? 120;
      _chatTimerThinking = (timer['thinkingSeconds'] as num?)?.toInt() ?? 0;
      _chatTimerAutoSubmit = timer['autoSubmitOnExpiry'] as bool? ?? true;
    }
    final ac = i.adaptiveConfig;
    if (ac != null) {
      _adaptiveNumQuestions = (ac['numberOfQuestions'] as num?)?.toInt() ?? 5;
      _adaptiveFollowUps = ac['allowFollowUps'] as bool? ?? true;
    }
    _titleController.text = i.title;
    _promptController.text = i.prompt;
    _replicaIdController.text = i.avatar.replicaId;
    _personaIdController.text = i.avatar.personaId ?? '';
    _candidateEmailControllers.first.text = i.candidateEmail;
    _questionControllers.clear();
    for (final q in (i.questions.isEmpty ? [''] : i.questions)) {
      _questionControllers.add(TextEditingController(text: q));
    }
    _durationMinutes = i.durationMinutes;
    _availableFrom = i.availableFrom;
    _expiresAt = i.expiresAt;
    _maxAttempts = i.maxAttempts;
    // Empty on the document means unrestricted, which is all three here.
    _allowedDevices
      ..clear()
      ..addAll(i.allowedDevices.isEmpty
          ? const {'web', 'mobile', 'desktop'}
          : i.allowedDevices);
  }

  @override
  void dispose() {
    _titleController.dispose();
    _welcomeController.dispose();
    _promptController.dispose();
    _replicaIdController.dispose();
    _personaIdController.dispose();
    _requiredSkillsController.dispose();
    _niceToHaveController.dispose();
    for (final c in _candidateEmailControllers) {
      c.dispose();
    }
    for (final c in _questionControllers) {
      c.dispose();
    }
    _mailer.dispose();
    super.dispose();
  }

  void _addCandidate() =>
      setState(() => _candidateEmailControllers.add(TextEditingController()));

  void _removeCandidate(int i) {
    if (_candidateEmailControllers.length == 1) return;
    setState(() {
      final controller = _candidateEmailControllers.removeAt(i);
      _candidateRoleCategories.remove(controller);
      _candidateRawRoles.remove(controller);
      controller.dispose();
    });
  }

  /// Bulk-imports candidates from a spreadsheet/CSV/text file via the backend's
  /// role-aware extractor (Feature 1) — the SAME column-aware, role-classifying
  /// parser the web invite wizard uses.
  ///
  /// Replaces the old on-device "regex every email out of a flattened text
  /// blob" approach: that had no notion of columns (an ID or phone-number
  /// column could be mistaken for one) or of role, and the product spec bans
  /// guessing a candidate's role from their email address. The recruiter
  /// reviews every row — including a best-effort role match — before anything
  /// here is merged into the candidate list, in [CandidateImportPreviewPage].
  Future<void> _importEmails() async {
    final messenger = ScaffoldMessenger.of(context);
    final res = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['csv', 'txt', 'xlsx'],
      withData: true,
    );
    if (!mounted) return;
    if (res == null || res.files.isEmpty) return;
    final bytes = res.files.first.bytes;
    if (bytes == null) {
      messenger.showSnackBar(
          const SnackBar(content: Text('Could not read the selected file.')));
      return;
    }

    CandidateImportResult result;
    try {
      // The page's own "Job Title / Interview Role" field is the best guess
      // for candidates the classifier cannot place on its own.
      result = await candidateImportService.extractFromFile(
        bytes: bytes,
        filename: res.files.first.name,
        fallbackRole: _titleController.text.trim(),
      );
    } on BackendException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(
          SnackBar(content: Text('Could not read that file: ${e.message}')));
      return;
    } catch (e) {
      if (!mounted) return;
      messenger
          .showSnackBar(SnackBar(content: Text('Could not read that file: $e')));
      return;
    }
    if (!mounted) return;

    if (result.rows.isEmpty) {
      messenger.showSnackBar(
          const SnackBar(content: Text('No candidates found in that file.')));
      return;
    }

    final finalized =
        await Navigator.of(context).push<List<ImportedCandidateRow>>(
      MaterialPageRoute(
        builder: (_) => CandidateImportPreviewPage(
          rows: result.rows,
          warnings: result.warnings,
        ),
      ),
    );
    if (!mounted || finalized == null || finalized.isEmpty) return;

    // De-duplicate against existing entries (case-insensitive), preserving
    // order — same contract the old flow had.
    final existing = _candidateEmails.map((e) => e.toLowerCase()).toSet();
    final seen = <String>{};
    var added = 0;
    setState(() {
      for (final row in finalized) {
        final email = row.email.trim();
        if (email.isEmpty) continue;
        final lower = email.toLowerCase();
        if (existing.contains(lower) || !seen.add(lower)) continue;

        // Reuse the first blank row if there is one, else append — the exact
        // mechanism "Add candidate" and the old import both used.
        final blankIndex = _candidateEmailControllers
            .indexWhere((c) => c.text.trim().isEmpty);
        final TextEditingController controller;
        if (blankIndex >= 0) {
          controller = _candidateEmailControllers[blankIndex];
          controller.text = email;
        } else {
          controller = TextEditingController(text: email);
          _candidateEmailControllers.add(controller);
        }
        // Best-effort: a candidate with no classified role is still imported,
        // just with nothing to carry onto their `Interview` at save time.
        if (row.roleCategory != null && row.roleCategory!.isNotEmpty) {
          _candidateRoleCategories[controller] = row.roleCategory!;
        }
        if (row.role.isNotEmpty) {
          _candidateRawRoles[controller] = row.role;
        }
        added++;
      }
    });
    if (added == 0) {
      messenger.showSnackBar(const SnackBar(
          content: Text('All candidates from that file are already added.')));
      return;
    }
    messenger.showSnackBar(SnackBar(
        content:
            Text('Added $added candidate${added == 1 ? '' : 's'} from file.')));
  }

  List<String> get _candidateEmails => _candidateEmailControllers
      .map((c) => c.text.trim())
      .where((t) => t.isNotEmpty)
      .toList();

  /// Every non-blank candidate row paired with whatever role data an import
  /// (Feature 1) attached to it — null/null for a manually-typed row. Read at
  /// save time so each candidate's own `Interview.rawRole`/`roleCategory` can
  /// be set instead of the whole batch sharing one role.
  List<({String email, String? rawRole, String? roleCategory})>
      get _candidateEntries => [
            for (final c in _candidateEmailControllers)
              if (c.text.trim().isNotEmpty)
                (
                  email: c.text.trim(),
                  rawRole: _candidateRawRoles[c],
                  roleCategory: _candidateRoleCategories[c],
                ),
          ];

  /// Cached read — the catalog only calls Tavus once per 10-hour window, so
  /// re-opening this form costs no round trips.
  Future<void> _loadReplicas() => _fetchAvatars(refresh: false);

  /// Explicit user action, from the Refresh control on the avatar picker.
  Future<void> _refreshAvatars() => _fetchAvatars(refresh: true);

  Future<void> _fetchAvatars({required bool refresh}) async {
    final catalog = context.read<AvatarCatalog>();
    setState(() => _loadingReplicas = true);
    await (refresh ? catalog.refresh() : catalog.ensureLoaded());
    if (!mounted) return;
    // Manual replica-id entry stays available, so a failure is never fatal here.
    setState(() {
      _loadingReplicas = false;
      _replicas = catalog.replicas;
    });
  }

  void _addQuestion() =>
      setState(() => _questionControllers.add(TextEditingController()));

  void _removeQuestion(int i) {
    if (_questionControllers.length == 1) return;
    setState(() {
      _questionControllers.removeAt(i).dispose();
    });
  }

  List<String> get _questions => _questionControllers
      .map((c) => c.text.trim())
      .where((t) => t.isNotEmpty)
      .toList();

  /// True when this is a chat interview set to generate questions adaptively —
  /// the fixed-questions list is then hidden and not required.
  bool get _isAdaptiveChat => _type == InterviewType.chat && _adaptive;

  /// True when this is a chat interview using Mixed mode (Feature 3): a fixed
  /// question list (same editor as "Fixed list") followed by résumé-adapted
  /// ones. Gated on [_type] the same way [_isAdaptiveChat] is, so switching the
  /// track away from chat without resetting the toggle can never leak Mixed
  /// into a video/voice interview.
  bool get _isMixedChat =>
      _type == InterviewType.chat && _questionSource == 'mixed';

  /// Replaces the question list with a saved template's questions. When the
  /// title is still empty and the template supplied one, it seeds the title too.
  void _applyTemplate(List<String> questions, {String? title}) {
    setState(() {
      for (final c in _questionControllers) {
        c.dispose();
      }
      _questionControllers
        ..clear()
        ..addAll((questions.isEmpty ? [''] : questions)
            .map((q) => TextEditingController(text: q)));
      if (title != null &&
          title.trim().isNotEmpty &&
          _titleController.text.trim().isEmpty) {
        _titleController.text = title.trim();
      }
    });
  }

  /// Saves the test. With [thenSetUpRounds], lands the recruiter in the timeline
  /// editor instead of returning to the dashboard.
  ///
  /// The rounds editor cannot be part of THIS form: rounds live at
  /// `tests/{testId}/rounds`, and that test id does not exist until the save
  /// below has run. So "set up rounds" saves first and hands over, rather than
  /// collecting rounds here and writing them afterwards.
  Future<void> _save({bool thenSetUpRounds = false}) async {
    // Re-entrancy guard set BEFORE any await so a fast double-tap can't run the
    // save (and create duplicate interviews) twice.
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });

    final title = _titleController.text.trim();
    final emails = _candidateEmails;
    final questions = _questions;

    void fail(String message) => setState(() {
          _error = message;
          _saving = false;
        });

    if (title.isEmpty) {
      fail('Give the interview a title.');
      return;
    }
    if (emails.isEmpty) {
      fail('Add at least one candidate email.');
      return;
    }
    final invalidEmails =
        emails.where((e) => !Validators.isValidEmail(e)).toList();
    if (invalidEmails.isNotEmpty) {
      fail('Enter valid candidate email(s): ${invalidEmails.join(', ')}');
      return;
    }
    if (_multiRound) {
      if (_rounds.isEmpty) {
        fail('Add at least one round, or switch back to a single round.');
        return;
      }
      if (_hasVideoRound && _replicaIdController.text.trim().isEmpty) {
        fail('Pick an avatar — this timeline has a video round.');
        return;
      }
      // Each round validates its own dates in the round editor; what cannot be
      // checked there is the ORDER, because a round does not know its neighbours.
      for (var i = 1; i < _rounds.length; i++) {
        final prev = _rounds[i - 1];
        final cur = _rounds[i];
        if (prev.closesAt != null &&
            cur.closesAt != null &&
            !cur.closesAt!.isAfter(prev.closesAt!)) {
          fail('"${cur.title}" closes before "${prev.title}" does. '
              'Later rounds should close later, or leave their dates open.');
          return;
        }
      }
    } else {
      // An MCQ round with no paper attached is not a round: the candidate would
      // open it and be told there is no assessment. Caught here rather than by
      // the first candidate to try.
      if (_roundKind.needsMcqPaper && _mcqSetId.isEmpty) {
        fail('Pick the assessment this round uses.');
        return;
      }
      if (_roundKind.usesAiInterviewer) {
        if (!_isAdaptiveChat && questions.isEmpty) {
          fail('Add at least one question.');
          return;
        }
        if (_isMixedChat && _mixedCountsInvalid) {
          fail('Mixed mode: fixed ($_mixedFixed) + résumé-adapted '
              '($_mixedResume) questions must add up to the total '
              '($_mixedTotal).');
          return;
        }
        if (_type == InterviewType.video &&
            _replicaIdController.text.trim().isEmpty) {
          fail('Pick or enter an avatar (replica) for video.');
          return;
        }
      }
    }

    // The access window stays OPTIONAL (unchanged behaviour). We only reject the
    // actual defect — an interview born already expired — and an inverted
    // window. An `availableFrom` in the past is legitimate ("available since").
    final now = DateTime.now();
    if (_expiresAt != null && !_expiresAt!.isAfter(now)) {
      fail('Expiry must be in the future.');
      return;
    }
    if (_availableFrom != null &&
        _expiresAt != null &&
        !_expiresAt!.isAfter(_availableFrom!)) {
      fail('Expiry must be after the available-from time.');
      return;
    }

    final avatar = AvatarConfig(
      replicaId: _replicaIdController.text.trim(),
      personaId: _personaIdController.text.trim().isEmpty
          ? null
          : _personaIdController.text.trim(),
    );
    // Prompt is meaningful for the video (Tavus) and voice tracks.
    final prompt = (_type == InterviewType.video ||
            _type == InterviewType.voice)
        ? _promptController.text.trim()
        : '';

    // De-duplicate by normalized email so a candidate isn't assigned twice.
    // Carries each candidate's own import-time role data (Feature 1) alongside
    // their email, so `build()` below can set it per candidate rather than
    // sharing one role across the whole batch.
    final unique = <String, String>{}; // lower → original
    final uniqueRawRole = <String, String?>{};
    final uniqueRoleCategory = <String, String?>{};
    for (final entry in _candidateEntries) {
      final key = InterviewRepository.normalizeEmail(entry.email);
      if (unique.containsKey(key)) continue;
      unique[key] = entry.email;
      uniqueRawRole[key] = entry.rawRole;
      uniqueRoleCategory[key] = entry.roleCategory;
    }

    try {
      final repo = context.read<InterviewRepository>();
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) {
        if (mounted) {
          setState(() {
            _error = 'Your session has expired. Please sign in again.';
            _saving = false;
          });
        }
        return;
      }
      // All candidates created/added together share one testId.
      final testId = _isEdit
          ? (widget.existing!.testId.isNotEmpty
              ? widget.existing!.testId
              : widget.existing!.id)
          : 'test_${DateTime.now().microsecondsSinceEpoch}';

      Interview build({
        required String id,
        required String email,
        required String emailLower,
        String? candidateName,
        required String recruiterId,
        required String recruiterEmail,
        required InterviewStatus status,
        String? rawRole,
        String? roleCategory,
      }) =>
          Interview(
            id: id,
            testId: testId,
            recruiterId: recruiterId,
            recruiterEmail: recruiterEmail,
            recruiterName: _recruiterName,
            candidateEmail: email,
            candidateEmailLower: emailLower,
            candidateName: candidateName,
            // MCQ pins `type` to chat, matching the server's `type_for_mode`, so
            // `mode: mcq` and `type` cannot disagree on the stored document. Every
            // other track uses whatever the form is set to.
            type: _roundKind.needsMcqPaper ? InterviewType.chat : _type,
            // Written only for a kind `type` CANNOT express — the three
            // InterviewTypes are the AI tracks. Without this a live round would
            // carry only `type: chat`, and `effectiveRoundKind` would route the
            // candidate into a chat interview with no questions.
            roundKind: _roundKind.usesAiInterviewer ? null : _roundKind,
            title: title,
            prompt: prompt,
            // Mixed mode's fixed portion resolves exactly like "Fixed list"
            // mode's `questions` always has: the ad hoc list / applied
            // template, whichever the recruiter used. `adaptive` stays false
            // for Mixed — it is not this app's pure-adaptive path — so this
            // branch already covers it.
            questions: _isAdaptiveChat ? const [] : questions,
            adaptive: _isAdaptiveChat,
            adaptiveConfig: _isAdaptiveChat
                ? {
                    'role': title,
                    'numberOfQuestions': _adaptiveNumQuestions,
                    'allowFollowUps': _adaptiveFollowUps,
                    'difficulty': 'mixed',
                    'style': 'mix',
                  }
                : null,
            // Mixed mode (Feature 3). Only ever set here, alongside `mixedConfig`
            // — `_roundContentConfig()` mirrors the same two keys for round-config
            // mode, and `InterviewRound.configFromInterview` reads them back off
            // whichever `Interview` this produces.
            screeningSource: _isMixedChat ? 'mixed' : '',
            mixedConfig: _isMixedChat
                ? {
                    'totalQuestions': _mixedTotal,
                    'fixedQuestionCount': _mixedFixed,
                    'resumeQuestionCount': _mixedResume,
                  }
                : null,
            // Role classification (Feature 1) — best-effort, per candidate.
            rawRole: rawRole,
            roleCategory: roleCategory,
            collectResume: _type == InterviewType.video && _collectResume,
            language: _language,
            voiceName: _type == InterviewType.voice ? _resolvedVoiceName : null,
            voicePersonaId:
                _type == InterviewType.voice ? _resolvedVoicePersonaId : null,
            // Integrity + branding are enforced/shown by the chat runner.
            //
            // Keyed on the ROUND KIND as well, because MCQ pins `_type` to chat
            // and would otherwise carry a chat runner's proctoring config it has
            // no runtime for — a field on the document that nothing reads.
            integrity: (_type == InterviewType.chat && !_roundKind.needsMcqPaper)
                ? {
                    'enforceFullscreen': false,
                    'detectTabSwitch': _detectTabSwitch,
                    'disablePasteInAnswers': _disablePaste,
                    'disableCopy': _disableCopy,
                    'maxTabSwitchWarnings': 3,
                    'logEvents': true,
                  }
                : null,
            branding: (_type == InterviewType.chat &&
                    !_roundKind.needsMcqPaper &&
                    _welcomeController.text.trim().isNotEmpty)
                ? {
                    'companyName': _recruiterName ?? 'Mimic',
                    'accentColor': '#0d5c3a',
                    'welcomeMessage': _welcomeController.text.trim(),
                  }
                : null,
            // Per-question countdown (chat only). Persisted whenever enabled so
            // the chat launch adapter can run the interview in timed mode.
            chatTimer: (_type == InterviewType.chat &&
                    !_roundKind.needsMcqPaper &&
                    _chatTimerEnabled)
                ? {
                    'enabled': true,
                    'perQuestionSeconds':
                        _chatTimerPerQuestion.clamp(30, 600),
                    'thinkingSeconds': _chatTimerThinking.clamp(0, 300),
                    'allowEarlySubmit': true,
                    'warningThresholdSeconds': 15,
                    'autoSubmitOnExpiry': _chatTimerAutoSubmit,
                  }
                : null,
            avatar: avatar,
            durationMinutes: _durationMinutes,
            status: status,
            availableFrom: _availableFrom,
            expiresAt: _expiresAt,
            maxAttempts: _maxAttempts,
            allowedDevices: _allowedDevices.toList(),
            // Written only for an MCQ round; empty everywhere else, which is what
            // keeps `screening` off every other document.
            mcqSetId: _roundKind.needsMcqPaper ? _mcqSetId : '',
          );

      // Candidate email → the interview id assigned to them, so each invite
      // email can carry that candidate's own link.
      final invites = <String, String>{};

      if (_multiRound && !_isEdit) {
        await _saveMultiRound(
          repo: repo,
          testId: testId,
          title: title,
          recruiterId: user.uid,
          recruiterEmail: user.email ?? '',
          candidates: unique,
        );
        return;
      }

      if (_isEdit) {
        final existing = widget.existing!;
        final entries = unique.entries.toList();
        // First email updates this interview; extras become new interviews.
        final first = entries.first;
        await repo.update(build(
          id: existing.id,
          email: first.value,
          emailLower: first.key,
          candidateName: existing.candidateName,
          recruiterId: existing.recruiterId,
          recruiterEmail: existing.recruiterEmail,
          status: existing.status,
          rawRole: uniqueRawRole[first.key],
          roleCategory: uniqueRoleCategory[first.key],
        ));
        invites[first.value] = existing.id;
        for (final e in entries.skip(1)) {
          final id = await repo.create(build(
            id: '',
            email: e.value,
            emailLower: e.key,
            recruiterId: existing.recruiterId,
            recruiterEmail: existing.recruiterEmail,
            status: InterviewStatus.assigned,
            rawRole: uniqueRawRole[e.key],
            roleCategory: uniqueRoleCategory[e.key],
          ));
          invites[e.value] = id;
        }
        // Keep the test's metadata doc in step with the edited title/type so
        // the dashboard's test list stays accurate.
        final summary = TestSummary(
          testId: testId,
          recruiterId: existing.recruiterId,
          title: _titleController.text.trim().isEmpty
              ? 'Interview'
              : _titleController.text.trim(),
          type: _type,
          createdAt: existing.createdAt,
        );
        await repo.upsertTest(summary);
        final mailNote = await _emailInvites(invites);
        if (!mounted) return;
        final added = entries.length - 1;
        final saved = added > 0
            ? 'Interview updated; $added more candidate${added == 1 ? '' : 's'} assigned.'
            : 'Interview updated.';
        _finish(
          summary: summary,
          thenSetUpRounds: thenSetUpRounds,
          message: mailNote == null ? saved : '$saved $mailNote',
        );
        return;
      }

      for (final entry in unique.entries) {
        final id = await repo.create(build(
          id: '',
          email: entry.value,
          emailLower: entry.key,
          recruiterId: user.uid,
          recruiterEmail: user.email ?? '',
          status: InterviewStatus.assigned,
          rawRole: uniqueRawRole[entry.key],
          roleCategory: uniqueRoleCategory[entry.key],
        ));
        invites[entry.value] = id;
      }
      // One metadata doc for the whole batch, so the dashboard can list this
      // test without reading its candidates. createdAt is left to the server.
      final summary = TestSummary(
        testId: testId,
        recruiterId: user.uid,
        title: _titleController.text.trim().isEmpty
            ? 'Interview'
            : _titleController.text.trim(),
        type: _type,
        createdAt: null,
      );
      await repo.upsertTest(summary);
      final mailNote = await _emailInvites(invites);
      if (!mounted) return;
      final n = unique.length;
      final saved = 'Interview assigned to $n candidate${n == 1 ? '' : 's'}.';
      _finish(
        summary: summary,
        thenSetUpRounds: thenSetUpRounds,
        message: mailNote == null ? saved : '$saved $mailNote',
      );
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Could not save: $e';
          _saving = false;
        });
      }
    }
  }

  /// Which of the shared delivery settings an MCQ round takes.
  ///
  /// An allow-list rather than a list of exclusions, for the same reason the
  /// answer-key projection is: a delivery setting added here next year should have
  /// to be considered for MCQ deliberately, not arrive by default on a round that
  /// has no runtime for it.
  static const Set<String> _mcqInheritedKeys = {
    'language',
    'maxAttempts',
    'allowedDevices',
  };

  /// The delivery settings every round of this test inherits.
  ///
  /// Merged UNDER each round's own config, so a round's questions, prompt and
  /// length win while avatar, voice, language and branding come from here. This is
  /// what keeps a recruiter from choosing an avatar four times.
  Map<String, dynamic> _sharedRoundConfig(String title) => {
        'language': _language,
        'avatar': AvatarConfig(
          replicaId: _replicaIdController.text.trim(),
          personaId: _personaIdController.text.trim().isEmpty
              ? null
              : _personaIdController.text.trim(),
        ).toMap(),
        'maxAttempts': _maxAttempts,
        // Inherited by every round of this test, like the other delivery settings.
        // Only when restricted — all three selected is no restriction at all.
        if (_allowedDevices.isNotEmpty && _allowedDevices.length < 3)
          'allowedDevices': _allowedDevices.toList(),
        if (_hasVoiceRound) 'voiceName': _resolvedVoiceName,
        if (_hasVoiceRound) 'voicePersonaId': _resolvedVoicePersonaId,
        'integrity': {
          'enforceFullscreen': false,
          'detectTabSwitch': _detectTabSwitch,
          'disablePasteInAnswers': _disablePaste,
          'disableCopy': _disableCopy,
          'maxTabSwitchWarnings': 3,
          'logEvents': true,
        },
        if (_welcomeController.text.trim().isNotEmpty)
          'branding': {
            'companyName': _recruiterName ?? 'Mimic',
            'accentColor': '#0d5c3a',
            'welcomeMessage': _welcomeController.text.trim(),
          },
        if (_chatTimerEnabled)
          'chatTimer': {
            'enabled': true,
            'perQuestionSeconds': _chatTimerPerQuestion.clamp(30, 600),
            'thinkingSeconds': _chatTimerThinking.clamp(0, 300),
            'allowEarlySubmit': true,
            'warningThresholdSeconds': 15,
            'autoSubmitOnExpiry': _chatTimerAutoSubmit,
          },
      };

  /// Writes a multi-round test: the test doc, every round, and assignments for
  /// ROUND 1 ONLY.
  ///
  /// Round 1 only is the whole point of this mode. Assigning every round up front
  /// would put four items on the candidate's screen at once and let them take
  /// round 3 before round 1; they are moved on from the timeline as each round
  /// closes. It is also why nothing is visible while the recruiter is still
  /// designing — until this method runs, no `interviews` document exists at all.
  ///
  /// Order of writes matters: rounds before assignments, because
  /// `InterviewRound.assignTo` copies the round's config and window onto each
  /// candidate and needs the round's real id.
  Future<void> _saveMultiRound({
    required InterviewRepository repo,
    required String testId,
    required String title,
    required String recruiterId,
    required String recruiterEmail,
    required Map<String, String> candidates,
  }) async {
    final shared = _sharedRoundConfig(title);

    // The test's `type` is only used for the dashboard's row icon; the first
    // interview round is the most representative thing to show.
    final firstInterviewKind = _rounds
        .map((r) => r.kind)
        .firstWhere((k) => k.isInterview, orElse: () => RoundKind.chat);

    await repo.upsertTest(TestSummary(
      testId: testId,
      recruiterId: recruiterId,
      title: title,
      type: firstInterviewKind.interviewType ?? InterviewType.chat,
      createdAt: null,
    ));

    InterviewRound? firstRound;
    for (var i = 0; i < _rounds.length; i++) {
      final draft = _rounds[i];
      final round = InterviewRound(
        id: '',
        testId: testId,
        recruiterId: recruiterId,
        order: i,
        title: draft.title,
        kind: draft.kind,
        // Shared first so the round's own keys win.
        config: switch (draft.kind) {
          // A résumé round has no session at all.
          RoundKind.resume => const <String, dynamic>{},
          // An MCQ round inherits the DELIVERY settings — language, attempts, the
          // device restriction — and none of the script. No prompt, no question
          // list, no avatar, no chat proctoring: its questions live on the paper it
          // names, and storing a script beside them would be a config nothing
          // reads sitting next to the one thing that matters.
          RoundKind.mcq => {
              for (final entry in shared.entries)
                if (_mcqInheritedKeys.contains(entry.key)) entry.key: entry.value,
              ...draft.config,
            },
          _ => {...shared, ...draft.config},
        },
        opensAt: draft.opensAt,
        closesAt: draft.closesAt,
        criteria: draft.criteria,
        advance: draft.advance,
      );
      final id = await repo.createRound(round);
      if (i == 0) firstRound = round.copyWith(id: id);
    }

    final invites = <String, String>{};
    if (firstRound != null) {
      // Written one at a time rather than through assignCandidatesToRound's
      // batch, because each invite email needs its candidate's own interview id
      // and a batch does not hand those back.
      for (final entry in candidates.entries) {
        final id = await repo.create(firstRound.assignTo(
          candidateEmail: entry.value,
          recruiterEmail: recruiterEmail,
          recruiterName: _recruiterName,
          testTitle: title,
        ));
        invites[entry.value] = id;
      }
    }

    final mailNote = await _emailInvites(invites);
    if (!mounted) return;

    final n = candidates.length;
    final rounds = _rounds.length;
    final saved = '$rounds-round pipeline created. '
        'Round 1 assigned to $n candidate${n == 1 ? '' : 's'}.';
    _finish(
      summary: TestSummary(
        testId: testId,
        recruiterId: recruiterId,
        title: title,
        type: firstInterviewKind.interviewType ?? InterviewType.chat,
        createdAt: null,
      ),
      // Straight to the timeline: the recruiter has just designed a pipeline and
      // the timeline is where they will run it from.
      thenSetUpRounds: true,
      message: mailNote == null ? saved : '$saved $mailNote',
    );
  }

  /// Round-config mode's "save": validate, build the round, hand it back.
  ///
  /// Writes nothing. Whoever opened this screen owns persistence — the timeline
  /// calls `createRound`/`updateRound`, and the create form holds the draft in
  /// memory until the test exists.
  void _saveRound() {
    final title = _titleController.text.trim();
    void fail(String message) => setState(() => _error = message);

    if (title.isEmpty) {
      fail('Give the round a name candidates will recognise.');
      return;
    }
    if (_roundKind.usesAiInterviewer && _questions.isEmpty && !_isAdaptiveChat) {
      fail('Add at least one question — an interview round with none cannot be '
          'taken.');
      return;
    }
    if (_isMixedChat && _mixedCountsInvalid) {
      fail('Mixed mode: fixed ($_mixedFixed) + résumé-adapted ($_mixedResume) '
          'questions must add up to the total ($_mixedTotal).');
      return;
    }
    if (_roundKind == RoundKind.video &&
        _replicaIdController.text.trim().isEmpty) {
      fail('Pick or enter an avatar (replica) for a video round.');
      return;
    }
    if (_roundKind.needsMcqPaper && _mcqSetId.isEmpty) {
      fail('Pick the assessment this round uses.');
      return;
    }
    if (_availableFrom != null &&
        _expiresAt != null &&
        !_expiresAt!.isAfter(_availableFrom!)) {
      fail('The round has to close after it opens.');
      return;
    }
    if (_advanceMode != AdvanceMode.manual &&
        (_advanceValue == null || _advanceValue! <= 0)) {
      fail(_advanceMode == AdvanceMode.topN
          ? 'Say how many candidates advance.'
          : 'Set the score candidates must reach to advance.');
      return;
    }

    final draft = widget.roundDraft;
    Navigator.of(context).pop(InterviewRound(
      id: draft?.id ?? '',
      testId: draft?.testId ?? '',
      recruiterId: draft?.recruiterId ??
          (FirebaseAuth.instance.currentUser?.uid ?? ''),
      order: draft?.order ?? widget.roundOrder,
      title: title,
      kind: _roundKind,
      // A résumé round has no session, so it carries no delivery config at all.
      config: _roundKind == RoundKind.resume ? const {} : _roundContentConfig(),
      opensAt: _availableFrom,
      closesAt: _expiresAt,
      // Lifecycle is never edited here — ending a round is its own action.
      closedAt: draft?.closedAt,
      closedBy: draft?.closedBy,
      criteria: RoundCriteria(
        requiredSkills: _splitList(_requiredSkillsController.text),
        niceToHave: _splitList(_niceToHaveController.text),
        minYears: _minYears,
        minScore: _minScore,
      ),
      advance: RoundAdvance(mode: _advanceMode, value: _advanceValue),
      createdAt: draft?.createdAt,
    ));
  }

  static List<String> _splitList(String raw) => raw
      .split(',')
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .toList();

  /// This round's config, in exactly the shape [_hydrateForRound] reads back.
  Map<String, dynamic> _roundContentConfig() => {
        // The paper this round assigns. `assignTo` copies it onto each candidate's
        // interview at assignment, so editing the round afterwards cannot change
        // which paper an outstanding invite points at.
        if (_roundKind.needsMcqPaper && _mcqSetId.isNotEmpty)
          'mcqSetId': _mcqSetId,
        'prompt': _promptController.text.trim(),
        // Mixed mode's fixed portion resolves exactly like "Fixed list" mode's
        // `questions` always has — the ad hoc list / applied template.
        'questions': _isAdaptiveChat ? const <String>[] : _questions,
        'adaptive': _isAdaptiveChat,
        if (_isAdaptiveChat)
          'adaptiveConfig': {
            'role': _titleController.text.trim(),
            'numberOfQuestions': _adaptiveNumQuestions,
            'allowFollowUps': _adaptiveFollowUps,
            'difficulty': 'mixed',
            'style': 'mix',
          },
        // Mixed mode (Feature 3). Written only when set, matching the key
        // names `InterviewRound.configFromInterview` uses when snapshotting a
        // standalone Mixed interview into a round — so a round configured
        // here and one snapshotted from Interview.toCreateMap's `screening`
        // read back identically through `InterviewRound.assignTo`.
        if (_isMixedChat) 'screeningSource': 'mixed',
        if (_isMixedChat)
          'mixedConfig': {
            'totalQuestions': _mixedTotal,
            'fixedQuestionCount': _mixedFixed,
            'resumeQuestionCount': _mixedResume,
          },
        'collectResume': _roundKind == RoundKind.video && _collectResume,
        'language': _language,
        'durationMinutes': _durationMinutes,
        'maxAttempts': _maxAttempts,
        // Inherited by every round of this test, like the other delivery settings.
        // Only when restricted — all three selected is no restriction at all.
        if (_allowedDevices.isNotEmpty && _allowedDevices.length < 3)
          'allowedDevices': _allowedDevices.toList(),
        'avatar': AvatarConfig(
          replicaId: _replicaIdController.text.trim(),
          personaId: _personaIdController.text.trim().isEmpty
              ? null
              : _personaIdController.text.trim(),
        ).toMap(),
        if (_roundKind == RoundKind.voice) 'voiceName': _resolvedVoiceName,
        if (_roundKind == RoundKind.voice)
          'voicePersonaId': _resolvedVoicePersonaId,
        if (_roundKind == RoundKind.chat)
          'integrity': {
            'enforceFullscreen': false,
            'detectTabSwitch': _detectTabSwitch,
            'disablePasteInAnswers': _disablePaste,
            'disableCopy': _disableCopy,
            'maxTabSwitchWarnings': 3,
            'logEvents': true,
          },
        if (_welcomeController.text.trim().isNotEmpty)
          'branding': {
            'companyName': _recruiterName ?? 'Mimic',
            'accentColor': '#0d5c3a',
            'welcomeMessage': _welcomeController.text.trim(),
          },
        if (_roundKind == RoundKind.chat && _chatTimerEnabled)
          'chatTimer': {
            'enabled': true,
            'perQuestionSeconds': _chatTimerPerQuestion.clamp(30, 600),
            'thinkingSeconds': _chatTimerThinking.clamp(0, 300),
            'allowEarlySubmit': true,
            'warningThresholdSeconds': 15,
            'autoSubmitOnExpiry': _chatTimerAutoSubmit,
          },
      };

  /// Leaves this form after a successful save, and reports what happened.
  ///
  /// [thenSetUpRounds] uses pushReplacement rather than push-on-top-of-pop: the
  /// form is finished with, and replacing it means Back from the timeline goes to
  /// the dashboard instead of reopening a form whose test already exists (which
  /// is how duplicate assignments get made).
  void _finish({
    required TestSummary summary,
    required bool thenSetUpRounds,
    required String message,
  }) {
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);

    if (thenSetUpRounds) {
      navigator.pushReplacement(MaterialPageRoute(
        builder: (_) => RoundTimelinePage(test: summary),
      ));
    } else {
      navigator.pop();
    }
    messenger.showSnackBar(SnackBar(content: Text(message)));
  }

  /// Emails every candidate their own interview link, using the template the
  /// recruiter chose (or the backend default when they chose none).
  ///
  /// Runs AFTER the interviews are written, so the assignment stands even if
  /// mail fails — the failure is reported in the confirmation instead of
  /// rolling anything back. Returns the sentence to append to that
  /// confirmation, or null when no email was requested.
  Future<String?> _emailInvites(Map<String, String> interviewIdsByEmail) async {
    if (!_notifyByEmail || !_canEmailCandidates || interviewIdsByEmail.isEmpty) {
      return null;
    }

    try {
      final report = await _mailer.send(
        ownerEmail: _recruiterEmail,
        templateId: _emailTemplate?.id,
        sharedContext: {
          'interview_title': _titleController.text.trim(),
          'recruiter_name': _recruiterName ?? '',
          'company': 'Mimic',
          if (_expiresAt != null) 'deadline': formatDateTime(_expiresAt!),
        },
        recipients: [
          for (final entry in interviewIdsByEmail.entries)
            MailRecipient(
              email: entry.key,
              context: {
                'interview_link': DeepLinkService.interviewLink(entry.value),
              },
            ),
        ],
      );

      if (report.isDryRun) {
        return 'Emails were logged only — the mail server is in test mode.';
      }
      if (report.failed == 0) {
        return '${report.sent} invite email${report.sent == 1 ? '' : 's'} sent.';
      }
      final first = report.failures.first;
      return '${report.sent} sent, ${report.failed} failed '
          '(${first.email}: ${first.error ?? 'unknown error'}).';
    } on MailerException catch (e) {
      // The interviews are already assigned; say so plainly rather than making
      // the save look like it failed.
      return 'Candidates were NOT emailed: ${e.message}';
    }
  }

  Future<void> _pickDateTime({required bool isExpiry}) async {
    final now = DateTime.now();
    final initial = (isExpiry ? _expiresAt : _availableFrom) ?? now;
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (!mounted) return;
    final picked = DateTime(
      date.year,
      date.month,
      date.day,
      time?.hour ?? 0,
      time?.minute ?? 0,
    );
    setState(() {
      if (isExpiry) {
        _expiresAt = picked;
      } else {
        _availableFrom = picked;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RecruiterScaffold(
      appBar: AppBar(
        title: Text(_appBarTitle),
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 640),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  ..._sections(theme),
                  if (_error != null) ...[
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8.0),
                      child: Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: theme.colorScheme.error,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  CustomButton(
                    text: _saveLabel,
                    isLoading: _saving,
                    width: double.infinity,
                    // Mixed mode's counts are gated live, not only on submit —
                    // see `_buildMixedCounts`, which shows the same failure
                    // inline in red beside the three steppers.
                    onPressed: (_saving || _mixedCountsInvalid)
                        ? () {}
                        : (_isRoundConfig ? _saveRound : _save),
                  ),
                  if (!_multiRound && !_isEdit && !_isRoundConfig) ...[
                    const SizedBox(height: 10),
                    _buildSingleRoundNote(theme),
                  ],
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  String get _appBarTitle {
    if (_isRoundConfig) {
      return widget.roundDraft == null ? 'Add round' : 'Configure round';
    }
    return _isEdit ? 'Edit interview' : 'Create pipeline';
  }

  String get _saveLabel {
    if (_isRoundConfig) {
      return widget.roundDraft == null ? 'Add round' : 'Save round';
    }
    if (_isEdit) return 'Save changes';
    // Name what actually happens: the whole timeline is created, but only round 1
    // reaches candidates.
    return _multiRound
        ? 'Create pipeline & assign round 1'
        : 'Save & Assign Interview';
  }

  /// The form's sections, by workflow.
  ///
  /// Three shapes, deliberately built from the SAME section widgets:
  ///
  ///   round config — kind + name, then that kind's own configuration exactly as
  ///                  a standalone interview of that type is configured;
  ///   multi-round  — the timeline FIRST (it is the structure everything else
  ///                  hangs off), then the roster and the shared delivery config;
  ///   single round — unchanged from before any of this existed.
  List<Widget> _sections(ThemeData theme) {
    if (_isRoundConfig) {
      return [
        _buildRoundBasicsCard(theme),
        // Only an AI-run round has a script to design. A résumé round is a
        // submission; a two-way round is a human asking the questions.
        if (_roundKind.usesAiInterviewer) ...[
          _buildInterviewDesignCard(theme),
          _buildAdvancedCard(theme),
        ] else if (_roundKind == RoundKind.resume)
          _buildResumeCriteriaCard(theme)
        else if (_roundKind == RoundKind.mcq)
          _buildMcqCard(theme)
        else
          _buildTwoWayCard(theme),
        _buildRoundWindowCard(theme),
        _buildAdvanceCard(theme),
      ];
    }

    if (_multiRound && !_isEdit) {
      return [
        // The timeline leads: it is what the recruiter is building, and every
        // other section on this screen is in service of it.
        _buildRoundStyleCard(theme),
        _buildRoundsCard(theme),
        _buildTestBasicsCard(theme),
        _buildCandidatesCard(theme),
        // Only when the timeline actually contains a round that needs it — an
        // all-résumé pipeline has no avatar to choose.
        if (_hasVideoRound || _hasVoiceRound)
          _buildSharedDeliveryCard(theme),
        _buildAdvancedCard(theme),
      ];
    }

    return [
      if (!_isEdit) _buildRoundStyleCard(theme),
      _buildJobDetailsCard(theme),
      // An EXISTING test's structure is managed from its timeline, not here, so
      // this lists its rounds to configure and offers no way to add one.
      if (_isEdit) _buildExistingRoundsCard(theme),
      _buildCandidatesCard(theme),
      // A live round has no questions, prompt or avatar — a human asks them. An
      // MCQ round has none either: its questions live on the paper it references.
      if (_roundKind.usesAiInterviewer) ...[
        _buildInterviewDesignCard(theme),
        _buildAdvancedCard(theme),
      ] else if (_roundKind == RoundKind.mcq)
        _buildMcqCard(theme)
      else
        _buildTwoWayCard(theme),
      _buildTimingAccessCard(theme),
    ];
  }

  // ── Cards used by the round-config and multi-round workflows ──────────────

  /// "Round Style": the first thing on the test builder, because it decides what
  /// the rest of the screen is.
  Widget _buildRoundStyleCard(ThemeData theme) => _buildFormSection(
        context: context,
        title: 'Round style',
        icon: Icons.tune,
        child: _buildModeToggle(theme),
      );

  /// The round's kind and name — the round-config equivalent of Interview Basics.
  Widget _buildRoundBasicsCard(ThemeData theme) => _buildFormSection(
        context: context,
        title: 'Round basics',
        icon: Icons.flag_outlined,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _buildKindToggle(theme),
            const SizedBox(height: 20),
            CustomInputField(
              label: 'Round name',
              placeholder: 'e.g. Résumé screen, Technical round',
              controller: _titleController,
            ),
          ],
        ),
      );

  /// The test's title in multi-round mode. Same field as Interview Basics, minus
  /// the interview-type toggle — each round carries its own kind.
  Widget _buildTestBasicsCard(ThemeData theme) => _buildFormSection(
        context: context,
        title: 'Pipeline basics',
        icon: Icons.assignment_outlined,
        child: CustomInputField(
          label: 'Job Title / Role',
          placeholder: 'e.g. Senior Flutter Engineer',
          controller: _titleController,
        ),
      );

  /// What a résumé round is scored against.
  Widget _buildResumeCriteriaCard(ThemeData theme) => _buildFormSection(
        context: context,
        title: 'Résumé scoring',
        icon: Icons.checklist_outlined,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Résumés are scored against these. Leave them empty and the résumé '
              'is judged on the role in general.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            CustomInputField(
              label: 'Must-have skills',
              placeholder: 'Flutter, Dart, REST APIs',
              controller: _requiredSkillsController,
              maxLines: 2,
            ),
            const SizedBox(height: 14),
            CustomInputField(
              label: 'Nice-to-have skills',
              placeholder: 'Firebase, CI/CD',
              controller: _niceToHaveController,
              maxLines: 2,
            ),
            const SizedBox(height: 8),
            CustomToggle(
              label: 'Require minimum experience',
              description: 'Flag résumés below a number of years.',
              checked: _minYears != null,
              onChanged: (v) => setState(() => _minYears = v ? 2 : null),
            ),
            if (_minYears != null)
              _labelledStepper(theme, 'Years of experience',
                  _minYears!.round(), min: 1, max: 20,
                  onChanged: (v) =>
                      setState(() => _minYears = v.toDouble())),
            CustomToggle(
              label: 'Flag résumés below a score',
              description: 'Advisory only — it never blocks a submission.',
              checked: _minScore != null,
              onChanged: (v) => setState(() => _minScore = v ? 60 : null),
            ),
            if (_minScore != null)
              _labelledStepper(theme, 'Minimum score', _minScore!,
                  min: 10, max: 100, step: 5,
                  onChanged: (v) => setState(() => _minScore = v)),
          ],
        ),
      );

  /// A live round needs no configuration — which is worth SAYING, because an
  /// otherwise empty screen reads as something failing to load.
  /// Loads this recruiter's authored papers, once.
  ///
  /// Called when MCQ is selected rather than on every open: most rounds are not
  /// MCQ, and a request per visit to this screen would be a round trip nobody
  /// asked for.
  Future<void> _loadMcqSets() async {
    if (_mcqSets != null || _mcqLoading) return;
    setState(() {
      _mcqLoading = true;
      _mcqError = null;
    });
    try {
      final store = McqSetsStore();
      await store.refresh();
      if (!mounted) return;
      setState(() {
        _mcqSets = store.sets;
        _mcqError = store.error;
      });
    } catch (e) {
      if (mounted) setState(() => _mcqError = '$e');
    }
    if (mounted) setState(() => _mcqLoading = false);
  }

  /// Which paper this round assigns.
  ///
  /// A picker, not an editor: papers are authored under Manage → Assessments, and
  /// duplicating that here would be a second place for the answer key to be
  /// edited. The list shows readiness, because sending an unfinished paper scores
  /// every candidate zero — the one failure this screen can still prevent.
  Widget _buildMcqCard(ThemeData theme) => _buildFormSection(
        context: context,
        title: 'The assessment',
        icon: Icons.fact_check_outlined,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'The candidate answers a multiple-choice paper. It is scored the '
              'moment they submit — by comparison against your answers, with no '
              'model involved, so the result is exact and reproducible.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 14),
            if (_mcqLoading)
              const Center(
                child: Padding(
                  padding: EdgeInsets.all(12),
                  child: SizedBox(
                      width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                ),
              )
            else if (_mcqError != null)
              Row(
                children: [
                  Expanded(
                    child: Text(_mcqError!,
                        style: TextStyle(color: theme.colorScheme.error)),
                  ),
                  TextButton(
                    onPressed: () {
                      _mcqSets = null;
                      _loadMcqSets();
                    },
                    child: const Text('Retry'),
                  ),
                ],
              )
            else if ((_mcqSets ?? const []).isEmpty)
              // Empty and "could not load" are different facts and get different
              // sentences — the first is something the recruiter can act on.
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  'You have not written an assessment yet. Create one under '
                  'Manage → Assessments, then come back and attach it.',
                  style: theme.textTheme.bodySmall,
                ),
              )
            else
              // One RadioGroup around the whole list rather than a groupValue on
              // every tile — the per-tile API is deprecated, and one owner of the
              // selection is what makes "exactly one paper" true by construction.
              RadioGroup<String>(
                groupValue: _mcqSetId,
                onChanged: (v) => setState(() => _mcqSetId = v ?? ''),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final paper in _mcqSets!)
                      RadioListTile<String>(
                        contentPadding: EdgeInsets.zero,
                        value: paper.id,
                        title: Text(
                            paper.name.isEmpty ? 'Untitled assessment' : paper.name),
                        subtitle: Text(
                          paper.ready
                              ? '${paper.questions.length} question(s) · ready to send'
                              : paper.faults.isEmpty
                                  ? 'Draft'
                                  // The first fault is enough to act on; the
                                  // editor lists the rest.
                                  : 'Not ready — ${paper.faults.first}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: paper.ready
                                ? theme.colorScheme.onSurfaceVariant
                                : theme.colorScheme.error,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      );

  Widget _buildTwoWayCard(ThemeData theme) => _buildFormSection(
        context: context,
        title: 'How this round runs',
        icon: Icons.groups_outlined,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'You interview the candidate yourself over a live video call. '
              'There are no questions to set up here — you ask them.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 12),
            for (final line in const [
              'The candidate opens the round and waits; you start the call when '
                  'you are ready.',
              'They wait in a lobby until you admit them.',
              'The call is not recorded, so you score it yourself afterwards — '
                  'a 1-5 rating that ranks alongside every other round.',
            ])
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.check, size: 15,
                        color: theme.colorScheme.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(line,
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant)),
                    ),
                  ],
                ),
              ),
          ],
        ),
      );

  /// The round's own open/close window. Same pickers as the single-round access
  /// window, worded for a round.
  Widget _buildRoundWindowCard(ThemeData theme) => _buildFormSection(
        context: context,
        title: 'When it runs',
        icon: Icons.schedule_outlined,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Leave both empty to open this round as soon as candidates reach it '
              'and close it by hand. A closing time ends it on its own.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            _buildDateTimeTile(
                label: 'Opens at', value: _availableFrom, isExpiry: false),
            const SizedBox(height: 12),
            _buildDateTimeTile(
                label: 'Closes at', value: _expiresAt, isExpiry: true),
          ],
        ),
      );

  /// Who moves on from this round.
  Widget _buildAdvanceCard(ThemeData theme) => _buildFormSection(
        context: context,
        title: 'Who moves on',
        icon: Icons.trending_up_outlined,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            CustomSelectDropdown<AdvanceMode>(
              label: 'Advance to the next round',
              value: _advanceMode,
              items: const [
                DropdownMenuItem(
                    value: AdvanceMode.manual, child: Text('I pick, manually')),
                DropdownMenuItem(
                    value: AdvanceMode.topN, child: Text('Top N by score')),
                DropdownMenuItem(
                    value: AdvanceMode.threshold,
                    child: Text('Everyone above a score')),
              ],
              onChanged: (v) => setState(() {
                _advanceMode = v ?? AdvanceMode.manual;
                _advanceValue ??=
                    _advanceMode == AdvanceMode.topN ? 10 : 70;
              }),
            ),
            if (_advanceMode != AdvanceMode.manual)
              _labelledStepper(
                theme,
                _advanceMode == AdvanceMode.topN
                    ? 'Candidates who advance'
                    : 'Score to beat',
                (_advanceValue ?? 0).round(),
                min: 1,
                max: _advanceMode == AdvanceMode.topN ? 500 : 100,
                step: 5,
                onChanged: (v) => setState(() => _advanceValue = v),
              ),
            const SizedBox(height: 8),
            Text(
              'Recorded with the round so the bar is written down, and used to '
              'pre-tick the shortlist when the round closes. Nothing advances on '
              'its own.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      );

  /// An existing test's rounds, listed so each can be configured.
  ///
  /// No "add" here on purpose: the structure of a live test is changed from its
  /// timeline, where reordering and ending rounds also live. This card is a way
  /// IN to configuring a round, not a second place to design one.
  Widget _buildExistingRoundsCard(ThemeData theme) {
    final rounds = _existingRounds;
    if (rounds == null || rounds.isEmpty) return const SizedBox.shrink();

    return _buildFormSection(
      context: context,
      title: 'Rounds in this pipeline (${rounds.length})',
      icon: Icons.timeline_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Tap a round to change its configuration. Adding, reordering and '
            'ending rounds is done from the pipeline\'s timeline.',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          for (var i = 0; i < rounds.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: RoundStepTile(
                round: rounds[i],
                position: i + 1,
                total: rounds.length,
                showConnector: i < rounds.length - 1,
                // Mark the round the assignment being edited belongs to, so the
                // recruiter can see where this candidate sits in the sequence.
                highlight: rounds[i].id == widget.existing?.roundId,
                highlightLabel: rounds[i].id == widget.existing?.roundId
                    ? 'this candidate'
                    : null,
                trailing: Icon(Icons.chevron_right,
                    size: 18, color: theme.colorScheme.onSurfaceVariant),
                onTap: () => _configureExistingRound(rounds[i]),
              ),
            ),
        ],
      ),
    );
  }

  /// Opens the shared configuration screen for [round] and saves what comes back.
  Future<void> _configureExistingRound(InterviewRound round) async {
    final updated = await Navigator.of(context).push<InterviewRound>(
      MaterialPageRoute(
        builder: (_) => CreateInterviewPage.configureRound(roundDraft: round),
      ),
    );
    if (updated == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<InterviewRepository>().updateRound(updated);
      if (!mounted) return;
      setState(() {
        final at = _existingRounds!.indexWhere((r) => r.id == updated.id);
        if (at >= 0) _existingRounds![at] = updated;
      });
      messenger.showSnackBar(
          SnackBar(content: Text('"${updated.title}" updated.')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not save: $e')));
    }
  }

  /// Row of `label  −  n  +`, matching the stepper used elsewhere in this form.
  Widget _labelledStepper(
    ThemeData theme,
    String label,
    int value, {
    required int min,
    required int max,
    int step = 1,
    required ValueChanged<int> onChanged,
  }) =>
      Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 4),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(child: Text(label, style: theme.textTheme.bodyMedium)),
            _buildModernStepper(
              value: value,
              min: min,
              max: max,
              step: step,
              onChanged: onChanged,
            ),
          ],
        ),
      );

  // ── Multi-round: the timeline builder ─────────────────────────────────────

  bool get _hasVideoRound => _rounds.any((r) => r.kind == RoundKind.video);
  bool get _hasVoiceRound => _rounds.any((r) => r.kind == RoundKind.voice);

  /// Avatar and voice: chosen once for the whole test, not per round.
  ///
  /// A recruiter picks their company's avatar once; asking again on every round
  /// would be busywork, and letting rounds disagree would mean a candidate meets
  /// a different interviewer at each stage for no reason.
  Widget _buildSharedDeliveryCard(ThemeData theme) => _buildFormSection(
        context: context,
        title: 'Shared by every round',
        icon: Icons.face_outlined,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'The interviewer that delivers every round. Questions and dates are '
              'per round; this is not.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 16),
            if (_hasVideoRound) _buildAvatarSection(theme),
            if (_hasVideoRound && _hasVoiceRound) const SizedBox(height: 20),
            if (_hasVoiceRound) _buildVoiceConfigSection(theme),
          ],
        ),
      );

  /// Adds a round, configured through this very form in round-config mode — so
  /// the recruiter meets the same fields they would creating that type on its own.
  Future<void> _addRound() async {
    final draft = await Navigator.of(context).push<InterviewRound>(
      MaterialPageRoute(
        builder: (_) => CreateInterviewPage.configureRound(
          roundOrder: _rounds.length,
          // Pre-fill from what has already been chosen for the test, so an
          // avatar picked for round 1 is not re-picked for round 2.
          sharedConfig: _rounds.isEmpty
              ? null
              : _rounds.last.config.isEmpty
                  ? null
                  : _rounds.last.config,
        ),
      ),
    );
    if (draft == null || !mounted) return;
    setState(() => _rounds.add(draft));
  }

  Future<void> _editRoundAt(int index) async {
    final updated = await Navigator.of(context).push<InterviewRound>(
      MaterialPageRoute(
        builder: (_) =>
            CreateInterviewPage.configureRound(roundDraft: _rounds[index]),
      ),
    );
    if (updated == null || !mounted) return;
    setState(() => _rounds[index] = updated);
  }

  /// The pipeline as a numbered, reorderable list — the recruiter's picture of
  /// what a candidate will go through, in order.
  Widget _buildRoundsCard(ThemeData theme) {
    final summary = _rounds.isEmpty
        ? 'No rounds yet'
        : _rounds.map((r) => r.kind.label.split(' ').first).join(' → ');

    return _buildFormSection(
      context: context,
      title: 'Rounds (${_rounds.length})',
      icon: Icons.timeline_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(summary,
              style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.primary,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text(
            'Candidates are added to round 1 when you save. They see nothing '
            'until then, and only ever see the round they are in — you move them '
            'on from the timeline as each round closes.',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 14),
          if (_rounds.isEmpty)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 20),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: theme.colorScheme.outline.withValues(alpha: 0.2),
                ),
              ),
              child: Text('Add the first round to start the timeline',
                  style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant)),
            )
          else
            // shrinkWrap: this list lives inside the form's own scroll view, so
            // it must size to its content rather than demand a viewport.
            ReorderableListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              buildDefaultDragHandles: false,
              itemCount: _rounds.length,
              onReorder: (oldIndex, newIndex) => setState(() {
                // ReorderableListView reports the target as if the dragged row
                // were still in place, so a downward move is one too high.
                final to = newIndex > oldIndex ? newIndex - 1 : newIndex;
                final moved = _rounds.removeAt(oldIndex);
                _rounds.insert(to, moved);
              }),
              itemBuilder: (context, i) => Padding(
                key: ValueKey('round-$i-${_rounds[i].title}'),
                padding: const EdgeInsets.only(bottom: 8),
                child: _roundDraftTile(theme, i),
              ),
            ),
          const SizedBox(height: 10),
          CustomButton(
            text: 'Add round',
            variant: ButtonVariant.outline,
            isLoading: false,
            icon: const Icon(Icons.add, size: 18),
            onPressed: _addRound,
          ),
        ],
      ),
    );
  }

  /// A draft round in the builder, drawn with the shared timeline tile so it
  /// looks identical to the same round on the live timeline screen.
  Widget _roundDraftTile(ThemeData theme, int i) => RoundStepTile(
        round: _rounds[i],
        position: i + 1,
        total: _rounds.length,
        showConnector: i < _rounds.length - 1,
        // Round 1 is the only one candidates get on save, so say so.
        highlight: i == 0,
        highlightLabel: i == 0 ? 'assigned on save' : null,
        onTap: () => _editRoundAt(i),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              tooltip: 'Remove round',
              icon: const Icon(Icons.close, size: 18),
              onPressed: () => setState(() => _rounds.removeAt(i)),
            ),
            ReorderableDragStartListener(
              index: i,
              child: Icon(Icons.drag_handle,
                  size: 18, color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      );

  /// Says plainly that single-round assigns immediately, and points at the
  /// toggle rather than offering a second "save then add rounds" path.
  ///
  /// There used to be a "Save & set up rounds" button here. It created a
  /// round-LESS assignment and then opened the timeline, which is precisely the
  /// sequence that left candidates holding both an orphan assignment and a round
  /// one for the same test. Multi-round mode exists so that cannot happen.
  Widget _buildSingleRoundNote(ThemeData theme) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline,
              size: 14, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Candidates can start this as soon as you save (or from the '
              '"Accessible From" time, if you set one). For a sequence of stages, '
              'switch to Multi-round at the top.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
        ],
      );

  Widget _buildFormSection({
    required BuildContext context,
    required String title,
    required IconData icon,
    required Widget child,
  }) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final accentColor = isDark ? AppColors.pastelMintText : theme.colorScheme.primary;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: WarmSurfaces.surface(context),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: WarmSurfaces.stroke(context),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: WarmSurfaces.surfaceHigh(context),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: accentColor.withValues(alpha: 0.25),
                  ),
                ),
                child: Icon(icon, color: accentColor, size: 15),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 14.5,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.2,
                    color: isDark ? AppColors.textLight : theme.colorScheme.onSurface,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }

  Widget _buildCollapsibleSection({
    required BuildContext context,
    required String title,
    required String subtitle,
    required IconData icon,
    required bool isExpanded,
    required VoidCallback onToggle,
    required Widget child,
  }) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final accentColor = isDark ? AppColors.pastelMintText : theme.colorScheme.primary;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: WarmSurfaces.surface(context),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: WarmSurfaces.stroke(context),
        ),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onToggle,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: WarmSurfaces.surfaceHigh(context),
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: accentColor.withValues(alpha: 0.25),
                        ),
                      ),
                      child: Icon(icon, color: accentColor, size: 15),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: TextStyle(
                              fontSize: 14.5,
                              fontWeight: FontWeight.w600,
                              letterSpacing: -0.2,
                              color: isDark ? AppColors.textLight : theme.colorScheme.onSurface,
                            ),
                          ),
                          const SizedBox(height: 1),
                          Text(
                            subtitle,
                            style: TextStyle(
                              fontSize: 12,
                              color: isDark ? AppColors.textMuted : theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Icon(
                      isExpanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                      size: 20,
                      color: isDark ? AppColors.textSubtle : theme.colorScheme.onSurfaceVariant,
                    ),
                  ],
                ),
                if (isExpanded) ...[
                  const SizedBox(height: 16),
                  child,
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// The two decisions with no sensible default: what KIND of interview, and
  /// what it is for. Language and duration moved to Advanced — they default to
  /// English and 15 minutes, which is right almost always.
  Widget _buildJobDetailsCard(ThemeData theme) {
    return _buildFormSection(
      context: context,
      title: 'Interview basics',
      icon: Icons.assignment_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 20),
          // In multi-round mode each round picks its own kind, so a single
          // test-wide type would be a lie.
          if (!_multiRound) ...[
            // The KIND toggle, not the old InterviewType one: a two-way
            // interview is not one of the three AI tracks, so an InterviewType
            // toggle could not offer it at all — which is why "Live" was missing
            // from single-round mode. Résumé is excluded here because that kind
            // needs the scoring-criteria card, which only round config has.
            _buildKindToggle(theme, includeResume: false),
            const SizedBox(height: 20),
          ],
          CustomInputField(
            label: 'Job Title / Interview Role',
            placeholder: _multiRound
                ? 'e.g. Senior Flutter Engineer'
                : 'e.g. Senior Flutter Engineer — Screen 1',
            controller: _titleController,
          ),
        ],
      ),
    );
  }

  /// The round's kind. Six options, because a round can be a résumé screen or an
  /// MCQ paper — neither of which [_buildTypeToggle]'s three interview tracks can
  /// express.
  ///
  /// Selecting a kind switches which of this form's existing sections apply, so
  /// the recruiter sees the same Chat/Video/Voice configuration they would when
  /// creating a standalone interview of that type — and, for MCQ, a picker for the
  /// paper instead of a script they would never be asked to write.
  Widget _buildKindToggle(ThemeData theme, {bool includeResume = true}) {
    final cs = theme.colorScheme;

    Widget seg(RoundKind kind, IconData icon, String label) {
      final selected = _roundKind == kind;
      return Expanded(
        child: GestureDetector(
          onTap: () => setState(() {
            _roundKind = kind;
            // Keep _type in step so every type-specific section below (which all
            // switch on _type) shows the right fields.
            //
            // MCQ pins it to chat rather than leaving it alone, because `mode`
            // and `type` have to agree on the document: the server's
            // `type_for_mode` puts mcq in the chat bucket, and a stored
            // `type: video` with `mode: mcq` is exactly the disagreement `mode`
            // exists to prevent. See `Interview.modeAgreesWithType`.
            _type = kind == RoundKind.mcq
                ? InterviewType.chat
                : (kind.interviewType ?? _type);
            if (kind == RoundKind.mcq) _loadMcqSets();
          }),
          behavior: HitTestBehavior.opaque,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 2),
            decoration: BoxDecoration(
              color: selected
                  ? cs.primary.withValues(alpha: 0.12)
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color:
                    selected ? cs.primary : cs.outline.withValues(alpha: 0.12),
                width: 1.5,
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon,
                    size: 20,
                    color: selected ? cs.primary : cs.onSurfaceVariant),
                const SizedBox(height: 4),
                Text(label,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight:
                          selected ? FontWeight.w600 : FontWeight.w600,
                      color: selected ? cs.primary : cs.onSurface,
                    )),
              ],
            ),
          ),
        ),
      );
    }

    // Three per row rather than one long row. Six segments across a phone gives
    // each about 55 logical pixels, which truncates every label — and the label is
    // the only thing telling a recruiter what the icon means.
    final segments = <Widget>[
      if (includeResume) seg(RoundKind.resume, Icons.description_outlined, 'Résumé'),
      seg(RoundKind.chat, Icons.chat_bubble_outline, 'Chat'),
      seg(RoundKind.video, Icons.videocam_outlined, 'Video'),
      seg(RoundKind.voice, Icons.mic_none_outlined, 'Voice'),
      seg(RoundKind.twoWay, Icons.groups_outlined, 'Live'),
      seg(RoundKind.mcq, Icons.fact_check_outlined, 'Assessment'),
    ];

    return Column(
      children: [
        for (var start = 0; start < segments.length; start += 3)
          Padding(
            padding: EdgeInsets.only(bottom: start + 3 < segments.length ? 8 : 0),
            child: Row(
              children: [
                for (var i = start; i < start + 3; i++) ...[
                  if (i < segments.length)
                    segments[i]
                  else
                    // A spacer, so a trailing row of one or two keeps the same
                    // segment width as a full row instead of stretching.
                    const Expanded(child: SizedBox.shrink()),
                  if (i < start + 2) const SizedBox(width: 8),
                ],
              ],
            ),
          ),
      ],
    );
  }

  /// Single stage vs a multi-round pipeline — the first decision, because it
  /// changes what the rest of this form asks for.
  Widget _buildModeToggle(ThemeData theme) {
    final cs = theme.colorScheme;

    Widget seg(bool multi, IconData icon, String label, String desc) {
      final selected = _multiRound == multi;
      return Expanded(
        child: GestureDetector(
          onTap: _isEdit ? null : () => setState(() => _multiRound = multi),
          behavior: HitTestBehavior.opaque,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
            decoration: BoxDecoration(
              color: selected
                  ? cs.primary.withValues(alpha: 0.12)
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: selected
                    ? cs.primary
                    : cs.outline.withValues(alpha: 0.12),
                width: 1.5,
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon,
                    size: 20,
                    color: selected ? cs.primary : cs.onSurfaceVariant),
                const SizedBox(height: 6),
                Text(label,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight:
                          selected ? FontWeight.w600 : FontWeight.w600,
                      color: selected ? cs.primary : cs.onSurface,
                    )),
                const SizedBox(height: 2),
                Text(desc,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 9,
                      color: selected
                          ? cs.primary.withValues(alpha: 0.8)
                          : cs.onSurfaceVariant,
                    )),
              ],
            ),
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            seg(false, Icons.assignment_turned_in_outlined, 'Single round',
                'One interview, assigned now'),
            const SizedBox(width: 10),
            seg(true, Icons.timeline_outlined, 'Multi-round',
                'A sequence of stages'),
          ],
        ),
        if (_isEdit)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'The structure of an existing pipeline is changed from its timeline, '
              'not here.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
      ],
    );
  }


  Widget _buildCandidatesCard(ThemeData theme) {
    return _buildFormSection(
      context: context,
      title: 'Candidates',
      icon: Icons.people_alt_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _isEdit
                ? 'The first email remains assigned to this interview; any extra emails are assigned as new interviews.'
                : _multiRound
                    // Says where they actually land: round 1, not the whole
                    // pipeline at once.
                    ? 'These candidates are added to round 1 when you save. You '
                        'move them on to later rounds from the timeline.'
                    : 'Assign this interview to one or more candidate email addresses.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 16),
          _buildCandidates(theme),
          if (_canEmailCandidates) ...[
            const SizedBox(height: 8),
            const Divider(height: 24),
            NotifyCandidatesCard(
              service: _mailer,
              ownerEmail: _recruiterEmail,
              recruiterId: FirebaseAuth.instance.currentUser?.uid,
              enabled: _notifyByEmail,
              onEnabledChanged: (v) => setState(() => _notifyByEmail = v),
              template: _emailTemplate,
              onTemplateChanged: (t) => setState(() => _emailTemplate = t),
              candidateCount: _candidateEmails.length,
              previewContext: _emailPreviewContext,
            ),
          ],
        ],
      ),
    );
  }

  /// The email options only appear once a mail server is configured (Settings →
  /// Candidate Emails) and we know who the sender is — templates are bound to
  /// that address.
  bool get _canEmailCandidates =>
      _mailer.isConfigured && _recruiterEmail.isNotEmpty;

  /// Values the template preview fills its placeholders with, using what the
  /// recruiter has typed so far.
  Map<String, String> get _emailPreviewContext => sampleContext(
        interviewTitle: _titleController.text.trim(),
        recruiterName: _recruiterName,
        company: 'Mimic',
      );

  Widget _buildCandidates(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (int i = 0; i < _candidateEmailControllers.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: CustomInputField(
                    label: 'Candidate ${i + 1}',
                    placeholder: 'candidate${i + 1}@example.com',
                    controller: _candidateEmailControllers[i],
                    keyboardType: TextInputType.emailAddress,
                  ),
                ),
                if (_candidateEmailControllers.length > 1) ...[
                  const SizedBox(width: 8),
                  Padding(
                    padding: const EdgeInsets.only(top: 28), // Align with input field
                    child: IconButton(
                      icon: const Icon(Icons.delete_outline, color: AppColors.danger),
                      onPressed: () => _removeCandidate(i),
                    ),
                  ),
                ],
              ],
            ),
          ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: CustomButton(
                text: 'Add candidate',
                variant: ButtonVariant.outline,
                height: 44,
                icon: const Icon(Icons.add, size: 18),
                onPressed: _addCandidate,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: CustomButton(
                text: 'Import file',
                variant: ButtonVariant.outline,
                height: 44,
                icon: const Icon(Icons.upload_file_outlined, size: 18),
                onPressed: _importEmails,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildInterviewDesignCard(ThemeData theme) {
    final title = _type == InterviewType.video
        ? 'Avatar & Questions'
        : _type == InterviewType.chat
            ? 'Chat questions'
            : 'Voice questions';

    final icon = _type == InterviewType.video
        ? Icons.video_settings_outlined
        : _type == InterviewType.chat
            ? Icons.question_answer_outlined
            : Icons.record_voice_over_outlined;

    return _buildFormSection(
      context: context,
      title: title,
      icon: icon,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_type == InterviewType.video) ...[
            // The avatar is the one video setting with no default — an interview
            // cannot run without a replica. The prompt is pre-filled and lives
            // in Advanced.
            _buildAvatarSection(theme),
            const SizedBox(height: 20),
            _buildQuestions(theme),
          ] else if (_type == InterviewType.chat) ...[
            _buildQuestionSourceToggle(theme),
            const SizedBox(height: 16),
            if (_isAdaptiveChat) ...[
              Text(
                'The AI interviewer dynamically creates resume-grounded questions. The candidate will upload their resume before starting.',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Number of Questions',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  _buildModernStepper(
                    value: _adaptiveNumQuestions,
                    min: 1,
                    max: 15,
                    onChanged: (v) => setState(() => _adaptiveNumQuestions = v),
                  ),
                ],
              ),
            ] else if (_questionSource == 'mixed') ...[
              _buildMixedCounts(theme),
              const SizedBox(height: 20),
              _buildQuestions(theme),
            ] else ...[
              _buildQuestions(theme),
            ],
          ] else if (_type == InterviewType.voice) ...[
            // Voice + persona default to the catalog's picks and live in
            // Advanced, as does the prompt.
            _buildQuestions(theme),
          ],
        ],
      ),
    );
  }

  Widget _buildQuestionSourceToggle(ThemeData theme) {
    final cs = theme.colorScheme;
    Widget seg(String source, String label, String desc, IconData icon) {
      final selected = _questionSource == source;
      return Expanded(
        child: GestureDetector(
          onTap: () => setState(() => _questionSource = source),
          behavior: HitTestBehavior.opaque,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
            decoration: BoxDecoration(
              color: selected ? cs.primary.withValues(alpha: 0.12) : Colors.transparent,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: selected ? cs.primary : cs.outline.withValues(alpha: 0.12),
                width: 1.5,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  icon,
                  size: 20,
                  color: selected ? cs.primary : cs.onSurfaceVariant,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: selected ? FontWeight.w600 : FontWeight.w600,
                          color: selected ? cs.primary : cs.onSurface,
                        ),
                      ),
                      Text(
                        desc,
                        style: TextStyle(
                          fontSize: 9,
                          color: selected ? cs.primary.withValues(alpha: 0.8) : cs.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Row(
      children: [
        seg('fixed', 'Fixed list', 'Predefined set', Icons.list_alt_outlined),
        const SizedBox(width: 12),
        seg('adaptive', 'Adaptive AI', 'Dynamic resume-based', Icons.auto_awesome_outlined),
        const SizedBox(width: 12),
        seg('mixed', 'Mixed', 'Fixed, then resume-adapted', Icons.dashboard_customize_outlined),
      ],
    );
  }

  /// Mixed mode's own counts (Feature 3): how many of the total come from the
  /// fixed list below vs are résumé-adapted afterwards. Live-validated — the
  /// three numbers have to add up, and the recruiter sees that the moment it
  /// stops being true rather than only on Save.
  Widget _buildMixedCounts(ThemeData theme) {
    final cs = theme.colorScheme;
    final invalid = _mixedCountsInvalid;

    Widget stepperRow(String label, int value, ValueChanged<int> onChanged) {
      return Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w500,
            ),
          ),
          _buildModernStepper(value: value, min: 0, max: 30, onChanged: onChanged),
        ],
      );
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: invalid
            ? cs.error.withValues(alpha: 0.06)
            : cs.surfaceContainerHighest.withValues(alpha: 0.25),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: invalid ? cs.error : cs.outline.withValues(alpha: 0.12),
          width: invalid ? 1.2 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          stepperRow(
            'Total questions',
            _mixedTotal,
            (v) => setState(() => _mixedTotal = v),
          ),
          const SizedBox(height: 12),
          stepperRow(
            'Fixed questions',
            _mixedFixed,
            (v) => setState(() => _mixedFixed = v),
          ),
          const SizedBox(height: 12),
          stepperRow(
            'Résumé-based questions',
            _mixedResume,
            (v) => setState(() => _mixedResume = v),
          ),
          const SizedBox(height: 12),
          if (invalid)
            Text(
              'Fixed ($_mixedFixed) + résumé-based ($_mixedResume) must add up '
              'to the total ($_mixedTotal).',
              style: theme.textTheme.bodySmall?.copyWith(
                color: cs.error,
                fontWeight: FontWeight.w600,
              ),
            )
          else
            Text(
              'Question flow: 1–$_mixedFixed Fixed · '
              '${_mixedFixed + 1}–$_mixedTotal Résumé-adapted',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildQuestions(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 12,
          runSpacing: 8,
          children: [
            Text(
              'Questions list',
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            QuestionTemplatesBar(
              currentQuestions: () => _questions,
              onApply: _applyTemplate,
              includeInterviewTemplates: true,
            ),
          ],
        ),
        const SizedBox(height: 12),
        for (int i = 0; i < _questionControllers.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: CustomInputField(
                    label: 'Question ${i + 1}',
                    placeholder: 'e.g. Describe a time you resolved a technical challenge.',
                    controller: _questionControllers[i],
                  ),
                ),
                if (_questionControllers.length > 1) ...[
                  const SizedBox(width: 8),
                  Padding(
                    padding: const EdgeInsets.only(top: 28), // Align with input field
                    child: IconButton(
                      icon: const Icon(Icons.delete_outline, color: AppColors.danger),
                      onPressed: () => _removeQuestion(i),
                    ),
                  ),
                ],
              ],
            ),
          ),
        const SizedBox(height: 8),
        CustomButton(
          text: 'Add question',
          variant: ButtonVariant.outline,
          width: double.infinity,
          height: 44,
          icon: const Icon(Icons.add, size: 18),
          onPressed: _addQuestion,
        ),
      ],
    );
  }

  Widget _buildAvatarSection(ThemeData theme) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Select avatar video',
                style: theme.textTheme.titleSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            // Avatars are cached for 10 hours; this is the only way to refetch.
            Consumer<AvatarCatalog>(
              builder: (_, catalog, __) => Row(
                children: [
                  Text(
                    'Updated ${catalog.ageLabel}',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant),
                  ),
                  IconButton(
                    tooltip: 'Refresh avatars',
                    icon: const Icon(Icons.refresh, size: 18),
                    visualDensity: VisualDensity.compact,
                    onPressed: _loadingReplicas ? null : _refreshAvatars,
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (_loadingReplicas)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (_replicas.isNotEmpty)
          Container(
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: theme.colorScheme.outline.withValues(alpha: 0.12),
              ),
            ),
            child: AvatarStrip(
              replicas: _replicas,
              selectedId: _replicaIdController.text.trim(),
              onSelect: (id) => setState(() => _replicaIdController.text = id),
            ),
          )
        else
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: theme.colorScheme.outline.withValues(alpha: 0.12),
              ),
            ),
            child: Text(
              'No avatars loaded. Enter a replica ID manually below.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontSize: 12,
              ),
            ),
          ),
        const SizedBox(height: 16),
        CustomInputField(
          label: 'Replica ID',
          placeholder: 'e.g. r1234abc...',
          controller: _replicaIdController,
        ),
        const SizedBox(height: 12),
        CustomInputField(
          label: 'Persona ID (Optional)',
          placeholder: 'e.g. p1234abc...',
          controller: _personaIdController,
        ),
      ],
    );
  }

  Widget _buildVoiceConfigSection(ThemeData theme) {
    final base = VoiceCatalog.defaultVoiceConfig;
    final current = VoiceConfig(
      engine: base.engine,
      personaId: _resolvedVoicePersonaId,
      voiceId: _resolvedVoiceName,
      allowBargeIn: base.allowBargeIn,
      language: base.language,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Select Voice & Persona',
          style: theme.textTheme.titleSmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: theme.colorScheme.outline.withValues(alpha: 0.12),
            ),
          ),
          padding: const EdgeInsets.all(12),
          child: VoicePicker(
            value: current,
            onChanged: (c) => setState(() {
              _voicePersonaId = c.personaId;
              _voiceName = c.voiceId;
            }),
          ),
        ),
      ],
    );
  }

  /// Proctoring + welcome message. Content only — nested inside Advanced.
  /// Everything with a working default, behind one collapsed section.
  ///
  /// The form above it is the minimum to run an interview: type, title,
  /// candidates, questions, and an avatar for video. Every field in here is
  /// already pre-filled — the interviewer prompt from the app default, questions
  /// from the five defaults, 15 minutes, English, the catalog's voice — so a
  /// recruiter who never opens this still gets a sensible interview.
  ///
  /// The summary line names what has been changed from default, so a collapsed
  /// section never hides a decision someone made earlier (or on an edit).
  Widget _buildAdvancedCard(ThemeData theme) {
    return _buildCollapsibleSection(
      context: context,
      title: 'Advanced settings',
      subtitle: _advancedSummary,
      icon: Icons.tune,
      isExpanded: _advancedExpanded,
      onToggle: () => setState(() => _advancedExpanded = !_advancedExpanded),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _advancedGroup(theme, 'Interviewer'),
          CustomInputField(
            label: _type == InterviewType.video
                ? 'AI Interviewer Instructions / Prompt'
                : 'AI Instructions / Prompt',
            placeholder:
                'How the AI should behave, the tone, and what to probe for…',
            controller: _promptController,
            maxLines: 5,
          ),
          if (_type == InterviewType.video) ...[
            const SizedBox(height: 16),
            CustomToggle(
              label: 'Collect résumé',
              description:
                  'Require candidates to upload a resume to ground the avatar\'s questions.',
              checked: _collectResume,
              onChanged: (v) => setState(() => _collectResume = v),
            ),
          ],

          if (_type == InterviewType.voice) ...[
            _advancedGroup(theme, 'Voice & persona'),
            _buildVoiceConfigSection(theme),
          ],

          if (_isAdaptiveChat) ...[
            _advancedGroup(theme, 'Adaptive questions'),
            CustomToggle(
              label: 'Allow Follow-ups',
              description:
                  'Let the AI ask conversational follow-up questions based on the candidate\'s responses.',
              checked: _adaptiveFollowUps,
              onChanged: (v) => setState(() => _adaptiveFollowUps = v),
            ),
          ],

          _advancedGroup(theme, 'Language & length'),
          CustomSelectDropdown<String>(
            label: 'Interview language',
            value: _language,
            items: [
              for (final l in _languages)
                DropdownMenuItem(value: l, child: Text(l)),
            ],
            onChanged: (v) => setState(() => _language = v ?? 'English'),
          ),
          const SizedBox(height: 16),
          CustomSlider(
            label: 'Interview duration',
            min: 5,
            max: 60,
            divisions: 11,
            value: _durationMinutes.toDouble(),
            formatValue: (v) => '${v.round()} mins',
            onChanged: (v) => setState(() => _durationMinutes = v.round()),
          ),

          if (_type == InterviewType.chat) ...[
            _advancedGroup(theme, 'Proctoring & experience'),
            _buildIntegrityBrandingCard(theme),
          ],
        ],
      ),
    );
  }

  /// Sub-heading inside Advanced, so one long section still scans.
  Widget _advancedGroup(ThemeData theme, String label) => Padding(
        padding: const EdgeInsets.only(top: 24, bottom: 12),
        child: Text(
          label.toUpperCase(),
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.primary,
            fontWeight: FontWeight.w600,
            letterSpacing: 1.0,
          ),
        ),
      );

  /// Advanced values that differ from the defaults.
  ///
  /// Drives both the collapsed summary and whether the section opens on an EDIT:
  /// a recruiter reopening an interview they customised must not have those
  /// choices hidden behind a collapsed header.
  List<String> get _advancedDifferences {
    final changed = <String>[];
    if (_language != 'English') changed.add(_language);
    if (_durationMinutes != 15) changed.add('$_durationMinutes min');
    if (_collectResume) changed.add('resume required');
    if (_type == InterviewType.chat && !_detectTabSwitch) {
      changed.add('proctoring off');
    }
    if (_welcomeController.text.trim().isNotEmpty) changed.add('welcome message');
    return changed;
  }

  String get _advancedSummary {
    final changed = _advancedDifferences;
    if (changed.isEmpty) {
      return 'Using defaults — English, 15 min, standard prompt';
    }
    return 'Changed: ${changed.join(' · ')}';
  }

  Widget _buildIntegrityBrandingCard(ThemeData theme) {
    return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          CustomToggle(
            label: 'Detect tab switch',
            description: 'Flag candidate if they leave or switch tabs during the interview.',
            checked: _detectTabSwitch,
            onChanged: (v) => setState(() => _detectTabSwitch = v),
          ),
          const Divider(height: 1),
          CustomToggle(
            label: 'Block paste',
            description: 'Prevent candidates from pasting text answers.',
            checked: _disablePaste,
            onChanged: (v) => setState(() => _disablePaste = v),
          ),
          const Divider(height: 1),
          CustomToggle(
            label: 'Block copy',
            description: 'Prevent candidates from copying questions.',
            checked: _disableCopy,
            onChanged: (v) => setState(() => _disableCopy = v),
          ),
          const SizedBox(height: 16),
          CustomInputField(
            label: 'Welcome Message (Optional)',
            placeholder: 'Displayed to the candidate before starting the interview...',
            controller: _welcomeController,
            maxLines: 3,
          ),
      ],
    );
  }

  Widget _buildTimingAccessCard(ThemeData theme) {
    final hasChatTimer = _type == InterviewType.chat;

    final List<String> summaryParts = [];
    if (_availableFrom != null || _expiresAt != null) {
      summaryParts.add('Schedule set');
    }
    if (_maxAttempts != null) {
      summaryParts.add('Max $_maxAttempts attempts');
    } else {
      summaryParts.add('Unlimited attempts');
    }
    if (hasChatTimer && _chatTimerEnabled) {
      summaryParts.add('Timed questions');
    }
    final summary = summaryParts.join(' · ');

    return _buildCollapsibleSection(
      context: context,
      title: 'Scheduling & Retries',
      subtitle: summary,
      icon: Icons.schedule_outlined,
      isExpanded: _timingAccessExpanded,
      onToggle: () => setState(() => _timingAccessExpanded = !_timingAccessExpanded),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Access Window (Optional)',
            style: theme.textTheme.titleSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 8),
          _buildDateTimeTile(label: 'Accessible from', value: _availableFrom, isExpiry: false),
          const SizedBox(height: 12),
          _buildDateTimeTile(label: 'Expires at', value: _expiresAt, isExpiry: true),
          const SizedBox(height: 20),
          CustomToggle(
            label: 'Limit candidate attempts',
            description: 'Control how many attempts a candidate is allowed to complete the interview.',
            checked: _maxAttempts != null,
            onChanged: (v) => setState(() => _maxAttempts = v ? 1 : null),
          ),
          if (_maxAttempts != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: theme.colorScheme.outline.withValues(alpha: 0.08),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Attempts allowed',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  _buildModernStepper(
                    value: _maxAttempts!,
                    min: 1,
                    max: 10,
                    onChanged: (v) => setState(() => _maxAttempts = v),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 20),
          _buildDevicePicker(theme),
          if (hasChatTimer) ...[
            const SizedBox(height: 16),
            const Divider(),
            const SizedBox(height: 16),
            Text(
              'Per-Question Countdown Timer',
              style: theme.textTheme.titleSmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w500,
              ),
            ),
            CustomToggle(
              label: 'Enable question timer',
              description: 'Give candidate a fixed amount of time to think and write their response.',
              checked: _chatTimerEnabled,
              onChanged: (v) => setState(() => _chatTimerEnabled = v),
            ),
            if (_chatTimerEnabled) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: theme.colorScheme.outline.withValues(alpha: 0.08),
                  ),
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Answer time per question', style: theme.textTheme.bodyMedium),
                        _buildModernStepper(
                          value: _chatTimerPerQuestion,
                          min: 30,
                          max: 600,
                          step: 30,
                          suffix: 's',
                          onChanged: (v) => setState(() => _chatTimerPerQuestion = v),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Thinking time before typing', style: theme.textTheme.bodyMedium),
                        _buildModernStepper(
                          value: _chatTimerThinking,
                          min: 0,
                          max: 300,
                          step: 15,
                          suffix: 's',
                          onChanged: (v) => setState(() => _chatTimerThinking = v),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    CustomToggle(
                      label: 'Auto-submit at 0',
                      description: 'Submit candidate\'s current text when time runs out.',
                      checked: _chatTimerAutoSubmit,
                      onChanged: (v) => setState(() => _chatTimerAutoSubmit = v),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }

  Widget _buildDateTimeTile({
    required String label,
    required DateTime? value,
    required bool isExpiry,
  }) {
    final theme = Theme.of(context);
    final isSet = value != null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.15),
        border: Border.all(
          color: theme.colorScheme.outline.withValues(alpha: 0.12),
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Icon(
            isExpiry ? Icons.event_busy_outlined : Icons.event_available_outlined,
            color: isSet ? theme.colorScheme.primary : theme.colorScheme.onSurfaceVariant,
            size: 20,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: theme.colorScheme.onSurface,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  isSet ? formatDateTime(value) : (isExpiry ? 'No expiration date' : 'Available immediately'),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: isSet ? theme.colorScheme.primary : theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            onPressed: () => _pickDateTime(isExpiry: isExpiry),
            style: TextButton.styleFrom(
              visualDensity: VisualDensity.compact,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            ),
            child: Text(isSet ? 'Change' : 'Set'),
          ),
          if (isSet) ...[
            const SizedBox(width: 4),
            IconButton(
              icon: const Icon(Icons.clear, size: 18),
              onPressed: () => setState(() {
                if (isExpiry) {
                  _expiresAt = null;
                } else {
                  _availableFrom = null;
                }
              }),
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(),
            ),
          ],
        ],
      ),
    );
  }

  /// Where the candidate may take this interview.
  ///
  /// Multi-select, because the useful restrictions are "apps only" and "browser
  /// only" as much as any single device.
  ///
  /// The last selected device cannot be turned off. An interview nobody can take is
  /// never what a recruiter meant, and the state is easier to prevent than explain.
  Widget _buildDevicePicker(ThemeData theme) {
    const options = <String, ({String label, String hint})>{
      'web': (label: 'Web browser', hint: 'Any computer or phone browser'),
      'mobile': (label: 'Mobile app', hint: 'The Mimic app on a phone'),
      'desktop': (label: 'Desktop app', hint: 'The Mimic app on a computer'),
    };
    final unrestricted = _allowedDevices.length == options.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Where they can take it',
          style: theme.textTheme.titleSmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'All three by default. Narrow it when the interview genuinely needs one.',
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final entry in options.entries)
              _deviceChip(
                theme,
                id: entry.key,
                label: entry.value.label,
                hint: entry.value.hint,
              ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          unrestricted
              ? 'No restriction — candidates can use whichever they have.'
              : 'Candidates opening another client are told to switch.',
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }

  Widget _deviceChip(
    ThemeData theme, {
    required String id,
    required String label,
    required String hint,
  }) {
    final on = _allowedDevices.contains(id);
    final isLast = on && _allowedDevices.length == 1;

    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: isLast
          ? null
          : () => setState(() {
                if (on) {
                  _allowedDevices.remove(id);
                } else {
                  _allowedDevices.add(id);
                }
              }),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: on
              ? theme.colorScheme.primary.withValues(alpha: 0.08)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: on
                ? theme.colorScheme.primary
                : theme.colorScheme.outline.withValues(alpha: 0.3),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: on ? theme.colorScheme.primary : null,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              hint,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildModernStepper({
    required int value,
    required int min,
    required int max,
    int step = 1,
    String suffix = '',
    required ValueChanged<int> onChanged,
  }) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;

    Widget btn(IconData icon, bool enabled, VoidCallback onTap) {
      return Material(
        color: enabled
            ? cs.surfaceContainerHighest.withValues(alpha: 0.3)
            : cs.surfaceContainerHighest.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            width: 36,
            height: 36,
            alignment: Alignment.center,
            child: Icon(
              icon,
              size: 18,
              color: enabled ? cs.primary : cs.onSurfaceVariant.withValues(alpha: 0.3),
            ),
          ),
        ),
      );
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        btn(
          Icons.remove,
          value > min,
          () => onChanged((value - step).clamp(min, max)),
        ),
        Container(
          constraints: const BoxConstraints(minWidth: 48),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Text(
            '$value$suffix',
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
              color: cs.onSurface,
            ),
          ),
        ),
        btn(
          Icons.add,
          value < max,
          () => onChanged((value + step).clamp(min, max)),
        ),
      ],
    );
  }

}

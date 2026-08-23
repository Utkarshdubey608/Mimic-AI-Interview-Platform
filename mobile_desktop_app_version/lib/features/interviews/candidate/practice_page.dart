// lib/features/interviews/candidate/practice_page.dart
//
// Candidate self-serve "Practice with AI" add-on. The candidate enters their own
// Tavus API key and configures their own prompt / questions / avatar, then runs
// the AI avatar for practice. It reuses the same Tavus launch machinery as
// assigned interviews (video_launch.dart) but with no Firestore Interview doc —
// nothing is assigned, tracked, or scored on the recruiter side.

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/shared/models/app_models.dart';
import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/services/avatar_catalog.dart';
import 'package:talbotiq/core/services/tavus_service.dart';
import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/features/interviews/shared/avatar_picker.dart';
import 'package:talbotiq/shared/widgets/custom_buttons.dart';
import 'package:talbotiq/shared/widgets/custom_inputs.dart';
import 'package:talbotiq/shared/widgets/desktop_page_container.dart';
import 'package:talbotiq/shared/widgets/logout_button.dart';
import 'package:talbotiq/shared/widgets/section_header.dart';
import 'package:talbotiq/features/recruiter/views/widgets/question_templates_bar.dart';
import 'package:talbotiq/features/interviews/candidate/video_launch.dart';

class PracticePage extends StatefulWidget {
  const PracticePage({super.key});

  @override
  State<PracticePage> createState() => _PracticePageState();
}

class _PracticePageState extends State<PracticePage> {
  final _promptController = TextEditingController();
  final _replicaIdController = TextEditingController();
  final _personaIdController = TextEditingController();
  final List<TextEditingController> _questionControllers = [
    TextEditingController(),
  ];
  int _durationMinutes = 10;

  List<TavusReplica> _replicas = const [];
  bool _loadingReplicas = false;
  bool _launching = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _promptController.text = DraftForm.defaults().conversationalContext;
  }

  @override
  void dispose() {
    _promptController.dispose();
    _replicaIdController.dispose();
    _personaIdController.dispose();
    for (final c in _questionControllers) {
      c.dispose();
    }
    super.dispose();
  }

  /// Cached read — the catalog only calls Tavus once per 10-hour window.
  Future<void> _loadReplicas() => _fetchAvatars(refresh: false);

  /// Explicit user action.
  Future<void> _refreshAvatars() => _fetchAvatars(refresh: true);

  Future<void> _fetchAvatars({required bool refresh}) async {
    final catalog = context.read<AvatarCatalog>();
    setState(() {
      _loadingReplicas = true;
      _error = null;
    });
    await (refresh ? catalog.refresh() : catalog.ensureLoaded());
    if (!mounted) return;
    setState(() {
      _loadingReplicas = false;
      _replicas = catalog.replicas;
      // Cached avatars keep working after a failed refresh; only complain when
      // the picker would otherwise be empty.
      _error = _replicas.isEmpty && catalog.error != null
          ? 'Could not load avatars: ${catalog.error}'
          : null;
    });
  }

  void _addQuestion() =>
      setState(() => _questionControllers.add(TextEditingController()));

  void _removeQuestion(int i) {
    if (_questionControllers.length == 1) return;
    setState(() => _questionControllers.removeAt(i).dispose());
  }

  /// Replaces the practice questions with a saved template's questions.
  void _applyTemplate(List<String> questions, {String? title}) {
    setState(() {
      for (final c in _questionControllers) {
        c.dispose();
      }
      _questionControllers
        ..clear()
        ..addAll((questions.isEmpty ? [''] : questions)
            .map((q) => TextEditingController(text: q)));
    });
  }

  List<String> get _questions => _questionControllers
      .map((c) => c.text.trim())
      .where((t) => t.isNotEmpty)
      .toList();

  String _candidateName() {
    final email = FirebaseAuth.instance.currentUser?.email ?? '';
    final at = email.indexOf('@');
    return at > 0 ? email.substring(0, at) : 'Candidate';
  }

  Future<void> _launch() async {
    if (_replicaIdController.text.trim().isEmpty) {
      setState(() => _error = 'Pick or enter an avatar (replica).');
      return;
    }

    setState(() {
      _launching = true;
      _error = null;
    });

    final config = DraftForm.defaults().copyWith(
      conversationalContext: _promptController.text.trim(),
      replicaId: _replicaIdController.text.trim(),
      personaId: _personaIdController.text.trim(),
      conversationName: 'AI Practice',
      maxCallDuration: _durationMinutes * 60,
    );

    try {
      await launchVideoConversation(
        context: context,
        config: config,
        questions: _questions,
        candidateName: _candidateName(),
        interview: null,
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = 'Could not start practice: '
          '${e.toString().replaceAll('Exception: ', '')}');
    } finally {
      if (mounted) setState(() => _launching = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (isDesktopPlatform) return _buildDesktop(theme);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Practice with AI'),
        actions: const [LogoutButton(), SizedBox(width: 4)],
        elevation: 0,
      ),
      body: _body(theme, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16)),
    );
  }

  /// Same form/launch logic as mobile — only the chrome around it changes:
  /// a page header instead of an AppBar, matching the desktop shell's
  /// top-nav pattern (which already owns Logout via the profile menu).
  Widget _buildDesktop(ThemeData theme) {
    return DesktopPageContainer(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SectionHeader(
            title: 'Practice with AI',
            subtitle: 'Configure your own prompt, questions and avatar, then run a self-serve practice session.',
            isPageTitle: true,
          ),
          const SizedBox(height: 24),
          Expanded(child: _body(theme, padding: EdgeInsets.zero)),
        ],
      ),
    );
  }

  Widget _body(ThemeData theme, {required EdgeInsets padding}) {
    return Stack(
      children: [
        SafeArea(
          child: SingleChildScrollView(
          padding: padding,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 640),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildSessionSetupCard(theme),
                  _buildQuestionsCard(theme),
                  _buildAvatarCard(theme),
                  if (_error != null) ...[
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8.0),
                      child: Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: theme.colorScheme.error,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  CustomButton(
                    text: 'Start practice session',
                    isLoading: _launching,
                    width: double.infinity,
                    onPressed: _launching ? () {} : _launch,
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            ),
          ),
          ),
        ),
        if (_launching)
          Positioned.fill(
            child: ColoredBox(
              color: Colors.black.withValues(alpha: 0.5),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
                  margin: const EdgeInsets.symmetric(horizontal: 32),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: theme.colorScheme.outline.withValues(alpha: 0.12),
                    ),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const CircularProgressIndicator(),
                      const SizedBox(height: 16),
                      Text(
                        'Starting Practice Session...',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Setting up AI avatar call...',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildFormSection({
    required BuildContext context,
    required String title,
    required IconData icon,
    required Widget child,
    Widget? action,
  }) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.only(bottom: 20),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(icon, color: theme.colorScheme.primary, size: 22),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    title,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                      letterSpacing: -0.2,
                    ),
                  ),
                ),
                if (action != null) action,
              ],
            ),
            const SizedBox(height: 20),
            child,
          ],
        ),
      ),
    );
  }



  Widget _buildSessionSetupCard(ThemeData theme) {
    return _buildFormSection(
      context: context,
      title: 'Session configuration',
      icon: Icons.settings_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          CustomInputField(
            label: 'AI Interviewer Instructions / Prompt',
            placeholder: 'How the AI avatar should behave, questions style, tone...',
            controller: _promptController,
            maxLines: 5,
          ),
          const SizedBox(height: 16),
          CustomSlider(
            label: 'Practice call duration',
            min: 5,
            max: 60,
            divisions: 11,
            value: _durationMinutes.toDouble(),
            formatValue: (v) => '${v.round()} mins',
            onChanged: (v) => setState(() => _durationMinutes = v.round()),
          ),
        ],
      ),
    );
  }

  Widget _buildQuestionsCard(ThemeData theme) {
    return _buildFormSection(
      context: context,
      title: 'Practice questions',
      icon: Icons.question_answer_outlined,
      child: _buildQuestions(theme),
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
              'Questions (Optional)',
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            QuestionTemplatesBar(
              currentQuestions: () => _questions,
              onApply: _applyTemplate,
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

  Widget _buildAvatarCard(ThemeData theme) {
    // Avatars are cached for 10 hours, so this is a REFRESH rather than the
    // initial load — `initState` already populated the list from cache.
    Widget action = TextButton.icon(
      onPressed: _loadingReplicas ? null : _refreshAvatars,
      icon: const Icon(Icons.refresh, size: 16),
      label: Text(_replicas.isEmpty
          ? 'Load avatars'
          : 'Refresh (${context.watch<AvatarCatalog>().ageLabel})'),
      style: TextButton.styleFrom(
        visualDensity: VisualDensity.compact,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      ),
    );

    return _buildFormSection(
      context: context,
      title: 'AI Avatar Select',
      icon: Icons.face_outlined,
      action: action,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_loadingReplicas)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_replicas.isNotEmpty)
            Container(
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.1),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: theme.colorScheme.outline.withOpacity(0.12),
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
                color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.1),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: theme.colorScheme.outline.withOpacity(0.12),
                ),
              ),
              child: Text(
                'Enter your API key and tap "Load Avatars" to choose, or enter a replica ID manually below.',
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
      ),
    );
  }
}

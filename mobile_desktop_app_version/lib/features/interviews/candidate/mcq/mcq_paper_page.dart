// lib/features/interviews/candidate/mcq/mcq_paper_page.dart
//
// The candidate's MCQ runtime. Until this landed, an MCQ invite on this client showed
// "open this on the web" — see the gate that used to sit in candidate_home.dart.
//
// One scrolling paper rather than one-question-at-a-time, and that is a deliberate
// difference from the chat and voice tracks. An assessment is a paper: people skip a
// question, come back, change their mind, and check how much is left. A card-by-card
// runtime makes all four either impossible or a navigation exercise, and it buys
// nothing — there is no per-question clock here. There IS a clock for the whole
// paper: the countdown in the app bar, which hands the paper in at zero.
//
// The completion screen shows NO SCORE, exactly like every other track. The result is
// computed the moment they submit, but whether a candidate sees it is `resultPublished`
// — a recruiter action. A machine handing somebody a verdict with no human in the loop
// is the thing that gate exists to prevent.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/net/backend_client.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';
import 'package:talbotiq/shared/widgets/countdown_badge.dart';
import 'mcq_models.dart';
import 'mcq_store.dart';

class McqPaperPage extends StatefulWidget {
  const McqPaperPage({
    super.key,
    required this.interviewId,
    required this.title,
    this.client,
  });

  final String interviewId;

  /// The interview's own title, shown until the paper arrives with its own name.
  final String title;

  /// Injected by tests. Production uses the shared client.
  final BackendClient? client;

  @override
  State<McqPaperPage> createState() => _McqPaperPageState();
}

class _McqPaperPageState extends State<McqPaperPage> {
  late final McqStore _store;

  @override
  void initState() {
    super.initState();
    _store = McqStore(
      interviewId: widget.interviewId,
      client: widget.client ?? backendClient,
    );
    _store.load();
  }

  @override
  void dispose() {
    _store.dispose();
    super.dispose();
  }

  /// Confirms before handing in, and says what is unanswered.
  ///
  /// An unanswered question is scored WRONG, not skipped — so "you have left 6
  /// unanswered" is the single most useful thing to say at this moment, and saying it
  /// only after submitting would be useless.
  Future<void> _confirmAndSubmit() async {
    final remaining = _store.total - _store.answered;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Submit your answers?'),
        content: Text(
          remaining == 0
              ? 'You have answered every question. You cannot change your answers after submitting.'
              : 'You have left $remaining question${remaining == 1 ? '' : 's'} unanswered. '
                  'Unanswered questions are marked wrong, and you cannot change your answers after submitting.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Keep answering'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Submit'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    final submitted = await _store.submit();
    if (!mounted) return;
    if (!submitted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_store.error ?? 'Could not submit. Please try again.')),
      );
    }
  }

  /// Hands the paper in because the clock ran out.
  ///
  /// No confirmation dialog, deliberately: there is nothing left to decide, and a
  /// dialog would sit there unanswered while the paper stayed open past its
  /// deadline. Whatever has been answered is what is submitted — unanswered
  /// questions are scored wrong either way, which is the same rule as pressing
  /// submit by hand.
  ///
  /// The pending autosave is flushed first, so the last few taps before the
  /// deadline are not the ones that go missing.
  Future<void> _submitBecauseTimeIsUp() async {
    if (_store.phase != McqPhase.ready) return;
    await _store.saveNow();
    if (!mounted || _store.phase != McqPhase.ready) return;
    final submitted = await _store.submit();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(submitted
            ? 'Time is up — your answers were handed in.'
            : 'Time is up, but your answers could not be sent: '
                '${_store.error ?? 'please try again'}.'),
        duration: const Duration(seconds: 6),
      ),
    );
  }

  /// Leaving mid-paper flushes whatever is pending.
  ///
  /// The debounce means the last couple of taps may not have been sent yet, and a
  /// candidate stepping out for a minute should not come back to them missing.
  Future<bool> _onWillPop() async {
    if (_store.phase == McqPhase.ready) await _store.saveNow();
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        // Captured BEFORE the await: flushing the autosave is a network call, and
        // reaching for the context after it is what the analyzer (rightly) objects to.
        final navigator = Navigator.of(context);
        await _onWillPop();
        if (mounted) navigator.pop();
      },
      child: AnimatedBuilder(
        animation: _store,
        builder: (context, _) => Scaffold(
          appBar: AppBar(
            title: Text(_store.paper?.name.isNotEmpty == true
                ? _store.paper!.name
                : widget.title),
            bottom: _store.phase == McqPhase.ready
                ? PreferredSize(
                    preferredSize: const Size.fromHeight(28),
                    child: _ProgressBar(
                      store: _store,
                      onTimeUp: _submitBecauseTimeIsUp,
                    ),
                  )
                : null,
          ),
          body: _body(),
          bottomNavigationBar:
              _store.phase == McqPhase.ready || _store.phase == McqPhase.submitting
                  ? _SubmitBar(
                      store: _store,
                      onSubmit: _store.phase == McqPhase.submitting
                          ? null
                          : _confirmAndSubmit,
                    )
                  : null,
        ),
      ),
    );
  }

  Widget _body() {
    switch (_store.phase) {
      case McqPhase.loading:
        return const Center(child: CircularProgressIndicator());
      case McqPhase.failed:
        return AppErrorState(
          title: 'This assessment could not be opened',
          detail: _store.error ?? 'Please try again.',
          onRetry: _store.load,
        );
      case McqPhase.submitted:
        return const _SubmittedState();
      case McqPhase.ready:
      case McqPhase.submitting:
        return _PaperView(store: _store);
    }
  }
}

class _ProgressBar extends StatelessWidget {
  const _ProgressBar({required this.store, required this.onTimeUp});

  final McqStore store;

  /// Called once, when the countdown reaches zero.
  final VoidCallback onTimeUp;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final total = store.total;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Row(
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: total == 0 ? 0 : store.answered / total,
                minHeight: 6,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Text('${store.answered}/$total', style: theme.textTheme.labelMedium),
          // The clock the candidate was promised on their interviews screen
          // ("15 min") and had no way to see once the paper opened. It owns its
          // own ticker, so a 40-question paper is not rebuilt once a second —
          // see CountdownBadge.
          if (store.remaining != null) ...[
            const SizedBox(width: 12),
            CountdownBadge(
              remaining: () => store.remaining,
              onExpired: onTimeUp,
            ),
          ],
          // Only while something is pending. A permanent "saved" badge is noise; the
          // moment worth showing is the one where work is not yet safe.
          if (store.isSaving) ...[
            const SizedBox(width: 8),
            SizedBox(
              width: 12,
              height: 12,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SubmitBar extends StatelessWidget {
  const _SubmitBar({required this.store, required this.onSubmit});

  final McqStore store;
  final VoidCallback? onSubmit;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: FilledButton(
        onPressed: onSubmit,
        child: store.phase == McqPhase.submitting
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Text('Submit answers'),
      ),
    );
  }
}

class _SubmittedState extends StatelessWidget {
  const _SubmittedState();

  @override
  Widget build(BuildContext context) {
    // No score, and no hint of one. Same completion screen every other track shows —
    // see candidate_result_page.dart for the disclosure rule this follows.
    return const AppEmptyState(
      icon: Icons.check_circle_outline,
      title: 'Answers submitted',
      description:
          'Your answers have been recorded. The recruiter will be in touch once they have reviewed them.',
    );
  }
}

class _PaperView extends StatelessWidget {
  const _PaperView({required this.store});

  final McqStore store;

  @override
  Widget build(BuildContext context) {
    final paper = store.paper!;
    final children = <Widget>[];
    var number = 1;

    void addQuestions(List<McqQuestion> questions) {
      for (final question in questions) {
        children.add(_QuestionCard(store: store, question: question, number: number++));
      }
    }

    if (paper.isDivided) {
      for (final section in paper.sections) {
        children.add(_SectionHeader(section: section));
        addQuestions(paper.questionsIn(section));
      }
      // Anything the manifest did not claim. It is still on the paper and still
      // marked, so it is still shown.
      final rest = paper.unsectioned;
      if (rest.isNotEmpty) addQuestions(rest);
    } else {
      addQuestions(paper.questions);
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: children,
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.section});

  final McqSection section;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(section.name, style: theme.textTheme.titleLarge),
          if (section.instructions != null) ...[
            const SizedBox(height: 4),
            Text(
              section.instructions!,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
          if (section.passage != null) ...[
            const SizedBox(height: 10),
            // Shown ONCE above the section rather than repeated on each question —
            // a comprehension passage read four times is four times the scrolling.
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(section.passage!, style: theme.textTheme.bodyMedium),
            ),
          ],
        ],
      ),
    );
  }
}

class _QuestionCard extends StatelessWidget {
  const _QuestionCard({
    required this.store,
    required this.question,
    required this.number,
  });

  final McqStore store;
  final McqQuestion question;
  final int number;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$number.', style: theme.textTheme.titleMedium),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(question.text, style: theme.textTheme.titleMedium),
                ),
                if (store.isAnswered(question))
                  Icon(Icons.check_circle,
                      size: 18, color: theme.colorScheme.primary),
              ],
            ),
            if (question.type == McqQuestionType.multi)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  'Select all that apply.',
                  style: theme.textTheme.labelMedium
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ),
            if (question.code != null) ...[
              const SizedBox(height: 12),
              _CodeBlock(code: question.code!),
            ],
            const SizedBox(height: 12),
            if (question.isPairing)
              _PairingInput(store: store, question: question)
            else
              _ChoiceInput(store: store, question: question),
          ],
        ),
      ),
    );
  }
}

class _CodeBlock extends StatelessWidget {
  const _CodeBlock({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(10),
      ),
      // Scrolls sideways rather than wrapping: wrapped code changes what the code
      // MEANS to read, and the candidate is being marked on reading it.
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Text(code, style: const TextStyle(fontFamily: 'monospace', height: 1.4)),
      ),
    );
  }
}

class _ChoiceInput extends StatelessWidget {
  const _ChoiceInput({required this.store, required this.question});

  final McqStore store;
  final McqQuestion question;

  @override
  Widget build(BuildContext context) {
    final selected = store.selectionFor(question).toSet();
    final multi = question.type == McqQuestionType.multi;
    return Column(
      children: [
        for (final option in question.options)
          InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: () => store.choose(question, option.id),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  // Checkbox for multi, radio for single — the shape of the control is
                  // how a candidate knows how many they may pick, before they try.
                  Icon(
                    multi
                        ? (selected.contains(option.id)
                            ? Icons.check_box
                            : Icons.check_box_outline_blank)
                        : (selected.contains(option.id)
                            ? Icons.radio_button_checked
                            : Icons.radio_button_unchecked),
                    size: 20,
                    color: selected.contains(option.id)
                        ? Theme.of(context).colorScheme.primary
                        : Theme.of(context).colorScheme.outline,
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: Text(option.text)),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _PairingInput extends StatelessWidget {
  const _PairingInput({required this.store, required this.question});

  final McqStore store;
  final McqQuestion question;

  @override
  Widget build(BuildContext context) {
    final pairing = store.pairingFor(question);
    return Column(
      children: [
        for (final prompt in question.prompts)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                Expanded(flex: 4, child: Text(prompt.text)),
                const SizedBox(width: 12),
                Expanded(
                  flex: 5,
                  child: DropdownButtonFormField<String>(
                    // A dropdown rather than drag-and-drop. Dragging is nicer on a
                    // large screen and awful on a phone with a long list, and this
                    // client is mostly phones.
                    initialValue: pairing[prompt.id],
                    isExpanded: true,
                    decoration: const InputDecoration(
                      isDense: true,
                      border: OutlineInputBorder(),
                      hintText: 'Choose…',
                    ),
                    items: [
                      for (final match in question.matches)
                        DropdownMenuItem(
                          value: match.id,
                          child: Text(match.text, overflow: TextOverflow.ellipsis),
                        ),
                    ],
                    onChanged: (value) => store.pair(question, prompt.id, value),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

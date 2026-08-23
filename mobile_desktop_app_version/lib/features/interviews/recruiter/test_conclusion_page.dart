// lib/features/interviews/recruiter/test_conclusion_page.dart
//
// The last thing a recruiter does to a test: tell the people who finished it how
// it ended.
//
// Round outcomes (round_notify_page.dart) move a pipeline along — "you are
// through to the next round". Nothing closed it. A candidate who cleared every
// round was told "moving forward" and then the app went silent, because the only
// remaining step lived in the recruiter's own inbox. This screen is that step,
// and it is deliberately the same shape for a one-round test: "moving forward"
// to nothing is the identical dead end.
//
// Three decisions, one message, one list of people:
//
//   * The OUTCOME is an enum, so the candidate screen can style it and so a
//     conclusion means the same thing across every test.
//   * The MESSAGE is the recruiter's own words, prefilled and editable. This is
//     the whole point: "we'd like you to meet the team on Tuesday" is not
//     something an enum can carry, and it is what recruiters were leaving the app
//     to send by hand.
//   * WHO is ticked by hand. Nobody is pre-selected — unlike a round, where the
//     round's own advance rule wrote the bar down in advance, there is no policy
//     here to read, and pre-ticking every finished candidate would put a
//     one-tap "you cleared everything" in front of a recruiter who had decided
//     nothing.
//
// Publishing and emailing stay separate, as they are for round outcomes:
// publishing can be withdrawn, an email cannot.

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/test_conclusion.dart';
import 'package:talbotiq/features/interviews/models/test_summary.dart';
import 'package:talbotiq/features/interviews/recruiter/candidate_grouping.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/features/mailer/services/mailer_service.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';

/// Built-in templates for the two conclusions worth mailing (see backend
/// `app/templating.py`). "On hold" has none on purpose: an email that says only
/// "we have not decided" is noise, and the recruiter can still write one.
const String kTestClearedTemplateId = 'builtin:test_cleared';
const String kTestNotSelectedTemplateId = 'builtin:test_not_selected';

class TestConclusionPage extends StatefulWidget {
  final TestSummary test;

  const TestConclusionPage({super.key, required this.test});

  @override
  State<TestConclusionPage> createState() => _TestConclusionPageState();
}

class _TestConclusionPageState extends State<TestConclusionPage> {
  /// Every candidate of the test, as runs. Loaded once: this is a decision
  /// screen, and a live stream reshuffling rows under a half-made selection
  /// would be hostile.
  List<CandidateRun> _runs = const [];

  /// How many rounds the test's timeline has, or 0 when it has none.
  ///
  /// Only used to caution that a ticked candidate finished fewer rounds than the
  /// test holds — which is normal in a pipeline (they were never assigned the
  /// rest) but is also exactly what a premature conclusion looks like.
  int _roundCount = 0;

  final Set<String> _selected = {};

  TestOutcome _outcome = TestOutcome.cleared;
  final _messageCtrl = TextEditingController();

  /// True once the recruiter has typed in the message box. Switching outcome
  /// re-prefills the default only while this is false — replacing something they
  /// wrote would lose it silently.
  bool _messageEdited = false;

  bool _loading = true;
  bool _busy = false;
  Object? _error;

  final _mailer = MailerService();

  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';
  String get _recruiterEmail => FirebaseAuth.instance.currentUser?.email ?? '';

  @override
  void initState() {
    super.initState();
    _messageCtrl.text = _outcome.defaultMessage(widget.test.title);
    _messageCtrl.addListener(_onMessageChanged);
    _load();
  }

  @override
  void dispose() {
    _messageCtrl.removeListener(_onMessageChanged);
    _messageCtrl.dispose();
    super.dispose();
  }

  void _onMessageChanged() {
    if (_messageEdited) return;
    // Compared against the current default rather than tracking keystrokes: the
    // prefill itself fires this listener, and so does switching outcome.
    if (_messageCtrl.text != _outcome.defaultMessage(widget.test.title)) {
      _messageEdited = true;
    }
  }

  Future<void> _load() async {
    final repo = context.read<InterviewRepository>();
    try {
      final assignments = await repo.fetchTestAssignments(
          testId: widget.test.testId, recruiterId: _uid);
      final rounds = await repo.fetchRounds(
          testId: widget.test.testId, recruiterId: _uid);
      if (!mounted) return;
      setState(() {
        _runs = runsFor(assignments);
        _roundCount = rounds.length;
        // Anyone who has since become ineligible drops out of the selection
        // rather than being published to invisibly.
        _selected.removeWhere((email) => !_finished.any((r) => r.emailLower == email));
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  /// Everyone who has been TOLD something, by outcome.
  ///
  /// The list a recruiter comes back for: once results are out, "who did we
  /// select" is the question, and re-deriving it by reading a tick-list is not an
  /// answer. Read off the runs rather than tracked separately, so it cannot drift
  /// from what was actually published.
  List<CandidateRun> _publishedWith(TestOutcome outcome) => _runs
      .where((r) => r.conclusion?.outcome == outcome)
      .toList();

  List<CandidateRun> get _selectedCandidates =>
      _publishedWith(TestOutcome.cleared);

  /// Candidates with nothing left to sit — see [CandidateRun.isFinished].
  List<CandidateRun> get _finished =>
      _runs.where((r) => r.isFinished).toList();

  /// Still mid-run, so listing them would offer to conclude a test they are in
  /// the middle of. Counted in the footer instead.
  int get _stillRunning => _runs.length - _finished.length;

  List<CandidateRun> get _chosen =>
      _finished.where((r) => _selected.contains(r.emailLower)).toList();

  /// Every document to write: each chosen candidate's rounds, flattened.
  List<Interview> get _chosenAssignments =>
      [for (final run in _chosen) ...run.rounds];

  /// Chosen candidates who finished fewer rounds than the test has.
  ///
  /// Normal in a pipeline — they were never assigned the later rounds — but it is
  /// also what concluding somebody too early looks like, so it is said out loud
  /// rather than assumed either way.
  List<CandidateRun> get _shortOfFullPipeline => _roundCount <= 1
      ? const []
      : _chosen.where((r) => r.rounds.length < _roundCount).toList();

  void _setOutcome(TestOutcome outcome) {
    setState(() {
      _outcome = outcome;
      if (!_messageEdited) {
        _messageCtrl.text = outcome.defaultMessage(widget.test.title);
      }
    });
  }

  // ── Publishing ────────────────────────────────────────────────────────────

  Future<void> _publish() async {
    if (_busy || _chosen.isEmpty) return;
    final chosen = _chosen;
    final assignments = _chosenAssignments;
    final replacing = chosen.where((r) => r.hasConclusion).length;
    final short = _shortOfFullPipeline;

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Tell ${chosen.length} candidate(s) "'
            '${_outcome.candidateLabel}"?'),
        content: SingleChildScrollView(
          child: Text(
            [
              'They will see this on their interviews screen straight away, '
              'with your message and nothing else — no score, no ranking, and '
              'none of the AI write-up.',
              if (_messageCtrl.text.trim().isEmpty)
                'You have not written a message, so they will see the outcome '
                    'on its own.',
              if (replacing > 0)
                '$replacing of them already have a conclusion. It will be '
                    'replaced.',
              if (short.isNotEmpty)
                '⚠ ${short.length} of them finished fewer than $_roundCount '
                    'rounds. If they are still waiting on a round you have not '
                    'assigned yet, this ends their process early.',
              'No email is sent by this. Publishing can be withdrawn.',
            ].join('\n\n'),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Publish')),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _busy = true);
    try {
      final written = await context.read<InterviewRepository>().publishConclusion(
            assignments: assignments,
            conclusion: TestConclusion(
              outcome: _outcome,
              message: _messageCtrl.text,
              publishedByName: _recruiterDisplayName,
            ),
          );
      if (!mounted) return;
      await _load();
      if (!mounted) return;
      setState(() => _busy = false);
      // Both numbers, because they differ: one candidate is several documents.
      _toast('Published to ${chosen.length} candidate(s) '
          '($written round record(s) updated).');
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast('Could not publish: $e');
    }
  }

  Future<void> _withdraw() async {
    if (_busy) return;
    final published = _chosen.where((r) => r.hasConclusion).toList();
    if (published.isEmpty) {
      _toast('None of the ticked candidates has a published conclusion.');
      return;
    }

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Withdraw ${published.length} conclusion(s)?'),
        content: const Text(
          'The conclusion disappears from their screen and their rounds are '
          'left as they were.\n\n'
          'It cannot un-send an email, and it cannot un-read what somebody has '
          'already seen.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Withdraw',
                style: TextStyle(color: Theme.of(ctx).colorScheme.error)),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _busy = true);
    try {
      await context
          .read<InterviewRepository>()
          .clearConclusion([for (final run in published) ...run.rounds]);
      if (!mounted) return;
      await _load();
      if (!mounted) return;
      setState(() => _busy = false);
      _toast('Withdrawn from ${published.length} candidate(s).');
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast('Could not withdraw: $e');
    }
  }

  // ── Emailing ──────────────────────────────────────────────────────────────

  /// The template for the current outcome, or null when there is none to send.
  String? get _templateId {
    switch (_outcome) {
      case TestOutcome.cleared:
        return kTestClearedTemplateId;
      case TestOutcome.notSelected:
        return kTestNotSelectedTemplateId;
      case TestOutcome.onHold:
        return null;
    }
  }

  Future<void> _email() async {
    final templateId = _templateId;
    if (_busy || _chosen.isEmpty || templateId == null) return;

    if (!_mailer.isConfigured) {
      _toast('No mail server is configured, so nothing can be sent.');
      return;
    }
    if (_recruiterEmail.isEmpty) {
      _toast('Your account has no email address, so mail cannot be sent.');
      return;
    }

    final group = _chosen;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Email ${group.length} candidate(s)?'),
        content: Text(
          'This sends the "${_outcome.recruiterLabel.toLowerCase()}" email now, '
          'with your message inside it. It cannot be unsent.\n\n'
          'To: ${group.take(3).map((r) => r.email).join(', ')}'
          '${group.length > 3 ? ' and ${group.length - 3} more' : ''}',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Send')),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _busy = true);
    try {
      final report = await _mailer.send(
        ownerEmail: _recruiterEmail,
        templateId: templateId,
        sharedContext: {
          'interview_title': widget.test.title,
          'recruiter_name': _recruiterDisplayName,
          'company': _recruiterDisplayName,
          // The same words they will read in the app, so the two cannot
          // disagree. Empty is fine — the template renders without it.
          'recruiter_message': _messageCtrl.text.trim(),
        },
        recipients: [
          for (final run in group)
            MailRecipient(email: run.email, name: run.name),
        ],
      );
      if (!mounted) return;
      setState(() => _busy = false);
      // DRY_RUN is the backend default, so "sent" has to be reported honestly —
      // telling a recruiter their rejections went out when nothing left the
      // building is the worst thing to get wrong here.
      if (report.provider == 'dry_run') {
        _toast('Nothing was actually sent: the mail server is in dry-run mode. '
            '${report.total} email(s) were logged on the server only.');
      } else if (report.failed == 0) {
        _toast('Sent to ${report.sent} candidate(s).');
      } else {
        _toast('Sent ${report.sent}, failed ${report.failed}.');
      }
    } on MailerException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast(e.message);
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      _toast('Could not send: $e');
    }
  }

  String get _recruiterDisplayName {
    final user = FirebaseAuth.instance.currentUser;
    final name = user?.displayName?.trim();
    if (name != null && name.isNotEmpty) return name;
    final email = user?.email ?? '';
    final at = email.indexOf('@');
    return at > 0 ? email.substring(0, at) : 'the recruiter';
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RecruiterScaffold(
      appBar: AppBar(
        title: const Text('Final result'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(20),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              widget.test.title,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
        ),
      ),
      body: _body(theme),
      bottomNavigationBar:
          _loading || _finished.isEmpty ? null : _actions(theme),
    );
  }

  Widget _body(ThemeData theme) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return AppMessageState(
        icon: Icons.error_outline,
        title: 'Could not load the candidates',
        subtitle: '$_error',
      );
    }
    final finished = _finished;
    if (finished.isEmpty) {
      return AppMessageState(
        icon: Icons.flag_outlined,
        title: 'Nobody has finished yet',
        subtitle: _runs.isEmpty
            ? 'Assign this pipeline to a candidate to get started.'
            : '${_runs.length} candidate(s) are in this pipeline, but every one of '
                'them still has a round to sit. A conclusion can be released '
                'once somebody has nothing left to do.',
      );
    }

    // The published results come FIRST, above the tick-list: after a publish this
    // screen is read far more often than it is used, and the answer to "who got
    // through" should not be below a form.
    final results = _resultsPanel(theme);
    final offset = results == null ? 1 : 2;

    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      itemCount: finished.length + offset + 1,
      itemBuilder: (context, index) {
        if (results != null && index == 0) return results;
        if (index == offset - 1) return _explainer(theme, finished.length);
        if (index == finished.length + offset) return _messageCard(theme);
        return _candidateRow(theme, finished[index - offset]);
      },
    );
  }

  /// Who has been told what, once anything has been published. Null before that.
  ///
  /// Names the selected candidates in full rather than counting them: a recruiter
  /// acting on this list is about to email or call those people, and a number
  /// sends them back to the tick-list to work out which ones. The other two
  /// outcomes are counted, because nobody chases them.
  Widget? _resultsPanel(ThemeData theme) {
    final selected = _selectedCandidates;
    final rejected = _publishedWith(TestOutcome.notSelected).length;
    final onHold = _publishedWith(TestOutcome.onHold).length;
    if (selected.isEmpty && rejected == 0 && onHold == 0) return null;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: RecruiterPanel(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.emoji_events_outlined,
                    size: 16, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Selected · ${selected.length}',
                    style: theme.textTheme.titleSmall
                        ?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                if (selected.isNotEmpty)
                  IconButton(
                    tooltip: 'Copy their email addresses',
                    icon: const Icon(Icons.copy_all_outlined, size: 18),
                    onPressed: () => _copyEmails(selected),
                  ),
              ],
            ),
            if (selected.isEmpty)
              Text(
                'Nobody has been marked as cleared yet.',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              )
            else
              for (final run in selected)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Row(
                    children: [
                      Icon(Icons.check_circle_outline,
                          size: 15, color: theme.colorScheme.primary),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          run.displayName == run.email
                              ? run.email
                              : '${run.displayName} · ${run.email}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                      Text(
                        '${run.rounds.length} round'
                        '${run.rounds.length == 1 ? '' : 's'}',
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
            if (rejected > 0 || onHold > 0) ...[
              const Divider(height: 22),
              Text(
                [
                  if (rejected > 0) '$rejected not selected',
                  if (onHold > 0) '$onHold on hold',
                ].join(' · '),
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// Puts the selected candidates' addresses on the clipboard.
  ///
  /// The next thing a recruiter does with this list is write to those people, and
  /// often not from this app.
  Future<void> _copyEmails(List<CandidateRun> runs) async {
    final joined = runs.map((r) => r.email).join(', ');
    await Clipboard.setData(ClipboardData(text: joined));
    if (!mounted) return;
    _toast('Copied ${runs.length} email address(es).');
  }

  Widget _explainer(ThemeData theme, int total) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: RecruiterPanel(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.flag_outlined,
                      size: 16, color: theme.colorScheme.primary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text('${_selected.length} of $total selected',
                        style: theme.textTheme.titleSmall
                            ?.copyWith(fontWeight: FontWeight.w600)),
                  ),
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () => setState(() {
                              if (_selected.length == total) {
                                _selected.clear();
                              } else {
                                _selected
                                  ..clear()
                                  ..addAll(_finished.map((r) => r.emailLower));
                              }
                            }),
                    child:
                        Text(_selected.length == total ? 'Clear all' : 'Select all'),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                'Everyone listed has finished every round assigned to them. Tick '
                'who this result is for — nobody is pre-selected, because there '
                'is no rule that can decide this for you.',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
              if (_stillRunning > 0) ...[
                const SizedBox(height: 8),
                Text(
                  '$_stillRunning candidate(s) are still mid-pipeline and are not '
                  'listed.',
                  style: theme.textTheme.bodySmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                ),
              ],
            ],
          ),
        ),
      );

  Widget _candidateRow(ThemeData theme, CandidateRun run) {
    final selected = _selected.contains(run.emailLower);
    final published = run.conclusion;
    final rounds = run.rounds.length;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: RecruiterPanel(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: CheckboxListTile(
          value: selected,
          onChanged: _busy
              ? null
              : (v) => setState(() {
                    if (v == true) {
                      _selected.add(run.emailLower);
                    } else {
                      _selected.remove(run.emailLower);
                    }
                  }),
          controlAffinity: ListTileControlAffinity.leading,
          title: Text(run.displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(fontWeight: FontWeight.w600)),
          subtitle: Text(
            '$rounds round${rounds == 1 ? '' : 's'} completed'
            '${run.displayName == run.email ? '' : ' · ${run.email}'}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          // What they have ALREADY been told, so a second publish is a
          // deliberate change rather than a surprise.
          secondary: published == null
              ? Icon(Icons.remove, size: 16, color: theme.colorScheme.outline)
              : _outcomeChip(theme, published.outcome),
        ),
      ),
    );
  }

  Widget _outcomeChip(ThemeData theme, TestOutcome outcome) {
    final color = switch (outcome) {
      TestOutcome.cleared => theme.colorScheme.primary,
      // Not error-red: this is a decision, not a fault.
      TestOutcome.notSelected => theme.colorScheme.onSurfaceVariant,
      TestOutcome.onHold => theme.colorScheme.secondary,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        outcome.recruiterLabel,
        style: TextStyle(
            fontSize: 10, fontWeight: FontWeight.w600, color: color),
      ),
    );
  }

  Widget _messageCard(ThemeData theme) {
    final short = _shortOfFullPipeline;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: RecruiterPanel(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('What they are told',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            // Scrollable rather than fixed: three labels this long overflow a
            // narrow phone once the system font is scaled up, and an overflowing
            // SegmentedButton hides the option on the end.
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SegmentedButton<TestOutcome>(
                segments: [
                  for (final outcome in TestOutcome.values)
                    ButtonSegment(
                        value: outcome, label: Text(outcome.recruiterLabel)),
                ],
                selected: {_outcome},
                onSelectionChanged: _busy ? null : (s) => _setOutcome(s.first),
                showSelectedIcon: false,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'They read this as "${_outcome.candidateLabel}".',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _messageCtrl,
              maxLines: 5,
              minLines: 3,
              enabled: !_busy,
              decoration: const InputDecoration(
                labelText: 'Your message to them',
                hintText: 'e.g. Congratulations — we will call you this week '
                    'to arrange the final chat.',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Prefilled — edit it freely. It is shown as written, and it is the '
              'only thing on the screen besides the outcome above.',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            if (short.isNotEmpty) ...[
              const SizedBox(height: 12),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.warning_amber_outlined,
                      size: 15, color: theme.colorScheme.error),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '${short.length} selected candidate(s) finished fewer '
                      'than $_roundCount rounds. That is normal if they were '
                      'never assigned the rest — but if a round is still coming '
                      'for them, this ends their process early.',
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: theme.colorScheme.error),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _actions(ThemeData theme) {
    final chosen = _chosen.length;
    final withdrawable = _chosen.where((r) => r.hasConclusion).length;
    final canEmail = _templateId != null;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_busy)
              const Padding(
                padding: EdgeInsets.only(bottom: 10),
                child: LinearProgressIndicator(minHeight: 3),
              ),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: (_busy || chosen == 0) ? null : _publish,
                icon: const Icon(Icons.publish_outlined, size: 18),
                label: Text(chosen == 0
                    ? 'Select candidates to publish to'
                    : 'Publish to $chosen candidate(s)'),
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed:
                        (_busy || chosen == 0 || !canEmail) ? null : _email,
                    icon: const Icon(Icons.mail_outline, size: 18),
                    label: Text(canEmail
                        ? 'Email them ($chosen)'
                        : 'No email for "on hold"'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed:
                        (_busy || withdrawable == 0) ? null : _withdraw,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: theme.colorScheme.error,
                    ),
                    icon: const Icon(Icons.undo, size: 18),
                    label: Text('Withdraw ($withdrawable)'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'Publishing shows it in the app. Emailing is separate, and cannot '
              'be undone.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

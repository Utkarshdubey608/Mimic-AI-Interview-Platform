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

import 'package:talbotiq/features/interviews/models/interview_round.dart';
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

  /// The test's timeline, so this screen knows whether the pipeline has actually
  /// finished — and, if it has, what the last round decided.
  List<InterviewRound> _rounds = const [];

  /// Ticked = cleared the process. Pre-filled from the last round's own decision
  /// (see [_prefill]) rather than left empty: by the time a recruiter is here,
  /// the pipeline has already said who got through, and making them re-tick that
  /// list by hand was both work and a chance to get it wrong.
  final Set<String> _selected = {};

  /// Parked: neither cleared nor rejected. The rare case, kept because a
  /// recruiter who has not decided must not be forced to pick one of two lies.
  final Set<String> _onHold = {};

  /// One message per group, because "we would like you to meet the team" and
  /// "thank you for your time" are never the same sentence — the same reason
  /// `round_notify_page.dart` keeps two.
  final _clearedMsgCtrl = TextEditingController();
  final _notSelectedMsgCtrl = TextEditingController();

  /// True once the recruiter has moved anybody. The pre-fill is only applied
  /// while this is false, so a reload after publishing cannot overwrite a
  /// half-made decision.
  bool _touched = false;

  bool _loading = true;
  bool _busy = false;
  Object? _error;

  final _mailer = MailerService();

  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';
  String get _recruiterEmail => FirebaseAuth.instance.currentUser?.email ?? '';

  @override
  void initState() {
    super.initState();
    _clearedMsgCtrl.text =
        TestOutcome.cleared.defaultMessage(widget.test.title);
    _notSelectedMsgCtrl.text =
        TestOutcome.notSelected.defaultMessage(widget.test.title);
    _load();
  }

  @override
  void dispose() {
    _clearedMsgCtrl.dispose();
    _notSelectedMsgCtrl.dispose();
    super.dispose();
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
        _rounds = rounds;
        _loading = false;
        if (!_touched) _prefill();
        // Anyone who has since become ineligible drops out of the selection
        // rather than being published to invisibly.
        final eligible = {for (final r in _finished) r.emailLower};
        _selected.removeWhere((email) => !eligible.contains(email));
        _onHold.removeWhere((email) => !eligible.contains(email));
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  /// Starts the decision from the pipeline's own answer.
  ///
  /// Whoever the last round they sat ADVANCED is ticked as cleared; everybody
  /// else who is finished is a rejection. That is not a guess — it is what the
  /// recruiter already decided on the round screen, carried forward instead of
  /// being asked for twice. Anybody already published keeps what they were told,
  /// so re-opening this screen shows the state of the world rather than
  /// proposing to change it.
  void _prefill() {
    _selected.clear();
    _onHold.clear();
    conclusionPrefill(_finished).forEach((email, outcome) {
      switch (outcome) {
        case TestOutcome.cleared:
          _selected.add(email);
        case TestOutcome.onHold:
          _onHold.add(email);
        case TestOutcome.notSelected:
          break;
      }
    });
  }

  /// The last round of the timeline, or null for a test with no timeline.
  InterviewRound? get _lastRound {
    if (_rounds.isEmpty) return null;
    final ordered = [..._rounds]..sort((a, b) => a.order.compareTo(b.order));
    return ordered.last;
  }

  /// The final result is a statement that the process is over, so it waits for
  /// the process to be over: while the last round is still open, people can
  /// still submit and the recruiter has not decided that round yet.
  ///
  /// Null when there is nothing to wait for — no timeline, or the last round has
  /// closed.
  InterviewRound? get _blockingRound {
    final last = _lastRound;
    if (last == null) return null;
    return last.stateAt(DateTime.now()) == RoundState.closed ? null : last;
  }

  /// How many rounds the test's timeline has, or 0 when it has none.
  int get _roundCount => _rounds.length;

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

  /// Candidates with nothing left to sit — see [CandidateRun.isFinishedAt].
  ///
  /// One clock for the whole getter, so two rows cannot disagree about whether a
  /// deadline has passed while the list is being built.
  List<CandidateRun> get _finished {
    final now = DateTime.now();
    return _runs.where((r) => r.isFinishedAt(now)).toList();
  }

  /// The three groups this screen publishes, in the order it shows them.
  List<CandidateRun> get _clearedGroup =>
      _finished.where((r) => _selected.contains(r.emailLower)).toList();

  List<CandidateRun> get _notSelectedGroup => _finished
      .where((r) =>
          !_selected.contains(r.emailLower) && !_onHold.contains(r.emailLower))
      .toList();

  List<CandidateRun> get _onHoldGroup =>
      _finished.where((r) => _onHold.contains(r.emailLower)).toList();

  List<CandidateRun> _groupFor(TestOutcome outcome) => switch (outcome) {
        TestOutcome.cleared => _clearedGroup,
        TestOutcome.notSelected => _notSelectedGroup,
        TestOutcome.onHold => _onHoldGroup,
      };

  /// Which group a candidate is currently in.
  TestOutcome _outcomeOf(CandidateRun run) {
    if (_selected.contains(run.emailLower)) return TestOutcome.cleared;
    if (_onHold.contains(run.emailLower)) return TestOutcome.onHold;
    return TestOutcome.notSelected;
  }

  /// The recruiter's own words for [outcome]. "On hold" has none: an email that
  /// says only "we have not decided" is noise, and nothing is published for it
  /// beyond the outcome itself.
  String _messageFor(TestOutcome outcome) => switch (outcome) {
        TestOutcome.cleared => _clearedMsgCtrl.text,
        TestOutcome.notSelected => _notSelectedMsgCtrl.text,
        TestOutcome.onHold => '',
      };

  void _setOutcomeOf(CandidateRun run, TestOutcome outcome) {
    setState(() {
      _touched = true;
      _selected.remove(run.emailLower);
      _onHold.remove(run.emailLower);
      switch (outcome) {
        case TestOutcome.cleared:
          _selected.add(run.emailLower);
        case TestOutcome.onHold:
          _onHold.add(run.emailLower);
        case TestOutcome.notSelected:
          break;
      }
    });
  }

  /// Still mid-run, so listing them would offer to conclude a test they are in
  /// the middle of. Counted in the footer instead.
  int get _stillRunning => _runs.length - _finished.length;

  /// Everybody this screen is about to publish to: all three groups. The whole
  /// finished set, because a final result that covered only the people who got
  /// through is exactly the silence this screen exists to end.
  List<CandidateRun> get _chosen => _finished;

  /// Chosen candidates who finished fewer rounds than the test has.
  ///
  /// Normal in a pipeline — they were never assigned the later rounds — but it is
  /// also what concluding somebody too early looks like, so it is said out loud
  /// rather than assumed either way.
  List<CandidateRun> get _shortOfFullPipeline => _roundCount <= 1
      ? const []
      : _clearedGroup.where((r) => r.rounds.length < _roundCount).toList();


  // ── Publishing ────────────────────────────────────────────────────────────

  /// Publishes every group at once, each with its own message.
  ///
  /// One action, not three: the decision is "here is how this pipeline ended",
  /// and telling the people who got through while leaving the rest on "under
  /// review" is the silence this screen was built to end. Groups that are empty
  /// are simply skipped.
  Future<void> _publish() async {
    if (_busy || _chosen.isEmpty) return;
    final cleared = _clearedGroup;
    final rejected = _notSelectedGroup;
    final held = _onHoldGroup;
    final replacing = _chosen.where((r) => r.hasConclusion).length;
    final short = _shortOfFullPipeline;

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Publish the result to ${_chosen.length} candidate(s)?'),
        content: SingleChildScrollView(
          child: Text(
            [
              [
                if (cleared.isNotEmpty) '${cleared.length} cleared',
                if (rejected.isNotEmpty) '${rejected.length} not selected',
                if (held.isNotEmpty) '${held.length} on hold',
              ].join(' · '),
              'They will see this on their interviews screen straight away, '
              'with your message and nothing else — no score, no ranking, and '
              'none of the AI write-up.',
              if (cleared.isNotEmpty && _clearedMsgCtrl.text.trim().isEmpty)
                'The cleared candidates have no message, so they will see the '
                    'outcome on its own.',
              if (rejected.isNotEmpty && _notSelectedMsgCtrl.text.trim().isEmpty)
                'The not-selected candidates have no message, so they will see '
                    'the outcome on its own.',
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
      final repo = context.read<InterviewRepository>();
      var written = 0;
      // Group by group, each carrying its own words. Sequential rather than
      // concurrent: these are batched writes to the same collection, and a
      // half-failed publish is easier to reason about in a known order.
      for (final outcome in TestOutcome.values) {
        final group = _groupFor(outcome);
        if (group.isEmpty) continue;
        written += await repo.publishConclusion(
          assignments: [for (final run in group) ...run.rounds],
          conclusion: TestConclusion(
            outcome: outcome,
            message: _messageFor(outcome),
            publishedByName: _recruiterDisplayName,
          ),
        );
      }
      if (!mounted) return;
      await _load();
      if (!mounted) return;
      setState(() => _busy = false);
      // Both numbers, because they differ: one candidate is several documents.
      _toast('Published to ${_chosen.length} candidate(s) '
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

  /// The template for [outcome], or null when there is none to send.
  String? _templateFor(TestOutcome outcome) {
    switch (outcome) {
      case TestOutcome.cleared:
        return kTestClearedTemplateId;
      case TestOutcome.notSelected:
        return kTestNotSelectedTemplateId;
      case TestOutcome.onHold:
        return null;
    }
  }

  /// Emails ONE group, with that group's own message.
  ///
  /// One group per action, each confirmed on its own — the same rule
  /// `round_notify_page.dart` follows. A single "email everybody" button would
  /// send congratulations and rejections in one keystroke, and there is no undo
  /// for either.
  Future<void> _email(TestOutcome outcome) async {
    final templateId = _templateFor(outcome);
    final group = _groupFor(outcome);
    if (_busy || group.isEmpty || templateId == null) return;

    if (!_mailer.isConfigured) {
      _toast('No mail server is configured, so nothing can be sent.');
      return;
    }
    if (_recruiterEmail.isEmpty) {
      _toast('Your account has no email address, so mail cannot be sent.');
      return;
    }

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Email ${group.length} candidate(s)?'),
        content: Text(
          'This sends the "${outcome.recruiterLabel.toLowerCase()}" email now, '
          'with that group\'s message inside it. It cannot be unsent.\n\n'
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
          'recruiter_message': _messageFor(outcome).trim(),
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
      // No action bar while the pipeline is still running or there is nobody to
      // conclude — a disabled row of buttons reads as something being broken.
      bottomNavigationBar:
          _loading || _blockingRound != null || _finished.isEmpty
              ? null
              : _actions(theme),
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
    // The gate. A final result is the statement that the process is over, so it
    // waits for the last round to close: while it is open people can still
    // submit, and the round itself has not been decided.
    final blocking = _blockingRound;
    if (blocking != null) {
      return AppMessageState(
        icon: Icons.lock_clock,
        title: '"${blocking.title}" is still open',
        subtitle: 'The final result is what you tell people once the pipeline '
            'is over, so it unlocks when the last round closes — by its '
            'deadline, or when you end it from the timeline.\n\n'
            'Ending that round is also where you choose who advances, and this '
            'screen starts from that decision.',
      );
    }

    final finished = _finished;
    if (finished.isEmpty) {
      return AppMessageState(
        icon: Icons.flag_outlined,
        title: 'Nobody to conclude yet',
        subtitle: _runs.isEmpty
            ? 'Add candidates to this pipeline to get started.'
            : '${_runs.length} candidate(s) are in this pipeline, but every one of '
                'them still has an open round to sit. A conclusion can be '
                'released once somebody has nothing left to do.',
      );
    }

    // The published results come FIRST, above the decision: after a publish this
    // screen is read far more often than it is used, and the answer to "who got
    // through" should not be below a form.
    //
    // Then the three groups, each behind its own heading, in the order the
    // recruiter thinks about them. Built as a flat list of widgets rather than
    // an index-arithmetic builder: with three sections plus two message cards,
    // the arithmetic is where the bugs live, and a finished pipeline is a
    // page-sized list, not a thousand rows.
    final results = _resultsPanel(theme);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: [
        if (results != null) results,
        _explainer(theme, finished.length),
        for (final outcome in TestOutcome.values)
          ..._section(theme, outcome),
      ],
    );
  }

  /// One group: its heading, its candidates, and its message box under them.
  List<Widget> _section(ThemeData theme, TestOutcome outcome) {
    final group = _groupFor(outcome);
    // An empty "on hold" section is nothing to show. The other two are shown
    // even when empty, because "0 cleared" is a fact the recruiter must see
    // before publishing — an invisible section reads as one that does not exist.
    if (group.isEmpty && outcome == TestOutcome.onHold) return const [];

    return [
      _sectionHeader(theme, outcome, group.length),
      for (final run in group) _candidateRow(theme, run),
      if (group.isEmpty)
        Padding(
          padding: const EdgeInsets.only(bottom: 8, left: 4),
          child: Text(
            outcome == TestOutcome.cleared
                ? 'Nobody is being cleared. Move somebody up if that is wrong.'
                : 'Nobody is being turned down.',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
        ),
      if (outcome != TestOutcome.onHold && group.isNotEmpty)
        _messageCard(theme, outcome),
    ];
  }

  Widget _sectionHeader(ThemeData theme, TestOutcome outcome, int count) {
    final color = _outcomeColor(theme, outcome);
    return Padding(
      padding: const EdgeInsets.only(top: 14, bottom: 8),
      child: Row(
        children: [
          Container(width: 8, height: 8,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              '${outcome.recruiterLabel.toUpperCase()} · $count',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.0,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _outcomeColor(ThemeData theme, TestOutcome outcome) => switch (outcome) {
        TestOutcome.cleared => theme.colorScheme.primary,
        // Not error-red: this is a decision, not a fault.
        TestOutcome.notSelected => theme.colorScheme.onSurfaceVariant,
        TestOutcome.onHold => theme.colorScheme.secondary,
      };

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

  /// Where the two groups came from, in words.
  ///
  /// Said explicitly because a pre-ticked list of people about to be told "not
  /// selected" must never look like the app's own opinion: it is the recruiter's
  /// own round decision, read back to them.
  String get _prefillExplanation {
    final last = _lastRound;
    final advanced = _finished.where((r) => r.advancedFromLastRound).length;
    if (last == null) {
      return 'Everyone listed has nothing left to sit. Move anybody between the '
          'groups, then publish.';
    }
    if (advanced == 0) {
      return '"${last.title}" has not advanced anybody, so nobody starts as '
          'cleared. Move whoever got through up, then publish.';
    }
    return 'Pre-filled from your own decision in "${last.title}": the '
        '$advanced it advanced are cleared, everyone else is not selected. '
        'Move anybody either way.';
  }

  /// Throws away the edits and goes back to what the rounds decided.
  void _resetToPipeline() => setState(() {
        _touched = false;
        _prefill();
      });

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
                    child: Text('${_selected.length} cleared of $total',
                        style: theme.textTheme.titleSmall
                            ?.copyWith(fontWeight: FontWeight.w600)),
                  ),
                  TextButton(
                    onPressed: _busy || !_touched ? null : _resetToPipeline,
                    child: const Text('Reset'),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                _prefillExplanation,
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
    final published = run.conclusion;
    final current = _outcomeOf(run);
    final sat = run.completedRounds;
    final held = run.rounds.length;

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: RecruiterPanel(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        child: ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(run.displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(fontWeight: FontWeight.w600)),
          // Sat, not just held: with a closed round these differ, and "2 of 3
          // rounds sat" is the honest reading for somebody who ran out of time.
          subtitle: Text(
            sat == held
                ? '$held round${held == 1 ? '' : 's'} sat'
                : '$sat of $held rounds sat',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              // What they have ALREADY been told, so a second publish is a
              // deliberate change rather than a surprise.
              if (published != null) _outcomeChip(theme, published.outcome),
              PopupMenuButton<TestOutcome>(
                tooltip: 'Move to another group',
                enabled: !_busy,
                icon: const Icon(Icons.swap_vert_rounded, size: 20),
                onSelected: (o) => _setOutcomeOf(run, o),
                itemBuilder: (_) => [
                  for (final o in TestOutcome.values)
                    if (o != current)
                      PopupMenuItem(
                        value: o,
                        child: Text('Move to ${o.recruiterLabel.toLowerCase()}'),
                      ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _outcomeChip(ThemeData theme, TestOutcome outcome) {
    final color = _outcomeColor(theme, outcome);
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

  /// The words ONE group is sent, under that group's rows.
  ///
  /// Two boxes rather than one shared box and an outcome switch: the recruiter
  /// is writing to two sets of people in the same sitting, and a single field
  /// that re-prefilled itself when they changed groups lost whatever they had
  /// already typed for the other one.
  Widget _messageCard(ThemeData theme, TestOutcome outcome) {
    final cleared = outcome == TestOutcome.cleared;
    final short = cleared ? _shortOfFullPipeline : const <CandidateRun>[];
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 8),
      child: RecruiterPanel(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('What the ${outcome.recruiterLabel.toLowerCase()} group is told',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Text(
              'They read the outcome as "${outcome.candidateLabel}".',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 14),
            TextField(
              controller:
                  cleared ? _clearedMsgCtrl : _notSelectedMsgCtrl,
              maxLines: 5,
              minLines: 3,
              enabled: !_busy,
              decoration: InputDecoration(
                labelText: 'Your message to them',
                hintText: cleared
                    ? 'e.g. Congratulations — we will call you this week to '
                        'arrange the final chat.'
                    : 'e.g. Thank you for the time you gave us — we have '
                        'decided not to go ahead this time.',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Prefilled — edit it freely. It is shown as written, and it is the '
              'only thing they see besides the outcome.',
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
    final cleared = _clearedGroup.length;
    final rejected = _notSelectedGroup.length;

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
                    ? 'Nobody to publish to'
                    : 'Publish the result · $cleared cleared, '
                        '$rejected not selected'),
              ),
            ),
            const SizedBox(height: 10),
            // One send per group, each confirmed on its own: a single button
            // would put congratulations and rejections one keystroke apart, and
            // neither can be unsent.
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: (_busy || cleared == 0)
                        ? null
                        : () => _email(TestOutcome.cleared),
                    icon: const Icon(Icons.mail_outline, size: 18),
                    label: Text('Email cleared ($cleared)'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: (_busy || rejected == 0)
                        ? null
                        : () => _email(TestOutcome.notSelected),
                    icon: const Icon(Icons.mail_outline, size: 18),
                    label: Text('Email the rest ($rejected)'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: (_busy || withdrawable == 0) ? null : _withdraw,
                style: OutlinedButton.styleFrom(
                  foregroundColor: theme.colorScheme.error,
                ),
                icon: const Icon(Icons.undo, size: 18),
                label: Text('Withdraw ($withdrawable)'),
              ),
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

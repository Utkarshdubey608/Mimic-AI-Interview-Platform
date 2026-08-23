// lib/features/interviews/recruiter/round_timeline_page.dart
//
// The recruiter's timeline for ONE test: the ordered rounds, their status, and
// the operational actions for each.
//
// A test's STRUCTURE is fixed once it is created. There is no add, no delete and
// no reorder here — those belong to the multi-round builder in
// create_interview_page.dart, before anybody has been assigned. Changing the
// shape of a pipeline candidates are already moving through means someone is
// mid-round in a stage that no longer exists. What IS editable is each round's
// CONFIGURATION: tap a step to open it.
//
// Live, not fetched once: an "End round now" from another device (or a colleague)
// has to show up here, because the whole point of a status chip is that it is
// true. Round state itself is never read from a field — it is derived from the
// clock by `InterviewRound.stateAt`, so a round that passes its deadline while
// this screen is open closes on the next rebuild without anything being written.
//
// Per-round candidate counts come from count() aggregates, matching how
// test_candidates_page.dart shows totals: cheap, and impossible to leave stale.

import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/status_tones.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/models/test_summary.dart';
import 'package:talbotiq/features/interviews/recruiter/create_interview_page.dart';
import 'package:talbotiq/features/interviews/recruiter/round_leaderboard_page.dart';
import 'package:talbotiq/features/interviews/recruiter/round_notify_page.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/add_candidates_sheet.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/end_round_preview_sheet.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/round_step_tile.dart';
import 'package:talbotiq/features/interviews/recruiter/test_candidates_page.dart';
import 'package:talbotiq/features/interviews/recruiter/test_conclusion_page.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

/// Which round of [rounds] the pipeline is currently on, at [now].
///
/// The earliest OPEN round, because that is the one candidates are acting on. With
/// none open the pipeline is between stages, so the next one due to open is what
/// the recruiter is waiting for. All closed → nothing is current.
///
/// Top-level and clock-injected for the same reason `roundStateLabel` is: it is a
/// statement about the test that has to be right, and testable without a widget.
String? activeRoundId(List<InterviewRound> rounds, DateTime now) {
  for (final r in rounds) {
    if (r.stateAt(now) == RoundState.open) return r.id;
  }
  for (final r in rounds) {
    if (r.stateAt(now) == RoundState.scheduled) return r.id;
  }
  return null;
}

class RoundTimelinePage extends StatefulWidget {
  final TestSummary test;
  const RoundTimelinePage({super.key, required this.test});

  @override
  State<RoundTimelinePage> createState() => _RoundTimelinePageState();
}

class _RoundTimelinePageState extends State<RoundTimelinePage> {
  /// The timeline. Held in state from ONE subscription rather than read through
  /// StreamBuilder, so the body and the active-round marker share a single
  /// Firestore listener instead of opening one each.
  List<InterviewRound>? _rounds;
  Object? _error;
  StreamSubscription<List<InterviewRound>>? _sub;

  /// roundId → assigned candidate count, or absent while unknown.
  final Map<String, int> _counts = {};

  /// roundId → how much of that round has been decided. Only ever loaded for
  /// CLOSED rounds: an open round's candidates are not waiting on anybody.
  final Map<String, RoundDecisionTally> _decisions = {};

  /// Guards the assign/adopt actions so a double tap cannot fire two batches.
  bool _busy = false;

  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';
  String get _testId => widget.test.testId;

  InterviewRepository get _repo => context.read<InterviewRepository>();

  @override
  void initState() {
    super.initState();
    _sub = _repo
        .watchRounds(testId: _testId, recruiterId: _uid)
        .listen(
          (rounds) {
            if (!mounted) return;
            setState(() {
              _rounds = rounds;
              _error = null;
            });
            // Count only rounds we have no number for yet, so an unrelated stream
            // tick (someone renaming a round) does not re-run every aggregate.
            final missing = rounds
                .where((r) => !_counts.containsKey(r.id))
                .toList();
            if (missing.isNotEmpty) _loadCounts(missing);

            // Same rule for the decision state, against the clock: a round that
            // has just crossed its deadline is closed on this tick and gets
            // probed now.
            final now = DateTime.now();
            final undecided = rounds
                .where((r) =>
                    r.stateAt(now) == RoundState.closed &&
                    !_decisions.containsKey(r.id))
                .toList();
            if (undecided.isNotEmpty) _loadDecisions(undecided);
          },
          onError: (Object e) {
            if (mounted) setState(() => _error = e);
          },
        );
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  /// Fetches the assigned-candidate count for [rounds] concurrently, then
  /// applies them in one rebuild rather than one per round.
  Future<void> _loadCounts(List<InterviewRound> rounds) async {
    final counts = await Future.wait(
      rounds.map(
        (r) async => (
          r.id,
          await _repo.countForRecruiter(
            recruiterId: _uid,
            testId: _testId,
            roundId: r.id,
          ),
        ),
      ),
    );
    if (!mounted) return;
    setState(() {
      for (final (id, n) in counts) {
        _counts[id] = n;
      }
    });
  }

  /// Drops a cached count so the next stream tick re-reads it. Called after any
  /// action that changes how many candidates a round has.
  void _invalidateCount(String roundId) {
    if (!mounted) return;
    setState(() => _counts.remove(roundId));
    _loadCounts([...?_rounds?.where((r) => r.id == roundId)]);
  }

  /// Reads how much of each CLOSED round has been decided.
  ///
  /// Closed only, and that is the whole subtlety: "closed" is derived from the
  /// clock, so a round crossing its deadline while this screen is open becomes
  /// eligible on the next tick and gets probed then, with no write and no cron
  /// job anywhere in the system.
  Future<void> _loadDecisions(List<InterviewRound> rounds) async {
    if (rounds.isEmpty) return;
    final tallies = await Future.wait(
      rounds.map(
        (r) async => (
          r.id,
          await _repo.countRoundDecision(
            recruiterId: _uid,
            testId: _testId,
            roundId: r.id,
          ),
        ),
      ),
    );
    if (!mounted) return;
    setState(() {
      for (final (id, t) in tallies) {
        _decisions[id] = t;
      }
    });
  }

  /// Re-reads one round's decision state — after a review, after an end, after
  /// candidates are added to it.
  void _invalidateDecision(String roundId) {
    if (!mounted) return;
    setState(() => _decisions.remove(roundId));
    _loadDecisions([...?_rounds?.where((r) => r.id == roundId)]);
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  Future<void> _configureRound(InterviewRound round) async {
    final updated = await Navigator.of(context).push<InterviewRound>(
      MaterialPageRoute(
        builder: (_) => CreateInterviewPage.configureRound(roundDraft: round),
      ),
    );
    if (updated == null || !mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      // updateRound propagates a moved window onto the round's candidates, so a
      // rescheduled deadline reaches the people it applies to.
      await _repo.updateRound(updated);
      if (!mounted) return;
      messenger.showSnackBar(const SnackBar(content: Text('Round updated.')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not save: $e')));
    }
  }

  Future<void> _assignCandidates(InterviewRound round) async {
    if (_busy) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      // Candidates assigned BEFORE this test had a timeline belong to no round.
      // Creating fresh assignments for them would leave each candidate holding
      // two copies of the same test, so offer to move them in instead.
      final legacy = await _repo.countLegacyAssignments(
        testId: _testId,
        recruiterId: _uid,
      );
      if (!mounted) return;
      if (legacy > 0 && await _offerAdoption(round, legacy)) {
        final moved = await _repo.adoptLegacyAssignments(round);
        if (!mounted) return;
        _invalidateCount(round.id);
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              '$moved existing candidate(s) moved into '
              '"${round.title}".',
            ),
          ),
        );
        return;
      }
      if (!mounted) return;

      // A pick-list, not a yes/no: bringing ONE late applicant into round 2 was
      // impossible with the old confirm-everybody dialog, and inviting somebody
      // who was not in the pipeline at all was impossible anywhere.
      final n = await addCandidatesToRound(
        context,
        repo: _repo,
        test: widget.test,
        round: round,
        recruiterId: _uid,
        recruiterEmail: FirebaseAuth.instance.currentUser?.email ?? '',
        recruiterName: FirebaseAuth.instance.currentUser?.displayName,
      );
      if (n == null || !mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            n == 0
                ? 'Everyone you picked is already in that round.'
                : '$n candidate(s) added to "${round.title}".',
          ),
        ),
      );
      // Assigning does not change the round document, so the timeline stream
      // will not tick — the count has to be re-read explicitly. The decision
      // state moves too: the people just added had their earlier rounds
      // settled, so an earlier round may no longer be waiting on anybody.
      _invalidateCount(round.id);
      for (final r in _rounds ?? const <InterviewRound>[]) {
        if (r.order < round.order) _invalidateDecision(r.id);
      }
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not assign: $e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Asks whether the test's pre-timeline candidates should move into [round].
  ///
  /// Framed as the recommended action because the alternative genuinely is worse:
  /// declining leaves those candidates in a round-less assignment AND gives them a
  /// second one, so the same test shows twice on their screen.
  Future<bool> _offerAdoption(InterviewRound round, int legacy) async {
    final answer = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Move existing candidates in?'),
        content: Text(
          '$legacy candidate(s) were assigned this pipeline before it had rounds, so '
          'they do not belong to any round yet.\n\n'
          'Moving them into "${round.title}" keeps anything they have already '
          'done — answers and scores are untouched — and gives them this round\'s '
          'dates.\n\n'
          'If you add them as new candidates instead, they will see this pipeline '
          'twice.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Add as new'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Move them in'),
          ),
        ],
      ),
    );
    return answer == true;
  }

  /// Ends a round — after showing what ending it would decide.
  ///
  /// The old flow asked "end this round for 18 candidate(s)?" and nothing more:
  /// the recruiter committed to the outcome without seeing a single name, and
  /// the advance rule they wrote weeks earlier was applied later, on another
  /// screen. Now the rule is applied HERE, in front of them, editable, with the
  /// people who never submitted listed too — and whatever they tick is carried
  /// into the review screen rather than re-derived.
  Future<void> _endRound(InterviewRound round) async {
    if (_busy) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);

    Set<String>? picked;
    // The ticked people who never submitted. They are not on the leaderboard, so
    // the review screen has to be handed them or it would quietly drop the
    // recruiter's decision about them.
    var tickedUnscored = const <Interview>[];
    try {
      // Ranked (scored) and everybody, so the unscored are the difference. Both
      // are one page: this is a decision screen, not a browsing one.
      final results = await Future.wait([
        _repo.fetchLeaderboardPage(
          recruiterId: _uid,
          testId: _testId,
          roundId: round.id,
          limit: 200,
        ),
        _repo.fetchRecruiterPage(
          recruiterId: _uid,
          testId: _testId,
          roundId: round.id,
          limit: 200,
        ),
      ]);
      if (!mounted) return;

      final ranked = results[0].items;
      final all = results[1].items;
      final rankedIds = {for (final i in ranked) i.id};

      final notSubmitted =
          notSubmittedIn(all).where((i) => !rankedIds.contains(i.id)).toList();

      picked = await EndRoundPreviewSheet.show(
        context,
        round: round,
        nextRound: _nextAfter(round),
        ranked: ranked,
        notSubmitted: notSubmitted,
      );
      final chosen = picked;
      if (chosen == null || !mounted) return;
      tickedUnscored =
          notSubmitted.where((i) => chosen.contains(i.id)).toList();
    } catch (e) {
      if (mounted) {
        messenger.showSnackBar(
          SnackBar(content: Text('Could not read this round: $e')),
        );
      }
      return;
    } finally {
      if (mounted) setState(() => _busy = false);
    }

    final ticked = picked!;
    try {
      await _repo.endRound(round);
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text('"${round.title}" is closed.'),
          // Ending a round is destructive for a candidate mid-answer, and the
          // button sits next to five others in a menu. The undo is here rather
          // than only in the menu because this is the second where a misfire is
          // noticed.
          action: SnackBarAction(
            label: 'Undo',
            onPressed: () => _reopenRound(round, confirm: false),
          ),
        ),
      );
      // The decision is owed from this instant, so the badge and the banner
      // appear now rather than on the next visit.
      _invalidateDecision(round.id);
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text('Could not end round: $e')),
      );
      // Do NOT go on to the review screen: the round is still open, so any
      // shortlist drawn from it now could still change.
      return;
    }

    if (!mounted) return;
    // Straight into the review, carrying their decision. The old flow asked
    // "tell the candidates?" here, and a "Not now" left the round decided by
    // nobody. Nothing is emailed or published until they confirm in there.
    _openNotify(round, preselectedIds: ticked, extras: tickedUnscored);
  }

  /// Reopens a closed round: the undo for [_endRound], and the fix for a
  /// deadline that passed before people were done.
  ///
  /// [confirm] is false when this comes from the "Undo" on the snackbar — they
  /// have just pressed it, on purpose, seconds ago. From the round menu it is
  /// true, because that path is somebody re-opening a round that has been closed
  /// for a while, and candidates getting access again is a real change.
  Future<void> _reopenRound(InterviewRound round, {bool confirm = true}) async {
    final messenger = ScaffoldMessenger.of(context);
    final now = DateTime.now();
    // A round whose own deadline has passed is closed by the clock whatever the
    // flags say, so reopening it has to say what the new window is.
    final needsDeadline = round.reopenNeedsDeadline(now);

    Duration? extend;
    if (confirm || needsDeadline) {
      final choice = await showDialog<String>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('Reopen "${round.title}"?'),
          content: Text(
            [
              'Candidates who had not finished get access back.',
              if (needsDeadline)
                'Its deadline (${formatDateTime(round.closesAt!)}) has already '
                    'passed, so it needs a new one — or none, and you end the '
                    'round by hand when you are ready.',
              'Anything you have already published stays published.',
            ].join('\n\n'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            if (needsDeadline) ...[
              TextButton(
                onPressed: () => Navigator.pop(ctx, 'none'),
                child: const Text('No deadline'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx, '1d'),
                child: const Text('+1 day'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, '3d'),
                child: const Text('+3 days'),
              ),
            ] else
              FilledButton(
                onPressed: () => Navigator.pop(ctx, 'keep'),
                child: const Text('Reopen'),
              ),
          ],
        ),
      );
      if (choice == null || !mounted) return;
      if (choice == 'none') {
        // Reopened open-ended: they end it by hand when they are ready. The
        // deadline has to go, or the clock closes it again on the next rebuild.
        await _applyReopen(round, clearDeadline: true, messenger: messenger);
        return;
      }
      extend = switch (choice) {
        '1d' => const Duration(days: 1),
        '3d' => const Duration(days: 3),
        _ => null, // 'keep' — the round's own deadline is still ahead of us
      };
    }

    await _applyReopen(
      round,
      newClosesAt: extend == null ? null : DateTime.now().add(extend),
      messenger: messenger,
    );
  }

  Future<void> _applyReopen(
    InterviewRound round, {
    DateTime? newClosesAt,
    bool clearDeadline = false,
    required ScaffoldMessengerState messenger,
  }) async {
    try {
      await _repo.reopenRound(
        round,
        newClosesAt: newClosesAt,
        clearDeadline: clearDeadline,
      );
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text('"${round.title}" is open again.')),
      );
      _invalidateDecision(round.id);
    } catch (e) {
      if (mounted) {
        messenger.showSnackBar(
          SnackBar(content: Text('Could not reopen: $e')),
        );
      }
    }
  }

  /// The round after [round] in the timeline, or null if it is the last.
  InterviewRound? _nextAfter(InterviewRound round) {
    final rounds = _rounds ?? const <InterviewRound>[];
    final at = rounds.indexWhere((r) => r.id == round.id);
    return (at >= 0 && at + 1 < rounds.length) ? rounds[at + 1] : null;
  }

  /// Opens the notify screen for [round], naming the round that follows it.
  ///
  /// [preselectedIds] carries a decision already made in the end-round preview.
  /// [extras] are the ticked candidates who never submitted — they are not on
  /// the leaderboard, so the review screen would not otherwise see them.
  void _openNotify(
    InterviewRound round, {
    Set<String>? preselectedIds,
    List<Interview> extras = const [],
  }) {
    // The next round by timeline position, so the shortlist email can say what
    // the candidate is advancing TO rather than "the next round".
    final next = _nextAfter(round);

    Navigator.of(context)
        .push(
          MaterialPageRoute(
            builder: (_) => RoundNotifyPage(
              test: widget.test,
              round: round,
              nextRound: next,
              preselectedIds: preselectedIds,
              extraCandidates: extras,
            ),
          ),
        )
        // Whatever was published in there changes who is still waiting — on
        // this round, and on the next one if anybody was advanced into it.
        .then((_) {
          _invalidateDecision(round.id);
          if (next != null) _invalidateCount(next.id);
        });
  }

  void _openCandidates(InterviewRound round) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TestCandidatesPage(test: widget.test, round: round),
      ),
    );
  }

  /// Opens the live call for a two-way round.
  ///
  /// A call is per CANDIDATE, not per round, so this shows the round's candidates
  /// and lets the recruiter pick who they are meeting — the room is keyed on the
  /// interview id, which is one candidate's assignment.
  void _openLiveInterview(InterviewRound round) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TestCandidatesPage(test: widget.test, round: round),
      ),
    );
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Pick the candidate you are interviewing, then "Join live '
          'interview".',
        ),
      ),
    );
  }

  void _openLeaderboard(InterviewRound round) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => RoundLeaderboardPage(test: widget.test, round: round),
      ),
    );
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return RecruiterScaffold(
      appBar: AppBar(
        title: const Text('Timeline'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(20),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              widget.test.title,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ),
      ),
      body: _body(theme),
    );
  }

  Widget _body(ThemeData theme) {
    if (_error != null) {
      return AppMessageState(
        icon: Icons.error_outline,
        title: 'Could not load the timeline',
        subtitle: '$_error',
      );
    }
    final rounds = _rounds;
    if (rounds == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (rounds.isEmpty) return _emptyState(theme);

    // One instant for the whole list, so two rows can never disagree about what
    // "now" is — the difference would show as one round Open and the next still
    // Scheduled at the same boundary.
    final now = DateTime.now();
    // The ACTIVE step: the earliest round still open, or failing that the next
    // one due to open. Marked so a recruiter opening a five-round pipeline can
    // see where it currently is without reading five status chips.
    final activeId = activeRoundId(rounds, now);

    // A plain list, not a ReorderableListView: the order of a live pipeline is
    // fixed once candidates are in it.
    final list = ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      itemCount: rounds.length + 1,
      itemBuilder: (context, i) {
        if (i == rounds.length) return _finalStep(theme);
        final r = rounds[i];
        final closed = r.stateAt(now) == RoundState.closed;
        final isDark = theme.brightness == Brightness.dark;
        return Padding(
          key: ValueKey(r.id),
          padding: EdgeInsets.zero,
          child: RoundStepTile(
            round: r,
            position: i + 1,
            total: rounds.length,
            showConnector: i < rounds.length - 1,
            stateLabel: roundStatusLine(r, now, _decisions[r.id]),
            stateColor: switch (r.stateAt(now)) {
              RoundState.open =>
                isDark ? AppColors.pastelMintText : theme.colorScheme.primary,
              RoundState.scheduled =>
                isDark ? AppColors.pastelCyanText : theme.colorScheme.secondary,
              // A closed round waiting on a decision is not a spent one: it
              // carries the pending tone so the row reads as work, not history.
              RoundState.closed => (_decisions[r.id]?.hasPending ?? false)
                  ? StatusTone.pending(context)
                  : isDark
                      ? AppColors.textSubtle
                      : theme.colorScheme.onSurfaceVariant,
            },
            assignedCount: _counts[r.id] ?? -1,
            highlight: r.id == activeId,
            highlightLabel: r.id == activeId ? 'current round' : null,
            onTap: () => _configureRound(r),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                PopupMenuButton<String>(
                  tooltip: 'Round actions',
                  padding: EdgeInsets.zero,
                  onSelected: (v) {
                    switch (v) {
                      case 'live':
                        _openLiveInterview(r);
                      case 'configure':
                        _configureRound(r);
                      case 'leaderboard':
                        _openLeaderboard(r);
                      case 'notify':
                        _openNotify(r);
                      case 'assign':
                        _assignCandidates(r);
                      case 'candidates':
                        _openCandidates(r);
                      case 'end':
                        _endRound(r);
                      case 'reopen':
                        _reopenRound(r);
                    }
                  },
                  itemBuilder: (ctx) => [
                    if (r.kind == RoundKind.twoWay && !closed)
                      const PopupMenuItem(
                        value: 'live',
                        child: Text('Join live interview'),
                      ),
                    const PopupMenuItem(
                      value: 'configure',
                      child: Text('Configure'),
                    ),
                    const PopupMenuItem(
                      value: 'leaderboard',
                      child: Text('Leaderboard'),
                    ),
                    const PopupMenuItem(
                      value: 'notify',
                      child: Text('Notify candidates…'),
                    ),
                    const PopupMenuItem(
                      value: 'assign',
                      child: Text('Add candidates'),
                    ),
                    const PopupMenuItem(
                      value: 'candidates',
                      child: Text('View candidates'),
                    ),
                    if (!closed)
                      const PopupMenuItem(
                        value: 'end',
                        child: Text('End round now'),
                      ),
                    // The undo, kept available long after the snackbar has
                    // gone: a round is often found closed by a deadline that
                    // passed while candidates were still finishing.
                    if (closed)
                      const PopupMenuItem(
                        value: 'reopen',
                        child: Text('Reopen round'),
                      ),
                  ],
                ),
                Icon(
                  Icons.chevron_right,
                  size: 18,
                  color: isDark
                      ? AppColors.textSubtle
                      : theme.colorScheme.onSurfaceVariant,
                ),
              ],
            ),
          ),
        );
      },
    );

    final waiting = _decisionBanner(theme, rounds, now);
    if (waiting == null) return list;
    return Column(children: [waiting, Expanded(child: list)]);
  }

  /// The one thing this pipeline is waiting on, or null when it is waiting on
  /// nothing.
  ///
  /// Shown rather than forced: a recruiter who opened the timeline to reschedule
  /// a round should not be trapped in a review sheet. But it does not go away
  /// when ignored, which is the failure it exists for — the old flow asked
  /// "Tell the candidates?" once, at the moment a round was ended by hand, and
  /// a "Not now" (or a round that closed on its own deadline) left twelve people
  /// undecided with nothing anywhere saying so.
  Widget? _decisionBanner(
      ThemeData theme, List<InterviewRound> rounds, DateTime now) {
    final status = RoundPipelineStatus.from(rounds, now);
    final round = status?.latestClosed;
    if (round == null) return null;

    final decision = _decisions[round.id];
    if (decision == null || !decision.hasPending) return null;

    final at = rounds.indexWhere((r) => r.id == round.id);
    final next = (at >= 0 && at + 1 < rounds.length) ? rounds[at + 1] : null;
    final n = decision.pending;
    final tone = StatusTone.pending(context);

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: WarmSurfaces.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: tone.withValues(alpha: 0.45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.how_to_reg_outlined, size: 17, color: tone),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  '"${round.title}" is closed',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            next == null
                ? '$n ${n == 1 ? 'candidate is' : 'candidates are'} waiting to '
                    'be told where they stand.'
                : '$n ${n == 1 ? 'candidate is' : 'candidates are'} waiting on '
                    'your decision — who moves on to "${next.title}".',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: WarmSurfaces.inkMuted(context)),
          ),
          const SizedBox(height: AppSpacing.md),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.icon(
              onPressed: () => _openNotify(round),
              icon: const Icon(Icons.arrow_forward_rounded, size: 17),
              label: const Text('Review & advance'),
            ),
          ),
        ],
      ),
    );
  }

  /// The last step of the timeline: release the final result.
  ///
  /// Locked until the LAST round has closed. The final result is the statement
  /// that the process is over, and while the last round is open people can still
  /// submit and nobody has decided it — so the step names what it is waiting
  /// for instead of opening a screen that can only say the same thing.
  Widget _finalStep(ThemeData theme) {
    final isDark = theme.brightness == Brightness.dark;
    final rounds = _rounds ?? const <InterviewRound>[];
    final now = DateTime.now();
    final ordered = [...rounds]..sort((a, b) => a.order.compareTo(b.order));
    final last = ordered.isEmpty ? null : ordered.last;
    final waitingOn =
        (last != null && last.stateAt(now) != RoundState.closed) ? last : null;
    final locked = waitingOn != null;

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Opacity(
        opacity: locked ? 0.55 : 1,
        child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: locked
              ? () => ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        'The final result unlocks when "${waitingOn.title}" '
                        'closes — ending it is where you choose who advances.',
                      ),
                    ),
                  )
              : () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => TestConclusionPage(test: widget.test),
                    ),
                  ),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: WarmSurfaces.surface(context),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: WarmSurfaces.stroke(context)),
            ),
            child: Row(
              children: [
                Icon(
                  locked ? Icons.lock_clock : Icons.flag_outlined,
                  size: 20,
                  color: isDark
                      ? AppColors.pastelMintText
                      : theme.colorScheme.primary,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Final result',
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: isDark
                              ? AppColors.textLight
                              : theme.colorScheme.onSurface,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        locked
                            ? 'Unlocks when "${waitingOn.title}" closes.'
                            : 'Tell the candidates how it ended — pre-filled '
                                'from who the last round advanced.',
                        style: TextStyle(
                          fontSize: 11.5,
                          color: isDark
                              ? AppColors.textMuted
                              : theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  locked ? Icons.lock_outline : Icons.chevron_right,
                  size: 18,
                  color: isDark
                      ? AppColors.textSubtle
                      : theme.colorScheme.onSurfaceVariant,
                ),
              ],
            ),
          ),
        ),
        ),
      ),
    );
  }

  Widget _emptyState(ThemeData theme) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 460),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.timeline_outlined,
              size: 44,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 16),
            Text(
              'This pipeline has no rounds',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'It runs as a single stage, which is fine — its schedule and '
              'questions are edited from the pipeline itself. A sequence of '
              'rounds is designed when a pipeline is created, using Round style → '
              'Multi Round.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

/// The status chip's text for [round] at [now].
///
/// Public and clock-injected so it can be tested without a widget tree: it is
/// the one place a recruiter reads a round's state off the screen, and "Open"
/// where it should say "Closed" is the kind of wrong that goes unnoticed.
String roundStateLabel(InterviewRound round, DateTime now) {
  switch (round.stateAt(now)) {
    case RoundState.open:
      final closes = round.closesAt;
      // Recomputed against `now` rather than using round.timeUntilClose, which
      // reads the real clock — a row must describe the instant it renders for.
      if (closes == null || !closes.isAfter(now)) return 'Open';
      return 'Open · closes in ${formatDurationShort(closes.difference(now))}';
    case RoundState.scheduled:
      final opens = round.opensAt;
      if (opens == null) return 'Scheduled';
      return 'Opens in ${formatDurationShort(opens.difference(now))}';
    case RoundState.closed:
      return round.wasEndedManually ? 'Ended by you' : 'Closed';
  }
}

/// A round's status in the words the recruiter needs, including whether it is
/// waiting on them.
///
/// A closed round is not the end of anything by itself — somebody still has to
/// say who moves on. So a closed round reads one of three ways:
///
///   * "Closed · 12 to decide"  — the work is with the recruiter. THE point of
///     this function: a round that closed on its own deadline used to read the
///     same as one that was finished with, and the decision was simply never
///     made.
///   * "Done"                   — closed, and everybody scored has an outcome.
///   * "Closed" / "Ended by you" — closed with nothing to decide, or with the
///     count not known (offline). Never claims "Done" it cannot vouch for.
String roundStatusLine(
  InterviewRound round,
  DateTime now,
  RoundDecisionTally? decision,
) {
  final base = roundStateLabel(round, now);
  if (round.stateAt(now) != RoundState.closed) return base;
  if (decision == null || !decision.isKnown) return base;
  if (decision.pending > 0) return '$base · ${decision.pending} to decide';
  return decision.scored > 0 ? 'Done' : base;
}

/// One round in the timeline: position, type, derived state, and its actions.

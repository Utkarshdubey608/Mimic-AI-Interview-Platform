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
import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/models/test_summary.dart';
import 'package:talbotiq/features/interviews/recruiter/create_interview_page.dart';
import 'package:talbotiq/features/interviews/recruiter/round_leaderboard_page.dart';
import 'package:talbotiq/features/interviews/recruiter/round_notify_page.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/round_step_tile.dart';
import 'package:talbotiq/features/interviews/recruiter/test_candidates_page.dart';
import 'package:talbotiq/features/interviews/recruiter/test_conclusion_page.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

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

      final candidates = await _repo.fetchTestCandidates(
        testId: _testId,
        recruiterId: _uid,
      );
      if (!mounted) return;

      if (candidates.isEmpty) {
        messenger.showSnackBar(
          const SnackBar(
            content: Text(
              'No candidates in this pipeline yet — add them to a round first.',
            ),
          ),
        );
        return;
      }

      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('Add candidates to "${round.title}"?'),
          content: Text(
            [
              '${candidates.length} candidate(s) are in this pipeline. Anyone '
                  'already in this round is skipped, so their answers and '
                  'scores are kept.',
              // Said out loud because it publishes something to candidates.
              // Being put in a later round IS being told you got through the
              // earlier ones, and leaving those rounds reading "Under review"
              // for ever was the bug this closes.
              if (round.order > 0)
                'Their earlier rounds will show as cleared, unless you have '
                    'already decided them otherwise.',
            ].join('\n\n'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Add'),
            ),
          ],
        ),
      );
      if (ok != true || !mounted) return;

      final n = await _repo.assignCandidatesToRound(
        round: round,
        recruiterEmail: FirebaseAuth.instance.currentUser?.email ?? '',
        recruiterName: FirebaseAuth.instance.currentUser?.displayName,
        testTitle: widget.test.title,
        candidates: candidates,
      );
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            n == 0
                ? 'Everyone in this pipeline is already in that round.'
                : '$n candidate(s) added to "${round.title}".',
          ),
        ),
      );
      // Assigning does not change the round document, so the timeline stream
      // will not tick — the count has to be re-read explicitly.
      _invalidateCount(round.id);
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

  Future<void> _endRound(InterviewRound round) async {
    final n = _counts[round.id] ?? -1;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('End "${round.title}" now?'),
        content: Text(
          round.willAutoClose
              ? 'This round is scheduled to close on '
                    '${formatDateTime(round.closesAt!)}. Ending it now closes it '
                    'immediately for '
                    '${n >= 0 ? '$n candidate(s)' : 'its candidates'} — anyone '
                    'who has not finished loses access.'
              : 'The round closes immediately for '
                    '${n >= 0 ? '$n candidate(s)' : 'its candidates'}. Anyone who '
                    'has not finished loses access.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('End round'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await _repo.endRound(round);
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text('"${round.title}" is closed.')),
      );
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text('Could not end round: $e')),
      );
      // Do NOT offer to notify anyone: the round is still open, so any shortlist
      // drawn from it now could still change.
      return;
    }

    // Closing a round is the moment the outcome is decided, so this is when the
    // recruiter wants to tell people. Offered rather than automatic — ending a
    // round early to fix a mistake must not fire rejection emails.
    if (!mounted) return;
    final notify = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Tell the candidates?'),
        content: Text(
          '"${round.title}" is closed. You can email whoever is moving on to '
          'the next round, and whoever is not.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Not now'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Choose who advances'),
          ),
        ],
      ),
    );
    if (notify != true || !mounted) return;
    _openNotify(round);
  }

  /// Opens the notify screen for [round], naming the round that follows it.
  void _openNotify(InterviewRound round) {
    // The next round by timeline position, so the shortlist email can say what
    // the candidate is advancing TO rather than "the next round".
    final rounds = _rounds ?? const <InterviewRound>[];
    final at = rounds.indexWhere((r) => r.id == round.id);
    final next = (at >= 0 && at + 1 < rounds.length) ? rounds[at + 1] : null;

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) =>
            RoundNotifyPage(test: widget.test, round: round, nextRound: next),
      ),
    );
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
    return ListView.builder(
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
            stateLabel: roundStateLabel(r, now),
            stateColor: switch (r.stateAt(now)) {
              RoundState.open =>
                isDark ? AppColors.pastelMintText : theme.colorScheme.primary,
              RoundState.scheduled =>
                isDark ? AppColors.pastelCyanText : theme.colorScheme.secondary,
              RoundState.closed =>
                isDark
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
  }

  /// The last step of the timeline: release the final result.
  Widget _finalStep(ThemeData theme) {
    final isDark = theme.brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => Navigator.of(context).push(
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
                  Icons.flag_outlined,
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
                        'Tell the candidates who have finished how it ended, in your own words.',
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
                  Icons.chevron_right,
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

/// One round in the timeline: position, type, derived state, and its actions.

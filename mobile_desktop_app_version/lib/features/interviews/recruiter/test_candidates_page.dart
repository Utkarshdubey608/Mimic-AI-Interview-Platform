// lib/features/interviews/recruiter/test_candidates_page.dart
//
// The candidates of ONE test, loaded in pages.
//
// The dashboard lists tests (a few dozen tiny docs); opening one lands here and
// only then are that test's candidates read — scoped by `testId` and fetched
// 25 at a time. That keeps a 1,000-candidate test off the dashboard's critical
// path entirely, and means this screen's cost is bounded by what's on screen
// rather than by how many people took the test.
//
// Search runs SERVER-side as a candidateEmailLower prefix range (so a match
// deep in the test is found without paging to it) and is additionally narrowed
// client-side over loaded rows, which is the only way to match partial NAMES —
// Firestore range queries do prefixes, never substrings.
//
// Header counts come from count() aggregates, so "312 candidates · 180
// completed" stays true while only a page is in memory.

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/models/test_summary.dart';
import 'package:talbotiq/features/interviews/services/evaluation_retry_service.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/add_candidates_sheet.dart';
import 'package:talbotiq/features/interviews/recruiter/candidate_grouping.dart';
import 'package:talbotiq/features/interviews/recruiter/candidate_kanban_view.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/interview_card.dart';
import 'package:talbotiq/features/interviews/recruiter/round_leaderboard_page.dart';
import 'package:talbotiq/features/interviews/recruiter/round_timeline_page.dart';
import 'package:talbotiq/features/interviews/recruiter/test_conclusion_page.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/recruiter_action_bar.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

class TestCandidatesPage extends StatefulWidget {
  final TestSummary test;

  /// When set, this screen shows only the candidates of that ROUND. Null shows
  /// every candidate of the test across all rounds — which is also what a test
  /// with no timeline has, since its assignments carry no roundId.
  final InterviewRound? round;

  const TestCandidatesPage({super.key, required this.test, this.round});

  @override
  State<TestCandidatesPage> createState() => _TestCandidatesPageState();
}

class _TestCandidatesPageState extends State<TestCandidatesPage> {
  final _scroll = ScrollController();
  final _searchCtrl = TextEditingController();

  final List<Interview> _loaded = [];
  DocumentSnapshot<Map<String, dynamic>>? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  Object? _error;

  String _query = '';
  Timer? _debounce;

  int _total = -1;
  int _completed = -1;

  /// A bulk re-score is in flight; `_retryProgress` is "3 of 12" for the overlay.
  bool _retrying = false;
  String _retryProgress = '';

  /// Guards the add-candidates flow so a double tap cannot write two batches.
  bool _adding = false;

  /// List is the default view; Kanban is opted into per visit — it reuses the
  /// SAME loaded rows/pagination state as the list, not a second Firestore
  /// read.
  bool _kanbanView = false;

  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';
  String get _testId => widget.test.testId;

  /// Null when unscoped — every query below passes it straight through, and a
  /// null roundId means "all rounds".
  String? get _roundId => widget.round?.id;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    _refresh();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scroll.hasClients || _loading || !_hasMore) return;
    final remaining =
        _scroll.position.maxScrollExtent - _scroll.position.pixels;
    if (remaining < 400) _loadMore();
  }

  void _onSearchChanged(String raw) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      final q = raw.trim();
      if (q == _query) return;
      _query = q;
      _refresh();
    });
  }

  Future<void> _refresh() async {
    setState(() {
      _loaded.clear();
      _cursor = null;
      _hasMore = true;
      _error = null;
    });
    await _loadMore();
    await _loadCounts();
  }

  Future<void> _loadCounts() async {
    final repo = context.read<InterviewRepository>();
    final total = await repo.countForRecruiter(
      recruiterId: _uid,
      testId: _testId,
      roundId: _roundId,
    );
    final done = await repo.countForRecruiter(
      recruiterId: _uid,
      testId: _testId,
      roundId: _roundId,
      status: InterviewStatus.completed,
    );
    if (!mounted) return;
    setState(() {
      _total = total;
      _completed = done;
    });
  }

  Future<void> _loadMore() async {
    if (_loading || !_hasMore) return;
    setState(() => _loading = true);
    try {
      final page = await context.read<InterviewRepository>().fetchRecruiterPage(
        recruiterId: _uid,
        testId: _testId,
        roundId: _roundId,
        startAfter: _cursor,
        emailPrefix: _looksLikeEmailPrefix(_query) ? _query : null,
      );
      if (!mounted) return;
      setState(() {
        _loaded.addAll(page.items);
        _cursor = page.lastDoc ?? _cursor;
        _hasMore = page.hasMore;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e;
        _loading = false;
        _hasMore = false;
      });
    }
  }

  static bool _looksLikeEmailPrefix(String q) {
    if (q.length < 2 || q.contains(' ')) return false;
    return RegExp(r'^[a-zA-Z0-9._%+\-@]+$').hasMatch(q);
  }

  /// The rows to render, in display order.
  ///
  /// Unscoped, a multi-round test holds ONE assignment per candidate per round
  /// — that is the data model, not a duplicate — and the page query orders by
  /// `createdAt`, so a person's rounds arrive interleaved with everybody
  /// else's. Left alone, the same email appears as two unrelated candidates
  /// with different question counts and statuses, which is exactly how it
  /// looked. So rows are grouped by candidate here and ordered by round within
  /// the group; `_body` then renders every row after a candidate's first as a
  /// continuation of it.
  ///
  /// Grouping is over the LOADED rows only — a candidate whose rounds straddle
  /// a page boundary joins up as soon as the next page arrives. A round-scoped
  /// view has at most one row per candidate, so it is passed through untouched.
  List<Interview> get _visible {
    final rows = _query.isEmpty ? _loaded : _matching(_loaded, _query);
    if (widget.round != null) return rows;
    return groupRoundsByCandidate(rows);
  }

  static List<Interview> _matching(List<Interview> rows, String query) {
    final q = query.toLowerCase();
    return rows.where((i) {
      final name = (i.candidateName ?? '').toLowerCase();
      return name.contains(q) || i.candidateEmail.toLowerCase().contains(q);
    }).toList();
  }

  Future<void> _publishAll() async {
    final repo = context.read<InterviewRepository>();
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('End pipeline and publish results?'),
        content: Text(
          'Every candidate of "${widget.test.title}" who completed the '
          'interview will be able to see their result. This affects all '
          'completed candidates, not just the ones loaded here.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Publish'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      // Publishes server-side across the whole test, independent of what this
      // screen has loaded.
      await repo.publishTest(_testId, _uid);
      if (!mounted) return;
      await _refresh();
      messenger.showSnackBar(
        const SnackBar(content: Text('Results published to candidates.')),
      );
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not publish: $e')));
    }
  }

  /// Re-runs AI scoring for every candidate here whose evaluation failed.
  ///
  /// One action for the whole test (or round), rather than opening each failed
  /// candidate's review screen and pressing regenerate. The retryable set is
  /// fetched on press rather than counted on every page load — it needs a read of
  /// the completed assignments, which is not worth paying for a badge nobody may
  /// look at.
  Future<void> _retryFailedScoring() async {
    if (_retrying) return;
    final repo = context.read<InterviewRepository>();
    final messenger = ScaffoldMessenger.of(context);

    setState(() => _retrying = true);
    try {
      final pending = await repo.fetchRetryableEvaluations(
        recruiterId: _uid,
        testId: _testId,
        roundId: _roundId,
      );
      if (!mounted) return;

      if (pending.isEmpty) {
        setState(() => _retrying = false);
        messenger.showSnackBar(
          const SnackBar(
            content: Text(
              'Nothing needs re-scoring — no failed evaluations here.',
            ),
          ),
        );
        return;
      }

      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text('Re-score ${pending.length} candidate(s)?'),
          content: Text(
            '${pending.length} candidate(s) completed but have no score because '
            'AI evaluation failed. Their stored answers will be scored again.\n\n'
            'Candidates who already have a score — from the AI or from you — are '
            'not touched.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Re-score'),
            ),
          ],
        ),
      );
      if (ok != true) {
        if (mounted) setState(() => _retrying = false);
        return;
      }

      final service = EvaluationRetryService(repository: repo);
      final report = await service.retryEach(
        pending,
        onProgress: (done, total) {
          if (mounted) setState(() => _retryProgress = '$done of $total');
        },
      );
      if (!mounted) return;
      setState(() {
        _retrying = false;
        _retryProgress = '';
      });
      await _refresh();
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(
          content: Text(report.summary),
          duration: const Duration(seconds: 6),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _retrying = false;
        _retryProgress = '';
      });
      messenger.showSnackBar(SnackBar(content: Text('Could not re-score: $e')));
    }
  }

  /// Deletes the whole test and every candidate's data for it.
  ///
  /// Irreversible and bulk, so it requires typing DELETE rather than a single
  /// tap — a mis-tap here would wipe every response for the test.
  Future<void> _confirmDeleteTest() async {
    final repo = context.read<InterviewRepository>();
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => _DeleteTestDialog(
        title: widget.test.title,
        countLabel: _total >= 0 ? '$_total candidate(s)' : 'every candidate',
      ),
    );
    if (ok != true) return;

    try {
      final n = await repo.deleteTest(_testId, _uid);
      if (!mounted) return;
      // Nothing left to show — return to the dashboard.
      navigator.pop();
      messenger.showSnackBar(
        SnackBar(
          content: Text('Pipeline deleted ($n candidate record(s) removed).'),
        ),
      );
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not delete: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final round = widget.round;
    return RecruiterScaffold(
      appBar: AppBar(
        title: Text(round?.title ?? widget.test.title),
        // Scoped to a round, name the test underneath so it is clear which
        // pipeline these candidates belong to.
        bottom: round == null
            ? null
            : PreferredSize(
                preferredSize: const Size.fromHeight(20),
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    '${widget.test.title} · ${round.kind.label}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
        // No action icons here on purpose — every one of them is a labelled
        // button in `_actionBar` below. An unlabelled icon row made a recruiter
        // guess which of five glyphs published results and which deleted the
        // test, and two of them are irreversible.
      ),
      body: Stack(
        children: [
          Column(
            children: [
              _header(theme),
              Expanded(child: _body(theme)),
            ],
          ),
          // Blocking, because re-scoring writes results and a recruiter tapping
          // publish or delete mid-run would be acting on numbers that are still
          // changing under them.
          if (_retrying)
            ColoredBox(
              color: const Color(0xCC000000),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const CircularProgressIndicator(),
                    const SizedBox(height: 18),
                    Text(
                      _retryProgress.isEmpty
                          ? 'Checking for failed evaluations…'
                          : 'Re-scoring $_retryProgress…',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _header(ThemeData theme) {
    final rows = _visible;
    final shown = rows.length;
    final people = distinctCandidateCount(rows);
    // `_total` comes from a count() aggregate over ASSIGNMENTS, and a
    // multi-round test has one per candidate per round. Reporting that as
    // "2 candidate(s)" for one person in two rounds is what made the list look
    // like it had duplicated somebody, so once the two numbers differ each is
    // named for what it actually is.
    final perRound = shown != people;
    final done = _completed >= 0 ? ' · $_completed completed' : '';
    final String label;
    if (_query.isNotEmpty) {
      label = perRound
          ? '$people candidate(s) · $shown match${shown == 1 ? '' : 'es'}'
          : '$shown match${shown == 1 ? '' : 'es'}';
    } else if (_total < 0) {
      label = '$people candidate(s)';
    } else if (perRound) {
      label =
          '$people candidate(s) · $shown of $_total round entr'
          '${_total == 1 ? 'y' : 'ies'}$done';
    } else {
      label = 'Showing $shown of $_total candidate(s)$done';
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _actionBar(theme),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: SegmentedButton<bool>(
              segments: const [
                ButtonSegment(
                  value: false,
                  label: Text('List'),
                  icon: Icon(Icons.view_list_outlined, size: 16),
                ),
                ButtonSegment(
                  value: true,
                  label: Text('Kanban'),
                  icon: Icon(Icons.view_column_outlined, size: 16),
                ),
              ],
              selected: {_kanbanView},
              showSelectedIcon: false,
              onSelectionChanged: (s) => setState(() => _kanbanView = s.first),
            ),
          ),
          const SizedBox(height: 12),
          Container(
            height: 48,
            decoration: BoxDecoration(
              color: WarmSurfaces.surface(context),
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(color: WarmSurfaces.stroke(context)),
            ),
            child: TextField(
              controller: _searchCtrl,
              onChanged: _onSearchChanged,
              textInputAction: TextInputAction.search,
              style: TextStyle(
                fontSize: 13.5,
                color: Theme.of(context).brightness == Brightness.dark
                    ? AppColors.textLight
                    : theme.colorScheme.onSurface,
              ),
              decoration: InputDecoration(
                isDense: true,
                filled: false,
                hintText: 'Search this pipeline by name or email…',
                hintStyle: TextStyle(
                  fontSize: 13,
                  color: Theme.of(context).brightness == Brightness.dark
                      ? AppColors.textSubtle
                      : theme.colorScheme.onSurfaceVariant,
                ),
                prefixIcon: Icon(
                  Icons.search_rounded,
                  size: 18,
                  color: Theme.of(context).brightness == Brightness.dark
                      ? AppColors.textMuted
                      : theme.colorScheme.onSurfaceVariant,
                ),
                prefixIconConstraints: const BoxConstraints(
                  minWidth: 42,
                  minHeight: 42,
                ),
                suffixIcon: _searchCtrl.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close_rounded, size: 16),
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(
                          minWidth: 40,
                          minHeight: 40,
                        ),
                        tooltip: 'Clear search',
                        onPressed: () {
                          _searchCtrl.clear();
                          _onSearchChanged('');
                        },
                      ),
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 12,
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).brightness == Brightness.dark
                  ? AppColors.textMuted
                  : theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }

  /// Every action for this test, as labelled buttons.
  ///
  /// Ordering is by frequency, not prominence: the two navigations are used
  /// constantly, publishing occasionally, deleting almost never. The destructive
  /// one is last so it is never the button next to the one you meant.
  Widget _actionBar(ThemeData theme) {
    final round = widget.round;
    final hasCompleted = _completed > 0;

    return RecruiterActionBar(
      actions: [
        // First, and offered unconditionally: "add somebody" is the one thing a
        // recruiter came here to do that this screen could not do at all. Its
        // empty state told them to "assign this pipeline to a candidate email"
        // with nothing anywhere that could.
        RecruiterAction(
          label: 'Add candidates',
          icon: Icons.person_add_alt_1_outlined,
          onPressed: _adding ? null : _addCandidates,
        ),
        RecruiterAction(
          label: 'Leaderboard',
          icon: Icons.leaderboard_outlined,
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(
              // Passing `round` through means a single-round test — which has no
              // roundId on its documents — still ranks, across the whole test.
              builder: (_) =>
                  RoundLeaderboardPage(test: widget.test, round: round),
            ),
          ),
        ),
        // Hidden when already scoped to a round — the timeline is where this
        // screen was opened from, so offering it again just loops.
        if (round == null)
          RecruiterAction(
            label: 'Rounds & schedule',
            icon: Icons.timeline_outlined,
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => RoundTimelinePage(test: widget.test),
              ),
            ),
          ),
        // Both of these only mean anything once somebody has finished.
        if (hasCompleted)
          RecruiterAction(
            label: 'Retry failed scoring',
            icon: Icons.autorenew,
            onPressed: _retrying ? null : _retryFailedScoring,
          ),
        if (hasCompleted)
          RecruiterAction(
            label: 'Publish results',
            icon: Icons.publish_outlined,
            onPressed: _publishAll,
          ),
        // Closing the process, as opposed to publishing this round's results.
        // Only offered from the all-rounds view: a conclusion is about a
        // candidate's WHOLE run at the test, and offering it from inside one
        // round would read as concluding that round.
        if (hasCompleted && round == null)
          RecruiterAction(
            label: 'Final result',
            icon: Icons.flag_outlined,
            onPressed: () async {
              await Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => TestConclusionPage(test: widget.test),
                ),
              );
              // A published conclusion shows as a pill on these rows, so the
              // list has to be re-read on the way back.
              if (mounted) await _refresh();
            },
          ),
        RecruiterAction(
          label: 'Delete pipeline',
          icon: Icons.delete_forever_outlined,
          onPressed: _confirmDeleteTest,
          destructive: true,
        ),
      ],
    );
  }

  /// Adds candidates to a round of this pipeline — the round this screen is
  /// scoped to, or one the recruiter picks when it is showing all of them.
  Future<void> _addCandidates() async {
    if (_adding) return;
    final messenger = ScaffoldMessenger.of(context);
    final repo = context.read<InterviewRepository>();
    setState(() => _adding = true);
    try {
      var target = widget.round;
      if (target == null) {
        final rounds = await repo.fetchRounds(
          testId: widget.test.testId,
          recruiterId: _uid,
        );
        if (!mounted) return;
        if (rounds.isEmpty) {
          // A pipeline with no timeline has nowhere to put anybody: its
          // assignments carry no roundId, and inventing one here would split
          // the pipeline in two.
          messenger.showSnackBar(const SnackBar(
            content: Text(
              'This pipeline has no rounds yet — add one from '
              'Rounds & schedule first.',
            ),
          ));
          return;
        }
        target = rounds.length == 1
            ? rounds.first
            : await pickRoundForCandidates(
                context,
                rounds: rounds,
                now: DateTime.now(),
              );
        if (target == null || !mounted) return;
      }

      final n = await addCandidatesToRound(
        context,
        repo: repo,
        test: widget.test,
        round: target,
        recruiterId: _uid,
        recruiterEmail: FirebaseAuth.instance.currentUser?.email ?? '',
        recruiterName: FirebaseAuth.instance.currentUser?.displayName,
      );
      if (n == null || !mounted) return;

      messenger.showSnackBar(SnackBar(
        content: Text(
          n == 0
              ? 'Everyone you picked is already in "${target.title}".'
              : '$n candidate(s) added to "${target.title}".',
        ),
      ));
      // New assignments are new rows on this very list.
      await _refresh();
    } catch (e) {
      if (mounted) {
        messenger.showSnackBar(
          SnackBar(content: Text('Could not add candidates: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  Widget _body(ThemeData theme) {
    if (_error != null && _loaded.isEmpty) {
      return AppMessageState(
        icon: Icons.error_outline,
        title: 'Could not load candidates',
        subtitle: '$_error',
      );
    }
    if (_loaded.isEmpty && _loading) {
      return const Center(child: CircularProgressIndicator());
    }
    final items = _visible;
    if (items.isEmpty) {
      return AppMessageState(
        icon: _query.isEmpty ? Icons.people_outline : Icons.search_off,
        title: _query.isEmpty
            ? 'No candidates in this pipeline'
            : 'No matching candidates',
        subtitle: _query.isEmpty
            ? 'Use "Add candidates" above to invite people — by email, or from '
                'whoever is already in this pipeline.'
            : 'Try a different name or email.',
      );
    }
    if (_kanbanView) {
      return CandidateKanbanView(
        rows: items,
        test: widget.test,
        round: widget.round,
        onChanged: _refresh,
      );
    }
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView.builder(
        controller: _scroll,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        itemCount: items.length + 1,
        itemBuilder: (context, index) {
          if (index == items.length) return _pagerRow(theme);
          final item = items[index];
          // `_visible` has already put a candidate's rounds next to each other,
          // so "same key as the row above" means "another round of the same
          // person" — rendered as a continuation rather than a fresh card.
          final grouping = widget.round == null;
          final continuation =
              grouping &&
              index > 0 &&
              candidateKey(items[index - 1]) == candidateKey(item);
          final lastOfCandidate =
              !grouping ||
              index == items.length - 1 ||
              candidateKey(items[index + 1]) != candidateKey(item);
          return Padding(
            // Tight under a row that has more rounds below it, so the group
            // reads as one candidate rather than several.
            padding: EdgeInsets.only(bottom: lastOfCandidate ? 10 : 4),
            child: InterviewCard(
              interview: item,
              groupInterviews: items,
              index: index,
              showRound: grouping,
              continuation: continuation,
            ),
          );
        },
      ),
    );
  }

  Widget _pagerRow(ThemeData theme) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 20),
        child: Center(
          child: SizedBox(
            width: 22,
            height: 22,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: TextButton.icon(
            onPressed: _loadMore,
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('Retry loading more'),
          ),
        ),
      );
    }
    if (!_hasMore) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: Text(
            'End of list',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Center(
        child: TextButton(
          onPressed: _loadMore,
          child: const Text('Load more candidates'),
        ),
      ),
    );
  }
}

/// Type-to-confirm dialog for deleting an entire test.
///
/// A StatefulWidget rather than a `StatefulBuilder` + local controller so the
/// TextEditingController's lifetime matches the dialog's. The previous version
/// called `ctrl.dispose()` on the line after `showDialog` returned — which is
/// BEFORE the dialog's exit transition finishes, so the still-mounted TextField
/// was left holding a disposed controller. That surfaced as a framework
/// assertion (`_dependents.isEmpty`) rather than anything that pointed here.
///
/// The content also scrolls: `autofocus: true` raises the keyboard immediately,
/// and an AlertDialog does not scroll its content by default, so on a phone the
/// column had nowhere to go.
class _DeleteTestDialog extends StatefulWidget {
  const _DeleteTestDialog({required this.title, required this.countLabel});

  final String title;
  final String countLabel;

  @override
  State<_DeleteTestDialog> createState() => _DeleteTestDialogState();
}

class _DeleteTestDialogState extends State<_DeleteTestDialog> {
  final _controller = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Rebuilds to enable/disable the destructive action as they type.
    _controller.addListener(_onChanged);
  }

  void _onChanged() => setState(() {});

  @override
  void dispose() {
    _controller.removeListener(_onChanged);
    _controller.dispose();
    super.dispose();
  }

  bool get _confirmed => _controller.text.trim().toUpperCase() == 'DELETE';

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AlertDialog(
      title: const Text('Delete entire pipeline?'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'This permanently deletes "${widget.title}" and the assignments, '
              'answers and AI reports of ${widget.countLabel} who took it. '
              'This cannot be undone.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            Text(
              'Type DELETE to confirm',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _controller,
              autofocus: true,
              decoration: const InputDecoration(isDense: true),
              textInputAction: TextInputAction.done,
              onSubmitted: (_) {
                if (_confirmed) Navigator.pop(context, true);
              },
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: _confirmed ? () => Navigator.pop(context, true) : null,
          child: Text(
            'Delete pipeline',
            style: TextStyle(color: theme.colorScheme.error),
          ),
        ),
      ],
    );
  }
}

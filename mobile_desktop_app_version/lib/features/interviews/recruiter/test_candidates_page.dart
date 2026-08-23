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
import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/test_conclusion.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/models/test_summary.dart';
import 'package:talbotiq/features/interviews/services/evaluation_retry_service.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/features/interviews/recruiter/candidate_grouping.dart';
import 'package:talbotiq/features/interviews/recruiter/create_interview_page.dart';
import 'package:talbotiq/features/interviews/candidate/live_interview_page.dart';
import 'package:talbotiq/features/interviews/recruiter/evaluate_interview_page.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/two_way_review_sheet.dart';
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
        recruiterId: _uid, testId: _testId, roundId: _roundId);
    final done = await repo.countForRecruiter(
        recruiterId: _uid,
        testId: _testId,
        roundId: _roundId,
        status: InterviewStatus.completed);
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
        title: const Text('End test and publish results?'),
        content: Text(
          'Every candidate of "${widget.test.title}" who completed the '
          'interview will be able to see their result. This affects all '
          'completed candidates, not just the ones loaded here.',
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
    if (ok != true) return;
    try {
      // Publishes server-side across the whole test, independent of what this
      // screen has loaded.
      await repo.publishTest(_testId, _uid);
      if (!mounted) return;
      await _refresh();
      messenger.showSnackBar(
          const SnackBar(content: Text('Results published to candidates.')));
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
        messenger.showSnackBar(const SnackBar(
          content: Text('Nothing needs re-scoring — no failed evaluations here.'),
        ));
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
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Re-score')),
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
      messenger.showSnackBar(SnackBar(
        content: Text(report.summary),
        duration: const Duration(seconds: 6),
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _retrying = false;
        _retryProgress = '';
      });
      messenger
          .showSnackBar(SnackBar(content: Text('Could not re-score: $e')));
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
      messenger.showSnackBar(SnackBar(
          content: Text('Test deleted ($n candidate record(s) removed).')));
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
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
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
      label = '$people candidate(s) · $shown of $_total round entr'
          '${_total == 1 ? 'y' : 'ies'}$done';
    } else {
      label = 'Showing $shown of $_total candidate(s)$done';
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _actionBar(theme),
          const SizedBox(height: 12),
          Container(
            height: 40,
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
                hintText: 'Search this test by name or email...',
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
                prefixIconConstraints: const BoxConstraints(minWidth: 36, minHeight: 36),
                suffixIcon: _searchCtrl.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.close_rounded, size: 16),
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                        tooltip: 'Clear search',
                        onPressed: () {
                          _searchCtrl.clear();
                          _onSearchChanged('');
                        },
                      ),
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
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
        RecruiterAction(
          label: 'Leaderboard',
          icon: Icons.leaderboard_outlined,
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(
            // Passing `round` through means a single-round test — which has no
            // roundId on its documents — still ranks, across the whole test.
            builder: (_) =>
                RoundLeaderboardPage(test: widget.test, round: round),
          )),
        ),
        // Hidden when already scoped to a round — the timeline is where this
        // screen was opened from, so offering it again just loops.
        if (round == null)
          RecruiterAction(
            label: 'Rounds & schedule',
            icon: Icons.timeline_outlined,
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => RoundTimelinePage(test: widget.test),
            )),
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
              await Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => TestConclusionPage(test: widget.test),
              ));
              // A published conclusion shows as a pill on these rows, so the
              // list has to be re-read on the way back.
              if (mounted) await _refresh();
            },
          ),
        RecruiterAction(
          label: 'Delete test',
          icon: Icons.delete_forever_outlined,
          onPressed: _confirmDeleteTest,
          destructive: true,
        ),
      ],
    );
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
            ? 'No candidates in this test'
            : 'No matching candidates',
        subtitle: _query.isEmpty
            ? 'Assign this test to a candidate email to get started.'
            : 'Try a different name or email.',
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
          final continuation = grouping &&
              index > 0 &&
              candidateKey(items[index - 1]) == candidateKey(item);
          final lastOfCandidate = !grouping ||
              index == items.length - 1 ||
              candidateKey(items[index + 1]) != candidateKey(item);
          return Padding(
            // Tight under a row that has more rounds below it, so the group
            // reads as one candidate rather than several.
            padding: EdgeInsets.only(bottom: lastOfCandidate ? 10 : 4),
            child: _InterviewCard(
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
          child: Text('End of list',
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
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

/// "Round 2 · Technical screen" — which round of the test this row is.
///
/// `interview.title` is the ROUND's title (see `InterviewRound.assignTo`), and
/// falls back to the test's title for a round that was never named or for a
/// pre-timeline document. In that case the kind is the only informative half,
/// so it is used instead of echoing the test name that is already in the app
/// bar.
String _roundLabel(Interview i) {
  final n = i.effectiveRoundOrder + 1;
  final title = i.title.trim();
  final generic = title.isEmpty || title == i.testTitle.trim();
  return 'Round $n · ${generic ? i.effectiveRoundKind.label : title}';
}

class _InterviewCard extends StatelessWidget {
  final Interview interview;
  final List<Interview> groupInterviews;
  final int index;

  /// Name the round on this row. True in a test's all-rounds view, where a
  /// candidate has one row per round and the round is the only thing that tells
  /// those rows apart.
  final bool showRound;

  /// This row is another round of the candidate on the row above: it indents,
  /// drops the avatar, and leads with the round instead of repeating a name and
  /// email that are already directly above it.
  final bool continuation;

  const _InterviewCard({
    required this.interview,
    required this.groupInterviews,
    required this.index,
    this.showRound = false,
    this.continuation = false,
  });

  Widget _kv(BuildContext context, String k, String v) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              k,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          Expanded(
            child: Text(
              v,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }


  /// The small pill on the right of a candidate row: score, or why there isn't
  /// one.
  Widget _pill(ThemeData theme, String text, Color color, {IconData? icon}) =>
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          border: Border.all(color: color.withValues(alpha: 0.3)),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 10.5, color: color),
              const SizedBox(width: 3.5),
            ],
            Text(
              text,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      );

  Widget _buildDetailBadge(
      BuildContext context, String text, Color bgColor, Color textColor) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(8),
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
    final isDark = theme.brightness == Brightness.dark;
    final name = interview.candidateName?.isNotEmpty == true
        ? interview.candidateName!
        : interview.candidateEmail;
    final hasName = interview.candidateName?.isNotEmpty == true;

    final roundLabel = interview.hasRound ? _roundLabel(interview) : null;
    final conclusion = interview.testConclusion;
    final qs = interview.questions.length;
    final titleText =
        continuation ? (roundLabel ?? interview.title) : name;
    final subtitleText = [
      if (!continuation && hasName) interview.candidateEmail,
      if (!continuation && showRound && roundLabel != null) roundLabel,
      if (qs > 0)
        '$qs Qs'
      else if (roundLabel == null)
        interview.effectiveRoundKind.label,
    ].join(' · ');

    final score = interview.result != null ? interview.result!['overallScore'] : null;

    return Container(
      margin: continuation
          ? const EdgeInsets.only(left: 20)
          : EdgeInsets.zero,
      decoration: BoxDecoration(
        color: continuation
            ? (WarmSurfaces.surfaceHigh(context).withValues(alpha: 0.3))
            : (WarmSurfaces.surface(context)),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: WarmSurfaces.stroke(context)),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => _showDetail(context, interview),
          child: Padding(
            padding: EdgeInsets.all(continuation ? 10 : 13),
            child: Row(
              children: [
                if (continuation)
                  SizedBox(
                    width: 28,
                    height: 28,
                    child: Center(
                      child: Icon(
                        Icons.subdirectory_arrow_right,
                        size: 16,
                        color: isDark ? AppColors.textSubtle : theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  )
                else
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: WarmSurfaces.surfaceHigh(context),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: isDark ? AppColors.pastelCyan.withValues(alpha: 0.3) : theme.colorScheme.primary.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Center(
                      child: Text(
                        name.isNotEmpty ? name[0].toUpperCase() : 'C',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: isDark ? AppColors.pastelCyanText : theme.colorScheme.primary,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ),
                SizedBox(width: continuation ? 8 : 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        titleText,
                        style: TextStyle(
                          fontSize: continuation ? 13.5 : 14.5,
                          fontWeight: FontWeight.w600,
                          letterSpacing: -0.2,
                          color: isDark ? AppColors.textLight : theme.colorScheme.onSurface,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (subtitleText.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          subtitleText,
                          style: TextStyle(
                            fontSize: 12,
                            color: isDark ? AppColors.textMuted : theme.colorScheme.onSurfaceVariant,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _StatusChip(status: interview.status),
                    if (interview.evaluationFailed) ...[
                      const SizedBox(height: 5),
                      _pill(
                        theme,
                        'Scoring failed',
                        AppColors.danger,
                        icon: Icons.error_outline,
                      ),
                    ] else if (interview.awaitingRecruiterReview) ...[
                      const SizedBox(height: 5),
                      _pill(
                        theme,
                        'Awaiting score',
                        AppColors.warning,
                        icon: Icons.star_outline,
                      ),
                    ] else if (interview.awaitingEvaluation) ...[
                      const SizedBox(height: 5),
                      _pill(
                        theme,
                        'Not scored',
                        isDark ? AppColors.textSubtle : theme.colorScheme.onSurfaceVariant,
                      ),
                    ] else if (score != null) ...[
                      const SizedBox(height: 5),
                      _pill(
                        theme,
                        'Score: $score',
                        isDark ? AppColors.pastelMintText : theme.colorScheme.primary,
                      ),
                    ],
                    if (!continuation && conclusion != null) ...[
                      const SizedBox(height: 5),
                      _pill(
                        theme,
                        conclusion.outcome.recruiterLabel,
                        conclusion.outcome == TestOutcome.cleared
                            ? (isDark ? AppColors.pastelMintText : theme.colorScheme.primary)
                            : (isDark ? AppColors.textSubtle : theme.colorScheme.onSurfaceVariant),
                        icon: Icons.flag_outlined,
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }


  void _showDetail(BuildContext context, Interview initialInterview) {
    final theme = Theme.of(context);
    int activeIndex = index;

    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setStateSheet) {
          final i = groupInterviews[activeIndex];
          final completed = i.status == InterviewStatus.completed;

          return Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 32),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Candidate Navigation Header
                  if (groupInterviews.length > 1) ...[
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.arrow_back_ios_rounded, size: 16),
                          onPressed: activeIndex > 0
                              ? () => setStateSheet(() => activeIndex--)
                              : null,
                        ),
                        Text(
                          'Candidate ${activeIndex + 1} of ${groupInterviews.length}',
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                            color: theme.colorScheme.primary,
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.arrow_forward_ios_rounded, size: 16),
                          onPressed: activeIndex < groupInterviews.length - 1
                              ? () => setStateSheet(() => activeIndex++)
                              : null,
                        ),
                      ],
                    ),
                    const Divider(height: 16),
                  ],
                  Text(i.title,
                      style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      _buildDetailBadge(
                        sheetContext,
                        i.type.label,
                        theme.colorScheme.primaryContainer.withValues(alpha: 0.4),
                        theme.colorScheme.primary,
                      ),
                      const SizedBox(width: 8),
                      _buildDetailBadge(
                        sheetContext,
                        i.status.label,
                        theme.colorScheme.secondaryContainer.withValues(alpha: 0.4),
                        theme.colorScheme.secondary,
                      ),
                    ],
                  ),
                  const Divider(height: 32),
                  if (i.candidateName?.isNotEmpty == true)
                    _kv(sheetContext, 'Name', i.candidateName!),
                  _kv(sheetContext, 'Email', i.candidateEmail),
                  _kv(sheetContext, 'Duration', '${i.durationMinutes} min'),
                  _kv(sheetContext, 'Attempts',
                      i.maxAttempts == null ? 'Unlimited' : '${i.attemptsUsed}/${i.maxAttempts}'),
                  if (i.availableFrom != null)
                    _kv(sheetContext, 'From', formatDateTime(i.availableFrom!)),
                  if (i.expiresAt != null)
                    _kv(sheetContext, 'Expires',
                        '${formatDateTime(i.expiresAt!)}${i.isExpired ? '  (expired)' : ''}'),
                  _kv(
                      sheetContext,
                      'Result Status',
                      i.status != InterviewStatus.completed
                          ? 'Not taken yet'
                          : (i.result == null ||
                                  (i.result!['evaluatedBy'] as String? ?? '')
                                      .isEmpty)
                              // No score yet — either AI scoring hasn't landed
                              // (see candidate_video_shell.dart's placeholder
                              // result) or nobody has evaluated it manually.
                              ? 'Awaiting evaluation'
                              : i.resultPublished
                                  ? 'Published'
                                  : 'Draft — not published'),
                  if (i.result != null && i.result!['overallScore'] != null)
                    _kv(sheetContext, 'Overall Score', '${i.result!['overallScore']}/100'),
                  const Divider(height: 24),
                  Text('Prompt', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 6),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: theme.colorScheme.outline.withValues(alpha: 0.5)),
                    ),
                    child: Text(
                      i.prompt.isEmpty ? 'No custom prompt configured.' : i.prompt,
                      style: theme.textTheme.bodyMedium,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text('Questions', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 6),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.3),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: theme.colorScheme.outline.withValues(alpha: 0.5)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: i.questions.isEmpty
                          ? [Text('No questions configured.', style: theme.textTheme.bodyMedium)]
                          : i.questions.asMap().entries.map(
                                (e) => Padding(
                                  padding: const EdgeInsets.only(bottom: 6),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '${e.key + 1}. ',
                                        style: TextStyle(
                                          fontWeight: FontWeight.w600,
                                          color: theme.colorScheme.primary,
                                        ),
                                      ),
                                      Expanded(
                                        child: Text(
                                          e.value,
                                          style: theme.textTheme.bodyMedium,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ).toList(),
                    ),
                  ),
                  const SizedBox(height: 24),
                  // A two-way round is a live call with this candidate. Before
                  // it happens, joining is the action; after, scoring it is —
                  // there is no recording, so the recruiter who was in the room
                  // is the only scorer.
                  if (i.effectiveRoundKind == RoundKind.twoWay) ...[
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: FilledButton.icon(
                        onPressed: () {
                          Navigator.pop(sheetContext);
                          Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) =>
                                LiveInterviewPage(interview: i, isHost: true),
                          ));
                        },
                        icon: const Icon(Icons.videocam_outlined, size: 18),
                        label: Text(completed
                            ? 'Rejoin live interview'
                            : 'Join live interview'),
                      ),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: OutlinedButton.icon(
                        onPressed: () {
                          Navigator.pop(sheetContext);
                          _openTwoWayReview(context, i);
                        },
                        icon: const Icon(Icons.star_outline, size: 18),
                        label: Text(i.twoWayStars != null
                            ? 'Edit your score (${i.twoWayStars}/5)'
                            : 'Score this interview'),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (completed && i.effectiveRoundKind != RoundKind.twoWay)
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: FilledButton.icon(
                        onPressed: () {
                          Navigator.pop(sheetContext);
                          Navigator.of(context).push(MaterialPageRoute(
                            builder: (_) => EvaluateInterviewPage(
                              interview: i,
                              groupInterviews: groupInterviews,
                              initialIndex: activeIndex,
                            ),
                          ));
                        },
                        icon: const Icon(Icons.fact_check_outlined, size: 18),
                        label: Text(i.resultPublished
                            ? 'Review / edit result'
                            : 'Evaluate & publish'),
                      ),
                    ),
                  if (i.result != null) ...[
                    const SizedBox(height: 12),
                    SizedBox(
                      height: 48,
                      width: double.infinity,
                      child: OutlinedButton.icon(
                        // Clears the answers/report but keeps the candidate
                        // assigned, so they can retake — unlike "Delete", which
                        // removes them from the test entirely.
                        onPressed: () => _confirmClearResult(context, i),
                        icon: const Icon(Icons.restart_alt_rounded, size: 18),
                        label: const Text('Delete response (allow retake)'),
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: SizedBox(
                          height: 48,
                          child: OutlinedButton.icon(
                            onPressed: () {
                              Navigator.pop(sheetContext);
                              Navigator.of(context).push(MaterialPageRoute(
                                builder: (_) => CreateInterviewPage(existing: i),
                              ));
                            },
                            icon: const Icon(Icons.edit_outlined, size: 18),
                            label: const Text('Edit'),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: SizedBox(
                          height: 48,
                          child: OutlinedButton.icon(
                            onPressed: () => _confirmDelete(context, i),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: theme.colorScheme.error,
                              side: BorderSide(color: theme.colorScheme.error.withValues(alpha: 0.5)),
                            ),
                            icon: const Icon(Icons.delete_outline, size: 18),
                            label: const Text('Delete'),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        }
      ),
    );
  }

  /// Wipes this candidate's answers + AI report and returns them to "assigned"
  /// so they can sit the test again. Keeps the assignment itself.
  /// Opens the star-and-notes sheet for a live interview the recruiter ran.
  Future<void> _openTwoWayReview(BuildContext context, Interview i) async {
    final repo = context.read<InterviewRepository>();
    final messenger = ScaffoldMessenger.of(context);
    final review = await showTwoWayReviewSheet(context, i);
    if (review == null) return;
    try {
      await repo.saveTwoWayReview(i.id,
          stars: review.stars, notes: review.notes);
      messenger.showSnackBar(const SnackBar(
          content: Text('Score saved. Publish it from the round when ready.')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not save: $e')));
    }
  }

  Future<void> _confirmClearResult(BuildContext context, Interview i) async {
    final repo = context.read<InterviewRepository>();
    final messenger = ScaffoldMessenger.of(context);
    final name = i.candidateName?.trim().isNotEmpty == true
        ? i.candidateName!.trim()
        : i.candidateEmail;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete this response?'),
        content: Text(
          "$name's answers and AI report for this test will be permanently "
          'deleted, and they will be able to take it again. The assignment '
          'itself is kept.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Delete response',
                style: TextStyle(color: Theme.of(ctx).colorScheme.error)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await repo.clearResult(i.id);
      if (context.mounted) Navigator.pop(context); // close the detail sheet
      messenger.showSnackBar(
          const SnackBar(content: Text('Response deleted; candidate can retake.')));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not delete: $e')));
    }
  }

  Future<void> _confirmDelete(BuildContext context, Interview i) async {
    final repo = context.read<InterviewRepository>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Remove candidate from test?'),
        content: Text(
          'This deletes the assignment AND any response for “${i.title}”. '
          'The candidate will no longer see this test at all. To wipe only '
          'their answers and let them retake, use "Delete response" instead.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    await repo.delete(i.id);
    if (context.mounted) Navigator.pop(context); // close the detail sheet
  }
}

class _StatusChip extends StatelessWidget {
  final InterviewStatus status;
  const _StatusChip({required this.status});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    Color color;
    switch (status) {
      case InterviewStatus.completed:
        color = isDark ? AppColors.pastelMintText : AppColors.success;
        break;
      case InterviewStatus.inProgress:
        color = isDark ? AppColors.pastelCyanText : AppColors.accent;
        break;
      case InterviewStatus.assigned:
        color = isDark ? AppColors.textMuted : theme.colorScheme.onSurfaceVariant;
        break;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: color.withValues(alpha: 0.25),
          width: 1,
        ),
      ),
      child: Text(
        status.label,
        style: TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w600,
          color: color,
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
      title: const Text('Delete entire test?'),
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
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
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
            'Delete test',
            style: TextStyle(color: theme.colorScheme.error),
          ),
        ),
      ],
    );
  }
}

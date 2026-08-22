// lib/features/interviews/recruiter/recruiter_home.dart
//
// Recruiter landing surface (the Home tab of RecruiterShell): the list of TESTS
// this recruiter created. Tapping a test opens TestCandidatesPage, which loads
// that test's candidates in pages.
//
// Why tests and not candidates: this screen used to stream every interview and
// group them client-side, so a recruiter with 1,000 candidates paid one enormous
// read and built 1,000 widgets before seeing anything. Tests now have their own
// `tests/{testId}` metadata docs (see TestSummary), so the dashboard reads a few
// dozen tiny documents and defers candidate reads until a test is opened.
//
// Tests created before that collection existed have no metadata doc, so the
// first load backfills them from the existing interviews (idempotent — see
// InterviewRepository.backfillTests). "Rebuild test list" in the app bar re-runs
// it on demand if anything ever drifts.

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/core/theme/desktop_tokens.dart';
import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';
import 'package:talbotiq/shared/widgets/desktop_page_container.dart';
import 'package:talbotiq/shared/widgets/logout_button.dart';
import 'package:talbotiq/shared/widgets/responsive_grid.dart';
import 'package:talbotiq/shared/widgets/section_header.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/test_summary.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/features/interviews/recruiter/create_interview_page.dart';
import 'package:talbotiq/features/interviews/recruiter/test_candidates_page.dart';
import 'package:talbotiq/features/recruiter/views/management/recruiter_library_page.dart';

class RecruiterHome extends StatefulWidget {
  const RecruiterHome({super.key});

  @override
  State<RecruiterHome> createState() => _RecruiterHomeState();
}

class _RecruiterHomeState extends State<RecruiterHome> {
  final _scroll = ScrollController();
  final _searchCtrl = TextEditingController();

  final List<TestSummary> _tests = [];
  DocumentSnapshot<Map<String, dynamic>>? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  bool _backfilling = false;
  Object? _error;

  /// Guards the automatic backfill so an empty-but-legitimate account doesn't
  /// re-scan its interviews on every page load.
  bool _triedBackfill = false;

  String _query = '';
  Timer? _debounce;

  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';

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
    if (remaining < 300) _loadMore();
  }

  void _onSearchChanged(String raw) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      setState(() => _query = raw.trim());
    });
  }

  Future<void> _refresh({bool allowBackfill = true}) async {
    setState(() {
      _tests.clear();
      _cursor = null;
      _hasMore = true;
      _error = null;
    });
    await _loadMore();
    if (!mounted) return;

    // No metadata docs but interviews exist => tests predate this collection.
    // Backfill once, then reload.
    if (allowBackfill && _tests.isEmpty && !_triedBackfill) {
      _triedBackfill = true;
      await _runBackfill(silent: true);
    }
  }

  Future<void> _runBackfill({bool silent = false}) async {
    if (_backfilling) return;
    setState(() => _backfilling = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final n =
          await context.read<InterviewRepository>().backfillTests(_uid);
      if (!mounted) return;
      setState(() => _backfilling = false);
      if (n > 0) {
        await _refresh(allowBackfill: false);
        if (!silent && mounted) {
          messenger.showSnackBar(
            SnackBar(content: Text('$n test(s) found.')),
          );
        }
      } else if (!silent) {
        messenger.showSnackBar(
          const SnackBar(content: Text('Nothing to rebuild.')),
        );
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _backfilling = false);
      if (!silent) {
        messenger.showSnackBar(SnackBar(content: Text('Rebuild failed: $e')));
      }
    }
  }

  Future<void> _loadMore() async {
    if (_loading || !_hasMore) return;
    setState(() => _loading = true);
    try {
      final page = await context
          .read<InterviewRepository>()
          .fetchTestsPage(recruiterId: _uid, startAfter: _cursor);
      if (!mounted) return;
      setState(() {
        _tests.addAll(page.items);
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

  /// Tests are few, so title filtering over the loaded pages is enough — no
  /// server-side search needed at this level.
  List<TestSummary> get _visible {
    if (_query.isEmpty) return _tests;
    final q = _query.toLowerCase();
    return _tests.where((t) => t.title.toLowerCase().contains(q)).toList();
  }

  void _create() {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => const CreateInterviewPage()))
        .then((_) {
      // A newly created test needs to appear without a manual pull-to-refresh.
      if (mounted) _refresh(allowBackfill: false);
    });
  }

  void _open(TestSummary t) {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => TestCandidatesPage(test: t)))
        // Counts may have changed (publish, delete), so re-read on return.
        .then((_) {
      if (mounted) setState(() {});
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (isDesktopPlatform) return _buildDesktop(theme);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        title: const _Wordmark(subtitle: 'Recruiter'),
        actions: [
          IconButton(
            tooltip: 'Manage templates & library',
            icon: const Icon(Icons.folder_special_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                  builder: (_) => const RecruiterLibraryPage()),
            ),
          ),
          const LogoutButton(),
          const SizedBox(width: 4),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _create,
        icon: const Icon(Icons.add),
        label: const Text('Create interview'),
      ),
      body: Column(
        children: [
          if (_tests.isNotEmpty) _searchBar(),
          Expanded(child: _body(theme)),
        ],
      ),
    );
  }

  /// Same state, same _searchBar()/_body() as mobile — only the chrome
  /// around them changes: a page header with the primary "Create interview"
  /// action instead of an AppBar + FAB, matching the desktop redesign's
  /// header pattern. The top nav (RecruiterShell) already owns the
  /// wordmark/logout for desktop, so this doesn't repeat them.
  Widget _buildDesktop(ThemeData theme) {
    return DesktopPageContainer(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            title: 'Interviews',
            subtitle: 'Manage the interview tests you’ve created and their candidates.',
            isPageTitle: true,
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const RecruiterLibraryPage()),
                  ),
                  icon: const Icon(Icons.folder_special_outlined, size: 18),
                  label: const Text('Library'),
                ),
                const SizedBox(width: 12),
                FilledButton.icon(
                  onPressed: _create,
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Create interview'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          if (_tests.isNotEmpty) _desktopSearchBar(theme),
          if (_tests.isNotEmpty) const SizedBox(height: 20),
          Expanded(child: _body(theme)),
        ],
      ),
    );
  }

  /// Same controller/debounce as mobile's [_searchBar] — only the visual
  /// treatment differs: a taller, bordered field matching the desktop
  /// card surface instead of the compact mobile field.
  Widget _desktopSearchBar(ThemeData theme) {
    final scheme = theme.colorScheme;
    return TextField(
      controller: _searchCtrl,
      onChanged: _onSearchChanged,
      textInputAction: TextInputAction.search,
      style: theme.textTheme.bodyMedium,
      decoration: InputDecoration(
        hintText: 'Search tests by name',
        prefixIcon: Icon(Icons.search, size: 20, color: scheme.onSurfaceVariant),
        suffixIcon: _searchCtrl.text.isEmpty
            ? null
            : IconButton(
                icon: const Icon(Icons.close, size: 18),
                tooltip: 'Clear search',
                onPressed: () {
                  _searchCtrl.clear();
                  _onSearchChanged('');
                },
              ),
        filled: true,
        fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.25),
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesktopTokens.cardRadius),
          borderSide: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.3)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesktopTokens.cardRadius),
          borderSide: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.3)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesktopTokens.cardRadius),
          borderSide: BorderSide(color: scheme.primary, width: 1.5),
        ),
      ),
    );
  }

  Widget _searchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: TextField(
        controller: _searchCtrl,
        onChanged: _onSearchChanged,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          isDense: true,
          hintText: 'Search tests by name',
          prefixIcon: const Icon(Icons.search, size: 20),
          suffixIcon: _searchCtrl.text.isEmpty
              ? null
              : IconButton(
                  icon: const Icon(Icons.close, size: 18),
                  tooltip: 'Clear search',
                  onPressed: () {
                    _searchCtrl.clear();
                    _onSearchChanged('');
                  },
                ),
        ),
      ),
    );
  }

  Widget _body(ThemeData theme) {
    // FAILED, not empty — with a retry. Rendered as a message before, which meant a
    // recruiter whose request 503'd was told something that reads like "you have no
    // tests" and went looking for deleted data.
    if (_error != null && _tests.isEmpty) {
      return AppErrorState(
        title: 'Could not load your tests',
        detail: '$_error',
        onRetry: () => _refresh(),
      );
    }
    // Shaped like the rows that are coming, so the page does not jump when they land.
    if (_tests.isEmpty && (_loading || _backfilling)) {
      return const AppSkeletonList(rows: 4);
    }
    final items = _visible;
    if (items.isEmpty) {
      // A search that matched nothing is NOT an empty account, and the two want
      // different things: clear the filter, versus create the first test.
      if (_query.isNotEmpty) {
        return AppNoResults(
          query: _query,
          onClear: () {
            _searchCtrl.clear();
            setState(() => _query = '');
          },
        );
      }
      return AppEmptyState(
        icon: Icons.inbox_outlined,
        title: 'No interviews yet',
        description: 'Create one and assign it to a candidate email.',
      );
    }
    if (isDesktopPlatform) return _desktopGrid(theme, items);
    return RefreshIndicator(
      onRefresh: () => _refresh(allowBackfill: false),
      child: ListView.builder(
        controller: _scroll,
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        itemCount: items.length + 1,
        itemBuilder: (context, index) {
          if (index == items.length) return _pagerRow(theme);
          final test = items[index];
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _TestRow(test: test, onTap: () => _open(test)),
          );
        },
      ),
    );
  }

  /// Desktop: the same test list, as a responsive card grid instead of
  /// full-width rows — [ResponsiveGrid] (already used by the Library page)
  /// picks the column count from the available width, so 1280px-class
  /// windows land at ~3 columns and ultrawide ones at the 4-column cap
  /// without any hardcoded breakpoints. Same [_scroll] controller as before,
  /// so the existing near-bottom pagination trigger in [_onScroll] is
  /// unaffected by the ListView → Column swap.
  Widget _desktopGrid(ThemeData theme, List<TestSummary> items) {
    return RefreshIndicator(
      onRefresh: () => _refresh(allowBackfill: false),
      child: SingleChildScrollView(
        controller: _scroll,
        padding: const EdgeInsets.only(bottom: 40),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ResponsiveGrid(
              tileMinWidth: 300,
              spacing: 16,
              minPerRow: 1,
              maxPerRow: 4,
              children: [
                for (final test in items)
                  _DesktopInterviewCard(test: test, onTap: () => _open(test)),
              ],
            ),
            _pagerRow(theme),
          ],
        ),
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
              child: CircularProgressIndicator(strokeWidth: 2)),
        ),
      );
    }
    if (!_hasMore) return const SizedBox(height: 8);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Center(
        child: TextButton(
            onPressed: _loadMore, child: const Text('Load more tests')),
      ),
    );
  }
}

IconData _testTypeIcon(InterviewType type) => switch (type) {
      InterviewType.video => Icons.videocam_outlined,
      InterviewType.voice => Icons.record_voice_over_outlined,
      InterviewType.chat => Icons.chat_bubble_outline,
    };

/// Loads a test's candidate/completed totals from count() aggregates (never
/// the test's interviews, so the dashboard never reads candidate documents)
/// and hands them to [builder]. Shared by both the mobile row and the
/// desktop row so the fetch logic exists in exactly one place.
class _TestCounts extends StatefulWidget {
  final TestSummary test;
  final Widget Function(BuildContext context, int total, int completed)
      builder;
  const _TestCounts({required this.test, required this.builder});

  @override
  State<_TestCounts> createState() => _TestCountsState();
}

class _TestCountsState extends State<_TestCounts> {
  int _total = -1;
  int _completed = -1;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final repo = context.read<InterviewRepository>();
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    final total = await repo.countForRecruiter(
        recruiterId: uid, testId: widget.test.testId);
    final done = await repo.countForRecruiter(
        recruiterId: uid,
        testId: widget.test.testId,
        status: InterviewStatus.completed);
    if (!mounted) return;
    setState(() {
      _total = total;
      _completed = done;
    });
  }

  @override
  Widget build(BuildContext context) =>
      widget.builder(context, _total, _completed);
}

/// One test row (mobile/web).
class _TestRow extends StatelessWidget {
  final TestSummary test;
  final VoidCallback onTap;
  const _TestRow({required this.test, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return _TestCounts(
      test: test,
      builder: (context, total, completed) {
        final theme = Theme.of(context);
        final counts = total < 0
            ? 'Loading…'
            : '$total candidate(s)'
                '${completed >= 0 ? ' · $completed completed' : ''}';

        return Card(
          margin: EdgeInsets.zero,
          child: InkWell(
            borderRadius: BorderRadius.circular(24),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primary.withValues(alpha: 0.12),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(_testTypeIcon(test.type),
                        size: 20, color: theme.colorScheme.primary),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(test.title,
                            style: theme.textTheme.titleSmall
                                ?.copyWith(fontWeight: FontWeight.bold),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis),
                        const SizedBox(height: 4),
                        Text(counts, style: theme.textTheme.bodySmall),
                        if (test.createdAt != null) ...[
                          const SizedBox(height: 2),
                          Text(formatDateTime(test.createdAt!),
                              style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant)),
                        ],
                      ],
                    ),
                  ),
                  Icon(Icons.chevron_right_rounded,
                      color: theme.colorScheme.onSurfaceVariant),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// One interview card (desktop): premium-SaaS card for the responsive grid —
/// icon top-left, chevron top-right, name as the strongest text, then
/// candidate/completion counts (secondary) and date (muted/tertiary) below,
/// with the same hover polish the old desktop row had. Same [_TestCounts]
/// data-loading, same [onTap] destination as mobile — only the layout
/// (row → card) changed.
class _DesktopInterviewCard extends StatefulWidget {
  final TestSummary test;
  final VoidCallback onTap;
  const _DesktopInterviewCard({required this.test, required this.onTap});

  @override
  State<_DesktopInterviewCard> createState() => _DesktopInterviewCardState();
}

class _DesktopInterviewCardState extends State<_DesktopInterviewCard> {
  bool _hovering = false;

  @override
  Widget build(BuildContext context) {
    return _TestCounts(
      test: widget.test,
      builder: (context, total, completed) {
        final theme = Theme.of(context);
        final scheme = theme.colorScheme;
        final counts = total < 0
            ? 'Loading…'
            : '$total candidate(s)'
                '${completed >= 0 ? ' · $completed completed' : ''}';

        return MouseRegion(
          cursor: SystemMouseCursors.click,
          onEnter: (_) => setState(() => _hovering = true),
          onExit: (_) => setState(() => _hovering = false),
          child: GestureDetector(
            onTap: widget.onTap,
            behavior: HitTestBehavior.opaque,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 120),
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                color: _hovering
                    ? scheme.surfaceContainerHighest.withValues(alpha: 0.4)
                    : scheme.surfaceContainerHighest.withValues(alpha: 0.25),
                borderRadius: BorderRadius.circular(DesktopTokens.cardRadius),
                border: Border.all(
                  color: _hovering
                      ? scheme.primary.withValues(alpha: 0.3)
                      : scheme.outlineVariant.withValues(alpha: 0.3),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: scheme.primary.withValues(alpha: 0.12),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(_testTypeIcon(widget.test.type),
                            size: 20, color: scheme.primary),
                      ),
                      const Spacer(),
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 120),
                        child: Icon(
                          Icons.chevron_right_rounded,
                          color: _hovering ? scheme.primary : scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Text(widget.test.title,
                      style: theme.textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w700),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 6),
                  Text(counts,
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: scheme.onSurfaceVariant)),
                  if (widget.test.createdAt != null) ...[
                    const SizedBox(height: 4),
                    Text(formatDateTime(widget.test.createdAt!),
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: scheme.onSurfaceVariant.withValues(alpha: 0.75),
                            fontSize: 11.5)),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _Wordmark extends StatelessWidget {
  final String subtitle;
  const _Wordmark({required this.subtitle});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        RichText(
          text: TextSpan(
            style: theme.textTheme.titleLarge
                ?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.5),
            children: [
              const TextSpan(text: 'talbot'),
              TextSpan(
                  text: 'iq',
                  style: TextStyle(color: theme.colorScheme.primary)),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Text('· $subtitle',
            style: theme.textTheme.bodyMedium
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
      ],
    );
  }
}

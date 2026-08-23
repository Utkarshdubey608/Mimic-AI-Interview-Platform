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

import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/core/theme/desktop_tokens.dart';
import 'package:talbotiq/core/utils/date_format.dart';
import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';
import 'package:talbotiq/shared/widgets/desktop_page_container.dart';
import 'package:talbotiq/shared/widgets/logout_button.dart';
import 'package:talbotiq/shared/widgets/responsive_grid.dart';
import 'package:talbotiq/shared/widgets/section_header.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/models/test_summary.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/features/interviews/recruiter/create_interview_page.dart';
import 'package:talbotiq/features/interviews/recruiter/round_timeline_page.dart';
import 'package:talbotiq/features/interviews/recruiter/test_candidates_page.dart';
import 'package:talbotiq/features/recruiter/views/management/recruiter_library_page.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'package:talbotiq/core/theme/status_tones.dart';


class RecruiterHome extends StatefulWidget {
  const RecruiterHome({super.key});

  @override
  State<RecruiterHome> createState() => RecruiterHomeState();
}

/// Public so [RecruiterShell] can reach [createInterview] through a
/// GlobalKey: the "+" now lives in the bottom bar, but creating a test still
/// has to run this page's create-then-refresh sequence, not a copy of it.
class RecruiterHomeState extends State<RecruiterHome> {
  final _scroll = ScrollController();
  final _searchCtrl = TextEditingController();

  final List<TestSummary> _tests = [];
  DocumentSnapshot<Map<String, dynamic>>? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  bool _backfilling = false;
  bool _triedTitleRepair = false;
  Object? _error;

  /// Guards the automatic backfill so an empty-but-legitimate account doesn't
  /// re-scan its interviews on every page load.
  bool _triedBackfill = false;

  String _query = '';
  Timer? _debounce;
  InterviewType? _selectedType;

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

    // Tests indexed before titleVersion 2 used the newest assignment's
    // `title`, which is the last round's name in a timeline. Rebuild that
    // compact index once so existing pipelines immediately regain their own
    // test name without asking the recruiter to recreate anything.
    if (allowBackfill &&
        !_triedTitleRepair &&
        _tests.any((test) =>
            test.titleVersion < TestSummary.titleSchemaVersion)) {
      _triedTitleRepair = true;
      await _runBackfill(silent: true);
      return;
    }

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
            SnackBar(content: Text('$n pipeline(s) found.')),
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

  /// Tests are filtered by both title search and category pill.
  List<TestSummary> get _visible {
    var list = _tests;
    if (_selectedType != null) {
      list = list.where((t) => t.type == _selectedType).toList();
    }
    if (_query.isNotEmpty) {
      final q = _query.toLowerCase();
      list = list.where((t) => t.title.toLowerCase().contains(q)).toList();
    }
    return list;
  }

  int get _videoCount =>
      _tests.where((t) => t.type == InterviewType.video).length;
  int get _voiceCount =>
      _tests.where((t) => t.type == InterviewType.voice).length;
  int get _chatCount =>
      _tests.where((t) => t.type == InterviewType.chat).length;

  /// Opens the create flow and refreshes this list on return. Called both by
  /// the page's own empty-state button and by the shell's bottom-bar action.
  void createInterview() => _create();

  void _create() {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => const CreateInterviewPage()))
        .then((_) {
      // A newly created test needs to appear without a manual pull-to-refresh.
      if (mounted) _refresh(allowBackfill: false);
    });
  }

  /// A multi-round test's home is its timeline, not the flat candidate list.
  void _openTimeline(TestSummary t) {
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => RoundTimelinePage(test: t)))
        // Ending or rescheduling a round changes what this row says, so the
        // list re-reads on return exactly as it does after the candidate list.
        .then((_) {
      if (mounted) setState(() {});
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

  String _getGreeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  String _getUserName() {
    final user = FirebaseAuth.instance.currentUser;
    if (user?.displayName != null && user!.displayName!.trim().isNotEmpty) {
      return user.displayName!.trim().split(' ').first;
    }
    if (user?.email != null && user!.email!.trim().isNotEmpty) {
      return user.email!.trim().split('@').first;
    }
    return 'Recruiter';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (isDesktopPlatform) return _buildDesktop(theme);

    final items = _visible;

    // Warm ground for this screen only — the shared scaffold colour stays as
    // it is for every other page.
    return RecruiterScaffold(
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () => _refresh(allowBackfill: false),
          color: AppColors.blockInk,
          backgroundColor: WarmSurfaces.block(context),
          child: CustomScrollView(
            controller: _scroll,
            physics: const AlwaysScrollableScrollPhysics(
              parent: BouncingScrollPhysics(),
            ),
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                      AppSpacing.page, AppSpacing.md, AppSpacing.page, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      RecruiterProfileHeader(
                        initial: _getUserName().characters.firstOrNull ?? 'R',
                        title: '${_getGreeting()}, ${_getUserName()}',
                        subtitle: 'Recruiter',
                        actions: [
                          _headerIcon(
                            icon: Icons.logout_rounded,
                            tooltip: 'Sign out',
                            onPressed: () => LogoutButton.signOut(context),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.xl),

                      // The screen's subject as one large figure, with the
                      // three things a recruiter opens this page to do.
                      RecruiterHeroBlock(
                        kicker: 'Your workspace',
                        value: '${_tests.length}',
                        unit: _tests.length == 1 ? 'pipeline' : 'pipelines',
                        caption: _heroCaption(),
                        actions: [
                          RecruiterCircleAction(
                            icon: Icons.add_rounded,
                            label: 'Create',
                            onPressed: _create,
                          ),
                          RecruiterCircleAction(
                            icon: Icons.folder_outlined,
                            label: 'Library',
                            onPressed: () => Navigator.of(context).push(
                              MaterialPageRoute(
                                  builder: (_) => const RecruiterLibraryPage()),
                            ),
                          ),
                          RecruiterCircleAction(
                            icon: Icons.autorenew_rounded,
                            label: 'Rebuild',
                            busy: _backfilling,
                            // Same repair action the app bar used to carry:
                            // re-runs the idempotent test backfill.
                            onPressed:
                                _backfilling ? null : () => _runBackfill(),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.xl),

                      if (_tests.isNotEmpty) ...[
                        _FilterPillRow(
                          selectedType: _selectedType,
                          onSelect: (t) => setState(() => _selectedType = t),
                          totalCount: _tests.length,
                          videoCount: _videoCount,
                          voiceCount: _voiceCount,
                          chatCount: _chatCount,
                        ),
                        const SizedBox(height: AppSpacing.md),
                        _compactSearchBar(theme),
                        const SizedBox(height: AppSpacing.xl),
                      ],

                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Pipelines',
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w700,
                                letterSpacing: -0.3,
                                color: WarmSurfaces.ink(context),
                              ),
                            ),
                          ),
                          if (_tests.isNotEmpty)
                            Text(
                              '${items.length} '
                              '${items.length == 1 ? 'pipeline' : 'pipelines'}',
                              style: TextStyle(
                                fontSize: 12.5,
                                color: WarmSurfaces.inkMuted(context),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.md),
                    ],
                  ),
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(AppSpacing.page, 0,
                    AppSpacing.page, AppSpacing.navClearance),
                sliver: _buildListContent(theme, items),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// The line under the hero figure. States what is actually known rather than
  /// inventing a metric: the type split once there are tests, and the error or
  /// loading condition when there is nothing to split.
  String _heroCaption() {
    if (_error != null && _tests.isEmpty) return 'Could not load your pipelines';
    if (_tests.isEmpty) return _loading ? 'Loading…' : 'Nothing created yet';
    final parts = <String>[
      if (_videoCount > 0) '$_videoCount video',
      if (_voiceCount > 0) '$_voiceCount voice',
      if (_chatCount > 0) '$_chatCount chat',
    ];
    return parts.isEmpty ? 'Ready to assign' : parts.join(' · ');
  }

  /// Trailing icon button in the profile header.
  Widget _headerIcon({
    required IconData icon,
    required String tooltip,
    required VoidCallback onPressed,
  }) {
    return IconButton(
      visualDensity: VisualDensity.compact,
      iconSize: 19,
      padding: const EdgeInsets.all(AppSpacing.sm - 2),
      constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
      tooltip: tooltip,
      icon: Icon(icon, color: WarmSurfaces.inkMuted(context)),
      onPressed: onPressed,
    );
  }

  Widget _compactSearchBar(ThemeData theme) {
    return Container(
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
        style: TextStyle(fontSize: 13.5, color: WarmSurfaces.ink(context)),
        decoration: InputDecoration(
          isDense: true,
          filled: false,
          hintText: 'Search pipelines…',
          hintStyle: TextStyle(fontSize: 13, color: WarmSurfaces.inkSubtle(context)),
          prefixIcon: Icon(
            Icons.search_rounded,
            size: 18,
            color: WarmSurfaces.inkMuted(context),
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
    );
  }

  Widget _buildListContent(ThemeData theme, List<TestSummary> items) {
    if (_error != null && _tests.isEmpty) {
      return SliverToBoxAdapter(
        child: AppErrorState(
          title: 'Could not load your pipelines',
          detail: '$_error',
          onRetry: () => _refresh(),
        ),
      );
    }

    if (_tests.isEmpty && (_loading || _backfilling)) {
      return const SliverToBoxAdapter(
        child: _CompactSkeletonList(count: 4),
      );
    }

    if (items.isEmpty) {
      if (_query.isNotEmpty || _selectedType != null) {
        return SliverToBoxAdapter(
          child: _CompactNoResults(
            query: _query,
            onClear: () {
              _searchCtrl.clear();
              setState(() {
                _query = '';
                _selectedType = null;
              });
            },
          ),
        );
      }
      return SliverToBoxAdapter(
        child: _CompactEmptyState(onCreate: _create),
      );
    }

    // Flat grouped list container with thin hairline dividers
    return SliverToBoxAdapter(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
        decoration: BoxDecoration(
          color: WarmSurfaces.surface(context),
          borderRadius: BorderRadius.circular(AppRadius.card + 4),
          border: Border.all(color: WarmSurfaces.stroke(context)),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppRadius.card + 4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (int i = 0; i < items.length; i++) ...[
                if (i > 0)
                  Divider(
                    height: 1,
                    thickness: 1,
                    color: WarmSurfaces.stroke(context),
                  ),
                _CompactTestRow(
                  test: items[i],
                  onTap: () => _open(items[i]),
                  onOpenTimeline: () => _openTimeline(items[i]),
                ),
              ],
              if (_hasMore || _loading) ...[
                Divider(
                  height: 1,
                  thickness: 1,
                  color: WarmSurfaces.stroke(context),
                ),
                _pagerRow(theme),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// Desktop layout remains compatible.
  Widget _buildDesktop(ThemeData theme) {
    return DesktopPageContainer(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            title: 'Pipelines',
            subtitle:
                'Manage the pipelines you’ve created and their candidates.',
            isPageTitle: true,
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextButton.icon(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(
                        builder: (_) => const RecruiterLibraryPage()),
                  ),
                  icon: const Icon(Icons.folder_outlined, size: 18),
                  label: const Text('Library'),
                ),
                const SizedBox(width: 12),
                FilledButton.icon(
                  onPressed: _create,
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Create pipeline'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          if (_tests.isNotEmpty) _desktopSearchBar(theme),
          if (_tests.isNotEmpty) const SizedBox(height: 20),
          Expanded(child: _desktopBody(theme)),
        ],
      ),
    );
  }

  Widget _desktopSearchBar(ThemeData theme) {
    final scheme = theme.colorScheme;
    return TextField(
      controller: _searchCtrl,
      onChanged: _onSearchChanged,
      textInputAction: TextInputAction.search,
      style: theme.textTheme.bodyMedium,
      decoration: InputDecoration(
        hintText: 'Search pipelines by name',
        prefixIcon:
            Icon(Icons.search, size: 20, color: scheme.onSurfaceVariant),
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
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesktopTokens.cardRadius),
          borderSide:
              BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.3)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesktopTokens.cardRadius),
          borderSide:
              BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.3)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesktopTokens.cardRadius),
          borderSide: BorderSide(color: scheme.primary, width: 1.5),
        ),
      ),
    );
  }

  Widget _desktopBody(ThemeData theme) {
    if (_error != null && _tests.isEmpty) {
      return AppErrorState(
        title: 'Could not load your pipelines',
        detail: '$_error',
        onRetry: () => _refresh(),
      );
    }
    if (_tests.isEmpty && (_loading || _backfilling)) {
      return const AppSkeletonList(rows: 4);
    }
    final items = _visible;
    if (items.isEmpty) {
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
        title: 'No pipelines yet',
        description: 'Create one and assign it to a candidate email.',
      );
    }
    return _desktopGrid(theme, items);
  }

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
                  _DesktopInterviewCard(
                    test: test,
                    onTap: () => _open(test),
                    onOpenTimeline: () => _openTimeline(test),
                  ),
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
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(
          child: SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2)),
        ),
      );
    }
    if (!_hasMore) return const SizedBox(height: 8);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Center(
        child: TextButton(
            onPressed: _loadMore,
            child: const Text('Load more pipelines', style: TextStyle(fontSize: 13))),
      ),
    );
  }
}

IconData _testTypeIcon(InterviewType type) => switch (type) {
      InterviewType.video => Icons.videocam_outlined,
      InterviewType.voice => Icons.mic_none_outlined,
      InterviewType.chat => Icons.chat_bubble_outline_rounded,
    };

Color _testTypeColor(InterviewType type) => switch (type) {
      InterviewType.video => AppColors.pastelCyanText,
      InterviewType.voice => AppColors.pastelMintText,
      InterviewType.chat => AppColors.pastelLavenderText,
    };

String _testTypeLabel(InterviewType type) => switch (type) {
      InterviewType.video => 'Video',
      InterviewType.voice => 'Voice',
      InterviewType.chat => 'Chat',
    };

/// Loads a test's candidate/completed totals from count() aggregates (never
/// the test's interviews, so the dashboard never reads candidate documents)
/// and hands them to [builder].
/// Per-row lazy load of the things a test's document deliberately does NOT
/// store: its candidate counts (count() aggregates, see TestSummary's note on
/// why they aren't denormalised) and its rounds.
///
/// The rounds query is one extra read per visible row. That is the same
/// bargain the counts already make — a handful of tiny reads per row, only for
/// rows actually on screen — and it is what lets the dashboard say "Round 2 of
/// 4, closes in 2d" without a denormalised field that could drift.
class _TestCounts extends StatefulWidget {
  final TestSummary test;
  final Widget Function(
    BuildContext context,
    int total,
    int completed,
    RoundPipelineStatus? pipeline,
  ) builder;
  const _TestCounts({required this.test, required this.builder});

  @override
  State<_TestCounts> createState() => _TestCountsState();
}

class _TestCountsState extends State<_TestCounts> {
  int _total = -1;
  int _completed = -1;
  RoundPipelineStatus? _pipeline;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final repo = context.read<InterviewRepository>();
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';

    // Counts and rounds are independent, so they go out together rather than
    // one after the other — three sequential round trips per row would be
    // visible as the list settles.
    final results = await Future.wait([
      repo.countForRecruiter(recruiterId: uid, testId: widget.test.testId),
      repo.countForRecruiter(
        recruiterId: uid,
        testId: widget.test.testId,
        status: InterviewStatus.completed,
      ),
      repo.fetchRounds(testId: widget.test.testId, recruiterId: uid),
    ]);
    if (!mounted) return;

    final rounds = results[2] as List<InterviewRound>;
    setState(() {
      _total = results[0] as int;
      _completed = results[1] as int;
      // Derived once here against a single instant, rather than per rebuild:
      // a row that rebuilds while scrolling should not re-date its countdown.
      _pipeline = RoundPipelineStatus.from(rounds, DateTime.now());
    });
  }

  @override
  Widget build(BuildContext context) =>
      widget.builder(context, _total, _completed, _pipeline);
}

/// The Soft Pastel Accent Card (Featured Action - Yellow Planning Card style).
class _FilterPillRow extends StatelessWidget {
  final InterviewType? selectedType;
  final ValueChanged<InterviewType?> onSelect;
  final int totalCount;
  final int videoCount;
  final int voiceCount;
  final int chatCount;

  const _FilterPillRow({
    required this.selectedType,
    required this.onSelect,
    required this.totalCount,
    required this.videoCount,
    required this.voiceCount,
    required this.chatCount,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      child: Row(
        children: [
          _pill(
            label: 'All',
            count: totalCount,
            isSelected: selectedType == null,
            onTap: () => onSelect(null),
            isDark: isDark,
            theme: theme,
          ),
          const SizedBox(width: 8),
          _pill(
            label: 'Video',
            count: videoCount,
            isSelected: selectedType == InterviewType.video,
            onTap: () => onSelect(
                selectedType == InterviewType.video ? null : InterviewType.video),
            isDark: isDark,
            theme: theme,
          ),
          const SizedBox(width: 8),
          _pill(
            label: 'Voice',
            count: voiceCount,
            isSelected: selectedType == InterviewType.voice,
            onTap: () => onSelect(
                selectedType == InterviewType.voice ? null : InterviewType.voice),
            isDark: isDark,
            theme: theme,
          ),
          const SizedBox(width: 8),
          _pill(
            label: 'Chat',
            count: chatCount,
            isSelected: selectedType == InterviewType.chat,
            onTap: () => onSelect(
                selectedType == InterviewType.chat ? null : InterviewType.chat),
            isDark: isDark,
            theme: theme,
          ),
        ],
      ),
    );
  }

  Widget _pill({
    required String label,
    required int count,
    required bool isSelected,
    required VoidCallback onTap,
    required bool isDark,
    required ThemeData theme,
  }) {
    // Selected reads as a solid block, unselected as bare surface — the
    // reference's segmented control, not two shades of the same chip.
    final bg = isSelected
        ? (isDark ? AppColors.blockCream : AppColors.blockInk)
        : (isDark ? AppColors.warmSurface : Colors.white);
    final fg = isSelected
        ? (isDark ? AppColors.blockInk : AppColors.blockCream)
        : (isDark ? AppColors.textMuted : const Color(0xFF6B635A));

    return Material(
      color: bg,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Container(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg - 2, vertical: AppSpacing.sm + 2),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(
              color: isSelected
                  ? Colors.transparent
                  : (isDark ? AppColors.warmBorder : const Color(0xFFE2DCD2)),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                  color: fg,
                ),
              ),
              const SizedBox(width: AppSpacing.sm - 2),
              Text(
                '$count',
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: fg.withValues(alpha: isSelected ? 0.7 : 0.55),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

}

/// Compact List Row matching the reference design language:
/// ○ Title
///   Metadata (candidates, date)                 ›
class _CompactTestRow extends StatelessWidget {
  final TestSummary test;

  /// Opens the flat candidate list. Used for a single-round test, where there
  /// is no timeline worth showing.
  final VoidCallback onTap;

  /// Opens the round timeline. A multi-round test lands here instead: the
  /// timeline is where its rounds, schedule and per-round candidates live, and
  /// it used to be two taps deep behind the candidate list's action bar.
  final VoidCallback onOpenTimeline;

  const _CompactTestRow({
    required this.test,
    required this.onTap,
    required this.onOpenTimeline,
  });

  @override
  Widget build(BuildContext context) {
    final typeColor = _testTypeColor(test.type);

    return _TestCounts(
      test: test,
      builder: (context, total, completed, pipeline) {
        // A pipeline worth showing: present, and genuinely more than one round.
        final p = pipeline?.isMultiRound == true ? pipeline : null;

        return Material(
          color: Colors.transparent,
          child: InkWell(
            // A pipeline card opens its test overview, where the recruiter has
            // the familiar top-level actions (publish, retry, delete and
            // Rounds & schedule). Timeline remains an explicit action there.
            onTap: onTap,
            borderRadius: BorderRadius.circular(AppRadius.md),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.xs, vertical: AppSpacing.md + 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Solid pastel disc, as the reference marks each row.
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: typeColor,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      p != null
                          ? Icons.account_tree_outlined
                          : _testTypeIcon(test.type),
                      size: 19,
                      color: AppColors.blockInk,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          test.title,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            letterSpacing: -0.2,
                            color: WarmSurfaces.ink(context),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 3),
                        Text(
                          p != null
                              ? '${p.total} rounds'
                              : _testTypeLabel(test.type),
                          style: TextStyle(
                            fontSize: 12.5,
                            color: WarmSurfaces.inkMuted(context),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (p != null) ...[
                          const SizedBox(height: AppSpacing.sm + 1),
                          RecruiterSegmentedProgress(
                            segments: _pipelineSegments(p),
                            currentColor: _stageColor(context, p.stage),
                          ),
                          const SizedBox(height: AppSpacing.sm - 1),
                          Text(
                            p.stage == PipelineStage.complete
                                ? p.stateLabel
                                : '${p.positionLabel} · ${p.current.title}'
                                    ' · ${p.stateLabel}',
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w500,
                              color: _stageColor(context, p.stage),
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  // The row's figure, right-aligned the way the reference puts
                  // an amount at the end of each line.
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        total < 0 ? '—' : '$total',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.4,
                          height: 1.1,
                          color: WarmSurfaces.ink(context),
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        total < 0
                            ? 'loading'
                            : total == 1
                                ? 'candidate'
                                : 'candidates',
                        style: TextStyle(
                          fontSize: 10.5,
                          color: WarmSurfaces.inkSubtle(context),
                        ),
                      ),
                      if (total > 0 && completed >= 0) ...[
                        const SizedBox(height: 3),
                        Text(
                          '$completed done',
                          style: TextStyle(
                            fontSize: 10.5,
                            fontWeight: FontWeight.w600,
                            color: completed >= total
                                ? StatusTone.ready(context)
                                : WarmSurfaces.inkMuted(context),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Maps a test's timeline onto the design system's segmented bar.
List<RecruiterSegmentState> _pipelineSegments(RoundPipelineStatus p) => [
      for (var k = 0; k < p.total; k++)
        if (k == p.currentIndex)
          RecruiterSegmentState.current
        else if (p.rounds[k].stateAt(p.asOf) == RoundState.closed)
          RecruiterSegmentState.done
        else
          RecruiterSegmentState.idle,
    ];

/// One pastel per pipeline stage, shared by the bar and the badge so they can
/// never disagree about what state the test is in.
Color _stageColor(BuildContext context, PipelineStage stage) {
  switch (stage) {
    // Semantic, not branded: "open" must stay distinguishable from "upcoming"
    // whichever accent the user picked, so only the upcoming state borrows it.
    case PipelineStage.active:
      return StatusTone.ready(context);
    case PipelineStage.upcoming:
      return StatusTone.pending(context);
    case PipelineStage.complete:
      return StatusTone.neutral(context);
  }
}

class _CompactEmptyState extends StatelessWidget {
  final VoidCallback onCreate;

  const _CompactEmptyState({required this.onCreate});

  @override
  Widget build(BuildContext context) {

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
      decoration: BoxDecoration(
        color: WarmSurfaces.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.card + 4),
        border: Border.all(
          color: WarmSurfaces.stroke(context),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.inbox_outlined,
            size: 32,
            color: WarmSurfaces.inkSubtle(context),
          ),
          const SizedBox(height: 12),
          Text(
            'No pipelines created yet',
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: WarmSurfaces.ink(context),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Create your first pipeline to start screening candidates.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12.5,
              color: WarmSurfaces.inkMuted(context),
            ),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: onCreate,
            icon: const Icon(Icons.add, size: 16),
            label: const Text('Create pipeline', style: TextStyle(fontSize: 13)),
            style: FilledButton.styleFrom(
              backgroundColor: WarmSurfaces.block(context),
              foregroundColor: AppColors.blockInk,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(
                  color: Colors.transparent,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Compact No Results State.
class _CompactNoResults extends StatelessWidget {
  final String query;
  final VoidCallback onClear;

  const _CompactNoResults({
    required this.query,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      decoration: BoxDecoration(
        color: WarmSurfaces.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.card + 4),
        border: Border.all(
          color: WarmSurfaces.stroke(context),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.search_off_rounded,
            size: 28,
            color: WarmSurfaces.inkSubtle(context),
          ),
          const SizedBox(height: 10),
          Text(
            query.isEmpty ? 'No matching pipelines' : 'No matches for “$query”',
            style: TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w600,
              color: WarmSurfaces.ink(context),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Try clearing your search or filters.',
            style: TextStyle(
              fontSize: 12,
              color: WarmSurfaces.inkMuted(context),
            ),
          ),
          const SizedBox(height: 12),
          TextButton(
            onPressed: onClear,
            child: const Text('Clear search', style: TextStyle(fontSize: 12.5)),
          ),
        ],
      ),
    );
  }
}

/// Compact Skeleton Placeholder.
class _CompactSkeletonList extends StatelessWidget {
  final int count;
  const _CompactSkeletonList({this.count = 4});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: WarmSurfaces.surface(context),
        borderRadius: BorderRadius.circular(AppRadius.card + 4),
        border: Border.all(color: WarmSurfaces.stroke(context)),
      ),
      child: Column(
        children: [
          for (var i = 0; i < count; i++) ...[
            if (i > 0)
              Divider(
                height: 1,
                thickness: 1,
                color: WarmSurfaces.stroke(context),
              ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: const [
                  AppSkeleton(height: 32, width: 32, borderRadius: 16),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        AppSkeleton(height: 14, width: 160, borderRadius: 4),
                        SizedBox(height: 6),
                        AppSkeleton(height: 11, width: 110, borderRadius: 4),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// One interview card (desktop).
class _DesktopInterviewCard extends StatefulWidget {
  final TestSummary test;
  final VoidCallback onTap;
  final VoidCallback onOpenTimeline;
  const _DesktopInterviewCard({
    required this.test,
    required this.onTap,
    required this.onOpenTimeline,
  });

  @override
  State<_DesktopInterviewCard> createState() => _DesktopInterviewCardState();
}

class _DesktopInterviewCardState extends State<_DesktopInterviewCard> {
  bool _hovering = false;

  @override
  Widget build(BuildContext context) {
    return _TestCounts(
      test: widget.test,
      builder: (context, total, completed, pipeline) {
        final p = pipeline?.isMultiRound == true ? pipeline : null;
        final theme = Theme.of(context);
        final scheme = theme.colorScheme;
        final counts = total < 0
            ? 'Loading…'
            : '$total candidate(s)'
                '${completed >= 0 ? ' · $completed completed' : ''}';
        final typeColor = _testTypeColor(widget.test.type);

        return MouseRegion(
          cursor: SystemMouseCursors.click,
          onEnter: (_) => setState(() => _hovering = true),
          onExit: (_) => setState(() => _hovering = false),
          child: GestureDetector(
            // Match the mobile dashboard: opening a pipeline means opening
            // its test overview, not skipping its test-level actions.
            onTap: widget.onTap,
            behavior: HitTestBehavior.opaque,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 120),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: _hovering
                    ? scheme.surfaceContainerHighest.withValues(alpha: 0.4)
                    : scheme.surfaceContainerHighest.withValues(alpha: 0.25),
                borderRadius: BorderRadius.circular(DesktopTokens.cardRadius),
                border: Border.all(
                  color: _hovering
                      ? typeColor.withValues(alpha: 0.4)
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
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: typeColor.withValues(alpha: 0.12),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          p != null
                              ? Icons.account_tree_outlined
                              : _testTypeIcon(widget.test.type),
                          size: 18,
                          color: typeColor,
                        ),
                      ),
                      const Spacer(),
                      Icon(
                        Icons.chevron_right_rounded,
                        size: 18,
                        color: _hovering ? typeColor : scheme.onSurfaceVariant,
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Text(widget.test.title,
                      style: theme.textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w600),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 4),
                  Text(
                    p != null ? '${p.total} rounds · $counts' : counts,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: scheme.onSurfaceVariant, fontSize: 12),
                  ),
                  if (p != null) ...[
                    const SizedBox(height: AppSpacing.sm),
                    RecruiterSegmentedProgress(
                      segments: _pipelineSegments(p),
                      currentColor: _stageColor(context, p.stage),
                    ),
                    const SizedBox(height: AppSpacing.sm - 2),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            p.stage == PipelineStage.complete
                                ? p.stateLabel
                                : '${p.positionLabel} · ${p.current.title}',
                            style: theme.textTheme.bodySmall?.copyWith(
                                fontSize: 11.5, fontWeight: FontWeight.w500),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (p.stage != PipelineStage.complete) ...[
                          const SizedBox(width: AppSpacing.sm),
                          RecruiterBadge(
                            text: p.stateLabel,
                            color: _stageColor(context, p.stage),
                          ),
                        ],
                      ],
                    ),
                  ] else if (widget.test.createdAt != null) ...[
                    const SizedBox(height: 3),
                    Text(formatDateTime(widget.test.createdAt!),
                        style: theme.textTheme.bodySmall?.copyWith(
                            color: scheme.onSurfaceVariant.withValues(alpha: 0.7),
                            fontSize: 11)),
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

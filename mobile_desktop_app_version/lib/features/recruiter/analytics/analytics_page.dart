// lib/features/recruiter/analytics/analytics_page.dart
//
// Recruiter analytics dashboard. Reads the recruiter's own interviews live from
// Firestore (InterviewRepository.watchForRecruiter), runs the pure
// AnalyticsService over them, and renders funnel stat cards, a score-
// distribution bar chart, a recommendation pie chart, KPIs, a creation trend,
// and a top-candidates list. Fully theme-aware and responsive; every chart
// guards against empty series so fl_chart never divides by zero.

import 'package:firebase_auth/firebase_auth.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/shared/widgets/app_message_state.dart';
import 'package:talbotiq/shared/widgets/desktop_card.dart';
import 'package:talbotiq/shared/widgets/desktop_page_container.dart';
import 'package:talbotiq/shared/widgets/logout_button.dart';
import 'package:talbotiq/shared/widgets/metric_card.dart';
import 'package:talbotiq/shared/widgets/responsive_grid.dart';
import 'package:talbotiq/shared/widgets/section_header.dart';
import 'package:talbotiq/shared/widgets/status_badge.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/recruiter/evaluate_interview_page.dart';
import 'package:talbotiq/features/interviews/services/interview_repository.dart';
import 'package:talbotiq/features/recruiter/analytics/analytics_service.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

class AnalyticsPage extends StatefulWidget {
  const AnalyticsPage({super.key});

  @override
  State<AnalyticsPage> createState() => _AnalyticsPageState();
}

class _AnalyticsPageState extends State<AnalyticsPage> {
  static const _service = AnalyticsService();

  // Filter state. The interview list is filtered by these BEFORE
  // AnalyticsService.compute, so every metric/chart reflects the filtered set.
  InterviewType? _track; // null = All tracks
  String? _testId; // null = All tests
  DateTime? _dateFrom;
  DateTime? _dateTo;
  final TextEditingController _roleController = TextEditingController();

  @override
  void dispose() {
    _roleController.dispose();
    super.dispose();
  }

  AnalyticsFilter get _filter => AnalyticsFilter(
    track: _track,
    testId: _testId,
    roleQuery: _roleController.text,
    dateFrom: _dateFrom,
    dateTo: _dateTo,
  );

  bool get _hasActiveFilter => _filter.isActive;

  int get _activeFilterCount {
    int count = 0;
    if (_track != null) count++;
    if (_testId != null) count++;
    if (_roleController.text.isNotEmpty) count++;
    if (_dateFrom != null) count++;
    if (_dateTo != null) count++;
    return count;
  }

  void _clearFilters() {
    setState(() {
      _track = null;
      _testId = null;
      _dateFrom = null;
      _dateTo = null;
      _roleController.clear();
    });
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final now = DateTime.now();
    final initial = (isFrom ? _dateFrom : _dateTo) ?? now;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2020),
      lastDate: DateTime(now.year + 1, 12, 31),
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (isFrom) {
        _dateFrom = picked;
        if (_dateTo != null && _dateTo!.isBefore(picked)) _dateTo = picked;
      } else {
        _dateTo = picked;
        if (_dateFrom != null && _dateFrom!.isAfter(picked)) _dateFrom = picked;
      }
    });
  }

  static String _trackLabel(InterviewType t) {
    switch (t) {
      case InterviewType.video:
        return 'Video';
      case InterviewType.chat:
        return 'Chat';
      case InterviewType.voice:
        return 'Voice';
    }
  }

  static InputDecoration _inputDecoration(
    BuildContext context,
    String label,
    IconData icon,
  ) {
    final theme = Theme.of(context);
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon, size: 18),
      isDense: true,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide: BorderSide(color: AppBorders.strokeColor(context)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide: BorderSide(color: AppBorders.strokeColor(context)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.md),
        borderSide: BorderSide(color: theme.colorScheme.primary, width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md + 2,
        vertical: AppSpacing.md + 1,
      ),
    );
  }

  void _openFilterSheet(BuildContext context, List<TestOption> testOptions) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
      ),
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (sheetContext, setSheetState) {
            return Padding(
              padding: EdgeInsets.fromLTRB(
                20,
                0,
                20,
                MediaQuery.of(sheetContext).viewInsets.bottom + 32,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Filter analytics',
                          style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                            letterSpacing: -0.3,
                            color: AppSurfaces.text(context),
                          ),
                        ),
                        if (_activeFilterCount > 0)
                          TextButton(
                            onPressed: () {
                              _clearFilters();
                              setSheetState(() {});
                              Navigator.pop(sheetContext);
                            },
                            child: Text(
                              'Clear all',
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w600,
                                color: AppSurfaces.muted(context),
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    // Track Dropdown
                    DropdownButtonFormField<InterviewType?>(
                      initialValue: _track,
                      isExpanded: true,
                      decoration: _inputDecoration(
                        context,
                        'Track',
                        Icons.tune_outlined,
                      ),
                      items: [
                        const DropdownMenuItem(
                          value: null,
                          child: Text('All tracks'),
                        ),
                        for (final t in InterviewType.values)
                          DropdownMenuItem(
                            value: t,
                            child: Text(_trackLabel(t)),
                          ),
                      ],
                      onChanged: (val) {
                        setState(() => _track = val);
                        setSheetState(() {});
                      },
                    ),
                    const SizedBox(height: 16),
                    // Test Dropdown
                    DropdownButtonFormField<String?>(
                      initialValue: _testId,
                      isExpanded: true,
                      decoration: _inputDecoration(
                        context,
                        'Pipeline',
                        Icons.folder_copy_outlined,
                      ),
                      items: [
                        const DropdownMenuItem(
                          value: null,
                          child: Text('All pipelines'),
                        ),
                        for (final o in testOptions)
                          DropdownMenuItem(
                            value: o.testId,
                            child: Text(
                              '${o.label} (${o.count})',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: testOptions.isEmpty
                          ? null
                          : (val) {
                              setState(() => _testId = val);
                              setSheetState(() {});
                            },
                    ),
                    const SizedBox(height: 16),
                    // Role Title search
                    TextField(
                      controller: _roleController,
                      onChanged: (val) {
                        setState(() {});
                        setSheetState(() {});
                      },
                      decoration:
                          _inputDecoration(
                            context,
                            'Role / title',
                            Icons.search,
                          ).copyWith(
                            suffixIcon: _roleController.text.isEmpty
                                ? null
                                : IconButton(
                                    icon: const Icon(Icons.clear, size: 16),
                                    onPressed: () {
                                      _roleController.clear();
                                      setState(() {});
                                      setSheetState(() {});
                                    },
                                  ),
                          ),
                    ),
                    const SizedBox(height: 16),
                    // Date pickers in a Row
                    Row(
                      children: [
                        Expanded(
                          child: _DateFieldSheet(
                            label: 'From date',
                            value: _dateFrom,
                            onPick: () async {
                              await _pickDate(isFrom: true);
                              setSheetState(() {});
                            },
                            onClear: () {
                              setState(() => _dateFrom = null);
                              setSheetState(() {});
                            },
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _DateFieldSheet(
                            label: 'To date',
                            value: _dateTo,
                            onPick: () async {
                              await _pickDate(isFrom: false);
                              setSheetState(() {});
                            },
                            onClear: () {
                              setState(() => _dateTo = null);
                              setSheetState(() {});
                            },
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    RecruiterPrimaryButton(
                      label: 'Apply filters',
                      expand: true,
                      onPressed: () => Navigator.pop(sheetContext),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildActiveFilterChips(List<TestOption> testOptions) {
    final chips = <Widget>[];

    if (_track != null) {
      chips.add(
        _FilterChip(
          label: 'Track: ${_trackLabel(_track!)}',
          onDeleted: () => setState(() => _track = null),
        ),
      );
    }
    if (_testId != null) {
      final option = testOptions.firstWhere(
        (o) => o.testId == _testId,
        orElse: () => const TestOption(testId: '', label: '', count: 0),
      );
      if (option.testId.isNotEmpty) {
        chips.add(
          _FilterChip(
            label: 'Pipeline: ${option.label}',
            onDeleted: () => setState(() => _testId = null),
          ),
        );
      }
    }
    if (_roleController.text.isNotEmpty) {
      chips.add(
        _FilterChip(
          label: 'Role: ${_roleController.text}',
          onDeleted: () {
            _roleController.clear();
            setState(() {});
          },
        ),
      );
    }
    if (_dateFrom != null) {
      chips.add(
        _FilterChip(
          label: 'From: ${_fmtDayShort(_dateFrom!)}',
          onDeleted: () => setState(() => _dateFrom = null),
        ),
      );
    }
    if (_dateTo != null) {
      chips.add(
        _FilterChip(
          label: 'To: ${_fmtDayShort(_dateTo!)}',
          onDeleted: () => setState(() => _dateTo = null),
        ),
      );
    }

    if (chips.isEmpty) return const SizedBox.shrink();

    return SizedBox(
      height: 38,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.page,
          AppSpacing.xs,
          AppSpacing.page,
          AppSpacing.xs,
        ),
        children: [
          ...chips,
          TextButton(
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            onPressed: _clearFilters,
            child: Text(
              'Clear all',
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: AppSurfaces.muted(context),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final repo = context.read<InterviewRepository>();
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    final desktop = isDesktopPlatform;

    final streamBuilder = StreamBuilder<List<Interview>>(
      stream: repo.watchForRecruiter(uid),
      builder: (context, snap) {
        if (snap.hasError) {
          return AppMessageState(
            icon: Icons.error_outline,
            title: 'Could not load analytics',
            subtitle: '${snap.error}',
          );
        }
        if (!snap.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final all = snap.data!;
        if (all.isEmpty) {
          return const AppMessageState(
            icon: Icons.insights_outlined,
            title: 'Nothing to analyze yet',
            subtitle:
                'Create interviews and assign them to candidates — metrics '
                'appear here as candidates take them.',
          );
        }

        final testOptions = _service.testOptions(all);
        if (_testId != null && !testOptions.any((o) => o.testId == _testId)) {
          _testId = null;
        }

        final filtered = _service.applyFilter(all, _filter);
        final summary = _service.compute(filtered);

        if (desktop) {
          return _buildDesktopBody(context, testOptions, filtered, summary);
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Minimal header: the page's own heading plus one supporting line,
            // with the filter as a compact pill rather than a filled slab.
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.page,
                0,
                AppSpacing.page,
                AppSpacing.md,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(
                    child: Text(
                      '${summary.totals.total} '
                      '${summary.totals.total == 1 ? 'interview' : 'interviews'}'
                      ' · ${_dateRangeLabel()}',
                      style: TextStyle(
                        fontSize: 13,
                        color: AppSurfaces.muted(context),
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  RecruiterFilterPill(
                    label: _activeFilterCount > 0
                        ? 'Filters · $_activeFilterCount'
                        : 'Filters',
                    icon: Icons.tune_rounded,
                    selected: _activeFilterCount > 0,
                    onTap: () => _openFilterSheet(context, testOptions),
                  ),
                ],
              ),
            ),
            _buildActiveFilterChips(testOptions),
            Expanded(
              child: summary.isEmpty
                  ? AppMessageState(
                      icon: Icons.filter_alt_off_outlined,
                      title: 'No interviews match these filters',
                      subtitle: _hasActiveFilter
                          ? 'Adjust or clear the filters to see your metrics.'
                          : 'Nothing to analyze yet.',
                    )
                  : _Dashboard(summary: summary),
            ),
          ],
        );
      },
    );

    if (desktop) return streamBuilder;

    return RecruiterScaffold(
      appBar: AppBar(
        title: const Text('Analytics'),
        titleSpacing: AppSpacing.page,
        toolbarHeight: 52,
        actions: const [
          LogoutButton(),
          SizedBox(width: AppSpacing.xs),
        ],
      ),
      body: streamBuilder,
    );
  }

  String _dateRangeLabel() {
    if (_dateFrom == null && _dateTo == null) return 'All time';
    if (_dateFrom != null && _dateTo != null) {
      return '${_fmtDayShort(_dateFrom!)} – ${_fmtDayShort(_dateTo!)}, ${_dateTo!.year}';
    }
    if (_dateFrom != null) return 'From ${_fmtDayShort(_dateFrom!)}';
    return 'Until ${_fmtDayShort(_dateTo!)}';
  }

  Widget _buildDesktopBody(
    BuildContext context,
    List<TestOption> testOptions,
    List<Interview> filtered,
    AnalyticsSummary summary,
  ) {
    final theme = Theme.of(context);
    return SingleChildScrollView(
      child: DesktopPageContainer(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SectionHeader(
              title: 'Analytics overview',
              subtitle:
                  'Track interview performance, candidate progress, and hiring insights.',
              isPageTitle: true,
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  OutlinedButton.icon(
                    onPressed: () => _openFilterSheet(context, testOptions),
                    icon: const Icon(Icons.event_outlined, size: 16),
                    label: Text(_dateRangeLabel()),
                  ),
                  const SizedBox(width: 10),
                  FilledButton.icon(
                    onPressed: () => _openFilterSheet(context, testOptions),
                    icon: const Icon(Icons.filter_list_rounded, size: 16),
                    label: Text(
                      _activeFilterCount > 0
                          ? 'Filters ($_activeFilterCount)'
                          : 'Filter',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            _buildActiveFilterChips(testOptions),
            const SizedBox(height: 16),
            if (summary.isEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 48),
                child: AppMessageState(
                  icon: Icons.filter_alt_off_outlined,
                  title: 'No interviews match these filters',
                  subtitle: _hasActiveFilter
                      ? 'Adjust or clear the filters to see your metrics.'
                      : 'Nothing to analyze yet.',
                ),
              )
            else
              _DesktopDashboard(
                summary: summary,
                interviews: filtered,
                theme: theme,
              ),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final VoidCallback onDeleted;

  const _FilterChip({required this.label, required this.onDeleted});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: AppSpacing.sm),
      child: Container(
        padding: const EdgeInsets.only(
          left: AppSpacing.md - 2,
          right: AppSpacing.xs,
          top: AppSpacing.xs + 1,
          bottom: AppSpacing.xs + 1,
        ),
        decoration: BoxDecoration(
          color: AppSurfaces.card(context),
          borderRadius: AppRadius.all(AppRadius.sm),
          border: Border.all(color: AppBorders.strokeColor(context)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w500,
                color: AppSurfaces.muted(context),
              ),
            ),
            const SizedBox(width: AppSpacing.xs),
            InkWell(
              onTap: onDeleted,
              borderRadius: BorderRadius.circular(AppRadius.xs),
              child: Padding(
                padding: const EdgeInsets.all(2),
                child: Icon(
                  Icons.close_rounded,
                  size: 13,
                  color: AppSurfaces.subtle(context),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DateFieldSheet extends StatelessWidget {
  final String label;
  final DateTime? value;
  final VoidCallback onPick;
  final VoidCallback onClear;

  const _DateFieldSheet({
    required this.label,
    required this.value,
    required this.onPick,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasValue = value != null;
    return InkWell(
      onTap: onPick,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md + 2,
          vertical: AppSpacing.md,
        ),
        decoration: BoxDecoration(
          color: AppSurfaces.elevated(context),
          border: Border.all(color: AppBorders.strokeColor(context)),
          borderRadius: BorderRadius.circular(AppRadius.md),
        ),
        child: Row(
          children: [
            Icon(
              Icons.event_outlined,
              size: 18,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    label,
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 10,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    hasValue ? _fmtDay(value!) : 'Select date',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: hasValue
                          ? FontWeight.w600
                          : FontWeight.normal,
                      color: hasValue
                          ? theme.colorScheme.onSurface
                          : theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
            if (hasValue)
              GestureDetector(
                onTap: onClear,
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Icon(
                    Icons.clear,
                    size: 16,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _Dashboard extends StatelessWidget {
  final AnalyticsSummary summary;
  const _Dashboard({required this.summary});

  @override
  Widget build(BuildContext context) {
    final avg = summary.averageOverallScore;

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.page,
        0,
        AppSpacing.page,
        AppSpacing.navClearance,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // The same hero block the dashboard's home tab uses: one large
          // figure carrying the peach block, everything below it monochrome.
          RecruiterHeroBlock(
            kicker: 'Pipeline',
            value: '${(summary.completionRate * 100).round()}%',
            unit: 'completed',
            caption: avg == null
                ? '${summary.totals.completed} of ${summary.totals.total} '
                      'interviews · no scores yet'
                : '${summary.totals.completed} of ${summary.totals.total} '
                      'interviews · avg ${avg.toStringAsFixed(1)}',
          ),
          const SizedBox(height: AppSpacing.xxl),
          _SectionTitle('Funnel'),
          const SizedBox(height: AppSpacing.md),
          _FunnelCards(totals: summary.totals),
          const SizedBox(height: AppSpacing.xxl),
          _SectionTitle('Key indicators'),
          const SizedBox(height: AppSpacing.md),
          _KpiRow(summary: summary),
          const SizedBox(height: AppSpacing.xxl),
          _SectionTitle('Score distribution'),
          const SizedBox(height: AppSpacing.md),
          RecruiterPanel(child: _ScoreDistributionChart(summary: summary)),
          const SizedBox(height: AppSpacing.xxl),
          _SectionTitle('AI recommendations'),
          const SizedBox(height: AppSpacing.md),
          RecruiterPanel(child: _RecommendationChart(summary: summary)),
          const SizedBox(height: AppSpacing.xxl),
          _SectionTitle('By track'),
          const SizedBox(height: AppSpacing.md),
          _ByTypeCards(byType: summary.byType),
          const SizedBox(height: AppSpacing.xxl),
          _SectionTitle('Score trend'),
          const SizedBox(height: AppSpacing.md),
          RecruiterPanel(child: _TrendChart(trend: summary.trend)),
          const SizedBox(height: AppSpacing.xxl),
          _SectionTitle('Top candidates'),
          const SizedBox(height: AppSpacing.md),
          _TopCandidatesList(candidates: summary.topCandidates),
        ],
      ),
    );
  }
}

class _FunnelCards extends StatelessWidget {
  final FunnelTotals totals;
  const _FunnelCards({required this.totals});

  @override
  Widget build(BuildContext context) {
    final stages = <(String, int, Color)>[
      ('Total', totals.total, AppColors.pastelCyanText),
      ('Assigned', totals.assigned, AppColors.textMuted),
      ('In progress', totals.inProgress, AppColors.pastelPeach),
      ('Completed', totals.completed, AppColors.pastelMintText),
      ('Published', totals.published, AppColors.pastelLavenderText),
    ];

    return RecruiterPanel(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.sm,
      ),
      child: Column(
        children: [
          for (var k = 0; k < stages.length; k++) ...[
            if (k > 0)
              Divider(
                height: 1,
                thickness: 1,
                color: AppBorders.separatorColor(context),
              ),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.md - 1),
              child: Row(
                children: [
                  Container(
                    width: 7,
                    height: 7,
                    decoration: BoxDecoration(
                      color: stages[k].$3,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: Text(
                      stages[k].$1,
                      style: TextStyle(
                        fontSize: 13.5,
                        color: AppSurfaces.muted(context),
                      ),
                    ),
                  ),
                  Text(
                    '${stages[k].$2}',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.4,
                      color: AppSurfaces.text(context),
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

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color color;
  final String? footnote;

  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
    this.footnote,
  });

  @override
  Widget build(BuildContext context) {
    return RecruiterStatCard(
      icon: icon,
      label: label,
      value: value,
      footnote: footnote,
      color: color,
    );
  }
}

class _KpiRow extends StatelessWidget {
  final AnalyticsSummary summary;
  const _KpiRow({required this.summary});

  @override
  Widget build(BuildContext context) {
    final avg = summary.averageOverallScore;
    return RecruiterMetricStrip(
      metrics: [
        RecruiterMetric(
          value: '${(summary.completionRate * 100).round()}%',
          label: 'Completion',
          color: AppColors.pastelCyanText,
        ),
        RecruiterMetric(
          value: avg == null ? '—' : avg.toStringAsFixed(1),
          label: 'Avg. score',
          color: AppColors.pastelLavenderText,
        ),
        RecruiterMetric(
          value: '${summary.scoredCount}',
          label: 'Evaluated',
          color: AppColors.pastelMintText,
        ),
      ],
    );
  }
}

class _ScoreDistributionChart extends StatelessWidget {
  final AnalyticsSummary summary;
  const _ScoreDistributionChart({required this.summary});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final buckets = summary.scoreDistribution;
    final maxCount = buckets.fold<int>(0, (m, b) => b.count > m ? b.count : m);

    if (summary.scoredCount == 0) {
      return const _EmptyChart(message: 'No scored interviews yet.');
    }

    final maxY = (maxCount == 0 ? 1 : maxCount).toDouble();

    return SizedBox(
      height: 190,
      child: BarChart(
        BarChartData(
          alignment: BarChartAlignment.spaceAround,
          maxY: maxY,
          minY: 0,
          barTouchData: BarTouchData(
            enabled: true,
            touchTooltipData: BarTouchTooltipData(
              getTooltipColor: (_) => scheme.inverseSurface,
              getTooltipItem: (group, _, rod, __) => BarTooltipItem(
                '${buckets[group.x].label}\n${rod.toY.round()} Candidates',
                TextStyle(
                  color: scheme.onInverseSurface,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
          titlesData: FlTitlesData(
            topTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            rightTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 28,
                interval: _niceInterval(maxY),
                getTitlesWidget: (value, meta) {
                  if (value != value.roundToDouble()) {
                    return const SizedBox.shrink();
                  }
                  return Text(
                    '${value.round()}',
                    style: TextStyle(
                      fontSize: 10,
                      color: AppSurfaces.subtle(context),
                    ),
                  );
                },
              ),
            ),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 26,
                getTitlesWidget: (value, meta) {
                  final idx = value.round();
                  if (idx < 0 || idx >= buckets.length) {
                    return const SizedBox.shrink();
                  }
                  return Padding(
                    padding: const EdgeInsets.only(top: AppSpacing.xs + 2),
                    child: Text(
                      buckets[idx].label,
                      style: TextStyle(
                        fontSize: 9.5,
                        fontWeight: FontWeight.w500,
                        color: AppSurfaces.muted(context),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          gridData: FlGridData(
            show: true,
            drawVerticalLine: false,
            horizontalInterval: _niceInterval(maxY),
            getDrawingHorizontalLine: (_) => FlLine(
              color: AppBorders.separatorColor(context),
              strokeWidth: 1,
            ),
          ),
          borderData: FlBorderData(show: false),
          barGroups: [
            for (var k = 0; k < buckets.length; k++)
              BarChartGroupData(
                x: k,
                barRods: [
                  BarChartRodData(
                    toY: buckets[k].count.toDouble(),
                    color: WarmSurfaces.blockSecondary(
                      context,
                    ).withValues(alpha: 0.9),
                    width: 13,
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(3),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _RecommendationChart extends StatelessWidget {
  final AnalyticsSummary summary;
  const _RecommendationChart({required this.summary});

  static const _labels = {
    'strong_yes': 'Strong yes',
    'yes': 'Yes',
    'maybe': 'Maybe',
    'no': 'No',
    'unknown': 'Unknown',
  };

  @override
  Widget build(BuildContext context) {
    final dist = summary.recommendationDistribution;
    final colors = <String, Color>{
      'strong_yes': AppColors.pastelMint,
      'yes': AppColors.pastelCyan,
      'maybe': AppColors.blockPeach,
      'no': AppColors.danger,
      'unknown': AppColors.textSubtle,
    };
    final total = dist.values.fold<int>(0, (sum, v) => sum + v);

    if (total == 0) {
      return const _EmptyChart(message: 'No recommendations recorded yet.');
    }

    final entries = AnalyticsService.recommendationDisplayKeys
        .where((k) => (dist[k] ?? 0) > 0)
        .toList();

    return Column(
      children: [
        SizedBox(
          height: 156,
          child: PieChart(
            PieChartData(
              sectionsSpace: 2,
              centerSpaceRadius: 52,
              sections: [
                for (final k in entries)
                  PieChartSectionData(
                    value: (dist[k] ?? 0).toDouble(),
                    color: colors[k],
                    radius: 14, // Thin ring — the legend carries the reading.
                    showTitle: false,
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Wrap(
          spacing: AppSpacing.lg,
          runSpacing: AppSpacing.sm,
          alignment: WrapAlignment.center,
          children: [
            for (final k in AnalyticsService.recommendationDisplayKeys)
              _LegendDot(
                color: colors[k]!,
                label: '${_labels[k]} · ${dist[k] ?? 0}',
                muted: (dist[k] ?? 0) == 0,
                textColor: AppSurfaces.muted(context),
              ),
          ],
        ),
      ],
    );
  }
}

class _LegendDot extends StatelessWidget {
  final Color color;
  final String label;
  final bool muted;
  final Color textColor;
  const _LegendDot({
    required this.color,
    required this.label,
    required this.muted,
    required this.textColor,
  });

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: muted ? 0.35 : 1,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: AppSpacing.sm - 2),
          Text(
            label,
            style: TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w500,
              color: textColor,
            ),
          ),
        ],
      ),
    );
  }
}

class _ByTypeCards extends StatelessWidget {
  final List<TypeStat> byType;
  const _ByTypeCards({required this.byType});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 162,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        clipBehavior: Clip.none,
        padding: const EdgeInsets.only(right: AppSpacing.xxl),
        itemCount: byType.length,
        separatorBuilder: (_, __) => const SizedBox(width: AppSpacing.md),
        itemBuilder: (context, index) {
          final t = byType[index];
          return SizedBox(
            width: 158,
            child: _StatCard(
              label: t.label,
              value: t.averageScore == null
                  ? '${t.count} · avg —'
                  : '${t.count} · avg ${t.averageScore!.toStringAsFixed(1)}',
              footnote: '${(t.completionRate * 100).round()}% completed',
              icon: _iconFor(t.type),
              color: _trackColor(t.type),
            ),
          );
        },
      ),
    );
  }

  static IconData _iconFor(InterviewType type) {
    switch (type) {
      case InterviewType.video:
        return Icons.videocam_outlined;
      case InterviewType.chat:
        return Icons.chat_bubble_outline_rounded;
      case InterviewType.voice:
        return Icons.mic_none_rounded;
    }
  }

  /// One pastel per track, matching how the dashboard's test rows tint by type.
  static Color _trackColor(InterviewType type) {
    switch (type) {
      case InterviewType.video:
        return AppColors.pastelCyanText;
      case InterviewType.chat:
        return AppColors.pastelLavenderText;
      case InterviewType.voice:
        return AppColors.pastelPeach;
    }
  }
}

class _TrendChart extends StatelessWidget {
  final List<TrendPoint> trend;
  const _TrendChart({required this.trend});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (trend.isEmpty) {
      return const _EmptyChart(message: 'No scored interviews yet.');
    }
    const maxY = 100.0;
    const gridInterval = 20.0;

    return SizedBox(
      height: 176,
      child: LineChart(
        LineChartData(
          minY: 0,
          maxY: maxY,
          minX: 0,
          maxX: (trend.length - 1).toDouble().clamp(0, double.infinity),
          lineTouchData: LineTouchData(
            touchTooltipData: LineTouchTooltipData(
              getTooltipColor: (_) => scheme.inverseSurface,
              getTooltipItems: (spots) => spots.map((s) {
                final p = trend[s.x.round().clamp(0, trend.length - 1)];
                return LineTooltipItem(
                  '${_fmtDay(p.day)}\n'
                  'avg ${p.averageScore.toStringAsFixed(1)} · ${p.count} scored',
                  TextStyle(
                    color: scheme.onInverseSurface,
                    fontWeight: FontWeight.w600,
                  ),
                );
              }).toList(),
            ),
          ),
          gridData: FlGridData(
            show: true,
            drawVerticalLine: false,
            horizontalInterval: gridInterval,
            getDrawingHorizontalLine: (_) => FlLine(
              color: AppBorders.separatorColor(context),
              strokeWidth: 1,
            ),
          ),
          titlesData: FlTitlesData(
            topTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            rightTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            leftTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 28,
                interval: gridInterval,
                getTitlesWidget: (value, meta) {
                  if (value != value.roundToDouble()) {
                    return const SizedBox.shrink();
                  }
                  return Text(
                    '${value.round()}',
                    style: TextStyle(
                      fontSize: 10,
                      color: AppSurfaces.subtle(context),
                    ),
                  );
                },
              ),
            ),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                reservedSize: 26,
                interval: _bottomInterval(trend.length),
                getTitlesWidget: (value, meta) {
                  final idx = value.round();
                  if (idx < 0 || idx >= trend.length) {
                    return const SizedBox.shrink();
                  }
                  return Padding(
                    padding: const EdgeInsets.only(top: AppSpacing.xs + 2),
                    child: Text(
                      _fmtDayShort(trend[idx].day),
                      style: TextStyle(
                        fontSize: 9.5,
                        color: AppSurfaces.subtle(context),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          borderData: FlBorderData(show: false),
          lineBarsData: [
            LineChartBarData(
              spots: [
                for (var k = 0; k < trend.length; k++)
                  FlSpot(k.toDouble(), trend[k].averageScore),
              ],
              isCurved: true,
              color: WarmSurfaces.blockSecondary(context),
              barWidth: 2,
              dotData: FlDotData(
                show: trend.length <= 12,
                getDotPainter: (spot, pct, bar, i) => FlDotCirclePainter(
                  radius: 2.5,
                  color: WarmSurfaces.blockSecondary(context),
                  strokeWidth: 0,
                ),
              ),
              // A whisper of fill, not a gradient slab.
              belowBarData: BarAreaData(
                show: true,
                color: WarmSurfaces.blockSecondary(
                  context,
                ).withValues(alpha: 0.08),
              ),
            ),
          ],
        ),
      ),
    );
  }

  double _bottomInterval(int n) {
    if (n <= 1) return 1;
    final step = (n / 5).ceil();
    return step.toDouble();
  }
}

class _TopCandidatesList extends StatelessWidget {
  final List<TopCandidate> candidates;
  const _TopCandidatesList({required this.candidates});

  @override
  Widget build(BuildContext context) {
    if (candidates.isEmpty) {
      return RecruiterPanel(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
          child: Center(
            child: Text(
              'No scored candidates yet.',
              style: TextStyle(
                fontSize: 12.5,
                color: AppSurfaces.muted(context),
              ),
            ),
          ),
        ),
      );
    }
    // One panel holding thin-separated rows, rather than a card per candidate:
    // the leaderboard reads as a single object, which is the point of a ranking.
    return RecruiterPanel(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Column(
        children: [
          for (var k = 0; k < candidates.length; k++) ...[
            if (k > 0) const RecruiterRowSeparator(indent: 56),
            _CandidateRow(rank: k + 1, candidate: candidates[k]),
          ],
        ],
      ),
    );
  }
}

class _CandidateRow extends StatefulWidget {
  final int rank;
  final TopCandidate candidate;
  const _CandidateRow({required this.rank, required this.candidate});

  @override
  State<_CandidateRow> createState() => _CandidateRowState();
}

class _CandidateRowState extends State<_CandidateRow> {
  bool _loading = false;

  Future<void> _open() async {
    if (_loading) return;
    setState(() => _loading = true);
    final navigator = Navigator.of(context);
    final repo = context.read<InterviewRepository>();
    Interview? interview;
    try {
      interview = await repo.getById(widget.candidate.interviewId);
    } catch (_) {
      interview = null;
    }
    if (!mounted) return;
    setState(() => _loading = false);
    if (interview == null) return;
    navigator.push(
      MaterialPageRoute(
        builder: (_) => EvaluateInterviewPage(interview: interview!),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // The top three read as medals; everything below is just a number, so it
    // gets the same muted chip the rest of the language uses.
    final Color rankTint;
    switch (widget.rank) {
      case 1:
        rankTint = WarmSurfaces.block(context);
        break;
      case 2:
        rankTint = AppColors.pastelCyanText;
        break;
      case 3:
        rankTint = AppColors.pastelPeach;
        break;
      default:
        rankTint = AppColors.textMuted;
    }
    final score = widget.candidate.score;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _open,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md + 2,
            vertical: AppSpacing.md - 2,
          ),
          child: Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: AppSurfaces.elevated(context),
                  shape: BoxShape.circle,
                  border: Border.all(color: rankTint.withValues(alpha: 0.35)),
                ),
                child: Center(
                  child: Text(
                    '${widget.rank}',
                    style: TextStyle(
                      color: rankTint,
                      fontWeight: FontWeight.w700,
                      fontSize: 11.5,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      widget.candidate.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        letterSpacing: -0.2,
                        color: AppSurfaces.text(context),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      widget.candidate.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11.5,
                        color: AppSurfaces.muted(context),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                '$score',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.4,
                  color: scoreColor(context, score),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              SizedBox(
                width: 18,
                height: 18,
                child: _loading
                    ? const CircularProgressIndicator(strokeWidth: 2)
                    : Icon(
                        Icons.chevron_right_rounded,
                        size: 18,
                        color: AppSurfaces.subtle(context),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;
  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 2),
      child: RecruiterSectionTitle(text),
    );
  }
}

class _EmptyChart extends StatelessWidget {
  final String message;
  const _EmptyChart({required this.message});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 132,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.show_chart_rounded,
              size: 28,
              color: AppSurfaces.subtle(context),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 12.5,
                color: AppSurfaces.muted(context),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

double _niceInterval(double maxY) {
  if (maxY <= 5) return 1;
  final raw = maxY / 5;
  return raw.ceilToDouble();
}

String _fmtDay(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

String _fmtDayShort(DateTime d) =>
    '${d.month.toString().padLeft(2, '0')}/${d.day.toString().padLeft(2, '0')}';

// ─────────────────────────────────────────────────────────────────────────
// Desktop dashboard. Every number below comes from the same AnalyticsSummary
// (or, for Recent Interviews, the same filtered Interview list) the mobile
// _Dashboard above already renders — this is a visual redesign only, no new
// computation, no fabricated deltas/trend/skills data. _TrendChart is reused
// as-is from the mobile dashboard (same widget, same data, just restyled by
// the DesktopCard wrapper around it).
class _DesktopDashboard extends StatelessWidget {
  final AnalyticsSummary summary;
  final List<Interview> interviews;
  final ThemeData theme;

  const _DesktopDashboard({
    required this.summary,
    required this.interviews,
    required this.theme,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = theme.colorScheme;
    final avg = summary.averageOverallScore;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ResponsiveGrid(
          tileMinWidth: 200,
          maxPerRow: 5,
          children: [
            MetricCard(
              label: 'Total interviews',
              value: '${summary.totals.total}',
              icon: Icons.forum_outlined,
              color: scheme.primary,
            ),
            MetricCard(
              label: 'Completion rate',
              value: '${(summary.completionRate * 100).round()}%',
              icon: Icons.pie_chart_outline_rounded,
              color: scheme.primary,
              footnote:
                  '${summary.totals.completed} of ${summary.totals.total} completed',
            ),
            MetricCard(
              label: 'Average score',
              value: avg == null ? '—' : avg.toStringAsFixed(1),
              footnote: avg == null ? null : 'out of 100',
              icon: Icons.stars_rounded,
              color: scheme.secondary,
            ),
            MetricCard(
              label: 'Evaluated candidates',
              value: '${summary.scoredCount}',
              icon: Icons.checklist_rtl_rounded,
              color: AppColors.pastelMintText,
            ),
            MetricCard(
              label: 'Published',
              value: '${summary.totals.published}',
              icon: Icons.verified_user_outlined,
              color: scheme.secondary,
            ),
          ],
        ),
        const SizedBox(height: 24),
        LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth > 900;
            final funnel = _FunnelPanel(totals: summary.totals);
            final trend = DesktopCard(
              title: 'Performance trend',
              child: SizedBox(
                height: 240,
                child: _TrendChart(trend: summary.trend),
              ),
            );
            if (!wide) {
              return Column(
                children: [funnel, const SizedBox(height: 16), trend],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(flex: 2, child: funnel),
                const SizedBox(width: 16),
                Expanded(flex: 3, child: trend),
              ],
            );
          },
        ),
        const SizedBox(height: 24),
        LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth > 900;
            final distribution = _ScoreDistributionPanel(summary: summary);
            final byTrack = _PerformanceByTrackPanel(byType: summary.byType);
            if (!wide) {
              return Column(
                children: [distribution, const SizedBox(height: 16), byTrack],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: distribution),
                const SizedBox(width: 16),
                Expanded(child: byTrack),
              ],
            );
          },
        ),
        const SizedBox(height: 24),
        _RecentInterviewsPanel(interviews: interviews),
        const SizedBox(height: 32),
      ],
    );
  }
}

class _FunnelPanel extends StatelessWidget {
  final FunnelTotals totals;
  const _FunnelPanel({required this.totals});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final rows = <(String, int, Color)>[
      ('Total', totals.total, scheme.primary),
      ('Assigned', totals.assigned, scheme.outline),
      ('In progress', totals.inProgress, AppColors.pastelPeach),
      ('Completed', totals.completed, AppColors.pastelMintText),
      ('Published', totals.published, scheme.secondary),
    ];
    final base = totals.total == 0 ? 1 : totals.total;

    return DesktopCard(
      title: 'Interview funnel',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final r in rows) ...[
            _FunnelRow(label: r.$1, count: r.$2, color: r.$3, total: base),
            const SizedBox(height: 14),
          ],
        ],
      ),
    );
  }
}

class _FunnelRow extends StatelessWidget {
  final String label;
  final int count;
  final Color color;
  final int total;
  const _FunnelRow({
    required this.label,
    required this.count,
    required this.color,
    required this.total,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final fraction = total == 0 ? 0.0 : count / total;
    final pct = total == 0 ? 0 : (count / total * 100).round();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Text(
              '$count',
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(width: 6),
            Text(
              '($pct%)',
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: fraction.clamp(0, 1),
            minHeight: 8,
            color: color,
            backgroundColor: scheme.surfaceContainerHighest.withValues(
              alpha: 0.4,
            ),
          ),
        ),
      ],
    );
  }
}

class _ScoreDistributionPanel extends StatelessWidget {
  final AnalyticsSummary summary;
  const _ScoreDistributionPanel({required this.summary});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (summary.scoredCount == 0) {
      return const DesktopCard(
        title: 'Score distribution',
        child: _EmptyChart(message: 'No scored interviews yet.'),
      );
    }

    final buckets = summary.scoreDistribution;
    // Low -> high score, muted -> full brand green: a sequential intensity
    // scale rather than a "bad/good" red-to-green scale, since a low score
    // bucket isn't an error/warning state — it's just fewer candidates there.
    final bucketColors = <Color>[
      scheme.outline,
      scheme.secondary.withValues(alpha: 0.55),
      scheme.secondary,
      scheme.primary.withValues(alpha: 0.6),
      scheme.primary,
    ];
    final avg = summary.averageOverallScore;

    return DesktopCard(
      title: 'Score distribution',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                avg == null ? '—' : avg.toStringAsFixed(1),
                style: theme.textTheme.headlineLarge?.copyWith(
                  color: scheme.primary,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(width: 6),
              Text(
                '/ 100',
                style: theme.textTheme.titleMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
          Text(
            'Average score across ${summary.scoredCount} evaluated candidate(s)',
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 20),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              SizedBox(
                width: 120,
                height: 120,
                child: PieChart(
                  PieChartData(
                    sectionsSpace: 2,
                    centerSpaceRadius: 38,
                    sections: [
                      for (var k = 0; k < buckets.length; k++)
                        if (buckets[k].count > 0)
                          PieChartSectionData(
                            value: buckets[k].count.toDouble(),
                            color: bucketColors[k],
                            radius: 20,
                            showTitle: false,
                          ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 20),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (var k = 0; k < buckets.length; k++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: _BucketLegendRow(
                          color: bucketColors[k],
                          label: buckets[k].label,
                          count: buckets[k].count,
                          total: summary.scoredCount,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _BucketLegendRow extends StatelessWidget {
  final Color color;
  final String label;
  final int count;
  final int total;
  const _BucketLegendRow({
    required this.color,
    required this.label,
    required this.count,
    required this.total,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final pct = total == 0 ? 0 : (count / total * 100).round();
    return Row(
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Text(
          '$count',
          style: theme.textTheme.bodySmall?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(width: 6),
        Text(
          '($pct%)',
          style: theme.textTheme.bodySmall?.copyWith(
            color: scheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

/// The redesign's "Top Skills Performance" slot, honestly filled: this app
/// exposes no per-skill/KPI breakdown anywhere (checked AnalyticsSummary —
/// there isn't one), so per the brief's own fallback instruction this uses
/// the KPI data that actually exists: per-track (video/chat/voice) average
/// score and completion rate.
class _PerformanceByTrackPanel extends StatelessWidget {
  final List<TypeStat> byType;
  const _PerformanceByTrackPanel({required this.byType});

  @override
  Widget build(BuildContext context) {
    final active = byType.where((t) => t.count > 0).toList();
    if (active.isEmpty) {
      return const DesktopCard(
        title: 'Performance by Track',
        child: _EmptyChart(message: 'No interviews yet.'),
      );
    }
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return DesktopCard(
      title: 'Performance by Track',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final t in active) ...[
            Row(
              children: [
                Icon(_iconFor(t.type), size: 16, color: scheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    t.label,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                Text(
                  t.averageScore == null
                      ? 'avg —'
                      : 'avg ${t.averageScore!.toStringAsFixed(1)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  '${t.completedCount}/${t.count} completed',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: ((t.averageScore ?? 0) / 100).clamp(0, 1),
                minHeight: 8,
                color: scheme.primary,
                backgroundColor: scheme.surfaceContainerHighest.withValues(
                  alpha: 0.4,
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
        ],
      ),
    );
  }

  static IconData _iconFor(InterviewType type) {
    switch (type) {
      case InterviewType.video:
        return Icons.videocam_rounded;
      case InterviewType.chat:
        return Icons.chat_bubble_rounded;
      case InterviewType.voice:
        return Icons.mic_rounded;
    }
  }
}

class _RecentInterviewsPanel extends StatelessWidget {
  final List<Interview> interviews;
  const _RecentInterviewsPanel({required this.interviews});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final sorted = [...interviews]
      ..sort((a, b) {
        final ac = a.createdAt;
        final bc = b.createdAt;
        if (ac == null && bc == null) return 0;
        if (ac == null) return 1;
        if (bc == null) return -1;
        return bc.compareTo(ac);
      });
    final recent = sorted.take(8).toList();

    return DesktopCard(
      title: 'Recent interviews',
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
      child: recent.isEmpty
          ? const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: _EmptyChart(message: 'No interviews yet.'),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    children: [
                      Expanded(
                        flex: 3,
                        child: Text(
                          'CANDIDATE',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      Expanded(
                        flex: 3,
                        child: Text(
                          'ROLE',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      Expanded(
                        flex: 2,
                        child: Text(
                          'DATE',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      Expanded(
                        flex: 2,
                        child: Text(
                          'STATUS',
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                for (final i in recent) _RecentInterviewRow(interview: i),
              ],
            ),
    );
  }
}

class _RecentInterviewRow extends StatefulWidget {
  final Interview interview;
  const _RecentInterviewRow({required this.interview});

  @override
  State<_RecentInterviewRow> createState() => _RecentInterviewRowState();
}

class _RecentInterviewRowState extends State<_RecentInterviewRow> {
  bool _hovering = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final i = widget.interview;
    final name = (i.candidateName != null && i.candidateName!.trim().isNotEmpty)
        ? i.candidateName!.trim()
        : i.candidateEmail;
    final date = i.createdAt == null ? '—' : _fmtDay(i.createdAt!);

    return MouseRegion(
      onEnter: (_) => setState(() => _hovering = true),
      onExit: (_) => setState(() => _hovering = false),
      cursor: SystemMouseCursors.click,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => EvaluateInterviewPage(interview: i),
          ),
        ),
        child: Container(
          color: _hovering ? scheme.onSurface.withValues(alpha: 0.04) : null,
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            children: [
              Expanded(
                flex: 3,
                child: Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Expanded(
                flex: 3,
                child: Text(
                  i.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
              Expanded(
                flex: 2,
                child: Text(
                  date,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
              Expanded(flex: 2, child: StatusBadge.forInterview(i)),
            ],
          ),
        ),
      ),
    );
  }
}

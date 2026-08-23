// lib/features/interviews/recruiter/recruiter_shell.dart
//
// Recruiter primary-navigation shell. Hosts the recruiter's top-level
// destinations in an IndexedStack — so each keeps its state while switching.
//
// Mobile/web: unchanged — the original 3 destinations (Home, Analytics,
// Settings) behind the shared AdaptiveNavScaffold (bottom bar on narrow
// windows, sidebar rail on wide ones, from the earlier desktop-enablement
// pass). Nothing in this file changes that code path.
//
// Desktop: a DesktopSpine (Pipelines, Library, Analytics, Settings) down the left
// replaces the sidebar entirely, per the redesign brief. Each hosted page
// (RecruiterHome, AnalyticsPage, the Settings tab) renders without its own
// local AppBar when running under this top nav — the top nav's profile menu
// now owns the single Logout affordance — so there's exactly one bar of
// chrome, not two stacked. Each page still renders 100% its own existing
// body/state/logic; only the "do I show my own AppBar" decision is
// isDesktopPlatform-gated inside each of those files.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/shared/widgets/adaptive_nav_scaffold.dart';
import 'package:talbotiq/shared/widgets/desktop_profile_menu.dart';
import 'package:talbotiq/shared/widgets/desktop_spine.dart';
import 'package:talbotiq/shared/widgets/floating_nav_bar.dart';
import 'package:talbotiq/shared/widgets/logout_button.dart';
import 'package:talbotiq/features/auth/app_role.dart';
import 'package:talbotiq/features/settings/settings_page.dart';
import 'package:talbotiq/features/recruiter/analytics/analytics_page.dart';
import 'package:talbotiq/features/recruiter/views/management/recruiter_library_page.dart';
import 'package:talbotiq/features/recruiter/views/management/mcq_sets_page.dart';
import 'package:talbotiq/features/recruiter/views/management/question_sets_page.dart';
import 'package:talbotiq/features/recruiter/views/management/templates_page.dart';
import 'package:talbotiq/features/interviews/recruiter/recruiter_home.dart';
import 'package:talbotiq/features/auth/company_prompt.dart';
import 'package:talbotiq/features/recruiter/views/widgets/recruiter_ui.dart';

class RecruiterShell extends StatefulWidget {
  const RecruiterShell({super.key});

  @override
  State<RecruiterShell> createState() => _RecruiterShellState();
}

class _RecruiterShellState extends State<RecruiterShell> {
  int _index = 0;

  @override
  void initState() {
    super.initState();
    // Asks an existing recruiter for their company, once. Here rather than on a page
    // so it cannot be skipped by navigating: templates and question sets are scoped by
    // the key server-side, and without one a recruiter silently stops seeing their
    // colleagues' work. Returns without a dialog when nothing is needed.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) maybePromptForCompany(context);
    });
  }

  static const _mobileItems = [
    FloatingNavItem(
        icon: Icons.home_outlined,
        activeIcon: Icons.home_rounded,
        label: 'Home'),
    FloatingNavItem(
        icon: Icons.analytics_outlined,
        activeIcon: Icons.analytics_rounded,
        label: 'Analytics'),
    FloatingNavItem(
        icon: Icons.settings_outlined,
        activeIcon: Icons.settings_rounded,
        label: 'Settings'),
  ];

  /// Lets the bottom bar's "+" invoke RecruiterHome's own create flow.
  final _homeKey = GlobalKey<RecruiterHomeState>();

  late final List<Widget> _mobilePages = [
    RecruiterHome(key: _homeKey),
    const AnalyticsPage(),
    const _RecruiterSettingsTab(),
  ];

  /// The shared IA — see contracts/lexicon.md §8. These groups, this order and
  /// these labels are mirrored by the web spine in `Nav.tsx`, so a change here
  /// is a change to two apps.
  ///
  /// Web nests Templates, Question sets and Assessments directly under Library;
  /// here they are one level down, inside RecruiterLibraryPage, because this
  /// client routes them as pushed pages rather than as shell tabs. Same names,
  /// same place in the hierarchy, one fewer click on the browser.
  static const _desktopGroups = [
    SpineGroup(label: 'Hiring', items: [
      SpineItem(
          icon: Icons.account_tree_outlined,
          activeIcon: Icons.account_tree,
          label: 'Pipelines'),
    ]),
    SpineGroup(label: 'Library', items: [
      SpineItem(
          icon: Icons.folder_special_outlined,
          activeIcon: Icons.folder_special,
          label: 'Library'),
      // The three the web spine lists directly, as direct links rather than a
      // drill-through. The Library tab above stays because it also holds
      // Generate from résumé, Personas and Replicas, which have no spine seat
      // of their own on this client.
      SpineItem(
          icon: Icons.dashboard_customize_outlined,
          label: 'Templates',
          push: _templatesPage),
      SpineItem(
          icon: Icons.list_alt_outlined,
          label: 'Question sets',
          push: _questionSetsPage),
      SpineItem(
          icon: Icons.fact_check_outlined,
          label: 'Assessments',
          push: _mcqSetsPage),
    ]),
    SpineGroup(label: 'Workspace', items: [
      SpineItem(
          icon: Icons.analytics_outlined,
          activeIcon: Icons.analytics_rounded,
          label: 'Analytics'),
      SpineItem(
          icon: Icons.settings_outlined,
          activeIcon: Icons.settings_rounded,
          label: 'Settings'),
    ]),
  ];

  /// Flattened to match the spine's index. Settings is a destination now rather
  /// than an item hidden in a profile menu — it is one on the web spine, and a
  /// setting nobody can find is a setting nobody changes.
  static const _desktopPages = [
    RecruiterHome(),
    RecruiterLibraryPage(),
    AnalyticsPage(),
    _RecruiterSettingsTab(),
  ];

  @override
  Widget build(BuildContext context) {
    // The whole recruiter section wears the warm theme: this covers the nav
    // bar, the settings tab and every tab body. Pages that also install it via
    // RecruiterScaffold just re-install the same values, which is a no-op — but
    // they still need to, because a route they PUSH builds under MaterialApp
    // and would not inherit from here.
    return RecruiterTheme(child: _buildShell(context));
  }

  Widget _buildShell(BuildContext context) {
    if (!isDesktopPlatform) {
      return AdaptiveNavScaffold(
        currentIndex: _index,
        onSelect: (i) => setState(() => _index = i),
        items: _mobileItems,
        // Available from every tab: an IndexedStack keeps Home mounted, so
        // its state is there to drive whichever tab you are looking at.
        action: FloatingNavAction(
          icon: Icons.add_rounded,
          tooltip: 'Create pipeline',
          onPressed: () => _homeKey.currentState?.createInterview(),
        ),
        body: IndexedStack(index: _index, children: _mobilePages),
      );
    }

    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      // A Row, not a Column: the spine runs down the left edge exactly as it
      // does in the browser. Settings is one of the destinations now, so the
      // `-1 means nothing is selected` case the top nav needed is gone with it.
      body: Row(
        children: [
          DesktopSpine(
            currentIndex: _index,
            onSelect: (i) => setState(() => _index = i),
            groups: _desktopGroups,
            account: DesktopProfileMenu(
              roleLabel: 'Recruiter',
              onOpenSettings: () => setState(
                  () => _index = _desktopPages.length - 1),
            ),
          ),
          Expanded(
            child: IndexedStack(index: _index, children: _desktopPages),
          ),
        ],
      ),
    );
  }
}

/// Wraps the shared [SettingsPage] (which has no app bar of its own).
/// Mobile/web keep a titled AppBar + Logout; desktop shows the settings
/// content directly — the top nav's profile menu already owns Logout there,
/// so a second one would be a duplicate affordance.
class _RecruiterSettingsTab extends StatelessWidget {
  const _RecruiterSettingsTab();

  @override
  Widget build(BuildContext context) {
    if (isDesktopPlatform) {
      return const SettingsPage(role: AppRole.recruiter);
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        actions: const [LogoutButton(), SizedBox(width: 4)],
      ),
      body: const SettingsPage(role: AppRole.recruiter),
    );
  }
}

// Route builders for the spine's direct library links. Top-level functions so
// the SpineItem list can stay `const` — a closure would make it runtime.
Widget _templatesPage(BuildContext _) => const TemplatesPage();
Widget _questionSetsPage(BuildContext _) => const QuestionSetsPage();
Widget _mcqSetsPage(BuildContext _) => const McqSetsPage();

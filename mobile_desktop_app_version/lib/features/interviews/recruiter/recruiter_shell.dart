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
// Desktop: a horizontal DesktopTopNav (Home, Library, Analytics, Settings)
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
import 'package:talbotiq/shared/widgets/desktop_top_nav.dart';
import 'package:talbotiq/shared/widgets/floating_nav_bar.dart';
import 'package:talbotiq/shared/widgets/logout_button.dart';
import 'package:talbotiq/features/auth/app_role.dart';
import 'package:talbotiq/features/settings/settings_page.dart';
import 'package:talbotiq/features/recruiter/analytics/analytics_page.dart';
import 'package:talbotiq/features/recruiter/views/management/recruiter_library_page.dart';
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

  static const _desktopNavItems = [
    DesktopTopNavItem(icon: Icons.home_outlined, activeIcon: Icons.home_rounded, label: 'Home'),
    DesktopTopNavItem(
        icon: Icons.folder_special_outlined,
        activeIcon: Icons.folder_special,
        label: 'Library'),
    DesktopTopNavItem(
        icon: Icons.analytics_outlined,
        activeIcon: Icons.analytics_rounded,
        label: 'Analytics'),
  ];

  static const _desktopPages = [
    RecruiterHome(),
    RecruiterLibraryPage(),
    AnalyticsPage(),
  ];

  // Settings is no longer one of the top-nav tabs (moved into the profile
  // menu) so it isn't part of the IndexedStack above — it's a separate
  // overlay flag instead, shown in place of whichever tab was active.
  bool _settingsOpen = false;

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
          tooltip: 'Create interview test',
          onPressed: () => _homeKey.currentState?.createInterview(),
        ),
        body: IndexedStack(index: _index, children: _mobilePages),
      );
    }

    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: Column(
        children: [
          DesktopTopNav(
            // No tab is "active" while Settings is showing — Settings isn't
            // one of these tabs anymore, so leaving Home/Library/Analytics
            // highlighted while its content is on screen would mislabel it.
            // -1 simply matches none of them.
            currentIndex: _settingsOpen ? -1 : _index,
            onSelect: (i) => setState(() {
              _index = i;
              _settingsOpen = false;
            }),
            items: _desktopNavItems,
            trailing: DesktopProfileMenu(
              roleLabel: 'Recruiter',
              onOpenSettings: () => setState(() => _settingsOpen = true),
            ),
          ),
          Expanded(
            child: _settingsOpen
                ? const _RecruiterSettingsTab()
                : IndexedStack(index: _index, children: _desktopPages),
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

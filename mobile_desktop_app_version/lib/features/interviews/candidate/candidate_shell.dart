// lib/features/interviews/candidate/candidate_shell.dart
//
// Candidate primary-navigation shell.
//
// Mobile/web: unchanged — the original 4 destinations (Home, Practice,
// History, Settings) behind the shared AdaptiveNavScaffold (bottom bar on
// narrow windows, sidebar rail on wide ones). Nothing in this file changes
// that code path.
//
// Desktop: mirrors RecruiterShell's exact pattern — a horizontal
// A DesktopSpine (Home, Practice, History, Settings) runs down the left edge,
// moves into the profile menu instead of being a fourth tab, so this is the
// same product family as the recruiter desktop shell. Each hosted page
// (CandidateHome, PracticePage, PracticeHistoryPage) renders without its own
// local AppBar on desktop — the top nav's profile menu owns the single
// Logout affordance — but still runs 100% its own existing body/state/logic;
// only the "do I show my own AppBar" decision is isDesktopPlatform-gated
// inside each of those files.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/utils/desktop_platform.dart';
import 'package:talbotiq/shared/widgets/adaptive_nav_scaffold.dart';
import 'package:talbotiq/shared/widgets/desktop_profile_menu.dart';
import 'package:talbotiq/shared/widgets/desktop_spine.dart';
import 'package:talbotiq/shared/widgets/floating_nav_bar.dart';
import 'package:talbotiq/shared/widgets/logout_button.dart';
import 'package:talbotiq/features/auth/app_role.dart';
import 'package:talbotiq/features/settings/settings_page.dart';
import 'package:talbotiq/features/interviews/candidate/candidate_home.dart';
import 'package:talbotiq/features/interviews/candidate/practice_page.dart';
import 'package:talbotiq/features/interviews/candidate/practice_history_page.dart';

class CandidateShell extends StatefulWidget {
  const CandidateShell({super.key});

  @override
  State<CandidateShell> createState() => _CandidateShellState();
}

class _CandidateShellState extends State<CandidateShell> {
  int _index = 0;

  static const _mobileItems = [
    FloatingNavItem(
        icon: Icons.home_outlined,
        activeIcon: Icons.home_rounded,
        label: 'Home'),
    FloatingNavItem(
        icon: Icons.smart_toy_outlined,
        activeIcon: Icons.smart_toy,
        label: 'Practice'),
    FloatingNavItem(
        icon: Icons.history_outlined,
        activeIcon: Icons.history_rounded,
        label: 'History'),
    FloatingNavItem(
        icon: Icons.settings_outlined,
        activeIcon: Icons.settings_rounded,
        label: 'Settings'),
  ];

  static const _mobilePages = [
    CandidateHome(),
    PracticePage(),
    PracticeHistoryPage(),
    _CandidateSettingsTab(),
  ];

  /// The candidate's spine. Same chrome, same grouping and the same selected
  /// chip as the recruiter's and as the web client's — a candidate who is also
  /// a recruiter elsewhere should not have to learn the product twice.
  ///
  /// The destinations differ because the job does: a candidate has interviews
  /// to sit and practice runs to review, not pipelines to run.
  static const _desktopGroups = [
    SpineGroup(label: 'Interviews', items: [
      SpineItem(
          icon: Icons.home_outlined,
          activeIcon: Icons.home_rounded,
          label: 'Home'),
    ]),
    SpineGroup(label: 'Practice', items: [
      SpineItem(
          icon: Icons.smart_toy_outlined,
          activeIcon: Icons.smart_toy,
          label: 'Practice'),
      SpineItem(
          icon: Icons.history_outlined,
          activeIcon: Icons.history_rounded,
          label: 'History'),
    ]),
    SpineGroup(label: 'Workspace', items: [
      SpineItem(
          icon: Icons.settings_outlined,
          activeIcon: Icons.settings_rounded,
          label: 'Settings'),
    ]),
  ];

  /// Flattened to match the spine's index. Settings is a destination rather
  /// than an item in a profile menu, matching both other shells.
  static const _desktopPages = [
    CandidateHome(),
    PracticePage(),
    PracticeHistoryPage(),
    _CandidateSettingsTab(),
  ];

  @override
  Widget build(BuildContext context) {
    if (!isDesktopPlatform) {
      return AdaptiveNavScaffold(
        currentIndex: _index,
        onSelect: (i) => setState(() => _index = i),
        items: _mobileItems,
        body: IndexedStack(index: _index, children: _mobilePages),
      );
    }

    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: Row(
        children: [
          DesktopSpine(
            currentIndex: _index,
            onSelect: (i) => setState(() => _index = i),
            groups: _desktopGroups,
            account: DesktopProfileMenu(
              roleLabel: 'Candidate',
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

/// Wraps the shared [SettingsPage] with a titled bar + Logout for the
/// candidate. Mobile/web keep that AppBar; desktop shows the settings
/// content directly — the top nav's profile menu already owns Logout there,
/// so a second one would be a duplicate affordance (mirrors
/// RecruiterShell's `_RecruiterSettingsTab`).
class _CandidateSettingsTab extends StatelessWidget {
  const _CandidateSettingsTab();

  @override
  Widget build(BuildContext context) {
    if (isDesktopPlatform) {
      return const SettingsPage(role: AppRole.candidate);
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        actions: const [LogoutButton(), SizedBox(width: 4)],
      ),
      body: const SettingsPage(role: AppRole.candidate),
    );
  }
}

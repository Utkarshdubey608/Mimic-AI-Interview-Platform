// lib/shared/widgets/adaptive_nav_scaffold.dart
//
// Desktop-aware wrapper around the primary-navigation shells (RecruiterShell,
// CandidateShell). On narrow windows it renders exactly the existing
// FloatingNavBar (unchanged mobile experience). On wide windows — a real
// desktop window, not a phone screen stretched out — it renders a
// Material NavigationRail sidebar instead, per the same [FloatingNavItem]
// list and the same IndexedStack body, so no page/business logic changes.
//
// This intentionally does not introduce a new navigation *concept*: the
// selected-index state, item set and page bodies are identical either way.
// Only the chrome around them adapts to the available width.

import 'package:flutter/material.dart';

import 'floating_nav_bar.dart';

/// Below this width the app is treated as a phone/narrow window and keeps the
/// existing bottom FloatingNavBar. At or above it, a sidebar rail is used —
/// this matches the "small desktop" 1280px+ breakpoint discussed for this
/// product with headroom for narrower resizable desktop windows too.
const double kDesktopNavBreakpoint = 760;

class AdaptiveNavScaffold extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onSelect;
  final List<FloatingNavItem> items;
  final Widget body;
  final Color? backgroundColor;

  /// Primary create affordance. On narrow windows it rides inside the bottom
  /// bar; the wide/rail layout has room for page-level actions instead, so it
  /// is ignored there.
  final FloatingNavAction? action;

  const AdaptiveNavScaffold({
    super.key,
    required this.currentIndex,
    required this.onSelect,
    required this.items,
    required this.body,
    this.backgroundColor,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final isWide = constraints.maxWidth >= kDesktopNavBreakpoint;
        if (!isWide) {
          return Scaffold(
              backgroundColor: Colors.transparent,
              body: Stack(
                children: [
                  Positioned.fill(
                    child: body,
                  ),

                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: FloatingNavBar(
                      currentIndex: currentIndex,
                      onSelect: onSelect,
                      items: items,
                      action: action,
                    ),
                  ),
                ],
              ),
            );
        }

        final cs = theme.colorScheme;
        return Scaffold(
          backgroundColor: backgroundColor ?? theme.scaffoldBackgroundColor,
          body: Row(
            children: [
              NavigationRail(
                selectedIndex: currentIndex,
                onDestinationSelected: onSelect,
                labelType: NavigationRailLabelType.all,
                backgroundColor: cs.surface,
                minWidth: 88,
                leading: const SizedBox(height: 12),
                destinations: [
                  for (final item in items)
                    NavigationRailDestination(
                      icon: Icon(item.icon),
                      selectedIcon: Icon(item.activeIcon ?? item.icon),
                      label: Text(item.label),
                    ),
                ],
              ),
              const VerticalDivider(width: 1, thickness: 1),
              Expanded(child: body),
            ],
          ),
        );
      },
    );
  }
}

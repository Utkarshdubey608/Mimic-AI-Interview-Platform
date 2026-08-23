// lib/shared/widgets/floating_nav_bar.dart
//
// The floating bottom bar: a dark stadium pill carrying a light chip on the
// selected destination, bare glyphs on the rest, and an optional create action.
//
// The proportions all derive from ONE number, [_itemHeight]. Every element in
// the bar — the selected chip, the unselected icon buttons, the action circle —
// is exactly that tall, the bar is that plus its padding, and every radius is
// half of whatever it wraps. Earlier versions set those independently (a 62
// tall bar holding 42 tall items with a 46 circle) and the mismatch is what
// read as "odd ratios".
//
// The bar HUGS its content and centres itself, rather than stretching edge to
// edge. A full-width bar left large dead gaps between three items, which is the
// other half of what looked wrong. Row.min + a Flexible chip gives both: the
// bar is as wide as its items, and the chip still ellipsises rather than
// overflowing on a phone too narrow to hold it.

import 'package:flutter/material.dart';
import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

/// Height of every element inside the bar. Everything else is derived.
const double _itemHeight = 46;

/// Identifies the painted pill itself, as distinct from the full-width
/// SafeArea/padding around it. Tests measure proportions against this.
const Key navBarPillKey = Key('floating-nav-bar-pill');

/// Width of an unselected destination — a touch wider than tall so a row of
/// glyphs reads as evenly spaced rather than cramped. Kept modest so that on a
/// narrow phone the space freed goes to the selected chip's label.
const double _iconSlot = 48;

/// Padding between the bar's edge and its items.
const double _barPadding = 6;

/// Gap between items.
const double _itemGap = 4;

/// One destination in a [FloatingNavBar].
class FloatingNavItem {
  final IconData icon;
  final IconData? activeIcon;

  /// Painted only on the selected chip; always exposed to tooltips and to
  /// screen readers.
  final String label;

  const FloatingNavItem({
    required this.icon,
    this.activeIcon,
    required this.label,
  });
}

/// The primary create action, shown as a circle among the destinations.
class FloatingNavAction {
  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;
  const FloatingNavAction({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });
}

class FloatingNavBar extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onSelect;
  final List<FloatingNavItem> items;

  /// Optional create action, placed between the two halves of the
  /// destinations so it reads as central.
  final FloatingNavAction? action;

  const FloatingNavBar({
    super.key,
    required this.currentIndex,
    required this.onSelect,
    required this.items,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = WarmSurfaces.isDark(context);

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.md),
        // Align with heightFactor: 1, NOT Center. Center expands on both axes,
        // and Scaffold measures bottomNavigationBar with a loose constraint —
        // so a Center here claims the entire screen height as "the nav bar" and
        // leaves the body zero height, i.e. a blank page with a bar floating in
        // the middle of it. heightFactor: 1 sizes to the pill while still
        // filling the width, which is what centres it horizontally.
        child: Align(
          alignment: Alignment.center,
          heightFactor: 1,
          child: Container(
            key: navBarPillKey,
            padding: const EdgeInsets.all(_barPadding),
            decoration: BoxDecoration(
              color: WarmSurfaces.navBar(context),
              // Half the bar's height: a true stadium, not an approximation.
              borderRadius:
                  BorderRadius.circular((_itemHeight + _barPadding * 2) / 2),
              border: isDark
                  // On a pure-black page the bar needs an edge or it merges
                  // into the background.
                  ? Border.all(color: Colors.white.withValues(alpha: 0.10))
                  : null,
              boxShadow: AppShadows.floating(context),
            ),
            child: Row(
              // min, so the bar is only as wide as its items.
              mainAxisSize: MainAxisSize.min,
              children: _children(),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _children() {
    Widget buttonAt(int i) => _NavButton(
          item: items[i],
          selected: i == currentIndex,
          onTap: () => onSelect(i),
        );

    // Only the selected chip flexes. In a min-size Row a Flexible child is
    // still offered the space left over from the incoming constraint, so the
    // chip takes its natural width when there is room and shrinks when there
    // is not — the bar keeps hugging either way.
    Widget slotAt(int i) =>
        i == currentIndex ? Flexible(child: buttonAt(i)) : buttonAt(i);

    final out = <Widget>[];
    void add(Widget w) {
      if (out.isNotEmpty) out.add(const SizedBox(width: _itemGap));
      out.add(w);
    }

    final split = action == null ? items.length : items.length ~/ 2;
    for (var i = 0; i < split; i++) {
      add(slotAt(i));
    }
    if (action != null) add(_NavAction(action: action!));
    for (var i = split; i < items.length; i++) {
      add(slotAt(i));
    }
    return out;
  }
}

class _NavButton extends StatelessWidget {
  final FloatingNavItem item;
  final bool selected;
  final VoidCallback onTap;

  const _NavButton({
    required this.item,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final fg = selected ? AppColors.blockInk : AppColors.navBarOnDark;
    final radius = BorderRadius.circular(_itemHeight / 2);

    return Semantics(
      label: item.label,
      button: true,
      selected: selected,
      child: Tooltip(
        message: item.label,
        child: Material(
          color: selected ? AppColors.navBarOnDark : Colors.transparent,
          borderRadius: radius,
          child: InkWell(
            onTap: onTap,
            borderRadius: radius,
            child: SizedBox(
              height: _itemHeight,
              width: selected ? null : _iconSlot,
              child: selected
                  ? Padding(
                      // Tighter than it looks like it wants to be: at 320dp
                      // with four destinations the chip is squeezed hard, and
                      // wider padding leaves the icon + gap alone overflowing
                      // the space Flexible grants it.
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.md + 2),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(item.activeIcon ?? item.icon, color: fg, size: 21),
                          const SizedBox(width: AppSpacing.sm),
                          Flexible(
                            // The chip's own Semantics already names it; the
                            // visible text would otherwise merge into that
                            // label and read "Home\nHome" to a screen reader.
                            child: ExcludeSemantics(
                              child: Text(
                                item.label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                softWrap: false,
                                style: TextStyle(
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: -0.1,
                                  color: fg,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    )
                  : Icon(item.icon, color: fg.withValues(alpha: 0.65), size: 22),
            ),
          ),
        ),
      ),
    );
  }
}

/// The create action: the same height as every other element, so it sits in the
/// row rather than bulging out of it.
class _NavAction extends StatelessWidget {
  final FloatingNavAction action;
  const _NavAction({required this.action});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: action.tooltip,
      button: true,
      child: Tooltip(
        message: action.tooltip,
        child: Material(
          color: WarmSurfaces.block(context),
          shape: const CircleBorder(),
          child: InkWell(
            onTap: action.onPressed,
            customBorder: const CircleBorder(),
            child: SizedBox(
              width: _itemHeight,
              height: _itemHeight,
              child: Icon(action.icon, size: 23, color: AppColors.blockInk),
            ),
          ),
        ),
      ),
    );
  }
}

// lib/shared/widgets/floating_nav_bar.dart

import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

const double _itemHeight = 54;
const double _barPadding = 7;
const double _itemGap = 5;

const Key navBarPillKey = Key('floating-nav-bar-pill');

class FloatingNavItem {
  final IconData icon;
  final IconData? activeIcon;
  final String label;

  const FloatingNavItem({
    required this.icon,
    this.activeIcon,
    required this.label,
  });
}

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
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final isDark = WarmSurfaces.isDark(context);

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          0,
          AppSpacing.lg,
          16,
        ),
        child: Align(
          alignment: Alignment.center,
          heightFactor: 1,
          child: ClipRRect(
            key: navBarPillKey,
            borderRadius: BorderRadius.circular(40),
            child: BackdropFilter(
              filter: ImageFilter.blur(
                sigmaX: 18,
                sigmaY: 18,
              ),
              child: Container(
                padding: const EdgeInsets.all(_barPadding),
                decoration: BoxDecoration(
                  color: isDark
                      ? Colors.black.withValues(alpha: 0.12)
                      : Colors.white.withValues(alpha: 0.20),
                  borderRadius: BorderRadius.circular(40),
                  border: Border.all(
                    color: isDark
                        ? Colors.white.withValues(alpha: 0.12)
                        : Colors.white.withValues(alpha: 0.45),
                    width: 0.8,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(
                        alpha: isDark ? 0.20 : 0.08,
                      ),
                      blurRadius: 24,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: _children(colorScheme),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _children(ColorScheme colorScheme) {
    // Loose-flexible, so the selected destination's expanding label can be
    // squeezed rather than overflowing. With every child at its intrinsic
    // width this bar is a few pixels over budget at 320dp once the real Inter
    // metrics apply — which is exactly what floating_nav_bar_test.dart caught
    // when the font stopped silently falling back to the platform default.
    Widget slotAt(int i) {
      return Flexible(
        fit: FlexFit.loose,
        child: _NavButton(
          item: items[i],
          selected: i == currentIndex,
          onTap: () => onSelect(i),
          colorScheme: colorScheme,
        ),
      );
    }

    final children = <Widget>[];

    void add(Widget widget) {
      if (children.isNotEmpty) {
        children.add(const SizedBox(width: _itemGap));
      }
      children.add(widget);
    }

    final split = action == null ? items.length : items.length ~/ 2;

    for (var i = 0; i < split; i++) {
      add(slotAt(i));
    }

    if (action != null) {
      add(_NavAction(action: action!, colorScheme: colorScheme));
    }

    for (var i = split; i < items.length; i++) {
      add(slotAt(i));
    }

    return children;
  }
}

class _NavButton extends StatelessWidget {
  final FloatingNavItem item;
  final bool selected;
  final VoidCallback onTap;
  final ColorScheme colorScheme;

  const _NavButton({
    required this.item,
    required this.selected,
    required this.onTap,
    required this.colorScheme,
  });

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(_itemHeight / 2);
    const duration = Duration(milliseconds: 250);
    const curve = Curves.easeInOutCubicEmphasized;

    final foreground = selected
        ? colorScheme.onPrimary
        : colorScheme.onSurface.withValues(alpha: 0.60);

    return Semantics(
      label: item.label,
      button: true,
      selected: selected,
      child: Tooltip(
        message: item.label,
        child: Material(
          color: Colors.transparent,
          borderRadius: radius,
          child: InkWell(
            onTap: onTap,
            borderRadius: radius,
            splashColor: colorScheme.primary.withValues(alpha: 0.12),
            highlightColor: colorScheme.primary.withValues(alpha: 0.06),
            child: AnimatedContainer(
              duration: duration,
              curve: curve,
              height: _itemHeight,
              padding: EdgeInsets.symmetric(
                horizontal: selected ? 18.0 : 15.0,
              ),
              decoration: BoxDecoration(
                borderRadius: radius,
                color: selected ? colorScheme.primary : Colors.transparent,
                boxShadow: selected
                    ? [
                        BoxShadow(
                          color: colorScheme.primary.withValues(alpha: 0.20),
                          blurRadius: 12,
                          spreadRadius: -1,
                          offset: const Offset(0, 3),
                        ),
                      ]
                    : [],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Icon fade/swap with zero rotation or scale distortion
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 180),
                    switchInCurve: Curves.easeOut,
                    switchOutCurve: Curves.easeIn,
                    child: Icon(
                      selected ? (item.activeIcon ?? item.icon) : item.icon,
                      key: ValueKey(
                        selected
                            ? (item.activeIcon ?? item.icon)
                            : item.icon,
                      ),
                      color: foreground,
                      size: 22,
                    ),
                  ),

                  // Smooth horizontal expansion for the text label. Flexible so a
                  // long label on a narrow phone clips instead of overflowing;
                  // the icon never yields, because an unlabelled-but-present
                  // destination is still usable and a missing one is not.
                  Flexible(
                    fit: FlexFit.loose,
                    child: AnimatedAlign(
                    duration: duration,
                    curve: curve,
                    alignment: Alignment.centerLeft,
                    widthFactor: selected ? 1.0 : 0.0,
                    child: ClipRect(
                      child: Padding(
                        padding: const EdgeInsets.only(left: 8.0),
                        child: AnimatedOpacity(
                          duration: const Duration(milliseconds: 180),
                          curve: selected ? Curves.easeOut : Curves.easeIn,
                          opacity: selected ? 1.0 : 0.0,
                          child: Text(
                            item.label,
                            maxLines: 1,
                            overflow: TextOverflow.clip,
                            softWrap: false,
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              letterSpacing: -0.15,
                              color: foreground,
                            ),
                          ),
                        ),
                      ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _NavAction extends StatelessWidget {
  final FloatingNavAction action;
  final ColorScheme colorScheme;

  const _NavAction({
    required this.action,
    required this.colorScheme,
  });

  @override
  Widget build(BuildContext context) {
    final background = colorScheme.secondary;
    final foreground = colorScheme.onSecondary;

    return Tooltip(
      message: action.tooltip,
      child: Semantics(
        label: action.tooltip,
        button: true,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeInOutCubicEmphasized,
          width: _itemHeight,
          height: _itemHeight,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: background,
            boxShadow: [
              BoxShadow(
                color: background.withValues(alpha: 0.20),
                blurRadius: 12,
                spreadRadius: -1,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Material(
            color: Colors.transparent,
            shape: const CircleBorder(),
            child: InkWell(
              onTap: action.onPressed,
              customBorder: const CircleBorder(),
              splashColor: foreground.withValues(alpha: 0.10),
              highlightColor: foreground.withValues(alpha: 0.05),
              child: Center(
                child: Icon(
                  action.icon,
                  size: 25,
                  color: foreground,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
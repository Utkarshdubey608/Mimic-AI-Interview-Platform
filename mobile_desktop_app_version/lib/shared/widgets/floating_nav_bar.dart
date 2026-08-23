// lib/shared/widgets/floating_nav_bar.dart

import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

const double _itemHeight = 54;
const double _barPadding = 7;
const double _itemGap = 5;
const double _barBorder = 0.8;

// Every width in the bar comes from these, and so does the fits-or-not sum in
// [_selectedWidth] — the two drifting apart is what let the selected label be
// laid out in a slot narrower than the label.
const double _iconSize = 22;
const double _iconPadding = 15; // an unselected, icon-only destination
const double _selectedPadding = 18; // the selected pill, which also has a label
const double _labelGap = 8;
const double _labelSize = 15;

/// A true stadium: half the bar's own height (one item plus its padding),
/// rather than a constant that happens to be larger and gets clamped.
const double _barRadius = (_itemHeight + 2 * _barPadding) / 2;

/// The selected destination's label style, in one place because it is both
/// rendered and measured — a mismatch between the two would put the label back
/// in a slot that cannot hold it.
TextStyle navBarLabelStyle(ThemeData theme, {Color? color}) => TextStyle(
      fontFamily: theme.textTheme.bodyLarge?.fontFamily,
      fontSize: _labelSize,
      fontWeight: FontWeight.w700,
      letterSpacing: -0.15,
      color: color,
    );

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
        // The label is shown only when the bar can hold ALL of it, so the width
        // available has to be known before the children are built.
        child: LayoutBuilder(
          builder: (context, constraints) {
            final showLabel = _labelFits(context, theme, constraints.maxWidth);

            return Align(
              alignment: Alignment.center,
              heightFactor: 1,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(_barRadius),
                child: BackdropFilter(
                  filter: ImageFilter.blur(
                    sigmaX: 18,
                    sigmaY: 18,
                  ),
                  child: Container(
                    key: navBarPillKey,
                    padding: const EdgeInsets.all(_barPadding),
                    decoration: BoxDecoration(
                      color: isDark
                          ? Colors.black.withValues(alpha: 0.12)
                          : Colors.white.withValues(alpha: 0.20),
                      borderRadius: BorderRadius.circular(_barRadius),
                      border: Border.all(
                        color: isDark
                            ? Colors.white.withValues(alpha: 0.12)
                            : Colors.white.withValues(alpha: 0.45),
                        width: _barBorder,
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
                    // The last resort. Four destinations plus the create action
                    // are a few pixels over budget at 320dp even with no label
                    // at all, and every child here is fixed-width by design —
                    // so the bar scales by those few percent instead of one
                    // item being squeezed to absorb the whole deficit.
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: _children(theme, colorScheme, showLabel),
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  /// Whether the selected destination's label fits at its natural width.
  ///
  /// All-or-nothing, and this is the whole point of it: the previous version
  /// made every slot `Flexible`, which shares the width EQUALLY rather than by
  /// need, so the selected pill was handed a third of the bar whatever its
  /// label measured and "Settings" was drawn as "Setti" — on a 412dp phone with
  /// 90 spare pixels either side of the bar. A label that would be cut is not
  /// drawn at all; the icon, the tooltip and the Semantics label still name the
  /// destination.
  bool _labelFits(BuildContext context, ThemeData theme, double maxWidth) {
    if (!maxWidth.isFinite) return true;
    if (currentIndex < 0 || currentIndex >= items.length) return false;

    final painter = TextPainter(
      text: TextSpan(
        text: items[currentIndex].label,
        style: navBarLabelStyle(theme),
      ),
      textDirection: Directionality.of(context),
      textScaler: MediaQuery.textScalerOf(context),
      maxLines: 1,
    )..layout();

    final slots = items.length + (action == null ? 0 : 1);
    final needed = 2 * _barPadding +
        2 * _barBorder +
        (items.length - 1) * (2 * _iconPadding + _iconSize) +
        (2 * _selectedPadding + _iconSize) +
        (action == null ? 0.0 : _itemHeight) +
        (slots - 1) * _itemGap +
        _labelGap +
        painter.width;

    return needed <= maxWidth;
  }

  List<Widget> _children(
      ThemeData theme, ColorScheme colorScheme, bool showLabel) {
    // Every slot takes its natural width. Nothing here is flexible: the only
    // thing that varies is whether the selected pill carries its label, and
    // that is already decided by [_labelFits].
    Widget slotAt(int i) {
      return _NavButton(
        item: items[i],
        selected: i == currentIndex,
        showLabel: showLabel,
        labelStyle: navBarLabelStyle(theme),
        onTap: () => onSelect(i),
        colorScheme: colorScheme,
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

  /// Whether the bar is wide enough for the selected label in full. False keeps
  /// this destination icon-only even when it is the selected one.
  final bool showLabel;
  final TextStyle labelStyle;
  final VoidCallback onTap;
  final ColorScheme colorScheme;

  const _NavButton({
    required this.item,
    required this.selected,
    required this.showLabel,
    required this.labelStyle,
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
    final labelled = selected && showLabel;

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
                horizontal: selected ? _selectedPadding : _iconPadding,
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

                  // Smooth horizontal expansion for the text label: the slot
                  // grows from nothing to the label's full width. Not flexible
                  // — the bar decides whether the label is shown at all, so
                  // there is nothing left here to squeeze.
                  //
                  // ExcludeSemantics because the destination is already named
                  // by the Semantics wrapper above; without it the visible
                  // label merges into that one and a screen reader announces
                  // the selected destination as "Home\nHome".
                  AnimatedAlign(
                    duration: duration,
                    curve: curve,
                    alignment: Alignment.centerLeft,
                    widthFactor: labelled ? 1.0 : 0.0,
                    child: ClipRect(
                      child: Padding(
                        padding: const EdgeInsets.only(left: _labelGap),
                        child: AnimatedOpacity(
                          duration: const Duration(milliseconds: 180),
                          curve: labelled ? Curves.easeOut : Curves.easeIn,
                          opacity: labelled ? 1.0 : 0.0,
                          child: ExcludeSemantics(
                            child: Text(
                              item.label,
                              maxLines: 1,
                              softWrap: false,
                              style: labelStyle.copyWith(color: foreground),
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
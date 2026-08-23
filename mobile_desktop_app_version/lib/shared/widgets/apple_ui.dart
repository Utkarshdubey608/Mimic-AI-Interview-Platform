// lib/widgets/apple_ui.dart
//
// A small, self-contained "Apple design language" UI kit used across the
// setup and settings screens: large titles, inset grouped lists with hairline
// separators, squircle icon badges, disclosure rows, an option picker sheet and
// a segmented control. Everything reads from the active [ThemeData] so it works
// in both light and dark mode.
import 'package:flutter/material.dart';
import 'package:talbotiq/core/constants/colors.dart';

// ── Large title ─────────────────────────────────────────────────────────────

/// iOS-style large title block: optional eyebrow, big bold title and subtitle.
class AppleLargeTitle extends StatelessWidget {
  final String? eyebrow;
  final String title;
  final String? subtitle;
  final Widget? trailing;

  const AppleLargeTitle({
    super.key,
    this.eyebrow,
    required this.title,
    this.subtitle,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (eyebrow != null) ...[
                Text(
                  eyebrow!.toUpperCase(),
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.secondary,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.4,
                  ),
                ),
                const SizedBox(height: 8),
              ],
              Text(
                title,
                style: theme.textTheme.headlineLarge?.copyWith(
                  fontSize: 34,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -1.2,
                  height: 1.05,
                ),
              ),
              if (subtitle != null) ...[
                const SizedBox(height: 8),
                Text(subtitle!, style: theme.textTheme.bodyMedium),
              ],
            ],
          ),
        ),
        if (trailing != null) ...[
          const SizedBox(width: 16),
          trailing!,
        ],
      ],
    );
  }
}

// ── Grouped list ──────────────────────────────────────────────────────────

/// An inset grouped container (iOS Settings section): rounded surface card with
/// a subtle border and hairline dividers automatically inserted between rows.
class AppleGroup extends StatelessWidget {
  final String? header;
  final String? footer;
  final List<Widget> children;

  /// Left indent for the dividers — set to match the row's leading content so
  /// separators line up under the text (44 ≈ icon badge + gap).
  final double dividerIndent;

  const AppleGroup({
    super.key,
    this.header,
    this.footer,
    required this.children,
    this.dividerIndent = 16,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final rows = <Widget>[];
    for (int i = 0; i < children.length; i++) {
      rows.add(children[i]);
      if (i != children.length - 1) {
        rows.add(Divider(
          height: 1,
          thickness: 0.7,
          indent: dividerIndent,
          color: theme.colorScheme.outline.withValues(alpha: 0.5),
        ));
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (header != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Text(
              header!.toUpperCase(),
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.8,
              ),
            ),
          ),
        Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: theme.colorScheme.outline.withValues(alpha: 0.6)),
          ),
          child: Column(children: rows),
        ),
        if (footer != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Text(
              footer!,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontSize: 12,
                color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.9),
              ),
            ),
          ),
      ],
    );
  }
}

// ── Section card ────────────────────────────────────────────────────────────

/// A titled content card matching the grouped-list aesthetic (surface fill,
/// hairline border, 14px radius). Used to frame form sections consistently.
class AppleSectionCard extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final Widget child;

  const AppleSectionCard({
    super.key,
    required this.title,
    this.subtitle,
    this.trailing,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: theme.colorScheme.outline.withValues(alpha: 0.6)),
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: theme.textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 3),
                      Text(subtitle!,
                          style:
                              theme.textTheme.bodyMedium?.copyWith(fontSize: 12)),
                    ],
                  ],
                ),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: 18),
          child,
        ],
      ),
    );
  }
}

// ── Icon badge ──────────────────────────────────────────────────────────────

/// Rounded "squircle" icon tile used as the leading element on rows.
class AppleIconBadge extends StatelessWidget {
  final IconData icon;
  final Color color;
  final double size;

  const AppleIconBadge({
    super.key,
    required this.icon,
    required this.color,
    this.size = 30,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(size * 0.28),
      ),
      alignment: Alignment.center,
      // The glyph follows the fill's brightness rather than always being white.
      // The language's fills are light pastels, on which a white glyph is
      // effectively invisible — and this widget is handed a caller's colour, so
      // it cannot assume either way.
      child: Icon(
        icon,
        color: ThemeData.estimateBrightnessForColor(color) == Brightness.dark
            ? Colors.white
            : AppColors.blockInk,
        size: size * 0.6,
      ),
    );
  }
}

// ── Rows ──────────────────────────────────────────────────────────────────

/// A single settings row: optional leading badge, title/subtitle, trailing
/// widget and tap handler. Designed to sit inside an [AppleGroup].
class AppleRow extends StatelessWidget {
  final Widget? leading;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

  const AppleRow({
    super.key,
    this.leading,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            if (leading != null) ...[
              leading!,
              const SizedBox(width: 12),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w500,
                      color: theme.colorScheme.onSurface,
                    ),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      style: theme.textTheme.bodyMedium?.copyWith(fontSize: 12),
                    ),
                  ],
                ],
              ),
            ),
            if (trailing != null) ...[
              const SizedBox(width: 12),
              trailing!,
            ],
          ],
        ),
      ),
    );
  }
}

/// A disclosure row that shows the current value on the right with a chevron —
/// tap to open a picker. Mirrors the iOS "detail" cell.
class AppleDisclosureRow extends StatelessWidget {
  final Widget? leading;
  final String title;
  final String value;
  final VoidCallback onTap;

  const AppleDisclosureRow({
    super.key,
    this.leading,
    required this.title,
    required this.value,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AppleRow(
      leading: leading,
      title: title,
      onTap: onTap,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 200),
            child: Text(
              value,
              textAlign: TextAlign.right,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          const SizedBox(width: 4),
          Icon(Icons.chevron_right,
              size: 20, color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.6)),
        ],
      ),
    );
  }
}

/// A toggle row (label/subtitle + Switch) styled for [AppleGroup].
class AppleSwitchRow extends StatelessWidget {
  final Widget? leading;
  final String title;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  const AppleSwitchRow({
    super.key,
    this.leading,
    required this.title,
    this.subtitle,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return AppleRow(
      leading: leading,
      title: title,
      subtitle: subtitle,
      onTap: () => onChanged(!value),
      trailing: Switch.adaptive(value: value, onChanged: onChanged),
    );
  }
}

// ── Option picker sheet ─────────────────────────────────────────────────────

/// One selectable option for [showAppleOptions].
class AppleOption<T> {
  final T value;
  final String label;
  final String? subtitle;
  const AppleOption(this.value, this.label, {this.subtitle});
}

/// Presents a rounded modal sheet with a checkmark list and returns the picked
/// value (or null if dismissed). The iOS way to choose from a long list.
Future<T?> showAppleOptions<T>(
  BuildContext context, {
  required String title,
  required List<AppleOption<T>> options,
  required T selected,
}) {
  return showModalBottomSheet<T>(
    context: context,
    showDragHandle: true,
    backgroundColor: Theme.of(context).colorScheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
    ),
    builder: (ctx) {
      final theme = Theme.of(ctx);
      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text(title,
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.bold)),
            ),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: options.length,
                separatorBuilder: (_, __) => Divider(
                  height: 1,
                  thickness: 0.7,
                  indent: 20,
                  color: theme.colorScheme.outline.withValues(alpha: 0.5),
                ),
                itemBuilder: (_, i) {
                  final opt = options[i];
                  final isSel = opt.value == selected;
                  return ListTile(
                    title: Text(opt.label),
                    subtitle: opt.subtitle != null
                        ? Text(opt.subtitle!,
                            maxLines: 1, overflow: TextOverflow.ellipsis)
                        : null,
                    trailing: isSel
                        ? Icon(Icons.check, color: theme.colorScheme.primary)
                        : null,
                    onTap: () => Navigator.pop(ctx, opt.value),
                  );
                },
              ),
            ),
            const SizedBox(height: 8),
          ],
        ),
      );
    },
  );
}

// ── Segmented control ─────────────────────────────────────────────────────

/// A compact iOS-style segmented control. [labels]/[icons] index-aligned.
class AppleSegmented extends StatelessWidget {
  final List<String> labels;
  final List<IconData>? icons;
  final int selectedIndex;
  final ValueChanged<int> onChanged;

  const AppleSegmented({
    super.key,
    required this.labels,
    this.icons,
    required this.selectedIndex,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          for (int i = 0; i < labels.length; i++)
            Expanded(
              child: GestureDetector(
                onTap: () => onChanged(i),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(
                    color: i == selectedIndex
                        ? theme.colorScheme.surface
                        : Colors.transparent,
                    borderRadius: BorderRadius.circular(9),
                    border: i == selectedIndex
                        ? Border.all(color: theme.colorScheme.outline.withValues(alpha: 0.6))
                        : null,
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      if (icons != null) ...[
                        Icon(icons![i],
                            size: 16,
                            color: i == selectedIndex
                                ? theme.colorScheme.primary
                                : theme.colorScheme.onSurfaceVariant),
                        const SizedBox(width: 6),
                      ],
                      Flexible(
                        child: Text(
                          labels[i],
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: i == selectedIndex
                                ? FontWeight.w600
                                : FontWeight.w500,
                            color: i == selectedIndex
                                ? theme.colorScheme.onSurface
                                : theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

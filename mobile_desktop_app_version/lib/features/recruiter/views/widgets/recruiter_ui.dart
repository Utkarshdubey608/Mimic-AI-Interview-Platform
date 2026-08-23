// lib/features/recruiter/views/widgets/recruiter_ui.dart
//
// Shared presentational helpers for the recruiter module, styled to match the
// minimal dark design system (flat dark cards, 12-14px radius, hairline borders,
// clean Inter typography).

import 'package:flutter/material.dart';
import 'package:talbotiq/core/constants/colors.dart';
import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/status_tones.dart';
import 'package:provider/provider.dart';

import 'package:talbotiq/core/theme/accent_palette.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/shared/providers/app_store.dart';

class RecruiterPageHeader extends StatelessWidget {
  final String kicker;
  final String title;
  final String? subtitle;
  final Widget? action;

  const RecruiterPageHeader({
    super.key,
    required this.kicker,
    required this.title,
    this.subtitle,
    this.action,
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
              Text(
                kicker.toUpperCase(),
                style: TextStyle(
                  color: WarmSurfaces.inkSubtle(context),
                  fontWeight: FontWeight.w700,
                  fontSize: 11,
                  letterSpacing: 1.0,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                title,
                style: theme.textTheme.headlineMedium?.copyWith(
                  fontSize: 24,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.6,
                  color: WarmSurfaces.ink(context),
                ),
              ),
              if (subtitle != null) ...[
                const SizedBox(height: 4),
                Text(
                  subtitle!,
                  style: TextStyle(
                    fontSize: 13,
                    color: WarmSurfaces.inkMuted(context),
                  ),
                ),
              ],
            ],
          ),
        ),
        if (action != null) ...[const SizedBox(width: 12), action!],
      ],
    );
  }
}

class RecruiterEmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String description;
  final Widget? action;

  const RecruiterEmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.description,
    this.action,
  });

  @override
  Widget build(BuildContext context) {

    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 32, color: WarmSurfaces.inkSubtle(context)),
            const SizedBox(height: 14),
            Text(
              title,
              style: TextStyle(
                fontSize: 15.5,
                fontWeight: FontWeight.w700,
                color: WarmSurfaces.ink(context),
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              description,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13,
                height: 1.4,
                color: WarmSurfaces.inkMuted(context),
              ),
            ),
            if (action != null) ...[const SizedBox(height: 16), action!],
          ],
        ),
      ),
    );
  }
}

class RecruiterBadge extends StatelessWidget {
  final String text;
  final Color color;

  const RecruiterBadge({super.key, required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        border: Border.all(color: color.withValues(alpha: 0.3)),
        borderRadius: AppRadius.all(AppRadius.xs),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// Maps a session status string to a status tone. These are the user's chosen
/// accents now — see StatusTone for why that is safe.
Color statusColor(BuildContext context, String status) {
  switch (status) {
    case 'completed':
      return StatusTone.ready(context);
    case 'in_progress':
    case 'system_check':
      return StatusTone.pending(context);
    case 'expired':
      return StatusTone.failed(context);
    case 'created':
    default:
      return StatusTone.neutral(context);
  }
}

/// The mid-band / "needs attention" tone.
Color warningColor(BuildContext context) => StatusTone.borderline(context);

/// Shared 0-100 score → colour banding.
Color scoreColor(BuildContext context, num score) =>
    StatusTone.forScore(context, score);

/// The recruiter dashboard's standard content panel (flat dark surface, 14px radius, hairline border).
class RecruiterPanel extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;

  const RecruiterPanel({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.lg + 2),
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final decorated = Container(
      padding: padding,
      decoration: WarmSurfaces.card(context, radius: AppRadius.card),
      child: child,
    );
    if (onTap == null) return decorated;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.cardAll,
        child: decorated,
      ),
    );
  }
}

/// Section heading used between panels.
class RecruiterSectionTitle extends StatelessWidget {
  final String text;
  const RecruiterSectionTitle(this.text, {super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(left: 2),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
          color: WarmSurfaces.ink(context),
        ),
      ),
    );
  }
}

/// Compact metric tile: icon chip, label, large value, optional footnote.
class RecruiterStatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final String? footnote;
  final Color? color;

  const RecruiterStatCard({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    this.footnote,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final c = color ?? AppColors.pastelMintText;

    return RecruiterPanel(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Container(
                width: 30,
                height: 30,
                decoration: BoxDecoration(color: c, shape: BoxShape.circle),
                child: Icon(icon, size: 15, color: WarmSurfaces.onBlock),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w500,
                    color: WarmSurfaces.inkMuted(context),
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            value,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.7,
              color: WarmSurfaces.ink(context),
            ),
          ),
          if (footnote != null) ...[
            const SizedBox(height: 3),
            Text(
              footnote!,
              style: TextStyle(
                fontSize: 11.5,
                color: WarmSurfaces.inkSubtle(context),
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }
}

/// Wrap-based responsive tile grid.
class RecruiterResponsiveGrid extends StatelessWidget {
  final List<Widget> children;
  final double targetTileWidth;
  const RecruiterResponsiveGrid({
    super.key,
    required this.children,
    this.targetTileWidth = 170,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final maxW = constraints.maxWidth;
        var perRow = (maxW / targetTileWidth).floor();
        if (perRow < 2) perRow = 2;
        if (perRow > 5) perRow = 5;
        const spacing = 12.0;
        final tileW = (maxW - spacing * (perRow - 1)) / perRow;
        return Wrap(
          spacing: spacing,
          runSpacing: spacing,
          children: [
            for (final c in children) SizedBox(width: tileW, child: c),
          ],
        );
      },
    );
  }
}


// ---------------------------------------------------------------------------
// The reusable pieces of the minimal-dark language, promoted here so screens
// stop re-implementing them privately. Each one is theme-aware (the app ships
// a light theme too) and leans on AppSpacing/AppRadius rather than loose
// pixel values.
// ---------------------------------------------------------------------------

/// The reference language's compact list row:
///
///   ○  Title
///      muted metadata                                    ›
///
/// No card around it — rows sit directly on the page, separated by
/// [RecruiterRowSeparator]. Wrap a run of them in a [RecruiterPanel] only
/// when the group genuinely needs to read as one object.
class RecruiterListRow extends StatelessWidget {
  final IconData icon;

  /// Tints the circular icon chip's border and glyph. One of the pastels.
  final Color iconColor;

  final String title;

  /// Muted second line — "18 notes / updated 2h ago" in the reference.
  final String? subtitle;

  /// Rendered before [subtitle] in [iconColor], for a type/status word.
  final String? leadLabel;

  /// Replaces the chevron (a badge, a switch, a menu button).
  final Widget? trailing;

  final VoidCallback? onTap;
  final bool dense;

  const RecruiterListRow({
    super.key,
    required this.icon,
    required this.title,
    this.iconColor = AppColors.pastelCyanText,
    this.subtitle,
    this.leadLabel,
    this.trailing,
    this.onTap,
    this.dense = false,
  });

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: dense ? AppSpacing.md - 1 : AppSpacing.lg - 2,
      ),
      child: Row(
        children: [
          Container(
            width: dense ? 34 : 40,
            height: dense ? 34 : 40,
            decoration: BoxDecoration(color: iconColor, shape: BoxShape.circle),
            child: Icon(
              icon,
              size: dense ? 16 : 19,
              color: WarmSurfaces.onBlock,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.2,
                    color: WarmSurfaces.ink(context),
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle != null || leadLabel != null) ...[
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      if (leadLabel != null)
                        Text(
                          leadLabel!,
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w500,
                            color: iconColor,
                          ),
                        ),
                      if (subtitle != null)
                        Expanded(
                          child: Text(
                            leadLabel != null ? ' · $subtitle' : subtitle!,
                            style: TextStyle(
                              fontSize: 12.5,
                              color: AppSurfaces.muted(context),
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          trailing ??
              Icon(
                Icons.chevron_right_rounded,
                size: 18,
                color: WarmSurfaces.inkSubtle(context),
              ),
        ],
      ),
    );

    if (onTap == null) return row;
    return Material(
      color: Colors.transparent,
      child: InkWell(onTap: onTap, child: row),
    );
  }
}

/// The thin rule between list rows. Inset to clear the icon chip so the
/// separators line up under the text, as in the reference.
class RecruiterRowSeparator extends StatelessWidget {
  final double indent;
  const RecruiterRowSeparator({super.key, this.indent = 66});

  @override
  Widget build(BuildContext context) {
    return Divider(
      height: 1,
      thickness: 1,
      indent: indent,
      endIndent: AppSpacing.md + 2,
      color: WarmSurfaces.separator(context),
    );
  }
}

/// A compact filter/tag pill. Selected pills take a subtle pastel accent
/// rather than a filled block of colour.
class RecruiterFilterPill extends StatelessWidget {
  final String label;

  /// Optional trailing count, as in the reference's folder pills.
  final int? count;

  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  const RecruiterFilterPill({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.count,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {

    // Selected reads as a solid block; unselected as a bare surface. Two
    // shades of the same chip would not survive the warm ground.
    final fg = selected
        ? WarmSurfaces.onSelectedBlock(context)
        : WarmSurfaces.inkMuted(context);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: AppRadius.all(AppRadius.md),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg - 2,
            vertical: AppSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: selected
                ? WarmSurfaces.selectedBlock(context)
                : WarmSurfaces.surface(context),
            borderRadius: AppRadius.all(AppRadius.md),
            border: Border.all(
              color: selected ? Colors.transparent : WarmSurfaces.stroke(context),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 13, color: fg),
                const SizedBox(width: 5),
              ],
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: fg,
                ),
              ),
              if (count != null) ...[
                const SizedBox(width: 5),
                Text(
                  '$count',
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: fg.withValues(alpha: selected ? 0.7 : 0.6),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Horizontally scrolling pill strip. Takes the pills so callers keep their
/// own selection logic.
class RecruiterPillBar extends StatelessWidget {
  final List<Widget> pills;
  final EdgeInsetsGeometry padding;

  const RecruiterPillBar({
    super.key,
    required this.pills,
    this.padding = EdgeInsets.zero,
  });

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      padding: padding,
      child: Row(
        children: [
          for (var i = 0; i < pills.length; i++) ...[
            if (i > 0) const SizedBox(width: AppSpacing.sm),
            pills[i],
          ],
        ],
      ),
    );
  }
}

/// Small uppercase muted section label — the reference's "FIXED" / "LABELS".
/// Distinct from [RecruiterSectionTitle], which is the larger sentence-case
/// heading between panels.
class RecruiterLabel extends StatelessWidget {
  final String text;
  final Widget? trailing;

  const RecruiterLabel(this.text, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            text.toUpperCase(),
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.0,
              color: WarmSurfaces.inkSubtle(context),
            ),
          ),
        ),
        if (trailing != null) trailing!,
      ],
    );
  }
}

/// High-contrast primary action. Compact — comfortable touch target without
/// the full-bleed Material slab.
class RecruiterPrimaryButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool busy;
  final bool expand;

  const RecruiterPrimaryButton({
    super.key,
    required this.label,
    this.icon,
    this.onPressed,
    this.busy = false,
    this.expand = false,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;

    // The primary action carries the accent block itself — on this ground a
    // peach slab reads as the one thing to press.
    final bg = WarmSurfaces.block(context);
    const fg = AppColors.blockInk;

    final child = Row(
      mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (busy)
          SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2, color: fg),
          )
        else if (icon != null)
          Icon(icon, size: 16, color: fg),
        if (busy || icon != null) const SizedBox(width: AppSpacing.sm),
        Flexible(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w600,
              color: fg,
            ),
          ),
        ),
      ],
    );

    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: Material(
        color: bg,
        borderRadius: AppRadius.all(AppRadius.md),
        child: InkWell(
          onTap: enabled ? onPressed : null,
          borderRadius: AppRadius.all(AppRadius.md),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.xl,
              vertical: AppSpacing.lg - 2,
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

/// Dark surface, hairline border, muted text.
class RecruiterSecondaryButton extends StatelessWidget {
  final String label;
  final IconData? icon;
  final VoidCallback? onPressed;
  final bool expand;

  /// Tints the label and glyph — used for destructive actions.
  final Color? tint;

  const RecruiterSecondaryButton({
    super.key,
    required this.label,
    this.icon,
    this.onPressed,
    this.expand = false,
    this.tint,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null;
    final fg = tint ?? WarmSurfaces.ink(context);

    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: Material(
        color: WarmSurfaces.surface(context),
        borderRadius: AppRadius.all(AppRadius.md),
        child: InkWell(
          onTap: onPressed,
          borderRadius: AppRadius.all(AppRadius.md),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: AppRadius.all(AppRadius.md),
              border: Border.all(
                color: tint?.withValues(alpha: 0.4) ??
                    WarmSurfaces.stroke(context),
              ),
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.xl,
              vertical: AppSpacing.lg - 2,
            ),
            child: Row(
              mainAxisSize: expand ? MainAxisSize.max : MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 16, color: fg),
                  const SizedBox(width: AppSpacing.sm),
                ],
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                      color: fg,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A text field wearing the language: dark inner surface, hairline border,
/// 12px radius, compact padding. Wraps the caller's own controller — no
/// state, no validation opinions.
class RecruiterInput extends StatelessWidget {
  final TextEditingController? controller;
  final String? hint;
  final String? label;
  final IconData? icon;
  final Widget? trailing;
  final int? maxLines;
  final int? minLines;
  final TextInputType? keyboardType;
  final ValueChanged<String>? onChanged;
  final bool enabled;

  const RecruiterInput({
    super.key,
    this.controller,
    this.hint,
    this.label,
    this.icon,
    this.trailing,
    this.maxLines = 1,
    this.minLines,
    this.keyboardType,
    this.onChanged,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    final field = Container(
      decoration: BoxDecoration(
        color: WarmSurfaces.surface(context),
        borderRadius: AppRadius.all(AppRadius.md),
        border: Border.all(color: WarmSurfaces.stroke(context)),
      ),
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
      child: Row(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 16, color: WarmSurfaces.inkMuted(context)),
            const SizedBox(width: AppSpacing.sm),
          ],
          Expanded(
            child: TextField(
              controller: controller,
              enabled: enabled,
              maxLines: maxLines,
              minLines: minLines,
              keyboardType: keyboardType,
              onChanged: onChanged,
              style: TextStyle(
                fontSize: 13.5,
                color: WarmSurfaces.ink(context),
              ),
              decoration: InputDecoration(
                isDense: true,
                filled: false,
                hintText: hint,
                hintStyle: TextStyle(
                  fontSize: 13.5,
                  color: WarmSurfaces.inkSubtle(context),
                ),
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(
                  vertical: AppSpacing.md,
                ),
              ),
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );

    if (label == null) return field;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        RecruiterLabel(label!),
        const SizedBox(height: AppSpacing.sm - 2),
        field,
      ],
    );
  }
}

/// The understated bar chart the reference uses under its "68/90 Tasks done"
/// metric: thin bars, one accent colour, no axes, no gridlines, no legend.
class RecruiterMiniBars extends StatelessWidget {
  final List<double> values;

  /// Defaults to the user's secondary accent.
  final Color? color;

  final double height;

  const RecruiterMiniBars({
    super.key,
    required this.values,
    this.color,
    this.height = 44,
  });

  @override
  Widget build(BuildContext context) {
    if (values.isEmpty) return SizedBox(height: height);
    final max = values.reduce((a, b) => a > b ? a : b);
    final safeMax = max <= 0 ? 1.0 : max;

    return SizedBox(
      height: height,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (final v in values)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 1),
                child: Container(
                  height: (height * (v / safeMax)).clamp(2.0, height),
                  decoration: BoxDecoration(
                    color: (color ?? WarmSurfaces.blockSecondary(context))
                        .withValues(alpha: 0.85),
                    borderRadius: BorderRadius.circular(1.5),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A metric panel with a large value, a small label and an optional
/// [RecruiterMiniBars] strip — the reference's monthly-report card.
class RecruiterMetricPanel extends StatelessWidget {
  final String value;
  final String label;
  final String? caption;
  final List<double>? series;

  /// Defaults to the user's secondary accent.
  final Color? accent;

  const RecruiterMetricPanel({
    super.key,
    required this.value,
    required this.label,
    this.caption,
    this.series,
    this.accent,
  });

  @override
  Widget build(BuildContext context) {
    return RecruiterPanel(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                value,
                style: TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -1.2,
                  height: 1.05,
                  color: WarmSurfaces.ink(context),
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12.5,
                  color: WarmSurfaces.inkMuted(context),
                ),
              ),
              if (caption != null) ...[
                const SizedBox(height: 2),
                Text(
                  caption!,
                  style: TextStyle(
                    fontSize: 11.5,
                    color: WarmSurfaces.inkSubtle(context),
                  ),
                ),
              ],
            ],
          ),
          if (series != null && series!.isNotEmpty) ...[
            const SizedBox(width: AppSpacing.lg),
            Expanded(
              child: RecruiterMiniBars(
                values: series!,
                color: accent ?? WarmSurfaces.blockSecondary(context),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The one create affordance shape used across the recruiter module: a small
/// circular pastel button. The reference keeps its "+" compact and part of the
/// navigation furniture rather than a wide standalone slab, so the label lives
/// in the tooltip instead of on the button.
class RecruiterFab extends StatelessWidget {
  final VoidCallback onPressed;

  /// Describes the action for tooltip and screen readers — the label the
  /// extended FAB used to spell out.
  final String tooltip;

  final IconData icon;

  const RecruiterFab({
    super.key,
    required this.onPressed,
    required this.tooltip,
    this.icon = Icons.add_rounded,
  });

  @override
  Widget build(BuildContext context) {
    return FloatingActionButton.small(
      onPressed: onPressed,
      backgroundColor: WarmSurfaces.block(context),
      foregroundColor: AppColors.blockInk,
      elevation: 2,
      tooltip: tooltip,
      child: Icon(icon, size: 22),
    );
  }
}

/// One cell of a [RecruiterMetricStrip].
class RecruiterMetric {
  final String value;
  final String label;
  final Color color;
  const RecruiterMetric({
    required this.value,
    required this.label,
    this.color = AppColors.pastelCyanText,
  });
}

/// A row of headline numbers in one panel, divided by hairlines — for two to
/// four short metrics that belong together. Separate cards either truncate
/// their labels at phone width or leave the last one stranded on its own row.
///
/// Wrapped in [IntrinsicHeight] deliberately: the dividers have no height of
/// their own and rely on the row's cross-axis extent, which is unbounded
/// inside a scrolling column. Without it the row throws "BoxConstraints
/// forces an infinite height" and takes the whole page down with it.
class RecruiterMetricStrip extends StatelessWidget {
  final List<RecruiterMetric> metrics;

  const RecruiterMetricStrip({super.key, required this.metrics});

  @override
  Widget build(BuildContext context) {
    if (metrics.isEmpty) return const SizedBox.shrink();

    return RecruiterPanel(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var k = 0; k < metrics.length; k++) ...[
              if (k > 0)
                Container(width: 1, color: WarmSurfaces.stroke(context)),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      metrics[k].value,
                      maxLines: 1,
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.7,
                        height: 1.1,
                        color: WarmSurfaces.ink(context),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xs + 1),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 2),
                      child: Text(
                        metrics[k].label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 11.5,
                          color: WarmSurfaces.inkMuted(context),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// State of one segment in a [RecruiterSegmentedProgress].
enum RecruiterSegmentState {
  /// Finished — filled, but quietly.
  done,

  /// Where things stand right now — carries the accent.
  current,

  /// Not reached yet.
  idle,
}

/// A thin segmented progress bar: one bar per stage, rather than a single
/// percentage. Used for a multi-round interview pipeline on the dashboard,
/// where "3 of 5 done, currently on 4" is the reading — a continuous bar would
/// throw away the stage boundaries that are the whole point.
///
/// Domain-free on purpose: callers map their own states onto
/// [RecruiterSegmentState] so this stays in the design system rather than
/// pulling a feature model into it.
class RecruiterSegmentedProgress extends StatelessWidget {
  final List<RecruiterSegmentState> segments;

  /// Accent for the [RecruiterSegmentState.current] segment.
  final Color currentColor;

  final double height;

  const RecruiterSegmentedProgress({
    super.key,
    required this.segments,
    required this.currentColor,
    this.height = 3,
  });

  @override
  Widget build(BuildContext context) {
    if (segments.isEmpty) return SizedBox(height: height);

    final doneColor = WarmSurfaces.inkSubtle(context);
    final idleColor = WarmSurfaces.surfaceHigh(context);

    Color colorFor(RecruiterSegmentState s) {
      switch (s) {
        case RecruiterSegmentState.done:
          return doneColor;
        case RecruiterSegmentState.current:
          return currentColor;
        case RecruiterSegmentState.idle:
          return idleColor;
      }
    }

    return Row(
      children: [
        for (var k = 0; k < segments.length; k++) ...[
          if (k > 0) const SizedBox(width: 3),
          Expanded(
            child: Container(
              height: height,
              decoration: BoxDecoration(
                color: colorFor(segments[k]),
                borderRadius: BorderRadius.circular(height / 2),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Warm-dashboard blocks.
//
// A second, warmer treatment of the same language, for the recruiter's landing
// screen: a brown-black ground carrying full-strength pastel blocks, big
// underlined figures, and circular icon actions with their labels beneath.
//
// Deliberately separate from RecruiterPanel and friends. Those stay as the
// app's default flat-dark surfaces; adopting this look on one screen must not
// re-skin every other screen that uses them.
// ───────────────────────────────────────────────────────────────────────────

/// A circular icon button with its label underneath — the reference's
/// "Receive / Buy / Send" row. Sized for a comfortable touch target.
class RecruiterCircleAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  /// Circle fill. Defaults to the ink used on pastel blocks, which is what the
  /// reference does inside its hero card.
  final Color background;

  /// Icon colour. Defaults to a light glyph for a dark circle.
  final Color foreground;

  /// Colour of the label under the circle.
  final Color labelColor;

  /// Shows a spinner in place of the glyph.
  final bool busy;

  const RecruiterCircleAction({
    super.key,
    required this.icon,
    required this.label,
    this.onPressed,
    this.background = AppColors.blockInk,
    this.foreground = Colors.white,
    this.labelColor = AppColors.blockInk,
    this.busy = false,
  });

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;

    return Semantics(
      label: label,
      button: true,
      child: Opacity(
        opacity: enabled ? 1 : 0.5,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Material(
              color: background,
              shape: const CircleBorder(),
              child: InkWell(
                onTap: enabled ? onPressed : null,
                customBorder: const CircleBorder(),
                child: SizedBox(
                  width: 46,
                  height: 46,
                  child: busy
                      ? Center(
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: foreground,
                            ),
                          ),
                        )
                      : Icon(icon, size: 20, color: foreground),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.sm - 2),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                color: labelColor,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The reference's hero block: a solid pastel card with a small kicker, one
/// large underlined figure, a supporting line, and a row of circular actions.
///
/// The underline is the point of the figure — it is what makes the number read
/// as the screen's subject rather than as one metric among several.
class RecruiterHeroBlock extends StatelessWidget {
  final String kicker;

  /// The headline figure, e.g. "3".
  final String value;

  /// Sits on the figure's baseline, e.g. "tests".
  final String? unit;

  /// Muted line under the rule.
  final String? caption;

  /// Circular actions along the bottom. Pass [RecruiterCircleAction]s.
  final List<Widget> actions;

  /// The block's colour. Defaults to the user's chosen accent.
  final Color? background;

  const RecruiterHeroBlock({
    super.key,
    required this.kicker,
    required this.value,
    this.unit,
    this.caption,
    this.actions = const [],
    this.background,
  });

  @override
  Widget build(BuildContext context) {
    const ink = AppColors.blockInk;

    return Container(
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: background ?? WarmSurfaces.block(context),
        borderRadius: BorderRadius.circular(AppRadius.card + 4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            kicker.toUpperCase(),
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.0,
              color: ink.withValues(alpha: 0.6),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Flexible(
                child: Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 40,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -1.6,
                    height: 1,
                    color: ink,
                  ),
                ),
              ),
              if (unit != null) ...[
                const SizedBox(width: AppSpacing.sm),
                Flexible(
                  child: Text(
                    unit!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                      color: ink.withValues(alpha: 0.75),
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: AppSpacing.md - 2),
          Container(height: 1.2, color: ink.withValues(alpha: 0.28)),
          if (caption != null) ...[
            const SizedBox(height: AppSpacing.sm + 2),
            Text(
              caption!,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w500,
                color: ink.withValues(alpha: 0.7),
              ),
            ),
          ],
          if (actions.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.lg),
            // Wrap, not Row: the circles are a fixed 46 wide, so four of them
            // plus their gaps overflow a 300dp card. This drops to a second
            // line instead.
            Wrap(
              spacing: AppSpacing.xxl,
              runSpacing: AppSpacing.lg,
              children: actions,
            ),
          ],
        ],
      ),
    );
  }
}

/// The reference's profile header: a rounded-square avatar beside a name and a
/// muted second line, with optional trailing icon buttons.
class RecruiterProfileHeader extends StatelessWidget {
  /// Drawn inside the avatar tile — typically the user's initial.
  final String initial;

  final String title;
  final String subtitle;
  final List<Widget> actions;

  const RecruiterProfileHeader({
    super.key,
    required this.initial,
    required this.title,
    required this.subtitle,
    this.actions = const [],
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Row(
      children: [
        Container(
          width: 44,
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: isDark
                ? AppColors.warmSurfaceHigh
                : WarmSurfaces.block(context),
            borderRadius: BorderRadius.circular(AppRadius.sm + 2),
            border: Border.all(
              color: WarmSurfaces.block(context)
                  .withValues(alpha: isDark ? 0.5 : 1),
            ),
          ),
          child: Text(
            initial.toUpperCase(),
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: isDark ? WarmSurfaces.block(context) : AppColors.blockInk,
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
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 17.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.3,
                  color: AppSurfaces.text(context),
                ),
              ),
              const SizedBox(height: 1),
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12.5,
                  color: AppSurfaces.muted(context),
                ),
              ),
            ],
          ),
        ),
        ...actions,
      ],
    );
  }
}

/// Installs the recruiter section's warm theme over one page, then builds a
/// [Scaffold] inside it.
///
/// Use this instead of a bare `Scaffold` on every recruiter screen. Because the
/// theme is installed ABOVE the Scaffold, everything the page builds inherits
/// it — nested Scaffolds, and the dialogs and bottom sheets it opens, since
/// Flutter's modal routes capture the ambient theme at the call site.
///
/// Pushed routes do NOT inherit (they build under MaterialApp), which is why
/// each recruiter page installs it for itself rather than relying on the shell.
class RecruiterScaffold extends StatelessWidget {
  final Widget? body;
  final PreferredSizeWidget? appBar;
  final Widget? floatingActionButton;
  final Widget? bottomNavigationBar;
  final bool resizeToAvoidBottomInset;

  /// Overrides the warm ground — only for a screen that genuinely needs its own
  /// backdrop, such as a full-bleed video stage.
  final Color? backgroundColor;

  const RecruiterScaffold({
    super.key,
    this.body,
    this.appBar,
    this.floatingActionButton,
    this.bottomNavigationBar,
    this.resizeToAvoidBottomInset = true,
    this.backgroundColor,
  });

  @override
  Widget build(BuildContext context) {
    // select, not watch: only the accents should rebuild this, not every
    // unrelated AppStore change (session config, drafts, counters).
    final accent = context.select<AppStore, AppAccent>((s) => s.accent);
    final secondary =
        context.select<AppStore, AppAccent>((s) => s.secondaryAccent);
    final warm = WarmSurfaces.theme(
      Theme.of(context),
      accent: accent,
      secondary: secondary,
    );
    return Theme(
      data: warm,
      child: Builder(
        // A Builder so the Scaffold and everything under it resolves
        // Theme.of(context) to `warm`, not to the theme above it.
        builder: (context) => Scaffold(
          backgroundColor: backgroundColor ?? warm.scaffoldBackgroundColor,
          appBar: appBar,
          body: body,
          floatingActionButton: floatingActionButton,
          bottomNavigationBar: bottomNavigationBar,
          resizeToAvoidBottomInset: resizeToAvoidBottomInset,
        ),
      ),
    );
  }
}

/// Installs the recruiter warm theme without building a Scaffold.
///
/// For a page that renders several Scaffolds of its own — the conversation
/// runner swaps between a welcome, résumé, system-check, readiness and chat
/// screen, each with its own — wrap the page's whole output in this once
/// instead of converting each screen. Everything below inherits the theme.
class RecruiterTheme extends StatelessWidget {
  final Widget child;
  const RecruiterTheme({super.key, required this.child});

  @override
  Widget build(BuildContext context) => Theme(
        data: WarmSurfaces.theme(
          Theme.of(context),
          accent: context.select<AppStore, AppAccent>((s) => s.accent),
          secondary:
              context.select<AppStore, AppAccent>((s) => s.secondaryAccent),
        ),
        child: child,
      );
}

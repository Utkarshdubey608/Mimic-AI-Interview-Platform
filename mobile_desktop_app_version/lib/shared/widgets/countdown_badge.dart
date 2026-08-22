// lib/shared/widgets/countdown_badge.dart
//
// A ticking "12:04" pill, and the one rule that makes a countdown safe to put on
// a live screen: IT OWNS ITS OWN TICKER.
//
// A clock driven from the page above it rebuilds that whole page once a second.
// On a 40-question MCQ paper that is every question widget; on a video call it is
// the video surface, and that is exactly where a countdown had to be taken out
// again. So this widget keeps the per-second `setState` to itself and reads the
// time left through a callback, which means the thing it is timing does not have
// to be a ChangeNotifier — or repaint at all.
//
// First written inside `voice_stage.dart`, where the same reasoning is recorded
// against the live-call screen it was protecting.

import 'dart:async';

import 'package:flutter/material.dart';

class CountdownBadge extends StatefulWidget {
  const CountdownBadge({
    super.key,
    required this.remaining,
    this.onExpired,
    this.warnBelow = const Duration(minutes: 1),
    this.icon = Icons.hourglass_bottom,
  });

  /// How long is left, read once a second. Null renders nothing at all — an
  /// untimed session must not show a clock, and neither must one whose deadline
  /// is not known yet.
  final Duration? Function() remaining;

  /// Called ONCE, the first tick at or below zero.
  ///
  /// Once, because the obvious alternative — firing while the clock sits at zero —
  /// hands in an MCQ paper repeatedly, and a submit is not idempotent from the
  /// candidate's side.
  final VoidCallback? onExpired;

  /// When the pill turns to the error colour. A minute by default: long enough to
  /// finish a thought, short enough to mean something.
  final Duration warnBelow;

  final IconData icon;

  @override
  State<CountdownBadge> createState() => _CountdownBadgeState();
}

class _CountdownBadgeState extends State<CountdownBadge> {
  Timer? _ticker;
  bool _expiredFired = false;

  @override
  void initState() {
    super.initState();
    // Checked immediately as well as every second: a paper reopened after its
    // deadline has already expired, and waiting a second to notice would let the
    // candidate answer one more question.
    _tick();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _tick());
  }

  void _tick() {
    if (!mounted) return;
    final left = widget.remaining();
    if (left != null && left <= Duration.zero && !_expiredFired) {
      _expiredFired = true;
      widget.onExpired?.call();
      // Re-checked: the callback usually takes the thing being timed off screen
      // (an MCQ paper goes to "submitting"), and this widget can be gone with it.
      if (!mounted) return;
    }
    setState(() {});
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final left = widget.remaining();
    if (left == null) return const SizedBox.shrink();

    final theme = Theme.of(context);
    final seconds = left.inSeconds < 0 ? 0 : left.inSeconds;
    final warning = left <= widget.warnBelow;
    final color =
        warning ? theme.colorScheme.error : theme.colorScheme.onSurfaceVariant;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(widget.icon, size: 14, color: color),
        const SizedBox(width: 4),
        Text(
          '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}',
          style: theme.textTheme.labelMedium?.copyWith(
            color: color,
            fontWeight: FontWeight.bold,
            // Tabular, so the pill does not jitter as the digits change.
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

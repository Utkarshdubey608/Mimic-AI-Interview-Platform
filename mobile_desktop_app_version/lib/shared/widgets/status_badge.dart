// lib/shared/widgets/status_badge.dart
//
// Small pill status indicator for interview/candidate status.
//
// The badge carries a TONE rather than a colour. Tones resolve against the
// user's chosen accents (see StatusTone), which cannot be done in a const
// factory — so the meaning is stored and the colour is looked up in build.

import 'package:flutter/material.dart';
import 'package:talbotiq/core/theme/status_tones.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';

/// What a badge means, independent of what colour that turns out to be.
enum BadgeTone { ready, pending, failed, neutral }

class StatusBadge extends StatelessWidget {
  final String label;

  /// Set for a semantic badge; resolved against the user's accents.
  final BadgeTone? tone;

  /// Set to paint an explicit colour instead — for a caller that already has
  /// one (a score band, a per-category tint).
  final Color? color;

  const StatusBadge({
    super.key,
    required this.label,
    this.color,
    this.tone,
  }) : assert(color != null || tone != null, 'a badge needs a colour or a tone');

  /// Derives the badge for an interview the same way the analytics funnel
  /// already classifies it (status, then resultPublished) — not a new
  /// status concept.
  factory StatusBadge.forInterview(Interview interview) {
    if (interview.resultPublished) {
      return const StatusBadge(label: 'Published', tone: BadgeTone.ready);
    }
    switch (interview.status) {
      case InterviewStatus.completed:
        return const StatusBadge(label: 'Completed', tone: BadgeTone.ready);
      case InterviewStatus.inProgress:
        return const StatusBadge(label: 'In progress', tone: BadgeTone.pending);
      case InterviewStatus.assigned:
        return const StatusBadge(label: 'Assigned', tone: BadgeTone.neutral);
    }
  }

  Color _resolve(BuildContext context) {
    if (color != null) return color!;
    switch (tone!) {
      case BadgeTone.ready:
        return StatusTone.ready(context);
      case BadgeTone.pending:
        return StatusTone.pending(context);
      case BadgeTone.failed:
        return StatusTone.failed(context);
      case BadgeTone.neutral:
        return StatusTone.neutral(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _resolve(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(100),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

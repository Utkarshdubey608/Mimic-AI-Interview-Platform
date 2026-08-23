import 'package:flutter/material.dart';
import 'package:talbotiq/shared/models/app_models.dart';
import 'package:talbotiq/shared/widgets/custom_buttons.dart';

/// Card displaying the AI-Synthesized scorecard from Gemini,
/// including fit recommendation, fit score, strengths, and concerns.
class AtsAssessmentCard extends StatelessWidget {
  final String? geminiError;
  final bool geminiLoading;
  final ATSScorecard? atsScorecard;
  final VoidCallback onRetry;
  final VoidCallback onNavigateToSettings;

  const AtsAssessmentCard({
    super.key,
    required this.geminiError,
    required this.geminiLoading,
    required this.atsScorecard,
    required this.onRetry,
    required this.onNavigateToSettings,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // If Gemini analysis failed, show retry option with error message
    if (geminiError != null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    Icons.warning_amber,
                    color: theme.colorScheme.error,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'ATS Assessment Synthesis Failed',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                geminiError!,
                style: TextStyle(color: theme.colorScheme.error, fontSize: 13),
              ),
              const SizedBox(height: 16),
              CustomButton(
                text: 'Retry synthesis',
                variant: ButtonVariant.outline,
                height: 36,
                onPressed: onRetry,
              ),
            ],
          ),
        ),
      );
    }


    // Loading indicator when Gemini is running synthesis
    if (geminiLoading) {
      return const AtsScorecardSkeleton();
    }

    // Fallback if there is no scorecard but we aren't loading
    if (atsScorecard == null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Text(
            'No transcripts captured for synthesis.',
            style: theme.textTheme.bodyMedium,
          ),
        ),
      );
    }

    final card = atsScorecard!;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'AI-Powered ATS Assessment (Gemini)',
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'ATS Recommendation: ${card.hiringRecommendation}',
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Overall Fit: ${card.overallFitLabel} (${card.overallFitScore ?? '—'}/100)',
                            style: TextStyle(
                              fontSize: 13,
                              color: theme.colorScheme.primary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    FitBadge(recommendation: card.hiringRecommendation),
                  ],
                ),
                const SizedBox(height: 16),
                Divider(color: theme.colorScheme.outline.withValues(alpha: 0.12)),
                const SizedBox(height: 16),

                Text(
                  'Hiring recommendation rationale',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  card.hiringRecommendationRationale,
                  style: theme.textTheme.bodyMedium?.copyWith(height: 1.4),
                ),
                const SizedBox(height: 16),

                Text(
                  'Key strengths',
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                ...card.topStrengths.map(
                  (s) => Padding(
                    padding: const EdgeInsets.only(bottom: 6.0),
                    child: Row(
                      children: [
                        Icon(
                          Icons.check,
                          color: theme.colorScheme.primary,
                          size: 14,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(s, style: theme.textTheme.bodyMedium),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                Text(
                  'Watch Points & Concerns',
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: theme.colorScheme.error,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                ...card.topConcerns.map(
                  (c) => Padding(
                    padding: const EdgeInsets.only(bottom: 6.0),
                    child: Row(
                      children: [
                        Icon(
                          Icons.warning,
                          color: theme.colorScheme.error,
                          size: 14,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(c, style: theme.textTheme.bodyMedium),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Badge styling for candidate recommendation type (Advance, Hold, Reject).
class FitBadge extends StatelessWidget {
  final String recommendation;

  const FitBadge({
    super.key,
    required this.recommendation,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Color bg;
    Color fg;
    if (recommendation == 'Advance') {
      bg = theme.colorScheme.primary.withValues(alpha: 0.12);
      fg = theme.colorScheme.primary;
    } else if (recommendation == 'Hold') {
      bg = theme.colorScheme.secondary.withValues(alpha: 0.12);
      fg = theme.colorScheme.secondary;
    } else {
      bg = theme.colorScheme.error.withValues(alpha: 0.12);
      fg = theme.colorScheme.error;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        recommendation.toUpperCase(),
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.bold,
          color: fg,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

class SkeletonPulsar extends StatefulWidget {
  final Widget child;
  const SkeletonPulsar({super.key, required this.child});

  @override
  State<SkeletonPulsar> createState() => _SkeletonPulsarState();
}

class _SkeletonPulsarState extends State<SkeletonPulsar> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    )..repeat(reverse: true);
    _animation = Tween<double>(begin: 0.4, end: 0.75).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Opacity(
          opacity: _animation.value,
          child: widget.child,
        );
      },
    );
  }
}

class AtsScorecardSkeleton extends StatelessWidget {
  const AtsScorecardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final baseColor = isDark ? Colors.white.withOpacity(0.08) : Colors.black.withOpacity(0.05);

    return SkeletonPulsar(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 240,
            height: 20,
            decoration: BoxDecoration(
              color: baseColor,
              borderRadius: BorderRadius.circular(4),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 220,
                            height: 18,
                            decoration: BoxDecoration(
                              color: baseColor,
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                          const SizedBox(height: 8),
                          Container(
                            width: 140,
                            height: 12,
                            decoration: BoxDecoration(
                              color: baseColor,
                              borderRadius: BorderRadius.circular(4),
                            ),
                          ),
                        ],
                      ),
                      Container(
                        width: 80,
                        height: 28,
                        decoration: BoxDecoration(
                          color: baseColor,
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Divider(color: theme.colorScheme.outline.withOpacity(0.08)),
                  const SizedBox(height: 20),
                  Container(
                    width: 180,
                    height: 14,
                    decoration: BoxDecoration(
                      color: baseColor,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    height: 12,
                    decoration: BoxDecoration(
                      color: baseColor,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    width: double.infinity,
                    height: 12,
                    decoration: BoxDecoration(
                      color: baseColor,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    width: 260,
                    height: 12,
                    decoration: BoxDecoration(
                      color: baseColor,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 24),
                  Container(
                    width: 120,
                    height: 14,
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primary.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Icon(Icons.check, color: theme.colorScheme.primary.withOpacity(0.3), size: 14),
                      const SizedBox(width: 8),
                      Container(
                        width: 200,
                        height: 12,
                        decoration: BoxDecoration(
                          color: baseColor,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Icon(Icons.check, color: theme.colorScheme.primary.withOpacity(0.3), size: 14),
                      const SizedBox(width: 8),
                      Container(
                        width: 180,
                        height: 12,
                        decoration: BoxDecoration(
                          color: baseColor,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

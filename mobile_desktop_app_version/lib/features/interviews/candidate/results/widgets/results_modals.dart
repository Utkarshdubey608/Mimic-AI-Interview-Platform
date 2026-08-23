import 'package:flutter/material.dart';
import 'package:flutter/services.dart'; // For clipboard operations
import 'package:talbotiq/shared/widgets/custom_buttons.dart';
import 'package:talbotiq/shared/widgets/custom_inputs.dart';

/// A full-screen overlay dialog that allows recruiters to schedule
/// a technical interview for the candidate.
class ScheduleInterviewDialog extends StatefulWidget {
  final VoidCallback onClose;

  const ScheduleInterviewDialog({
    super.key,
    required this.onClose,
  });

  @override
  State<ScheduleInterviewDialog> createState() => _ScheduleInterviewDialogState();
}

class _ScheduleInterviewDialogState extends State<ScheduleInterviewDialog> {
  // Local controllers to manage form input state internally
  final _dateController = TextEditingController();
  final _timeController = TextEditingController(text: '10:00');
  final _interviewerController = TextEditingController();
  final _notesController = TextEditingController();

  @override
  void dispose() {
    _dateController.dispose();
    _timeController.dispose();
    _interviewerController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      color: Colors.black54,
      alignment: Alignment.center,
      child: Center(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 24),
          constraints: const BoxConstraints(maxWidth: 420),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            borderRadius: BorderRadius.circular(28), // M3 Dialog corner radius
            border: Border.all(
              color: theme.colorScheme.outline.withValues(alpha: 0.12),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.2),
                blurRadius: 15,
                spreadRadius: 2,
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Schedule technical interview',
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Book the next round for this candidate.',
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: 16),

              Row(
                children: [
                  Expanded(
                    child: CustomInputField(
                      label: 'Date',
                      placeholder: 'YYYY-MM-DD',
                      controller: _dateController,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: CustomInputField(
                      label: 'Time',
                      placeholder: '10:00',
                      controller: _timeController,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              CustomInputField(
                label: 'Interviewer',
                placeholder: 'Interviewer name',
                controller: _interviewerController,
              ),
              const SizedBox(height: 12),

              CustomInputField(
                label: 'Notes',
                placeholder: 'Areas to probe further…',
                controller: _notesController,
                maxLines: 3,
              ),
              const SizedBox(height: 24),

              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: widget.onClose,
                    child: Text(
                      'Cancel',
                      style: TextStyle(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  CustomButton(
                    text: 'Confirm schedule',
                    onPressed: () {
                      // Capture the messenger before onClose() disposes this
                      // widget's context / removes it from the tree.
                      final messenger = ScaffoldMessenger.of(context);
                      widget.onClose();
                      messenger.showSnackBar(
                        SnackBar(
                          content: const Text('Technical round scheduled!'),
                          backgroundColor: theme.colorScheme.primary,
                        ),
                      );
                    },
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A full-screen overlay dialog that generates an AI-powered offer recommendation
/// based on the candidate's scores, strengths, and watch points.
class OfferRecommendationDialog extends StatelessWidget {
  final int score;
  final String verdict;
  final List<String> strengths;
  final List<String> watchPoints;
  final VoidCallback onClose;

  const OfferRecommendationDialog({
    super.key,
    required this.score,
    required this.verdict,
    required this.strengths,
    required this.watchPoints,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Build template block content for clipboard and view
    final today = DateTime.now().toString().split(' ').first;
    final recommendationText = score >= 75 ? 'Proceed with offer' : 'Further technical assessment';
    final blockContent = '''OFFER RECOMMENDATION — MIMIC AI
Score: $score/100 | Verdict: $verdict

RECOMMENDATION: $recommendationText

Top Strengths: ${strengths.join(', ')}
Watch Points: ${watchPoints.join(', ')}

Generated: $today''';

    return Container(
      color: Colors.black54,
      alignment: Alignment.center,
      child: Center(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 24),
          constraints: const BoxConstraints(maxWidth: 460),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            borderRadius: BorderRadius.circular(28), // M3 Dialog corner radius
            border: Border.all(
              color: theme.colorScheme.outline.withValues(alpha: 0.12),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.2),
                blurRadius: 15,
                spreadRadius: 2,
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'AI Offer Recommendation',
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 16),

              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  border: Border.all(
                    color: theme.colorScheme.outline.withValues(alpha: 0.12),
                  ),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  blockContent,
                  style: TextStyle(
                    fontSize: 12,
                    fontFamily: 'Courier',
                    color: theme.colorScheme.primary,
                    height: 1.4,
                  ),
                ),
              ),
              const SizedBox(height: 24),

              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: onClose,
                    child: Text(
                      'Close',
                      style: TextStyle(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  CustomButton(
                    text: 'Copy to Clipboard',
                    onPressed: () {
                      // Capture the messenger before onClose() removes this
                      // dialog's context from the tree.
                      final messenger = ScaffoldMessenger.of(context);
                      Clipboard.setData(ClipboardData(text: blockContent));
                      onClose();
                      messenger.showSnackBar(
                        SnackBar(
                          content: const Text('Offer copied to clipboard!'),
                          backgroundColor: theme.colorScheme.primary,
                        ),
                      );
                    },
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

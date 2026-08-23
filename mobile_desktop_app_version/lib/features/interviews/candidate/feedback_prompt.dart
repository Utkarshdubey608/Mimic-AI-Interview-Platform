// lib/features/interviews/candidate/feedback_prompt.dart
//
// Asks the candidate what the interview was like, once, after they finish.
//
// This prompt existed only in the browser (`web_feedback`), so a candidate who
// interviewed on the phone was never asked — on the one channel the product has for
// hearing from candidates. Worse, nothing in the data distinguished "not asked" from
// "declined to answer", so the gap was invisible in the aggregate a recruiter reads.
//
// SKIPPABLE, unlike the company prompt. That difference is deliberate: a company name
// unblocks a recruiter's own colleagues seeing their work, and the cost of skipping is
// invisible to them. This is a favour the candidate is doing us at the end of something
// stressful, and a modal they cannot dismiss is a bad way to ask for one.
//
// Nothing here is shown to the recruiter as attributable-in-the-moment feedback: it
// lands in the shared `feedback` collection keyed by interview, and the server resolves
// who and what it was about — see `app/routers/feedback.py`.

import 'package:flutter/material.dart';

import 'package:talbotiq/core/net/backend_client.dart';

/// Shows the prompt for [interviewId]. Returns when it is dismissed either way.
Future<void> promptForFeedback(
  BuildContext context, {
  required String interviewId,
}) async {
  if (interviewId.isEmpty) return;
  await showDialog<void>(
    context: context,
    builder: (_) => _FeedbackDialog(interviewId: interviewId),
  );
}

class _FeedbackDialog extends StatefulWidget {
  const _FeedbackDialog({required this.interviewId});
  final String interviewId;

  @override
  State<_FeedbackDialog> createState() => _FeedbackDialogState();
}

class _FeedbackDialogState extends State<_FeedbackDialog> {
  final _comment = TextEditingController();
  int? _rating;
  bool _hadIssues = false;
  bool _sending = false;

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  /// True when there is anything worth sending.
  ///
  /// Mirrors `feedback.is_empty` on the server, which ignores a row with neither: it
  /// would count as feedback on every dashboard that counts rows while saying nothing.
  bool get _hasSomethingToSay =>
      _rating != null || _comment.text.trim().isNotEmpty || _hadIssues;

  Future<void> _send() async {
    if (!_hasSomethingToSay) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => _sending = true);
    try {
      await backendClient.postJson(
        '/api/interviews/${widget.interviewId}/feedback',
        body: {
          'rating': _rating,
          'comment': _comment.text.trim(),
          'hadTechnicalIssues': _hadIssues,
        },
      );
    } catch (_) {
      // Swallowed on purpose. This is a favour at the end of a stressful thing, and
      // "could not send your feedback" is a bad last screen for an interview that went
      // fine. The submission is not load-bearing for anything the candidate needs.
    }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AlertDialog(
      title: const Text('How was that?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'This goes to the team building the interview experience, not to the '
            'hiring team. It has no bearing on your application.',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var star = 1; star <= 5; star++)
                IconButton(
                  onPressed: _sending
                      ? null
                      : () => setState(() => _rating = star),
                  // Labelled individually: a row of unlabelled stars is unusable with
                  // a screen reader, and the web form makes the same point.
                  tooltip: '$star of 5',
                  icon: Icon(
                    (_rating ?? 0) >= star ? Icons.star : Icons.star_border,
                    color: (_rating ?? 0) >= star
                        ? theme.colorScheme.primary
                        : theme.colorScheme.onSurfaceVariant,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _comment,
            maxLines: 3,
            // Matches the server's cap, so a candidate is stopped by the field rather
            // than by a silent truncation they never see.
            maxLength: 2000,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'Anything else? (optional)',
              hintText: 'What worked, what did not',
            ),
          ),
          CheckboxListTile(
            value: _hadIssues,
            onChanged: _sending
                ? null
                : (v) => setState(() => _hadIssues = v ?? false),
            title: const Text('I had technical problems'),
            contentPadding: EdgeInsets.zero,
            controlAffinity: ListTileControlAffinity.leading,
          ),
        ],
      ),
      actions: [
        // Skippable — see the note at the top of this file.
        TextButton(
          onPressed: _sending ? null : () => Navigator.of(context).pop(),
          child: const Text('Skip'),
        ),
        FilledButton(
          onPressed: _sending || !_hasSomethingToSay ? null : _send,
          child: _sending
              ? const SizedBox(
                  width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Send'),
        ),
      ],
    );
  }
}

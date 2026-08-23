// lib/features/interviews/recruiter/widgets/two_way_review_sheet.dart
//
// The recruiter's own score for a live interview they ran.
//
// This track has no recording, so there is no transcript and nothing for a model
// to read — the human who was in the room is the scorer. That is not a downgrade:
// they heard the answers, asked the follow-ups and formed a view, which is more
// than a transcript scorer ever has.
//
// Stars map onto the same 0-100 `overallScore` every other track writes (see
// `InterviewRepository.saveTwoWayReview`), so a live round ranks on the
// leaderboard, feeds the shortlist and advances candidates without any of that
// machinery needing to know what a live interview is.
//
// The notes are PRIVATE. What a candidate reads is `result.candidateNote`,
// written separately when outcomes are published — the sheet says so, because
// the two are easy to confuse and only one of them is safe to be blunt in.

import 'package:flutter/material.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/core/theme/design_tokens.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';

/// What the recruiter entered.
class TwoWayReview {
  final int stars;
  final String notes;
  const TwoWayReview({required this.stars, required this.notes});
}

/// Collects a 0-5 rating and private notes. Returns null if cancelled.
Future<TwoWayReview?> showTwoWayReviewSheet(
  BuildContext context,
  Interview interview,
) {
  return showModalBottomSheet<TwoWayReview>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (ctx) => _TwoWayReviewSheet(interview: interview),
  );
}

class _TwoWayReviewSheet extends StatefulWidget {
  final Interview interview;
  const _TwoWayReviewSheet({required this.interview});

  @override
  State<_TwoWayReviewSheet> createState() => _TwoWayReviewSheetState();
}

class _TwoWayReviewSheetState extends State<_TwoWayReviewSheet> {
  late int _stars = widget.interview.twoWayStars ?? 0;
  late final _notesCtrl =
      TextEditingController(text: widget.interview.twoWayNotes);
  String? _error;

  @override
  void dispose() {
    _notesCtrl.dispose();
    super.dispose();
  }

  /// The 0-100 score these stars become, shown live so the recruiter can see
  /// what the leaderboard will rank on rather than discovering it afterwards.
  int get _score => _stars * 20;

  String get _starMeaning {
    switch (_stars) {
      case 5:
        return 'Outstanding — clear hire';
      case 4:
        return 'Strong — would hire';
      case 3:
        return 'Reasonable — worth a further look';
      case 2:
        return 'Weak — significant gaps';
      case 1:
        return 'Poor — not suitable';
      default:
        return 'Not scored yet';
    }
  }

  void _save() {
    if (_stars < 1) {
      // Zero would silently rank them last on the leaderboard as if it were a
      // judgement, when it actually means "I have not decided".
      setState(() => _error = 'Pick a rating from 1 to 5 before saving.');
      return;
    }
    Navigator.pop(
      context,
      TwoWayReview(stars: _stars, notes: _notesCtrl.text),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final name = widget.interview.candidateName?.trim().isNotEmpty == true
        ? widget.interview.candidateName!.trim()
        : widget.interview.candidateEmail;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.xl,
        0,
        AppSpacing.xl,
        // Clears the keyboard when the notes field is focused.
        MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Score this interview',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w600,
                letterSpacing: -0.3,
                color: AppSurfaces.text(context),
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              '$name · ${widget.interview.title}',
              style: TextStyle(
                fontSize: 12.5,
                color: AppSurfaces.muted(context),
              ),
            ),
            const SizedBox(height: AppSpacing.xs + 2),
            Text(
              'You ran this interview, so you score it — there is no recording '
              'to score automatically.',
              style: TextStyle(
                fontSize: 12,
                height: 1.4,
                color: AppSurfaces.subtle(context),
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var star = 1; star <= 5; star++)
                  IconButton(
                    iconSize: 32,
                    tooltip: '$star star${star == 1 ? '' : 's'}',
                    onPressed: () => setState(() {
                      _stars = star;
                      _error = null;
                    }),
                    icon: Icon(
                      star <= _stars
                          ? Icons.star_rounded
                          : Icons.star_border_rounded,
                      color: star <= _stars
                          ? WarmSurfaces.block(context)
                          : AppSurfaces.subtle(context),
                    ),
                  ),
              ],
            ),
            Text(
              _starMeaning,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w600,
                color: AppSurfaces.text(context),
              ),
            ),
            if (_stars > 0) ...[
              const SizedBox(height: 4),
              Text(
                // The leaderboard, the shortlist and the advance rule all read
                // this number, so it should not be a surprise.
                'Ranks as $_score / 100 alongside the other rounds.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 11.5,
                  color: AppSurfaces.subtle(context),
                ),
              ),
            ],
            const SizedBox(height: 20),
            TextField(
              controller: _notesCtrl,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: 'Your notes (private)',
                hintText:
                    'What they said, how they handled follow-ups, anything to '
                    'raise with the panel…',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.lock_outline,
                    size: 14, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Only you and your team see these. The message the CANDIDATE '
                    'reads is written when you publish the round\'s results.',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: theme.colorScheme.error)),
            ],
            const SizedBox(height: 20),
            SizedBox(
              height: 48,
              child: FilledButton.icon(
                onPressed: _save,
                icon: const Icon(Icons.check, size: 18),
                label: const Text('Save score'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

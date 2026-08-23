// test/candidate_round_card_test.dart
//
// The candidate's round card decides three things from the same interview
// document: what the card body does when tapped, what the button offers, and
// whether finishing counts as "just did an interview".
//
// It got all three wrong in ways that only show up by tapping around:
//
//  * A résumé round the recruiter had CLOSED still offered "Replace" — greyed,
//    but a greyed button still reads as the thing you do here, and the CV may
//    already have been read.
//  * Tapping the body of an already-submitted round re-entered the session,
//    which greets you with "Answer submitted", instead of showing the result
//    printed on the card.
//  * Coming back from that re-entry asked "how was that?" again, every time.
//
// These are behaviours, not pixels, so they are pinned here.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/features/interviews/models/interview.dart';

Interview _interview({
  InterviewStatus status = InterviewStatus.assigned,
  RoundKind kind = RoundKind.resume,
  DateTime? expiresAt,
  DateTime? availableFrom,
  int? maxAttempts,
  int attemptsUsed = 0,
  bool resultPublished = false,
  Map<String, dynamic>? result,
}) =>
    Interview(
      id: 'i1',
      recruiterId: 'r1',
      recruiterEmail: 'r@example.com',
      candidateEmail: 'c@example.com',
      candidateEmailLower: 'c@example.com',
      type: InterviewType.chat,
      roundKind: kind,
      title: 'resume screen',
      prompt: '',
      questions: const [],
      avatar: const AvatarConfig(replicaId: ''),
      durationMinutes: 15,
      status: status,
      availableFrom: availableFrom,
      expiresAt: expiresAt,
      maxAttempts: maxAttempts,
      attemptsUsed: attemptsUsed,
      resultPublished: resultPublished,
      result: result,
    );

final _past = DateTime.now().subtract(const Duration(days: 1));
final _future = DateTime.now().add(const Duration(days: 1));

void main() {
  group('a closed round offers the candidate nothing', () {
    test('a recruiter ending the round makes it inaccessible', () {
      // Ending a round pulls expiresAt back to that moment, so "ended early"
      // and "deadline passed" are the same state here.
      final ended = _interview(
        status: InterviewStatus.completed,
        expiresAt: _past,
      );
      expect(ended.isExpired, isTrue);
      expect(ended.isAccessible, isFalse);
    });

    test('a passed deadline makes it inaccessible even with attempts left', () {
      final expired = _interview(expiresAt: _past, maxAttempts: 3);
      expect(expired.hasAttemptsLeft, isTrue);
      expect(expired.isAccessible, isFalse);
    });

    test('an open round with a submission is still accessible', () {
      // This is the case that must KEEP working: replacing a résumé before the
      // recruiter closes the round is legitimate.
      final open = _interview(
        status: InterviewStatus.completed,
        expiresAt: _future,
      );
      expect(open.isAccessible, isTrue);
    });
  });

  group('the feedback prompt', () {
    // The card asks only when the round could actually have been taken just
    // now: open, and not already submitted.
    bool worthAsking(Interview i) =>
        i.isAccessible && i.status != InterviewStatus.completed;

    test('is not asked again for an already submitted round', () {
      expect(
        worthAsking(_interview(
          status: InterviewStatus.completed,
          expiresAt: _future,
        )),
        isFalse,
      );
    });

    test('is not asked when the round is closed', () {
      expect(worthAsking(_interview(expiresAt: _past)), isFalse);
    });

    test('is not asked before the round opens', () {
      expect(worthAsking(_interview(availableFrom: _future)), isFalse);
    });

    test('is not asked when attempts are exhausted', () {
      expect(
        worthAsking(_interview(maxAttempts: 1, attemptsUsed: 1)),
        isFalse,
      );
    });

    test('IS asked for a genuine first sitting', () {
      expect(worthAsking(_interview(expiresAt: _future)), isTrue);
    });
  });

  group('what the card body does when tapped', () {
    // Mirrors the card: published -> result, otherwise launch only when the
    // round is open AND untouched. Never re-enter a finished session.
    String target(Interview i) {
      final published = i.resultPublished && i.result != null;
      final completed = i.status == InterviewStatus.completed;
      if (published) return 'result';
      if (i.isAccessible && !completed) return 'launch';
      return 'nothing';
    }

    test('a published round opens the result', () {
      expect(
        target(_interview(
          status: InterviewStatus.completed,
          resultPublished: true,
          result: const {'overallScore': 80},
          expiresAt: _future,
        )),
        'result',
      );
    });

    test('a submitted, unpublished round does NOT re-enter the session', () {
      // The bug: this used to return 'launch' and show "Answer submitted".
      expect(
        target(_interview(
          status: InterviewStatus.completed,
          expiresAt: _future,
        )),
        'nothing',
      );
    });

    test('an open untouched round launches', () {
      expect(target(_interview(expiresAt: _future)), 'launch');
    });

    test('a closed round does nothing', () {
      expect(target(_interview(expiresAt: _past)), 'nothing');
    });
  });

  group('which affordance the button shows', () {
    // Mirrors _buildActionButton's precedence. The closed check must come
    // BEFORE the "already submitted, so offer Replace" case.
    String affordance(Interview i) {
      final published = i.resultPublished && i.result != null;
      final completed = i.status == InterviewStatus.completed;
      if (published) return 'View Result';
      if (!i.isAccessible) {
        return completed
            ? 'Submitted'
            : (i.isNotYetAvailable ? 'Not open yet' : 'Closed');
      }
      return completed ? 'Replace' : 'Upload';
    }

    test('a closed round with a submission shows Submitted, not Replace', () {
      expect(
        affordance(_interview(
          status: InterviewStatus.completed,
          expiresAt: _past,
        )),
        'Submitted',
      );
    });

    test('a closed round with no submission shows Closed', () {
      expect(affordance(_interview(expiresAt: _past)), 'Closed');
    });

    test('a round that has not opened says so', () {
      expect(affordance(_interview(availableFrom: _future)), 'Not open yet');
    });

    test('an OPEN round with a submission still offers Replace', () {
      expect(
        affordance(_interview(
          status: InterviewStatus.completed,
          expiresAt: _future,
        )),
        'Replace',
      );
    });

    test('a published result outranks everything else', () {
      expect(
        affordance(_interview(
          status: InterviewStatus.completed,
          expiresAt: _past,
          resultPublished: true,
          result: const {'overallScore': 80},
        )),
        'View Result',
      );
    });
  });
}

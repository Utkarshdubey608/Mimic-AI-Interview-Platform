// lib/features/interviews/models/test_conclusion.dart
//
// The END of a candidate's run at one test — what they are told once there is
// nothing left for them to sit.
//
// `RoundOutcome` (in `interview.dart`) answers "did I get through THIS round".
// Nothing answered "so what happened in the end", which for a multi-round test
// is the only question the candidate actually cares about: they finished three
// rounds, each said "moving forward", and then the pipeline simply went quiet.
// A single-round test has the same gap — "moving forward" to nothing.
//
// So this is a separate, recruiter-written decision with its own message, and it
// lives OUTSIDE `result`:
//
//   * `result` is per-round scoring. `InterviewRepository.clearResult` wipes it
//     so a candidate can retake a round — a conclusion about the whole test must
//     not be collateral damage of a retake.
//   * `result` is written by the scorer (AI, or the recruiter's own review). This
//     is written only by a recruiter deliberately releasing it, and there is no
//     automatic path that can produce one.
//
// The message is the point. "Not moving forward" is the same three words for
// everybody; "we'd like you to meet the team next week" is not something an enum
// can hold, and it was the whole reason recruiters were leaving the app to send
// this by hand.

import 'package:cloud_firestore/cloud_firestore.dart';

/// How a candidate's run at a test ENDED.
///
/// Three states, not two: a recruiter who has finished interviewing often is not
/// ready to decide, and forcing that into "selected" or "not selected" makes one
/// of them a lie. [onHold] is also what an unrecognised value degrades to, so a
/// future outcome written by a newer build never reads as a rejection here.
enum TestOutcome { cleared, notSelected, onHold }

extension TestOutcomeX on TestOutcome {
  String get wire {
    switch (this) {
      case TestOutcome.cleared:
        return 'cleared';
      case TestOutcome.notSelected:
        return 'not_selected';
      case TestOutcome.onHold:
        return 'on_hold';
    }
  }

  /// What the RECRUITER picks between. Hiring vocabulary is fine here.
  String get recruiterLabel {
    switch (this) {
      case TestOutcome.cleared:
        return 'Cleared';
      case TestOutcome.notSelected:
        return 'Not selected';
      case TestOutcome.onHold:
        return 'On hold';
    }
  }

  /// The headline the CANDIDATE reads. No score, no verdict, no ranking — and
  /// nothing that reads as a job offer, because clearing every round is not one.
  String get candidateLabel {
    switch (this) {
      case TestOutcome.cleared:
        return 'You cleared every round';
      case TestOutcome.notSelected:
        return 'Not moving forward';
      case TestOutcome.onHold:
        return 'Still under review';
    }
  }

  /// The starting text of the recruiter's message, which they then edit.
  ///
  /// A prefill rather than a fixed string: a default nobody can change is how
  /// every candidate ends up reading the same sentence, and a blank box is how
  /// they end up reading nothing at all. [testTitle] is named so the message
  /// stands on its own in a notification or an inbox.
  String defaultMessage(String testTitle) {
    final job = testTitle.trim().isEmpty ? 'this process' : '"${testTitle.trim()}"';
    switch (this) {
      case TestOutcome.cleared:
        return 'Congratulations — you have completed every round of $job, and '
            'we were impressed. We will be in touch very soon with what '
            'happens next.';
      case TestOutcome.notSelected:
        return 'Thank you for completing every round of $job. After careful '
            'review we will not be taking your application further on this '
            'occasion. It was a competitive process and we are grateful for '
            'the time you gave us.';
      case TestOutcome.onHold:
        return 'Thank you for completing every round of $job. We are still '
            'reviewing candidates and will come back to you as soon as we '
            'have news.';
    }
  }

  static TestOutcome fromWire(String? v) {
    switch (v) {
      case 'cleared':
        return TestOutcome.cleared;
      case 'not_selected':
        return TestOutcome.notSelected;
      default:
        return TestOutcome.onHold;
    }
  }
}

/// A published conclusion, as stored on an assignment's `conclusion` field.
///
/// Its mere PRESENCE means published. There is no `published` flag to get out of
/// step with the data, and no path that writes one un-published: this document is
/// readable by the candidate the moment it exists, so a draft conclusion would be
/// a decision leaked before it was made.
class TestConclusion {
  /// The decision.
  final TestOutcome outcome;

  /// The recruiter's own words. May be empty — the outcome alone is a valid
  /// thing to publish, and the candidate screen simply shows less.
  final String message;

  /// When it was released. Null only for the moment between a local write and
  /// the server timestamp landing.
  final DateTime? publishedAt;

  /// Who to attribute the message to on the candidate's screen. A name, never an
  /// email: this is shown to the candidate.
  final String publishedByName;

  const TestConclusion({
    required this.outcome,
    this.message = '',
    this.publishedAt,
    this.publishedByName = '',
  });

  /// Parses a stored conclusion, or null when there is none.
  ///
  /// Every field is treated as possibly-absent or wrongly-typed. A malformed
  /// conclusion still yields a usable object rather than throwing inside a list
  /// builder — the same rule the rest of this model file follows.
  static TestConclusion? fromMap(Map<String, dynamic>? map) {
    if (map == null) return null;
    // An outcome is the one thing a conclusion cannot do without: without it
    // there is nothing to tell the candidate, so an empty map is "no conclusion"
    // rather than an on-hold one nobody published.
    final raw = map['outcome'];
    if (raw is! String || raw.trim().isEmpty) return null;
    final published = map['publishedAt'];
    return TestConclusion(
      outcome: TestOutcomeX.fromWire(raw.trim()),
      message: (map['message'] as String?)?.trim() ?? '',
      publishedAt: published is Timestamp ? published.toDate() : null,
      publishedByName: (map['publishedByName'] as String?)?.trim() ?? '',
    );
  }

  /// The payload to write. `publishedAt` is a SERVER timestamp: the recruiter's
  /// device clock decides nothing about when a candidate was told.
  Map<String, dynamic> toMap() => {
        'outcome': outcome.wire,
        'message': message.trim(),
        'publishedByName': publishedByName.trim(),
        'publishedAt': FieldValue.serverTimestamp(),
      };
}

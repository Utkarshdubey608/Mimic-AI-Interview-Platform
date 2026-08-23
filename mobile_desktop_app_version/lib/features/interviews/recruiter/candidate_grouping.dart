// lib/features/interviews/recruiter/candidate_grouping.dart
//
// Turning a test's ASSIGNMENTS into its CANDIDATES.
//
// A multi-round test stores one `interviews` document per candidate per round —
// that is the data model (see `InterviewRound.assignTo`), and it is why the
// all-rounds candidate list showed the same person twice: two documents, one
// per round, ordered by `createdAt` alongside everybody else's, with nothing on
// the row naming which round it was.
//
// These helpers are the display-side answer: put a person's rounds next to each
// other, in round order, and count people separately from assignments. They are
// pure and live outside the widget so they can be tested without Firebase —
// `TestCandidatesPage` needs FirebaseAuth to build at all.
//
// This is the recruiter-side mirror of `groupByTest` in `candidate_home.dart`,
// which fixed the same confusion from the other end: a candidate part-way
// through a pipeline used to see their rounds as unrelated entries too.

import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/test_conclusion.dart';

/// The identity two assignments of the same person share.
///
/// `candidateEmail` is whatever the recruiter typed, so the lower-cased copy is
/// the key — normalising here as a fallback for any document written before
/// that field existed.
String candidateKey(Interview i) => i.candidateEmailLower.isNotEmpty
    ? i.candidateEmailLower
    : i.candidateEmail.trim().toLowerCase();

/// [rows] with each candidate's assignments made adjacent and in round order.
///
/// Candidates keep their incoming order — the caller's query is newest-first,
/// and a recruiter opening a test expects the people they added last at the
/// top — so only the position of a candidate's LATER rounds changes.
///
/// Grouping is over the rows given, which is one page or a few: a candidate
/// whose rounds straddle a page boundary joins up as soon as the next page
/// arrives, and nothing here reads from Firestore to pull them together sooner.
List<Interview> groupRoundsByCandidate(List<Interview> rows) {
  final order = <String>[];
  final byCandidate = <String, List<(int, Interview)>>{};
  for (var i = 0; i < rows.length; i++) {
    final key = candidateKey(rows[i]);
    byCandidate.putIfAbsent(key, () {
      order.add(key);
      return <(int, Interview)>[];
    }).add((i, rows[i]));
  }

  final out = <Interview>[];
  for (final key in order) {
    final bucket = byCandidate[key]!;
    // Arrival index breaks ties: `List.sort` is not stable, and every
    // pre-timeline document reports round 0, so without this two round-less
    // assignments could swap places between rebuilds.
    bucket.sort((a, b) {
      final byRound =
          a.$2.effectiveRoundOrder.compareTo(b.$2.effectiveRoundOrder);
      return byRound != 0 ? byRound : a.$1.compareTo(b.$1);
    });
    out.addAll(bucket.map((e) => e.$2));
  }
  return out;
}

/// How many distinct PEOPLE [rows] covers.
///
/// The list header needs this because Firestore's `count()` counts assignments:
/// one person in two rounds is two documents, and reporting that as
/// "2 candidate(s)" is what made the list look like it had duplicated somebody.
int distinctCandidateCount(List<Interview> rows) =>
    rows.map(candidateKey).toSet().length;


/// One candidate's whole run at one test: every round of it they hold, in order.
///
/// The unit a FINAL decision is made about. A round outcome is about one
/// assignment, so the round screens work in assignments; "how did this person's
/// application end" is about the person, and the same candidate is several
/// documents.
class CandidateRun {
  /// The grouping key — see [candidateKey].
  final String emailLower;

  /// The address as the recruiter typed it, for showing and for mailing.
  final String email;

  /// First non-empty name across their rounds. A later round may have been
  /// created without one and must not blank out a name an earlier round has.
  final String? name;

  /// Earliest round first, so the list reads as the sequence it is.
  final List<Interview> rounds;

  const CandidateRun({
    required this.emailLower,
    required this.email,
    required this.name,
    required this.rounds,
  });

  /// What to call them on screen.
  String get displayName => (name?.trim().isNotEmpty ?? false) ? name!.trim() : email;

  int get completedRounds =>
      rounds.where((i) => i.status == InterviewStatus.completed).length;

  /// True when there is nothing left for this candidate to sit, at [now].
  ///
  /// "Everything ASSIGNED to them", not "every round the test has" — those come
  /// apart in the normal case. A pipeline assigns round 2 only to the people who
  /// got through round 1, so a candidate can be finished with their run while the
  /// test still has rounds they will never see. Whether that means they cleared
  /// the process or were quietly dropped from it is the recruiter's decision, and
  /// this flag deliberately does not guess: it only says the recruiter can make
  /// one without cutting a round short.
  ///
  /// Completed OR out of time. That second half is the fix for a real dead end:
  /// this used to require every round COMPLETED, so a round that closed with
  /// people who never submitted left them permanently unfinished — and a
  /// pipeline whose last round closed with nobody submitting showed the final
  /// result screen as "nobody has finished yet", with no way forward at all.
  /// A closed round is over for everybody in it, submitted or not.
  ///
  /// Expiry is read off the assignment rather than the round, because that is
  /// where a round's close lands: `InterviewRound.assignTo` copies `closesAt`
  /// onto it, and `InterviewRepository.endRound` stamps the moment of an early
  /// close. So both ways a round can close are covered by one check.
  bool isFinishedAt(DateTime now) =>
      rounds.isNotEmpty &&
      rounds.every((i) =>
          i.status == InterviewStatus.completed ||
          (i.expiresAt != null && now.isAfter(i.expiresAt!)));

  /// [isFinishedAt] against the wall clock.
  bool get isFinished => isFinishedAt(DateTime.now());

  /// What the LAST round they hold decided about them.
  ///
  /// The pipeline's own answer to "did this person get to the end": each round's
  /// outcome is written when the recruiter reviews it, so the newest one is
  /// where they stopped. `pending` means the round they last sat has not been
  /// decided yet — not that they were rejected.
  RoundOutcome get latestOutcome =>
      rounds.isEmpty ? RoundOutcome.pending : rounds.last.outcome;

  /// True when the pipeline advanced them out of their last round — i.e. they
  /// cleared everything that was put in front of them.
  bool get advancedFromLastRound => latestOutcome == RoundOutcome.selected;

  /// The published conclusion, from whichever round carries it.
  ///
  /// Every round of a candidate is written with the same conclusion (see
  /// `InterviewRepository.publishConclusion`), so any is authoritative. Reading
  /// the LAST non-null one means a partially-failed batch shows the newest
  /// decision rather than the one it was replacing.
  TestConclusion? get conclusion {
    TestConclusion? found;
    for (final round in rounds) {
      final c = round.testConclusion;
      if (c != null) found = c;
    }
    return found;
  }

  bool get hasConclusion => conclusion != null;
}

/// The final result a pipeline's own rounds already imply, as email → outcome.
///
/// The recruiter decided who advanced when they reviewed each round; asking them
/// to re-tick that same list on the final screen was both work and a chance to
/// get it wrong. So this reads it back:
///
///   * Already published? Keep what they were told. Re-opening the screen shows
///     the state of the world, it does not propose to change it.
///   * Advanced out of their last round → cleared: they got through everything
///     that was put in front of them.
///   * Anything else → not selected. Including `pending`: a candidate whose last
///     round was never decided did not get through it, and the screen says out
///     loud where the pre-fill came from so this can be corrected in one tap.
///
/// Pure so the rule can be tested without Firebase — the screen that uses it
/// needs FirebaseAuth to build at all.
Map<String, TestOutcome> conclusionPrefill(Iterable<CandidateRun> finished) => {
      for (final run in finished)
        run.emailLower: run.conclusion?.outcome ??
            (run.advancedFromLastRound
                ? TestOutcome.cleared
                : TestOutcome.notSelected),
    };

/// Groups a test's assignments into one [CandidateRun] per person.
///
/// Runs keep the incoming order of each candidate's FIRST row, matching
/// [groupRoundsByCandidate] — the caller's query is newest-first.
List<CandidateRun> runsFor(List<Interview> rows) {
  final ordered = groupRoundsByCandidate(rows);
  final out = <CandidateRun>[];
  for (final interview in ordered) {
    final key = candidateKey(interview);
    if (out.isNotEmpty && out.last.emailLower == key) {
      out.last.rounds.add(interview);
      continue;
    }
    out.add(CandidateRun(
      emailLower: key,
      email: interview.candidateEmail.trim().isEmpty
          ? key
          : interview.candidateEmail.trim(),
      name: interview.candidateName,
      rounds: [interview],
    ));
  }

  // A name written on a later round only — the first row's may be blank.
  return [
    for (final run in out)
      run.name?.trim().isNotEmpty ?? false
          ? run
          : CandidateRun(
              emailLower: run.emailLower,
              email: run.email,
              name: run.rounds
                  .map((i) => i.candidateName?.trim() ?? '')
                  .firstWhere((n) => n.isNotEmpty, orElse: () => ''),
              rounds: run.rounds,
            ),
  ];
}

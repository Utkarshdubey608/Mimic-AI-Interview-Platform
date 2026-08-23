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

  /// True when there is nothing left for this candidate to sit.
  ///
  /// "Everything ASSIGNED to them", not "every round the test has" — those come
  /// apart in the normal case. A pipeline assigns round 2 only to the people who
  /// got through round 1, so a candidate can be finished with their run while the
  /// test still has rounds they will never see. Whether that means they cleared
  /// the process or were quietly dropped from it is the recruiter's decision, and
  /// this flag deliberately does not guess: it only says the recruiter can make
  /// one without cutting a round short.
  bool get isFinished =>
      rounds.isNotEmpty &&
      rounds.every((i) => i.status == InterviewStatus.completed);

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

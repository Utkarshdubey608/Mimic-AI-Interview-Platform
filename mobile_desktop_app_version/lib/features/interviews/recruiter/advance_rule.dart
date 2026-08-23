// lib/features/interviews/recruiter/advance_rule.dart
//
// A round's own advance rule, applied and explained.
//
// Two screens depend on this and they must agree: the end-round preview says
// who WOULD advance if the round were closed now, and the notify screen
// pre-ticks who IS advancing. The recruiter reads the first as a promise about
// the second, so a difference between the two would read as the app changing
// its mind.
//
// Pure, and deliberately free of any widget: this decides whose name is ticked
// on a screen that sends rejection emails, and an off-by-one here is a person
// wrongly told they did not get through.

import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';

/// Who [round]'s own advance rule would shortlist out of [ranked] (best first).
///
/// `manual` returns nothing deliberately — the recruiter said they would pick, so
/// pre-ticking names would be putting words in their mouth.
List<Interview> shortlistFor(InterviewRound round, List<Interview> ranked) {
  final advance = round.advance;
  switch (advance.mode) {
    case AdvanceMode.manual:
      return const [];
    case AdvanceMode.topN:
      final n = (advance.value ?? 0).round();
      if (n <= 0) return const [];
      // `take` already clamps to the list length, so a top-20 rule on 5
      // candidates selects all 5 rather than throwing.
      return ranked.take(n).toList();
    case AdvanceMode.threshold:
      final bar = advance.value;
      if (bar == null) return const [];
      return ranked
          .where((i) => ((i.result?['overallScore'] as num?) ?? -1) >= bar)
          .toList();
  }
}

/// The rule in words, for the screen that pre-ticks by it.
///
/// Always ends by saying the recruiter can change it: a score is a screening
/// signal, and the person accountable for the outcome is reading this.
String advanceRuleExplanation(InterviewRound round) {
  final advance = round.advance;
  switch (advance.mode) {
    case AdvanceMode.manual:
      return 'This round advances candidates manually, so nobody is '
          'pre-selected. Tick whoever moves on.';
    case AdvanceMode.topN:
      return 'Pre-selected: the top ${(advance.value ?? 0).round()} by score, '
          "from this round's advance rule. Change it however you like.";
    case AdvanceMode.threshold:
      return 'Pre-selected: everyone scoring ${(advance.value ?? 0).round()} '
          'or above, from this round\'s advance rule. Change it however you '
          'like.';
  }
}

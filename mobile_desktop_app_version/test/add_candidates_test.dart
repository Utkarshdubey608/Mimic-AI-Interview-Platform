// test/add_candidates_test.dart
//
// The add-candidates picker: who is offered, who is locked, and what a pasted
// blob of emails turns into.
//
// This replaced a confirm dialog that could only add EVERYBODY in the pipeline
// to a round, and could not add somebody who was not in the pipeline at all —
// so a late applicant could not be put into round 2 by any route in the app.
// The rules worth pinning are the ones that make it safe:
//
//   * Somebody already in the round is shown, locked, and never returned. The
//     write skips them anyway; hiding them made "12 candidates" read as 12
//     additions when it was really 3.
//   * A pasted email that is ALREADY known is a tick, not a second row.
//   * Nothing is returned unless it was ticked. Dismissing adds nobody.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:talbotiq/core/theme/app_theme.dart';
import 'package:talbotiq/core/theme/warm_surfaces.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';
import 'package:talbotiq/features/interviews/recruiter/widgets/add_candidates_sheet.dart';

InterviewRound _round({int order = 1, String title = 'AI interview'}) =>
    InterviewRound(
      id: 'r$order',
      testId: 't1',
      recruiterId: 'rec1',
      order: order,
      title: title,
      kind: RoundKind.chat,
    );

void main() {
  group('who the picker offers', () {
    test('everybody in the pipeline, with the round\'s own people locked', () {
      final picks = buildCandidatePicks(
        candidates: {
          'ada@x.com': 'Ada Lovelace',
          'bo@x.com': 'Bo Chen',
          'cy@x.com': null,
        },
        alreadyIn: {'bo@x.com'},
      );

      expect(picks.length, 3);
      expect(picks.where((p) => p.alreadyIn).map((p) => p.email), ['bo@x.com']);
    });

    test('locked rows sort last, the rest by name', () {
      // The recruiter is here to add somebody; the people they cannot add
      // should not be the first thing they scroll past.
      final picks = buildCandidatePicks(
        candidates: {
          'z@x.com': 'Aaron',
          'a@x.com': 'Zoe',
          'm@x.com': 'Mo',
        },
        alreadyIn: {'z@x.com'},
      );

      expect(picks.map((p) => p.display), ['Mo', 'Zoe', 'Aaron']);
      expect(picks.last.alreadyIn, isTrue);
    });

    test('somebody with no name is shown by email', () {
      final picks = buildCandidatePicks(
        candidates: {'nameless@x.com': '  '},
        alreadyIn: const {},
      );
      expect(picks.single.display, 'nameless@x.com');
    });

    test('search matches name or email, and nothing else', () {
      final picks = buildCandidatePicks(
        candidates: {'ada@lovelace.dev': 'Ada', 'bo@x.com': 'Bo'},
        alreadyIn: const {},
      );

      expect(filterCandidatePicks(picks, 'ada').single.email,
          'ada@lovelace.dev');
      expect(filterCandidatePicks(picks, 'LOVELACE').single.email,
          'ada@lovelace.dev');
      expect(filterCandidatePicks(picks, 'zzz'), isEmpty);
      expect(filterCandidatePicks(picks, '   ').length, 2,
          reason: 'an empty query matches everyone');
    });
  });

  group('pasted emails', () {
    test('commas, semicolons, spaces and newlines all separate', () {
      // A recruiter pastes a spreadsheet column, a To: field, or types one
      // address. Being told "invalid" for the wrong separator sends them back
      // to doing it the old way.
      final p = parseCandidateEmails(
          'a@x.com, b@x.com;c@x.com\nd@x.com e@x.com');
      expect(p.valid, {'a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'});
      expect(p.rejected, isEmpty);
    });

    test('emails are lower-cased, because that is the identity everything keys on',
        () {
      expect(parseCandidateEmails('Ada@X.COM').valid, {'ada@x.com'});
    });

    test('what it cannot read is reported, not silently dropped', () {
      final p = parseCandidateEmails('good@x.com, not-an-email, also bad@');
      expect(p.valid, {'good@x.com'});
      expect(p.rejected, containsAll(['not-an-email', 'bad@']));
    });

    test('duplicates collapse', () {
      expect(parseCandidateEmails('a@x.com a@x.com A@x.com').valid.length, 1);
    });

    test('an empty paste is nothing at all, not an error', () {
      final p = parseCandidateEmails('   \n , ; ');
      expect(p.valid, isEmpty);
      expect(p.rejected, isEmpty);
    });
  });

  group('the sheet', () {
    Future<Set<String>?> open(
      WidgetTester tester, {
      required List<CandidatePick> picks,
      InterviewRound? round,
      required Future<void> Function(WidgetTester tester) act,
    }) async {
      Set<String>? result;
      var returned = false;

      await tester.pumpWidget(MaterialApp(
        theme: WarmSurfaces.theme(AppTheme.darkTheme),
        home: Scaffold(
          body: Builder(builder: (context) {
            return TextButton(
              onPressed: () async {
                result = await AddCandidatesSheet.show(
                  context,
                  round: round ?? _round(),
                  picks: picks,
                );
                returned = true;
              },
              child: const Text('open'),
            );
          }),
        ),
      ));

      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await act(tester);
      await tester.pumpAndSettle();

      expect(returned, isTrue, reason: 'the sheet never returned');
      return result;
    }

    testWidgets('nothing ticked means the button does nothing', (tester) async {
      // Disabled rather than hidden: the button is where the eye goes, so it
      // has to be the thing that says what is missing.
      final picks = buildCandidatePicks(
        candidates: {'ada@x.com': 'Ada'},
        alreadyIn: const {},
      );

      var result = <String>{};
      await tester.pumpWidget(MaterialApp(
        theme: WarmSurfaces.theme(AppTheme.darkTheme),
        home: Scaffold(
          body: AddCandidatesSheet(round: _round(), picks: picks),
        ),
      ));

      await tester.tap(find.text('Add candidates'));
      await tester.pumpAndSettle();
      expect(result, isEmpty);
      expect(find.text('Add candidates'), findsOneWidget,
          reason: 'still open — the tap must not have popped anything');
    });

    testWidgets('ticking two people returns exactly those two', (tester) async {
      final picks = buildCandidatePicks(
        candidates: {'ada@x.com': 'Ada', 'bo@x.com': 'Bo', 'cy@x.com': 'Cy'},
        alreadyIn: const {},
      );

      final result = await open(
        tester,
        picks: picks,
        act: (t) async {
          await t.tap(find.text('Ada'));
          await t.pump();
          await t.tap(find.text('Cy'));
          await t.pump();
          await t.tap(find.text('Add 2 candidates'));
        },
      );

      expect(result, {'ada@x.com', 'cy@x.com'});
    });

    testWidgets('somebody already in the round cannot be ticked',
        (tester) async {
      final picks = buildCandidatePicks(
        candidates: {'ada@x.com': 'Ada', 'bo@x.com': 'Bo'},
        alreadyIn: {'bo@x.com'},
      );

      final result = await open(
        tester,
        picks: picks,
        act: (t) async {
          expect(find.text('Already in'), findsOneWidget);
          await t.tap(find.text('Bo'));
          await t.pump();
          // Still nothing to add, so the button is the empty-state one.
          expect(find.text('Add candidates'), findsOneWidget);

          await t.tap(find.text('Ada'));
          await t.pump();
          await t.tap(find.text('Add 1 candidate'));
        },
      );

      expect(result, {'ada@x.com'},
          reason: 'the locked row must never be returned');
    });

    testWidgets('"select everyone" skips the locked rows', (tester) async {
      final picks = buildCandidatePicks(
        candidates: {'a@x.com': 'A', 'b@x.com': 'B', 'c@x.com': 'C'},
        alreadyIn: {'c@x.com'},
      );

      final result = await open(
        tester,
        picks: picks,
        act: (t) async {
          await t.tap(find.text('Select everyone (2)'));
          await t.pump();
          await t.tap(find.text('Add 2 candidates'));
        },
      );

      expect(result, {'a@x.com', 'b@x.com'});
    });

    testWidgets('a typed email is added as a new, ticked row', (tester) async {
      // The gap this closes: no screen in the app could put somebody who was
      // not already in the pipeline into a round.
      final result = await open(
        tester,
        picks: buildCandidatePicks(
            candidates: {'ada@x.com': 'Ada'}, alreadyIn: const {}),
        act: (t) async {
          await t.tap(find.text('Invite someone new by email'));
          await t.pumpAndSettle();
          await t.enterText(
              find.byType(TextField).last, 'late@applicant.com');
          await t.tap(find.text('Add to the list'));
          await t.pumpAndSettle();

          expect(find.text('New'), findsOneWidget);
          await t.tap(find.text('Add 1 candidate'));
        },
      );

      expect(result, {'late@applicant.com'});
    });

    testWidgets('typing an email the pipeline already knows just ticks it',
        (tester) async {
      final result = await open(
        tester,
        picks: buildCandidatePicks(
            candidates: {'ada@x.com': 'Ada Lovelace'}, alreadyIn: const {}),
        act: (t) async {
          await t.tap(find.text('Invite someone new by email'));
          await t.pumpAndSettle();
          await t.enterText(find.byType(TextField).last, 'ADA@x.com');
          await t.tap(find.text('Add to the list'));
          await t.pumpAndSettle();

          // One row, not two, and it is the named one — not a bare address.
          expect(find.text('Ada Lovelace'), findsOneWidget);
          expect(find.text('New'), findsNothing);
          await t.tap(find.text('Add 1 candidate'));
        },
      );

      expect(result, {'ada@x.com'});
    });

    testWidgets('a later round says that adding somebody clears their earlier ones',
        (tester) async {
      // Said out loud because it publishes something to the candidate: being
      // put in round 3 IS being told they got through rounds 1 and 2.
      await tester.pumpWidget(MaterialApp(
        theme: WarmSurfaces.theme(AppTheme.darkTheme),
        home: Scaffold(
          body: AddCandidatesSheet(
            round: _round(order: 2, title: 'Final'),
            picks: const [],
          ),
        ),
      ));

      expect(find.textContaining('earlier rounds as cleared'), findsOneWidget);
    });

    testWidgets('round one says no such thing', (tester) async {
      await tester.pumpWidget(MaterialApp(
        theme: WarmSurfaces.theme(AppTheme.darkTheme),
        home: Scaffold(
          body: AddCandidatesSheet(
            round: _round(order: 0, title: 'Screening'),
            picks: const [],
          ),
        ),
      ));

      expect(find.textContaining('earlier rounds'), findsNothing);
      expect(find.text('Add to "Screening"'), findsOneWidget);
    });
  });
}

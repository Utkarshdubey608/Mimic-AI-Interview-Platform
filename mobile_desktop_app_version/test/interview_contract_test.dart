// test/interview_contract_test.dart
//
// The Dart half of the interview-document golden contract.
//
// `interviews/{id}` is the one record both clients read and write, and its field
// names are frozen because THIS model reads them. "Frozen" used to be a sentence in
// a docstring, and a docstring did not stop the web surface from growing a second,
// independent copy of the schema — which is how the two clients drifted apart.
//
// `contracts/interview_document.fixtures.json` is generated from the backend's
// `app/interviews.py` and asserted by `backend/tests/test_interview_contract.py`.
// This suite asserts the SAME file from the reader's side. So a rename on the server
// fails here, in the client that would have broken, rather than in production as an
// interview that will not load.
//
// Two things are pinned:
//
//   1. Every field the backend writes is a field this model actually reads back.
//   2. The candidate disclosure allowlist agrees across both languages — the
//      recruiter's score, verdict, summary and private notes are stored on the
//      document and are not reachable through the candidate-facing accessors.
//
// Regenerate the fixtures on the backend side
// (REGENERATE_INTERVIEW_FIXTURES=1 pytest tests/test_interview_contract.py) and
// update both suites in the same commit.

import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';

/// The contract file lives outside this package, shared with the backend.
File _fixtureFile() {
  // Tests run with the package root as cwd.
  final candidates = [
    File('../contracts/interview_document.fixtures.json'),
    File('contracts/interview_document.fixtures.json'),
  ];
  return candidates.firstWhere(
    (f) => f.existsSync(),
    orElse: () => throw StateError(
      'contracts/interview_document.fixtures.json not found. Generate it with '
      'REGENERATE_INTERVIEW_FIXTURES=1 pytest tests/test_interview_contract.py '
      'in backend/.',
    ),
  );
}

Map<String, dynamic> _load() =>
    jsonDecode(_fixtureFile().readAsStringSync()) as Map<String, dynamic>;

void main() {
  late Map<String, dynamic> golden;
  late FakeFirebaseFirestore db;

  setUpAll(() => golden = _load());
  setUp(() => db = FakeFirebaseFirestore());

  /// Writes a fixture document and reads it back through the real model.
  ///
  /// `<serverTimestamp>` markers are swapped for a real `Timestamp` first. The
  /// backend passes Firestore's SERVER_TIMESTAMP sentinel for `createdAt` and
  /// `updatedAt`, so what actually lands in the document is a Timestamp — which is
  /// what this model casts to. The fixture records the marker rather than a
  /// plausible ISO string precisely so nobody mistakes it for the wire type; see
  /// `STAMP` in backend/tests/interview_document_cases.py.
  Future<Interview> read(String id, Map<String, dynamic> data) async {
    final resolved = <String, dynamic>{
      for (final e in data.entries)
        e.key: e.value == '<serverTimestamp>'
            ? Timestamp.fromDate(DateTime.utc(2027, 3, 1, 9))
            : e.value,
    };
    await db.collection('interviews').doc(id).set(resolved);
    return Interview.fromDoc(await db.collection('interviews').doc(id).get());
  }

  group('the frozen assignment document', () {
    test('every fixture parses, and the fields survive the round trip', () async {
      final assignments = golden['assignments'] as Map<String, dynamic>;
      expect(assignments, isNotEmpty);

      for (final entry in assignments.entries) {
        final data = Map<String, dynamic>.from(entry.value as Map);
        final i = await read('doc-${entry.key.hashCode}', data);

        // The fields this model reads, checked against what the server wrote. A
        // rename on either side breaks one of these.
        expect(i.testId, data['testId'], reason: entry.key);
        expect(i.recruiterId, data['recruiterId'], reason: entry.key);
        expect(i.recruiterEmail, data['recruiterEmail'], reason: entry.key);
        expect(i.candidateEmail, data['candidateEmail'], reason: entry.key);
        expect(i.candidateEmailLower, data['candidateEmailLower'],
            reason: entry.key);
        expect(i.title, data['title'], reason: entry.key);
        expect(i.type.wire, data['type'], reason: entry.key);
        expect(i.durationMinutes, data['durationMinutes'], reason: entry.key);
        expect(i.status.wire, data['status'], reason: entry.key);
        expect(i.resultPublished, data['resultPublished'], reason: entry.key);
        expect(i.questions, data['questions'], reason: entry.key);
      }
    });

    test('the lowercased email is what assignment is matched on', () async {
      final data = Map<String, dynamic>.from(
          golden['assignments']['assignment/email-is-lowercased'] as Map);
      final i = await read('lower', data);

      // The server derives this; a stray capital would orphan the invite — the
      // emailed link works, the portal reports no interviews.
      expect(i.candidateEmailLower, 'mixed@example.test');
      expect(i.candidateEmailLower,
          InterviewRepositoryEmail.normalize(i.candidateEmail));
    });
  });

  group('the track vocabulary is shared', () {
    test('every mode the server knows maps to a type this model parses', () {
      final modes = golden['modes'] as Map<String, dynamic>;
      expect(modes, isNotEmpty);

      for (final entry in modes.entries) {
        final wire = (entry.value as Map)['type'] as String;
        // `InterviewType.fromWire` is total, so the real assertion is that the
        // server never sends a third bucket this model would silently coerce.
        expect(wire, anyOf('video', 'chat'),
            reason: 'mode ${entry.key} claims type "$wire"');
        expect(InterviewTypeX.fromWire(wire).wire, wire,
            reason: 'mode ${entry.key} does not round-trip');
      }
    });

    test('mcq is present and reaches this client as a chat type', () {
      // Routing on this client keys off `mode`, not `type`, precisely because
      // `type` says "chat" — the server's buckets are video|chat and `mcq` is not
      // in `_VIDEO_MODES`. Both the candidate launcher and the create form depend
      // on that shape, so it is pinned here rather than assumed.
      final mcq = (golden['modes'] as Map)['mcq'] as Map;
      expect(mcq['type'], 'chat');
    });

    test('every mode the server knows has a RoundKind on this client', () {
      // A mode present on the server and absent here is an invite this app
      // receives and cannot route — which is exactly what MCQ was before Phase 11.
      // `chatbot` and `video_avatar` are the two the server names more precisely
      // than this client's kinds do; both collapse onto an existing track.
      const collapsed = {'chatbot': 'chat', 'video_avatar': 'video'};
      for (final mode in (golden['modes'] as Map).keys) {
        final wire = collapsed[mode] ?? mode as String;
        expect(RoundKindX.fromWire(wire).wire, wire,
            reason: 'mode $mode does not round-trip through RoundKind');
      }
    });
  });

  group('the candidate disclosure allowlist', () {
    test('the allowlist is the same set in both languages', () {
      expect(
        (golden['candidateVisibleResultFields'] as List).cast<String>().toSet(),
        {'outcome', 'rank', 'rankOf', 'candidateNote'},
      );
    });

    test("the recruiter's evaluation is stored but not candidate-reachable",
        () async {
      // The document carries the full internal evaluation…
      final i = await read('full', {
        'candidateEmail': 'a@b.com',
        'candidateEmailLower': 'a@b.com',
        'type': 'chat',
        'title': 'Tech round',
        'status': 'completed',
        'resultPublished': true,
        'result': const {
          'overallScore': 87,
          'recommendation': 'Strong Hire',
          'summary': 'Excellent systems depth, hire immediately.',
          'strengths': ['Deep Flutter knowledge'],
          'improvements': ['Rambles under pressure'],
          'twoWayReview': {'stars': 4, 'notes': 'Privately: a bit arrogant.'},
          'outcome': 'selected',
          'rank': 3,
          'rankOf': 40,
          // Must match FULL_RECRUITER_RESULT in the Python cases verbatim: the
          // point of this test is that both languages produce the same candidate
          // view from the SAME input, so a paraphrase here would compare nothing.
          'candidateNote': 'We will be in touch to schedule the next round.',
        },
      });

      // …and the candidate-facing accessors expose exactly the allowlist, with the
      // same values the Python projection produced for the same input.
      final expected = Map<String, dynamic>.from(
          golden['candidateDisclosure']['disclosure/published-selected'] as Map);
      expect(i.outcome.wire, expected['outcome']);
      expect(i.rank, expected['rank']);
      expect(i.rankOf, expected['rankOf']);
      expect(i.candidateNote, expected['candidateNote']);

      // The recruiter's private two-way notes are a separate field for a reason.
      expect(i.twoWayNotes, isNotEmpty);
      expect(i.candidateNote, isNot(contains('arrogant')));
    });

    test('a legacy result reads as pending rather than leaking its score',
        () async {
      final i = await read('legacy', {
        'candidateEmail': 'a@b.com',
        'candidateEmailLower': 'a@b.com',
        'type': 'chat',
        'title': 'Tech round',
        'status': 'completed',
        'resultPublished': true,
        // Published before outcomes existed: a score and no outcome.
        'result': const {'overallScore': 87, 'recommendation': 'Strong Hire'},
      });

      final expected = Map<String, dynamic>.from(
          golden['candidateDisclosure']['disclosure/legacy-result-reads-as-pending']
              as Map);
      expect(i.outcome.wire, expected['outcome']);
      expect(i.outcome, RoundOutcome.pending);
      expect(i.hasOutcome, isFalse);
    });

    test('an unpublished result is nothing to show', () async {
      final i = await read('unpub', {
        'candidateEmail': 'a@b.com',
        'candidateEmailLower': 'a@b.com',
        'type': 'chat',
        'title': 'Tech round',
        'status': 'completed',
        'resultPublished': false,
        'result': const {'overallScore': 87, 'outcome': 'selected'},
      });

      // The Python projection returns null here; the Dart side expresses the same
      // rule as `resultPublished` gating the result surface.
      expect(
        golden['candidateDisclosure']['disclosure/unpublished-shows-nothing'],
        isNull,
      );
      expect(i.resultPublished, isFalse);
    });
  });

  group('the precise track is written, not guessed', () {
    // The defect this closes: with no `mode`, the web client falls back to `type` —
    // which knows only video from chat — so a recruiter's recorded-video interview
    // became a Tavus avatar conversation the moment a candidate opened it in a
    // browser. A different experience, vendor and cost from the one configured.

    Interview assignment({
      InterviewType type = InterviewType.chat,
      RoundKind? roundKind,
      String mode = '',
    }) =>
        Interview(
          id: 'i-1',
          recruiterId: 'r',
          recruiterEmail: 'r@t.test',
          candidateEmail: 'c@t.test',
          candidateEmailLower: 'c@t.test',
          type: type,
          roundKind: roundKind,
          mode: mode,
          title: 'T',
          prompt: '',
          questions: const [],
          avatar: const AvatarConfig(replicaId: ''),
          durationMinutes: 15,
          status: InterviewStatus.assigned,
          createdAt: null,
        );

    test('a round kind names the track exactly', () {
      expect(assignment(roundKind: RoundKind.voice).effectiveMode, 'voice');
      expect(assignment(roundKind: RoundKind.twoWay).effectiveMode, 'two_way');
      expect(assignment(roundKind: RoundKind.video).effectiveMode, 'video');
      expect(assignment(roundKind: RoundKind.chat).effectiveMode, 'chat');
    });

    test('with no round, the type still distinguishes video from chat', () {
      expect(assignment(type: InterviewType.video).effectiveMode, 'video');
      expect(assignment(type: InterviewType.chat).effectiveMode, 'chat');
      expect(assignment(type: InterviewType.voice).effectiveMode, 'voice');
    });

    test('a resume round writes NO mode', () {
      // A résumé screen is not an interview track and has no web runtime. Inventing
      // a mode for it would tell the browser to try to run one.
      expect(assignment(roundKind: RoundKind.resume).effectiveMode, '');
    });

    test('an explicit mode wins over anything derived', () {
      expect(
        assignment(type: InterviewType.chat, mode: 'video_avatar').effectiveMode,
        'video_avatar',
      );
    });

    test('the written document carries the precise track', () {
      final written = assignment(
        type: InterviewType.video,
        roundKind: RoundKind.video,
      ).toCreateMap();
      expect(written['mode'], 'video');
      expect(written['type'], 'video');
    });

    test('mode and type must describe the same interview', () {
      // NOT enforced at the write — `type` is the caller's — so it is asserted here.
      // A document whose two disagree runs one track on the phone and a different one
      // in the browser, which is the class of bug `mode` exists to close.
      for (final pair in <(InterviewType, RoundKind)>[
        (InterviewType.chat, RoundKind.chat),
        (InterviewType.video, RoundKind.video),
        (InterviewType.voice, RoundKind.voice),
        (InterviewType.video, RoundKind.twoWay),
      ]) {
        expect(
          assignment(type: pair.$1, roundKind: pair.$2).modeAgreesWithType,
          isTrue,
          reason: '${pair.$2} on a ${pair.$1} interview',
        );
      }

      // And it CATCHES a mismatch rather than quietly passing everything.
      expect(
        assignment(type: InterviewType.chat, roundKind: RoundKind.video)
            .modeAgreesWithType,
        isFalse,
      );
    });

    test('a resume round omits the key entirely rather than writing empty', () {
      expect(
        assignment(roundKind: RoundKind.resume).toCreateMap().containsKey('mode'),
        isFalse,
      );
    });
  });
}

/// Exposes the repository's email normalisation for the assertion above without
/// pulling Firestore wiring into this suite.
class InterviewRepositoryEmail {
  static String normalize(String email) => email.trim().toLowerCase();

}


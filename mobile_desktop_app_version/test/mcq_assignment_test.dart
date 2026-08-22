// test/mcq_assignment_test.dart
//
// Assigning an MCQ round from this client.
//
// A recruiter could author a paper on the phone before this landed, but not send one:
// `RoundKind` had no `mcq`, so an MCQ round could not go on a timeline and the create
// form could not produce one. Sending an assessment was a web-only action.
//
// Three things have to be exactly right on the document that gets written, and each one
// breaks a candidate differently if it is not:
//
//   mode: 'mcq'              — routing keys off this. Wrong, and the candidate opens a
//                              chat interview with no questions.
//   type: 'chat'             — the server's bucket for mcq. Disagreeing with `mode` is
//                              the whole class of bug `mode` exists to close.
//   screening.mcqSetId       — WHICH paper. Absent, and the candidate is told there is
//                              no assessment attached.
//
// And one that breaks a recruiter: the id is copied at assignment, so editing the round
// afterwards cannot swap the paper under somebody mid-attempt.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:talbotiq/features/interviews/models/interview.dart';
import 'package:talbotiq/features/interviews/models/interview_round.dart';

InterviewRound _mcqRound({
  String mcqSetId = 'set-1',
  DateTime? opensAt,
  DateTime? closesAt,
}) =>
    InterviewRound(
      id: 'round-1',
      testId: 'test-1',
      recruiterId: 'rec-1',
      order: 0,
      title: 'Screening assessment',
      kind: RoundKind.mcq,
      config: {
        if (mcqSetId.isNotEmpty) 'mcqSetId': mcqSetId,
        'language': 'English',
        'maxAttempts': 1,
      },
      opensAt: opensAt,
      closesAt: closesAt,
    );

Interview _assign(InterviewRound round) => round.assignTo(
      candidateEmail: '  Ada@Example.TEST ',
      candidateName: 'Ada',
      recruiterEmail: 'grace@acme.test',
      recruiterName: 'Acme',
      testTitle: 'Backend Engineer',
    );

void main() {
  group('the round kind', () {
    test('mcq round-trips over the wire', () {
      expect(RoundKind.mcq.wire, 'mcq');
      expect(RoundKindX.fromWire('mcq'), RoundKind.mcq);
    });

    test('mcq needs no AI script', () {
      // A prompt, a question list, an avatar and a voice are all meaningless on a
      // paper whose questions are authored separately and referenced by id. A round
      // editor that demanded them would be asking for a script nobody reads.
      expect(RoundKind.mcq.usesAiInterviewer, isFalse);
      expect(RoundKind.mcq.interviewType, isNull);
      expect(RoundKind.mcq.needsMcqPaper, isTrue);
    });

    test('mcq is something the candidate sits, not something they submit', () {
      expect(RoundKind.mcq.isInterview, isTrue);
      expect(RoundKind.resume.isInterview, isFalse);
    });

    test('mcq is not recruiter-scored', () {
      // Its score is a comparison against a stored key. Offering a manual review
      // would invite somebody to overwrite an exact number with an opinion.
      expect(RoundKind.mcq.isRecruiterScored, isFalse);
    });

    test('only mcq needs a paper', () {
      for (final kind in RoundKind.values) {
        expect(kind.needsMcqPaper, kind == RoundKind.mcq, reason: '$kind');
      }
    });
  });

  group('assigning the round', () {
    test('the assignment names the paper, the mode and the bucket', () {
      final i = _assign(_mcqRound());

      expect(i.mcqSetId, 'set-1');
      expect(i.effectiveMode, 'mcq');
      // The server's `type_for_mode` puts mcq in the chat bucket, and this client
      // has to agree or the two describe different interviews.
      expect(i.type, InterviewType.chat);
      expect(i.modeAgreesWithType, isTrue);
      expect(i.effectiveRoundKind, RoundKind.mcq);
    });

    test('the questions list is empty, and that is the point', () {
      // The paper is referenced, not embedded, because it contains the ANSWER KEY
      // and an interview document is readable by the candidate assigned to it.
      expect(_assign(_mcqRound()).questions, isEmpty);
    });

    test('the paper is copied at assignment, not read later', () {
      // So editing the round afterwards cannot change which paper an outstanding
      // invite points at — or swap it under a candidate mid-attempt.
      final round = _mcqRound(mcqSetId: 'set-original');
      final assigned = _assign(round);
      final edited = round.copyWith(config: {...round.config, 'mcqSetId': 'set-new'});

      expect(assigned.mcqSetId, 'set-original');
      expect(_assign(edited).mcqSetId, 'set-new');
    });

    test('the round window becomes the candidate access window', () {
      final opens = DateTime.now().add(const Duration(hours: 1));
      final closes = DateTime.now().add(const Duration(days: 2));
      final i = _assign(_mcqRound(opensAt: opens, closesAt: closes));
      expect(i.availableFrom, opens);
      expect(i.expiresAt, closes);
    });

    test('a round with no paper assigns nothing rather than an empty id', () {
      // The create form refuses this before it can happen; if one arrives anyway,
      // an absent field reads on the server as "no assessment attached" — which is
      // both true and the message the candidate is shown.
      final i = _assign(_mcqRound(mcqSetId: ''));
      expect(i.mcqSetId, isEmpty);
      expect(i.toCreateMap().containsKey('screening'), isFalse);
    });
  });

  group('what gets written', () {
    test('the paper id is nested under screening, where the web writes it', () {
      // One interview document has to mean the same thing whichever client created
      // it. `screening.mcqSetId` is the shape the web surface has always used.
      final map = _assign(_mcqRound()).toCreateMap();
      expect(map['screening'], {'mcqSetId': 'set-1'});
      expect(map['mode'], 'mcq');
      expect(map['type'], 'chat');
      expect(map['roundKind'], 'mcq');
      expect(map['questions'], isEmpty);
    });

    test('every other track writes no screening key at all', () {
      for (final kind in [RoundKind.chat, RoundKind.video, RoundKind.voice]) {
        final round = InterviewRound(
          id: 'r',
          testId: 't',
          recruiterId: 'rec',
          order: 0,
          title: 'Round',
          kind: kind,
          config: const {'questions': ['Tell me about yourself']},
        );
        expect(_assign(round).toCreateMap().containsKey('screening'), isFalse,
            reason: '$kind should carry no paper');
      }
    });

    test('an edit off the MCQ track DELETES the paper id', () {
      // Blanking it would leave the document claiming a paper that is not there,
      // which reads as "no assessment attached" only by accident. A delete says it.
      final chat = Interview(
        id: 'i1',
        recruiterId: 'rec-1',
        recruiterEmail: 'grace@acme.test',
        candidateEmail: 'ada@example.test',
        candidateEmailLower: 'ada@example.test',
        type: InterviewType.chat,
        title: 'Round',
        prompt: '',
        questions: const ['Q1'],
        avatar: const AvatarConfig(replicaId: ''),
        durationMinutes: 20,
        status: InterviewStatus.assigned,
      );
      expect(chat.toUpdateMap()['screening.mcqSetId'], isA<FieldValue>());
    });

    test('an edit that keeps the paper writes a dotted path, not the whole map', () {
      // A dotted path so a `screening` map the web wrote keeps its other keys —
      // `mcqConfig` lives there too, and replacing the map from here would silently
      // drop scoring rules a recruiter set in the browser.
      final map = _assign(_mcqRound()).toUpdateMap();
      expect(map['screening.mcqSetId'], 'set-1');
      expect(map.containsKey('screening'), isFalse);
    });
  });

  group('reading it back', () {
    late FakeFirebaseFirestore db;

    setUp(() => db = FakeFirebaseFirestore());

    Future<Interview> read(Map<String, dynamic> data) async {
      await db.collection('interviews').doc('i1').set({
        'recruiterId': 'rec-1',
        'candidateEmail': 'ada@example.test',
        'candidateEmailLower': 'ada@example.test',
        'type': 'chat',
        'title': 'Assessment',
        'status': 'assigned',
        ...data,
      });
      return Interview.fromDoc(await db.collection('interviews').doc('i1').get());
    }

    test('the nested paper id is read', () async {
      final i = await read({'mode': 'mcq', 'screening': {'mcqSetId': 'set-9'}});
      expect(i.mcqSetId, 'set-9');
      expect(i.effectiveMode, 'mcq');
    });

    test('a top-level paper id is read too', () async {
      // For a document written by hand, by a script, or by a build that predates
      // the nested shape. Reading only one place would strand it.
      expect((await read({'mcqSetId': 'set-9'})).mcqSetId, 'set-9');
    });

    test('the nested one wins when both are present', () async {
      final i = await read({
        'screening': {'mcqSetId': 'nested'},
        'mcqSetId': 'legacy',
      });
      expect(i.mcqSetId, 'nested');
    });

    test('a document with neither reports no paper, not null', () async {
      expect((await read({})).mcqSetId, '');
    });

    test('a round-assigned MCQ interview round-trips through Firestore', () async {
      // The server timestamps are dropped rather than written: the fake store
      // cannot apply a real `FieldValue`, and what is under test here is the
      // MCQ fields surviving a write and a read — not how Firestore stamps a clock.
      final written = {..._assign(_mcqRound()).toCreateMap()}
        ..remove('createdAt')
        ..remove('updatedAt');
      await db.collection('interviews').doc('i2').set(written);
      final i =
          Interview.fromDoc(await db.collection('interviews').doc('i2').get());

      expect(i.mcqSetId, 'set-1');
      expect(i.effectiveMode, 'mcq');
      expect(i.effectiveRoundKind, RoundKind.mcq);
      expect(i.modeAgreesWithType, isTrue);
      expect(i.candidateEmailLower, 'ada@example.test');
    });
  });
}

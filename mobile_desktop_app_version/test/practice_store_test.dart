// test/practice_store_test.dart
//
// A candidate's practice history, on the server rather than the device.
//
// It lived in the SharedPreferences blob, which meant it was not really their history:
// it did not survive a reinstall, did not follow them to a second phone, and was
// invisible from the web. The FEATURE is platform-specific and fine to keep that way —
// there is no web practice tab and none is needed — but the DATA is theirs.

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:talbotiq/features/interviews/candidate/practice/practice_store.dart';
import 'package:talbotiq/shared/models/app_models.dart';

InterviewResult run({
  required String id,
  String createdAt = '2027-06-01T12:00:00.000Z',
  bool isPractice = true,
  int score = 72,
}) =>
    InterviewResult(
      id: id,
      conversationId: 'c-$id',
      name: 'Practice run',
      createdAt: createdAt,
      score: score,
      wpm: 140,
      fillers: 3,
      transcript: const [],
      scorecard: null,
      isPractice: isPractice,
    );

void main() {
  late FakeFirebaseFirestore db;
  late PracticeStore store;

  setUp(() {
    db = FakeFirebaseFirestore();
    // A uid, not an auth object — the store takes the narrower dependency, so this
    // suite needs no Firebase Auth at all.
    store = PracticeStore(firestore: db, uid: 'uid-cand');
  });

  test('a practice run is filed under the candidate, newest first', () async {
    await store.save(run(id: 'older', createdAt: '2027-05-01T09:00:00.000Z'));
    await store.save(run(id: 'newer', createdAt: '2027-06-01T09:00:00.000Z'));

    final loaded = await store.load();
    expect(loaded.map((r) => r.id), ['newer', 'older']);
  });

  test('an ASSIGNED interview result is never filed here', () async {
    // It belongs on its `interviews` document, written by the server. A copy here
    // would be a second source of truth for a score — and one the candidate could
    // edit, since this collection is client-writable.
    await store.save(run(id: 'assigned', isPractice: false));
    expect(await store.load(), isEmpty);
  });

  test('saving the same run twice does not duplicate it', () async {
    await store.save(run(id: 'same', score: 60));
    await store.save(run(id: 'same', score: 81));

    final loaded = await store.load();
    expect(loaded.length, 1);
    // The later write wins, which is what re-scoring a rehearsal should do.
    expect(loaded.single.score, 81);
  });

  test('one malformed run does not blank out the history', () async {
    await store.save(run(id: 'good'));
    // A document written by an older build, or half-written by a failed batch.
    await db
        .collection(PracticeStore.collectionName)
        .doc('uid-cand')
        .collection(PracticeStore.runsSubcollection)
        .doc('bad')
        .set({'transcript': 'not a list', 'createdAt': '2027-07-01T00:00:00.000Z'});

    final loaded = await store.load();
    // Same rule as InterviewRepository._parseDocs: the readable rows survive.
    expect(loaded.map((r) => r.id), contains('good'));
  });

  group('local history is carried up rather than discarded', () {
    test('existing runs on the device are uploaded once', () async {
      // Without this, promoting the store silently discards whatever somebody had
      // practised before the change — indistinguishable, from their side, from the app
      // losing their work.
      final uploaded = await store.migrateLocal([
        run(id: 'a'),
        run(id: 'b'),
        run(id: 'assigned', isPractice: false),
      ]);

      expect(uploaded, 2, reason: 'the assigned result is not practice history');
      expect((await store.load()).map((r) => r.id), containsAll(['a', 'b']));
    });

    test('running it twice is harmless', () async {
      await store.migrateLocal([run(id: 'a')]);
      await store.migrateLocal([run(id: 'a')]);
      expect((await store.load()).length, 1);
    });

    test('nothing local means nothing written', () async {
      expect(await store.migrateLocal(const []), 0);
    });
  });

  test('signed out, it reads and writes nothing rather than throwing', () async {
    final anonymous = PracticeStore(firestore: db, uid: '');
    await anonymous.save(run(id: 'x'));
    expect(await anonymous.load(), isEmpty);
  });
}

"""The MCQ candidate runtime, end to end.

`TestTheKeyNeverReachesTheCandidate` is the group that matters. It asserts against
the raw response TEXT of every route a candidate can call, because an assessment
whose key is readable in devtools is not a weaker assessment — it is not one.
"""

from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

RECRUITER = AuthedUser(uid="uid-rec", email="rec@example.test", claims={})
CANDIDATE = AuthedUser(uid="uid-cand", email="ada@example.test", claims={})


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


PAPER = [
    {
        "id": "q1",
        "text": "What does EC2 stand for?",
        "type": "single",
        "options": [
            {"id": "a", "text": "Elastic Compute Cloud"},
            {"id": "b", "text": "Elastic Container Cloud"},
        ],
        "correctOptionIds": ["a"],
        "topic": "AWS",
        "explanation": "Elastic Compute Cloud.",
    },
    {
        "id": "q2",
        "text": "Which are AWS services?",
        "type": "multi",
        "options": [
            {"id": "a", "text": "S3"},
            {"id": "b", "text": "IAM"},
            {"id": "c", "text": "Azure Blob"},
        ],
        "correctOptionIds": ["a", "b"],
        "topic": "AWS",
    },
]


def _seed(fake_store, *, config=None, questions=None) -> str:
    """An MCQ session mid-flight, as session create would have left it."""
    session_id = "s-mcq-1"
    _run(
        fake_store.sessions.put(
            {
                "id": session_id,
                "templateId": "t1",
                "recruiterId": RECRUITER.uid,
                "track": "mcq",
                "status": "created",
                "candidate": {"name": "Ada", "email": CANDIDATE.email},
                "candidateEmailLower": CANDIDATE.email,
                "questions": questions if questions is not None else PAPER,
                "mcqConfig": config or {},
                "currentIndex": 0,
                "integrityEvents": [],
                "tabSwitchCount": 0,
            }
        )
    )
    _run(fake_store.templates.put({"id": "t1", "name": "AWS screen", "role": "Cloud", "track": "mcq"}))
    return session_id


class TestTheKeyNeverReachesTheCandidate:
    def test_the_paper_response_has_no_key(self, fake_store) -> None:
        sid = _seed(fake_store)
        response = _client(CANDIDATE).get(f"/api/web/sessions/{sid}/mcq")
        assert response.status_code == 200
        assert "correctOptionIds" not in response.text
        assert "explanation" not in response.text

    def test_the_options_still_arrive_so_it_can_be_answered(self, fake_store) -> None:
        sid = _seed(fake_store)
        paper = _client(CANDIDATE).get(f"/api/web/sessions/{sid}/mcq").json()["questions"]
        assert len(paper) == 2
        assert {o["id"] for o in paper[0]["options"]} == {"a", "b"}

    def test_the_save_response_has_no_key(self, fake_store) -> None:
        sid = _seed(fake_store)
        r = _client(CANDIDATE).post(
            f"/api/web/sessions/{sid}/mcq/answers", json={"answers": {"q1": ["a"]}}
        )
        assert "correctOptionIds" not in r.text

    def test_the_submit_response_carries_no_key_by_default(self, fake_store) -> None:
        """The score is not shown to the candidate unless the recruiter allows it."""
        sid = _seed(fake_store)
        r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/mcq/submit", json={})
        assert r.status_code == 200
        assert "correctOptionIds" not in r.text
        assert r.json()["result"] is None


class TestAnsweringAndScoring:
    def test_answers_are_saved_and_restored_on_reload(self, fake_store) -> None:
        """A refresh must not cost a candidate the answers they had chosen."""
        sid = _seed(fake_store)
        client = _client(CANDIDATE)
        client.post(f"/api/web/sessions/{sid}/mcq/answers", json={"answers": {"q1": ["a"]}})
        assert client.get(f"/api/web/sessions/{sid}/mcq").json()["answers"] == {"q1": ["a"]}

    def test_opening_the_paper_starts_the_assessment(self, fake_store) -> None:
        """Otherwise a whole-paper timer could be dodged by opening and closing."""
        sid = _seed(fake_store)
        assert _client(CANDIDATE).get(f"/api/web/sessions/{sid}/mcq").json()["status"] == "in_progress"

    def test_a_full_correct_submission_scores_100(self, fake_store) -> None:
        sid = _seed(fake_store)
        client = _client(CANDIDATE)
        client.post(f"/api/web/sessions/{sid}/mcq/answers", json={"answers": {"q1": ["a"], "q2": ["a", "b"]}})
        client.post(f"/api/web/sessions/{sid}/mcq/submit", json={})
        stored = _run(fake_store.sessions.get(sid))
        assert stored["mcqResult"]["percent"] == 100.0
        assert stored["status"] == "completed"

    def test_answers_sent_with_submit_still_count(self, fake_store) -> None:
        """Answer-and-submit in one go must not need a prior auto-save."""
        sid = _seed(fake_store)
        _client(CANDIDATE).post(
            f"/api/web/sessions/{sid}/mcq/submit", json={"answers": {"q1": ["a"], "q2": ["a", "b"]}}
        )
        assert _run(fake_store.sessions.get(sid))["mcqResult"]["percent"] == 100.0

    def test_multi_select_is_all_or_nothing_by_default(self, fake_store) -> None:
        sid = _seed(fake_store)
        _client(CANDIDATE).post(
            f"/api/web/sessions/{sid}/mcq/submit", json={"answers": {"q1": ["a"], "q2": ["a"]}}
        )
        # q1 right, q2 partial → 1 of 2 points
        assert _run(fake_store.sessions.get(sid))["mcqResult"]["percent"] == 50.0

    def test_an_unknown_option_id_is_discarded_not_stored(self, fake_store) -> None:
        """A client sending an id that is not on the question is a bug, not an answer."""
        sid = _seed(fake_store)
        client = _client(CANDIDATE)
        client.post(f"/api/web/sessions/{sid}/mcq/answers", json={"answers": {"q1": ["zzz"]}})
        assert _run(fake_store.sessions.get(sid))["mcqAnswers"] == {"q1": []}

    def test_a_topic_breakdown_is_stored_for_the_report(self, fake_store) -> None:
        sid = _seed(fake_store)
        _client(CANDIDATE).post(f"/api/web/sessions/{sid}/mcq/submit", json={})
        topics = _run(fake_store.sessions.get(sid))["mcqResult"]["topics"]
        assert [t["topic"] for t in topics] == ["AWS"]

    def test_a_report_is_written_where_every_other_track_writes_one(self, fake_store) -> None:
        sid = _seed(fake_store)
        _client(CANDIDATE).post(f"/api/web/sessions/{sid}/mcq/submit", json={})
        report = _run(fake_store.reports.get(sid))
        assert report["track"] == "mcq"
        assert report["mcq"]["questionCount"] == 2


class TestSubmittingIsFinal:
    def test_a_second_submit_is_refused_rather_than_rescored(self, fake_store) -> None:
        """The first submission is the one the candidate stood behind."""
        sid = _seed(fake_store)
        client = _client(CANDIDATE)
        client.post(f"/api/web/sessions/{sid}/mcq/submit", json={"answers": {"q1": ["a"]}})
        second = client.post(f"/api/web/sessions/{sid}/mcq/submit", json={"answers": {"q1": ["a"]}})
        assert second.status_code == 409

    def test_answers_cannot_be_changed_after_submitting(self, fake_store) -> None:
        sid = _seed(fake_store)
        client = _client(CANDIDATE)
        client.post(f"/api/web/sessions/{sid}/mcq/submit", json={})
        later = client.post(f"/api/web/sessions/{sid}/mcq/answers", json={"answers": {"q1": ["a"]}})
        assert later.status_code == 409


class TestWrongTrack:
    def test_a_non_mcq_session_has_no_mcq_routes(self, fake_store) -> None:
        _run(
            fake_store.sessions.put(
                {
                    "id": "s-chat",
                    "templateId": "t1",
                    "recruiterId": RECRUITER.uid,
                    "track": "chatbot",
                    "status": "created",
                    "candidate": {"name": "Ada", "email": CANDIDATE.email},
                    "candidateEmailLower": CANDIDATE.email,
                    "questions": [],
                }
            )
        )
        _run(fake_store.templates.put({"id": "t1", "name": "x", "track": "chatbot"}))
        assert _client(CANDIDATE).get("/api/web/sessions/s-chat/mcq").status_code == 404


class TestShowingTheScore:
    def test_the_candidate_sees_it_only_when_the_recruiter_allows(self, fake_store) -> None:
        sid = _seed(fake_store, config={"showScoreToCandidate": True})
        body = _client(CANDIDATE).post(
            f"/api/web/sessions/{sid}/mcq/submit", json={"answers": {"q1": ["a"]}}
        ).json()
        assert body["result"]["percent"] == 50.0

    def test_even_then_the_key_does_not_travel(self, fake_store) -> None:
        """Showing a score is NOT publishing the answers.

        This is the back door: the stored result carries `correctOptionIds` on every
        per-question record, because that is what makes the recruiter's report
        reviewable. Returning it verbatim would hand the whole key to any candidate
        whose recruiter enabled `showScoreToCandidate`.
        """
        sid = _seed(fake_store, config={"showScoreToCandidate": True})
        r = _client(CANDIDATE).post(f"/api/web/sessions/{sid}/mcq/submit", json={})
        assert r.status_code == 200
        assert "correctOptionIds" not in r.text

    def test_the_candidate_still_learns_which_ones_they_got_right(self, fake_store) -> None:
        """Per-question right/wrong is theirs; the correct option is not."""
        sid = _seed(fake_store, config={"showScoreToCandidate": True})
        body = _client(CANDIDATE).post(
            f"/api/web/sessions/{sid}/mcq/submit", json={"answers": {"q1": ["a"]}}
        ).json()
        records = body["result"]["questions"]
        assert records[0]["correct"] is True and records[1]["correct"] is False
        assert all("correctOptionIds" not in record for record in records)

    def test_the_recruiters_stored_result_DOES_keep_the_key(self, fake_store) -> None:
        """It is what makes a result reviewable — and it never leaves the server."""
        sid = _seed(fake_store, config={"showScoreToCandidate": True})
        _client(CANDIDATE).post(f"/api/web/sessions/{sid}/mcq/submit", json={})
        stored = _run(fake_store.sessions.get(sid))
        assert stored["mcqResult"]["questions"][0]["correctOptionIds"] == ["a"]

"""The coding track's candidate runtime, and the invite that sets it.

Two things carry the weight, and neither is a happy path.

THE HIDDEN TESTS MUST NOT REACH THE CANDIDATE THROUGH A SESSION. The projection is
tested exhaustively in test_web_coding_projection.py; what is tested here is that
the session route USES it. A route returning the stored problem would defeat the
projection while every projection test still passed — which is exactly how this
class of leak ships.

AND AN INVITE MUST NOT BE SENDABLE WITH SOMEBODY ELSE'S PROBLEM, or with one that
is not ready. A problem carries its hidden inputs and expected outputs, so an id
from another recruiter has to answer 404 — not 403, which would confirm it exists.
"""

from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

RECRUITER = AuthedUser(uid="uid-recruiter", email="recruiter@talbotiq.com", claims={})
OTHER_RECRUITER = AuthedUser(uid="uid-rival", email="rival@example.test", claims={})
CANDIDATE = AuthedUser(uid="uid-cand", email="ada@example.test", claims={})

HIDDEN_IN = "HIDDEN-INPUT-ce2f1a"
HIDDEN_OUT = "HIDDEN-OUTPUT-9b4d7e"


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def _problem(problem_id="cp-1", *, owner=RECRUITER.uid, ready=True) -> dict:
    cases = [
        {"id": "s1", "input": "1 2", "expectedOutput": "3", "hidden": False, "points": 2},
        {"id": "h1", "input": HIDDEN_IN, "expectedOutput": HIDDEN_OUT, "hidden": True, "points": 8},
    ]
    if not ready:
        # No visible sample: the server refuses to SEND this, which is the state
        # authoring is allowed to save and sending is not.
        cases = [c for c in cases if c["hidden"]]
    return {
        "id": problem_id,
        "recruiterId": owner,
        "title": "Two Sum",
        "statementMd": "Return the indices.",
        "constraints": "",
        "ioFormat": "",
        "examples": [],
        "starterCode": {"python": "def solve(): pass"},
        "testCases": cases,
        "timeLimitMs": 2000,
        "memoryMb": 128,
        "difficulty": "medium",
        "tags": [],
        "allowedLanguages": ["python"],
    }


def _seed_session(fake_store, *, session_id="s-coding-1", problems=None) -> str:
    """A coding session mid-flight, as session create would have left it — with the
    problems inline and their hidden tests intact."""
    _run(
        fake_store.sessions.put(
            {
                "id": session_id,
                "templateId": "t1",
                "recruiterId": RECRUITER.uid,
                "track": "coding",
                "status": "created",
                "candidate": {"name": "Ada", "email": CANDIDATE.email},
                "candidateEmailLower": CANDIDATE.email,
                "codingProblems": problems if problems is not None else [_problem()],
                "currentIndex": 0,
                "integrityEvents": [],
                "tabSwitchCount": 0,
            }
        )
    )
    return session_id


# ── the hidden tests, through the session ─────────────────────────────────────


class TestTheHiddenTestsNeverReachTheCandidate:
    def test_the_state_response_carries_no_hidden_case(self, fake_store) -> None:
        sid = _seed_session(fake_store)
        response = _client(CANDIDATE).get(f"/api/web/sessions/{sid}/coding")
        assert response.status_code == 200
        assert HIDDEN_IN not in response.text, "a hidden input reached the candidate"
        assert HIDDEN_OUT not in response.text, "a hidden expected output reached the candidate"
        assert "recruiterId" not in response.text

    def test_it_publishes_the_sample_and_the_hidden_COUNT(self, fake_store) -> None:
        sid = _seed_session(fake_store)
        body = _client(CANDIDATE).get(f"/api/web/sessions/{sid}/coding").json()
        problem = body["problems"][0]
        assert [c["id"] for c in problem["sampleTests"]] == ["s1"]
        # The sample's expected output IS published — that is what a sample is for.
        assert problem["sampleTests"][0]["expectedOutput"] == "3"
        assert problem["hiddenTestCount"] == 1
        # Fair information: how much rides on cases they cannot see.
        assert problem["totalPoints"] == 10

    def test_the_route_does_not_exist_for_another_track(self, fake_store) -> None:
        """404, not 400: these routes simply are not there for a chatbot interview,
        and a more precise answer would describe somebody else's session."""
        _run(
            fake_store.sessions.put(
                {
                    "id": "s-chat",
                    "recruiterId": RECRUITER.uid,
                    "track": "chatbot",
                    "candidate": {"email": CANDIDATE.email},
                    "candidateEmailLower": CANDIDATE.email,
                }
            )
        )
        assert _client(CANDIDATE).get("/api/web/sessions/s-chat/coding").status_code == 404

    def test_someone_else_cannot_read_the_session(self, fake_store) -> None:
        sid = _seed_session(fake_store)
        response = _client(OTHER_RECRUITER).get(f"/api/web/sessions/{sid}/coding")
        assert response.status_code in (403, 404)
        assert HIDDEN_OUT not in response.text


# ── drafts ────────────────────────────────────────────────────────────────────


class TestTheEditorSurvivesARefresh:
    def test_a_draft_is_saved_and_returned(self, fake_store) -> None:
        """The highest-value thing on the screen, and invisible when it works."""
        sid = _seed_session(fake_store)
        client = _client(CANDIDATE)
        saved = client.post(
            f"/api/web/sessions/{sid}/coding/draft",
            json={"problemId": "cp-1", "source": "print(3)", "language": "python"},
        )
        assert saved.status_code == 200
        body = client.get(f"/api/web/sessions/{sid}/coding").json()
        assert body["drafts"]["cp-1"] == "print(3)"
        assert body["language"] == "python"

    def test_a_draft_for_an_unknown_problem_is_refused(self, fake_store) -> None:
        sid = _seed_session(fake_store)
        response = _client(CANDIDATE).post(
            f"/api/web/sessions/{sid}/coding/draft",
            json={"problemId": "cp-nope", "source": "x"},
        )
        assert response.status_code == 404

    def test_an_oversized_draft_is_refused(self, fake_store) -> None:
        sid = _seed_session(fake_store)
        response = _client(CANDIDATE).post(
            f"/api/web/sessions/{sid}/coding/draft",
            json={"problemId": "cp-1", "source": "x" * 100_001},
        )
        assert response.status_code == 413


# ── with no judge, nothing runs ───────────────────────────────────────────────


class TestNothingRunsWithoutAJudge:
    def test_run_answers_503(self, fake_store) -> None:
        """And the message tells the candidate what to do, because an unavailable
        judge is not their fault and must not read as their code failing."""
        sid = _seed_session(fake_store)
        response = _client(CANDIDATE).post(
            f"/api/web/sessions/{sid}/coding/run",
            json={"problemId": "cp-1", "source": "print(3)", "languageId": 71},
        )
        assert response.status_code == 503
        assert "recruiter" in response.text.lower()

    def test_submit_answers_503(self, fake_store) -> None:
        sid = _seed_session(fake_store)
        response = _client(CANDIDATE).post(
            f"/api/web/sessions/{sid}/coding/submit",
            json={"problemId": "cp-1", "source": "print(3)", "languageId": 71},
        )
        assert response.status_code == 503

    def test_an_unknown_submission_reports_failed_with_a_200(self, fake_store) -> None:
        """The client polls this for the length of a run; a 404 reads as a
        transient fault and gets retried forever."""
        sid = _seed_session(fake_store)
        response = _client(CANDIDATE).get(
            f"/api/web/sessions/{sid}/coding/submissions/sub-nope"
        )
        assert response.status_code == 200
        assert response.json()["status"] == "FAILED"


# ── the invite that sets it ───────────────────────────────────────────────────


class TestAnInviteCannotSendSomebodyElsesProblem:
    def _invite(self, client: TestClient, ids, problem=None, fake_store=None):
        if problem is not None and fake_store is not None:
            _run(fake_store.coding_problems.put(problem))
        return client.post(
            "/api/web/invites",
            json={
                "mode": "coding",
                "role": "Backend Engineer",
                "candidates": [{"name": "Ada", "email": "ada@example.test"}],
                "codingProblemIds": ids,
            },
        )

    def test_coding_requires_at_least_one_problem(self, fake_store) -> None:
        response = self._invite(_client(RECRUITER), [])
        assert response.status_code == 400
        assert "coding problem" in response.text.lower()

    def test_another_recruiters_problem_answers_404_not_403(self, fake_store) -> None:
        """403 would confirm it exists. A problem carries its hidden tests."""
        response = self._invite(
            _client(RECRUITER),
            ["cp-rival"],
            problem=_problem("cp-rival", owner=OTHER_RECRUITER.uid),
            fake_store=fake_store,
        )
        assert response.status_code == 404
        assert HIDDEN_OUT not in response.text

    def test_an_unready_problem_is_refused_and_named(self, fake_store) -> None:
        """Readiness is enforced at USE, because authoring passes through
        incomplete states — and the recruiter is told WHICH problem to fix."""
        response = self._invite(
            _client(RECRUITER),
            ["cp-draft"],
            problem=_problem("cp-draft", ready=False),
            fake_store=fake_store,
        )
        assert response.status_code == 400
        assert "Two Sum" in response.text
        assert "sample" in response.text.lower()

    def test_a_missing_problem_answers_404(self, fake_store) -> None:
        assert self._invite(_client(RECRUITER), ["cp-ghost"]).status_code == 404

    def test_too_many_problems_is_refused(self, fake_store) -> None:
        """Bounded so a malformed request cannot make a session document resolve
        fifty problems, each with its full test suite, inline."""
        for i in range(7):
            _run(fake_store.coding_problems.put(_problem(f"cp-{i}")))
        response = self._invite(_client(RECRUITER), [f"cp-{i}" for i in range(7)])
        assert response.status_code == 400
        assert "at most" in response.text.lower()

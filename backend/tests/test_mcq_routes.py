"""The shared MCQ candidate surface — `/api/interviews/{id}/mcq`.

MCQ was web-only, and not by choice: its runtime lived inside `web_sessions` with the
resolved paper — answer key included — so a second client could not reach it without
reaching into the other surface. These routes are the runtime, moved.

What these tests protect, in order of how badly each would hurt:

1. **The answer key never leaves.** Asserted on the RESPONSE BYTES, not on a projected
   dict, because bytes are what would reach somebody.
2. **Only the assigned candidate may sit it.** And the owning recruiter, so they can
   preview their own assessment end to end.
3. **A candidate cannot lose their work.** Autosave merges; submit carries the last
   answers with it; a paper is scored once.
4. **The score lands where every other track's does** — `interviews.result` for the
   flat summary the Dart model reads, `reports/{id}` for the detail.

Firestore is faked at the module seam (`app.mcq.sets_collection`,
`app.mcq.attempts_collection`, `app.interviews.collection`, `app.reports.collection`)
rather than mocked per-call, so route → runtime → store runs for real.
"""

from __future__ import annotations

import os

os.environ.setdefault("DRY_RUN", "true")
os.environ.setdefault("API_KEY", "")

import json  # noqa: E402
from datetime import datetime, timedelta  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import interviews, mcq, mcq_runtime, reports  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.security import AuthedUser, require_firebase_user  # noqa: E402
from tests.mcq_paper_cases import PAPER  # noqa: E402

CANDIDATE = AuthedUser(uid="cand-1", email="Ada@Example.test", claims={})
RECRUITER = AuthedUser(uid="uid-recruiter", email="grace@acme.test", claims={})
STRANGER = AuthedUser(uid="who-1", email="nobody@example.test", claims={})

INTERVIEW_ID = "int-mcq-1"

INTERVIEW = {
    "recruiterId": "uid-recruiter",
    "candidateEmail": "Ada@Example.test",
    "candidateEmailLower": "ada@example.test",
    "candidateName": "Ada",
    "testId": "test-1",
    "title": "Backend Screening",
    "type": "chat",
    "mode": "mcq",
    "status": "assigned",
    "questions": [],
    "maxAttempts": 1,
    "attemptsUsed": 0,
    "resultPublished": False,
    "screening": {"mcqSetId": "set-fixture-1", "mcqConfig": {"passThreshold": 60}},
}


# ── the smallest Firestore that makes these routes real ───────────────────────


class _Doc:
    def __init__(self, store: dict, doc_id: str) -> None:
        self._store = store
        self.id = doc_id

    @property
    def exists(self) -> bool:
        return self.id in self._store

    def get(self):
        return self

    def to_dict(self):
        value = self._store.get(self.id)
        return dict(value) if value is not None else None

    def set(self, data: dict, merge: bool = False) -> None:
        if merge and self.id in self._store:
            self._store[self.id] = {**self._store[self.id], **data}
        else:
            self._store[self.id] = dict(data)


class _Collection:
    def __init__(self, store: dict) -> None:
        self._store = store

    def document(self, doc_id: str) -> _Doc:
        return _Doc(self._store, doc_id)


@pytest.fixture
def client(monkeypatch):
    app = create_app()
    app.state.settings = Settings(_env_file=None)

    state: dict = {
        "user": CANDIDATE,
        "sets": {"set-fixture-1": json.loads(json.dumps(PAPER))},
        "attempts": {},
        "interviews": {INTERVIEW_ID: dict(INTERVIEW)},
        "reports": {},
    }

    monkeypatch.setattr(mcq, "sets_collection", lambda _s: _Collection(state["sets"]))
    monkeypatch.setattr(
        mcq, "attempts_collection", lambda _s: _Collection(state["attempts"])
    )
    monkeypatch.setattr(
        interviews, "collection", lambda _s: _Collection(state["interviews"])
    )
    monkeypatch.setattr(reports, "collection", lambda _s: _Collection(state["reports"]))
    monkeypatch.setattr(
        interviews,
        "fetch",
        lambda _s, interview_id: interviews.from_document(
            interview_id, state["interviews"][interview_id]
        ),
    )
    app.dependency_overrides[require_firebase_user] = lambda: state["user"]

    test_client = TestClient(app, raise_server_exceptions=False)
    test_client.state = state  # type: ignore[attr-defined]
    return test_client


def paper(client, interview_id: str = INTERVIEW_ID):
    return client.get(f"/api/interviews/{interview_id}/mcq")


def save(client, answers: dict, interview_id: str = INTERVIEW_ID):
    return client.post(
        f"/api/interviews/{interview_id}/mcq/answers", json={"answers": answers}
    )


def submit(client, answers: dict | None = None, interview_id: str = INTERVIEW_ID):
    """Submits. Note the deliberate absence of an implicit "start" here.

    `POST /mcq/submit` refuses an interview whose paper was never opened — an attempt is
    started by GETting the paper, and handing in a paper nobody opened is not a thing
    that can honestly happen. Every test that submits therefore opens first, as a client
    does.
    """
    return client.post(
        f"/api/interviews/{interview_id}/mcq/submit",
        json={} if answers is None else {"answers": answers},
    )


ALL_CORRECT = {
    "q-single": ["b"],
    "q-multi": ["get", "put"],
    "q-code": ["b"],
    "q-match": {"p200": "m-ok", "p404": "m-missing", "p500": "m-broken"},
    "q-unsectioned": ["y"],
}


# ── the answer key ────────────────────────────────────────────────────────────


def test_the_answer_key_is_absent_from_the_served_paper(client) -> None:
    """On the BYTES.

    A dict comparison checks the top level of each question. A key could reach a
    candidate nested inside an option, a section, or a field added last week — and the
    bytes are what actually leave the server.
    """
    response = paper(client)
    assert response.status_code == 200
    body = response.text
    for field in ("correctOptionIds", "correctPairs", "explanation", "internalNote"):
        assert field not in body, f"{field} reached the candidate"


def test_submitting_tells_the_candidate_nothing_about_their_score(client) -> None:
    """`showScoreToCandidate` is off by default, and off means nothing at all.

    A score delivered by a machine with no human in the loop is what the completion
    screen deliberately avoids — the same rule every other track follows.
    """
    paper(client)
    body = submit(client, ALL_CORRECT).json()
    assert body["submitted"] is True
    assert body["result"] is None
    assert "percent" not in response_text(body)
    assert "correctOptionIds" not in response_text(body)


def response_text(body: dict) -> str:
    return json.dumps(body)


def test_a_published_score_still_carries_no_key(client) -> None:
    """Showing somebody their score is not the same as publishing the answers."""
    client.state["interviews"][INTERVIEW_ID]["screening"]["mcqConfig"] = {
        "showScoreToCandidate": True,
        "passThreshold": 60,
    }
    paper(client)
    body = submit(client, ALL_CORRECT).json()
    assert body["result"]["percent"] == 100
    assert "correctOptionIds" not in response_text(body)
    assert "correctPairs" not in response_text(body)


# ── who may sit it ────────────────────────────────────────────────────────────


def test_a_stranger_cannot_open_the_paper(client) -> None:
    client.state["user"] = STRANGER
    assert paper(client).status_code == 403


def test_the_owning_recruiter_may_preview_their_own_assessment(client) -> None:
    """So they can check what a candidate will see, end to end.

    Previewing writes an attempt like any other, which is deliberate: a preview that
    took a different path would not be a preview of anything.
    """
    client.state["user"] = RECRUITER
    assert paper(client).status_code == 200


def test_an_interview_with_no_paper_attached_says_so(client) -> None:
    """409, not 404. The interview exists and the candidate is entitled to it — the
    PAPER is what is missing, and 'no such interview' is both wrong and unactionable."""
    client.state["interviews"][INTERVIEW_ID]["screening"] = {}
    response = paper(client)
    assert response.status_code == 409
    assert "no assessment" in response.json()["detail"]


def test_a_deleted_paper_does_not_score_the_candidate_zero(client) -> None:
    """The recruiter deleted the set after sending it.

    Inventing an empty paper would mark somebody zero on questions that no longer
    exist; refusing at least names the problem to whoever can fix it.
    """
    client.state["sets"].clear()
    response = paper(client)
    assert response.status_code == 409
    assert "no longer available" in response.json()["detail"]


# ── the attempt ───────────────────────────────────────────────────────────────


def test_opening_the_paper_starts_exactly_one_attempt(client) -> None:
    """Idempotent across reloads and devices — the attempt is keyed by the interview,
    so there is nowhere for a second one to live."""
    paper(client)
    paper(client)
    assert list(client.state["attempts"]) == [INTERVIEW_ID]
    assert client.state["attempts"][INTERVIEW_ID]["status"] == "in_progress"


def test_an_attempt_never_holds_the_paper_it_was_sat_from(client) -> None:
    """The web runtime resolved the paper INTO the session, key and all, which is
    exactly what welded MCQ to one surface. An attempt stores only what was chosen."""
    paper(client)
    submit(client, ALL_CORRECT)
    stored = json.dumps(client.state["attempts"][INTERVIEW_ID])
    assert "correctOptionIds" not in stored
    assert "Which is a prime number?" not in stored, "the paper is referenced, not copied"


def test_autosave_merges_rather_than_replaces(client) -> None:
    """Two tabs on the same paper must not erase each other's work, and a client may
    send only what changed."""
    paper(client)
    save(client, {"q-single": ["b"]})
    save(client, {"q-multi": ["get"]})
    stored = client.state["attempts"][INTERVIEW_ID]["answers"]
    assert stored == {"q-single": ["b"], "q-multi": ["get"]}


def test_autosave_drops_what_the_paper_does_not_contain(client) -> None:
    """A client sending an unknown id is a bug, not an answer; storing it would make
    the report unexplainable to the recruiter reading it."""
    paper(client)
    save(client, {"q-single": ["b", "not-an-option"], "q-ghost": ["a"]})
    stored = client.state["attempts"][INTERVIEW_ID]["answers"]
    assert stored == {"q-single": ["b"]}


def test_autosave_before_the_paper_is_opened_is_refused(client) -> None:
    assert save(client, {"q-single": ["b"]}).status_code == 409


def test_the_last_answers_travel_with_the_submit(client) -> None:
    """A candidate who answers the final question and submits at once must not be
    scored without it."""
    paper(client)
    save(client, {"q-single": ["b"]})
    submit(client, {"q-multi": ["get", "put"]})
    stored = client.state["attempts"][INTERVIEW_ID]["answers"]
    assert stored["q-single"] == ["b"]
    assert stored["q-multi"] == ["get", "put"]


def test_a_paper_is_scored_once(client) -> None:
    """Refused rather than rescored. The first submission is the one the candidate
    stood behind, and the result must not depend on how many times a button was
    pressed."""
    paper(client)
    submit(client, ALL_CORRECT)
    second = submit(client, {"q-single": ["a"]})
    assert second.status_code == 409
    assert client.state["interviews"][INTERVIEW_ID]["result"]["overallScore"] == 100


def test_a_submitted_paper_refuses_further_answers(client) -> None:
    paper(client)
    submit(client, ALL_CORRECT)
    response = save(client, {"q-single": ["a"]})
    assert response.status_code == 409
    assert client.state["attempts"][INTERVIEW_ID]["answers"]["q-single"] == ["b"]


# ── where the result lands ────────────────────────────────────────────────────


def test_the_flat_result_is_written_where_the_dart_model_reads_it(client) -> None:
    paper(client)
    submit(client, ALL_CORRECT)
    stored = client.state["interviews"][INTERVIEW_ID]
    assert stored["status"] == "completed"
    result = stored["result"]
    assert result["overallScore"] == 100
    assert result["evaluatedBy"] == "mcq", (
        "nothing generated this number, so a recruiter must not be offered a re-score"
    )
    assert "100%" in result["summary"]
    # Releasing a result to the candidate stays a recruiter action.
    assert stored["resultPublished"] is False


def test_the_detail_lands_in_the_shared_reports_collection(client) -> None:
    """Same collection every other track writes to, so results, analytics and the
    timeline find it where they already look."""
    paper(client)
    submit(client, ALL_CORRECT)
    report = client.state["reports"][INTERVIEW_ID]
    assert report["sessionId"] == INTERVIEW_ID
    assert report["interviewId"] == INTERVIEW_ID
    assert report["track"] == "mcq"
    assert report["recruiterId"] == "uid-recruiter"
    # The per-question detail DOES carry the key — that is what makes a report
    # reviewable, and a report is a recruiter document.
    assert report["mcq"]["questions"][0]["correctOptionIds"] == ["b"]


def test_a_failed_result_write_does_not_lose_the_candidates_work(client, monkeypatch) -> None:
    """The candidate has finished and their answers are stored. Failing the request
    would tell somebody who just handed in a complete paper that it did not go
    through."""

    def _explode(_settings):
        raise RuntimeError("firestore is down")

    monkeypatch.setattr(reports, "collection", _explode)
    paper(client)
    response = submit(client, ALL_CORRECT)
    assert response.status_code == 200
    assert client.state["attempts"][INTERVIEW_ID]["status"] == "submitted"


# ── launch eligibility ────────────────────────────────────────────────────────


# ── the clock ────────────────────────────────────────────────────────────────
# A candidate was shown "15 min" on their interviews screen and then handed a
# paper with no clock on it and no deadline behind it. The duration was decoration.


def test_the_paper_carries_a_clock_taken_from_the_interviews_duration(client) -> None:
    """No `totalSeconds` on the paper, so the interview's own duration is it —
    which is the number the candidate has already been given."""
    client.state["interviews"][INTERVIEW_ID]["durationMinutes"] = 15

    body = paper(client).json()

    assert body["totalSeconds"] == 900
    # Just started, so effectively the whole allowance is left. A range, because
    # the attempt is stamped a moment before this is computed.
    assert 890 <= body["remainingSeconds"] <= 900


def test_the_papers_own_limit_wins_over_the_interviews_duration(client) -> None:
    client.state["interviews"][INTERVIEW_ID]["durationMinutes"] = 15
    client.state["sets"]["set-fixture-1"]["config"] = {"totalSeconds": 300}

    body = paper(client).json()

    assert body["totalSeconds"] == 300
    assert body["remainingSeconds"] <= 300


def test_an_untimed_paper_reports_no_clock_rather_than_zero(client) -> None:
    """Zero would read as "time is up" on the device and hand the paper in
    instantly. Absent means "do not draw a clock"."""
    client.state["interviews"][INTERVIEW_ID].pop("durationMinutes", None)

    body = paper(client).json()

    assert body["totalSeconds"] is None
    assert body["remainingSeconds"] is None


def test_reopening_the_paper_does_not_restart_the_clock(client) -> None:
    """THE ONE THAT MATTERS: the attempt is stamped once, server-side, so closing
    the app and coming back cannot buy more time."""
    client.state["interviews"][INTERVIEW_ID]["durationMinutes"] = 15
    paper(client)

    # Rewind the stored start by ten minutes, as though they opened it then.
    attempt = client.state["attempts"][INTERVIEW_ID]
    started = datetime.fromisoformat(attempt["startedAt"])
    attempt["startedAt"] = (started - timedelta(minutes=10)).isoformat()

    body = paper(client).json()

    assert body["totalSeconds"] == 900
    assert 290 <= body["remainingSeconds"] <= 300, "five minutes left, not fifteen"


def test_a_long_expired_attempt_reports_zero_not_a_negative(client) -> None:
    """The device treats 0 as "time is up" and hands in. A negative would render
    as a nonsense clock, and a wrapped one would look like time remaining."""
    client.state["interviews"][INTERVIEW_ID]["durationMinutes"] = 15
    paper(client)
    attempt = client.state["attempts"][INTERVIEW_ID]
    started = datetime.fromisoformat(attempt["startedAt"])
    attempt["startedAt"] = (started - timedelta(days=2)).isoformat()

    assert paper(client).json()["remainingSeconds"] == 0


def test_an_unparseable_start_stamp_draws_no_clock(client) -> None:
    """Better than a clock nobody can justify: the paper stays open and the
    recruiter's window is still the outer control."""
    client.state["interviews"][INTERVIEW_ID]["durationMinutes"] = 15
    paper(client)
    client.state["attempts"][INTERVIEW_ID]["startedAt"] = "not a date"

    assert paper(client).json()["remainingSeconds"] is None


def test_a_closed_round_cannot_be_opened(client) -> None:
    from datetime import datetime, timedelta, timezone

    # A datetime, not an ISO string: Firestore hands timestamps back as datetimes and
    # `interviews._as_datetime` ignores anything else — a string here would silently
    # make the interview look unexpiring and the test pass for the wrong reason.
    client.state["interviews"][INTERVIEW_ID]["expiresAt"] = datetime.now(
        timezone.utc
    ) - timedelta(days=1)
    assert paper(client).status_code == 409


def test_submitting_is_not_gated_on_the_window(client) -> None:
    """A candidate who was inside the window when they started must be able to hand in
    the paper they just sat. The alternative is destroying their work at the buzzer."""
    from datetime import datetime, timedelta, timezone

    paper(client)
    client.state["interviews"][INTERVIEW_ID]["expiresAt"] = datetime.now(
        timezone.utc
    ) - timedelta(minutes=1)
    assert submit(client, ALL_CORRECT).status_code == 200


def test_a_device_the_recruiter_excluded_is_refused(client) -> None:
    """The same restriction every other track honours — checked here too, or MCQ
    becomes the way around it."""
    client.state["interviews"][INTERVIEW_ID]["allowedDevices"] = ["web"]
    response = client.get(
        f"/api/interviews/{INTERVIEW_ID}/mcq",
        headers={interviews.CLIENT_DEVICE_HEADER: "mobile"},
    )
    assert response.status_code == 409


# ── an assignment written by the Flutter client ───────────────────────────────
#
# The mobile client writes the interview document ITSELF, through
# `interview_repository.dart` — it does not go through `interview_invite.py`. So the
# shape it produces has to be accepted here, or a recruiter can create an MCQ round on
# their phone that no candidate can open.
#
# What it writes, and does not:
#   screening: {mcqSetId}   nested, matching the web
#   roundKind: "mcq"        because `type` cannot express it
#   NO mcqConfig            it has no UI for scoring rules, so defaults must apply


MOBILE_ASSIGNMENT = {
    **{k: v for k, v in INTERVIEW.items() if k != "screening"},
    "roundKind": "mcq",
    "roundOrder": 0,
    "testTitle": "Backend Engineer",
    "screening": {"mcqSetId": "set-fixture-1"},
}


def test_an_assignment_written_by_the_flutter_client_opens(client) -> None:
    client.state["interviews"][INTERVIEW_ID] = dict(MOBILE_ASSIGNMENT)
    response = paper(client)
    assert response.status_code == 200
    body = response.json()
    assert body["questions"], "the paper resolved from the id the phone wrote"
    assert "correctOptionIds" not in response.text


def test_an_assignment_with_no_scoring_rules_falls_back_to_the_defaults(client) -> None:
    """The phone has no UI for `multiRule`, `matchRule` or a pass threshold.

    Absent must mean the documented default rather than an error or a zero — a paper
    assigned from mobile is scored the same way as one assigned from the browser with
    nothing customised.
    """
    client.state["interviews"][INTERVIEW_ID] = dict(MOBILE_ASSIGNMENT)
    paper(client)
    submit(client, ALL_CORRECT)

    scored = client.state["reports"][INTERVIEW_ID]["mcq"]
    assert scored["multiRule"] == "all_or_nothing"
    assert scored["matchRule"] == "partial"
    assert scored["percent"] == 100
    # No threshold was set, so the paper takes no view on pass or fail.
    assert "passed" not in scored
    assert client.state["interviews"][INTERVIEW_ID]["result"]["recommendation"] == "maybe"


def test_a_top_level_paper_id_is_also_accepted(client) -> None:
    """For a document written by hand, by a script, or by an older build.

    Reading only the nested location would strand it — and the failure would look
    like "this interview has no assessment attached", which is a lie.
    """
    client.state["interviews"][INTERVIEW_ID] = {
        **{k: v for k, v in MOBILE_ASSIGNMENT.items() if k != "screening"},
        "mcqSetId": "set-fixture-1",
    }
    assert paper(client).status_code == 200


def test_the_round_window_still_gates_a_mobile_assignment(client) -> None:
    """A round the recruiter ended closes the paper, however it was assigned."""
    from datetime import datetime, timedelta, timezone

    client.state["interviews"][INTERVIEW_ID] = {
        **MOBILE_ASSIGNMENT,
        "expiresAt": datetime.now(timezone.utc) - timedelta(hours=1),
    }
    assert paper(client).status_code == 409


# ── one scorer ────────────────────────────────────────────────────────────────


def test_the_shared_route_and_the_web_route_score_identically(client) -> None:
    """11b.5, asserted rather than assumed."""
    paper(client)
    submit(client, ALL_CORRECT)
    through_the_route = client.state["reports"][INTERVIEW_ID]["mcq"]

    questions = mcq.questions_of(PAPER)
    directly = mcq_runtime.score(
        questions,
        mcq.clean_answers(ALL_CORRECT, questions),
        config={"passThreshold": 60},
        paper=PAPER,
    )
    assert through_the_route == directly

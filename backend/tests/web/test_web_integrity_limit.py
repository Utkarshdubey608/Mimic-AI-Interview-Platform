"""Enforcing the tab-switch limit.

Until now the server COUNTED tab switches and never acted on the recruiter's
configured maximum — its own docstring said "the point is deterrence, not a
silent tally". A candidate could sit on "Recorded 4 of 3 allowed" and keep
interviewing, which makes the limit a decoration rather than a control.

Enforced server-side deliberately. The client already knows the count and could
end the interview itself, but a check that lives in the browser is bypassable by
exactly the candidate it exists to stop.

The care here is in NOT over-enforcing: a session with no configured maximum
must behave exactly as before, and a terminated interview must keep the
candidate's work rather than discard it.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

CANDIDATE = AuthedUser(uid="uid-cand", email="ada@example.test", claims={})


def _client(user: AuthedUser = CANDIDATE) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def _template(**integrity) -> dict:
    base = {"logEvents": True, "detectTabSwitch": True}
    base.update(integrity)
    return {
        "id": "t1", "name": "Screen", "role": "Backend", "track": "chat",
        "questionSource": "fixed",
        "timing": {"prepSeconds": 30, "answerSeconds": 120, "allowSkipPrep": True,
                   "allowEarlySubmit": True, "warningThresholdSeconds": 15},
        "rubric": {"kpis": []}, "integrity": base, "branding": {"companyName": "Acme"},
    }


def _session(**overrides) -> dict:
    s = {
        "id": "s1", "templateId": "t1", "recruiterId": "uid-recruiter", "track": "chat",
        "candidate": {"name": "Ada", "email": "ada@example.test"},
        "status": "in_progress", "startedAt": "2027-01-01T00:00:00+00:00",
        "questions": [{"id": "q0", "text": "Q0", "autoSubmitted": False,
                       "prepStartedAt": "2027-01-01T00:00:00+00:00"}],
        "currentIndex": 0, "createdAt": "2027-01-01T00:00:00+00:00",
        "integrityEvents": [], "tabSwitchCount": 0,
    }
    s.update(overrides)
    return s


@pytest.fixture
def seeded(fake_store):
    fake_store.templates.docs["t1"] = _template(maxTabSwitchWarnings=3)
    fake_store.sessions.docs["s1"] = _session()
    return fake_store


def _switch(client: TestClient):
    return client.post("/api/web/sessions/s1/integrity-event", json={"type": "tab_switch"})


# ── within the limit, nothing changes ─────────────────────────────────────────


def test_switches_up_to_the_limit_do_not_end_the_interview(seeded) -> None:
    client = _client()
    for _ in range(3):
        body = _switch(client).json()
        assert body["terminated"] is False

    assert seeded.sessions.docs["s1"]["status"] == "in_progress"


def test_the_count_and_max_are_still_reported(seeded) -> None:
    body = _switch(_client()).json()
    assert body["tabSwitchWarnings"] == 1
    assert body["maxTabSwitchWarnings"] == 3


# ── past the limit, it ends ───────────────────────────────────────────────────


def test_exceeding_the_limit_ends_the_interview(seeded) -> None:
    client = _client()
    for _ in range(3):
        _switch(client)

    body = _switch(client).json()  # the fourth

    assert body["terminated"] is True
    assert seeded.sessions.docs["s1"]["status"] == "completed"
    assert seeded.sessions.docs["s1"]["completedAt"]


def test_the_candidate_work_is_submitted_not_discarded(seeded) -> None:
    """Someone cut off mid-answer has still answered."""
    seeded.sessions.docs["s1"]["questions"][0]["draft"] = "half an answer"
    client = _client()
    for _ in range(4):
        _switch(client)

    q = seeded.sessions.docs["s1"]["questions"][0]
    assert q["answerText"] == "half an answer"
    assert q["submittedAt"]
    assert q["autoSubmitted"] is True


def test_it_terminates_once_and_stays_terminated(seeded) -> None:
    client = _client()
    for _ in range(6):
        _switch(client)
    assert seeded.sessions.docs["s1"]["status"] == "completed"
    # A late event against a finished session must not raise or re-complete.
    assert _switch(client).status_code == 200


# ── the guard rails ───────────────────────────────────────────────────────────


def test_no_configured_maximum_means_no_termination(seeded) -> None:
    """The previous behaviour, preserved. Counting without a limit is legitimate."""
    seeded.templates.docs["t1"] = _template()  # no maxTabSwitchWarnings
    client = _client()
    for _ in range(12):
        assert _switch(client).json()["terminated"] is False
    assert seeded.sessions.docs["s1"]["status"] == "in_progress"


def test_a_zero_maximum_is_treated_as_unset_not_as_terminate_immediately(seeded) -> None:
    """Otherwise a mis-saved template would end every interview on the first blur."""
    seeded.templates.docs["t1"] = _template(maxTabSwitchWarnings=0)
    assert _switch(_client()).json()["terminated"] is False
    assert seeded.sessions.docs["s1"]["status"] == "in_progress"


def test_other_event_types_never_terminate(seeded) -> None:
    """Paste attempts are logged, not punished with the tab-switch limit."""
    client = _client()
    for _ in range(8):
        r = client.post("/api/web/sessions/s1/integrity-event", json={"type": "paste_blocked"})
        assert r.json()["terminated"] is False
    assert seeded.sessions.docs["s1"]["status"] == "in_progress"


def test_logging_disabled_means_no_counting_and_no_termination(seeded) -> None:
    seeded.templates.docs["t1"] = _template(logEvents=False, maxTabSwitchWarnings=1)
    client = _client()
    for _ in range(5):
        _switch(client)
    assert seeded.sessions.docs["s1"]["status"] == "in_progress"

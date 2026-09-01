"""`POST /api/web/invites` for an essay — the route, not the helpers.

WHY THIS FILE EXISTS. The invite BRIDGE was tested and passed while this ROUTE
raised `NameError: name 'essay_prompts' is not defined` on every essay invite — a
missing import, in a branch no test executed. It reached production and the
recruiter saw "Failed to fetch", because a 500 with no CORS headers is not a
response the browser will even show you.

A helper test that never runs the handler proves the helper. This runs the
handler.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

OWNER = AuthedUser(uid="uid-owner", email="owner@talbotiq.com", claims={})

PROMPT = {
    "title": "Automation and employment",
    "promptMd": "Discuss the effect of automation on employment.",
    "promptType": "discursive",
    "language": "en",
    "minWords": 250,
    "maxWords": 500,
    "timeLimitSeconds": 2400,
}


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


@pytest.fixture
def owner(fake_store) -> TestClient:
    return _client(OWNER)


def _make_prompt(client: TestClient, **over) -> str:
    r = client.post("/api/web/essay/prompts", json={**PROMPT, **over})
    assert r.status_code == 201, r.text
    return r.json()["prompt"]["id"]


def _invite(client: TestClient, **over) -> "object":
    body = {
        "mode": "essay",
        "role": "Software Engineer",
        "candidates": [{"email": "cand@example.test"}],
        "origin": "https://example.test",
        "sendEmails": False,
    }
    body.update(over)
    return client.post("/api/web/invites", json=body)


def test_an_essay_invite_does_not_raise(owner: TestClient) -> None:
    """The regression. A 500 here is the import bug; anything else is a real answer."""
    response = _invite(owner, essayPromptId=_make_prompt(owner))
    assert response.status_code < 500, response.text


def test_an_essay_invite_is_created(owner: TestClient) -> None:
    response = _invite(owner, essayPromptId=_make_prompt(owner))
    assert response.status_code in (200, 201), response.text


def test_essay_is_accepted_as_a_mode(owner: TestClient) -> None:
    """It was refused with "A valid interview mode is required" — MODE_LABELS had
    not been told about it."""
    response = _invite(owner, essayPromptId=_make_prompt(owner))
    assert "valid interview mode" not in response.text


def test_an_essay_invite_needs_no_question_source(owner: TestClient) -> None:
    """Like two-way, MCQ and coding. Omitting `source` must not be an error."""
    response = _invite(owner, essayPromptId=_make_prompt(owner))
    assert "source" not in response.text.lower() or response.status_code < 400


def test_an_essay_invite_without_a_prompt_is_refused_clearly(owner: TestClient) -> None:
    assert _invite(owner).status_code == 400


def test_a_prompt_that_is_not_ready_is_refused_before_sending(owner: TestClient) -> None:
    """Refused at send, not discovered by the candidate after writing."""
    broken = _make_prompt(owner, promptMd="")
    response = _invite(owner, essayPromptId=broken)
    assert response.status_code == 400
    assert "not ready" in response.text


def test_another_recruiters_prompt_cannot_be_used(owner: TestClient, fake_store) -> None:
    """404 rather than 403, so the response does not confirm it exists."""
    rival = _client(AuthedUser(uid="uid-rival", email="rival@example.test", claims={}))
    theirs = _make_prompt(rival)
    assert _invite(owner, essayPromptId=theirs).status_code == 404

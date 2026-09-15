"""`POST /api/web/invites` — the mode/source validation gate itself, at the HTTP layer.

`resolve_question_source` (the deeper mixed/tailor/set count-and-availability
validation) is already thoroughly covered by
`test_interview_invite_resolve_question_source.py`, and `test_web_invites_essay.py`
covers essay's own exemption from the gate. This file closes the remaining gap: the
gate at `routes/invites.py:379-386` itself — that `mixed` is a legitimate source
(not just tolerated one level down), that an unknown source is refused with its exact
message, and that two_way/mcq/coding skip the gate the same way essay already does.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

OWNER = AuthedUser(uid="uid-owner", email="owner@talbotiq.com", claims={})


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


def _invite(client: TestClient, **over) -> "object":
    body = {
        "mode": "chat",
        "role": "Software Engineer",
        "candidates": [{"email": "cand@example.test"}],
        "origin": "https://example.test",
        "sendEmails": False,
    }
    body.update(over)
    return client.post("/api/web/invites", json=body)


def test_tailor_is_accepted_as_a_source(owner: TestClient) -> None:
    response = _invite(owner, source="tailor")
    assert response.status_code in (200, 201), response.text


def test_mixed_is_accepted_as_a_source(owner: TestClient) -> None:
    """The premise this whole feature was built to fix: `mixed` is a real source,
    not just tolerated one layer down in `resolve_question_source`."""
    response = _invite(
        owner,
        source="mixed",
        mixedConfig={"totalQuestions": 8, "fixedQuestionCount": 5, "resumeQuestionCount": 3},
        fixedQuestions=[
            "Explain polymorphism.", "Explain REST.", "What is indexing?",
            "Explain caching.", "Describe a race condition.",
        ],
    )
    assert response.status_code in (200, 201), response.text
    assert "source must be" not in response.text


def test_unknown_source_is_rejected_with_the_exact_message(owner: TestClient) -> None:
    response = _invite(owner, source="bogus")
    assert response.status_code == 400
    assert response.json()["error"] == 'source must be "tailor", "set", or "mixed"'


def test_missing_source_is_rejected_for_a_scripted_mode(owner: TestClient) -> None:
    response = _invite(owner)  # no `source` key at all
    assert response.status_code == 400
    assert "source must be" in response.text


@pytest.mark.parametrize("mode", ["two_way", "mcq", "coding", "essay"])
def test_source_validation_is_skipped_for_modes_with_no_question_source(owner: TestClient, mode: str) -> None:
    """These four modes reference pre-authored content by id, not a scripted
    résumé/set/mixed source — omitting `source` must never trip the source gate,
    whatever else the invite goes on to require (a real set/prompt id, tested
    separately for essay in test_web_invites_essay.py)."""
    response = _invite(owner, mode=mode)
    assert "source must be" not in response.text

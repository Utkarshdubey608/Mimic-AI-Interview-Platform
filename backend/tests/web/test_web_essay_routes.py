"""`/api/web/essay` — the recruiter's authoring routes for Essay Writing.

The property carrying most of the weight is not a happy path. `guidanceMd` is the
recruiter's private note about what a strong answer contains; shown to a
candidate it stops being guidance and becomes a list of the words that score. The
projection is tested next door — what is tested HERE is that the routes actually
use it, since a preview that rendered a display-only copy would defeat the
projection while every projection test still passed.

Ownership is enforced on reads, not only writes, for the same reason: another
recruiter reading the guidance learns to score against a rubric that is not
theirs.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

OWNER = AuthedUser(uid="uid-owner", email="owner@talbotiq.com", claims={})
RIVAL = AuthedUser(uid="uid-rival", email="rival@example.test", claims={})

GUIDANCE = "RECRUITER-GUIDANCE-7c31de"

PROMPT = {
    "title": "Automation and employment",
    "promptMd": "Discuss the effect of automation on employment.",
    "promptType": "discursive",
    "language": "en",
    "minWords": 250,
    "maxWords": 500,
    "timeLimitSeconds": 2400,
    "guidanceMd": GUIDANCE,
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


@pytest.fixture
def rival(fake_store) -> TestClient:
    return _client(RIVAL)


def _create(client: TestClient, **over) -> dict:
    response = client.post("/api/web/essay/prompts", json={**PROMPT, **over})
    assert response.status_code == 201, response.text
    return response.json()


# ── authoring ─────────────────────────────────────────────────────────────────


def test_a_prompt_is_stored_and_its_faults_reported(owner: TestClient) -> None:
    body = _create(owner)
    assert body["prompt"]["id"].startswith("ep-")
    assert body["prompt"]["recruiterId"] == OWNER.uid
    assert body["faults"] == []


def test_a_draft_saves_and_says_what_is_missing(owner: TestClient) -> None:
    """Saving is permissive, using is strict."""
    body = _create(owner, title="", promptMd="")
    assert body["prompt"]["id"]
    assert len(body["faults"]) >= 2


def test_a_prompt_that_nobody_could_satisfy_is_reported(owner: TestClient) -> None:
    body = _create(owner, minWords=600, maxWords=500)
    assert any("minimum" in f.lower() for f in body["faults"])


def test_a_prompt_can_be_replaced(owner: TestClient) -> None:
    created = _create(owner)["prompt"]
    response = owner.put(
        f"/api/web/essay/prompts/{created['id']}", json={**PROMPT, "title": "Renamed"}
    )
    assert response.status_code == 200
    assert response.json()["prompt"]["title"] == "Renamed"


def test_replacing_does_not_rewrite_when_it_was_created(owner: TestClient) -> None:
    created = _create(owner)["prompt"]
    again = owner.put(f"/api/web/essay/prompts/{created['id']}", json=PROMPT).json()["prompt"]
    assert again["createdAt"] == created["createdAt"]


def test_a_prompt_can_be_deleted(owner: TestClient) -> None:
    created = _create(owner)["prompt"]
    assert owner.delete(f"/api/web/essay/prompts/{created['id']}").status_code == 200
    assert owner.get(f"/api/web/essay/prompts/{created['id']}").status_code == 404


# ── the guidance must not travel ──────────────────────────────────────────────


def test_the_preview_never_carries_recruiter_guidance(owner: TestClient) -> None:
    created = _create(owner)["prompt"]
    body = owner.get(f"/api/web/essay/prompts/{created['id']}/preview").text
    assert GUIDANCE not in body
    assert "guidanceMd" not in body


def test_the_list_never_carries_recruiter_guidance(owner: TestClient) -> None:
    """Even though every record in this list belongs to the caller: the list is a
    chooser, and a field that never travels cannot leak when the view changes."""
    _create(owner)
    assert GUIDANCE not in owner.get("/api/web/essay/prompts").text


def test_the_owner_can_still_read_their_own_guidance(owner: TestClient) -> None:
    created = _create(owner)["prompt"]
    body = owner.get(f"/api/web/essay/prompts/{created['id']}").json()
    assert body["prompt"]["guidanceMd"] == GUIDANCE


# ── ownership ─────────────────────────────────────────────────────────────────


def test_another_recruiter_cannot_read_a_prompt(owner: TestClient, rival: TestClient) -> None:
    created = _create(owner)["prompt"]
    assert rival.get(f"/api/web/essay/prompts/{created['id']}").status_code == 404


def test_another_recruiter_cannot_preview_a_prompt(owner: TestClient, rival: TestClient) -> None:
    created = _create(owner)["prompt"]
    assert rival.get(f"/api/web/essay/prompts/{created['id']}/preview").status_code == 404


def test_another_recruiter_cannot_replace_a_prompt(owner: TestClient, rival: TestClient) -> None:
    created = _create(owner)["prompt"]
    assert rival.put(f"/api/web/essay/prompts/{created['id']}", json=PROMPT).status_code == 404


def test_another_recruiter_cannot_delete_a_prompt(owner: TestClient, rival: TestClient) -> None:
    created = _create(owner)["prompt"]
    assert rival.delete(f"/api/web/essay/prompts/{created['id']}").status_code == 404


def test_a_recruiter_only_lists_their_own(owner: TestClient, rival: TestClient) -> None:
    _create(owner)
    assert rival.get("/api/web/essay/prompts").json() == []


# ── generation ────────────────────────────────────────────────────────────────


def test_generating_without_a_topic_is_refused(owner: TestClient) -> None:
    assert owner.post("/api/web/essay/prompts/generate", json={}).status_code == 400

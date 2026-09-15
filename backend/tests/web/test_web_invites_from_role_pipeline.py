"""`POST /api/web/invites/from-role-pipeline` — the route, not the service helpers.

`resolve_question_source` (the mixed/tailor/set validation logic) is already
thoroughly covered in isolation by `test_interview_invite_resolve_question_source.py`.
This file exists for the same reason `test_web_invites_essay.py` exists: a helper
being correct proves nothing about the route that calls it — the route has its own
lookups (owned RoleConfig, round-1 kind gate, test/round creation) that no service-level
test exercises.
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


def _make_role_config(client: TestClient, *, rounds: list[dict], role_category: str = "sde") -> str:
    r = client.post(
        "/api/web/role-configs",
        json={"roleCategory": role_category, "displayName": "SDE Pipeline", "rounds": rounds},
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


THREE_CHAT_ROUNDS = [
    {"title": "Screening", "kind": "chat", "config": {"source": "tailor"}},
    {"title": "Technical", "kind": "chat", "config": {"source": "tailor"}},
    {"title": "HR", "kind": "chat", "config": {"source": "tailor"}},
]


def _apply(client: TestClient, role_config_id: str, **over) -> "object":
    body = {
        "roleConfigId": role_config_id,
        "candidates": [{"email": "cand@example.test", "role": "Software Engineer"}],
        "origin": "https://example.test",
        "sendEmails": False,
    }
    body.update(over)
    return client.post("/api/web/invites/from-role-pipeline", json=body)


def test_materialises_every_round_and_invites_round_one_only(owner: TestClient, fake_firestore) -> None:
    rc_id = _make_role_config(owner, rounds=THREE_CHAT_ROUNDS)
    response = _apply(owner, rc_id)
    assert response.status_code in (200, 201), response.text
    data = response.json()
    assert data["roundsCreated"] == 3
    assert len(data["created"]) == 1

    test_id = data["testId"]
    timeline = owner.get(f"/api/web/tests/{test_id}/rounds")
    assert timeline.status_code == 200, timeline.text
    rounds = timeline.json()["rounds"]
    assert len(rounds) == 3
    assert [r["title"] for r in sorted(rounds, key=lambda r: r["order"])] == [
        "Screening", "Technical", "HR",
    ]

    # Only round 1 has anyone assigned — rounds 2/3 are real documents with nobody in them.
    rosters = timeline.json()["rosters"]
    round1_id = next(r["id"] for r in rounds if r["order"] == 0)
    other_round_ids = [r["id"] for r in rounds if r["order"] != 0]
    assert len(rosters.get(round1_id, [])) == 1
    for rid in other_round_ids:
        assert len(rosters.get(rid, [])) == 0

    # The materialised interview itself is stamped with the pipeline's identity.
    docs = list(fake_firestore.collection("interviews").docs.values())
    assert len(docs) == 1
    assert docs[0]["roleCategory"] == "sde"
    assert docs[0]["roleConfigId"] == rc_id
    assert docs[0]["testId"] == test_id
    assert docs[0]["roundId"] == round1_id


def test_round_one_two_way_is_rejected_with_a_clear_message(owner: TestClient) -> None:
    rc_id = _make_role_config(owner, rounds=[
        {"title": "Live screen", "kind": "two_way", "config": {}},
    ])
    response = _apply(owner, rc_id)
    assert response.status_code == 400
    assert "role pipelines cannot" in response.text


def test_another_recruiters_role_config_is_a_404(owner: TestClient, fake_store) -> None:
    """404 rather than 403, so the response does not confirm it exists."""
    rival = _client(AuthedUser(uid="uid-rival", email="rival@example.test", claims={}))
    theirs = _make_role_config(rival, rounds=THREE_CHAT_ROUNDS)
    assert _apply(owner, theirs).status_code == 404


def test_mixed_config_survives_onto_round_ones_interview_doc(owner: TestClient, fake_firestore) -> None:
    rc_id = _make_role_config(owner, rounds=[
        {
            "title": "Screening",
            "kind": "chat",
            "config": {
                "source": "mixed",
                "mixedConfig": {
                    "totalQuestions": 8,
                    "fixedQuestionCount": 5,
                    "resumeQuestionCount": 3,
                },
                "fixedQuestions": [
                    "Explain polymorphism.",
                    "Explain REST.",
                    "What is indexing?",
                    "Explain caching.",
                    "Describe a race condition.",
                ],
            },
        },
    ])
    response = _apply(owner, rc_id)
    assert response.status_code in (200, 201), response.text

    doc = next(iter(fake_firestore.collection("interviews").docs.values()))
    screening = doc.get("screening") or {}
    assert screening.get("source") == "mixed"
    assert screening.get("mixedConfig", {}).get("totalQuestions") == 8
    assert screening.get("mixedConfig", {}).get("fixedQuestionCount") == 5
    assert screening.get("mixedConfig", {}).get("resumeQuestionCount") == 3
    # The fixed portion is seeded onto `questions` immediately — the résumé-adapted
    # portion is appended only once the candidate actually begins.
    assert len(doc.get("questions") or []) == 5


def test_mixed_config_with_mismatched_counts_is_rejected(owner: TestClient) -> None:
    rc_id = _make_role_config(owner, rounds=[
        {
            "title": "Screening",
            "kind": "chat",
            "config": {
                "source": "mixed",
                "mixedConfig": {"totalQuestions": 8, "fixedQuestionCount": 6, "resumeQuestionCount": 3},
                "fixedQuestions": ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"],
            },
        },
    ])
    response = _apply(owner, rc_id)
    assert response.status_code == 400


def test_empty_role_config_id_rejected(owner: TestClient) -> None:
    response = owner.post(
        "/api/web/invites/from-role-pipeline",
        json={"roleConfigId": "", "candidates": [{"email": "a@b.test"}]},
    )
    assert response.status_code == 400


def test_role_config_with_no_rounds_rejected(owner: TestClient) -> None:
    rc_id = _make_role_config(owner, rounds=[])
    assert _apply(owner, rc_id).status_code == 400


def test_no_valid_candidates_rejected(owner: TestClient) -> None:
    rc_id = _make_role_config(owner, rounds=THREE_CHAT_ROUNDS)
    response = _apply(owner, rc_id, candidates=[])
    assert response.status_code == 400

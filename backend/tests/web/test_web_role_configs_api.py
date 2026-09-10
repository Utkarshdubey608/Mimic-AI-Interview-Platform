"""`/api/web/role-configs` — reusable per-role interview pipeline templates.

Owner-scoped exactly like `/mcq-sets`: 404, not 403, on a mismatch. The collection is
shared/unprefixed (`roleConfigs`) — see `app.role_configs` — so these tests exercise
the same Firestore collection a mobile client would read directly.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

OWNER = AuthedUser(uid="owner-uid", email="owner@example.test", claims={})
OTHER = AuthedUser(uid="other-uid", email="other@example.test", claims={})


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def test_categories_lists_known_slugs(authed_client: TestClient) -> None:
    res = authed_client.get("/api/web/role-configs/categories")
    assert res.status_code == 200
    slugs = [c["slug"] for c in res.json()]
    assert "sde" in slugs
    assert slugs[-1] == "other"


def test_create_requires_a_role_category(authed_client: TestClient) -> None:
    res = authed_client.post("/api/web/role-configs", json={"displayName": "No category"})
    assert res.status_code == 400


def test_create_defaults_display_name_from_category(authed_client: TestClient) -> None:
    res = authed_client.post("/api/web/role-configs", json={"roleCategory": "sde"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["displayName"]
    assert body["roleCategory"] == "sde"
    assert body["rounds"] == []
    assert body["recruiterId"]


def test_create_normalises_round_specs(authed_client: TestClient) -> None:
    res = authed_client.post(
        "/api/web/role-configs",
        json={
            "roleCategory": "sde",
            "displayName": "SDE pipeline",
            "rounds": [
                {"title": "Screening", "kind": "chat", "config": {"source": "tailor"}},
                {"title": "Technical", "kind": "video", "config": {"source": "set", "questionSetId": "qs1"}},
            ],
        },
    )
    assert res.status_code == 201, res.text
    rounds = res.json()["rounds"]
    assert [r["order"] for r in rounds] == [0, 1]
    assert rounds[1]["config"]["questionSetId"] == "qs1"


def test_list_is_owner_scoped(authed_client: TestClient) -> None:
    authed_client.post("/api/web/role-configs", json={"roleCategory": "sde", "displayName": "A"})
    authed_client.post("/api/web/role-configs", json={"roleCategory": "consulting", "displayName": "B"})
    res = authed_client.get("/api/web/role-configs")
    assert res.status_code == 200
    names = {c["displayName"] for c in res.json()}
    assert names == {"A", "B"}


def test_get_unknown_id_is_404(authed_client: TestClient) -> None:
    res = authed_client.get("/api/web/role-configs/does-not-exist")
    assert res.status_code == 404


def test_update_cannot_change_role_category(authed_client: TestClient) -> None:
    created = authed_client.post(
        "/api/web/role-configs", json={"roleCategory": "sde", "displayName": "Original"}
    ).json()
    updated = authed_client.put(
        f"/api/web/role-configs/{created['id']}",
        json={"roleCategory": "consulting", "displayName": "Renamed"},
    )
    assert updated.status_code == 200
    assert updated.json()["roleCategory"] == "sde"
    assert updated.json()["displayName"] == "Renamed"


def test_update_rejects_too_many_rounds(authed_client: TestClient) -> None:
    created = authed_client.post(
        "/api/web/role-configs", json={"roleCategory": "sde"}
    ).json()
    too_many = [{"title": f"R{i}", "kind": "chat"} for i in range(25)]
    res = authed_client.put(f"/api/web/role-configs/{created['id']}", json={"rounds": too_many})
    assert res.status_code == 400


def test_duplicate_copies_rounds_with_a_new_id(authed_client: TestClient) -> None:
    created = authed_client.post(
        "/api/web/role-configs",
        json={"roleCategory": "sde", "displayName": "Orig", "rounds": [{"title": "R1", "kind": "chat"}]},
    ).json()
    dup = authed_client.post(f"/api/web/role-configs/{created['id']}/duplicate")
    assert dup.status_code == 201, dup.text
    body = dup.json()
    assert body["id"] != created["id"]
    assert body["displayName"] == "Orig (copy)"
    assert len(body["rounds"]) == 1


def test_delete_is_idempotent(authed_client: TestClient) -> None:
    created = authed_client.post("/api/web/role-configs", json={"roleCategory": "sde"}).json()
    first = authed_client.delete(f"/api/web/role-configs/{created['id']}")
    assert first.status_code == 204
    second = authed_client.delete(f"/api/web/role-configs/{created['id']}")
    assert second.status_code == 204
    assert authed_client.get(f"/api/web/role-configs/{created['id']}").status_code == 404


def test_another_recruiters_pipeline_is_hidden(fake_firestore, fake_store) -> None:
    owner = _client(OWNER)
    other = _client(OTHER)

    created = owner.post("/api/web/role-configs", json={"roleCategory": "sde"}).json()

    assert other.get(f"/api/web/role-configs/{created['id']}").status_code == 404
    assert other.put(f"/api/web/role-configs/{created['id']}", json={"displayName": "hijack"}).status_code == 404
    assert other.get("/api/web/role-configs").json() == []

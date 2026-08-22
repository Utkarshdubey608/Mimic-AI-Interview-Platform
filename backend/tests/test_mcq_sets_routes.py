"""The shared authoring surface — `/api/mcq-sets`.

MCQ authoring lived only under `/api/web/*`, which meant a paper could only be written
in a browser. These routes are the same feature on the shared surface, and the point of
this suite is that they are the SAME feature: the cleaning, the validation and the
completeness rules come from `app/mcq_authoring.py`, so a paper authored on a phone is
byte-for-byte the paper the web would have written from the same body.

What is protected here:

1. **Ownership.** A paper contains the answer key, and `recruiterId` on every route is
   the only thing between a caller and somebody else's assessment.
2. **Saving is permissive, using is strict.** A half-written question saves; a paper
   with one is reported as not ready.
3. **Both surfaces agree.** Asserted by running the same body through both cleaners.
"""

from __future__ import annotations

import os

os.environ.setdefault("DRY_RUN", "true")
os.environ.setdefault("API_KEY", "")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import mcq, mcq_authoring  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.security import AuthedUser, require_firebase_user  # noqa: E402

OWNER = AuthedUser(uid="rec-1", email="grace@acme.test", claims={})
OTHER = AuthedUser(uid="rec-2", email="alan@acme.test", claims={})

GOOD_QUESTION = {
    "text": "Which is prime?",
    "type": "single",
    "options": [{"id": "a", "text": "4"}, {"id": "b", "text": "7"}],
    "correctOptionIds": ["b"],
}


@pytest.fixture
def client(monkeypatch):
    app = create_app()
    app.state.settings = Settings(_env_file=None)

    state: dict = {"user": OWNER, "sets": {}}

    async def _list(_s, *, recruiter_id):
        papers = [p for p in state["sets"].values() if p.get("recruiterId") == recruiter_id]
        return sorted(papers, key=lambda p: str(p.get("name") or "").lower())

    async def _fetch(_s, set_id, *, recruiter_id):
        paper = state["sets"].get(set_id)
        if paper is None or paper.get("recruiterId") != recruiter_id:
            return None
        return dict(paper)

    async def _save(_s, paper):
        state["sets"][paper["id"]] = dict(paper)
        return paper

    async def _delete(_s, set_id):
        state["sets"].pop(set_id, None)

    monkeypatch.setattr(mcq, "list_sets", _list)
    monkeypatch.setattr(mcq, "fetch_set", _fetch)
    monkeypatch.setattr(mcq, "save_set", _save)
    monkeypatch.setattr(mcq, "delete_set", _delete)
    app.dependency_overrides[require_firebase_user] = lambda: state["user"]

    test_client = TestClient(app, raise_server_exceptions=False)
    test_client.state = state  # type: ignore[attr-defined]
    return test_client


def create(client, **overrides):
    body = {"name": "Backend Screening", "questions": [dict(GOOD_QUESTION)]}
    body.update(overrides)
    return client.post("/api/mcq-sets", json=body)


# ── ownership ─────────────────────────────────────────────────────────────────


def test_the_owner_is_stamped_from_the_token_not_the_body(client) -> None:
    """A client that could set this could write into another recruiter's papers."""
    body = client.post(
        "/api/mcq-sets",
        json={"name": "P", "recruiterId": "rec-2", "questions": [dict(GOOD_QUESTION)]},
    ).json()
    assert client.state["sets"][body["id"]]["recruiterId"] == "rec-1"


def test_another_recruiters_paper_is_a_404_not_a_403(client) -> None:
    """A 403 confirms the paper exists, which is itself information about somebody
    else's work — and the thing it contains is an answer key."""
    set_id = create(client).json()["id"]
    client.state["user"] = OTHER

    assert client.get(f"/api/mcq-sets/{set_id}").status_code == 404
    assert client.put(f"/api/mcq-sets/{set_id}", json={"name": "Mine now"}).status_code == 404
    assert client.delete(f"/api/mcq-sets/{set_id}").status_code == 404
    assert client.post(f"/api/mcq-sets/{set_id}/duplicate").status_code == 404


def test_the_list_holds_only_this_recruiters_papers(client) -> None:
    create(client, name="Mine")
    client.state["user"] = OTHER
    create(client, name="Theirs")

    client.state["user"] = OWNER
    names = [p["name"] for p in client.get("/api/mcq-sets").json()]
    assert names == ["Mine"]


def test_a_body_id_cannot_redirect_an_update_onto_another_paper(client) -> None:
    """Ownership was checked against the PATH. If the body's id won, a save could land
    somewhere the check never looked."""
    mine = create(client, name="Mine").json()["id"]
    client.state["user"] = OTHER
    theirs = create(client, name="Theirs").json()["id"]

    client.state["user"] = OWNER
    client.put(
        f"/api/mcq-sets/{mine}",
        json={"id": theirs, "name": "Overwritten", "questions": [dict(GOOD_QUESTION)]},
    )
    assert client.state["sets"][theirs]["name"] == "Theirs"
    assert client.state["sets"][mine]["name"] == "Overwritten"


# ── saving is permissive, using is strict ─────────────────────────────────────


def test_a_half_written_question_saves_and_is_reported_as_not_ready(client) -> None:
    """Nobody authors a paper through a sequence of individually valid states. The
    editor creates a blank question, and refusing it made the feature unusable from its
    first click."""
    body = create(client, questions=[{"text": "", "options": []}]).json()
    assert body["ready"] is False
    assert body["faults"], "a draft must say what is missing, not merely be refused"


def test_a_complete_paper_is_ready(client) -> None:
    assert create(client).json()["ready"] is True


def test_a_paper_needs_a_name(client) -> None:
    assert create(client, name="").status_code == 400


def test_readiness_is_computed_and_never_stored(client) -> None:
    """Derived so it cannot go stale against the questions it describes."""
    set_id = create(client).json()["id"]
    assert "ready" not in client.state["sets"][set_id]
    assert "faults" not in client.state["sets"][set_id]


def test_an_empty_paper_is_a_draft_rather_than_an_error(client) -> None:
    """A set is created before it is written."""
    body = create(client, questions=[]).json()
    assert body["ready"] is False
    assert body["faults"] == ["The assessment has no questions yet."]


# ── editing ───────────────────────────────────────────────────────────────────


def test_an_update_replaces_rather_than_merges(client) -> None:
    """The editor reads a paper, edits it and saves the whole thing back. A merge would
    silently keep questions the recruiter deleted."""
    set_id = create(client, questions=[dict(GOOD_QUESTION), dict(GOOD_QUESTION)]).json()["id"]
    client.put(
        f"/api/mcq-sets/{set_id}", json={"name": "Trimmed", "questions": [dict(GOOD_QUESTION)]}
    )
    assert len(client.state["sets"][set_id]["questions"]) == 1


def test_an_update_keeps_the_original_creation_time(client) -> None:
    created = create(client).json()
    updated = client.put(
        f"/api/mcq-sets/{created['id']}",
        json={"name": "Renamed", "questions": [dict(GOOD_QUESTION)]},
    ).json()
    assert updated["createdAt"] == created["createdAt"]
    assert updated["id"] == created["id"]


def test_a_duplicate_is_a_new_paper_with_a_new_id(client) -> None:
    """So a working paper is never the thing being experimented on."""
    original = create(client).json()
    copy = client.post(f"/api/mcq-sets/{original['id']}/duplicate").json()
    assert copy["id"] != original["id"]
    assert copy["name"] == "Backend Screening (copy)"
    assert copy["questions"] == original["questions"]
    assert client.state["sets"][original["id"]]["name"] == "Backend Screening"


def test_deleting_removes_it(client) -> None:
    set_id = create(client).json()["id"]
    assert client.delete(f"/api/mcq-sets/{set_id}").status_code == 204
    assert set_id not in client.state["sets"]


# ── the two surfaces agree ────────────────────────────────────────────────────


def test_both_surfaces_clean_a_body_identically(client) -> None:
    """The point of the whole promotion.

    If either surface grew its own cleaner, the same paper would be stored differently
    depending on which client the recruiter used — and the divergence would show up
    later as a question that scores differently, not as an obvious bug.
    """
    from app.web.routes import mcq_sets as web_routes

    body = {
        "name": "Backend Screening",
        "sections": [{"id": "s1", "name": "Aptitude"}],
        "questions": [
            {**GOOD_QUESTION, "sectionId": "s1", "topic": "Numbers", "points": 2},
            {
                "type": "match",
                "text": "Pair them",
                "pairs": [
                    {"promptId": "p1", "left": "200", "matchId": "m1", "right": "OK"},
                    {"promptId": "p2", "left": "404", "matchId": "m2", "right": "Missing"},
                ],
            },
        ],
    }
    shared = mcq_authoring.clean_set(dict(body), recruiter_id="rec-1")
    web = web_routes._clean_set(dict(body), recruiter_id="rec-1")

    # Ids and timestamps are minted per call, so compare everything else. Question ids
    # too — a question authored without one gets a fresh uuid, which is correct and
    # says nothing about whether the two cleaners agree.
    def comparable(doc: dict) -> dict:
        return {
            key: (
                [{k: v for k, v in q.items() if k != "id"} for q in value]
                if key == "questions"
                else value
            )
            for key, value in doc.items()
            if key not in {"id", "createdAt", "updatedAt"}
        }

    assert comparable(shared) == comparable(web)
    assert mcq_authoring.set_faults(shared) == web_routes.set_faults(web)

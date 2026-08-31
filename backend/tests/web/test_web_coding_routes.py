"""`/api/web/coding` — the recruiter's routes.

Two properties carry most of the weight here, and neither is about happy paths.

THE ANSWER KEY MUST NOT LEAK THROUGH A ROUTE that happens to return a problem. The
projection is tested exhaustively next door; what is tested here is that the
routes actually USE it — a list view that returns whole records, or a preview that
renders through a display-only copy of the projection, would each defeat it while
every projection test still passed.

AND WITH NO JUDGE CONFIGURED, NOTHING RUNS. The run and submit routes must refuse,
with a status that says "not set up" rather than "broken", and they must refuse
before touching a judge that is not there.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

OWNER = AuthedUser(uid="uid-owner", email="owner@talbotiq.com", claims={})
RIVAL = AuthedUser(uid="uid-rival", email="rival@example.test", claims={})

HIDDEN_IN = "HIDDEN-INPUT-ce2f1a"
HIDDEN_OUT = "HIDDEN-OUTPUT-9b4d7e"

PROBLEM = {
    "title": "Two Sum",
    "statementMd": "Return the indices of the two numbers adding to target.",
    "constraints": "2 <= n <= 1e5",
    "ioFormat": "One line of integers.",
    "starterCode": {"python": "def solve():\n    pass"},
    "testCases": [
        {"id": "s1", "input": "1 2 3", "expectedOutput": "0 1", "hidden": False, "points": 2},
        {"id": "h1", "input": HIDDEN_IN, "expectedOutput": HIDDEN_OUT, "hidden": True, "points": 8},
    ],
    "difficulty": "medium",
    "tags": ["arrays"],
    "allowedLanguages": ["python"],
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


def _create(client: TestClient, **overrides) -> dict:
    response = client.post("/api/web/coding/problems", json={**PROBLEM, **overrides})
    assert response.status_code == 201, response.text
    return response.json()


# ── authoring ─────────────────────────────────────────────────────────────────


def test_a_problem_is_stored_and_its_faults_reported(owner: TestClient) -> None:
    body = _create(owner)
    assert body["problem"]["id"].startswith("cp-")
    assert body["problem"]["recruiterId"] == OWNER.uid
    assert body["faults"] == []


def test_a_draft_saves_and_says_what_is_missing(owner: TestClient) -> None:
    """Saving is permissive, using is strict. A recruiter mid-draft is not told
    their work is invalid."""
    body = _create(owner, title="", allowedLanguages=[])
    assert len(body["faults"]) >= 2


def test_the_list_view_carries_no_test_cases_at_all(owner: TestClient) -> None:
    """A list has no use for the cases, and returning them would make an
    incidental copy of the answer key in a response nobody needed it in."""
    _create(owner)
    payload = owner.get("/api/web/coding/problems").text

    assert HIDDEN_IN not in payload
    assert HIDDEN_OUT not in payload
    assert "testCases" not in payload
    # The count is useful and harmless.
    assert '"testCount": 2' in payload.replace("'", '"') or "testCount" in payload


def test_the_owner_can_read_the_whole_problem_including_hidden_cases(owner: TestClient) -> None:
    """The owner WROTE the hidden cases. Withholding them from the author would
    make the problem un-editable."""
    problem_id = _create(owner)["problem"]["id"]
    body = owner.get(f"/api/web/coding/problems/{problem_id}").json()
    assert HIDDEN_OUT in str(body)


def test_another_recruiter_cannot_read_it(fake_store) -> None:
    problem_id = _create(_client(OWNER))["problem"]["id"]
    response = _client(RIVAL).get(f"/api/web/coding/problems/{problem_id}")
    assert response.status_code in (403, 404)
    assert HIDDEN_OUT not in response.text


def test_an_update_preserves_when_the_problem_was_written(owner: TestClient) -> None:
    created = _create(owner)["problem"]
    updated = owner.put(
        f"/api/web/coding/problems/{created['id']}", json={**PROBLEM, "title": "Three Sum"}
    ).json()["problem"]
    assert updated["title"] == "Three Sum"
    assert updated["createdAt"] == created["createdAt"]


def test_a_problem_can_be_deleted_by_its_owner(owner: TestClient) -> None:
    problem_id = _create(owner)["problem"]["id"]
    assert owner.delete(f"/api/web/coding/problems/{problem_id}").status_code == 200
    assert owner.get(f"/api/web/coding/problems/{problem_id}").status_code in (403, 404)


# ── the preview is the real projection ────────────────────────────────────────


def test_the_preview_is_exactly_what_a_candidate_would_get(owner: TestClient) -> None:
    """And it renders through the SAME function that will serve candidates. A
    preview that goes through a display-only copy is a preview of something else."""
    problem_id = _create(owner)["problem"]["id"]
    body = owner.get(f"/api/web/coding/problems/{problem_id}/preview").json()
    payload = str(body)

    assert HIDDEN_IN not in payload, "a hidden input reached the preview"
    assert HIDDEN_OUT not in payload, "a hidden expected output reached the preview"
    assert body["problem"]["hiddenTestCount"] == 1
    assert [c["id"] for c in body["problem"]["sampleTests"]] == ["s1"]
    # The sample's expected output IS there — that is what a sample is for.
    assert body["problem"]["sampleTests"][0]["expectedOutput"] == "0 1"


# ── with no judge, nothing runs ───────────────────────────────────────────────


def test_run_refuses_when_execution_is_not_configured(owner: TestClient) -> None:
    """503, because nothing is broken — something is not set up."""
    problem_id = _create(owner)["problem"]["id"]
    response = owner.post(
        f"/api/web/coding/problems/{problem_id}/run",
        json={"source": "print(1)", "languageId": 71},
    )
    assert response.status_code == 503
    assert "not configured" in response.text


def test_submit_refuses_when_execution_is_not_configured(owner: TestClient) -> None:
    problem_id = _create(owner)["problem"]["id"]
    response = owner.post(
        f"/api/web/coding/problems/{problem_id}/submit",
        json={"source": "print(1)", "languageId": 71},
    )
    assert response.status_code == 503


def test_a_submission_without_source_is_refused_before_anything_else(owner: TestClient) -> None:
    problem_id = _create(owner)["problem"]["id"]
    assert owner.post(f"/api/web/coding/problems/{problem_id}/run", json={}).status_code == 400


def test_a_submission_without_a_language_is_refused(owner: TestClient) -> None:
    problem_id = _create(owner)["problem"]["id"]
    response = owner.post(
        f"/api/web/coding/problems/{problem_id}/run", json={"source": "print(1)"}
    )
    assert response.status_code == 400
    assert "languageId" in response.text


# ── polling ───────────────────────────────────────────────────────────────────


def test_an_unknown_submission_reports_failed_with_a_200(owner: TestClient) -> None:
    """Not a 404. The client polls this for the length of a run, and a 404 reads as
    a transient fault it should retry forever. The same decision voice_jobs made."""
    response = owner.get("/api/web/coding/submissions/sub-nope")
    assert response.status_code == 200
    assert response.json()["status"] == "FAILED"


# ── structured import, which is the lawful path ───────────────────────────────


def test_a_bundle_imports_and_reports_per_entry(owner: TestClient) -> None:
    """One malformed entry must not discard the rest, and the recruiter needs to
    know which one to fix."""
    response = owner.post(
        "/api/web/coding/problems/import",
        json={"problems": [PROBLEM, {"title": "broken", "testCases": "not a list"}, PROBLEM]},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["imported"]) == 2
    assert len(body["rejected"]) == 1
    assert body["rejected"][0]["index"] == 1


def test_an_empty_bundle_is_refused(owner: TestClient) -> None:
    assert owner.post("/api/web/coding/problems/import", json={"problems": []}).status_code == 400


def test_an_oversized_bundle_is_refused(owner: TestClient) -> None:
    response = owner.post(
        "/api/web/coding/problems/import", json={"problems": [PROBLEM] * 51}
    )
    assert response.status_code == 413


def test_an_import_reports_the_keys_it_ignored(owner: TestClient) -> None:
    """The regression this exists for: a bundle using `expected` instead of
    `expectedOutput` imported with zero rejections, stored two empty expectations,
    and then graded a correct solution zero. Importing must say what it dropped."""
    response = owner.post(
        "/api/web/coding/problems/import",
        json={
            "problems": [
                {
                    "title": "Two Sum",
                    "statementMd": "x",
                    "allowedLanguages": ["python"],
                    "testCases": [
                        {"input": "2 7\n9", "expected": "0 1", "hidden": False, "points": 1}
                    ],
                }
            ]
        },
    )
    assert response.status_code == 200
    entry = response.json()["imported"][0]
    # It now WORKS: the value was understood and stored, so the problem is usable.
    assert entry["faults"] == []
    # And the author is told the canonical spelling rather than left guessing.
    assert any("expectedOutput" in r for r in entry["renamed"])
    assert entry["ignored"] == []


def test_an_import_still_reports_a_key_nothing_can_be_made_of(owner: TestClient) -> None:
    response = owner.post(
        "/api/web/coding/problems/import",
        json={"problems": [{**PROBLEM, "difficultly": "easy"}]},
    )
    assert response.status_code == 200
    assert "difficultly" in response.json()["imported"][0]["ignored"]

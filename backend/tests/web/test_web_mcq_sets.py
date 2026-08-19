"""MCQ sets: owner isolation, and validation that refuses rather than repairs.

Two groups matter more than the CRUD:

`TestOwnerIsolation` — MCQ sets hold answer keys, so unlike the shared
`question_sets` collection they are scoped to the recruiter who authored them. If
that ever regresses, every recruiter on the deployment can read every
assessment's key.

`TestValidationRefusesRatherThanRepairs` — a question with one option, or with
nothing marked correct, scores every candidate zero. Refusing it at save time is
the difference between a recruiter fixing a typo and a cohort of candidates
sitting a broken paper.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

RECRUITER = AuthedUser(uid="uid-rec-1", email="rec1@example.test", claims={})
OTHER = AuthedUser(uid="uid-rec-2", email="rec2@example.test", claims={})


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def _question(text="What does EC2 stand for?", key=("a",), options=None, **extra) -> dict:
    q = {
        "text": text,
        "options": options
        or [
            {"id": "a", "text": "Elastic Compute Cloud"},
            {"id": "b", "text": "Elastic Container Cloud"},
            {"id": "c", "text": "Encrypted Compute Cluster"},
        ],
        "correctOptionIds": list(key),
    }
    q.update(extra)
    return q


_DEFAULT = object()


def _body(name="AWS basics", questions=_DEFAULT) -> dict:
    """`questions=[]` must mean an EMPTY set, not "use the default".

    A `questions or [...]` default made the empty-set test silently send one
    question and pass for the wrong reason — the route had been right all along.
    """
    if questions is _DEFAULT:
        questions = [_question()]
    return {"name": name, "questions": questions}


class TestCrud:
    def test_a_set_is_created_and_listed(self, fake_store) -> None:
        client = _client(RECRUITER)
        created = client.post("/api/web/mcq-sets", json=_body()).json()
        assert created["kind"] == "mcq"
        assert created["questions"][0]["type"] == "single"

        listed = client.get("/api/web/mcq-sets").json()
        assert [s["id"] for s in listed] == [created["id"]]

    def test_the_recruiter_id_is_stamped_not_taken_from_the_body(self, fake_store) -> None:
        """A client that could set this could write into someone else's sets."""
        body = _body()
        body["recruiterId"] = OTHER.uid
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=body).json()
        assert created["recruiterId"] == RECRUITER.uid

    def test_question_order_is_preserved_because_it_is_the_paper_order(self, fake_store) -> None:
        questions = [_question(text=f"Q{i}") for i in range(4)]
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=questions)).json()
        assert [q["text"] for q in created["questions"]] == ["Q0", "Q1", "Q2", "Q3"]

    def test_an_update_keeps_the_id_and_the_created_stamp(self, fake_store) -> None:
        client = _client(RECRUITER)
        created = client.post("/api/web/mcq-sets", json=_body()).json()
        updated = client.put(
            f"/api/web/mcq-sets/{created['id']}", json=_body(name="AWS basics v2")
        ).json()
        assert updated["id"] == created["id"]
        assert updated["createdAt"] == created["createdAt"]
        assert updated["name"] == "AWS basics v2"

    def test_duplicate_makes_an_independent_copy(self, fake_store) -> None:
        """So a working paper is never the thing being experimented on."""
        client = _client(RECRUITER)
        created = client.post("/api/web/mcq-sets", json=_body()).json()
        copy = client.post(f"/api/web/mcq-sets/{created['id']}/duplicate").json()
        assert copy["id"] != created["id"]
        assert copy["name"] == "AWS basics (copy)"
        assert len(client.get("/api/web/mcq-sets").json()) == 2

    def test_delete_removes_it(self, fake_store) -> None:
        client = _client(RECRUITER)
        created = client.post("/api/web/mcq-sets", json=_body()).json()
        assert client.delete(f"/api/web/mcq-sets/{created['id']}").status_code == 204
        assert client.get("/api/web/mcq-sets").json() == []

    def test_a_token_is_required(self, fake_store) -> None:
        assert TestClient(create_app()).get("/api/web/mcq-sets").status_code == 401


class TestOwnerIsolation:
    """MCQ sets hold answer keys. This is the property that keeps them private."""

    def test_another_recruiters_set_is_not_listed(self, fake_store) -> None:
        _client(RECRUITER).post("/api/web/mcq-sets", json=_body())
        assert _client(OTHER).get("/api/web/mcq-sets").json() == []

    def test_another_recruiters_set_cannot_be_read(self, fake_store) -> None:
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body()).json()
        assert _client(OTHER).get(f"/api/web/mcq-sets/{created['id']}").status_code == 404

    def test_it_is_404_not_403_so_existence_is_not_confirmed(self, fake_store) -> None:
        """A 403 would tell one recruiter that another's set exists."""
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body()).json()
        response = _client(OTHER).get(f"/api/web/mcq-sets/{created['id']}")
        assert response.status_code == 404
        assert "EC2" not in response.text  # and nothing of the paper leaks in the body

    def test_another_recruiter_cannot_overwrite_it(self, fake_store) -> None:
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body()).json()
        assert (
            _client(OTHER).put(f"/api/web/mcq-sets/{created['id']}", json=_body()).status_code
            == 404
        )

    def test_another_recruiter_cannot_delete_it(self, fake_store) -> None:
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body()).json()
        assert _client(OTHER).delete(f"/api/web/mcq-sets/{created['id']}").status_code == 404

    def test_another_recruiter_cannot_duplicate_it_to_read_the_key(self, fake_store) -> None:
        """Duplication would otherwise be a read primitive for someone else's key."""
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body()).json()
        assert (
            _client(OTHER).post(f"/api/web/mcq-sets/{created['id']}/duplicate").status_code == 404
        )


class TestValidationRefusesRatherThanRepairs:
    def test_a_question_needs_two_options(self, fake_store) -> None:
        one = _question(options=[{"id": "a", "text": "Only"}])
        r = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[one]))
        assert r.status_code == 400
        assert "two options" in r.json()["detail"]

    def test_a_question_needs_a_correct_answer_marked(self, fake_store) -> None:
        r = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[_question(key=())]))
        assert r.status_code == 400
        assert "score zero" in r.json()["detail"]

    def test_a_key_naming_an_option_that_does_not_exist_is_refused(self, fake_store) -> None:
        """Otherwise the key silently matches nothing and everyone scores zero."""
        r = _client(RECRUITER).post(
            "/api/web/mcq-sets", json=_body(questions=[_question(key=("zzz",))])
        )
        assert r.status_code == 400

    def test_marking_every_option_correct_is_refused(self, fake_store) -> None:
        """It cannot distinguish anyone, so it is not an assessment question."""
        r = _client(RECRUITER).post(
            "/api/web/mcq-sets", json=_body(questions=[_question(key=("a", "b", "c"))])
        )
        assert r.status_code == 400
        assert "distinguish" in r.json()["detail"]

    def test_duplicate_option_ids_are_refused(self, fake_store) -> None:
        """Two options could both claim to be the right one."""
        dupes = _question(
            options=[{"id": "a", "text": "One"}, {"id": "a", "text": "Two"}, {"id": "b", "text": "Three"}]
        )
        r = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[dupes]))
        assert r.status_code == 400
        assert "same id" in r.json()["detail"]

    def test_an_empty_set_is_refused(self, fake_store) -> None:
        assert _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[])).status_code == 400

    def test_a_nameless_set_is_refused(self, fake_store) -> None:
        assert _client(RECRUITER).post("/api/web/mcq-sets", json=_body(name="  ")).status_code == 400

    def test_the_failing_question_is_named_so_it_can_be_found(self, fake_store) -> None:
        """"Question 3", not "a question" — a 40-item paper is not worth hunting through."""
        questions = [_question(), _question(), _question(key=())]
        r = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=questions))
        assert "Question 3" in r.json()["detail"]

    def test_a_repeated_key_id_does_not_become_a_multi_answer(self, fake_store) -> None:
        created = _client(RECRUITER).post(
            "/api/web/mcq-sets", json=_body(questions=[_question(key=("a", "a"))])
        ).json()
        assert created["questions"][0]["correctOptionIds"] == ["a"]
        assert created["questions"][0]["type"] == "single"


class TestOptionalFields:
    def test_multi_select_is_inferred_from_the_key(self, fake_store) -> None:
        created = _client(RECRUITER).post(
            "/api/web/mcq-sets", json=_body(questions=[_question(key=("a", "b"))])
        ).json()
        assert created["questions"][0]["type"] == "multi"

    def test_topic_points_difficulty_and_explanation_survive(self, fake_store) -> None:
        q = _question(topic="AWS", points=3, difficulty="hard", explanation="It is EC2.")
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[q])).json()
        stored = created["questions"][0]
        assert stored["topic"] == "AWS"
        assert stored["points"] == 3.0
        assert stored["difficulty"] == "hard"
        assert stored["explanation"] == "It is EC2."

    def test_a_nonsense_difficulty_is_dropped_not_stored(self, fake_store) -> None:
        q = _question(difficulty="impossible")
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[q])).json()
        assert "difficulty" not in created["questions"][0]

    @pytest.mark.parametrize("points", [-1, "three", True, None])
    def test_an_unusable_weight_falls_back_to_the_default(self, fake_store, points) -> None:
        q = _question(points=points)
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[q])).json()
        assert "points" not in created["questions"][0]

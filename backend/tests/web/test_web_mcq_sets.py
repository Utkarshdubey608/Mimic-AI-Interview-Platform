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


def _run(coro):
    import asyncio

    return asyncio.new_event_loop().run_until_complete(coro)


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


class TestSavingIsPermissiveBecauseAuthoringIsIncremental:
    """The rule that replaced the one that made this unusable.

    The original contract refused any incomplete question at save. Combined with
    "a set needs at least one question", the editor could not create a set at all:
    it seeded a blank question so the set was not empty, and the server rejected
    the blank question. Every click of "New MCQ set" answered 400.

    Nobody authors a paper through a sequence of individually valid states, so
    saving now accepts drafts and `ready`/`faults` report what is missing.
    """

    def test_a_brand_new_blank_set_can_be_created(self, fake_store) -> None:
        """Exactly what the New MCQ set button sends."""
        blank = {
            "text": "",
            "options": [{"id": "o1", "text": ""}, {"id": "o2", "text": ""}],
            "correctOptionIds": [],
        }
        r = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[blank]))
        assert r.status_code == 201

    def test_an_empty_set_is_a_draft_not_an_error(self, fake_store) -> None:
        r = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[]))
        assert r.status_code == 201
        assert r.json()["ready"] is False

    def test_blank_option_rows_survive_a_save(self, fake_store) -> None:
        """They were being dropped, so a half-written question came back with its
        option rows deleted — vanishing from under the recruiter mid-edit."""
        half = {"text": "What is EC2?", "options": [{"id": "o1", "text": ""}, {"id": "o2", "text": ""}], "correctOptionIds": []}
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[half])).json()
        assert len(created["questions"][0]["options"]) == 2

    def test_a_key_naming_an_option_that_does_not_exist_is_dropped(self, fake_store) -> None:
        """Transient while editing — the option may be about to be typed."""
        created = _client(RECRUITER).post(
            "/api/web/mcq-sets", json=_body(questions=[_question(key=("zzz",))])
        ).json()
        assert created["questions"][0]["correctOptionIds"] == []

    def test_duplicate_option_ids_are_still_refused(self, fake_store) -> None:
        """Not an authoring state — a client bug that makes the key ambiguous."""
        dupes = _question(
            options=[{"id": "a", "text": "One"}, {"id": "a", "text": "Two"}, {"id": "b", "text": "Three"}]
        )
        r = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[dupes]))
        assert r.status_code == 400
        assert "same id" in r.json()["detail"]

    def test_a_nameless_set_is_still_refused(self, fake_store) -> None:
        assert _client(RECRUITER).post("/api/web/mcq-sets", json=_body(name="  ")).status_code == 400


class TestReadinessIsReportedNotEnforced:
    """`ready` and `faults` are what the editor and the wizard read."""

    def test_a_complete_set_is_ready(self, fake_store) -> None:
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body()).json()
        assert created["ready"] is True
        assert created["faults"] == []

    def test_a_question_with_no_text_is_reported(self, fake_store) -> None:
        created = _client(RECRUITER).post(
            "/api/web/mcq-sets", json=_body(questions=[_question(text="  ")])
        ).json()
        assert created["ready"] is False
        assert "no text" in created["faults"][0]

    def test_a_question_with_one_option_is_reported(self, fake_store) -> None:
        one = _question(options=[{"id": "a", "text": "Only"}])
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[one])).json()
        assert "two options" in created["faults"][0]

    def test_a_question_with_no_correct_answer_is_reported(self, fake_store) -> None:
        created = _client(RECRUITER).post(
            "/api/web/mcq-sets", json=_body(questions=[_question(key=())])
        ).json()
        assert "no correct answer" in created["faults"][0]

    def test_marking_every_option_correct_is_reported(self, fake_store) -> None:
        created = _client(RECRUITER).post(
            "/api/web/mcq-sets", json=_body(questions=[_question(key=("a", "b", "c"))])
        ).json()
        assert "distinguish" in created["faults"][0]

    def test_the_faulty_question_is_named_so_it_can_be_found(self, fake_store) -> None:
        """"Question 3", not "a question" — a 40-item paper is not worth hunting."""
        questions = [_question(), _question(), _question(key=())]
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=questions)).json()
        assert "Question 3" in created["faults"][0]

    def test_readiness_is_computed_not_stored(self, fake_store) -> None:
        """So it cannot go stale against the questions it describes."""
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[])).json()
        stored = _run(fake_store.mcq_sets.get(created["id"]))
        assert "ready" not in stored
        assert _client(RECRUITER).get(f"/api/web/mcq-sets/{created['id']}").json()["ready"] is False


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


class TestUsingIsStrictEvenThoughSavingIsNot:
    """The other half of the split, and the half that protects candidates.

    A draft may be saved in any state. It may NOT be sent to a candidate: a
    question with no correct answer scores everyone zero, and a paper with no
    questions is not an assessment.
    """

    def test_an_unready_paper_cannot_be_sent(self, fake_store) -> None:
        created = _client(RECRUITER).post(
            "/api/web/mcq-sets", json=_body(questions=[_question(key=())])
        ).json()
        response = _client(RECRUITER).post(
            "/api/web/invites",
            json={
                "mode": "mcq",
                "role": "Cloud",
                "mcqSetId": created["id"],
                "candidates": [{"email": "ada@example.test", "role": "Cloud"}],
                "origin": "https://example.test",
            },
        )
        assert response.status_code == 400
        assert "not ready to send" in response.json()["detail"]
        # And it names which question, so it can be fixed.
        assert "Question 1" in response.json()["detail"]

    def test_an_empty_paper_cannot_be_sent(self, fake_store) -> None:
        created = _client(RECRUITER).post("/api/web/mcq-sets", json=_body(questions=[])).json()
        response = _client(RECRUITER).post(
            "/api/web/invites",
            json={
                "mode": "mcq",
                "role": "Cloud",
                "mcqSetId": created["id"],
                "candidates": [{"email": "ada@example.test", "role": "Cloud"}],
                "origin": "https://example.test",
            },
        )
        assert response.status_code == 400
        assert "no questions yet" in response.json()["detail"]


class TestSectionsSurviveTheHandOffs:
    """A section label has to cross three boundaries to mean anything.

    Modal to route, route to generator, and generated paper to saved set. Each is
    a place the label can be dropped with nothing failing loudly - the paper still
    saves, the questions are still right, and only the report is quietly poorer.
    The save one had already been broken: `_clean_question` is an allow-list, so
    the labels were discarded the first time a recruiter pressed Save.
    """

    def test_the_route_turns_a_style_and_counts_into_a_split(self, monkeypatch):
        from app.web.services import mcq_gen

        seen = {}

        async def fake_paper(settings, **kwargs):
            seen.update(kwargs)
            return [
                {"id": "q1", "text": "t", "options": [{"id": "a", "text": "a"}],
                 "correctOptionIds": ["a"], "type": "single", "section": "technical"},
            ]

        monkeypatch.setattr(mcq_gen, "generate_paper", fake_paper)
        client = _client(RECRUITER)
        r = client.post(
            "/api/web/mcq-sets/generate",
            json={"role": "Backend Engineer", "topics": ["Caching"],
                  "style": "mix", "technicalCount": 6, "nonTechnicalCount": 4},
        )
        assert r.status_code == 200, r.text
        assert seen["split"] == {"technical": 6, "non_technical": 4}

    def test_a_body_with_no_style_still_makes_the_paper_it_always_made(self, monkeypatch):
        """Every caller written before sections existed keeps working unchanged."""
        from app.web.services import mcq_gen

        seen = {}

        async def fake_paper(settings, **kwargs):
            seen.update(kwargs)
            return [{"id": "q1", "text": "t", "options": [{"id": "a", "text": "a"}],
                     "correctOptionIds": ["a"], "type": "single"}]

        monkeypatch.setattr(mcq_gen, "generate_paper", fake_paper)
        client = _client(RECRUITER)
        r = client.post(
            "/api/web/mcq-sets/generate",
            json={"role": "X", "topics": ["Y"], "count": 7},
        )
        assert r.status_code == 200, r.text
        assert seen["split"] == {"technical": 7}

    def test_the_response_reports_what_was_asked_for_and_what_arrived(self, monkeypatch):
        """A model told "6 and 4" can return 7 and 3. The recruiter about to screen
        people on this paper should be told, not left to count."""
        from app.web.services import mcq_gen

        async def fake_paper(settings, **kwargs):
            return [
                {"id": f"q{i}", "text": "t", "options": [{"id": "a", "text": "a"}],
                 "correctOptionIds": ["a"], "type": "single",
                 "section": "technical" if i < 7 else "non_technical"}
                for i in range(10)
            ]

        monkeypatch.setattr(mcq_gen, "generate_paper", fake_paper)
        client = _client(RECRUITER)
        r = client.post(
            "/api/web/mcq-sets/generate",
            json={"role": "X", "topics": ["Y"], "style": "mix",
                  "technicalCount": 6, "nonTechnicalCount": 4},
        ).json()
        assert r["sections"] == {"technical": 6, "non_technical": 4}
        assert r["delivered"] == {"technical": 7, "non_technical": 3}

    def test_a_section_label_survives_being_saved(self):
        """THE ONE THAT WAS BROKEN. A generated paper looked sectioned in review
        and arrived unsectioned in the set, because the save cleaner named every
        field it kept and nobody had added this one."""
        client = _client(RECRUITER)
        created = client.post(
            "/api/web/mcq-sets",
            json={"name": "Paper", "questions": [_question(section="non_technical")]},
        ).json()
        assert created["questions"][0]["section"] == "non_technical"

        # And on the way back out again, not just in the create response.
        fetched = client.get(f"/api/web/mcq-sets/{created['id']}").json()
        assert fetched["questions"][0]["section"] == "non_technical"

    def test_a_nonsense_section_is_dropped_rather_than_stored(self):
        client = _client(RECRUITER)
        created = client.post(
            "/api/web/mcq-sets",
            json={"name": "Paper", "questions": [_question(section="marketing")]},
        ).json()
        assert "section" not in created["questions"][0]

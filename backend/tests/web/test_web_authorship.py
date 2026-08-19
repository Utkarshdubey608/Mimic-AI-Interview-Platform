"""Authorship is RECORDED on templates and question sets. Visibility is unchanged.

Two halves, and the second matters as much as the first.

`TestAuthorshipIsRecorded` — the author's uid was already known when these
documents were created, and even logged ("template %s created by %s"), and then
discarded. Every template and question set on the deployment is therefore
unattributable. That is what makes the standing ⚠️ decision in routes/templates.py
— whether a company's templates should be private to that company — impossible to
take later: there is nothing to migrate FROM. Recording it costs nothing and keeps
the option open.

`TestVisibilityIsUnchanged` — this change must not quietly become the isolation
decision it exists to enable. Templates and question sets are still listed to
every recruiter exactly as before. If someone later flips that deliberately, these
tests are the ones that should fail and force the conversation.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

AUTHOR = AuthedUser(uid="uid-author", email="author@example.test", claims={})
OTHER = AuthedUser(uid="uid-other", email="other@example.test", claims={})


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


class TestAuthorshipIsRecorded:
    def test_a_template_records_its_author(self, fake_store) -> None:
        created = _client(AUTHOR).post("/api/web/templates", json={"name": "Backend screen"}).json()
        assert created["recruiterId"] == AUTHOR.uid

    def test_a_question_set_records_its_author(self, fake_store) -> None:
        created = _client(AUTHOR).post("/api/web/question-sets", json={"name": "SQL"}).json()
        assert created["recruiterId"] == AUTHOR.uid

    def test_a_duplicated_set_is_authored_by_whoever_copied_it(self, fake_store) -> None:
        author = _client(AUTHOR)
        original = author.post("/api/web/question-sets", json={"name": "SQL"}).json()
        copy = _client(OTHER).post(f"/api/web/question-sets/{original['id']}/duplicate").json()
        assert copy["recruiterId"] == OTHER.uid


class TestAuthorshipCannotBeClaimedOrTransferred:
    def test_a_template_body_cannot_set_the_author(self, fake_store) -> None:
        body = {"name": "Backend screen", "recruiterId": OTHER.uid}
        created = _client(AUTHOR).post("/api/web/templates", json=body).json()
        assert created["recruiterId"] == AUTHOR.uid

    def test_editing_a_template_does_not_transfer_it(self, fake_store) -> None:
        """The update route merges the body over the stored copy, so without
        re-pinning, an editor could hand someone else's template to themselves."""
        created = _client(AUTHOR).post("/api/web/templates", json={"name": "Backend"}).json()
        edited = _client(OTHER).put(
            f"/api/web/templates/{created['id']}",
            json={**created, "name": "Backend v2", "recruiterId": OTHER.uid},
        ).json()
        assert edited["recruiterId"] == AUTHOR.uid
        assert edited["name"] == "Backend v2"  # the edit itself still applies

    def test_editing_a_legacy_template_does_not_invent_an_author(self, fake_store) -> None:
        """A document created before this change stays unattributed.

        Stamping the editor would be inventing attribution rather than recording
        it, and would quietly assert that whoever last touched a shared template
        owns it.
        """
        import asyncio

        legacy = {"id": "legacy-1", "name": "Legacy", "track": "chat", "createdAt": "2026-01-01"}
        asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
            fake_store.templates.put(legacy)
        )
        edited = _client(OTHER).put(
            "/api/web/templates/legacy-1", json={**legacy, "name": "Legacy v2"}
        ).json()
        assert "recruiterId" not in edited


class TestVisibilityIsUnchanged:
    """Recording an author is not the isolation decision. It must not become it."""

    def test_templates_are_still_listed_to_every_recruiter(self, fake_store) -> None:
        _client(AUTHOR).post("/api/web/templates", json={"name": "Backend screen"})
        listed = _client(OTHER).get("/api/web/templates").json()
        assert [t["name"] for t in listed] == ["Backend screen"]

    def test_question_sets_are_still_listed_to_every_recruiter(self, fake_store) -> None:
        _client(AUTHOR).post("/api/web/question-sets", json={"name": "SQL"})
        listed = _client(OTHER).get("/api/web/question-sets").json()
        assert [s["name"] for s in listed] == ["SQL"]

    def test_another_recruiter_can_still_read_one_directly(self, fake_store) -> None:
        created = _client(AUTHOR).post("/api/web/templates", json={"name": "Backend"}).json()
        assert _client(OTHER).get(f"/api/web/templates/{created['id']}").status_code == 200

    def test_mcq_sets_are_the_exception_and_stay_private(self, fake_store) -> None:
        """The contrast worth keeping visible: MCQ sets hold answer keys, so they
        were built owner-scoped from the start rather than shared."""
        body = {
            "name": "AWS",
            "questions": [
                {
                    "text": "What is EC2?",
                    "options": [{"id": "a", "text": "Compute"}, {"id": "b", "text": "Storage"}],
                    "correctOptionIds": ["a"],
                }
            ],
        }
        _client(AUTHOR).post("/api/web/mcq-sets", json=body)
        assert _client(OTHER).get("/api/web/mcq-sets").json() == []

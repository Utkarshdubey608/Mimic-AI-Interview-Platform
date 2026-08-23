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


def _client(user: AuthedUser, *, settings=None) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    if settings is not None:
        # `company_scoping_enabled` is a pydantic FIELD, not a class attribute, so it
        # cannot be monkeypatched onto Settings — the instance is what has to change.
        app.state.settings = settings
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


class TestVisibilityIsScopedToTheCompany:
    """The decision the ⚠️ in routes/templates.py was holding open, now taken.

    This class used to be `TestVisibilityIsUnchanged`, and it asserted the opposite:
    that templates and question sets stay listed to every recruiter on the deployment.
    Its own docstring said "if someone later flips that deliberately, these tests are
    the ones that should fail and force the conversation" — which is exactly what
    happened, so the conversation is recorded here instead.

    On the Express server "shared across recruiters" meant one company's recruiters. On
    a common backend it meant everyone, which is a cross-company leak nobody would
    notice. It is now scoped by `companyKey`, with the author always keeping their own.
    """

    @staticmethod
    def _with_company(fake_firestore, uid: str, key: str) -> None:
        fake_firestore.collection("users").docs[uid] = {
            "companyKey": key,
            "company": key.title(),
            "role": "recruiter",
        }

    def test_colleagues_in_one_company_share(self, fake_store, fake_firestore) -> None:
        """The behaviour that must SURVIVE the scoping.

        Recruiters in a company reusing each other's work is the deliberate product
        choice; the leak was that it extended past the company.
        """
        self._with_company(fake_firestore, AUTHOR.uid, "acme")
        self._with_company(fake_firestore, OTHER.uid, "acme")

        _client(AUTHOR).post("/api/web/templates", json={"name": "Backend screen"})
        listed = _client(OTHER).get("/api/web/templates").json()
        assert [t["name"] for t in listed] == ["Backend screen"]

    def test_a_different_company_sees_nothing(self, fake_store, fake_firestore) -> None:
        """The leak this closes."""
        self._with_company(fake_firestore, AUTHOR.uid, "acme")
        self._with_company(fake_firestore, OTHER.uid, "globex")

        _client(AUTHOR).post("/api/web/templates", json={"name": "Backend screen"})
        assert _client(OTHER).get("/api/web/templates").json() == []

    def test_question_sets_are_scoped_the_same_way(
        self, fake_store, fake_firestore
    ) -> None:
        self._with_company(fake_firestore, AUTHOR.uid, "acme")
        self._with_company(fake_firestore, OTHER.uid, "globex")

        _client(AUTHOR).post("/api/web/question-sets", json={"name": "SQL"})
        assert _client(OTHER).get("/api/web/question-sets").json() == []

    def test_an_author_always_keeps_their_own(self, fake_store, fake_firestore) -> None:
        """Even with no company recorded — which is every account created on the
        Flutter app, and every account that predates the field.

        Keying visibility on the company ALONE loses a recruiter their own work here,
        which is the subtle version of this bug and the reason `visible_to` checks the
        author first.
        """
        created = _client(AUTHOR).post(
            "/api/web/templates", json={"name": "Mine"}
        ).json()

        listed = _client(AUTHOR).get("/api/web/templates").json()
        assert [t["id"] for t in listed] == [created["id"]]

    def test_a_company_less_recruiter_sees_only_their_own(
        self, fake_store, fake_firestore
    ) -> None:
        """Two unknowns are NOT a match.

        Treating them as one would pool every company-less account into a single
        shared bucket, which is precisely the leak `company_key` exists to prevent —
        and it returns "" for a missing name so a caller cannot build that query by
        accident.
        """
        _client(AUTHOR).post("/api/web/templates", json={"name": "Author's"})
        _client(OTHER).post("/api/web/templates", json={"name": "Other's"})

        assert [t["name"] for t in _client(OTHER).get("/api/web/templates").json()] == [
            "Other's"
        ]

    def test_a_blank_company_key_is_never_written(
        self, fake_store, fake_firestore
    ) -> None:
        """An empty key stored as a VALUE would become the shared bucket itself."""
        created = _client(AUTHOR).post(
            "/api/web/templates", json={"name": "No company"}
        ).json()
        stored = fake_store.templates.docs[created["id"]]
        assert "companyKey" not in stored

    def test_the_kill_switch_restores_the_old_behaviour(
        self, fake_store, fake_firestore
    ) -> None:
        """Turning scoping off is a config change, not a deploy of reverted code.

        The switch exists because this is a VISIBLE regression — people see a shorter
        list than they did yesterday — so the rollback has to be faster than a release.
        """
        self._with_company(fake_firestore, AUTHOR.uid, "acme")
        self._with_company(fake_firestore, OTHER.uid, "globex")
        _client(AUTHOR).post("/api/web/templates", json={"name": "Backend screen"})

        from app.config import Settings

        off = Settings(company_scoping_enabled=False)
        listed = _client(OTHER, settings=off).get("/api/web/templates").json()
        assert [t["name"] for t in listed] == ["Backend screen"]

    def test_a_direct_read_by_id_is_deliberately_not_scoped(
        self, fake_store, fake_firestore
    ) -> None:
        """A KNOWN boundary, recorded rather than left to be discovered.

        The LIST is the exposure — it enumerates every document on the deployment. A
        direct read needs an unguessable uuid4, and scoping it would break any session
        whose `templateId` points at a template outside the caller's company, which
        legacy sessions legitimately do (see the note in routes/analytics.py). Closing
        this needs the session/template relationship audited first.
        """
        self._with_company(fake_firestore, AUTHOR.uid, "acme")
        self._with_company(fake_firestore, OTHER.uid, "globex")
        created = _client(AUTHOR).post(
            "/api/web/templates", json={"name": "Backend"}
        ).json()

        assert (
            _client(OTHER).get(f"/api/web/templates/{created['id']}").status_code == 200
        )

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


class TestUnattributableDocumentsSurvive:
    """The regression that would have been worse than the leak.

    Authorship was only recorded recently, so every template and question set created
    before that carries no `recruiterId` AND no `companyKey`. Scoping on company alone
    makes those visible to NOBODY — years of a deployment's work vanishing from every
    screen, with no way to get it back. That reads as data loss, not as a policy change.

    So they stay visible to everyone, exactly as they are today, and the backfill's job
    is to shrink the set rather than to hide it.
    """

    def test_a_document_with_no_author_and_no_company_stays_visible(
        self, fake_store, fake_firestore
    ) -> None:
        fake_store.templates.docs["legacy"] = {
            "id": "legacy",
            "name": "From before authorship",
            "updatedAt": "2026-01-01T00:00:00Z",
        }
        fake_firestore.collection("users").docs[OTHER.uid] = {"companyKey": "globex"}

        listed = _client(OTHER).get("/api/web/templates").json()
        assert [t["id"] for t in listed] == ["legacy"]

    def test_it_is_visible_even_with_no_company_on_either_side(
        self, fake_store, fake_firestore
    ) -> None:
        fake_store.question_sets.docs["legacy"] = {"id": "legacy", "name": "Old set"}
        listed = _client(OTHER).get("/api/web/question-sets").json()
        assert [s["id"] for s in listed] == ["legacy"]

    def test_but_an_authored_document_is_still_scoped(
        self, fake_store, fake_firestore
    ) -> None:
        """The exception is for the UNATTRIBUTABLE, not for the un-keyed.

        A document that names an author is attributable — it belongs to that person,
        and to their company once the backfill has run. Extending the exception to it
        would reopen the leak for every document written since authorship began.
        """
        fake_store.templates.docs["authored"] = {
            "id": "authored",
            "name": "Someone else's",
            "recruiterId": AUTHOR.uid,
            "companyKey": "acme",
        }
        fake_firestore.collection("users").docs[OTHER.uid] = {"companyKey": "globex"}

        assert _client(OTHER).get("/api/web/templates").json() == []

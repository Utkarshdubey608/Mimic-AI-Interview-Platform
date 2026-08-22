"""The web surface's store — the Firestore replacement for `server/store/db.ts`.

Every collection is `web_`-prefixed. That is not decoration: this Firestore
project is shared with the mobile app, which owns `interviews`,
`tests/{id}/rounds/{id}`, `email_templates` and `users`. The prefix guarantees
no clash, makes ownership obvious in the console and in any query, and means the
whole web surface can be dropped by deleting the prefixed collections.

**Two collections from the JSON store deliberately do not appear here.**

`users` — the JSON store only *mirrored* Firestore `users/{uid}`, which both
clients already read for the caller's role (`firebaseAdmin.getUserRole` on web,
`auth_service.dart` on mobile). A mirror of a shared collection is a second
source of truth for the same fact, so it is dropped: read `users/{uid}` directly.

`sessions` is NOT merged into the mobile app's `interviews`. The Express server
materialises a local session from an `interviews/{id}` document the first time
the assigned candidate opens their link (`inviteBridge.ts`), and that behaviour
is preserved exactly. Merging the two models touches the mobile app's frozen
schema and is a separate project.

Security: `firestore.rules` uses explicit per-collection matches with no
catch-all, and Firestore defaults to deny — so these collections are already
unreachable by any client and are written only by the Admin SDK. Do not add a
rule for them.
"""

from __future__ import annotations

import logging
from typing import Any

from app import feedback, mcq, reports, templates_store
from app.config import Settings
from app.firebase import FirestoreUnavailable, get_db
from app.web.store.collections import Collection, SingletonDocument

logger = logging.getLogger("web.store")

# Prefix for every collection this surface owns. Renaming it orphans data.
PREFIX = "web_"


class WebStore:
    """The web surface's collections, in one place.

    Mirrors the shape of `db` in `server/store/db.ts` so ported route code reads
    the same way — `store.templates.get(id)` against `db.templates.get(id)` —
    with the one difference that every access is awaited.
    """

    def __init__(self, client: Any) -> None:
        # ── recruiter-authored configuration ─────────────────────────────────
        self.templates = Collection(client, f"{PREFIX}templates")
        self.question_sets = Collection(client, f"{PREFIX}question_sets")
        # SHARED, deliberately not `web_`-prefixed — see app/templates_store.py.
        #
        # This was `web_invite_email_templates`, so a recruiter's saved invite email
        # was invisible on the other client. The irony was that the RENDERING was
        # already unified against a golden fixture (contracts/invite_email.fixtures.json)
        # while the storage was not.
        #
        # The two clients store different shapes for the same thing, so the routes
        # write a few compatibility fields alongside their own — see
        # `templates_store.compatibility_fields`.
        self.invite_email_templates = Collection(
            client, templates_store.TEMPLATES_COLLECTION
        )
        # MCQ question sets — OWNER-SCOPED, unlike `question_sets` above.
        #
        # A separate collection rather than a `kind` on the existing one, and the
        # reason is the answer key. `templates` and `question_sets` are shared
        # across every recruiter on the deployment (see the ⚠️ note in
        # routes/templates.py): for open-ended questions that is a deliberate
        # product choice — recruiters in a company reuse each other's work. An MCQ
        # set is different in kind, because it CONTAINS THE CORRECT ANSWERS. Shared
        # storage would mean every recruiter on the deployment can read every
        # assessment's key.
        #
        # Adding ownership to the existing shared collections is the change that
        # note says not to make silently — recruiters would stop seeing sets they
        # rely on. A NEW collection avoids that entirely: nothing existing changes
        # behaviour, and the surface that holds answer keys is owner-scoped from
        # its first day, with no migration to run later.
        #
        # `recruiterId` is stamped server-side from the auth token and never taken
        # from the client, matching pipelines and feedback.
        #
        # SHARED, and deliberately not `web_`-prefixed — see app/mcq.py. Dropping the
        # prefix does NOT widen access: ownership was never enforced by the collection
        # name, it is a `recruiterId` filter on every query plus `firestore.rules`
        # denying client reads outright. What the prefix DID do was make the paper
        # unreachable from the other surface, which is why MCQ could not leave the
        # browser.
        self.mcq_sets = Collection(client, mcq.SETS_COLLECTION)

        # ── the interview engine ─────────────────────────────────────────────
        self.sessions = Collection(client, f"{PREFIX}sessions")
        # SHARED, and deliberately NOT `web_`-prefixed — see app/reports.py.
        #
        # A report is the result of one interview, and both clients display reports, so
        # a `web_`-prefixed store made the mobile app structurally unable to show one
        # for an interview taken in a browser (and the web unable to score one taken on
        # a phone). The key field is unchanged: a report is still looked up by the
        # session id, which IS the interview id.
        self.reports = Collection(
            client, reports.REPORTS_COLLECTION, key_field=reports.KEY_FIELD
        )

        # ── multi-round pipelines ────────────────────────────────────────────
        self.pipelines = Collection(client, f"{PREFIX}pipelines")
        self.pipeline_candidates = Collection(client, f"{PREFIX}pipeline_candidates")

        # ── candidate feedback on the interview experience ───────────────────
        # SHARED. Keyed by sessionId like reports: one interview, one verdict, and a
        # resubmission replaces rather than duplicates.
        #
        # This was `web_feedback`, which meant the prompt existed only in the browser —
        # a candidate who interviewed on the phone was never asked, on the one channel
        # the product has for hearing from candidates. See app/feedback.py.
        self.feedback = Collection(
            client, feedback.FEEDBACK_COLLECTION, key_field="sessionId"
        )

        # ── public marketing lead capture (append-only, no lookups) ──────────
        self.leads = Collection(client, f"{PREFIX}leads")

        # ── asynchronous voice-analysis jobs ─────────────────────────────────
        # The Express server held these in process memory, which cannot work
        # across workers — see app/web/services/voice_jobs.py.
        self.voice_jobs = Collection(client, f"{PREFIX}voice_jobs")

        # ── the single settings object ───────────────────────────────────────
        self.settings = SingletonDocument(client, f"{PREFIX}settings")


_store: WebStore | None = None


def get_store(settings: Settings) -> WebStore:
    """The web store, built once.

    Raises `FirestoreUnavailable` when credentials are missing — surfaced as 503
    by the handler in `app.web.errors`, because an unconfigured server is a
    deployment fault and not the caller's problem.
    """
    global _store
    if _store is None:
        _store = WebStore(get_db(settings))
    return _store


def is_ready(settings: Settings) -> tuple[bool, str | None]:
    """Whether the store can be reached, and why not if it cannot.

    Never raises — this backs the health endpoint, which must answer even when
    the thing it is reporting on is broken.
    """
    try:
        get_store(settings)
        return True, None
    except FirestoreUnavailable as exc:
        return False, str(exc)
    except Exception as exc:  # noqa: BLE001 - a health check must never 500
        logger.warning("web store unavailable: %s", type(exc).__name__)
        return False, f"{type(exc).__name__}: {exc}"

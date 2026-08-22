"""Who the caller is — a port of `server/services/users.ts` and `getUserRole`.

The role is NOT decided here. It lives on Firestore `users/{uid}.role`, written by
the user at sign-up and read by three things that must agree: the web client, the
Flutter app (`auth_service.dart`), and this server. Reading the same document is
what keeps them in lock-step.

A missing or unreadable document resolves to `candidate` — least privilege, and
the same default the clients' auth gates use.

⚠️ Because that document is client-writable, a user can self-select the
`recruiter` role at sign-up. That is the agreed interop model with the Flutter
app, not an oversight. The `admin` overlay below is the one thing that stays
server-authoritative and can never be set from a client. To harden the role
itself, move role assignment server-side and tighten `firestore.rules`.

The JSON store's `users` map is deliberately NOT recreated: it only mirrored this
same Firestore document, and a mirror of a shared fact is a second source of
truth for it.
"""

from __future__ import annotations

import asyncio
import logging

from app.config import Settings
from app.firebase import get_db
from app.web.shared import company
from app.security import AuthedUser

logger = logging.getLogger("web.users")

USERS_COLLECTION = "users"

RECRUITER = "recruiter"
CANDIDATE = "candidate"


async def get_role(settings: Settings, uid: str) -> str:
    """The role recorded on `users/{uid}`, defaulting to `candidate`.

    Never raises: an unreachable Firestore must not turn every authenticated
    request into a 500 when the safe answer — least privilege — is available.
    """
    if not uid:
        return CANDIDATE

    def _read() -> str:
        snapshot = get_db(settings).collection(USERS_COLLECTION).document(uid).get()
        if not snapshot.exists:
            return CANDIDATE
        value = (snapshot.to_dict() or {}).get("role")
        return RECRUITER if value == RECRUITER else CANDIDATE

    try:
        return await asyncio.to_thread(_read)
    except Exception as exc:  # noqa: BLE001 - degrade to least privilege, never 500
        logger.warning("could not read role for %s: %s", uid, type(exc).__name__)
        return CANDIDATE


async def get_display_name(settings: Settings, uid: str) -> str | None:
    """The `name` on `users/{uid}`, when the client recorded one.

    Used for the recruiter's display name on an invite. Best-effort by design —
    an invite must not fail because a profile field is missing.
    """
    if not uid:
        return None

    def _read() -> str | None:
        snapshot = get_db(settings).collection(USERS_COLLECTION).document(uid).get()
        if not snapshot.exists:
            return None
        data = snapshot.to_dict() or {}
        value = data.get("name") or data.get("displayName")
        return str(value).strip() or None if value else None

    try:
        return await asyncio.to_thread(_read)
    except Exception as exc:  # noqa: BLE001 - a display name is never worth a 500
        logger.warning("could not read name for %s: %s", uid, type(exc).__name__)
        return None


def admin_emails(settings: Settings) -> set[str]:
    """The server-side admin allowlist, lowercased. Empty disables the overlay."""
    raw = settings.admin_emails or ""
    return {
        part.strip().lower()
        for part in raw.replace("\n", ",").replace(" ", ",").split(",")
        if part.strip()
    }


def is_admin(settings: Settings, *, email: str | None, role: str) -> bool:
    """Is this an admin — a recruiter on the ADMIN_EMAILS allowlist?

    Derived from the token's VERIFIED email and a server-side env var, so a client
    cannot claim it. Requires the recruiter role: the overlay grants a recruiter
    wider visibility, it does not promote a candidate.

    ROLE-GATING: nothing currently ACTS on this — the Express server used it to
    widen a recruiter's session list, and that behaviour is parked with role
    gating. It is still reported by `/auth/me` so the web client's display is
    unchanged.
    """
    if role != RECRUITER:
        return False
    normalised = (email or "").strip().lower()
    return bool(normalised) and normalised in admin_emails(settings)


def email_verified(user: AuthedUser) -> bool:
    """Whether Firebase has verified this address.

    Read from the token's claims, not from any document — a client-writable field
    saying "verified" would mean nothing.
    """
    return user.claims.get("email_verified") is True


async def get_company_key(settings: Settings, uid: str) -> str:
    """The normalised company this recruiter belongs to, or "".

    Empty means "no company recorded" — an account created on the Flutter app, or one
    that predates the field. It is NEVER a wildcard: `company_key` returns "" for a
    missing name precisely so a caller cannot accidentally build a query matching every
    company, and `visible_to` below treats an empty key as "your own documents only".

    Best-effort like the rest of this module. A profile read that fails must not empty a
    recruiter's template list, so it falls back to "" — which is the restrictive
    direction, not the permissive one.
    """
    if not uid:
        return ""

    def _read() -> str:
        snapshot = get_db(settings).collection(USERS_COLLECTION).document(uid).get()
        if not snapshot.exists:
            return ""
        data = snapshot.to_dict() or {}
        # The stored key is authoritative; the display name is only a fallback for a
        # document written before `companyKey` existed alongside `company`.
        stored = data.get("companyKey")
        if isinstance(stored, str) and stored.strip():
            return company.company_key(stored)
        return company.company_key(data.get("company"))

    try:
        return await asyncio.to_thread(_read)
    except Exception as exc:  # noqa: BLE001 - never empty a list over a profile read
        logger.warning(
            "could not read company for %s: %s", uid, type(exc).__name__
        )
        return ""


def visible_to(documents: list[dict], *, company_key: str, uid: str) -> list[dict]:
    """The subset of a shared collection this caller may see.

    **Why this exists.** `web_templates` and `web_question_sets` were read with
    `.all()`, so every recruiter on the deployment saw every other recruiter's
    interview templates and question sets. On the Express server "shared across
    recruiters" meant one company's recruiters; on a common backend it means everyone.

    Three rules, and the last two are what keep this from being a regression that
    loses people their work:

    1. **A document with a `companyKey` is visible to that company.** This is the
       scoping itself.

    2. **A document is always visible to its author.** Whatever else is true, a
       recruiter does not lose their own templates — including when their own profile
       has no company recorded, which is the case for every account created on the
       Flutter app. Keying visibility on the company alone is the subtle version of
       this bug: a recruiter with no `companyKey` would be unable to see documents THEY
       wrote that do have one.

    3. **A document with NEITHER key NOR author is visible to everyone**, exactly as
       it is today. These are real, and they are the majority of what exists: authorship
       was only recorded recently, so every template and question set created before
       that carries no `recruiterId` at all. Hiding them would delete years of a
       deployment's work from every screen with no way to get it back — a far worse
       outcome than the leak this function exists to close, and one that would look
       like data loss rather than a policy change.

       This is the set the backfill exists to shrink. It cannot shrink it to nothing:
       a document with no author cannot be attributed to a company without guessing,
       and guessing wrong here means showing one company another's material.

    Filtered in memory rather than by query, deliberately. Firestore cannot express
    "this field is missing", so rules 2 and 3 are not expressible as a `where`, and an
    equality on "" would match nothing at all. These collections are documented as
    staying small; correctness first.
    """
    visible: list[dict] = []
    for document in documents:
        key = company.company_key(document.get("companyKey"))
        author = str(document.get("recruiterId") or "")

        # Rule 3, checked first because it is unconditional: nothing is known about
        # this document, so nothing can be denied on its basis.
        if not key and not author:
            visible.append(document)
            continue

        # Rule 2 — the author, always. Never lose somebody their own work.
        if uid and author == uid:
            visible.append(document)
            continue

        # Rule 1 — the company.
        if key and company_key and key == company_key:
            visible.append(document)
    return visible

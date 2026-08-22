"""Invite-email templates — ports `server/routes/inviteEmailTemplates.ts`.

**These ARE owner-scoped**, unlike interview templates and question sets. `recruiterId`
is stamped server-side from the verified token and never accepted from the client; the
list is filtered by owner, and a cross-owner read answers 404 rather than 403 so the
response never reveals another recruiter's template exists.

That matters more here than elsewhere: these templates carry a verified sender address
and the wording that goes out under a recruiter's name.

Four kinds share the model — `invite`, `advance`, `selected`, `rejection` — and a
template saved before kinds existed has no `kind` field, which `kind_of` reads as
`invite`.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Query, Request, Response, status

from app.security import AuthedUser
from app.web.deps import NotFound, WebUser, settings_of
from app.web.shared import invite_email
from app import templates_store
from app.web.store import get_store

logger = logging.getLogger("web.invite_email_templates")

router = APIRouter(prefix="/invite-email-templates", tags=["web:invite-email-templates"])

WHAT = "Invite email template"

EMAIL_KINDS = (
    invite_email.INVITE,
    invite_email.ADVANCE,
    invite_email.SELECTED,
    invite_email.REJECTION,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_kind(value: object) -> str:
    """A recognised email kind, defaulting to `invite`.

    Unrecognised rather than rejected: the kind arrives as a query parameter, and a
    stale client sending an old value should get the invite list rather than an error
    page.
    """
    return str(value) if str(value) in EMAIL_KINDS else invite_email.INVITE


def normalise(body: dict | None, *, fallback_kind: str = invite_email.INVITE) -> dict:
    """An incoming template coerced into stored shape.

    Every field falls back to the kind's default rather than to empty, so a partial
    request cannot produce a template that renders a blank email. The server owns
    `id`, `recruiterId` and the timestamps — they are not read from the body here at
    all, which is what stops a client claiming another recruiter's template.
    """
    body = body or {}
    kind = parse_kind(body.get("kind") or fallback_kind)
    seed = invite_email.default_template_for(kind)

    sender = body.get("sender") if isinstance(body.get("sender"), dict) else {}
    cta = body.get("cta") if isinstance(body.get("cta"), dict) else {}
    branding = body.get("branding") if isinstance(body.get("branding"), dict) else {}

    def _or_default(value: object, default: object) -> object:
        return value if isinstance(value, str) else default

    def _trimmed_or_default(value: object, default: object) -> object:
        return value.strip() if isinstance(value, str) and value.strip() else default

    return {
        "kind": kind,
        "name": _trimmed_or_default(body.get("name"), seed["name"]),
        # A truthiness check, matching Express: only an explicit true marks a default.
        "isDefault": bool(body.get("isDefault")),
        "sender": {
            "verifiedSenderEmail": str(
                sender.get("verifiedSenderEmail", seed["sender"]["verifiedSenderEmail"])
            ),
            "fromName": str(sender.get("fromName", seed["sender"]["fromName"])),
            "replyTo": str(sender["replyTo"]) if sender.get("replyTo") else "",
        },
        "subject": _or_default(body.get("subject"), seed["subject"]),
        "bodyHtml": _or_default(body.get("bodyHtml"), seed["bodyHtml"]),
        "cta": {
            "text": _or_default(cta.get("text"), seed["cta"]["text"]),
            "color": _trimmed_or_default(cta.get("color"), seed["cta"]["color"]),
        },
        "branding": {
            "companyName": str(
                branding.get("companyName", seed["branding"]["companyName"])
            ),
            "logoUrl": str(branding["logoUrl"]) if branding.get("logoUrl") else None,
            "accentColor": _trimmed_or_default(
                branding.get("accentColor"), seed["branding"]["accentColor"]
            ),
            "footer": (
                str(branding["footer"])
                if branding.get("footer") is not None
                else seed["branding"].get("footer")
            ),
        },
        "deadlineText": (
            str(body["deadlineText"])
            if body.get("deadlineText") is not None
            else seed.get("deadlineText", "")
        ),
    }


async def load_owned(request: Request, template_id: str, user: AuthedUser) -> dict:
    """A template this recruiter owns, or 404.

    404 rather than 403 on a cross-owner read: a 403 confirms the id exists, which is
    enough to enumerate another recruiter's templates.
    """
    store = get_store(settings_of(request))
    found = await store.invite_email_templates.get(template_id)
    if not found or str(found.get("recruiterId") or "") != user.uid:
        raise NotFound(WHAT)
    return found


def _sort_key(template: dict) -> tuple:
    """Defaults first, then by name — the order the picker shows."""
    return (not template.get("isDefault"), str(template.get("name") or "").lower())



def with_mobile_compatibility(doc: dict, *, owner_email: str | None) -> dict:
    """A stored template plus the few fields the OTHER client needs to read it.

    `email_templates` is shared now, and the mobile surface stores the same thing in a
    different shape: `body` + `isHtml` where this one has `bodyHtml`, and it scopes by
    `ownerEmail` where this one scopes by `recruiterId`.

    Both gaps matter, and only one is cosmetic:

    * Without `body`, a template saved here renders as an EMPTY email on the phone.
      The body is not an unknown key a reader can skip — it is the field.
    * Without `ownerEmail`, `templates_store.list_all` cannot find it at all, so a
      template saved in the browser stays invisible on the phone. That is the exact
      defect this unification closes, reintroduced from the other side.

    Everything else stays additive — the sender, CTA and branding blocks are simply
    ignored by a client that has no use for them, which is how the shared `interviews`
    collection has always worked.
    """
    return {
        **doc,
        **templates_store.compatibility_fields(
            subject=str(doc.get("subject") or ""),
            body_html=str(doc.get("bodyHtml") or ""),
            owner_email=owner_email,
        ),
    }


@router.get("", summary="This recruiter's templates of one kind")
async def list_templates(
    request: Request,
    kind: str = Query(default=invite_email.INVITE),
    user: AuthedUser = WebUser,
) -> list[dict]:
    """Owner- and kind-filtered, seeding a default the first time there are none.

    The seed matters: a recruiter with no template of a kind would otherwise see an
    empty picker at the moment they are trying to send, with nothing to explain what
    to do. The seeded default passes locked-token validation, so it is sendable as-is.
    """
    settings = settings_of(request)
    store = get_store(settings)
    wanted = parse_kind(kind)

    mine = [
        template
        for template in await store.invite_email_templates.owned_by(user.uid)
        if invite_email.kind_of(template) == wanted
    ]

    if not mine:
        now = _now()
        seeded = {
            "id": str(uuid.uuid4()),
            "recruiterId": user.uid,
            "createdAt": now,
            "updatedAt": now,
            **invite_email.default_template_for(wanted),
        }
        await store.invite_email_templates.put(
            with_mobile_compatibility(seeded, owner_email=user.email)
        )
        logger.info("seeded default %s template for %s", wanted, user.uid)
        mine = [seeded]

    return sorted(mine, key=_sort_key)


@router.get("/{template_id}", summary="One template")
async def get_template(
    template_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    return await load_owned(request, template_id, user)


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a template")
async def create_template(
    body: dict, request: Request, user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    now = _now()
    created = {
        "id": str(uuid.uuid4()),
        # OWNER — from the verified token, never the request body.
        "recruiterId": user.uid,
        "createdAt": now,
        "updatedAt": now,
        **normalise(body),
    }
    await store.invite_email_templates.put(
        with_mobile_compatibility(created, owner_email=user.email)
    )
    return created


@router.put("/{template_id}", summary="Update a template")
async def update_template(
    template_id: str, body: dict, request: Request, user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    existing = await load_owned(request, template_id, user)

    updated = {
        **existing,
        **normalise(body, fallback_kind=invite_email.kind_of(existing)),
        "id": existing["id"],
        # The owner is immutable. Re-pinned after the merge so no request body can
        # reassign a template to another recruiter.
        "recruiterId": existing["recruiterId"],
        "createdAt": existing.get("createdAt"),
        "updatedAt": _now(),
    }
    await store.invite_email_templates.put(
        with_mobile_compatibility(updated, owner_email=user.email)
    )
    return updated


@router.post(
    "/{template_id}/duplicate",
    status_code=status.HTTP_201_CREATED,
    summary="Copy a template",
)
async def duplicate_template(
    template_id: str, request: Request, user: AuthedUser = WebUser
) -> dict:
    store = get_store(settings_of(request))
    source = await load_owned(request, template_id, user)
    now = _now()

    copy = {
        **source,
        "id": str(uuid.uuid4()),
        "recruiterId": user.uid,
        "name": f"{source.get('name')} (copy)",
        # Never a default: two defaults of one kind would make which template sends an
        # arbitrary choice.
        "isDefault": False,
        "createdAt": now,
        "updatedAt": now,
    }
    await store.invite_email_templates.put(
        with_mobile_compatibility(copy, owner_email=user.email)
    )
    return copy


@router.delete(
    "/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a template",
)
async def delete_template(
    template_id: str, request: Request, user: AuthedUser = WebUser
) -> Response:
    # Ownership checked first: no cross-tenant delete, and no confirmation that
    # another recruiter's id exists.
    await load_owned(request, template_id, user)
    store = get_store(settings_of(request))
    await store.invite_email_templates.delete(template_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

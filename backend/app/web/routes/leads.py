"""`POST /api/web/leads` — PUBLIC demo-request capture for the marketing site.

Ports `server/routes/leads.ts`. Deliberately unauthenticated: the people filling
this in are pre-login visitors.

Two properties worth keeping in mind when touching this file. It is the only
route on this surface reachable without a token, so every field is length-bounded
and nothing it stores is ever rendered back to a browser by this API. And it
writes to `web_leads`, a collection no client rule grants access to — the Express
version chose a server-side store for exactly this reason, so that a public form
never required a Firestore security-rule change.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Request, status

from app.web.deps import settings_of
from app.web.schemas import LeadCreate
from app.web.services import lead_notify
from app.web.store import get_store

logger = logging.getLogger("web.leads")

router = APIRouter(prefix="/leads", tags=["web:leads"])

DEFAULT_SOURCE = "mimic-site"


def build_lead(body: LeadCreate, now: str) -> dict:
    """The stored record for a submission. Pure, so it can be tested directly.

    The email is lowercased because it is the field a human will search on later,
    and `source` falls back rather than being stored blank — a lead with no
    provenance is indistinguishable from a bug in whichever page submitted it.
    """
    source = (body.source or "").strip() or DEFAULT_SOURCE
    return {
        "firstName": body.firstName.strip(),
        "lastName": body.lastName.strip(),
        "email": str(body.email).strip().lower(),
        "hiresPerYear": body.hiresPerYear.strip(),
        "source": source,
        "createdAt": now,
    }


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Capture a demo request (public)",
)
async def create_lead(
    body: LeadCreate, request: Request, background: BackgroundTasks
) -> dict:
    settings = settings_of(request)
    store = get_store(settings)
    lead = build_lead(body, datetime.now(timezone.utc).isoformat())

    # `add`, not `put`: nothing looks a lead up by id, so letting Firestore
    # generate one avoids inventing a key that only this write would ever use.
    stored = await store.leads.add(lead)

    # The email is the point of the log line — it is how a sales follow-up is
    # traced back. No other submitted field is logged.
    logger.info(
        "new demo request: %s (%s/yr, via %s)",
        stored["email"],
        stored["hiresPerYear"],
        stored["source"],
    )

    # AFTER the response, not before it. A submission used to be stored and logged
    # and reach nobody, so the only way to learn that a visitor wanted a demo was
    # to go looking in a collection nobody knew existed. It is emailed now — but as
    # a BACKGROUND task, because `mailer.send` opens an SMTP connection with a 15
    # second timeout and a stranger filling in a form should not wait on a relay to
    # be told their request went through. The write above is what makes that safe:
    # the lead is already durable, so a notification that fails costs a notification
    # and nothing else.
    background.add_task(lead_notify.notify, settings, stored)

    return {"ok": True}

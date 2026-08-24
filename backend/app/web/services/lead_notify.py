"""Tell somebody a demo request came in.

Until now a submission was stored in `web_leads` and written to the log, and that
was all. Nothing reached a human, so the only way to find out that a visitor had
asked for a demo was to go looking in Firestore for rows nobody knew existed. The
form worked; the follow-up depended on somebody checking.

WHY THE EMAIL IS BUILT HERE AND SENT SEPARATELY. `build_notification` is pure —
a lead in, a subject and a body out — so what the email actually SAYS is testable
without a mail server, an event loop or a network. `notify` is the part with the
side effect, and it is deliberately tiny.

WHY IT NEVER RAISES. By the time this runs the lead is already stored. A relay
that is down, a credential that has expired, a mailbox that is full — none of
those are a reason to tell the visitor their request failed, because it did not.
The failure is logged, the record stands, and the address is in Firestore either
way. This is the same rule `interview_invite` follows for the same reason: one
undeliverable address must not sink the thing it was notifying about.

WHY EVERY FIELD IS ESCAPED. `leads.py` notes that nothing it stores is ever
rendered back to a browser by this API — and that was true until this file. These
values come from an unauthenticated public form and are now rendered as HTML in a
mail client, which is a browser. `html.escape` on every one of them, including the
ones that look harmless: a name is a string a stranger chose.
"""

from __future__ import annotations

import asyncio
import logging
from html import escape

from app.config import Settings

logger = logging.getLogger("web.leads.notify")

# The order the fields are read in, and the label each gets. A list rather than the
# dict's own order so the email's shape does not change if the stored record's does.
_ROWS: tuple[tuple[str, str], ...] = (
    ("firstName", "First name"),
    ("lastName", "Last name"),
    ("email", "Work email"),
    ("hiresPerYear", "Hires per year"),
    ("source", "Source"),
    ("createdAt", "Submitted"),
)


def build_notification(lead: dict) -> tuple[str, str]:
    """The subject and HTML body for one demo request. Pure.

    The subject carries the name and the volume because that is what makes a full
    inbox triageable — "Demo request" alone tells you only that the form works.
    """
    name = " ".join(p for p in (lead.get("firstName", ""), lead.get("lastName", "")) if p).strip()
    volume = str(lead.get("hiresPerYear", "")).strip()

    subject = "Demo request"
    if name:
        subject += f" — {name}"
    if volume:
        subject += f" ({volume}/yr)"

    rows = "".join(
        "<tr>"
        f'<td style="padding:6px 16px 6px 0;color:#5C6879;white-space:nowrap;vertical-align:top">{escape(label)}</td>'
        f'<td style="padding:6px 0;color:#0E1420"><strong>{escape(str(lead.get(key, "")))}</strong></td>'
        "</tr>"
        for key, label in _ROWS
    )

    reply_to = escape(str(lead.get("email", "")))
    body = (
        '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;'
        'font-size:15px;line-height:1.55;color:#0E1420">'
        '<p style="margin:0 0 14px">Somebody asked for a demo on the Mimic site.</p>'
        f'<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px">{rows}</table>'
        f'<p style="margin:0;color:#5C6879">Replying to this email goes straight to {reply_to}.</p>'
        "</div>"
    )
    return subject, body


async def notify(settings: Settings, lead: dict) -> None:
    """Email the configured address about one lead. Never raises.

    `asyncio.to_thread` because `mailer.send` blocks — it opens an SMTP connection
    with a 15 second timeout — and this must not occupy the event loop. The caller
    schedules it as a background task, so even that wait happens after the visitor
    has had their confirmation.

    `reply_to` is the prospect's own address, which is the difference between a
    notification and a lead you can act on: hitting reply answers the person who
    filled the form instead of starting a new message.
    """
    to = (settings.lead_notify_to or "").strip()
    if not to:
        # Explicitly emptied rather than left at its default — a deployment saying
        # "do not email me". Not a failure, and not something to warn about on
        # every submission.
        logger.info("lead notification skipped: no recipient configured")
        return

    from app import mailer

    subject, body = build_notification(lead)
    try:
        delivery = await asyncio.to_thread(
            mailer.send,
            settings,
            to_email=to,
            subject=subject,
            body=body,
            is_html=True,
            reply_to=str(lead.get("email") or "") or None,
        )
    except Exception as exc:  # noqa: BLE001 — the lead is already stored; see the module note
        logger.warning("lead notification to %s failed: %s", to, exc)
        return

    if delivery.dry_run:
        # The mailer's dry-run mode logs the message instead of sending it, which is
        # what an unconfigured deployment gets. Said plainly here too, because
        # "nothing arrived" and "nothing was sent" are worth telling apart when
        # somebody comes looking for a missing demo request.
        logger.info("lead notification NOT sent (mailer unconfigured): would have gone to %s", to)
    else:
        logger.info("lead notification sent to %s via %s", to, delivery.provider)

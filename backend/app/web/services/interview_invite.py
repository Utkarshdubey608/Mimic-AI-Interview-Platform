"""Creating one interview and sending its email — ports `server/services/interviewInvite.ts`.

The reusable home for the per-candidate `interviews/{id}` document and the mail that
goes with it. Used by the bulk-invite flow and by pipeline round transitions, which is
why it lives here rather than inside a route.

**The document schema is shared with the Flutter app, and `app.interviews` owns it.**
The frozen fields — the ones `interview.dart` reads — are built by
`interviews.build_assignment`; this module adds only the web-only keys (`role`,
`screening`, `pipeline`, `invite`), which are additive because Flutter ignores unknown
keys. That is what lets one collection serve both clients.

This module used to spell the frozen field names out itself, alongside its own
`INTERVIEWS_COLLECTION` and its own `type`-from-`mode` mapping. Two modules
independently knowing one schema is how the two clients drifted apart, so the second
copy is gone: the track vocabulary, the `type`/`mode` derivation and the document shape
all live in `app.interviews` now.

One shape detail here that is not cosmetic: `screening` omits absent keys entirely
rather than writing `None`, because Firestore rejects an explicit `undefined` and a
two-way invite has no question source at all.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app import interviews
from app.config import Settings
from app.web.services import invite_email_render

logger = logging.getLogger("web.interview_invite")

# Re-exported so existing call sites keep reading naturally. The definitions — and
# therefore the one place any of this can be wrong — are in `app.interviews`.
MODE_LABELS = interviews.MODE_LABELS
DEFAULT_DURATION_MINUTES = interviews.DEFAULT_DURATION_MINUTES
type_for_mode = interviews.type_for_mode
is_known_mode = interviews.is_known_mode


def name_from_email(email: str) -> str:
    """A greeting name from an address, for `{{candidate_name}}`.

    The invite is created before the candidate has an account, so there is no real
    name to use. The local part is a better greeting than "there", and "there" is the
    fallback when even that is empty.
    """
    local = (email or "").split("@")[0].strip()
    return local or "there"


def build_document(
    *,
    test_id: str,
    recruiter_id: str,
    recruiter_email: str,
    recruiter_name: str | None,
    candidate_email: str,
    role: str,
    mode: str,
    questions: list[str],
    source: str | None = None,
    config: dict | None = None,
    question_set_id: str | None = None,
    mcq_set_id: str | None = None,
    pipeline: dict | None = None,
    allowed_devices: object = None,
    server_timestamp: object = None,
) -> dict:
    """The exact `interviews/{id}` document for one candidate. Pure.

    The frozen half comes from `interviews.build_assignment`, which owns those field
    names and derives `type` from `mode` so the two cannot disagree. Everything added
    below is web-only and ignored by the Dart model.

    `server_timestamp` is injected so this stays testable — the caller passes
    Firestore's sentinel in production and a fixed value in a test.
    """
    label = interviews.mode_label(mode)

    screening: dict = {}
    if source:
        screening["source"] = source
    if source == "tailor" and config:
        screening.update(
            {
                "style": config.get("style"),
                "techCount": config.get("techCount"),
                "nonTechCount": config.get("nonTechCount"),
                "difficulty": config.get("difficulty"),
                "domains": config.get("domains") if isinstance(config.get("domains"), list) else [],
                "model": config.get("model"),
            }
        )
    if source == "set" and question_set_id:
        screening["questionSetId"] = question_set_id
    # MCQ references its paper rather than embedding it: `questions` here is a list
    # of plain strings, which cannot carry an option list or an answer key. The set
    # stays in the recruiter's own collection and the session resolves it at create.
    if mcq_set_id:
        screening["mcqSetId"] = mcq_set_id

    document = {
        # ── the frozen schema, owned by app.interviews ──
        **interviews.build_assignment(
            test_id=test_id,
            recruiter_id=recruiter_id,
            recruiter_email=recruiter_email,
            recruiter_name=recruiter_name,
            candidate_email=candidate_email,
            title=f"{role} — {label} interview",
            mode=mode,
            questions=questions,
            allowed_devices=allowed_devices,
            server_timestamp=server_timestamp,
        ),
        # ── web-only, additive (Flutter ignores unknown keys) ──
        "role": role,
        "screening": screening,
    }

    if pipeline:
        document["pipeline"] = pipeline

    return document


async def ensure_test_summary(
    settings: Settings,
    *,
    test_id: str,
    recruiter_id: str,
    role: str,
    mode: str,
) -> bool:
    """Record the `tests/{testId}` metadata document for a batch. Best-effort.

    **Why this exists.** The mobile recruiter dashboard pages over the `tests`
    collection, not `interviews` — a deliberate design, because grouping a thousand
    assignments client-side to list a dozen batches was ruinous. Nothing on the web
    surface ever wrote that document, so every batch created on the web was invisible
    on the phone.

    Mobile has a backfill that derives these from existing interviews, but it is
    guarded on the tests list being EMPTY, so it never fires for the recruiter this
    hurts most: one who already uses the app. Their web batches simply never appeared
    until they found "Rebuild test list" by hand.

    **Ordering: written BEFORE the assignments it describes.** The opposite order
    risks the exact failure being fixed here — assignments that exist with no metadata
    document are invisible on one client, and nobody reports a screen that looks
    correctly empty. A metadata document with no assignments yet is the better failure:
    it is visible, obviously wrong, and deletable.

    **Never raises.** A dashboard index is not worth denying a recruiter their invites
    for, and this is recoverable — mobile's "Rebuild test list" rebuilds it from the
    assignments. Returns whether the write landed, so the caller can log the gap.

    `merge=True` so the write is safe to repeat and never REPLACES a document — a
    field another writer added (mobile's `upsertTest` records the same shape) survives.

    It is not, however, "idempotent" in the stronger sense of leaving timestamps alone:
    a repeat re-stamps `createdAt`. That is deliberate rather than overlooked. Avoiding
    it needs a read-before-write — a round trip and a race — to defend against a case
    the caller structurally prevents: every call site mints a fresh `uuid4()` test id,
    so the only way to write the same one twice is retrying the same batch, where a
    refreshed timestamp is harmless. If a caller ever appears that re-sends into an
    EXISTING batch, this is the line to revisit, because the dashboard sorts on
    `createdAt` and a reset would move the batch to the top.
    """
    import asyncio

    from firebase_admin import firestore as admin_firestore

    if not test_id or not recruiter_id:
        return False

    label = interviews.mode_label(mode)
    summary = interviews.build_test_summary(
        recruiter_id=recruiter_id,
        title=f"{role} — {label} interview",
        mode=mode,
        server_timestamp=admin_firestore.SERVER_TIMESTAMP,
    )

    def _write() -> None:
        interviews.tests_collection(settings).document(test_id).set(
            summary, merge=True
        )

    try:
        await asyncio.to_thread(_write)
        return True
    except Exception as exc:  # noqa: BLE001 - never block a batch for its index
        logger.error(
            "could not write tests/%s metadata (batch still created; mobile's "
            "'Rebuild test list' will recover it): %s",
            test_id,
            exc,
        )
        return False


def interview_link(origin: str, interview_id: str) -> str:
    """The candidate's link. Relative when no origin was supplied.

    A relative link is useless in an email, but the caller decides whether to send —
    returning a broken absolute URL built from a guessed host would be worse.
    """
    return f"{origin}/take/{interview_id}" if origin else f"/take/{interview_id}"


def sender_fields(template: dict | None, interview_id: str) -> dict:
    """The From, reply-to and tracking header for one send.

    `X-Mailin-custom` carries the interview id so Brevo's delivery webhook can be
    correlated back to this exact invite. Without it, a `delivered` or `bounced` event
    can only be matched by email address, which is ambiguous for a candidate invited
    to more than one role.
    """
    fields: dict = {"headers": {"X-Mailin-custom": f'{{"interviewId":"{interview_id}"}}'}}

    sender = (template or {}).get("sender") or {}
    verified = (sender.get("verifiedSenderEmail") or "").strip()
    if not verified:
        return fields

    from_name = (sender.get("fromName") or "").strip()
    fields["from_override"] = f"{from_name} <{verified}>" if from_name else verified
    if sender.get("replyTo"):
        fields["reply_to"] = sender["replyTo"]
    return fields


def render_vars(
    *, candidate_email: str, role: str, recruiter_name: str, company: str, deadline: str
) -> dict:
    return {
        "candidate_name": name_from_email(candidate_email),
        "role": role,
        "recruiter_name": recruiter_name,
        "company": company,
        "deadline": deadline,
    }


def transition_vars(
    *,
    candidate_email: str,
    role: str,
    recruiter_name: str,
    company: str,
    round_name: str = "",
    previous_round_name: str = "",
    score: str = "",
) -> dict:
    return {
        "candidate_name": name_from_email(candidate_email),
        "role": role,
        "recruiter_name": recruiter_name,
        "company": company,
        "round_name": round_name,
        "previous_round_name": previous_round_name,
        "score": score,
    }


def invite_status(
    *, status: str, message_id: str = "", error: str | None = None, attempts: int = 1
) -> dict:
    """The `invite` block stamped onto an interview after a send attempt.

    Additive and Flutter-ignored. `messageId` is what the Brevo webhook later reports
    against, so it is recorded even when the send is reported as failed.
    """
    block = {
        "status": status,
        "sentAt": datetime.now(timezone.utc).isoformat(),
        "attempts": attempts,
    }
    if message_id:
        block["messageId"] = message_id
    if error:
        block["error"] = error[:500]
    return block


async def send_invite_email(
    settings: Settings,
    *,
    template: dict | None,
    to_email: str,
    link: str,
    interview_id: str,
    variables: dict,
    kind: str = "invite",
) -> dict:
    """Render and send one invite or transition email.

    Returns the `invite` status block to stamp on the document — never raises, because
    one undeliverable address must not sink a batch of fifty. The failure is recorded
    per recipient instead, which is what the retry route acts on.
    """
    import asyncio

    from app import mailer

    if kind == "invite":
        rendered = invite_email_render.build_invite_email(
            template or {}, variables, interview_link=link, candidate_email=to_email
        )
    else:
        rendered = invite_email_render.build_transition_email(
            template or {},
            kind,
            variables,
            interview_link=link if kind == "advance" else None,
            candidate_email=to_email if kind == "advance" else None,
        )

    fields = sender_fields(template, interview_id)
    try:
        delivery = await asyncio.to_thread(
            mailer.send,
            settings,
            to_email=to_email,
            subject=rendered["subject"],
            body=rendered["html"],
            is_html=True,
            **fields,
        )
    except Exception as exc:  # noqa: BLE001 - recorded per recipient, never raised
        logger.warning("invite email to %s failed: %s", to_email, exc)
        return invite_status(status="failed", error=str(exc))

    if delivery.sent:
        return invite_status(status="accepted", message_id=delivery.message_id)

    return invite_status(
        status="failed",
        error="Mailer not configured (dry-run)" if delivery.dry_run else "Not sent",
    )


def interviews_collection(settings: Settings):
    """The shared `interviews` collection — the same one the Flutter app reads.

    A thin delegate: `app.interviews` owns the collection name, so there is no second
    place for the string to be wrong in.
    """
    return interviews.collection(settings)

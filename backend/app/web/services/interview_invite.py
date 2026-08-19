"""Creating one interview and sending its email — ports `server/services/interviewInvite.ts`.

The reusable home for the per-candidate `interviews/{id}` document and the mail that
goes with it. Used by the bulk-invite flow and by pipeline round transitions, which is
why it lives here rather than inside a route.

**The document schema is shared with the Flutter app.** The first block of fields is
the frozen schema from APPLICATION_FLOW.md, written with the exact names
`interview.dart` reads. The web-only fields (`mode`, `role`, `screening`, `pipeline`,
`invite`) are additive — Flutter ignores unknown keys, which is what lets one
collection serve both clients.

Two shape details that are not cosmetic. `type` is Flutter's `video | chat` bucket,
which cannot express the web's six tracks, so the precise one rides in `mode` and the
Dart model still parses. And `screening` omits absent keys entirely rather than writing
`None`, because Firestore rejects an explicit `undefined` and a two-way invite has no
question source at all.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.config import Settings
from app.firebase import get_db
from app.web.services import invite_email_render

logger = logging.getLogger("web.interview_invite")

INTERVIEWS_COLLECTION = "interviews"

# The web's tracks, and the label used in an interview's title.
MODE_LABELS = {
    "chatbot": "Chatbot",
    "voice": "Voice",
    "video_avatar": "Video Avatar",
    "chat": "Timed Q&A",
    "video": "Video Interview",
    "two_way": "Two-way Interview",
    "mcq": "MCQ Test",
}

# Which of Flutter's two buckets each track maps onto.
_VIDEO_MODES = {"video_avatar", "video", "two_way"}

DEFAULT_DURATION_MINUTES = 20


def type_for_mode(mode: str) -> str:
    """Flutter's `interviews.type`, which only knows video and chat."""
    return "video" if mode in _VIDEO_MODES else "chat"


def is_known_mode(mode: object) -> bool:
    return isinstance(mode, str) and mode in MODE_LABELS


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
    server_timestamp: object = None,
) -> dict:
    """The exact `interviews/{id}` document for one candidate. Pure.

    `server_timestamp` is injected so this stays testable — the caller passes
    Firestore's sentinel in production and a fixed value in a test.
    """
    label = MODE_LABELS.get(mode, mode)

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
        # ── the frozen Flutter schema, exact field names ──
        "testId": test_id,
        "recruiterId": recruiter_id,
        "recruiterEmail": recruiter_email,
        "recruiterName": recruiter_name,
        "candidateEmail": candidate_email,
        # Lowercased copy: assignment is matched on this, because the app never stores
        # a candidate uid — the invite exists before they have an account.
        "candidateEmailLower": candidate_email.lower(),
        "candidateName": None,
        "type": type_for_mode(mode),
        "title": f"{role} — {label} interview",
        "prompt": "",
        "questions": questions,
        "durationMinutes": DEFAULT_DURATION_MINUTES,
        "status": "assigned",
        "keyOverrides": {},
        "maxAttempts": 1,
        "attemptsUsed": 0,
        "resultPublished": False,
        "createdAt": server_timestamp,
        "updatedAt": server_timestamp,
        # ── web-only, additive (Flutter ignores unknown keys) ──
        "mode": mode,
        "role": role,
        "screening": screening,
    }

    if pipeline:
        document["pipeline"] = pipeline

    return document


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


def interviews(settings: Settings):
    """The shared `interviews` collection — the same one the Flutter app reads."""
    return get_db(settings).collection(INTERVIEWS_COLLECTION)

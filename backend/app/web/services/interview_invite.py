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


def _as_int(value: object, fallback: int = 0) -> int:
    try:
        return int(float(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback


async def resolve_question_source(
    store,
    *,
    mode: str,
    source: str | None,
    config: dict | None,
    mixed_config: dict | None = None,
) -> tuple[list[str], dict]:
    """`(questions, screening)` for one mode/source combination. The ONE place this is
    decided — called both by a manual invite (`routes/invites.py`) and by a round-2+
    assignment carrying its own configured source (`routes/rounds.py`), so a role
    pipeline's later rounds resolve their question source exactly the way round 1 does.

    Raises `HTTPException` on anything invalid (missing/insufficient question set,
    mismatched Mixed-mode counts) — never fabricates a question to make a bad
    configuration "work".

    `two_way`/`mcq`/`coding`/`essay` have their own dedicated resolution (paper/problem/
    prompt ids) at each call site and are not handled here; passing one of those modes
    returns `([], {})` and does nothing.
    """
    from fastapi import HTTPException, status

    config = config if isinstance(config, dict) else {}
    screening: dict = {}
    questions: list[str] = []

    if mode in ("two_way", "mcq", "coding", "essay"):
        return questions, screening

    if source not in ("tailor", "set", "mixed"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, 'source must be "tailor", "set", or "mixed"'
        )

    screening["source"] = source

    if source == "tailor":
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
        return questions, screening

    if source == "set":
        question_set_id = config.get("questionSetId")
        if not question_set_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A question set must be selected")
        question_set = await store.question_sets.get(str(question_set_id))
        if not question_set:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Question set not found")
        questions = [q["text"] for q in question_set.get("questions") or [] if q.get("text")]
        screening["questionSetId"] = str(question_set_id)
        return questions, screening

    # source == "mixed": fixed questions first (from a set OR ad hoc), résumé-adapted
    # questions second — resolved here only as CONFIGURATION; the résumé-adapted texts
    # themselves are generated later, at session-begin, by the same code adaptive mode
    # already uses (see invite_bridge.synthesise_template / routes/sessions.py).
    mixed = mixed_config if isinstance(mixed_config, dict) else (
        config.get("mixedConfig") if isinstance(config.get("mixedConfig"), dict) else {}
    )
    total = _as_int(mixed.get("totalQuestions"), -1)
    fixed_n = _as_int(mixed.get("fixedQuestionCount"), -1)
    resume_n = _as_int(mixed.get("resumeQuestionCount"), -1)
    if fixed_n < 0 or resume_n < 0 or total < 0 or fixed_n + resume_n != total:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Fixed and résumé-based question counts must add up to the total.",
        )

    question_set_id = mixed.get("questionSetId")
    if question_set_id:
        question_set = await store.question_sets.get(str(question_set_id))
        if not question_set:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Question set not found")
        set_questions = [q["text"] for q in question_set.get("questions") or [] if q.get("text")]
        if len(set_questions) < fixed_n:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"That question set has only {len(set_questions)} question(s); "
                f"{fixed_n} are required.",
            )
        questions = set_questions[:fixed_n]  # first N — never fabricate the rest
    else:
        # Read from `config`, not `mixed` — a request/round sends `fixedQuestions` as a
        # SIBLING of `mixedConfig` (see `MixedConfig` in shared/types.ts and
        # `RoleRoundSpec.config`'s doc comment), never nested inside it. Reading it from
        # `mixed` here used to always come up empty for every ad-hoc Mixed invite,
        # rejecting a correctly-filled-in wizard with "N fixed question(s) are
        # required." — caught by an HTTP-layer test exercising the real route rather
        # than calling this function directly with a hand-built, already-nested dict.
        inline = [str(q).strip() for q in (config.get("fixedQuestions") or []) if str(q).strip()]
        if len(inline) != fixed_n:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"{fixed_n} fixed question(s) are required."
            )
        questions = inline

    screening["mixedConfig"] = {
        "totalQuestions": total,
        "fixedQuestionCount": fixed_n,
        "resumeQuestionCount": resume_n,
        **({"questionSetId": str(question_set_id)} if question_set_id else {}),
    }
    screening.update(
        {
            "style": config.get("style"),
            "difficulty": config.get("difficulty"),
            "domains": config.get("domains") if isinstance(config.get("domains"), list) else [],
            "model": config.get("model"),
        }
    )
    return questions, screening


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
    resolved_screening: dict | None = None,
    mcq_set_id: str | None = None,
    coding_problem_ids: list[str] | None = None,
    essay_prompt_id: str | None = None,
    pipeline: dict | None = None,
    allowed_devices: object = None,
    server_timestamp: object = None,
    role_category: str | None = None,
    raw_role: str | None = None,
    role_config_id: str | None = None,
    round_id: str | None = None,
    round_order: int | None = None,
    round_kind: str | None = None,
    round_title: str | None = None,
) -> dict:
    """The exact `interviews/{id}` document for one candidate. Pure.

    The frozen half comes from `interviews.build_assignment`, which owns those field
    names and derives `type` from `mode` so the two cannot disagree. Everything added
    below is web-only and ignored by the Dart model.

    `server_timestamp` is injected so this stays testable — the caller passes
    Firestore's sentinel in production and a fixed value in a test.

    `resolved_screening` — when given, this IS the question-source half of `screening`
    (whatever `resolve_question_source` returned) and the legacy `source`/`config`/
    `question_set_id` inline construction below is skipped entirely. Existing callers
    (the older Pipeline system in `routes/pipelines.py`) do not pass it and are
    completely unaffected; the manual and role-pipeline invite paths in
    `routes/invites.py` do, so Mixed mode's `screening.mixedConfig` is built in exactly
    one place (`resolve_question_source`), not duplicated here.
    """
    label = interviews.mode_label(mode)

    if resolved_screening is not None:
        screening: dict = dict(resolved_screening)
    else:
        screening = {}
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
    # Coding references its problems for exactly the same reason MCQ references its
    # paper: a problem carries every hidden test case and its expected output, so it
    # stays in the recruiter's own collection and the session resolves it at create
    # time. A list rather than one id, because an assessment is normally two or
    # three problems and a candidate works through them in order.
    if coding_problem_ids:
        screening["codingProblemIds"] = list(coding_problem_ids)

    # Essay references its prompt for the same reason: the prompt carries the
    # recruiter's private marking notes, so it stays in their own collection and the
    # session resolves it at create time. One id, because one sitting is one essay.
    if essay_prompt_id:
        screening["essayPromptId"] = str(essay_prompt_id)

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
        # Role classification (Feature 1) — additive, absent on every interview created
        # before this existed. `role` above stays the free-text label already shown
        # everywhere; `rawRole` is kept alongside it for symmetry with `roleCategory`
        # even though today they are usually the same string.
        **({"rawRole": raw_role} if raw_role else {}),
        **({"roleCategory": role_category} if role_category else {}),
        **({"roleConfigId": role_config_id} if role_config_id else {}),
        # Round metadata (Feature 2) — set only when this document was created as part
        # of a role pipeline's round 1, so it joins the same timeline a manually-added
        # round 2+ assignment already denormalises onto its own documents
        # (`rounds_writer.assign`). Absent for a plain single-round invite, exactly as
        # today.
        **({"roundId": round_id} if round_id else {}),
        **({"roundOrder": round_order} if round_order is not None else {}),
        **({"roundKind": round_kind} if round_kind else {}),
        **({"roundTitle": round_title} if round_title else {}),
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

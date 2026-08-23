"""Bulk invites — ports `server/routes/invites.ts`.

Six routes covering the invite wizard: parse a candidate list, list the senders Brevo
will accept, host a logo where mail clients can load it, send one test to yourself,
create the batch, and retry a single failure.

`POST ""` is the one that writes: one `interviews/{id}` document per candidate, each
stamped with the caller's uid, then an email per document. The documents are created
even when sending is off, because the recruiter may distribute links another way.

A failed send never fails the batch — it is recorded on that recipient's document, and
`POST /{id}/retry` acts on exactly that state. Fifty invites where one address is
mistyped should send forty-nine.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import (
    APIRouter,
    Body,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)

from app.providers.base import UpstreamError
from app.providers.brevo import BrevoClient
from app.security import AuthedUser
from app.web.deps import RateLimitMediaWeb, WebUser, settings_of
from app.web.services import interview_invite, invite_extract, storage, users
from app.web.shared import invite_email
from app.web.routes import mcq_sets as mcq_sets_routes
from app.web.store import get_store

logger = logging.getLogger("web.invites")

router = APIRouter(prefix="/invites", tags=["web:invites"])

# A candidate list, not a database export.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_LOGO_BYTES = 2 * 1024 * 1024

# One wizard run. Beyond this the recruiter should be splitting the batch anyway, and
# the loop below is sequential.
MAX_CANDIDATES = 500


def clean_candidates(raw: object, fallback_role: str) -> list[dict]:
    """Valid, de-duplicated recipients, in the order the recruiter listed them.

    Ports the filter in `server/routes/invites.ts`: trim the address, fall back to
    the batch role when a row leaves it blank, drop anything that is not a valid
    address, and treat one mailbox listed twice in different cases as one
    candidate.

    Reuses `invite_extract.deduplicate` rather than repeating the rule, so the
    wizard's review step and the send agree on what counts as a duplicate — two
    answers there would show the recruiter one list and invite a different one.
    That helper keeps invalid rows (the review screen has to display them); the
    send drops them.
    """
    entries = [e for e in (raw if isinstance(raw, list) else []) if isinstance(e, dict)]
    rows, _duplicates = invite_extract.deduplicate(entries, fallback_role)
    return [
        {"email": row["email"], "role": row["role"] or fallback_role}
        for row in rows
        if row["valid"]
    ]


def resolve_template(body: dict, recruiter_uid: str, stored: dict | None) -> dict:
    """The invite email to send: inline config, else a saved template, else the default.

    Ports `resolveInviteEmail` in `server/routes/invites.ts`, with one deliberate
    difference. There it could return null and the caller fell back to a legacy
    built-in email; here every caller uses the result unconditionally (and the
    locked-token check runs on it), so this always returns a template and the
    default stands in for the null case.

    `emailConfig` wins over `emailTemplateId`: the wizard sends the recruiter's
    unsaved edits inline, and those are what they just previewed. Each section is
    merged over the default rather than replacing it, so a partial config cannot
    drop the sender or branding the renderer needs.

    `stored` is already owner-checked by the caller — a template id belonging to
    another recruiter never reaches here, which is what stops one recruiter
    sending under another's verified sender address.
    """
    kind = str(body.get("kind") or invite_email.INVITE)
    default = invite_email.default_template_for(kind)

    config = body.get("emailConfig")
    if isinstance(config, dict):
        return {
            **default,
            "id": "inline",
            "recruiterId": recruiter_uid,
            "isDefault": False,
            "name": config.get("name") or default.get("name"),
            "subject": config.get("subject") or default.get("subject"),
            "bodyHtml": config.get("bodyHtml") or default.get("bodyHtml"),
            "sender": {**(default.get("sender") or {}), **(config.get("sender") or {})},
            "cta": {**(default.get("cta") or {}), **(config.get("cta") or {})},
            "branding": {**(default.get("branding") or {}), **(config.get("branding") or {})},
            "deadlineText": config.get("deadlineText") or default.get("deadlineText") or "",
        }

    return stored or default


@router.post("/extract", summary="Parse candidates from an uploaded file")
async def extract(
    request: Request,
    file: UploadFile = File(...),
    role: str = Form(default=""),
    user: AuthedUser = WebUser,
) -> dict:
    """Rows for the recruiter to review. Creates nothing and sends nothing."""
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No file uploaded")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That file is too large."
        )

    return await invite_extract.extract_candidates(
        data,
        content_type=file.content_type or "",
        filename=file.filename or "",
        fallback_role=role.strip(),
    )


@router.get("/senders", summary="Brevo verified senders")
async def senders(request: Request, user: AuthedUser = WebUser) -> dict:
    """Which addresses Brevo will accept as a sender.

    An empty list with `brevoReady: false` when no key is configured — the picker then
    offers manual entry, which works. A real API failure is a 502, because that is a
    misconfiguration the recruiter should see rather than an empty list they cannot
    explain.
    """
    settings = settings_of(request)
    client = BrevoClient(settings)

    if not client.is_configured:
        return {"senders": [], "brevoReady": False}

    try:
        return {"senders": await client.list_senders(), "brevoReady": True}
    except UpstreamError as exc:
        logger.error("Brevo senders lookup failed: %s", exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Brevo senders lookup failed: {exc.detail[:200]}"
        ) from exc


@router.post("/logo", summary="Host an invite-email logo", dependencies=[RateLimitMediaWeb])
async def upload_logo(
    request: Request, file: UploadFile = File(...), user: AuthedUser = WebUser
) -> dict:
    """Store a logo and return a URL a mail client can load.

    Hosted rather than hotlinked because an arbitrary URL usually does not work in
    email — a private or localhost address renders as a broken image for every
    recipient. The Admin SDK write bypasses Storage rules, and the tokenised
    `firebasestorage` URL it returns is publicly fetchable without exposing the bucket.
    """
    settings = settings_of(request)

    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No image uploaded")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Logo must be an image (PNG, JPG, SVG, …)"
        )
    if len(data) > MAX_LOGO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo must be under 2 MB")

    return {"url": await _store_logo(settings, user.uid, data, file)}


async def _store_logo(settings, uid: str, data: bytes, file: UploadFile) -> str:
    """Put the logo in the bucket and return a URL a mail client can load."""
    # The extension is rebuilt from scratch rather than taken from the filename: the
    # object path goes into a URL, and a name containing a slash or "%" would land the
    # object somewhere unintended.
    raw_ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    extension = "".join(ch for ch in raw_ext if ch.isalnum())[:8] or "png"
    token = str(uuid.uuid4())

    return await storage.upload(
        settings,
        f"web_invite_email_logos/{uid}/{uuid.uuid4()}.{extension}",
        data,
        content_type=file.content_type or "image/png",
        token=token,
    )


@router.post("", status_code=status.HTTP_201_CREATED, summary="Create a batch of invites")
async def create_invites(
    request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    """One interview document per candidate, then one email each."""
    import asyncio

    from firebase_admin import firestore as admin_firestore

    settings = settings_of(request)
    store = get_store(settings)

    mode = body.get("mode")
    role = str(body.get("role") or "").strip()
    source = body.get("source")

    if not interview_invite.is_known_mode(mode):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A valid interview mode is required")
    if not role:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A candidate role is required")
    # Two modes have no question SOURCE to choose. A two-way interview is a live
    # recruiter-led call with no scripted questions at all; an MCQ test references a
    # pre-authored paper by id, because its options and answers cannot be generated
    # per candidate and still have a key to score against.
    if mode not in ("two_way", "mcq") and source not in ("tailor", "set"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, 'source must be "tailor" or "set"')

    candidates = clean_candidates(body.get("candidates"), role)
    if not candidates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No valid candidate emails to invite")
    if len(candidates) > MAX_CANDIDATES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"That is more than {MAX_CANDIDATES} candidates — split the batch.",
        )

    # Question source → the `questions` array on each document. `tailor` leaves it
    # empty; those are generated per candidate after they upload a résumé.
    questions: list[str] = []
    question_set_id = body.get("questionSetId")
    if source == "set":
        if not question_set_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A question set must be selected")
        question_set = await store.question_sets.get(str(question_set_id))
        if not question_set:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Question set not found")
        questions = [
            q["text"] for q in question_set.get("questions") or [] if q.get("text")
        ]

    # MCQ: the paper is REFERENCED, not embedded. The rest of this pipeline stores
    # questions as plain strings, which cannot express an option list or an answer
    # key, so the paper stays in the recruiter's own mcq_sets document and the
    # session resolves it at create time — the key never leaving the server.
    #
    # Ownership is checked here for the same reason the email template is below: a
    # set id from another recruiter must not be usable, and an MCQ set carries the
    # answers. 404 rather than 403, so the response does not confirm it exists.
    mcq_set_id = None
    if mode == "mcq":
        mcq_set_id = str(body.get("mcqSetId") or "")
        if not mcq_set_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "An MCQ set must be selected")
        mcq_set = await store.mcq_sets.get(mcq_set_id)
        if not mcq_set:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "MCQ set not found")
        if str(mcq_set.get("recruiterId") or "") not in ("", user.uid):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "MCQ set not found")
        # USING is where completeness is enforced, because saving is permissive: a
        # paper is authored through incomplete states. Sending one out unfinished is
        # the thing that must not happen -- a question with no correct answer scores
        # every candidate zero. Named, so the recruiter knows which question to fix.
        faults = mcq_sets_routes.set_faults(mcq_set)
        if faults:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"That MCQ set is not ready to send. {faults[0]}",
            )

    stored_template = None
    if body.get("emailTemplateId"):
        found = await store.invite_email_templates.get(str(body["emailTemplateId"]))
        # Owner-checked: a template id from another recruiter must not be usable to
        # send under their verified sender address.
        if found and str(found.get("recruiterId") or "") == user.uid:
            stored_template = found

    template = resolve_template(body, user.uid, stored_template)

    # The locked link token is enforced server-side. A template without it produces an
    # email the candidate cannot act on, and the assigned-email auth model means every
    # candidate needs their own unique link.
    validation = invite_email.validate_locked_tokens(
        template.get("subject", ""), template.get("bodyHtml", "")
    )
    if not validation["ok"]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Invite email is missing required token(s): {', '.join(validation['missing'])}",
        )

    recruiter_name = await users.get_display_name(settings, user.uid)
    from_name = recruiter_name or user.email or "A recruiter"
    company = (template.get("branding") or {}).get("companyName") or "TalbotIQ"
    deadline = template.get("deadlineText") or ""

    origin = str(body.get("origin") or "").strip()
    send_emails = body.get("sendEmails") is not False
    test_id = str(uuid.uuid4())
    collection = interview_invite.interviews_collection(settings)

    # The batch's metadata document, written FIRST — the mobile recruiter dashboard
    # pages over `tests`, so a batch without one is invisible there. Best-effort and
    # never raises; see `ensure_test_summary` for the ordering and recovery argument.
    await interview_invite.ensure_test_summary(
        settings, test_id=test_id, recruiter_id=user.uid, role=role, mode=mode
    )

    created: list[dict] = []
    emailed = 0
    any_dry_run = False

    for candidate in candidates:
        document = interview_invite.build_document(
            test_id=test_id,
            recruiter_id=user.uid,
            recruiter_email=user.email or "",
            recruiter_name=recruiter_name,
            candidate_email=candidate["email"],
            role=candidate["role"],
            mode=mode,
            questions=questions,
            source=source if isinstance(source, str) else None,
            config=body.get("config") if isinstance(body.get("config"), dict) else None,
            question_set_id=str(question_set_id) if question_set_id else None,
            mcq_set_id=mcq_set_id or None,
            # Which clients the candidate may take this on. Validated and normalised
            # in the kernel: unknown values are dropped rather than refused, and
            # "all three" is stored as no restriction at all.
            allowed_devices=body.get("allowedDevices"),
            server_timestamp=admin_firestore.SERVER_TIMESTAMP,
        )

        reference = (await asyncio.to_thread(collection.add, document))[1]
        link = interview_invite.interview_link(origin, reference.id)
        row: dict = {"id": reference.id, "email": candidate["email"], "link": link}

        if send_emails:
            invite = await interview_invite.send_invite_email(
                settings,
                template=template,
                to_email=candidate["email"],
                link=link,
                interview_id=reference.id,
                variables=interview_invite.render_vars(
                    candidate_email=candidate["email"],
                    role=candidate["role"],
                    recruiter_name=from_name,
                    company=company,
                    deadline=deadline,
                ),
            )
            row["sent"] = invite["status"] == "accepted"
            row["status"] = invite["status"]
            if invite.get("error"):
                row["error"] = invite["error"]
            if row["sent"]:
                emailed += 1
            any_dry_run = any_dry_run or "dry-run" in (invite.get("error") or "")

            await asyncio.to_thread(reference.update, {"invite": invite})

        created.append(row)

    from app import mailer

    dry_run = (
        (emailed == 0 and any_dry_run)
        if send_emails
        else mailer.config_hint(settings) is not None
    )
    logger.info(
        "invite batch %s: %d created, %d emailed by %s", test_id, len(created), emailed, user.uid
    )
    return {"testId": test_id, "created": created, "emailed": emailed, "dryRun": dry_run}


@router.post("/test", summary="Send one test invite to yourself")
async def test_invite(
    request: Request, body: dict = Body(default={}), user: AuthedUser = WebUser
) -> dict:
    """The real rendered email, with sample values, to the recruiter's own address.

    Deliberately never creates an interview document — this is a preview, and a batch
    of orphaned interviews from repeated previews would pollute the recruiter's list.
    The link therefore points nowhere real, which is why it says so.
    """
    settings = settings_of(request)
    store = get_store(settings)

    if not user.email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Your account has no email address to send a test to",
        )

    stored_template = None
    if body.get("emailTemplateId"):
        found = await store.invite_email_templates.get(str(body["emailTemplateId"]))
        if found and str(found.get("recruiterId") or "") == user.uid:
            stored_template = found

    template = resolve_template(body, user.uid, stored_template)
    company = (template.get("branding") or {}).get("companyName") or "TalbotIQ"
    origin = str(body.get("origin") or "").strip()

    invite = await interview_invite.send_invite_email(
        settings,
        template=template,
        to_email=user.email,
        link=interview_invite.interview_link(origin, "sample-interview-id"),
        interview_id="test",
        variables=interview_invite.render_vars(
            candidate_email=user.email,
            role=str(body.get("role") or "Sample Role"),
            recruiter_name=await users.get_display_name(settings, user.uid) or user.email,
            company=company,
            deadline=template.get("deadlineText") or "",
        ),
    )

    return {
        "sent": invite["status"] == "accepted",
        "to": user.email,
        **({"error": invite["error"]} if invite.get("error") else {}),
    }


@router.post("/{interview_id}/retry", summary="Retry one failed invite email")
async def retry_invite(
    interview_id: str,
    request: Request,
    body: dict = Body(default={}),
    user: AuthedUser = WebUser,
) -> dict:
    """Re-send one recipient's invite, incrementing its attempt count.

    Ownership is checked against the interview's own `recruiterId`, not a stored
    template: this re-sends to a real candidate, so only the recruiter who invited them
    may trigger it.
    """
    import asyncio

    settings = settings_of(request)
    store = get_store(settings)
    collection = interview_invite.interviews_collection(settings)

    reference = collection.document(interview_id)
    snapshot = await asyncio.to_thread(reference.get)
    if not snapshot.exists:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Interview not found")

    interview = snapshot.to_dict() or {}
    if str(interview.get("recruiterId") or "") != user.uid:
        # 404, not 403 — a 403 confirms the interview exists.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Interview not found")

    candidate_email = interview.get("candidateEmail") or interview.get("candidateEmailLower")
    if not candidate_email:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "That interview has no candidate email"
        )

    stored_template = None
    if body.get("emailTemplateId"):
        found = await store.invite_email_templates.get(str(body["emailTemplateId"]))
        if found and str(found.get("recruiterId") or "") == user.uid:
            stored_template = found

    template = resolve_template(body, user.uid, stored_template)
    company = (template.get("branding") or {}).get("companyName") or "TalbotIQ"
    origin = str(body.get("origin") or "").strip()
    previous_attempts = int((interview.get("invite") or {}).get("attempts") or 0)

    invite = await interview_invite.send_invite_email(
        settings,
        template=template,
        to_email=candidate_email,
        link=interview_invite.interview_link(origin, interview_id),
        interview_id=interview_id,
        variables=interview_invite.render_vars(
            candidate_email=candidate_email,
            role=str(interview.get("role") or ""),
            recruiter_name=await users.get_display_name(settings, user.uid) or user.email or "",
            company=company,
            deadline=template.get("deadlineText") or "",
        ),
    )
    invite["attempts"] = previous_attempts + 1

    await asyncio.to_thread(reference.update, {"invite": invite})

    return {
        "id": interview_id,
        "email": candidate_email,
        "sent": invite["status"] == "accepted",
        "status": invite["status"],
        **({"error": invite["error"]} if invite.get("error") else {}),
    }

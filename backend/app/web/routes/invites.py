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

from app import role_classification
from app.providers.base import UpstreamError
from app.providers.brevo import BrevoClient
from app.security import AuthedUser
from app.web.deps import RateLimitMediaWeb, WebUser, settings_of
from app.web.services import (
    coding_problems,
    essay_prompts,
    interview_invite,
    invite_extract,
    storage,
    users,
)
from app.web.shared import invite_email
from app.web.routes import mcq_sets as mcq_sets_routes
from app.web.store import get_store

logger = logging.getLogger("web.invites")

# How many coding problems one assessment may carry. An interview is two or three
# problems; the cap is here so a malformed request cannot make the session document
# resolve fifty of them, each with its full test suite, inline.
MAX_CODING_PROBLEMS = 6

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

    A recruiter's manual `roleCategory` correction (AC2) survives here too: `dedup`
    re-classifies from `role` text alone, which would silently discard an override
    that didn't change the text (e.g. correcting "other" to "consulting" for a role
    the classifier missed). Preserved only when it names a category the classifier
    itself knows — the override picks AMONG centrally-defined categories, it does not
    invent a new one, so `app.role_classification` stays the one place that vocabulary
    is decided.
    """
    entries = [e for e in (raw if isinstance(raw, list) else []) if isinstance(e, dict)]
    overrides = {
        (e.get("email") or "").strip().lower(): e["roleCategory"]
        for e in entries
        if role_classification.is_known_category(e.get("roleCategory"))
    }
    rows, _duplicates = invite_extract.deduplicate(entries, fallback_role)
    out = []
    for row in rows:
        if not row["valid"]:
            continue
        candidate = {"email": row["email"], "role": row["role"] or fallback_role}
        override = overrides.get(row["email"].lower())
        if override:
            candidate["roleCategory"] = override
        out.append(candidate)
    return out


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


async def _create_and_email(
    settings,
    user: AuthedUser,
    *,
    candidates: list[dict],
    test_id: str,
    mode: str,
    questions: list[str],
    resolved_screening: dict,
    template: dict,
    origin: str,
    send_emails: bool,
    allowed_devices: object = None,
    role_config_id: str | None = None,
    round_meta: dict | None = None,
    mcq_set_id: str | None = None,
    coding_problem_ids: list[str] | None = None,
    essay_prompt_id: str | None = None,
) -> dict:
    """Write one `interviews/{id}` per candidate, then email each. Shared by a manual
    invite (`create_invites`) and a role-pipeline batch (`create_invites_from_role_pipeline`)
    so there is exactly one place a candidate is written and one place an invite email is
    sent — the two paths differ only in how `mode`/`questions`/`resolved_screening` and
    `round_meta` were decided.
    """
    import asyncio

    from firebase_admin import firestore as admin_firestore

    recruiter_name = await users.get_display_name(settings, user.uid)
    from_name = recruiter_name or user.email or "A recruiter"
    company = (template.get("branding") or {}).get("companyName") or "Mimic"
    deadline = template.get("deadlineText") or ""
    collection = interview_invite.interviews_collection(settings)

    created: list[dict] = []
    emailed = 0
    any_dry_run = False

    for candidate in candidates:
        # Classified fresh here, server-side, from whatever raw role text this
        # candidate is actually being invited with — never trusted from the client,
        # UNLESS the recruiter manually corrected it (AC2), in which case `clean_candidates`
        # has already verified it names a category the classifier itself knows. See
        # app.role_classification.
        role_category = candidate.get("roleCategory")
        if not role_classification.is_known_category(role_category):
            role_category = role_classification.classify_role(candidate["role"]).category
        document = interview_invite.build_document(
            test_id=test_id,
            recruiter_id=user.uid,
            recruiter_email=user.email or "",
            recruiter_name=recruiter_name,
            candidate_email=candidate["email"],
            role=candidate["role"],
            mode=mode,
            questions=questions,
            resolved_screening=resolved_screening,
            mcq_set_id=mcq_set_id or None,
            coding_problem_ids=coding_problem_ids,
            essay_prompt_id=essay_prompt_id,
            raw_role=candidate["role"].strip() or None,
            role_category=role_category,
            role_config_id=role_config_id,
            round_id=(round_meta or {}).get("id"),
            round_order=(round_meta or {}).get("order"),
            round_kind=(round_meta or {}).get("kind"),
            round_title=(round_meta or {}).get("title"),
            allowed_devices=allowed_devices,
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
    settings = settings_of(request)
    store = get_store(settings)

    mode = body.get("mode")
    role = str(body.get("role") or "").strip()
    source = body.get("source")

    if not interview_invite.is_known_mode(mode):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A valid interview mode is required")
    if not role:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A candidate role is required")
    # THREE modes have no question SOURCE to choose. A two-way interview is a live
    # recruiter-led call with no scripted questions at all; an MCQ test references a
    # pre-authored paper by id, because its options and answers cannot be generated
    # per candidate and still have a key to score against; and a coding assessment
    # references its problems by id for exactly the same reason — a test case needs
    # its expected output authored in advance, and a generated-per-candidate case
    # would have nothing to grade against.
    if mode not in ("two_way", "mcq", "coding", "essay") and source not in (
        "tailor",
        "set",
        "mixed",
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, 'source must be "tailor", "set", or "mixed"'
        )

    candidates = clean_candidates(body.get("candidates"), role)
    if not candidates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No valid candidate emails to invite")
    if len(candidates) > MAX_CANDIDATES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"That is more than {MAX_CANDIDATES} candidates — split the batch.",
        )

    # Question source → the `questions` array on each document, plus the `screening`
    # block that tells the session engine how to run it. `tailor` leaves `questions`
    # empty (generated per candidate after they upload a résumé); `mixed` leaves it
    # holding only the FIXED portion, with the résumé-adapted rest appended at
    # session-begin the same way `tailor` mode's questions are generated. One
    # implementation for all three, shared with round-2+ assignment in
    # `routes/rounds.py` — see `resolve_question_source`.
    questions: list[str] = []
    resolved_screening: dict = {}
    question_set_id = body.get("questionSetId")
    if mode not in ("two_way", "mcq", "coding", "essay"):
        questions, resolved_screening = await interview_invite.resolve_question_source(
            store,
            mode=mode,
            source=source,
            config={**(body.get("config") or {}), "questionSetId": question_set_id},
            mixed_config=body.get("mixedConfig") if isinstance(body.get("mixedConfig"), dict) else None,
        )

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

    # Coding problems, validated the same way and for the same reasons as the MCQ
    # set above: a problem carries its hidden test cases and their expected outputs,
    # so an id belonging to another recruiter must not be usable, and 404 rather
    # than 403 keeps the response from confirming it exists. Readiness is enforced
    # at USE because authoring passes through incomplete states — a problem with no
    # visible sample gives a candidate nothing to run against.
    coding_problem_ids: list[str] | None = None
    if mode == "coding":
        raw_ids = body.get("codingProblemIds")
        ids = [str(x) for x in raw_ids if str(x)] if isinstance(raw_ids, list) else []
        if not ids:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "At least one coding problem must be selected"
            )
        if len(ids) > MAX_CODING_PROBLEMS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"An assessment may carry at most {MAX_CODING_PROBLEMS} problems",
            )
        for problem_id in ids:
            problem = await store.coding_problems.get(problem_id)
            if not problem or str(problem.get("recruiterId") or "") not in ("", user.uid):
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Coding problem not found")
            problem_faults = coding_problems.problem_faults(problem)
            if problem_faults:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    f'"{problem.get("title") or problem_id}" is not ready to send. '
                    f"{problem_faults[0]}",
                )
        coding_problem_ids = ids

    # The essay prompt, owner-checked and readiness-checked the same way. 404 rather
    # than 403 so the response does not confirm that somebody else's prompt exists,
    # and readiness enforced at USE because authoring passes through incomplete
    # states — a prompt nobody could satisfy is worse than a missing one, because the
    # candidate finds out after writing.
    essay_prompt_id: str | None = None
    if mode == "essay":
        prompt_id = str(body.get("essayPromptId") or "")
        if not prompt_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "An essay prompt must be selected"
            )
        prompt = await store.essay_prompts.get(prompt_id)
        if not prompt or str(prompt.get("recruiterId") or "") not in ("", user.uid):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Essay prompt not found")
        prompt_faults = essay_prompts.essay_faults(prompt)
        if prompt_faults:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f'"{prompt.get("title") or prompt_id}" is not ready to send. {prompt_faults[0]}',
            )
        essay_prompt_id = prompt_id

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

    origin = str(body.get("origin") or "").strip()
    send_emails = body.get("sendEmails") is not False
    test_id = str(uuid.uuid4())

    # The batch's metadata document, written FIRST — the mobile recruiter dashboard
    # pages over `tests`, so a batch without one is invisible there. Best-effort and
    # never raises; see `ensure_test_summary` for the ordering and recovery argument.
    await interview_invite.ensure_test_summary(
        settings, test_id=test_id, recruiter_id=user.uid, role=role, mode=mode
    )

    return await _create_and_email(
        settings,
        user,
        candidates=candidates,
        test_id=test_id,
        mode=mode,
        questions=questions,
        resolved_screening=resolved_screening,
        template=template,
        origin=origin,
        send_emails=send_emails,
        # Which clients the candidate may take this on. Validated and normalised in
        # the kernel: unknown values are dropped rather than refused, and "all three"
        # is stored as no restriction at all.
        allowed_devices=body.get("allowedDevices"),
        mcq_set_id=mcq_set_id,
        coding_problem_ids=coding_problem_ids,
        essay_prompt_id=essay_prompt_id,
    )


@router.post(
    "/from-role-pipeline",
    status_code=status.HTTP_201_CREATED,
    summary="Create a batch of invites from a role pipeline",
)
async def create_invites_from_role_pipeline(
    request: Request, body: dict = Body(...), user: AuthedUser = WebUser
) -> dict:
    """Materialise a `RoleConfig` template (Feature 1) into a real timeline, then
    invite each candidate to round 1 — the rest of a role-classified spreadsheet import.

    Every round in the template becomes a real `tests/{testId}/rounds` document up
    front, via the exact same `rounds_writer.create` a manually-added round already
    uses, so the recruiter sees the whole pipeline immediately and can grow it further
    with the ordinary round-editing routes. Only round 1 gets candidates assigned here;
    rounds 2+ are populated later through the existing `POST .../rounds/{id}/assign`
    action, completely unchanged — this endpoint does not invent a new "advance"
    mechanism.

    Payload: `{roleConfigId, candidates: [{email, role}], emailTemplateId?/emailConfig?,
    allowedDevices?, sendEmails?, origin?}`. `role` per candidate is the SPREADSHEET row's
    raw text (preserved on the document as `rawRole`), independent of the pipeline's own
    `roleCategory`.
    """
    from app import rounds as rounds_kernel
    from app import rounds_writer

    settings = settings_of(request)
    store = get_store(settings)

    role_config_id = str(body.get("roleConfigId") or "")
    if not role_config_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A role pipeline must be selected")

    role_config = await store.role_configs.get(role_config_id)
    if not role_config or str(role_config.get("recruiterId") or "") != user.uid:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Role pipeline not found")

    round_specs = role_config.get("rounds") or []
    if not round_specs:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "That role pipeline has no rounds configured"
        )

    role_category = str(role_config.get("roleCategory") or "")
    display_name = str(role_config.get("displayName") or "").strip() or role_classification.category_display_name(role_category)

    candidates = clean_candidates(body.get("candidates"), display_name)
    if not candidates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No valid candidate emails to invite")
    if len(candidates) > MAX_CANDIDATES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"That is more than {MAX_CANDIDATES} candidates — split the batch.",
        )

    first_spec = round_specs[0]
    round1_kind = rounds_kernel.kind_from_wire(first_spec.get("kind"))
    round1_mode = rounds_kernel.mode_for_kind(round1_kind) or "chat"
    round1_config = first_spec.get("config") if isinstance(first_spec.get("config"), dict) else {}
    round1_source = round1_config.get("source")

    if round1_mode in ("two_way", "mcq", "coding", "essay"):
        # Those tracks need a paper/problem/prompt id the template does not carry yet —
        # refused clearly rather than materialising a round nobody configured.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f'Round 1 is configured as "{round1_kind}", which role pipelines cannot '
            "invite to yet — choose a chat, video, or voice round for round 1.",
        )

    round1_questions, round1_screening = await interview_invite.resolve_question_source(
        store,
        mode=round1_mode,
        source=round1_source,
        config=round1_config,
        mixed_config=round1_config.get("mixedConfig") if isinstance(round1_config.get("mixedConfig"), dict) else None,
    )

    stored_template = None
    if body.get("emailTemplateId"):
        found = await store.invite_email_templates.get(str(body["emailTemplateId"]))
        if found and str(found.get("recruiterId") or "") == user.uid:
            stored_template = found
    template = resolve_template(body, user.uid, stored_template)

    validation = invite_email.validate_locked_tokens(
        template.get("subject", ""), template.get("bodyHtml", "")
    )
    if not validation["ok"]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Invite email is missing required token(s): {', '.join(validation['missing'])}",
        )

    test_id = str(uuid.uuid4())
    await interview_invite.ensure_test_summary(
        settings, test_id=test_id, recruiter_id=user.uid, role=display_name, mode=round1_mode
    )
    await _stamp_test_role(settings, test_id=test_id, role_category=role_category, role_config_id=role_config_id)

    created_rounds: list[dict] = []
    for index, spec in enumerate(round_specs):
        model = rounds_kernel.Round(
            id="",
            test_id=test_id,
            recruiter_id=user.uid,
            order=index,
            title=str(spec.get("title") or f"Round {index + 1}"),
            kind=rounds_kernel.kind_from_wire(spec.get("kind")),
            config=spec.get("config") if isinstance(spec.get("config"), dict) else {},
            criteria=rounds_kernel.Criteria.from_map(spec.get("criteria")),
        )
        round_id = await rounds_writer.create(settings, model)
        created_rounds.append(
            {"id": round_id, "order": model.order, "kind": model.kind, "title": model.title}
        )

    round1_meta = created_rounds[0]

    result = await _create_and_email(
        settings,
        user,
        candidates=candidates,
        test_id=test_id,
        mode=round1_mode,
        questions=round1_questions,
        resolved_screening=round1_screening,
        template=template,
        origin=str(body.get("origin") or "").strip(),
        send_emails=body.get("sendEmails") is not False,
        allowed_devices=body.get("allowedDevices"),
        role_config_id=role_config_id,
        round_meta=round1_meta,
    )
    logger.info(
        "role pipeline %s materialised as test %s (%d round(s)) by %s",
        role_config_id,
        test_id,
        len(created_rounds),
        user.uid,
    )
    return {**result, "roundsCreated": len(created_rounds)}


async def _stamp_test_role(
    settings, *, test_id: str, role_category: str, role_config_id: str
) -> None:
    """Merge `roleCategory`/`roleConfigId` onto a `tests/{testId}` doc. Additive,
    best-effort — the Kanban and import preview read these but a batch is not worth
    failing over an index write.
    """
    import asyncio

    from app import interviews

    def _write() -> None:
        interviews.tests_collection(settings).document(test_id).set(
            {"roleCategory": role_category, "roleConfigId": role_config_id}, merge=True
        )

    try:
        await asyncio.to_thread(_write)
    except Exception as exc:  # noqa: BLE001 - never block a batch for its index
        logger.error("could not stamp role metadata on tests/%s: %s", test_id, exc)


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
    company = (template.get("branding") or {}).get("companyName") or "Mimic"
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
    company = (template.get("branding") or {}).get("companyName") or "Mimic"
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

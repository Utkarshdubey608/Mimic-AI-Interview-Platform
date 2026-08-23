"""Invite-email rendering — a port of `web_version/talbotiq-platform/shared/inviteEmail.ts`.

That module is imported by BOTH the Express server and the React frontend, which is
what makes the recruiter's preview byte-identical to the delivered mail. This port
breaks that guarantee: the frontend still runs the TypeScript, and this runs on the
server. Nothing in either language enforces that they agree.

**So they are pinned by a golden file.** `contracts/invite_email.fixtures.json` holds
input/output pairs generated from this implementation; `tests/web/test_web_invite_email.py`
asserts this module still reproduces them, and the web repo's suite asserts the
TypeScript does too. Change either implementation and the fixtures must be regenerated
deliberately, with the other side updated to match. Without that, a recruiter approves
one email and the candidate receives another.

Pure functions only. The caller sanitises the WYSIWYG body BEFORE rendering — see
`app.web.services.invite_email_render`.
"""

from __future__ import annotations

import re

# Merge variables the recruiter can insert into an invite. Filled per candidate at
# send time.
MERGE_VARS = (
    {"token": "{{candidate_name}}", "label": "Candidate name"},
    {"token": "{{role}}", "label": "Role"},
    {"token": "{{recruiter_name}}", "label": "Recruiter name"},
    {"token": "{{company}}", "label": "Company"},
    {"token": "{{interview_link}}", "label": "Interview link (locked)"},
    {"token": "{{deadline}}", "label": "Deadline"},
)

ADVANCE_VARS = (
    {"token": "{{candidate_name}}", "label": "Candidate name"},
    {"token": "{{role}}", "label": "Role"},
    {"token": "{{round_name}}", "label": "Next round name"},
    {"token": "{{interview_link}}", "label": "Interview link (locked)"},
    {"token": "{{recruiter_name}}", "label": "Recruiter name"},
    {"token": "{{company}}", "label": "Company"},
    {"token": "{{previous_round_name}}", "label": "Previous round name"},
    {"token": "{{score}}", "label": "Score"},
)

SELECTED_VARS = (
    {"token": "{{candidate_name}}", "label": "Candidate name"},
    {"token": "{{role}}", "label": "Role"},
    {"token": "{{recruiter_name}}", "label": "Recruiter name"},
    {"token": "{{company}}", "label": "Company"},
    {"token": "{{score}}", "label": "Score"},
)

REJECTION_VARS = (
    {"token": "{{candidate_name}}", "label": "Candidate name"},
    {"token": "{{role}}", "label": "Role"},
    {"token": "{{recruiter_name}}", "label": "Recruiter name"},
    {"token": "{{company}}", "label": "Company"},
)

INVITE = "invite"
ADVANCE = "advance"
SELECTED = "selected"
REJECTION = "rejection"

DEFAULT_ACCENT = "#6B2BE0"

# A colour the shell will accept. Anything else falls back, because an unvalidated
# value lands inside a `style` attribute.
_HEX = re.compile(r"^#[0-9a-f]{3,8}$", re.IGNORECASE)

# `{{ role }}` and `{{role}}` are the same token — the WYSIWYG editor sometimes adds
# spacing when a recruiter edits around one.
_TOKEN = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")


def kind_of(template: dict) -> str:
    """A template's kind. Absent means `invite`, for templates saved before kinds."""
    kind = (template or {}).get("kind")
    return kind if kind in (INVITE, ADVANCE, SELECTED, REJECTION) else INVITE


def merge_vars_for(kind: str) -> tuple[dict, ...]:
    """The merge variables offered for a kind."""
    return {
        ADVANCE: ADVANCE_VARS,
        SELECTED: SELECTED_VARS,
        REJECTION: REJECTION_VARS,
    }.get(kind, MERGE_VARS)


def required_tokens_for(kind: str) -> list[str]:
    """Tokens that MUST survive to send time.

    The interview link is required only where one is actually sent: the
    assigned-email auth model gives every candidate a unique link, so an invite or
    advance email without it is undeliverable in practice. A selection or rejection
    carries no link at all.
    """
    return ["{{interview_link}}"] if kind in (INVITE, ADVANCE) else []


def render_template(text: str, variables: dict[str, str]) -> str:
    """Substitute `{{token}}` values.

    An unrecognised token is left in place rather than blanked, so a recruiter's typo
    shows up literally in the preview instead of silently vanishing from the sent
    mail.
    """
    if not text:
        return ""

    def _replace(match: re.Match) -> str:
        key = match.group(1)
        if key in variables:
            return str(variables[key] if variables[key] is not None else "")
        return match.group(0)

    return _TOKEN.sub(_replace, text)


def validate_locked_tokens(subject: str, body_html: str, kind: str = INVITE) -> dict:
    """Which required tokens are missing from a template."""
    haystack = f"{subject or ''}\n{body_html or ''}"
    missing = [token for token in required_tokens_for(kind) if token not in haystack]
    return {"ok": not missing, "missing": missing}


def unknown_tokens(text: str) -> list[str]:
    """`{{tokens}}` in the text that are not recognised merge variables.

    Surfaced to the recruiter while editing: an unknown token would otherwise reach
    the candidate as literal `{{rold}}`.
    """
    known = {var["token"] for var in MERGE_VARS} | {
        var["token"] for var in ADVANCE_VARS
    }
    found = _TOKEN.findall(text or "")
    seen: list[str] = []
    for key in found:
        token = f"{{{{{key}}}}}"
        if token not in known and token not in seen:
            seen.append(token)
    return seen


def escape_html(value: object) -> str:
    """Escape a text value so candidate or merge text cannot inject markup.

    Hand-rolled rather than `html.escape` to match the TypeScript character for
    character — `html.escape` leaves `'` alone by default and emits `&#x27;` when
    asked, where the shared renderer emits `&#39;`. The golden fixtures would catch
    the difference, but matching here means they never diverge in the first place.
    """
    text = "" if value is None else str(value)
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _colour(value: object, fallback: str = DEFAULT_ACCENT) -> str:
    text = value if isinstance(value, str) else ""
    return text if _HEX.match(text or "") else fallback


def cta_button(template: dict, link: str) -> str:
    """The call-to-action anchor.

    The colour is validated because it is interpolated straight into a `style`
    attribute — an unchecked value could close the attribute and inject markup.
    """
    colour = _colour((template.get("cta") or {}).get("color"))
    text = escape_html((template.get("cta") or {}).get("text") or "Start your interview")
    return (
        f'<a href="{escape_html(link)}" style="display:inline-block;background:{colour};'
        "color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;"
        f'font-weight:600;font-family:Inter,Arial,sans-serif">{text}</a>'
    )


def exact_email_note(candidate_email: str) -> str:
    """The locked "use this exact email" note.

    Always present on any email carrying a link, and not removable by the recruiter:
    the interview is bound to that address, so a candidate who signs in with another
    one cannot open it and has no way to find out why.
    """
    return (
        '<p style="background:#F5F0FE;border:1px solid #E0D4FB;border-radius:8px;'
        'padding:10px 14px;color:#4A1BA8;font-size:13px;font-family:Inter,Arial,sans-serif">\n'
        f"    <strong>Important:</strong> this invitation is linked to <strong>{escape_html(candidate_email)}</strong>.\n"
        "    Sign in — or create your candidate account — using this exact email address to open it.\n"
        "  </p>"
    )


def render_email_shell(
    template: dict,
    text_vars: dict[str, str],
    *,
    interview_link: str | None = None,
    candidate_email: str | None = None,
    include_link: bool,
    include_note: bool,
) -> dict:
    """The full `{subject, html}`.

    `text_vars` are ALREADY ESCAPED (the interview link is handled here). The flags
    let one shell serve all four kinds: invite and advance carry the link and the
    note, selection and rejection carry neither.

    `template["bodyHtml"]` is assumed SAFE — the caller sanitises first.
    """
    link = interview_link or ""
    subject = render_template(
        template.get("subject") or "", {**text_vars, "interview_link": link}
    )

    body_source = template.get("bodyHtml") or ""
    body_has_link = "{{interview_link}}" in body_source
    body_rendered = render_template(
        body_source,
        {
            **text_vars,
            "interview_link": cta_button(template, link) if include_link else "",
        },
    )

    # When the body does not place the link itself, append one. A link-bearing email
    # with no link is the one failure mode that cannot be recovered from the
    # candidate's side.
    fallback_cta = (
        f'<p style="margin:16px 0">{cta_button(template, link)}</p>'
        if include_link and not body_has_link
        else ""
    )
    note = exact_email_note(candidate_email) if include_note and candidate_email else ""
    paste_link = (
        '<p style="color:#645C7B;font-size:13px">Or paste this link into your '
        f"browser:<br>{escape_html(link)}</p>"
        if include_link
        else ""
    )

    branding = template.get("branding") or {}
    accent = _colour(branding.get("accentColor"))
    company = escape_html(branding.get("companyName") or "Mimic")
    logo = (
        f'<img src="{escape_html(branding["logoUrl"])}" alt="{escape_html(branding.get("companyName") or "")}"'
        ' style="max-height:40px;margin-bottom:8px" />'
        if branding.get("logoUrl")
        else f'<div style="font-weight:700;color:{accent};font-size:18px">{company}</div>'
    )
    footer = escape_html(branding.get("footer") or "Sent via Mimic.")

    # The shell tones mirror the in-app violet system so the wizard's preview and the
    # delivered mail read as one surface. Figtree is the product face; the rest of the
    # stack is what mail clients actually have.
    html = f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5FB;padding:24px 0;font-family:Figtree,Roboto,'Segoe UI',Arial,sans-serif">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #E7E2F2;border-radius:16px;overflow:hidden">
      <tr><td style="border-top:4px solid {accent};padding:20px 28px 8px">{logo}</td></tr>
      <tr><td style="padding:8px 28px;color:#1B0B3B;font-size:15px;line-height:1.6">
        {body_rendered}
        {fallback_cta}
        {note}
        {paste_link}
      </td></tr>
      <tr><td style="padding:14px 28px 22px;color:#645C7B;font-size:12px;border-top:1px solid #E7E2F2">{footer}</td></tr>
    </table>
  </td></tr>
</table>"""

    return {"subject": subject, "html": html}


def render_invite_email(
    template: dict, variables: dict, *, interview_link: str, candidate_email: str
) -> dict:
    """The invite email for one candidate. Always carries the link and the note."""
    text_vars = {
        "candidate_name": escape_html(variables.get("candidate_name")),
        "role": escape_html(variables.get("role")),
        "recruiter_name": escape_html(variables.get("recruiter_name")),
        "company": escape_html(variables.get("company")),
        "deadline": escape_html(variables.get("deadline")),
    }
    return render_email_shell(
        template,
        text_vars,
        interview_link=interview_link,
        candidate_email=candidate_email,
        include_link=True,
        include_note=True,
    )


def render_transition_email(
    template: dict,
    kind: str,
    variables: dict,
    *,
    interview_link: str | None = None,
    candidate_email: str | None = None,
) -> dict:
    """An advance, selection, or rejection email.

    Only `advance` carries a link and the exact-email note — there is a next round to
    open. A selection or rejection is terminal, and a link on one would send the
    candidate back into an interview they have finished.
    """
    text_vars = {
        "candidate_name": escape_html(variables.get("candidate_name")),
        "role": escape_html(variables.get("role")),
        "recruiter_name": escape_html(variables.get("recruiter_name")),
        "company": escape_html(variables.get("company")),
        "round_name": escape_html(variables.get("round_name") or ""),
        "previous_round_name": escape_html(variables.get("previous_round_name") or ""),
        "score": escape_html(variables.get("score") or ""),
    }
    include_link = kind == ADVANCE
    return render_email_shell(
        template,
        text_vars,
        interview_link=interview_link,
        candidate_email=candidate_email,
        include_link=include_link,
        include_note=include_link,
    )


# ── seeds ─────────────────────────────────────────────────────────────────────

_SENDER = {"verifiedSenderEmail": "", "fromName": "Mimic", "replyTo": ""}
_BRANDING = {
    "companyName": "Mimic",
    "accentColor": DEFAULT_ACCENT,
    "footer": "Sent via Mimic.",
}


def default_invite_email_template() -> dict:
    """The invite template preloaded for a recruiter who has none.

    Passes locked-token validation as written — a default that failed its own
    validation would block the first send a new recruiter attempts.
    """
    return {
        "name": "Default invite",
        "isDefault": True,
        "sender": dict(_SENDER),
        "subject": "Interview invitation — {{role}}",
        "bodyHtml": (
            "<p>Hi {{candidate_name}},</p>"
            "<p><strong>{{recruiter_name}}</strong> has invited you to a screening "
            "interview for the <strong>{{role}}</strong> role at {{company}}.</p>"
            "<p>When you're ready, open your interview, upload your résumé, and "
            "begin — it takes just a few minutes:</p>"
            "<p>{{interview_link}}</p>"
        ),
        "cta": {"text": "Start your interview", "color": DEFAULT_ACCENT},
        "branding": dict(_BRANDING),
        "deadlineText": "",
    }


def default_template_for(kind: str) -> dict:
    """A kind-appropriate default template, without ids or timestamps."""
    if kind == ADVANCE:
        return {
            "name": "Default advance",
            "isDefault": True,
            "kind": ADVANCE,
            "sender": dict(_SENDER),
            "subject": "You've advanced — {{role}} ({{round_name}})",
            "bodyHtml": (
                "<p>Hi {{candidate_name}},</p>"
                "<p>Congratulations — you've advanced to the "
                "<strong>{{round_name}}</strong> round for the "
                "<strong>{{role}}</strong> role at {{company}}.</p>"
                "<p>Open your next interview to continue:</p>"
                "<p>{{interview_link}}</p>"
            ),
            "cta": {"text": "Start next round", "color": DEFAULT_ACCENT},
            "branding": dict(_BRANDING),
            "deadlineText": "",
        }
    if kind == SELECTED:
        return {
            "name": "Default selection",
            "isDefault": True,
            "kind": SELECTED,
            "sender": dict(_SENDER),
            "subject": "You've been selected — {{role}}",
            "bodyHtml": (
                "<p>Hi {{candidate_name}},</p>"
                "<p>Congratulations — following your interviews for the "
                "<strong>{{role}}</strong> role at {{company}}, we're delighted to "
                "move you forward as a selected candidate. Our team will be in touch "
                "with next steps.</p>"
            ),
            "cta": {"text": "View details", "color": DEFAULT_ACCENT},
            "branding": dict(_BRANDING),
            "deadlineText": "",
        }
    if kind == REJECTION:
        return {
            "name": "Default rejection",
            "isDefault": True,
            "kind": REJECTION,
            "sender": dict(_SENDER),
            "subject": "Update on your {{role}} application",
            "bodyHtml": (
                "<p>Hi {{candidate_name}},</p>"
                "<p>Thank you for taking the time to interview for the "
                "<strong>{{role}}</strong> role at {{company}}. After careful "
                "consideration we won't be moving forward at this time. We genuinely "
                "appreciate the effort you put in and wish you every success.</p>"
            ),
            "cta": {"text": "", "color": DEFAULT_ACCENT},
            "branding": dict(_BRANDING),
            "deadlineText": "",
        }
    return {**default_invite_email_template(), "kind": INVITE}

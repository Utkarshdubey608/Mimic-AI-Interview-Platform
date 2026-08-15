"""Email delivery. Four modes, picked automatically from what is configured:

* ``brevo``     — SMTP through Brevo's relay. What the web surface's invite flow needs:
                  per-send sender, reply-to, and custom headers for delivery webhooks.
* ``smtp``      — any other SMTP server, including Gmail with an App Password.
* ``gmail_api`` — Gmail API with an OAuth refresh token. For hosts that block
                  outbound SMTP.
* ``dry_run``   — logs instead of sending, so the whole flow works with zero
                  credentials.

**Why this is not Gmail-shaped any more.** The previous version logged in as
``EMAIL_USER`` and hardcoded the ``From`` to the same address. Brevo cannot work that
way: the login is ``…@smtp-brevo.com`` and the ``From`` must be your own verified
domain. So the login, the password and the sender are now three separate settings —
each falling back to the old Gmail value, so every existing deployment keeps working
untouched.

Three capabilities the web invite flow needs and Gmail-shaped sending could not
express: a per-send ``from`` (the recruiter picks among verified senders), a
``reply_to``, and custom headers — ``X-Mailin-custom`` carries the interview id, and
**without it Brevo's delivery webhooks cannot be correlated back to a recipient**, so
per-invite delivery status is impossible.

Both real modes block, so callers run ``send`` via ``asyncio.to_thread`` to keep the
event loop free.
"""

from __future__ import annotations

import base64
import logging
import re
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from functools import lru_cache

from app.config import Settings

logger = logging.getLogger("mailer")

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send"]
_TOKEN_URI = "https://oauth2.googleapis.com/token"

# A Google App Password is always 16 characters (shown as 4 groups of 4).
_APP_PASSWORD_LEN = 16

# Hosts where the Gmail App Password rules apply. Checked by host rather than assumed,
# because a Brevo SMTP key is much longer than 16 characters and would fail a
# Gmail-shaped validation that had no business running.
_GMAIL_HOSTS = {"smtp.gmail.com", "smtp-relay.gmail.com"}

DRY_RUN = "dry_run"
BREVO = "brevo"
SMTP = "smtp"
GMAIL_API = "gmail_api"
UNCONFIGURED = "unconfigured"


class MailerNotConfigured(RuntimeError):
    """Raised when a real send is attempted without usable credentials."""


@dataclass(frozen=True)
class Delivery:
    """The outcome of one send.

    `message_id` is what makes delivery tracking possible: Brevo's webhook reports
    against it, so an invite's status can be traced from accepted to delivered,
    bounced or opened. Empty in dry-run and for the Gmail API path.
    """

    sent: bool
    provider: str
    message_id: str = ""
    dry_run: bool = False


# ── configuration ─────────────────────────────────────────────────────────────


def _is_gmail_host(settings: Settings) -> bool:
    return settings.smtp_host.strip().lower() in _GMAIL_HOSTS


def _is_brevo_host(settings: Settings) -> bool:
    return "brevo" in settings.smtp_host.strip().lower()


def smtp_login(settings: Settings) -> str:
    """The SMTP username. Falls back to the Gmail address for old deployments."""
    return settings.smtp_user.strip() or settings.email_user.strip()


def smtp_password(settings: Settings) -> str:
    """The SMTP password.

    Spaces are stripped from an App Password because Google displays it in groups of
    four and they are not part of the value.
    """
    explicit = settings.smtp_pass.strip()
    if explicit:
        return explicit
    return settings.email_app_password.replace(" ", "").strip()


def from_header(settings: Settings, override: str | None = None) -> str:
    """The `From` header for a send.

    Precedence: a per-send override (the recruiter's chosen verified sender), then
    `MAIL_FROM`, then the Gmail address with the display name. The override comes
    last in the config chain but first here, because picking a sender per campaign is
    the whole point of the invite flow.
    """
    if override and override.strip():
        return override.strip()
    if settings.mail_from.strip():
        return settings.mail_from.strip()
    if settings.email_user.strip():
        return formataddr((settings.from_name or None, settings.email_user.strip()))
    return ""


def provider(settings: Settings) -> str:
    """Which delivery mode a send would use right now.

    `dry_run` is checked first and unconditionally: it is an explicit switch, and a
    deployment that sets it wants nothing delivered regardless of what else is
    configured. The Flutter app's only test of this value is `== 'dry_run'`
    (`send_report.dart`), so the new `brevo` label is safe.
    """
    if settings.dry_run:
        return DRY_RUN

    if (
        settings.gmail_client_id
        and settings.gmail_client_secret
        and settings.gmail_refresh_token
        and settings.email_user.strip()
    ):
        return GMAIL_API

    if smtp_login(settings) and smtp_password(settings) and from_header(settings):
        return BREVO if _is_brevo_host(settings) else SMTP

    return UNCONFIGURED


def config_hint(settings: Settings) -> str | None:
    """Human-readable reason sending would fail, or None when it is ready."""
    mode = provider(settings)

    if mode == SMTP and _is_gmail_host(settings):
        password = smtp_password(settings)
        if len(password) != _APP_PASSWORD_LEN:
            # Gmail refuses a normal account password over SMTP (534 5.7.9), so catch
            # the wrong-value case before trying to deliver anything.
            return (
                "EMAIL_APP_PASSWORD must be a 16-character Google App Password, not "
                "your normal account password. Enable 2-Step Verification, then create "
                "one at https://myaccount.google.com/apppasswords"
            )

    if mode != UNCONFIGURED:
        return None

    missing = []
    if not smtp_login(settings):
        missing.append("SMTP_USER (or EMAIL_USER)")
    if not smtp_password(settings):
        missing.append("SMTP_PASS (or EMAIL_APP_PASSWORD)")
    if not from_header(settings):
        missing.append("MAIL_FROM (a verified sender)")

    if missing:
        return (
            f"Sending is not configured — set {', '.join(missing)}. "
            "Or set the GMAIL_* OAuth values to send via the Gmail API, or keep "
            "DRY_RUN=true."
        )
    return (
        "Sending is not configured. Set SMTP_USER / SMTP_PASS / MAIL_FROM, or the "
        "GMAIL_* OAuth values, or keep DRY_RUN=true."
    )


def verify(settings: Settings) -> tuple[bool, str | None]:
    """Open a connection and authenticate, without sending. Never raises.

    Backs the health endpoint: a credential that is wrong should be visible before a
    recruiter discovers it by sending fifty invites that all fail.
    """
    hint = config_hint(settings)
    if hint:
        return False, hint
    if provider(settings) in (DRY_RUN, GMAIL_API):
        # Nothing to open: dry-run sends nothing, and the Gmail API path has no SMTP
        # connection to test.
        return True, None

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls()
            smtp.login(smtp_login(settings), smtp_password(settings))
        return True, None
    except Exception as exc:  # noqa: BLE001 - a health check must never raise
        return False, f"{type(exc).__name__}: {exc}"


# ── message building ──────────────────────────────────────────────────────────

_TAG = re.compile(r"<[^>]+>")
_WHITESPACE = re.compile(r"\s+")


def html_to_text(html: str) -> str:
    """A plain-text alternative derived from the HTML body.

    Not cosmetic: an HTML-only message scores worse with spam filters, and the
    previous fixed "requires an HTML-capable mail client" string told a text-only
    reader nothing at all. Matches the Express derivation so both produce the same
    fallback.
    """
    return _WHITESPACE.sub(" ", _TAG.sub(" ", html or "")).strip()


def build_message(
    settings: Settings,
    *,
    to_email: str,
    to_name: str | None,
    subject: str,
    body: str,
    is_html: bool,
    from_override: str | None = None,
    reply_to: str | None = None,
    headers: dict[str, str] | None = None,
) -> EmailMessage:
    """One message, ready to send. Pure, so header handling is directly testable."""
    message = EmailMessage()
    message["To"] = formataddr((to_name, to_email)) if to_name else to_email
    message["From"] = from_header(settings, from_override)
    message["Subject"] = subject

    if reply_to and reply_to.strip():
        message["Reply-To"] = reply_to.strip()

    for name, value in (headers or {}).items():
        # A newline in a header value would let a caller inject additional headers.
        # These values carry an interview id, but the guard belongs here regardless.
        cleaned = str(value).replace("\r", " ").replace("\n", " ")
        message[name] = cleaned

    if is_html:
        message.set_content(html_to_text(body) or "This email requires an HTML-capable mail client.")
        message.add_alternative(body, subtype="html")
    else:
        message.set_content(body)

    return message


def _send_smtp(settings: Settings, message: EmailMessage) -> None:
    password = smtp_password(settings)
    login = smtp_login(settings)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        smtp.starttls()
        try:
            smtp.login(login, password)
        except smtplib.SMTPAuthenticationError as exc:
            if _is_gmail_host(settings):
                raise MailerNotConfigured(
                    f"Gmail rejected the login for {login} ({exc.smtp_code}). "
                    "EMAIL_APP_PASSWORD must be a 16-character App Password from "
                    "https://myaccount.google.com/apppasswords (2-Step Verification "
                    "required), not your normal account password."
                ) from exc
            # 525 is not a credential problem, and saying "check SMTP_USER and
            # SMTP_PASS" for it sends the operator to the one place that is fine.
            # Brevo answers 5.7.1 "Unauthorized IP address" when the sending host
            # is not on the account's authorised-IP list, which is a dashboard
            # setting no amount of key-checking will fix.
            detail = (exc.smtp_error or b"").decode("utf-8", "replace").strip()
            if exc.smtp_code == 525 or "unauthorized ip" in detail.lower():
                raise MailerNotConfigured(
                    f"{settings.smtp_host} accepted the credentials but refused this "
                    f"server's IP address ({exc.smtp_code} {detail}). The login is "
                    "fine — allow this machine's public IP in the provider's "
                    "authorised-IP list (Brevo: Senders, Domains & IPs -> Authorised "
                    "IPs), or turn the IP restriction off."
                ) from exc
            raise MailerNotConfigured(
                f"{settings.smtp_host} rejected the login for {login} "
                f"({exc.smtp_code}). Check SMTP_USER and SMTP_PASS."
            ) from exc
        smtp.send_message(message)


@lru_cache
def _gmail_service(client_id: str, client_secret: str, refresh_token: str):
    """Build (and cache) a Gmail service so we don't refresh a token per send."""
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    creds = Credentials(
        None,
        refresh_token=refresh_token,
        client_id=client_id,
        client_secret=client_secret,
        token_uri=_TOKEN_URI,
        scopes=GMAIL_SCOPES,
    )
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _send_gmail_api(settings: Settings, message: EmailMessage) -> None:
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    service = _gmail_service(
        settings.gmail_client_id,
        settings.gmail_client_secret,
        settings.gmail_refresh_token,
    )
    service.users().messages().send(userId="me", body={"raw": raw}).execute()


def send(
    settings: Settings,
    *,
    to_email: str,
    to_name: str | None = None,
    subject: str,
    body: str,
    is_html: bool = True,
    from_override: str | None = None,
    reply_to: str | None = None,
    headers: dict[str, str] | None = None,
) -> Delivery:
    """Send one email. Blocking; raises on failure so the caller can report it.

    The three keyword arguments after `is_html` are additive — every existing caller
    omits them and behaves exactly as before.
    """
    mode = provider(settings)

    if mode == DRY_RUN:
        logger.info(
            "[DRY_RUN] would send to %s | subject=%r | %d chars", to_email, subject, len(body)
        )
        return Delivery(sent=False, provider=DRY_RUN, dry_run=True)

    if mode == UNCONFIGURED:
        raise MailerNotConfigured(config_hint(settings) or "Mailer is not configured.")

    message = build_message(
        settings,
        to_email=to_email,
        to_name=to_name,
        subject=subject,
        body=body,
        is_html=is_html,
        from_override=from_override,
        reply_to=reply_to,
        headers=headers,
    )

    if mode == GMAIL_API:
        _send_gmail_api(settings, message)
    else:
        _send_smtp(settings, message)

    logger.info("sent to %s via %s", to_email, mode)
    # The Message-ID the receiving server will report against. Generated by
    # `EmailMessage` if the caller did not supply one.
    return Delivery(
        sent=True, provider=mode, message_id=str(message.get("Message-ID") or "")
    )


def sender_address(settings: Settings, override: str | None = None) -> str:
    """Just the address part of the active `From`, for logging and status."""
    return parseaddr(from_header(settings, override))[1]

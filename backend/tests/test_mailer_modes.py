"""The mailer's configuration modes.

This module is shared kernel: the mobile app's `/api/emails/send` runs through it. The
rewrite separated the SMTP login from the sender so Brevo can work at all, and the
whole point is that **an existing Gmail deployment keeps working with no env change**.
That is what most of this file pins.
"""

from __future__ import annotations

import pytest

from app import mailer
from app.config import Settings

APP_PASSWORD = "abcd" * 4  # 16 characters, as Google issues them


def gmail(**overrides) -> Settings:
    """A deployment configured the old way, before SMTP_USER/PASS/MAIL_FROM existed.

    Built on `blank()` so the *absence* of SMTP_USER/PASS/MAIL_FROM is part of the
    fixture rather than an accident of the developer's `.env`. That absence is the
    whole point — these tests assert the fallback to EMAIL_USER — and when the
    deployment moved to Office 365 the ambient SMTP_USER silently took precedence
    and four of them failed.
    """
    return blank(
        **{
            "smtp_host": "smtp.gmail.com",
            "email_user": "talent@acme.test",
            "email_app_password": APP_PASSWORD,
            "from_name": "Acme Talent",
            **overrides,
        }
    )


def brevo(**overrides) -> Settings:
    return blank(
        **{
            "smtp_host": "smtp-relay.brevo.com",
            "smtp_user": "9a1b2c@smtp-brevo.com",
            "smtp_pass": "xsmtpsib-0123456789abcdef",
            "mail_from": "Acme Talent <talent@acme.test>",
            # Deliberately absent: Brevo needs no EMAIL_USER, and requiring one was
            # the bug that made the old mailer Gmail-only.
            "email_user": "",
            **overrides,
        }
    )


# ── backwards compatibility ───────────────────────────────────────────────────


def test_an_existing_gmail_deployment_still_resolves_to_smtp() -> None:
    assert mailer.provider(gmail()) == mailer.SMTP
    assert mailer.config_hint(gmail()) is None


def test_the_gmail_login_falls_back_to_email_user() -> None:
    settings = gmail()
    assert mailer.smtp_login(settings) == "talent@acme.test"
    assert mailer.smtp_password(settings) == APP_PASSWORD


def test_the_gmail_from_is_built_from_the_display_name() -> None:
    assert mailer.from_header(gmail()) == "Acme Talent <talent@acme.test>"


def test_app_password_spaces_are_stripped() -> None:
    """Google displays it in groups of four; the spaces are not part of the value."""
    settings = gmail(email_app_password="abcd efgh ijkl mnop")
    assert mailer.smtp_password(settings) == "abcdefghijklmnop"
    assert mailer.config_hint(settings) is None


def test_the_gmail_api_path_still_wins_when_oauth_is_configured() -> None:
    settings = gmail(
        gmail_client_id="cid", gmail_client_secret="secret", gmail_refresh_token="rt"
    )
    assert mailer.provider(settings) == mailer.GMAIL_API


def test_gmail_api_needs_the_sending_address() -> None:
    """The Gmail API sends as a specific mailbox; without it there is nothing to be."""
    settings = Settings(
        dry_run=False,
        email_user="",
        gmail_client_id="cid",
        gmail_client_secret="secret",
        gmail_refresh_token="rt",
    )
    assert mailer.provider(settings) != mailer.GMAIL_API


# ── Brevo ─────────────────────────────────────────────────────────────────────


def test_a_brevo_deployment_is_detected_by_host() -> None:
    assert mailer.provider(brevo()) == mailer.BREVO
    assert mailer.config_hint(brevo()) is None


def test_brevo_needs_no_email_user() -> None:
    """The old mailer returned "unconfigured" without EMAIL_USER, which made this
    configuration impossible."""
    assert mailer.provider(brevo()) == mailer.BREVO
    assert mailer.smtp_login(brevo()) == "9a1b2c@smtp-brevo.com"


def test_the_login_and_the_sender_are_independent() -> None:
    """The whole reason for the rewrite: Brevo authenticates as one address and sends
    as another."""
    settings = brevo()
    assert mailer.smtp_login(settings) == "9a1b2c@smtp-brevo.com"
    assert mailer.from_header(settings) == "Acme Talent <talent@acme.test>"
    assert mailer.sender_address(settings) == "talent@acme.test"


def test_the_app_password_rule_does_not_apply_off_gmail() -> None:
    """A Brevo SMTP key is far longer than 16 characters; a Gmail-shaped validation
    would reject a perfectly good credential."""
    assert mailer.config_hint(brevo()) is None


def test_a_short_gmail_password_is_still_caught() -> None:
    settings = gmail(email_app_password="short")
    hint = mailer.config_hint(settings)
    assert hint and "16-character" in hint


def test_any_other_smtp_host_reports_as_plain_smtp() -> None:
    settings = brevo(smtp_host="mail.acme.test")
    assert mailer.provider(settings) == mailer.SMTP
    assert mailer.config_hint(settings) is None


# ── dry run and unconfigured ──────────────────────────────────────────────────


def test_dry_run_wins_over_everything() -> None:
    """An explicit switch: a deployment that sets it wants nothing delivered."""
    assert mailer.provider(brevo(dry_run=True)) == mailer.DRY_RUN
    assert mailer.provider(gmail(dry_run=True)) == mailer.DRY_RUN


def test_dry_run_reports_ready() -> None:
    assert mailer.config_hint(Settings(dry_run=True)) is None


def test_a_dry_run_send_reports_itself_and_delivers_nothing() -> None:
    result = mailer.send(
        Settings(dry_run=True), to_email="a@x.test", subject="S", body="<p>B</p>"
    )
    assert result.sent is False
    assert result.dry_run is True
    assert result.provider == mailer.DRY_RUN


def test_the_flutter_dry_run_label_is_unchanged() -> None:
    """`send_report.dart` tests `provider == 'dry_run'` literally."""
    assert mailer.DRY_RUN == "dry_run"


def blank(**overrides) -> Settings:
    """Settings with every mail field explicitly empty.

    Necessary because `Settings()` reads the developer's real `.env`: leaving a field
    unset would let an ambient `EMAIL_APP_PASSWORD` satisfy the very requirement a
    test is asserting is missing, and the test would pass on one machine and fail on
    another.
    """
    return Settings(
        **{
            "dry_run": False,
            # Pinned to a host with no special-casing, so neither the Gmail
            # App-Password rule nor the Brevo branch can fire by inheritance.
            "smtp_host": "mail.example.test",
            "email_user": "",
            "email_app_password": "",
            "smtp_user": "",
            "smtp_pass": "",
            "mail_from": "",
            "gmail_client_id": "",
            "gmail_client_secret": "",
            "gmail_refresh_token": "",
            **overrides,
        }
    )


@pytest.mark.parametrize(
    "overrides,missing",
    [
        ({}, "SMTP_USER"),
        ({"smtp_user": "u", "mail_from": "a@x.test"}, "SMTP_PASS"),
        ({"smtp_user": "u", "smtp_pass": "p"}, "MAIL_FROM"),
    ],
)
def test_the_hint_names_what_is_missing(overrides: dict, missing: str) -> None:
    hint = mailer.config_hint(blank(**overrides))
    assert hint and missing in hint


def test_an_unconfigured_send_raises_rather_than_reporting_success() -> None:
    with pytest.raises(mailer.MailerNotConfigured):
        mailer.send(blank(), to_email="a@x.test", subject="S", body="B")


def test_a_fully_blank_config_is_unconfigured() -> None:
    assert mailer.provider(blank()) == mailer.UNCONFIGURED


# ── message building ──────────────────────────────────────────────────────────


def _message(**kwargs):
    return mailer.build_message(
        brevo(),
        to_email="ada@example.test",
        to_name=kwargs.pop("to_name", None),
        subject=kwargs.pop("subject", "Subject"),
        body=kwargs.pop("body", "<p>Hello <strong>Ada</strong></p>"),
        is_html=kwargs.pop("is_html", True),
        **kwargs,
    )


def test_a_per_send_from_override_wins() -> None:
    """The recruiter picks among verified senders per campaign."""
    message = _message(from_override="Other Team <other@acme.test>")
    assert message["From"] == "Other Team <other@acme.test>"


def test_a_blank_override_falls_back_to_the_configured_sender() -> None:
    assert _message(from_override="   ")["From"] == "Acme Talent <talent@acme.test>"


def test_reply_to_is_set_when_given() -> None:
    assert _message(reply_to="reply@acme.test")["Reply-To"] == "reply@acme.test"
    assert _message()["Reply-To"] is None
    assert _message(reply_to="  ")["Reply-To"] is None


def test_custom_headers_are_carried() -> None:
    """`X-Mailin-custom` carries the interview id — without it Brevo's delivery
    webhooks cannot be correlated back to a recipient."""
    message = _message(headers={"X-Mailin-custom": '{"interviewId":"abc"}'})
    assert message["X-Mailin-custom"] == '{"interviewId":"abc"}'


def test_a_newline_in_a_header_cannot_inject_another_header() -> None:
    message = _message(headers={"X-Mailin-custom": "a\r\nBcc: attacker@evil.test"})
    value = message["X-Mailin-custom"]
    assert "\n" not in value and "\r" not in value
    assert message["Bcc"] is None


def test_a_recipient_name_is_formatted() -> None:
    assert _message(to_name="Ada Lovelace")["To"] == "Ada Lovelace <ada@example.test>"
    assert _message()["To"] == "ada@example.test"


def test_an_html_body_gets_a_text_alternative_derived_from_it() -> None:
    """An HTML-only message scores worse with spam filters, and the old fixed string
    told a text-only reader nothing."""
    message = _message(body="<p>Hello <strong>Ada</strong></p>")
    text = message.get_body(preferencelist=("plain",)).get_content()
    assert "Hello" in text and "Ada" in text
    assert "<strong>" not in text
    assert message.get_body(preferencelist=("html",)) is not None


def test_a_plain_text_body_stays_single_part() -> None:
    message = _message(body="Just text", is_html=False)
    assert message.get_body(preferencelist=("html",)) is None
    assert "Just text" in message.get_content()


def test_html_to_text_collapses_markup_and_whitespace() -> None:
    assert mailer.html_to_text("<p>A</p>\n<p>  B  </p>") == "A B"
    assert mailer.html_to_text("") == ""
    assert mailer.html_to_text(None) == ""


def test_an_html_body_that_reduces_to_nothing_still_has_a_text_part() -> None:
    """A message with an empty text part is malformed."""
    message = _message(body="<br><br>")
    assert message.get_body(preferencelist=("plain",)).get_content().strip()


# ── verify ────────────────────────────────────────────────────────────────────


def test_verify_reports_the_config_problem_without_connecting() -> None:
    ok, error = mailer.verify(Settings(dry_run=False, email_user="", smtp_user=""))
    assert ok is False
    assert error and "SMTP_USER" in error


def test_verify_is_a_no_op_for_dry_run() -> None:
    assert mailer.verify(Settings(dry_run=True)) == (True, None)


def test_verify_never_raises_on_an_unreachable_host() -> None:
    """It backs a health check, so a wrong host must be reported, not thrown."""
    settings = brevo(smtp_host="localhost", smtp_port=1)
    ok, error = mailer.verify(settings)
    assert ok is False
    assert error

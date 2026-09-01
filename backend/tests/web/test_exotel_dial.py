"""Building an Exotel outbound call, as a pure request.

The dial itself is one HTTP POST. What is worth testing is everything decided
BEFORE that POST: which number is called, which flow answers, how the call is
tied back to the demo request that caused it, and what happens to a number typed
by a human into a web form.

Nothing here reaches the network. A test that dials a phone is not a test.
"""

from __future__ import annotations

import pytest

from app.web.services.exotel import (
    InvalidNumber,
    dial_body,
    flow_url,
    normalise_msisdn,
)

SID = "talbotiq2"
EXOPHONE = "04041895025"
APP = 1330803


# ── the number a human typed ──────────────────────────────────────────────────


def test_a_plain_ten_digit_indian_mobile_becomes_e164() -> None:
    assert normalise_msisdn("7416062640", default_cc="91") == "+917416062640"


def test_a_leading_zero_is_a_trunk_prefix_not_a_digit() -> None:
    """`07416062640` is how the number is written domestically. Keeping the zero
    dials a different number, or nothing at all."""
    assert normalise_msisdn("07416062640", default_cc="91") == "+917416062640"


def test_an_already_international_number_is_left_alone() -> None:
    assert normalise_msisdn("+917416062640", default_cc="91") == "+917416062640"


def test_the_double_zero_prefix_is_understood_as_plus() -> None:
    assert normalise_msisdn("00917416062640", default_cc="91") == "+917416062640"


def test_spaces_dashes_and_brackets_are_ignored() -> None:
    assert normalise_msisdn(" (074) 1606-2640 ", default_cc="91") == "+917416062640"


def test_a_non_indian_number_keeps_its_own_country_code() -> None:
    assert normalise_msisdn("+60123456789", default_cc="91") == "+60123456789"


def test_an_empty_number_is_refused() -> None:
    with pytest.raises(InvalidNumber):
        normalise_msisdn("   ", default_cc="91")


def test_a_number_that_is_too_short_is_refused() -> None:
    """Refused rather than dialled. A wrong number is a stranger's phone ringing."""
    with pytest.raises(InvalidNumber):
        normalise_msisdn("12345", default_cc="91")


def test_letters_are_refused_rather_than_stripped_into_a_wrong_number() -> None:
    with pytest.raises(InvalidNumber):
        normalise_msisdn("call-me-maybe", default_cc="91")


# ── the flow that answers ─────────────────────────────────────────────────────


def test_the_flow_url_points_at_this_accounts_app() -> None:
    assert flow_url(sid=SID, app_id=APP) == (
        "http://my.exotel.com/talbotiq2/exoml/start_voice/1330803"
    )


# ── the request ───────────────────────────────────────────────────────────────


def _body(**kw):
    args = dict(
        to_number="07416062640",
        caller_id=EXOPHONE,
        sid=SID,
        app_id=APP,
        status_callback="https://example.test/hook",
        reference="demo_req_abc123",
    )
    args.update(kw)
    return dial_body(**args)


def test_the_prospect_is_the_leg_that_is_dialled() -> None:
    """Exotel's `From` is the party it rings first. For an agent-initiated call
    that is the prospect, and `Url` is the flow that answers them."""
    assert _body()["From"] == "+917416062640"


def test_the_exophone_is_the_caller_id() -> None:
    assert _body()["CallerId"] == EXOPHONE


def test_the_flow_answers_rather_than_a_second_human() -> None:
    body = _body()
    assert body["Url"].endswith("/exoml/start_voice/1330803")
    assert "To" not in body


def test_the_demo_request_travels_with_the_call() -> None:
    """CustomField comes back on every status callback. Without it the webhook
    cannot say WHICH demo request a ringing phone belongs to, and the booking it
    is meant to confirm is unreachable."""
    assert _body()["CustomField"] == "demo_req_abc123"


def test_status_callbacks_are_requested_for_every_transition() -> None:
    body = _body()
    assert body["StatusCallback"] == "https://example.test/hook"
    assert body.get("StatusCallbackContentType") == "application/json"


def test_a_bad_number_fails_before_any_request_is_built() -> None:
    with pytest.raises(InvalidNumber):
        _body(to_number="nope")

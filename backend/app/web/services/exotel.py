"""Placing an outbound call through Exotel.

The dial is one POST. Everything interesting happens before it.

WHICH API. Exotel's v2 (AgentStream) exposes bidirectional streaming as a first-
class parameter on the call. This account answers `Exotel API Version v2 not
supported. Contact Exotel for details.`, so v2 is unavailable to it. That does NOT
block outbound calling, and it does not block the voicebot: the older path is a v1
call whose `Url` points at an ExoML flow, and the flow carries the Voicebot applet
with its WebSocket. So the streaming URL is configured in the DASHBOARD, on the
flow, rather than passed per call — and this module aims a call at that flow.

WHY `From` IS THE PROSPECT. In Exotel's connect API the `From` leg is the party it
rings first. For an agent-initiated call that is the prospect; `Url` is what
answers them. Passing a `To` as well would connect two humans, which is a
different product.

WHY `CustomField` MATTERS. It is echoed on every status callback. Without it a
webhook knows a phone rang but not WHICH demo request it belonged to, and the
booking it exists to confirm is unreachable. It is the correlation id, and it is
the difference between a call log and a system.

NUMBERS ARE REFUSED, NOT REPAIRED. A number that cannot be understood raises
rather than being coerced into something dialable. The failure mode of guessing is
a stranger's phone ringing, unprompted, from a business they have never heard of.
"""

from __future__ import annotations

import logging
import re

import httpx

from app.config import Settings
from app.providers.base import http_client

logger = logging.getLogger("web.exotel")

API_BASE = "https://api.exotel.com"

# ITU E.164 allows at most 15 digits including the country code; nothing shorter
# than 8 is a dialable subscriber number in the markets this serves.
_MIN_DIGITS = 8
_MAX_DIGITS = 15


class ExotelNotConfigured(RuntimeError):
    """No telephony credentials, so no call can be placed. Raised, never
    worked around — a silently skipped call looks identical to a happy one."""


class ExotelUnavailable(RuntimeError):
    """Configured but did not answer. Transient; the queue should retry."""


class InvalidNumber(ValueError):
    """The number cannot be understood. Better than dialling a guess."""


def normalise_msisdn(raw: str, *, default_cc: str) -> str:
    """A human-typed number as E.164, or an exception.

    Handles the three ways the same Indian mobile is written in practice:
    `7416062640`, `07416062640` (domestic trunk prefix) and `+917416062640`.
    The leading zero is a trunk prefix, not a digit — keeping it dials something
    else, or nothing.
    """
    text = str(raw or "").strip()
    if not text:
        raise InvalidNumber("no phone number given")

    plus = text.startswith("+") or text.startswith("00")
    digits = re.sub(r"\D", "", text)
    if not digits:
        raise InvalidNumber(f"no digits in {raw!r}")
    # Letters that were stripped to nothing usable are a typo, not a number.
    if len(re.sub(r"[\d\s()+\-.]", "", text)) > 0:
        raise InvalidNumber(f"{raw!r} contains characters that are not a phone number")

    if text.startswith("00"):
        digits = digits[2:]
    elif not plus:
        # Domestic form: drop the trunk prefix, then apply the country code.
        digits = digits.lstrip("0")
        digits = f"{default_cc}{digits}"

    if not (_MIN_DIGITS <= len(digits) <= _MAX_DIGITS):
        raise InvalidNumber(f"{raw!r} is not a dialable length ({len(digits)} digits)")
    return f"+{digits}"


def flow_url(*, sid: str, app_id: int | str) -> str:
    """The ExoML flow that answers the call. Where the Voicebot applet lives."""
    return f"http://my.exotel.com/{sid}/exoml/start_voice/{app_id}"


def dial_body(
    *,
    to_number: str,
    caller_id: str,
    sid: str,
    app_id: int | str,
    status_callback: str,
    reference: str,
    default_cc: str = "91",
) -> dict[str, str]:
    """The form body for `POST /v1/Accounts/{sid}/Calls/connect.json`.

    Pure, so the whole shape of an outbound call is testable without a phone.
    """
    body = {
        # The leg Exotel rings first: the prospect.
        "From": normalise_msisdn(to_number, default_cc=default_cc),
        "CallerId": caller_id,
        # The flow answers, not a second person.
        "Url": flow_url(sid=sid, app_id=app_id),
        "StatusCallback": status_callback,
        "StatusCallbackContentType": "application/json",
        # Echoed on every callback. This is how a ringing phone is tied back to
        # the demo request that caused it.
        "CustomField": reference,
    }
    return body


def configured(settings: Settings) -> bool:
    return bool(
        getattr(settings, "exotel_api_key", "").strip()
        and getattr(settings, "exotel_api_token", "").strip()
        and getattr(settings, "exotel_sid", "").strip()
        and getattr(settings, "exotel_caller_id", "").strip()
    )


def _auth(settings: Settings) -> tuple[str, str]:
    if not configured(settings):
        raise ExotelNotConfigured(
            "Outbound calling is not configured. Set EXOTEL_SID, EXOTEL_API_KEY, "
            "EXOTEL_API_TOKEN, EXOTEL_CALLER_ID and EXOTEL_APP_ID."
        )
    return settings.exotel_api_key.strip(), settings.exotel_api_token.strip()


async def place_call(
    settings: Settings, *, to_number: str, reference: str, status_callback: str
) -> dict:
    """Ring the prospect and hand them to the flow. Returns Exotel's call record.

    Not idempotent by itself and deliberately so: the caller owns that, via the
    Cloud Tasks task name derived from the demo request id. Two calls to this
    function ring the prospect twice, which is exactly why nothing should call it
    outside the queue.
    """
    sid = settings.exotel_sid.strip()
    body = dial_body(
        to_number=to_number,
        caller_id=settings.exotel_caller_id.strip(),
        sid=sid,
        app_id=settings.exotel_app_id,
        status_callback=status_callback,
        reference=reference,
    )
    subdomain = (getattr(settings, "exotel_subdomain", "") or "api.exotel.com").strip()
    try:
        response = await http_client().post(
            f"https://{subdomain}/v1/Accounts/{sid}/Calls/connect.json",
            data=body,
            auth=_auth(settings),
        )
    except httpx.HTTPError as exc:
        raise ExotelUnavailable(f"exotel did not answer: {exc}") from exc
    if response.status_code >= 400:
        # The body carries Exotel's own reason; it is the only useful diagnostic.
        raise ExotelUnavailable(
            f"exotel refused the call ({response.status_code}): {response.text[:200]}"
        )
    logger.info("outbound call placed for %s", reference)
    return response.json() or {}

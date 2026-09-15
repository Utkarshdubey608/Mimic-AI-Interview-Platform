"""Gemini for the web surface — key resolution, and one raw passthrough.

Ports `server/services/gemini.ts`. Two things the shared `app.providers.gemini`
client deliberately does not do:

**Runtime key resolution.** A recruiter can save a Gemini key in the web Settings
page, and it takes precedence over the environment. The mobile model is env-only
keys, and that is the eventual target for this surface too — until then, the
resolution order here mirrors the Express behaviour so nothing changes for a
recruiter mid-migration. See this package's README.

**A raw generateContent passthrough.** `POST /api/web/avatar/gemini-generate`
forwards the client's request body untouched and returns the upstream status and
body verbatim, because the browser owns the prompt, the response schema and the
parser — only the credential moved to the server. The vendor's status code is part
of that contract: the client retries 503 and 429 itself, and distinguishes a
retryable rate limit from a hard quota wall by reading the error body.
"""

from __future__ import annotations

import logging

from app.config import Settings
from app.providers.base import ProviderNotConfigured, http_client
from app.web.store import get_store

logger = logging.getLogger("web.gemini")

NAME = "Gemini"
ENV_VAR = "GEMINI_API_KEY"

GENERATE_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

DEFAULT_MODEL = "gemini-3.6-flash"


class GeminiAuthError(RuntimeError):
    """The key is missing, invalid, expired, or lacks permission.

    Separated from `GeminiUnavailable` because the two need opposite responses. An
    outage is transient and a caller can degrade quietly; a broken credential is a
    configuration fault that will never fix itself, and hiding it behind a
    fallback masks a key that is also silently breaking scoring and question
    generation elsewhere. Callers say so plainly instead.
    """


class GeminiUnavailable(RuntimeError):
    """A transient failure — outage, depleted quota, unparseable reply."""


# Signatures of a credential failure in a Gemini error body. Ports `isAuthError`
# from `server/services/autopilotAgent.ts`.
_AUTH_PATTERNS = (
    "unauthenticated",
    "invalid authentication",
    "api key",
    "api_key",
    "access_token_type_unsupported",
    "permission_denied",
)


def is_auth_failure(status_code: int, body: str) -> bool:
    """Is this error about OUR credential rather than the request?

    The status alone is not enough: Gemini returns 400 with an
    "API key not valid" body for a malformed key, which would otherwise read as
    the caller's mistake.
    """
    if status_code in (401, 403):
        return True
    lowered = (body or "").lower()
    return any(pattern in lowered for pattern in _AUTH_PATTERNS)


def to_contents(messages: list[dict]) -> list[dict]:
    """Chat history → Gemini `contents`. Pure.

    Two transformations that both callers need:

    * `assistant` becomes `model`, which is Gemini's name for the same role.
    * Leading model turns are dropped. History is trimmed to a fixed number of
      turns before it gets here, which can leave a model turn first, and Gemini
      rejects a conversation that does not open with a user turn.

    Empty messages are filtered out — they carry no context and an all-empty
    history would produce a request Gemini refuses.
    """
    contents = [
        {
            "role": "model" if message.get("role") == "assistant" else "user",
            "parts": [{"text": message.get("content") or ""}],
        }
        for message in messages
        if (message.get("content") or "").strip()
    ]
    while contents and contents[0]["role"] == "model":
        contents.pop(0)
    return contents


def user_turn(prompt: str) -> list[dict]:
    """One user message, already in the shape `contents` needs.

    Exists because building it inline is how the MCQ generator spent a day sending
    an EMPTY conversation: `to_contents` reads `content`, a `text` key is dropped
    without complaint, and the request then fails before it is ever made. The
    symptom — "Gemini request failed" — pointed at the vendor rather than at a
    misspelled dict key.

    A caller holding a single prompt should not have to know that contract. This is
    the only correct way to express it, so the mistake has nowhere left to live.
    """
    return to_contents([{"role": "user", "content": prompt}])


async def resolve_key(settings: Settings) -> str:
    """The active Gemini key: the recruiter's saved one, else the environment.

    Returns "" when neither exists; callers decide whether that is a 400 (the
    client asked for something needing a key) or a readiness flag.

    Delegated to `app_settings` so the settings document's field names live in
    exactly one module — the Express version spread them across three.
    """
    from app.web.services import app_settings

    return await app_settings.gemini_key(settings)


async def resolve_model(settings: Settings) -> str:
    """The model the deployment scores on. Not a user choice — see `app_settings`."""
    from app.web.services import app_settings

    return await app_settings.gemini_model(settings)


async def is_enabled(settings: Settings) -> bool:
    return bool(await resolve_key(settings))


def validate_model_name(model: str) -> str:
    """A Gemini model name, or raise.

    The same shape check the Express route used. NOT the `GEMINI_ALLOWED_MODELS`
    allowlist that guards the mobile surface: the web client picks among several
    models (`gemini-1.5-pro` on the personas page, 2.5 flash/pro in the invite
    wizard) and an allowlist tuned for mobile would reject them. Spend is bounded
    by the per-user rate limit on the route instead.
    """
    import re

    cleaned = (model or "").strip()
    if not re.fullmatch(r"gemini-[\w.-]+", cleaned):
        raise ValueError("Invalid model name")
    return cleaned


async def generate_content_raw(
    settings: Settings, *, model: str, request_body: dict
) -> tuple[int, bytes, str]:
    """Forward a generateContent call. Returns (status, body, content_type).

    Deliberately NOT built on `ProviderClient.request`, which raises on any error
    status. Here the upstream status and body are the payload: the client's retry
    logic reads both, so normalising them would break it.
    """
    key = await resolve_key(settings)
    if not key:
        raise ProviderNotConfigured(NAME, ENV_VAR)

    response = await http_client().post(
        f"{GENERATE_BASE}/{model}:generateContent",
        # The key rides in a header, not the query string: a URL is logged by
        # proxies and shows up in error traces, and Google accepts either.
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        json=request_body,
    )
    if response.status_code >= 400:
        # Logged without the body — a generateContent error can echo the prompt,
        # which may contain a candidate's résumé.
        logger.warning("Gemini generateContent → %s", response.status_code)

    return (
        response.status_code,
        response.content,
        response.headers.get("content-type", "application/json"),
    )


def first_text(payload: dict) -> str:
    """The first candidate's text, or "". Tolerant of every shape Gemini returns.

    A blocked or truncated generation legitimately produces a response with no
    `parts`, so every level is guarded rather than indexed — this must not raise
    on a valid-but-empty reply.
    """
    if not isinstance(payload, dict):
        return ""
    for candidate in payload.get("candidates") or []:
        if not isinstance(candidate, dict):
            continue
        parts = (candidate.get("content") or {}).get("parts") or []
        for part in parts:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                text = part["text"].strip()
                if text:
                    return text
    return ""


async def generate_text(
    settings: Settings,
    *,
    contents: list[dict],
    system_instruction: str | None = None,
    response_schema: dict | None = None,
    response_mime_type: str | None = None,
    temperature: float | None = None,
    thinking_budget: int | None = None,
) -> str:
    """One generateContent turn, returning the model's text.

    Raises `GeminiAuthError` for a credential problem and `GeminiUnavailable` for
    anything else, so callers can degrade differently for the two — see those
    classes for why that distinction matters.

    `thinking_budget` is the reasoning-token allowance. Gemini 2.5 Flash thinks by
    default with a *dynamic* budget, which is the right trade for open-ended work
    and the wrong one for a call a candidate is sitting and waiting on. Measured
    over five runs of the résumé question prompt: default thinking averaged 11.1s
    (7.5–12.9s, ~1200–2000 thinking tokens), and `thinking_budget=0` averaged 3.6s
    (2.9–4.4s) for output of the same length. Pass 0 on any candidate-facing path;
    leave it None where quality matters more than the wait.
    """
    import json as _json

    if not contents:
        raise GeminiUnavailable("No conversation to send.")

    body: dict = {"contents": contents}
    if system_instruction:
        body["systemInstruction"] = {"parts": [{"text": system_instruction}]}

    generation_config: dict = {}
    if response_mime_type:
        generation_config["responseMimeType"] = response_mime_type
    if response_schema:
        generation_config["responseSchema"] = response_schema
    if temperature is not None:
        generation_config["temperature"] = temperature
    if thinking_budget is not None:
        generation_config["thinkingConfig"] = {"thinkingBudget": thinking_budget}
    if generation_config:
        body["generationConfig"] = generation_config

    model = await resolve_model(settings)
    try:
        status_code, raw, _ = await generate_content_raw(
            settings, model=model, request_body=body
        )
    except ProviderNotConfigured as exc:
        raise GeminiAuthError(str(exc)) from exc

    if status_code >= 400:
        detail = raw.decode("utf-8", "replace")[:500]
        # The DETAIL travels with the exception, because a status code alone cannot
        # tell a malformed key from a project Google has denied access to — both are
        # 403, and the advice for one is the opposite of the advice for the other.
        # `question_gen.friendly_error` reads this to decide which. Without it, a
        # perfectly good key whose project had been blocked was reported as a typo,
        # sending people to check the one thing that was fine.
        if is_auth_failure(status_code, detail):
            raise GeminiAuthError(f"Gemini rejected the credential ({status_code}). {detail}")
        raise GeminiUnavailable(f"Gemini returned {status_code}. {detail}")

    try:
        payload = _json.loads(raw)
    except ValueError as exc:
        raise GeminiUnavailable("Gemini returned a body that is not JSON.") from exc

    return first_text(payload)

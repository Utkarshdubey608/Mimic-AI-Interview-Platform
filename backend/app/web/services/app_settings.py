"""The `web_settings` document — the one place its field names are known.

Ports the read/write half of `server/routes/settings.ts`, `services/gemini.ts`'s
`keyStatus`, and `services/tavusServer.ts`'s key resolution.

This holds recruiter-entered API keys, which is a **deliberate divergence from the
mobile model**. The Flutter app holds no vendor keys at all and reads feature
availability from the server (`/health`'s `providers` map); the web Settings page
still lets a recruiter type a Gemini or Tavus key. That is preserved so nothing
changes for a recruiter mid-migration, and it is the first thing to remove when
consolidating — at which point this module reduces to the avatar config.

**A key is never returned to a client.** Every status response is masked, and the
masking refuses to reveal a short value rather than echoing most of it back.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.config import Settings
from app.web.store import get_store

logger = logging.getLogger("web.app_settings")

# Field names on the settings document. Named here so no other module has to know
# them — the Express version spread these across three files.
GEMINI_KEY = "geminiApiKey"
GEMINI_MODEL = "geminiModel"
TAVUS_KEY = "tavusApiKey"
AVATAR = "avatar"

# Below this length a key is masked entirely. `first4…last4` on a 6-character value
# would echo the whole thing back, which defeats the point of masking.
_MIN_MASKABLE = 12


def mask(key: str | None) -> str | None:
    """`AIza…9xYz`, or None. Never reveals a short value."""
    cleaned = (key or "").strip()
    if not cleaned:
        return None
    if len(cleaned) < _MIN_MASKABLE:
        return "…"
    return f"{cleaned[:4]}…{cleaned[-4:]}"


async def document(settings: Settings) -> dict:
    """The settings document, or `{}`. Never raises.

    A missing document is the normal state of a fresh deployment, and an
    unreachable Firestore must not stop an env-configured key from working.
    """
    try:
        return await get_store(settings).settings.get()
    except Exception as exc:  # noqa: BLE001 - degrade to env-only configuration
        logger.warning("could not read web settings: %s", type(exc).__name__)
        return {}


# ── Gemini ────────────────────────────────────────────────────────────────────


def _str(value: object) -> str:
    return str(value).strip() if isinstance(value, str) else ""


async def gemini_key(settings: Settings) -> str:
    """The active Gemini key: the recruiter's saved one, else the environment."""
    doc = await document(settings)
    return _str(doc.get(GEMINI_KEY)) or settings.gemini_api_key.strip()


async def gemini_model(settings: Settings) -> str:
    """The model the deployment scores on.

    NOT a user choice. It was briefly per-account and before that it was a `web_settings`
    value a recruiter could change from the browser — which, being a global singleton,
    changed it for every recruiter on the deployment. Both are gone: the model is
    deployment configuration like the key it goes with, and there is no route that
    writes it.

    The stored value is still READ so a deployment that has one keeps working; nothing
    can set it any more. Set `GEMINI_MODEL` in the environment instead.
    """
    doc = await document(settings)
    return _str(doc.get(GEMINI_MODEL)) or settings.gemini_model.strip() or "gemini-3.6-flash"


async def gemini_status(settings: Settings) -> dict:
    """What the Settings page shows. Masked — the raw key never leaves here."""
    doc = await document(settings)
    saved = _str(doc.get(GEMINI_KEY))
    env = settings.gemini_api_key.strip()
    active = saved or env

    return {
        "geminiKeySet": bool(active),
        "geminiKeyMasked": mask(active),
        # Which one is winning, so a recruiter can tell whether their saved key is
        # in play or the deployment's env var is.
        "source": "saved" if saved else ("env" if env else "none"),
        "model": await gemini_model(settings),
    }


# ── Tavus ─────────────────────────────────────────────────────────────────────


async def tavus_key(settings: Settings) -> str:
    """The active Tavus key.

    Three sources in precedence order, matching the Express resolution: the global
    key from the Settings page, the copy stored alongside an applied avatar config,
    then the environment. The middle one exists only because the Setup page used to
    save its own copy; `save_tavus_key` keeps them in step so the order rarely
    matters.
    """
    doc = await document(settings)
    avatar = doc.get(AVATAR) if isinstance(doc.get(AVATAR), dict) else {}
    return (
        _str(doc.get(TAVUS_KEY))
        or _str((avatar or {}).get("tavusKey"))
        or settings.tavus_api_key.strip()
    )


# ── the applied avatar config ─────────────────────────────────────────────────


async def avatar_config(settings: Settings) -> dict | None:
    doc = await document(settings)
    avatar = doc.get(AVATAR)
    return avatar if isinstance(avatar, dict) and avatar else None


async def avatar_status(settings: Settings) -> dict:
    """Masked status for the recruiter UI. Never includes the key."""
    avatar = await avatar_config(settings) or {}
    key = await tavus_key(settings)
    return {
        # Candidate avatar interviews need BOTH a replica and a key; reporting
        # either alone as "configured" would promise a feature that then fails at
        # interview time.
        "configured": bool(avatar.get("replicaId")) and bool(key),
        "hasKey": bool(key),
        "replicaId": avatar.get("replicaId") or None,
        "personaId": avatar.get("personaId") or None,
        "language": avatar.get("language") or None,
        "updatedAt": avatar.get("updatedAt"),
    }


async def save_avatar(settings: Settings, config: dict) -> dict:
    """Store the recruiter's applied avatar config.

    `config` is already normalised by the route. The previously-saved Tavus key is
    carried forward when the request omits one, so re-applying a config from the
    Setup page cannot accidentally clear the key and break every candidate
    interview.
    """
    store = get_store(settings)
    previous = await avatar_config(settings) or {}
    carried = config.get("tavusKey") or previous.get("tavusKey")

    await store.settings.merge(
        {AVATAR: {**config, "tavusKey": carried, "updatedAt": _now()}}
    )
    return await avatar_status(settings)


async def clear_avatar(settings: Settings) -> dict:
    await get_store(settings).settings.unset(AVATAR)
    return await avatar_status(settings)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

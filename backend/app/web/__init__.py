"""The web surface: the Express server's API, ported and mounted at `/api/web/*`.

`install(app)` is the ONLY thing `app.main` calls. Everything this surface adds —
routes, error handlers — is registered from here, so the application entrypoint
never grows a second web-shaped line and removing the surface stays a two-edit
change: delete this package, delete the `install` call.

See README.md in this directory for the layering rules, and
`tests/test_layering.py` for their enforcement.
"""

from __future__ import annotations

from fastapi import APIRouter, FastAPI

from app.web import errors
from app.web.routes import (
    analytics,
    auth,
    avatar,
    face_cache,
    health,
    help,
    brevo_webhook,
    invite_email_templates,
    invites,
    feedback,
    leads,
    pipelines,
    question_sets,
    sessions,
    sessions_avatar,
    sessions_chat,
    sessions_twoway,
    sessions_twoway_livekit,
    settings,
    templates,
    twoway_webhook,
    voices,
    ws_deepgram,
)

# `/api/web` rather than `/api`: the common surface already owns `/api/templates`
# for the mobile app's EMAIL templates, while this surface uses that path for
# INTERVIEW templates. The prefix lets both coexist with neither renamed, and
# forecloses every future collision of the same kind.
PREFIX = "/api/web"

# Mount order matters where one path is a prefix of another — the Express server
# mounted /api/invites/brevo-webhook ahead of /api/invites, and
# /api/avatar/face-cache ahead of /api/avatar, so the more specific router wins.
# Add modules in the order their routes must be matched.
_MODULES = (
    health,
    auth,
    analytics,
    feedback,
    leads,
    help,
    # BEFORE `avatar`: /avatar/face-cache is the more specific path and must win,
    # mirroring the Express mount order. It also has different auth — it accepts
    # ?token= because a <video> element cannot send a header.
    face_cache,
    avatar,
    voices,
    templates,
    question_sets,
    sessions,
    # The session sub-tracks add paths under the same prefix. No path is a prefix of
    # another, so order between them does not matter — the core lifecycle stays first
    # to match the Express file they were split out of.
    sessions_avatar,
    sessions_chat,
    sessions_twoway,
    settings,
    invite_email_templates,
    # BEFORE `invites`: the Brevo webhook is PUBLIC (it carries its own shared
    # secret) and must not inherit the invites router's authentication.
    brevo_webhook,
    invites,
    pipelines,
    # The WebSocket relays. No HTTP path can collide with a websocket route.
    ws_deepgram,
)


def build_router() -> APIRouter:
    """The single router carrying every web route."""
    from app.config import get_settings

    livekit_two_way = get_settings().twoway_engine.strip().lower() == "livekit"

    # Two-way engine switch (ADDITIVE — the Daily module is never edited): LiveKit
    # records the call and auto-scores it; Daily does not. When LiveKit is the
    # engine, swap its module in for the Daily one so `/twoway/*` resolves to it,
    # and mount the (public, LiveKit-signed) egress webhook.
    modules = list(_MODULES)
    if livekit_two_way:
        modules[modules.index(sessions_twoway)] = sessions_twoway_livekit

    router = APIRouter(prefix=PREFIX)
    for module in modules:
        router.include_router(module.router)
    if livekit_two_way:
        router.include_router(twoway_webhook.router)
    return router


def install(app: FastAPI) -> None:
    """Attach the web surface to the application."""
    errors.register(app)
    app.include_router(build_router())

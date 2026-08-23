"""FastAPI application entrypoint.

Two responsibilities:

* **Mailer** — pick/save an email template and send mail to a list of candidates.
  No SQL database and no background queue; custom templates live in the mobile
  app's Firebase (Firestore) project.
* **AI gateway** — hold every third-party credential (Gemini, Tavus, Deepgram)
  so the mobile app holds none. The app either calls a proxy route here, or
  connects straight to Gemini Live with a short-lived token minted here.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import mailer, providers, web
from app.config import get_settings
from app.providers.base import ProviderNotConfigured, UpstreamError, aclose
from app.routers import (
    ai,
    emails,
    evaluations,
    feedback as feedback_routes,
    mcq as mcq_routes,
    mcq_sets as mcq_sets_routes,
    realtime,
    resume,
    templates,
    twoway,
)

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Own the shared HTTP client's lifetime — one connection pool, closed once."""
    yield
    await aclose()


def _register_error_handlers(app: FastAPI) -> None:
    """Turn provider failures into HTTP responses.

    Centralised so vendor modules can raise a domain error and routers stay free
    of try/except — the two failure modes are handled identically everywhere.
    """

    @app.exception_handler(ProviderNotConfigured)
    async def _not_configured(_request: Request, exc: ProviderNotConfigured):
        # 503, not 500: the service is healthy, this feature just has no key.
        return JSONResponse(status_code=503, content={"detail": str(exc)})

    @app.exception_handler(UpstreamError)
    async def _upstream(_request: Request, exc: UpstreamError):
        # The vendor's body is deliberately NOT forwarded: it can echo request
        # content, and a vendor 401 about OUR key must not look like the caller's
        # problem (see UpstreamError.client_status).
        return JSONResponse(
            status_code=exc.client_status,
            content={
                "detail": f"{exc.provider} request failed.",
                "provider": exc.provider,
                "upstream_status": exc.status_code,
            },
        )


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="3.0.0",
        summary="Interview email delivery and the AI provider gateway.",
        lifespan=lifespan,
    )

    # On state so request handlers reach settings without importing globals.
    app.state.settings = settings

    # `allow_credentials` only when the origins are an explicit list. Pairing it
    # with a "*" wildcard makes the middleware echo back whatever Origin asked,
    # so any site could make credentialed cross-origin calls. Nothing here needs
    # it: callers authenticate with a bearer token in a header, not a cookie.
    origins = settings.cors_origin_list
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=origins != ["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    _register_error_handlers(app)

    app.include_router(templates.router)
    app.include_router(emails.router)
    app.include_router(realtime.router)
    app.include_router(resume.router)
    app.include_router(evaluations.router)
    app.include_router(twoway.router)
    app.include_router(ai.router)
    # Candidate feedback. Additive: a new path on the frozen surface, and the half
    # that was missing — the prompt used to exist only in the browser.
    app.include_router(feedback_routes.router)
    # MCQ, on the SHARED surface. It was web-only because its runtime lived inside
    # `web_sessions` with the answer key; see app/mcq_runtime.py.
    app.include_router(mcq_routes.router)
    # Authoring, also shared. Both clients build papers through app/mcq_authoring.py.
    app.include_router(mcq_sets_routes.router)

    # The web surface, mounted at /api/web/*. One call by design: everything it
    # adds is registered inside the package, so removing it is deleting
    # `app/web/` and this line. See app/web/README.md.
    web.install(app)

    @app.get("/health", tags=["meta"])
    async def health() -> dict:
        """Reports what is actually configured.

        `providers` is the server's own view of which AI features are available.
        It replaces the app's old per-key "Test Connection" buttons — the client
        holds no keys, so it cannot test them.
        """
        return {
            "status": "ok",
            "provider": mailer.provider(settings),
            "sending_ready": mailer.config_hint(settings) is None,
            "hint": mailer.config_hint(settings),
            "firebase_project": settings.firebase_project_id,
            "providers": providers.readiness(settings),
        }

    return app


app = create_app()

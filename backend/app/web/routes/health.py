"""`GET /api/web/health` — what this surface can actually do right now.

Ports the Express server's `/api/health`, keeping its field names so anything
already pointed at that response keeps working. Two differences, both forced by
the move off the JSON file store:

* `persistence` reported the debounced file write's success. There is no file
  any more, so it reports whether Firestore is reachable instead.
* It stays 200 even when persistence is broken. That was deliberate on Render,
  where this path is the deploy's health check: a 503 makes the platform restart
  or fail the deploy, which cannot fix missing credentials and turns
  degraded-but-serving into a full outage. Alert on `persistence.ok === false`.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request

from app import providers
from app.firebase import is_configured
from app.web.deps import settings_of
from app.web.services import coding_judge
from app.web.store import is_ready

router = APIRouter(tags=["web:meta"])


@router.get("/health", summary="Web surface readiness")
async def health(request: Request) -> dict:
    settings = settings_of(request)
    store_ok, store_error = is_ready(settings)
    auth_ok = is_configured(settings)

    return {
        "ok": True,
        "ts": datetime.now(timezone.utc).isoformat(),
        # Kept from the Express response: the client used it to decide whether
        # adaptive questions and scoring would run or fall back to heuristics.
        "gemini": bool(settings.gemini_api_key),
        "auth": auth_ok,
        "authMode": "firebase" if auth_ok else "none",
        "persistence": {
            "ok": store_ok,
            "backend": "firestore",
            "lastError": store_error,
        },
        # The server's own view of which features have credentials. This replaces
        # the recruiter "Test Connection" buttons — the client holds no keys, so
        # it cannot test them. Mobile reads the same map from `/health`.
        "providers": providers.readiness(settings),
        # Whether the coding track can run anything. NOT in `providers` above,
        # for two reasons: that map is the COMMON surface, which the layering test
        # forbids importing `app.web` into — the judge client lives there — and the
        # Flutter app maps every one of its keys generically onto a Service Status
        # screen for features it does not have.
        #
        # Reported as CONFIGURED, not as reachable. Every entry in `providers`
        # answers "is there a credential", and a health endpoint that opened a
        # socket to a VM on every poll would be an effective way to turn a load
        # balancer into a traffic generator. Whether the judge ANSWERS is a
        # different question, and the coding routes answer 503 with a reason when
        # it does not.
        "codeExecution": coding_judge.configured(settings),
    }

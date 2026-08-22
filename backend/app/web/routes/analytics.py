"""`GET /api/web/analytics` — the recruiter dashboard. Ports `server/routes/analytics.ts`.

Real aggregates over stored reports. Every filter is optional, and no matches produces
zeros and empty arrays rather than sampled or invented data.

**Scoped to the requesting recruiter.** The Express version widened this for admins; role
gating is deferred, so every caller sees only their own sessions. That is the safer of
the two defaults — a company-wide average that silently included another recruiter's
candidates would be wrong in a way nobody would notice.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Query, Request

from app import interviews as shared_interviews
from app.security import AuthedUser
from app.web.deps import WebUser, settings_of
from app.web.services import analytics, invite_bridge
from app.web.store import get_store

logger = logging.getLogger("web.analytics")

router = APIRouter(prefix="/analytics", tags=["web:analytics"])



def _iso(value: object) -> str | None:
    """Firestore hands back a datetime; the aggregator compares ISO strings."""
    if value is None:
        return None
    as_iso = getattr(value, "isoformat", None)
    return as_iso() if callable(as_iso) else str(value)


async def _union_cohort(settings, uid: str, sessions: list[dict]) -> list[dict]:
    """Every interview belonging to this recruiter, as session-shaped rows.

    A web session is the richer record where one exists, so it wins. For an interview
    this surface never ran there is no session row at all, and one is synthesised from
    the assignment — the same fields, off the shared document.

    The session id IS the interview id, which is what makes the union a plain merge on
    one key rather than a matching problem.

    Best-effort on the interviews read: a dashboard is a summary, and a Firestore
    hiccup should degrade it to the sessions this surface knows about rather than
    failing the page. It logs, so a persistently short cohort is visible rather than
    quietly wrong.
    """
    by_id = {s["id"]: s for s in sessions if s.get("id")}

    def _fetch() -> list[dict]:
        try:
            documents = (
                shared_interviews.collection(settings)
                .where("recruiterId", "==", uid)
                .get()
            )
        except Exception as exc:  # noqa: BLE001 - a summary must still render
            logger.warning(
                "could not read interviews for analytics (%s): %s", uid, type(exc).__name__
            )
            return []
        return [(d.id, d.to_dict() or {}) for d in documents]

    for interview_id, data in await asyncio.to_thread(_fetch):
        if interview_id in by_id:
            continue
        by_id[interview_id] = {
            "id": interview_id,
            "recruiterId": uid,
            # No web template — the interview was not run from one. `templateId` is
            # left None rather than invented, so a template FILTER correctly excludes
            # these instead of matching them to something arbitrary.
            "templateId": None,
            "track": invite_bridge.track_for(data),
            "status": _session_status(str(data.get("status") or "")),
            "createdAt": _iso(data.get("createdAt")),
            "startedAt": _iso(data.get("startedAt")),
            "completedAt": _iso(data.get("completedAt")),
            # Shape matters: the aggregator counts questions per session.
            "questions": [
                {"text": q}
                for q in (data.get("questions") or [])
                if isinstance(q, str) and q.strip()
            ],
        }

    return list(by_id.values())


def _session_status(interview_status: str) -> str:
    """The invite's vocabulary translated into the session lifecycle's.

    The aggregator counts `completed` exactly and treats anything past `created` as
    started, so only those two distinctions have to survive. `assigned` maps to
    `created`: an interview nobody has opened has not been started, and counting it as
    started would inflate the funnel's first step.
    """
    if interview_status == "completed":
        return "completed"
    if interview_status in ("in_progress", "started"):
        return "in_progress"
    return "created"


@router.get("", summary="Aggregate hiring metrics")
async def summary(
    request: Request,
    track: str = Query(default=""),
    templateId: str = Query(default=""),
    role: str = Query(default=""),
    dateFrom: str = Query(default=""),
    dateTo: str = Query(default=""),
    user: AuthedUser = WebUser,
) -> dict:
    settings = settings_of(request)
    store = get_store(settings)

    # The recruiter's own sessions, plus every template (shared, so a session may use one
    # this recruiter did not author) and the reports for those sessions.
    sessions, templates = await asyncio.gather(
        store.sessions.owned_by(user.uid),
        store.templates.all(),
    )

    # …AND every interview of theirs that this surface never ran.
    #
    # The cohort used to be `web_sessions` alone, which meant an interview a candidate
    # took in the Flutter app was absent from the dashboard entirely — so the same
    # recruiter saw different totals, averages and coverage depending on which client
    # they opened. Both dashboards aggregate the same corpus now: `interviews`, joined
    # with the shared `reports`.
    cohort = await _union_cohort(settings, user.uid, sessions)

    # Reports are fetched concurrently rather than in a loop: at roughly 60ms per round
    # trip, a recruiter with 200 sessions would otherwise wait twelve seconds.
    session_ids = [session["id"] for session in cohort if session.get("id")]
    reports = await asyncio.gather(*(store.reports.get(i) for i in session_ids))

    return analytics.compute(
        cohort,
        {template["id"]: template for template in templates if template.get("id")},
        {
            session_id: report
            for session_id, report in zip(session_ids, reports)
            if report
        },
        filters={
            "track": track or None,
            "templateId": templateId or None,
            "role": role or None,
            "dateFrom": dateFrom or None,
            "dateTo": dateTo or None,
        },
        owner_id=user.uid,
    )

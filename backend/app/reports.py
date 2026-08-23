"""The scored report — one collection, one shape, both clients.

A report IS the result of one interview, so it is keyed by the interview id and never
by an id of its own. That was already true of the web surface's `web_reports`, which
keyed on `sessionId` — and since the session id IS the interview id (the invite bridge
made it so, and `POST /sessions` now does too), the promotion here is a move rather
than a re-keying.

**Why it had to move.** `web_reports` was `web_`-prefixed, so it was invisible to the
mobile app by construction. The consequence was concrete: a recruiter opening a report
on their phone for an interview a candidate had taken in a browser got nothing, and the
web sessions list showed no score for an interview taken on the phone. Two clients, two
report stores, one interview.

**The split this module defines.** An interview's outcome lives in two places, and the
division is deliberate:

  interviews/{id}.result   the FLAT summary — score, recommendation, summary,
                           strengths, improvements. The frozen Dart model reads these
                           directly, so they stay where they have always been.
  reports/{interviewId}    the RICH detail — per-question scores, KPI averages,
                           integrity, provenance. Too large and too web-shaped to sit
                           on the assignment document, and read by whichever client is
                           displaying a full report.

Both are written together, by whichever surface scored the interview. Neither client
needs to know which one that was.
"""

from __future__ import annotations

import logging

from app.config import Settings
from app.firebase import get_db

logger = logging.getLogger("reports")

REPORTS_COLLECTION = "reports"

# The field a report document carries its own id in.
#
# Still `sessionId`, not `interviewId`, and that is not an oversight. The values are
# identical — the session id IS the interview id — and the web frontend reads
# `report.sessionId` today, so renaming the field is a client-visible change that buys
# nothing. `interviewId` is written ALONGSIDE it (see `stamp_ids`) so a reader that
# knows nothing about web sessions has a field named for what it actually is, and
# `sessionId` can be dropped once no caller reads it.
KEY_FIELD = "sessionId"


def collection(settings: Settings):
    """The shared `reports` collection."""
    return get_db(settings).collection(REPORTS_COLLECTION)


def stamp_ids(report: dict, interview_id: str) -> dict:
    """Both id fields on a report, so either name resolves it.

    `sessionId` for the existing web frontend, `interviewId` for every reader that
    arrives later and should not have to learn what a web session is.
    """
    return {**report, "sessionId": interview_id, "interviewId": interview_id}


def build_result_summary(report: dict) -> dict:
    """The flat `interviews.result` block for a scored report.

    Shaped for the frozen Dart reader: the fields it displays, at the top level, with
    the names it already uses. Anything richer belongs in the report document — see
    this module's docstring for the split.

    `recommendation` is defaulted rather than omitted because the mobile model reads it
    directly and a missing value renders as an empty badge.

    `resultPublished` is deliberately absent: releasing a result to the candidate is a
    recruiter action, and writing it here would publish every score automatically.
    """
    return {
        "overallScore": report.get("overallScore", 0),
        "summary": report.get("summary") or "",
        "recommendation": report.get("recommendation") or "maybe",
        "strengths": report.get("strengths") or [],
        "improvements": report.get("improvements") or [],
        "evaluatedBy": "ai",
    }

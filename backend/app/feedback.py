"""What a candidate thought of the interview — one collection, both clients.

Keyed by interview id, like reports: one interview, one verdict, and a resubmission
replaces rather than duplicates.

**Why it moved.** This was `web_feedback`, so the prompt existed only in the browser: a
candidate who interviewed on the phone was never asked. It is the only channel the
product has for hearing from candidates, and it was collecting from roughly half of
them — with no indication in the data that the other half had been skipped rather than
declining to answer.

**What a candidate may write, and what the server owns.** The rating and the comment are
theirs. Everything else — which recruiter, which track, which role — is resolved
server-side from the interview, because a feedback row is aggregated on a recruiter's
dashboard and a client-supplied `recruiterId` would let anyone write into anyone's
numbers.
"""

from __future__ import annotations

import logging

from app.config import Settings
from app.firebase import get_db

logger = logging.getLogger("feedback")

FEEDBACK_COLLECTION = "feedback"

# A verdict, not an essay. Bounds what is stored and what a dashboard has to render.
MAX_COMMENT_CHARS = 2_000
MIN_RATING = 1
MAX_RATING = 5


def collection(settings: Settings):
    """The shared `feedback` collection."""
    return get_db(settings).collection(FEEDBACK_COLLECTION)


def clean_rating(value: object) -> int | None:
    """A 1-5 rating, or None.

    None rather than a default: "did not rate" and "rated 3" are different answers, and
    averaging an invented middle value would quietly move a recruiter's numbers toward
    it.

    **A whole-numbered float is accepted; a fractional one is not.** JSON has one number
    type, so a browser sending 4 may arrive as `4.0` — rejecting that would discard real
    ratings. But `3.7` is not a star rating, and truncating it to 3 would silently store
    a value nobody chose. There is no third answer between those two, so the fractional
    case reads as no rating at all.

    `bool` is excluded explicitly because it is an `int` in Python, and `True` would
    otherwise be stored as a one-star review.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    rating = int(value)
    return rating if MIN_RATING <= rating <= MAX_RATING else None


def clean_comment(value: object) -> str:
    return str(value or "").strip()[:MAX_COMMENT_CHARS]


def is_empty(rating: int | None, comment: str) -> bool:
    """Whether there is anything worth storing.

    A row with no rating and no comment records that somebody pressed submit, which is
    worse than its honest absence: it counts as feedback on every dashboard that counts
    rows, while saying nothing.
    """
    return rating is None and not comment


def build(
    *,
    interview_id: str,
    recruiter_id: str | None,
    track: str | None,
    role: str | None,
    candidate_name: str | None,
    rating: int | None,
    comment: str,
    had_technical_issues: bool,
    submitted_at: str,
) -> dict:
    """One feedback record. Field names are the web surface's, which read it already.

    `sessionId` is kept as the key field for the same reason the report document keeps
    it: the session id IS the interview id, and renaming it would be a client-visible
    change that buys nothing. `interviewId` is written alongside so a reader that knows
    nothing about web sessions has a field named for what it actually is.
    """
    return {
        "sessionId": interview_id,
        "interviewId": interview_id,
        # Server-resolved, never from the client — see the module docstring.
        "recruiterId": recruiter_id,
        "track": track,
        "role": role,
        "candidateName": candidate_name,
        "rating": rating,
        "comment": comment,
        "hadTechnicalIssues": had_technical_issues,
        "createdAt": submitted_at,
    }

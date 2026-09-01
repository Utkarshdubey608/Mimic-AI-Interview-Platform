"""`/api/web/sessions/{id}/essay` — the candidate writing one.

TWO PROPERTIES SHAPE EVERY ROUTE HERE.

THE SERVER OWNS THE CLOCK. The countdown a candidate watches is a convenience;
the deadline is computed from the session's own `startedAt`, because a browser
clock can be changed and nobody should be able to award themselves another hour
by adjusting one. `remainingSeconds` is therefore returned by the server on every
read, and the client's job is to render it, not to decide it.

WORK IS NEVER LOST. This is why autosave exists, and it is also why a submission
arriving after the deadline is STILL STORED, marked late so a recruiter can see
it. The alternative is discarding forty minutes of somebody's writing over a few
seconds of network, which no assessment is worth. The same reasoning drives
auto-submit at zero: the client sends what exists rather than letting it expire.

An oversized draft is REFUSED rather than truncated. A Firestore document caps at
1 MiB, and silently dropping the end of an essay would take the last paragraph
without telling the person who wrote it.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status

from app.security import AuthedUser
from app.web.deps import WebUser, assert_participant, settings_of
from app.web.services import essay, essay_prompts
from app.web.store import get_store

logger = logging.getLogger("web.sessions_essay")

router = APIRouter(prefix="/sessions", tags=["web:sessions:essay"])

# Comfortably above any essay a person writes in four hours, and comfortably
# below the 1 MiB Firestore document cap even after the timeline is added.
MAX_ESSAY_CHARS = 120_000


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _session(request: Request, session_id: str, user: AuthedUser) -> dict:
    record = await get_store(settings_of(request)).sessions.get(session_id)
    session = assert_participant(record, user)
    # 404 rather than 400 for the wrong track: these routes simply do not exist
    # for a chatbot interview, and saying more would describe somebody else's
    # session.
    if session.get("track") != "essay":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not an essay session.")
    return session


def _prompt_of(session: dict) -> dict:
    prompt = session.get("essayPrompt")
    if not isinstance(prompt, dict) or not prompt:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "This assessment has no essay prompt attached."
        )
    return prompt


def _parse_iso(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def remaining_seconds(session: dict, prompt: dict) -> int:
    """How long is left, from the SERVER's reckoning. Never negative.

    A missing or unparseable start means the clock has not begun rather than that
    it has run out — refusing to write because a timestamp was malformed would
    punish a candidate for a bug in our own record.
    """
    limit = int(prompt.get("timeLimitSeconds") or 0)
    if limit <= 0:
        return 0
    started = _parse_iso(session.get("startedAt"))
    if started is None:
        return limit
    elapsed = (_now() - started).total_seconds()
    left = int(limit - elapsed)
    return left if left > 0 else 0


def _counts(text: str) -> dict:
    return {"words": essay.count_words(text), "chars": essay.count_chars(text)}


@router.get("/{session_id}/essay", summary="The prompt, the saved draft and the time left")
async def get_state(request: Request, session_id: str, user: AuthedUser = WebUser) -> dict:
    session = await _session(request, session_id, user)
    prompt = _prompt_of(session)
    draft = str(session.get("essayDraft") or "")
    limits = essay.limit_state(
        count=essay.count_words(draft),
        minimum=prompt.get("minWords") or None,
        maximum=prompt.get("maxWords") or None,
    )
    return {
        # The projection, not the record: `guidanceMd` is the recruiter's note
        # about what scores, and it must not reach the person being scored.
        "prompt": essay_prompts.public_prompt(prompt),
        "draft": draft,
        **_counts(draft),
        "limitState": limits.state,
        "limitDelta": limits.delta,
        "remainingSeconds": remaining_seconds(session, prompt),
        "submitted": bool(session.get("essaySubmittedAt")),
    }


@router.post("/{session_id}/essay/draft", summary="Auto-save the editor")
async def save_draft(
    request: Request, session_id: str, body: dict, user: AuthedUser = WebUser
) -> dict:
    """A refresh must not cost somebody the paragraph they just wrote."""
    session = await _session(request, session_id, user)
    prompt = _prompt_of(session)

    text = str((body or {}).get("text") or "")
    if len(text) > MAX_ESSAY_CHARS:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "That draft is too long to save. Please shorten it.",
        )

    fields: dict = {"essayDraft": text, "essayDraftAt": _now().isoformat()}

    # The typing timeline, when the recruiter configured it. Behavioural evidence
    # of composition — and unlike a detector score it carries no bias against the
    # writer's first language, which is why it is the primary authenticity signal.
    if isinstance(timeline := (body or {}).get("timeline"), list) and timeline:
        existing = list(session.get("essayTimeline") or [])
        fields["essayTimeline"] = (existing + timeline[:500])[-5_000:]

    await get_store(settings_of(request)).sessions.patch(session_id, fields)
    limits = essay.limit_state(
        count=essay.count_words(text),
        minimum=prompt.get("minWords") or None,
        maximum=prompt.get("maxWords") or None,
    )
    return {
        "ok": True,
        **_counts(text),
        "limitState": limits.state,
        "limitDelta": limits.delta,
        "remainingSeconds": remaining_seconds(session, prompt),
    }


@router.post("/{session_id}/essay/submit", summary="Submit the essay")
async def submit(
    request: Request, session_id: str, body: dict, user: AuthedUser = WebUser
) -> dict:
    """One essay, one submission.

    A second is refused rather than accepted, because it would silently replace an
    answer that may already have been marked — and a candidate cannot be told
    their score was for a version they no longer see.
    """
    session = await _session(request, session_id, user)
    prompt = _prompt_of(session)

    if session.get("essaySubmittedAt"):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This essay has already been submitted."
        )

    text = str((body or {}).get("text") or "").strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "There is nothing written to submit.")
    if len(text) > MAX_ESSAY_CHARS:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That essay is too long to submit."
        )

    # Late, but kept. Discarding it would throw away the whole sitting over a few
    # seconds; the flag is what lets a recruiter judge that for themselves.
    late = remaining_seconds(session, prompt) <= 0

    await get_store(settings_of(request)).sessions.patch(
        session_id,
        {
            "essayText": text,
            "essayDraft": text,
            "essaySubmittedAt": _now().isoformat(),
            "essayWordCount": essay.count_words(text),
            "essayCharCount": essay.count_chars(text),
            "essayLate": late,
        },
    )
    logger.info("essay submitted for session %s (late=%s)", session_id, late)
    return {"ok": True, "late": late, **_counts(text)}

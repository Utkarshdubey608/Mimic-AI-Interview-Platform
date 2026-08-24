"""Code submissions as job documents.

A Submit against a 30-case problem is thirty compiles and runs on a shared judge.
That cannot happen inside the request: the client would hold a connection open for
tens of seconds, and Cloud Run would eventually cut it.

There is no queue in this backend — no celery, arq, Cloud Tasks or Pub/Sub — and
the entrypoint's own docstring states that as a position rather than an oversight.
But there is already one complete production submission→result flow of exactly
this shape: `voice_jobs.py`. This is that pattern, cloned rather than reinvented,
including the two decisions it arrived at the hard way:

  · AN UNKNOWN OR EXPIRED JOB REPORTS `FAILED` WITH HTTP 200, not 404. The client
    polls this for as long as a submission takes; a 404 reads as a transient
    network fault and gets retried forever, while a terminal status tells it to
    stop.
  · RESULTS ARE SERIALISED TO A JSON STRING. Firestore cannot store
    arrays-of-arrays beyond a shallow depth, and a per-case result list carrying
    stdout is exactly that shape.

Expiry is applied ON READ rather than by a sweeper, because there is no scheduled
job infrastructure here to hang one off. A job past its TTL is indistinguishable
from one that never existed, which is the same answer the poll route already gives.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from app.config import Settings
from app.web.store import get_store

logger = logging.getLogger("web.coding.jobs")

IN_PROGRESS = "IN_PROGRESS"
COMPLETED = "COMPLETED"
FAILED = "FAILED"

# The client polls for the length of one submission, not for hours. An hour bounds
# the collection without a scheduled cleanup and leaves plenty of room for a
# candidate who switched tabs mid-run.
TTL = timedelta(hours=1)

# A Firestore document is capped at 1 MiB. A submission's own source is bounded by
# the authoring limits, but per-case stdout is candidate-controlled — a program
# that prints in a loop until the time limit produces as much output as the judge
# will buffer. So the serialised result is measured, and a job that would exceed
# the cap fails with a reason a client can show rather than a raw Firestore error.
MAX_RESULT_BYTES = 900_000

# Per-case output kept on the record. The judge's own caps are larger; this is
# about what is worth STORING, and 8 KB is far past useful for a diff a human
# reads while leaving room for 30 cases inside the document cap.
MAX_STREAM_CHARS = 8_000


def new_id(unique: str) -> str:
    """A submission id. `unique` is supplied by the caller so this stays pure."""
    return f"sub-{unique}"


def trim_streams(verdict: dict) -> dict:
    """Bound the candidate-controlled parts of one verdict before it is stored.

    stdout and stderr are whatever the submitted program chose to write. Truncated
    with a visible marker rather than silently, because a diff that stops without
    saying so reads as a program that stopped.
    """
    out = dict(verdict)
    for field in ("stdout", "stderr", "compileOutput"):
        text = str(out.get(field) or "")
        if len(text) > MAX_STREAM_CHARS:
            out[field] = text[:MAX_STREAM_CHARS] + "\n… truncated"
    return out


async def create(
    settings: Settings,
    submission_id: str,
    *,
    problem_id: str,
    recruiter_id: str,
    language: str,
    now: datetime,
) -> None:
    """Record a submission as started.

    The source code is NOT stored here. It is written with the result, once, so a
    job document is never half a record — and so a submission that fails before
    the judge is reached does not leave the candidate's code sitting in a document
    with no verdict to explain it.
    """
    await get_store(settings).code_submissions.put(
        {
            "id": submission_id,
            "problemId": problem_id,
            "recruiterId": recruiter_id,
            "language": language,
            "status": IN_PROGRESS,
            "createdAt": now.isoformat(),
        }
    )


async def complete(
    settings: Settings,
    submission_id: str,
    *,
    result: dict,
    source: str,
    now: datetime,
) -> None:
    """Store the graded result. Never raises — there is no caller left to tell."""
    payload = json.dumps(result)
    if len(payload.encode("utf-8")) > MAX_RESULT_BYTES:
        await fail(
            settings,
            submission_id,
            error="The result was too large to store. Reduce the program's output.",
            now=now,
        )
        return

    try:
        await get_store(settings).code_submissions.patch(
            submission_id,
            {
                "status": COMPLETED,
                "result": payload,
                "submittedCode": source,
                "score": result.get("score"),
                "maxScore": result.get("maxScore"),
                "completedAt": now.isoformat(),
            },
        )
    except Exception as exc:  # noqa: BLE001 - background task, nobody to report to
        logger.warning("could not store result for %s: %s", submission_id, exc)


async def fail(settings: Settings, submission_id: str, *, error: str, now: datetime) -> None:
    """Record a submission as failed, with a reason a client can show."""
    try:
        await get_store(settings).code_submissions.patch(
            submission_id,
            {"status": FAILED, "error": error, "completedAt": now.isoformat()},
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not record failure for %s: %s", submission_id, exc)


def _expired(record: dict, *, now: datetime) -> bool:
    created = record.get("createdAt")
    if not created:
        return False
    try:
        return datetime.fromisoformat(str(created)) + TTL < now
    except ValueError:
        return False


async def read(settings: Settings, submission_id: str, *, now: datetime) -> dict:
    """The job as a poller sees it.

    An unknown or expired job is reported as FAILED rather than absent, so the
    caller can return HTTP 200 and the client can stop. See the module note.
    """
    record = await get_store(settings).code_submissions.get(submission_id)
    if not record or _expired(record, now=now):
        return {"id": submission_id, "status": FAILED, "error": "That submission is no longer available."}

    out: dict = {
        "id": record.get("id"),
        "problemId": record.get("problemId"),
        "language": record.get("language"),
        "status": record.get("status") or FAILED,
        "createdAt": record.get("createdAt"),
    }
    if record.get("error"):
        out["error"] = record["error"]
    if record.get("result"):
        try:
            out["result"] = json.loads(str(record["result"]))
        except ValueError:
            out["status"] = FAILED
            out["error"] = "The stored result could not be read."
    return out


def now_utc() -> datetime:
    return datetime.now(timezone.utc)

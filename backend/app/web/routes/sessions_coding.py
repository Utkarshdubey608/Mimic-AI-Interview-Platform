"""The coding track's candidate runtime.

Its OWN routes rather than an extension of the timed engine, for the same reason
`sessions_mcq.py` gives: the timed engine has prep and answer phases, a
per-question server clock, drafts and adaptive generation, and a coding assessment
shares almost none of it. Bending `/begin` and `/answers` to serve both would put
changes in the path currently running real interviews.

Five routes, added beside it:

  GET  /{id}/coding              the problems, WITHOUT hidden tests, plus whatever
                                 code the candidate has written so far
  POST /{id}/coding/draft        auto-save; a refresh must not cost somebody the
                                 function they just wrote
  POST /{id}/coding/run          run against the SAMPLE cases, inline
  POST /{id}/coding/submit       grade against EVERY case as a job
  GET  /{id}/coding/submissions/{sid}   poll one of those

── The hidden tests ────────────────────────────────────────────────────────
Live in the session document and never leave the server. The candidate's view is
built by `coding_problems.public_problem`, an allow-list: it names the fields that
may travel, so a hidden case's input or expected output cannot appear in a response
no matter what the stored problem later grows. Same mechanism, same reasoning, and
the same golden-bytes test as the MCQ answer key.

── Running code ────────────────────────────────────────────────────────────
Never here. Every execution goes to the sandboxed judge over HTTP, and with no
judge configured these routes answer 503 and run nothing. See
`app/web/services/coding_judge.py`.

── Why Run is inline and Submit is a job ───────────────────────────────────
Run is a handful of visible cases with somebody watching, so it answers directly.
Submit can be thirty compiles on a shared judge, which is not a request — it
returns 202 and the client polls.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status

from app.security import AuthedUser
from app.web.deps import RateLimitGenerateWeb, WebUser, assert_participant, settings_of
from app.web.services import coding_jobs, coding_judge, coding_problems, coding_scoring
from app.web.store import get_store

logger = logging.getLogger("web.sessions_coding")

router = APIRouter(prefix="/sessions", tags=["web:sessions-coding"])

MAX_SOURCE_CHARS = 100_000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _session(request: Request, session_id: str, user: AuthedUser) -> dict:
    record = await get_store(settings_of(request)).sessions.get(session_id)
    session = assert_participant(record, user)
    # 404 rather than 400 for the wrong track: these routes simply do not exist for
    # a chatbot interview, and saying so more precisely would describe the shape of
    # somebody else's session.
    if session.get("track") != "coding":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a coding session.")
    return session


def _problem_of(session: dict, problem_id: str) -> dict:
    for problem in session.get("codingProblems") or []:
        if str(problem.get("id")) == problem_id:
            return problem
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Problem not found in this assessment.")


def _require_judge(request: Request) -> None:
    if not coding_judge.configured(settings_of(request)):
        # 503, not 500: nothing is broken, something is not set up.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Code execution is not available. Please tell the recruiter who invited you.",
        )


@router.get("/{session_id}/coding", summary="The problems, without their hidden tests")
async def get_state(request: Request, session_id: str, user: AuthedUser = WebUser) -> dict:
    session = await _session(request, session_id, user)
    return {
        "sessionId": session["id"],
        "status": session.get("status"),
        # Projected, not filtered. See the module note.
        "problems": [
            coding_problems.public_problem(p) for p in session.get("codingProblems") or []
        ],
        # What they have written so far, keyed by problem id, so a reload restores
        # the editor as left rather than resetting to starter code.
        "drafts": session.get("codingDrafts") or {},
        "language": session.get("codingLanguage") or "",
        "submittedAt": session.get("codingSubmittedAt"),
        "branding": session.get("branding") or {},
    }


@router.post("/{session_id}/coding/draft", summary="Auto-save the editor")
async def save_draft(
    request: Request, session_id: str, body: dict, user: AuthedUser = WebUser
) -> dict:
    """A refresh must not cost somebody the function they just wrote.

    Stored per problem id, and bounded — the body is candidate-controlled and this
    is written to a Firestore document with a 1 MiB cap.
    """
    session = await _session(request, session_id, user)
    problem_id = str((body or {}).get("problemId") or "")
    _problem_of(session, problem_id)

    source = str((body or {}).get("source") or "")
    if len(source) > MAX_SOURCE_CHARS:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That draft is too large")

    drafts = dict(session.get("codingDrafts") or {})
    drafts[problem_id] = source
    fields: dict = {"codingDrafts": drafts}
    if language := str((body or {}).get("language") or ""):
        fields["codingLanguage"] = language
    await get_store(settings_of(request)).sessions.patch(session_id, fields)
    return {"ok": True}


@router.post(
    "/{session_id}/coding/run",
    summary="Run against the sample cases",
    dependencies=[RateLimitGenerateWeb],
)
async def run_samples(
    request: Request, session_id: str, body: dict, user: AuthedUser = WebUser
) -> dict:
    session = await _session(request, session_id, user)
    _require_judge(request)
    settings = settings_of(request)

    problem = _problem_of(session, str((body or {}).get("problemId") or ""))
    source = str((body or {}).get("source") or "")
    if not source.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to run")
    if len(source) > MAX_SOURCE_CHARS:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That submission is too large")
    try:
        language_id = int((body or {}).get("languageId"))
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a language") from None

    # CUSTOM INPUT — "run your own test", which is half of what Run is for.
    #
    # A candidate debugging an edge case wants to try `0 0` without editing the
    # problem's samples. With custom input there is NO expected output, so there is
    # nothing to compare and no verdict to give: the honest answer is the program's
    # own stdout, stderr and timings. Reporting a pass/fail against nothing would be
    # inventing a result.
    custom = (body or {}).get("stdin")
    if isinstance(custom, str) and custom.strip():
        if len(custom) > coding_problems.MAX_CASE_BYTES:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That input is too large"
            )
        verdict = await coding_judge.run_case(
            settings,
            source=source,
            language_id=language_id,
            stdin=custom,
            # None, not "": an empty expected output would make Judge0 compare
            # against emptiness and report Wrong Answer for any program that prints.
            expected_output=None,
            time_limit_ms=int(problem.get("timeLimitMs") or 2000),
            memory_mb=int(problem.get("memoryMb") or 128),
        )
        return {"custom": coding_jobs.trim_streams(verdict)}

    samples = [c for c in problem.get("testCases") or [] if not c.get("hidden")]
    if not samples:
        raise HTTPException(status.HTTP_409_CONFLICT, "This problem has no sample cases.")

    verdicts = await coding_judge.run_cases(
        settings,
        source=source,
        language_id=language_id,
        cases=samples,
        time_limit_ms=int(problem.get("timeLimitMs") or 2000),
        memory_mb=int(problem.get("memoryMb") or 128),
    )
    graded = coding_scoring.score_submission({"testCases": samples}, verdicts)
    return {
        "result": graded,
        # Sample output in full — a sample exists to be diffed against.
        "streams": {
            case_id: coding_jobs.trim_streams(v) for case_id, v in verdicts.items()
        },
    }


@router.post(
    "/{session_id}/coding/submit",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Grade against every case",
    dependencies=[RateLimitGenerateWeb],
)
async def submit(
    request: Request,
    session_id: str,
    body: dict,
    background: BackgroundTasks,
    user: AuthedUser = WebUser,
) -> dict:
    session = await _session(request, session_id, user)
    _require_judge(request)
    settings = settings_of(request)

    problem = _problem_of(session, str((body or {}).get("problemId") or ""))
    source = str((body or {}).get("source") or "")
    if not source.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to submit")
    try:
        language_id = int((body or {}).get("languageId"))
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a language") from None

    submission_id = coding_jobs.new_id(uuid.uuid4().hex[:12])
    await coding_jobs.create(
        settings,
        submission_id,
        problem_id=str(problem.get("id")),
        # Stamped with the SESSION's owner, not the candidate: the recruiter is who
        # may read a submission back, and the candidate reads it through this
        # session route rather than by id.
        recruiter_id=str(session.get("recruiterId") or ""),
        language=str((body or {}).get("language") or language_id),
        now=coding_jobs.now_utc(),
    )
    background.add_task(
        _grade,
        settings,
        submission_id,
        session_id,
        problem,
        source,
        language_id,
        str((body or {}).get("language") or language_id),
    )
    return {"submissionId": submission_id, "status": coding_jobs.IN_PROGRESS}


async def _grade(settings, submission_id, session_id, problem, source, language_id, language) -> None:
    """Grade, store, and stamp the session. Never raises — nobody is left to tell."""
    try:
        verdicts = await coding_judge.run_cases(
            settings,
            source=source,
            language_id=language_id,
            cases=problem.get("testCases") or [],
            time_limit_ms=int(problem.get("timeLimitMs") or 2000),
            memory_mb=int(problem.get("memoryMb") or 128),
        )
        graded = coding_scoring.score_submission(problem, verdicts)
        graded["streams"] = {k: coding_jobs.trim_streams(v) for k, v in verdicts.items()}
        await coding_jobs.complete(
            settings, submission_id, result=graded, source=source, now=coding_jobs.now_utc()
        )

        # The session's own record of the best attempt per problem, so a recruiter's
        # report does not have to find and rank submissions itself. BEST, not last:
        # a candidate who improves a solution and then breaks it while
        # experimenting should not be scored on the experiment.
        store = get_store(settings)
        session = await store.sessions.get(session_id)
        if session:
            results = dict(session.get("codingResults") or {})
            key = str(problem.get("id"))
            previous = results.get(key) or {}
            if int(graded.get("score") or 0) >= int(previous.get("score") or -1):
                results[key] = coding_scoring.durable_result(
                    graded,
                    language=language,
                    source=source,
                    at=_now(),
                    submission_id=submission_id,
                )
                await store.sessions.patch(session_id, {"codingResults": results})
    except coding_judge.JudgeNotConfigured as exc:
        await coding_jobs.fail(settings, submission_id, error=str(exc), now=coding_jobs.now_utc())
    except Exception as exc:  # noqa: BLE001 - see the docstring
        logger.warning("coding submission %s failed: %s", submission_id, exc)
        await coding_jobs.fail(
            settings,
            submission_id,
            error="The submission could not be graded.",
            now=coding_jobs.now_utc(),
        )


@router.get("/{session_id}/coding/submissions/{submission_id}", summary="Poll a submission")
async def poll(
    request: Request, session_id: str, submission_id: str, user: AuthedUser = WebUser
) -> dict:
    """The graded result, as the CANDIDATE may see it.

    Projected through `candidate_view`, which keeps a hidden case's status and
    timing out of the response: wrong-answer versus time-limit on a case they
    cannot see is a hint about its input's size.

    An unknown or expired submission answers FAILED with HTTP 200, not 404 — the
    client polls this for the length of a run.
    """
    await _session(request, session_id, user)
    settings = settings_of(request)
    record = await coding_jobs.read(settings, submission_id, now=coding_jobs.now_utc())
    if record.get("result"):
        record["result"] = coding_scoring.candidate_view(record["result"])
    return record

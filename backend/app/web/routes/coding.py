"""`/api/web/coding` — authoring coding problems, and running code against them.

WHAT IS HERE AND WHAT IS NOT. These are the RECRUITER's routes: author a problem,
import a bundle of them, preview one exactly as a candidate would see it, and run
a reference solution against the tests to find out whether the problem actually
works. That last one is not a nicety — a problem whose own model answer fails its
hidden cases is the commonest authoring bug in this category of product, and
without a way to try it the recruiter discovers it from a candidate's complaint.

THE CANDIDATE'S ROUTES ARE DELIBERATELY ABSENT. A candidate reaches an assessment
through a session, and there is no `coding` track yet — adding one is a
cross-client interop event touching 22 mode declarations in four languages, and it
breaks the Flutter contract test in a way that cannot be verified from the machine
this was written on. Documents/CODING_INTERVIEW_MODE_PLAN.md has the edit list.
Until that is done this subsystem is complete and dark, which is the honest state
to leave it in.

EVERY ROUTE IS OWNER-SCOPED. A problem contains its own answer, so `assert_owner`
runs before anything is returned — the same guard the MCQ set routes use, for the
same reason.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status

from app.security import AuthedUser
from app.web.deps import RateLimitGenerateWeb, WebUser, assert_owner, settings_of
from app.web.services import (
    coding_jobs,
    coding_judge,
    coding_languages,
    coding_problems,
    coding_scoring,
    coding_starters,
)
from app.web.store import get_store

logger = logging.getLogger("web.coding")

router = APIRouter(prefix="/coding", tags=["web:coding"])

# How many problems one import bundle may carry. Bounded because the endpoint
# takes a list and writes one document per entry.
MAX_BUNDLE = 50

# Source is bounded before it reaches the judge. The judge has its own limits, but
# an unbounded body is a way to make this service do the work of rejecting it.
MAX_SOURCE_CHARS = 100_000


def _now_iso() -> str:
    return coding_jobs.now_utc().isoformat()


async def _owned_problem(request: Request, problem_id: str, user: AuthedUser) -> dict:
    store = get_store(settings_of(request))
    record = await store.coding_problems.get(problem_id)
    return assert_owner(record, user, what="Problem")


def _source_of(body: dict) -> tuple[str, int, str]:
    """The submitted source, its Judge0 language id, and the language name."""
    source = str((body or {}).get("source") or "")
    if not source.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No source code submitted")
    if len(source) > MAX_SOURCE_CHARS:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That submission is too large")

    raw_id = (body or {}).get("languageId")
    try:
        language_id = int(raw_id)
    except (TypeError, ValueError):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "languageId is required (a Judge0 language id)"
        ) from None

    return source, language_id, str((body or {}).get("language") or "")


@router.get("/languages", summary="Languages this deployment can actually run")
async def languages(request: Request, user: AuthedUser = WebUser) -> dict:
    """The language list, resolved from the judge rather than hard-coded.

    Judge0's language ids are PER-INSTANCE, and the documented ones turn out to be
    the legacy set: they resolve to Python 3.8, Node 12, Java 13 and TypeScript 3.7
    on an instance that also offers 3.14, 22, 17 and 5.6. A candidate writing
    modern syntax against a 2019 interpreter gets errors that read as their own
    mistake, so the ids are discovered and the newest per toolchain is chosen.

    `source` tells the caller how much to trust the answer:
      judge     read from the configured judge
      fallback  no judge configured — names only, ids are null
      stale     judge configured but unreachable

    The distinction matters in the UI: "not set up on this deployment" is a
    sentence for a recruiter, "temporarily unavailable" is one for a candidate
    mid-assessment, and they must not be shown the same words.
    """
    resolved, source = await coding_languages.available(settings_of(request))
    # Starters attached here rather than fetched separately: the authoring UI needs
    # both at the same moment (it prefills the editor when a language is picked),
    # and two round trips for one decision is a spinner nobody needed.
    return {"languages": coding_starters.with_starters(resolved), "source": source}


# ── authoring ─────────────────────────────────────────────────────────────────


@router.post("/problems", status_code=status.HTTP_201_CREATED, summary="Create a coding problem")
async def create_problem(request: Request, body: dict, user: AuthedUser = WebUser) -> dict:
    settings = settings_of(request)
    problem_id = f"cp-{uuid.uuid4().hex[:12]}"
    try:
        record = coding_problems.clean_problem(
            body, recruiter_id=user.uid, problem_id=problem_id, now=_now_iso()
        )
    except coding_problems.InvalidProblem as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    await get_store(settings).coding_problems.put(record)
    # Faults, not an error: saving a draft is a normal thing to do, and the
    # recruiter is told what still stops it being used.
    return {"problem": record, "faults": coding_problems.problem_faults(record)}


@router.get("/problems", summary="List my coding problems")
async def list_problems(request: Request, user: AuthedUser = WebUser) -> dict:
    records = await get_store(settings_of(request)).coding_problems.owned_by(user.uid)
    # The LIST is a summary, not the full problems. A list view has no use for
    # every test case, and sending them makes an incidental copy of the answer key
    # in a response nobody needed it in.
    return {
        "problems": [
            {
                "id": r.get("id"),
                "title": r.get("title"),
                "difficulty": r.get("difficulty"),
                "tags": r.get("tags") or [],
                "allowedLanguages": r.get("allowedLanguages") or [],
                "testCount": len(r.get("testCases") or []),
                "createdAt": r.get("createdAt"),
                "faults": coding_problems.problem_faults(r),
            }
            for r in records
        ]
    }


@router.get("/problems/{problem_id}", summary="One coding problem, in full (owner only)")
async def get_problem(request: Request, problem_id: str, user: AuthedUser = WebUser) -> dict:
    record = await _owned_problem(request, problem_id, user)
    return {"problem": record, "faults": coding_problems.problem_faults(record)}


@router.put("/problems/{problem_id}", summary="Replace a coding problem")
async def update_problem(
    request: Request, problem_id: str, body: dict, user: AuthedUser = WebUser
) -> dict:
    existing = await _owned_problem(request, problem_id, user)
    try:
        record = coding_problems.clean_problem(
            body,
            recruiter_id=user.uid,
            problem_id=problem_id,
            # createdAt is preserved rather than refreshed: it is when the problem
            # was written, not when it was last touched.
            now=str(existing.get("createdAt") or _now_iso()),
        )
    except coding_problems.InvalidProblem as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    await get_store(settings_of(request)).coding_problems.put(record)
    return {"problem": record, "faults": coding_problems.problem_faults(record)}


@router.delete("/problems/{problem_id}", summary="Delete a coding problem")
async def delete_problem(request: Request, problem_id: str, user: AuthedUser = WebUser) -> dict:
    await _owned_problem(request, problem_id, user)
    await get_store(settings_of(request)).coding_problems.delete(problem_id)
    return {"ok": True}


@router.post("/problems/import", summary="Import a bundle of coding problems")
async def import_problems(request: Request, body: dict, user: AuthedUser = WebUser) -> dict:
    """Structured import — the LAWFUL way to bring a problem bank in.

    There is no URL scraper here and there will not be one for copyrighted problem
    banks: those problems are somebody else's copyright and their terms prohibit
    it. This is the route that gets the same job done — a recruiter brings their
    own problems, or an internally-owned bank held in version control, as a
    bundle. See the plan document for the position and what a lawful URL import
    would require.

    Partial success is reported rather than an all-or-nothing failure: one
    malformed entry in a bundle of forty should not discard the other
    thirty-nine, and the recruiter needs to know which one to fix.
    """
    entries = (body or {}).get("problems")
    if not isinstance(entries, list) or not entries:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The bundle contains no problems")
    if len(entries) > MAX_BUNDLE:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"A bundle may carry at most {MAX_BUNDLE} problems",
        )

    store = get_store(settings_of(request))
    imported: list[dict] = []
    rejected: list[dict] = []
    for index, entry in enumerate(entries):
        try:
            record = coding_problems.clean_problem(
                entry if isinstance(entry, dict) else {},
                recruiter_id=user.uid,
                problem_id=f"cp-{uuid.uuid4().hex[:12]}",
                now=_now_iso(),
            )
        except coding_problems.InvalidProblem as exc:
            rejected.append({"index": index, "reason": str(exc)})
            continue
        await store.coding_problems.put(record)
        imported.append(
            {
                "id": record["id"],
                "title": record["title"],
                "faults": coding_problems.problem_faults(record),
                # What the allow-list dropped. Reported rather than silent: a bundle
                # using `expected` instead of `expectedOutput` imported with zero
                # rejections and graded a correct solution zero.
                "ignored": coding_problems.ignored_keys(entry if isinstance(entry, dict) else {}),
                # Understood, but not spelled canonically. Reported so a generator
                # that keeps emitting `expected` can be corrected at the source.
                "renamed": coding_problems.renamed_keys(entry if isinstance(entry, dict) else {}),
            }
        )

    return {"imported": imported, "rejected": rejected}


# ── previewing and validating ─────────────────────────────────────────────────


@router.get("/problems/{problem_id}/preview", summary="The problem as a candidate would see it")
async def preview_problem(request: Request, problem_id: str, user: AuthedUser = WebUser) -> dict:
    """Exactly the projection a candidate would receive, so a recruiter can check
    what they are giving away before anybody sits it.

    Deliberately the SAME function that will serve candidates rather than a
    display-only copy — a preview that renders through a different code path is a
    preview of something else.
    """
    record = await _owned_problem(request, problem_id, user)
    return {"problem": coding_problems.public_problem(record)}


@router.post(
    "/problems/{problem_id}/run",
    summary="Run source against the SAMPLE cases only",
    dependencies=[RateLimitGenerateWeb],
)
async def run_samples(
    request: Request, problem_id: str, body: dict, user: AuthedUser = WebUser
) -> dict:
    """Run against visible cases, inline.

    Inline rather than as a job, because this is the fast path a "Run" button
    drives: a handful of sample cases, and a recruiter or candidate is watching.
    Submit is the one that becomes a job.
    """
    record = await _owned_problem(request, problem_id, user)
    settings = settings_of(request)
    source, language_id, _ = _source_of(body)

    if not coding_judge.configured(settings):
        # 503, not 500: nothing is broken, something is not set up. The message
        # names what to do rather than what failed.
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Code execution is not configured on this deployment.",
        )

    samples = [c for c in record.get("testCases") or [] if not c.get("hidden")]
    if not samples:
        raise HTTPException(status.HTTP_409_CONFLICT, "This problem has no sample cases to run.")

    verdicts = await coding_judge.run_cases(
        settings,
        source=source,
        language_id=language_id,
        cases=samples,
        time_limit_ms=int(record.get("timeLimitMs") or 2000),
        memory_mb=int(record.get("memoryMb") or 128),
    )
    # Scored against the samples alone, so the numbers describe what was run.
    graded = coding_scoring.score_submission({"testCases": samples}, verdicts)
    return {
        "result": graded,
        # Sample output IS shown in full — the point of a sample is to be diffed.
        "streams": {
            case_id: {
                "stdout": v.get("stdout"),
                "stderr": v.get("stderr"),
                "compileOutput": v.get("compileOutput"),
            }
            for case_id, v in verdicts.items()
        },
    }


@router.post(
    "/problems/{problem_id}/submit",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Run source against ALL cases as a job",
    dependencies=[RateLimitGenerateWeb],
)
async def submit_all(
    request: Request,
    problem_id: str,
    body: dict,
    background: BackgroundTasks,
    user: AuthedUser = WebUser,
) -> dict:
    """Grade against every case, hidden included, as a background job.

    202 with an id, because thirty compiles on a shared judge is not a request —
    the client polls `/coding/submissions/{id}`.
    """
    record = await _owned_problem(request, problem_id, user)
    settings = settings_of(request)
    source, language_id, language = _source_of(body)

    if not coding_judge.configured(settings):
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Code execution is not configured on this deployment.",
        )

    cases = record.get("testCases") or []
    if not cases:
        raise HTTPException(status.HTTP_409_CONFLICT, "This problem has no test cases.")

    submission_id = coding_jobs.new_id(uuid.uuid4().hex[:12])
    await coding_jobs.create(
        settings,
        submission_id,
        problem_id=problem_id,
        recruiter_id=user.uid,
        language=language or str(language_id),
        now=coding_jobs.now_utc(),
    )
    background.add_task(_grade, settings, submission_id, record, source, language_id)
    return {"submissionId": submission_id, "status": coding_jobs.IN_PROGRESS}


async def _grade(settings, submission_id: str, problem: dict, source: str, language_id: int) -> None:
    """The background half. Never raises — every failure lands on the document.

    Same contract as the interview evaluator next door: it runs where there is
    nobody to report to, so an unrecorded failure is a submission that polls
    IN_PROGRESS until its TTL expires.
    """
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
        graded["streams"] = {
            case_id: coding_jobs.trim_streams(v) for case_id, v in verdicts.items()
        }
        await coding_jobs.complete(
            settings, submission_id, result=graded, source=source, now=coding_jobs.now_utc()
        )
    except coding_judge.JudgeNotConfigured as exc:
        await coding_jobs.fail(settings, submission_id, error=str(exc), now=coding_jobs.now_utc())
    except Exception as exc:  # noqa: BLE001 - see the docstring
        logger.warning("submission %s failed to grade: %s", submission_id, exc)
        await coding_jobs.fail(
            settings,
            submission_id,
            error="The submission could not be graded.",
            now=coding_jobs.now_utc(),
        )


@router.get("/submissions/{submission_id}", summary="Poll a submission")
async def read_submission(
    request: Request, submission_id: str, user: AuthedUser = WebUser
) -> dict:
    """The graded result, or its progress.

    An unknown or expired submission answers FAILED with HTTP 200, not 404 — the
    client polls this for the length of a run, and a 404 reads as a transient
    fault it should retry. The same decision `voice_jobs` arrived at.
    """
    settings = settings_of(request)
    record = await get_store(settings).code_submissions.get(submission_id)
    # Ownership before existence: a 404 for someone else's submission and a 404 for
    # a missing one look the same, which is what we want.
    if record and record.get("recruiterId") not in (None, user.uid):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Submission not found")
    return await coding_jobs.read(settings, submission_id, now=coding_jobs.now_utc())

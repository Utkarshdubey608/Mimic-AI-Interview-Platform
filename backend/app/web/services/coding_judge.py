"""The judge adapter — the only thing in this codebase that runs candidate code,
and it runs none of it here.

Candidate code executes on a SEPARATE, sandboxed Judge0 host reached over HTTP.
Nothing is compiled, forked, or written to disk in this process. That is not a
preference: `tests/test_no_local_storage.py` bans `tempfile`, `shutil`, `mkdtemp`
and `NamedTemporaryFile` across the whole of `backend/app/`, both surfaces, so an
in-process judge that wrote candidate source to a temp directory could not be
merged. The codebase already forbids the dangerous thing; this file works with
that grain rather than against it.

UNCONFIGURED MEANS NOTHING RUNS. With no `judge0_url`, every entry point here
raises `JudgeNotConfigured` and no code is executed anywhere — the same shape
`app/mailer.py` uses for dry-run and `config.py` uses for absent provider keys.
There is deliberately no "just run it locally" fallback, because that fallback is
precisely the vulnerability. See Documents/CODING_INTERVIEW_MODE_PLAN.md for why
the judge cannot live on Cloud Run at all.

FOUR NON-OBVIOUS THINGS ABOUT JUDGE0'S API, each verified against a live instance
rather than taken from documentation:

1. `base64_encoded=true` IS MANDATORY, NOT AN OPTIMISATION. Compiler diagnostics
   routinely contain bytes that are not valid UTF-8, and the GET does not degrade
   — it FAILS: `{"error":"some attributes for this submission cannot be converted
   to UTF-8, use base64_encoded=true query parameter"}`. A compile error is the
   single most likely result during an interview, so the un-encoded path would
   break on the commonest case.

2. NEVER `wait=true`. Judge0's own docs say it does not scale and it is disabled
   on official hosts; it returns 403 there. So: submit, then poll with backoff.

3. `expected_output` IS A FIRST-CLASS FIELD, and this is what keeps the hidden
   answer out of the browser. Judge0 does the comparison itself and returns
   status 3 (Accepted) or 4 (Wrong Answer), so the expected output travels
   backend -> judge and never backend -> candidate. We do not need to send the
   candidate anything to compare against, so we do not.

4. THE TOKEN GOES IN A HEADER. Judge0's own security note: "although you can send
   authentication token as URI parameter, always send authentication token
   through headers."

AND ONE ABOUT THE SERVER SIDE, which this file cannot enforce but must not
contradict: Judge0 DEFAULTS to letting the API caller enable network access per
submission (`ALLOW_ENABLE_NETWORK=true`). The deployment must set that to false.
Belt and braces, every submission below explicitly sends `enable_network: False`,
so the request says what it wants even where the server would have allowed worse.
"""

from __future__ import annotations

import asyncio
import base64
import logging

import httpx

from app.config import Settings
from app.providers.base import http_client
from app.web.services import coding_scoring as verdicts

logger = logging.getLogger("web.coding.judge")


class JudgeNotConfigured(RuntimeError):
    """No judge is configured, so no code may be run. Raised, never worked around."""


class JudgeUnavailable(RuntimeError):
    """A judge is configured but did not answer. A transient infrastructure fault."""


# Judge0's 14 status ids, mapped onto our vocabulary. Ids rather than descriptions
# because the descriptions are display strings and have changed between versions.
#
#   1 In Queue        2 Processing      3 Accepted        4 Wrong Answer
#   5 Time Limit      6 Compilation Error
#   7..12 runtime errors (SIGSEGV, SIGXFSZ, SIGFPE, SIGABRT, NZEC, other)
#   13 Internal Error 14 Exec Format Error
_STATUS = {
    3: verdicts.ACCEPTED,
    4: verdicts.WRONG_ANSWER,
    5: verdicts.TIME_LIMIT,
    6: verdicts.COMPILE_ERROR,
    7: verdicts.RUNTIME_ERROR,
    8: verdicts.RUNTIME_ERROR,
    9: verdicts.RUNTIME_ERROR,
    10: verdicts.RUNTIME_ERROR,
    11: verdicts.RUNTIME_ERROR,
    12: verdicts.RUNTIME_ERROR,
    13: verdicts.INTERNAL_ERROR,
    14: verdicts.INTERNAL_ERROR,
}

# 1 and 2 mean "not finished". Named so the poll loop reads as intent.
_PENDING_IDS = frozenset({1, 2})

# Poll schedule, in seconds. Front-loaded because most runs finish in well under a
# second — a fixed 1s interval would add a second of latency to every "Run" click
# for nothing — then backing off so a queued Java compile does not become a
# thousand requests. Sums to ~20s, which is past any per-case limit we permit
# (MAX_TIME_LIMIT_MS is 15s) plus compilation.
_BACKOFF = (0.05, 0.1, 0.15, 0.25, 0.4, 0.6, 0.8, 1.0, 1.0, 1.5, 2.0, 2.0, 2.5, 3.0, 4.0)

# How many cases of one submission are in flight at once. Bounded so a single
# candidate pressing Submit on a 60-case problem cannot fill the judge's queue and
# stall everybody else's Run.
_CONCURRENCY = 4


def configured(settings: Settings) -> bool:
    """Is there a judge to talk to at all?"""
    return bool((settings.judge0_url or "").strip())


def _base(settings: Settings) -> str:
    url = (settings.judge0_url or "").strip().rstrip("/")
    if not url:
        raise JudgeNotConfigured(
            "Code execution is not configured. Set JUDGE0_URL (and JUDGE0_TOKEN) "
            "to a sandboxed Judge0 instance; see Documents/CODING_INTERVIEW_MODE_PLAN.md."
        )
    return url


def _headers(settings: Settings) -> dict[str, str]:
    token = (settings.judge0_token or "").strip()
    # In a header, never a URI parameter — Judge0's own security guidance.
    return {"X-Auth-Token": token} if token else {}


def _b64(text: str) -> str:
    return base64.b64encode((text or "").encode("utf-8")).decode("ascii")


def _unb64(value: object) -> str:
    """Decode a base64 field, tolerating the bytes that made encoding mandatory.

    `errors="replace"` rather than a raise: this is compiler output on its way to
    a human, and a diagnostic with one unprintable byte in it is still the most
    useful thing we can show. Failing the whole submission over it would turn a
    readable error into an unexplained one.
    """
    if not value:
        return ""
    try:
        return base64.b64decode(str(value)).decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - malformed field, not a reason to lose the result
        return ""


def _verdict_of(payload: dict) -> dict:
    """One Judge0 result, in our vocabulary."""
    status_id = ((payload.get("status") or {}).get("id")) if isinstance(payload.get("status"), dict) else None
    status = _STATUS.get(int(status_id), verdicts.INTERNAL_ERROR) if status_id is not None else verdicts.INTERNAL_ERROR

    # `time` is seconds as a STRING ("0.011"); memory is KB as a number. Both are
    # absent for a compile error, which is why neither is defaulted to 0 — a
    # reported 0ms is a claim, and absent is the truth.
    time_ms = None
    raw_time = payload.get("time")
    if raw_time not in (None, ""):
        try:
            time_ms = int(round(float(raw_time) * 1000))
        except (TypeError, ValueError):
            time_ms = None

    memory_kb = None
    raw_mem = payload.get("memory")
    if raw_mem not in (None, ""):
        try:
            memory_kb = int(raw_mem)
        except (TypeError, ValueError):
            memory_kb = None

    return {
        "status": status,
        "timeMs": time_ms,
        "memoryKb": memory_kb,
        "stdout": _unb64(payload.get("stdout")),
        "stderr": _unb64(payload.get("stderr")),
        "compileOutput": _unb64(payload.get("compile_output")),
    }


async def _submit_one(
    settings: Settings,
    *,
    source: str,
    language_id: int,
    stdin: str,
    expected_output: str | None,
    time_limit_ms: int,
    memory_mb: int,
) -> str:
    """Create one submission and return its token."""
    body: dict = {
        "source_code": _b64(source),
        "language_id": int(language_id),
        "stdin": _b64(stdin),
        # Judge0 takes SECONDS as a float for cpu time, and KILOBYTES for memory.
        "cpu_time_limit": round(time_limit_ms / 1000.0, 3),
        # Wall clock above CPU, so a program that sleeps rather than spins is still
        # cut off — a CPU limit alone does not stop `time.sleep(600)`.
        "wall_time_limit": round(min(time_limit_ms * 2 / 1000.0 + 2.0, 30.0), 3),
        "memory_limit": int(memory_mb) * 1024,
        # Explicit, even though the server should refuse to honour anything else.
        "enable_network": False,
    }
    if expected_output is not None:
        body["expected_output"] = _b64(expected_output)

    try:
        response = await http_client().post(
            f"{_base(settings)}/submissions",
            params={"base64_encoded": "true"},
            headers=_headers(settings),
            json=body,
        )
    except httpx.HTTPError as exc:
        raise JudgeUnavailable(f"judge did not accept the submission: {exc}") from exc

    if response.status_code >= 400:
        raise JudgeUnavailable(f"judge returned {response.status_code} creating a submission")

    token = (response.json() or {}).get("token")
    if not token:
        raise JudgeUnavailable("judge accepted the submission but returned no token")
    return str(token)


async def _await_result(settings: Settings, token: str) -> dict:
    """Poll one submission to a terminal state.

    Polling, not `wait=true` — see the module note. A submission that never
    reaches a terminal state within the backoff schedule is reported as an
    internal error rather than waited on forever: the caller is a background task
    on Cloud Run, where CPU is throttled between requests, so an unbounded wait is
    a task that may simply never resume.
    """
    url = f"{_base(settings)}/submissions/{token}"
    params = {"base64_encoded": "true"}
    for delay in _BACKOFF:
        await asyncio.sleep(delay)
        try:
            response = await http_client().get(url, params=params, headers=_headers(settings))
        except httpx.HTTPError as exc:
            logger.warning("judge poll failed for %s: %s", token, exc)
            continue
        if response.status_code >= 400:
            logger.warning("judge poll returned %s for %s", response.status_code, token)
            continue
        payload = response.json() or {}
        status_id = ((payload.get("status") or {}).get("id")) if isinstance(payload.get("status"), dict) else None
        if status_id is not None and int(status_id) not in _PENDING_IDS:
            return _verdict_of(payload)

    logger.warning("judge did not finish submission %s within the poll schedule", token)
    return {
        "status": verdicts.INTERNAL_ERROR,
        "timeMs": None,
        "memoryKb": None,
        "stdout": "",
        "stderr": "",
        "compileOutput": "",
    }


async def run_case(
    settings: Settings,
    *,
    source: str,
    language_id: int,
    stdin: str,
    expected_output: str | None,
    time_limit_ms: int,
    memory_mb: int,
) -> dict:
    """Run one case and return its verdict. Raises if no judge is configured."""
    token = await _submit_one(
        settings,
        source=source,
        language_id=language_id,
        stdin=stdin,
        expected_output=expected_output,
        time_limit_ms=time_limit_ms,
        memory_mb=memory_mb,
    )
    return await _await_result(settings, token)


async def run_cases(
    settings: Settings,
    *,
    source: str,
    language_id: int,
    cases: list[dict],
    time_limit_ms: int,
    memory_mb: int,
) -> dict[str, dict]:
    """Run every case, bounded, and return verdicts keyed by case id.

    Bounded concurrency rather than one request per case at once: a 60-case
    Submit fired in parallel is a denial of service against the judge, and the
    judge is shared by every candidate sitting an assessment at that moment.

    A case that fails to run gets an `internal_error` verdict rather than being
    absent, so `score_submission` sees every case and the denominator does not
    depend on how much of the run survived.
    """
    gate = asyncio.Semaphore(_CONCURRENCY)

    async def one(case: dict) -> tuple[str, dict]:
        case_id = str(case.get("id"))
        async with gate:
            try:
                verdict = await run_case(
                    settings,
                    source=source,
                    language_id=language_id,
                    stdin=str(case.get("input") or ""),
                    expected_output=str(case.get("expectedOutput") or ""),
                    time_limit_ms=time_limit_ms,
                    memory_mb=memory_mb,
                )
            except JudgeNotConfigured:
                # Never swallowed: with no judge there is no result to report and
                # the caller must say so rather than record zeros as if the
                # candidate had failed.
                raise
            except Exception as exc:  # noqa: BLE001 - JudgeNotConfigured already re-raised above
                logger.warning("case %s did not run: %s", case_id, exc)
                verdict = {
                    "status": verdicts.INTERNAL_ERROR,
                    "timeMs": None,
                    "memoryKb": None,
                    "stdout": "",
                    "stderr": "",
                    "compileOutput": "",
                }
        return case_id, verdict

    results = await asyncio.gather(*(one(c) for c in cases))
    return dict(results)

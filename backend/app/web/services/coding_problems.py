"""Coding problems — the record, and what a candidate is allowed to see of one.

A coding problem is the second thing in this product that CONTAINS ITS OWN ANSWER.
An MCQ paper holds `correctOptionIds`; a coding problem holds every hidden test
case and its expected output, which is the same secret wearing different clothes:
a candidate who could read the problem would not need to solve it.

So this file does not invent a mechanism. `app/mcq_scoring.mcq_public_question`
already solved this, and the shape is copied deliberately, including the part that
matters most:

    AN ALLOW-LIST, NOT A STRIP.

Stripping means listing what to remove, so a field added to the stored problem
later — a reference solution, an editorial, a second key — ships to the browser
until somebody remembers to exclude it. Naming what may LEAVE means a new field is
invisible by default and has to be added here on purpose. That property is the
whole security guarantee, and it is why `public_problem` below reads as a
construction rather than a filter.

WHAT IS VISIBLE, AND THE ONE JUDGEMENT CALL IN IT.
Sample test cases publish their expected output. That is not a leak, it is what a
sample IS: a candidate who cannot see what the expected output was cannot learn
anything from a failing sample, and every platform in this category shows them.
Hidden cases publish nothing at all — not their input, not their output. Their
COUNT is published, because "3 hidden tests" tells a candidate how much of the
score is still unseen without telling them anything about it, and a bare
"some tests failed" is a worse experience for no security gain.

WHAT IS NEVER VISIBLE: any hidden case's input or expected output, the per-case
points of a hidden case, the recruiter id, or anything else a future field brings.
`tests/web/test_web_coding_projection.py` asserts that on SERIALISED BYTES rather
than on this dict, because bytes are what reach a candidate — the same reasoning
as the MCQ paper's golden test.
"""

from __future__ import annotations

# Difficulty is a closed set so a recruiter's free text cannot become a de-facto
# taxonomy that analytics then has to guess at.
DIFFICULTIES = ("easy", "medium", "hard")

# Bounds. Every one of these exists because the values cross a trust boundary —
# a problem is authored by a recruiter but its limits are handed to a judge that
# will honour them, so an unbounded time limit is a way to occupy a worker
# forever.
MAX_TITLE = 200
MAX_STATEMENT = 20_000
MAX_CONSTRAINTS = 4_000
MAX_IO_FORMAT = 4_000
MAX_CASE_BYTES = 64_000
MAX_CASES = 60
MAX_EXAMPLES = 6
MAX_TAGS = 12
MAX_STARTER_BYTES = 20_000

# The floor and ceiling a recruiter may set per problem. The ceiling is the real
# control: it bounds what one submission can cost, and with the per-case count
# above it bounds the worst case for one Submit.
MIN_TIME_LIMIT_MS = 250
MAX_TIME_LIMIT_MS = 15_000
MIN_MEMORY_MB = 16
MAX_MEMORY_MB = 512

DEFAULT_TIME_LIMIT_MS = 2_000
DEFAULT_MEMORY_MB = 128
DEFAULT_POINTS = 1


class InvalidProblem(ValueError):
    """A problem that cannot be stored. Authoring is permissive; this is the floor.

    Mirrors `mcq_authoring.InvalidPaper`: saving a half-finished problem is a
    normal thing a recruiter does, so most incompleteness is reported as a
    readiness fault rather than refused. What is refused here is the shape being
    wrong — a limit outside its bounds, a case that is not a case — because those
    are the values handed to the judge.
    """


def _clamp(value: object, *, low: int, high: int, default: int) -> int:
    try:
        n = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return max(low, min(high, n))


def _text(value: object, *, limit: int) -> str:
    return str(value or "").strip()[:limit]


def clean_test_case(case: object, *, index: int) -> dict:
    """One stored test case. `hidden` defaults to TRUE.

    The default is the security-relevant part. A recruiter who adds a case and
    says nothing about its visibility gets a HIDDEN case, because the failure mode
    of the other default is publishing an answer, and the failure mode of this one
    is a candidate seeing one fewer example.
    """
    if not isinstance(case, dict):
        raise InvalidProblem(f"test case {index} is not an object")
    return {
        "id": _text(case.get("id"), limit=64) or f"tc{index + 1}",
        "input": str(case.get("input") or "")[:MAX_CASE_BYTES],
        "expectedOutput": str(case.get("expectedOutput") or "")[:MAX_CASE_BYTES],
        "hidden": bool(case.get("hidden", True)),
        "points": _clamp(case.get("points"), low=0, high=1_000, default=DEFAULT_POINTS),
    }


def clean_problem(body: dict, *, recruiter_id: str, problem_id: str, now: str) -> dict:
    """The stored record for a problem. Pure, so it is testable directly.

    An allow-list here too, for the same reason as the projection: a field a
    client invents is dropped rather than stored, so nothing reaches Firestore
    that this file has not named.
    """
    if not isinstance(body, dict):
        raise InvalidProblem("problem is not an object")

    cases = body.get("testCases")
    if not isinstance(cases, list):
        raise InvalidProblem("testCases must be a list")
    if len(cases) > MAX_CASES:
        raise InvalidProblem(f"a problem may have at most {MAX_CASES} test cases")

    starter = body.get("starterCode")
    starter_clean: dict[str, str] = {}
    if isinstance(starter, dict):
        for lang, code in starter.items():
            starter_clean[_text(lang, limit=32)] = str(code or "")[:MAX_STARTER_BYTES]

    examples = body.get("examples")
    examples_clean: list[dict] = []
    if isinstance(examples, list):
        for ex in examples[:MAX_EXAMPLES]:
            if not isinstance(ex, dict):
                continue
            examples_clean.append(
                {
                    "input": str(ex.get("input") or "")[:MAX_CASE_BYTES],
                    "output": str(ex.get("output") or "")[:MAX_CASE_BYTES],
                    "explanation": _text(ex.get("explanation"), limit=2_000),
                }
            )

    langs = body.get("allowedLanguages")
    langs_clean = [_text(x, limit=32) for x in langs if _text(x, limit=32)] if isinstance(langs, list) else []

    tags = body.get("tags")
    tags_clean = [_text(t, limit=40) for t in tags[:MAX_TAGS] if _text(t, limit=40)] if isinstance(tags, list) else []

    difficulty = _text(body.get("difficulty"), limit=16).lower()

    return {
        "id": problem_id,
        "recruiterId": recruiter_id,
        "title": _text(body.get("title"), limit=MAX_TITLE),
        "statementMd": _text(body.get("statementMd"), limit=MAX_STATEMENT),
        "constraints": _text(body.get("constraints"), limit=MAX_CONSTRAINTS),
        "ioFormat": _text(body.get("ioFormat"), limit=MAX_IO_FORMAT),
        "examples": examples_clean,
        "starterCode": starter_clean,
        "testCases": [clean_test_case(c, index=i) for i, c in enumerate(cases)],
        "timeLimitMs": _clamp(
            body.get("timeLimitMs"),
            low=MIN_TIME_LIMIT_MS,
            high=MAX_TIME_LIMIT_MS,
            default=DEFAULT_TIME_LIMIT_MS,
        ),
        "memoryMb": _clamp(
            body.get("memoryMb"), low=MIN_MEMORY_MB, high=MAX_MEMORY_MB, default=DEFAULT_MEMORY_MB
        ),
        "difficulty": difficulty if difficulty in DIFFICULTIES else "medium",
        "tags": tags_clean,
        "allowedLanguages": langs_clean,
        "createdAt": now,
    }


def problem_faults(problem: dict) -> list[str]:
    """What stops this problem being SET, as opposed to stored.

    "Saving is permissive, using is strict" — `mcq_authoring.set_faults` draws the
    same line, and for the same reason: a recruiter mid-draft should not be told
    their work is invalid, but an unusable problem must not reach a candidate.
    """
    faults: list[str] = []
    if not problem.get("title"):
        faults.append("The problem needs a title.")
    if not problem.get("statementMd"):
        faults.append("The problem needs a statement.")
    if not problem.get("allowedLanguages"):
        faults.append("Choose at least one language a candidate may answer in.")

    cases = problem.get("testCases") or []
    if not cases:
        faults.append("The problem needs at least one test case.")
    if cases and not any(not c.get("hidden") for c in cases):
        # Not pedantry. With no sample, "Run" has nothing to run against, so a
        # candidate's only feedback is a graded submission.
        faults.append("At least one test case must be a visible sample.")
    if cases and sum(int(c.get("points") or 0) for c in cases) <= 0:
        faults.append("The test cases carry no points, so the problem cannot be scored.")
    return faults


# ── the candidate's view ──────────────────────────────────────────────────────

# Named here rather than inline so the projection test can assert the shape of
# the contract itself, not just this one problem's output.
PUBLIC_PROBLEM_FIELDS = (
    "id",
    "title",
    "statementMd",
    "constraints",
    "ioFormat",
    "examples",
    "starterCode",
    "sampleTests",
    "hiddenTestCount",
    "timeLimitMs",
    "memoryMb",
    "difficulty",
    "tags",
    "allowedLanguages",
    "totalPoints",
)

PUBLIC_SAMPLE_FIELDS = ("id", "input", "expectedOutput", "points")


def public_sample(case: dict) -> dict:
    """A VISIBLE case, as a candidate sees it.

    Its expected output is published on purpose — see the module note. This
    function is never called with a hidden case; `public_problem` decides that,
    in one place, so there is a single line to audit.
    """
    return {
        "id": case.get("id"),
        "input": case.get("input") or "",
        "expectedOutput": case.get("expectedOutput") or "",
        "points": int(case.get("points") or 0),
    }


def public_problem(problem: dict) -> dict:
    """What a candidate is allowed to see of a problem.

    An allow-list. Every key emitted is named in `PUBLIC_PROBLEM_FIELDS`, and a
    field added to the stored problem later is invisible until somebody adds it
    here deliberately.

    `totalPoints` counts hidden cases too. That is intentional and is not a leak:
    knowing a problem is worth 10 points, of which 4 are visible, tells a
    candidate how much is riding on cases they cannot see — which is fair
    information — while saying nothing about what those cases contain.
    """
    cases = problem.get("testCases") or []
    samples = [public_sample(c) for c in cases if not c.get("hidden")]
    return {
        "id": problem.get("id"),
        "title": problem.get("title") or "",
        "statementMd": problem.get("statementMd") or "",
        "constraints": problem.get("constraints") or "",
        "ioFormat": problem.get("ioFormat") or "",
        "examples": [
            {
                "input": e.get("input") or "",
                "output": e.get("output") or "",
                "explanation": e.get("explanation") or "",
            }
            for e in problem.get("examples") or []
        ],
        "starterCode": dict(problem.get("starterCode") or {}),
        "sampleTests": samples,
        "hiddenTestCount": sum(1 for c in cases if c.get("hidden")),
        "timeLimitMs": int(problem.get("timeLimitMs") or DEFAULT_TIME_LIMIT_MS),
        "memoryMb": int(problem.get("memoryMb") or DEFAULT_MEMORY_MB),
        "difficulty": problem.get("difficulty") or "medium",
        "tags": list(problem.get("tags") or []),
        "allowedLanguages": list(problem.get("allowedLanguages") or []),
        "totalPoints": sum(int(c.get("points") or 0) for c in cases),
    }

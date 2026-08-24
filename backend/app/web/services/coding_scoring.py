"""Grading a code submission. Pure, deterministic, and no model anywhere near it.

The verdict for each case comes from the judge; this file only decides what those
verdicts are WORTH. Keeping that split is what makes a score reproducible: given
the same case verdicts, this returns the same number today and in a year, and a
recruiter disputing a score can be shown the arithmetic.

PARTIAL CREDIT IS THE DEFAULT, and it is a deliberate disagreement with
competitive programming. A contest scores all-or-nothing because it is ranking
solvers; an interview is trying to distinguish a candidate who handled the main
case but missed an edge case from one who wrote nothing that runs. Those are very
different signals and collapsing them to 0 throws away the more useful one. Each
case carries its own points, and a submission earns the points of the cases it
passes.

A COMPILE ERROR SCORES ZERO, and not because of a rule about compile errors.
Nothing ran, so no case passed, so the sum is zero — the same arithmetic as
everything else. It is called out here only because it is the case people expect
to be special, and it is not.
"""

from __future__ import annotations

# Our verdict vocabulary, not Judge0's. The adapter translates; everything above
# it speaks these. That indirection is what lets the engine be replaced without
# touching grading, results, or the recruiter's report.
ACCEPTED = "accepted"
WRONG_ANSWER = "wrong_answer"
TIME_LIMIT = "time_limit"
MEMORY_LIMIT = "memory_limit"
COMPILE_ERROR = "compile_error"
RUNTIME_ERROR = "runtime_error"
INTERNAL_ERROR = "internal_error"
NOT_RUN = "not_run"

# Verdicts that earn points. Exactly one, named as a set so the grading rule reads
# as a rule rather than as an equality buried in a loop.
PASSING = frozenset({ACCEPTED})

# A verdict that means "the judge broke", not "the candidate was wrong". Kept
# separate because it must never be reported to a candidate as a failure of
# theirs, and because a submission full of these is an incident, not a score.
JUDGE_FAULTS = frozenset({INTERNAL_ERROR})


def case_result(case: dict, verdict: dict) -> dict:
    """One case's line in the result. `case` is the STORED case; `verdict` the judge's.

    `hidden` is carried through so the recruiter's report can show every case
    while the candidate's view can drop the hidden ones' detail — one flag, read
    in two places, rather than two parallel structures to keep honest.
    """
    status = str(verdict.get("status") or NOT_RUN)
    points = int(case.get("points") or 0)
    passed = status in PASSING
    return {
        "id": case.get("id"),
        "hidden": bool(case.get("hidden")),
        "status": status,
        "passed": passed,
        "points": points,
        "awarded": points if passed else 0,
        "timeMs": verdict.get("timeMs"),
        "memoryKb": verdict.get("memoryKb"),
    }


def score_submission(problem: dict, verdicts: dict[str, dict]) -> dict:
    """The graded result for one problem. `verdicts` is keyed by test-case id.

    A case with no verdict scores zero and reports `not_run` rather than being
    skipped. Skipping would make `maxScore` depend on how much of the run
    completed, so a submission that died half way would show a flattering
    percentage of a smaller denominator.
    """
    cases = problem.get("testCases") or []
    lines = [case_result(c, verdicts.get(str(c.get("id")), {})) for c in cases]

    score = sum(line["awarded"] for line in lines)
    max_score = sum(line["points"] for line in lines)
    passed = sum(1 for line in lines if line["passed"])

    # The compile error is reported once, at the top, rather than repeated on
    # every case — a candidate who mistyped a semicolon does not need to be told
    # twelve times.
    compile_failed = bool(lines) and all(line["status"] == COMPILE_ERROR for line in lines)
    judge_broke = bool(lines) and any(line["status"] in JUDGE_FAULTS for line in lines)

    return {
        "score": score,
        "maxScore": max_score,
        # Rounded to one decimal because it is displayed, and because a repeating
        # decimal in a score is a distraction. The integers above are the record.
        "percent": round(100.0 * score / max_score, 1) if max_score else 0.0,
        "passed": passed,
        "total": len(lines),
        "cases": lines,
        "compileFailed": compile_failed,
        "judgeFaulted": judge_broke,
    }


def candidate_view(result: dict) -> dict:
    """The graded result as a CANDIDATE may see it, mid-assessment.

    Hidden cases keep their pass/fail and their id and lose everything else. That
    is the honest middle: telling a candidate "4 of 7 passed" without which ones
    is uselessly vague, and showing a hidden case's timing and output is a slow
    way to leak the case itself — a candidate who can see stdout for a hidden
    input can reconstruct the input from a program that prints its own stdin.

    NOTE ON A NEARBY TRIPWIRE: this is per-case feedback DURING an assessment,
    which is a different thing from the post-interview result disclosure governed
    by `interviews.CANDIDATE_VISIBLE_RESULT_FIELDS`. That allow-list is pinned by
    a test which calls widening it a product and privacy decision. Nothing here
    widens it, and nothing here should be read as permission to.
    """
    return {
        "score": result.get("score"),
        "maxScore": result.get("maxScore"),
        "passed": result.get("passed"),
        "total": result.get("total"),
        "compileFailed": result.get("compileFailed"),
        "cases": [
            {
                "id": line.get("id"),
                "hidden": line.get("hidden"),
                "passed": line.get("passed"),
                # A hidden case reports only that it failed, never why: `status`
                # distinguishes wrong-answer from time-limit, and on a hidden
                # case that distinction is a hint about the input's size.
                "status": line.get("status") if not line.get("hidden") else None,
                "timeMs": line.get("timeMs") if not line.get("hidden") else None,
            }
            for line in result.get("cases") or []
        ],
    }

"""Coding sessions in the aggregate dashboard.

Every other metric in `analytics.py` is derived from `reports/{id}`. A coding
assessment does not have one — its result is arithmetic on the judge's verdicts,
written onto the session — so a coding session reached `totals` and `byTrack` and
then disappeared from every average. A recruiter running only coding assessments
saw a dashboard of zeroes with a non-zero session count, which reads as a broken
dashboard rather than as a missing metric.

These pin the block that fixes it, and the two decisions inside it that a reader
would otherwise have to take on trust:

  · it is SEPARATE from `averageOverall`, because a model's rubric score and a
    judge's percentage of test points are different measurements;
  · `scored` counts sessions with a graded submission, not sessions that exist,
    so sending more invitations does not drag the average towards zero.
"""

from __future__ import annotations

from app.web.services import analytics


def _case(passed: bool, points: int, ms: int | None) -> dict:
    return {
        "id": f"c{points}{ms}",
        "hidden": False,
        "status": "accepted" if passed else "wrong_answer",
        "passed": passed,
        "points": points,
        "awarded": points if passed else 0,
        "timeMs": ms,
        "memoryKb": 4096,
    }


def _result(*, score: int, max_score: int, passed: int, total: int, language: str, cases: list[dict]) -> dict:
    return {
        "score": score,
        "maxScore": max_score,
        "percent": round(100.0 * score / max_score, 1) if max_score else 0.0,
        "passed": passed,
        "total": total,
        "cases": cases,
        "language": language,
        "code": "x",
        "at": "2026-08-27T05:00:00+00:00",
    }


def _session(sid: str, **overrides) -> dict:
    return {
        "id": sid,
        "track": "coding",
        "recruiterId": "uid-recruiter",
        "status": "completed",
        "createdAt": "2026-08-27T04:00:00+00:00",
        "startedAt": "2026-08-27T04:10:00+00:00",
        "completedAt": "2026-08-27T04:40:00+00:00",
        **overrides,
    }


# A candidate who solved one problem outright and half-solved another.
SOLID = _session(
    "s1",
    codingProblems=[{"id": "p1"}, {"id": "p2"}],
    codingResults={
        "p1": _result(
            score=10, max_score=10, passed=2, total=2, language="python",
            cases=[_case(True, 6, 12), _case(True, 4, 15)],
        ),
        "p2": _result(
            score=4, max_score=10, passed=1, total=2, language="python",
            cases=[_case(True, 4, 40), _case(False, 6, 300)],
        ),
    },
)

# A candidate who submitted one problem in a different language and left the rest.
PARTIAL = _session(
    "s2",
    completedAt="2026-08-27T04:20:00+00:00",
    codingProblems=[{"id": "p1"}, {"id": "p2"}],
    codingResults={
        "p1": _result(
            score=0, max_score=10, passed=0, total=2, language="go",
            cases=[_case(False, 6, 20), _case(False, 4, 22)],
        ),
    },
)

# An invitation nobody has sat.
UNTOUCHED = _session("s3", status="created", startedAt=None, completedAt=None,
                     codingProblems=[{"id": "p1"}, {"id": "p2"}])


def _stats(cohort: list[dict]) -> dict:
    return analytics.coding_stats(cohort)


def test_the_denominators_are_the_ones_their_names_claim() -> None:
    stats = _stats([SOLID, PARTIAL, UNTOUCHED])

    assert stats["sessions"] == 3
    # Six problems were set across three sessions…
    assert stats["problemsAssigned"] == 6
    # …three were submitted…
    assert stats["problemsAttempted"] == 3
    # …and exactly one passed every test it had.
    assert stats["problemsSolved"] == 1


def test_an_unsat_invitation_does_not_drag_the_average_down() -> None:
    """The bug this guards: `scored` over `sessions` would fall with every invite."""
    with_invite = _stats([SOLID, UNTOUCHED])
    without = _stats([SOLID])

    assert with_invite["scored"] == 1
    assert with_invite["averagePercent"] == without["averagePercent"]


def test_the_test_pass_rate_counts_cases_not_problems() -> None:
    stats = _stats([SOLID, PARTIAL])

    assert stats["testsRun"] == 6
    assert stats["testsPassed"] == 3
    assert stats["testPassRate"] == 0.5


def test_runtime_comes_from_the_slowest_and_the_mean_case() -> None:
    stats = _stats([SOLID, PARTIAL])

    assert stats["slowestCaseMs"] == 300
    # (12 + 15 + 40 + 300 + 20 + 22) / 6 = 68.2, rounded by _mean.
    assert stats["avgCaseMs"] == 68


def test_language_distribution_is_by_submission_and_ordered_by_volume() -> None:
    stats = _stats([SOLID, PARTIAL])

    assert stats["byLanguage"] == [
        {"language": "python", "submissions": 2, "averagePercent": 70},
        {"language": "go", "submissions": 1, "averagePercent": 0},
    ]


def test_time_taken_ignores_a_session_that_never_finished() -> None:
    stats = _stats([SOLID, PARTIAL, UNTOUCHED])

    # 30 minutes and 10 minutes; the unsat invitation contributes nothing.
    assert stats["avgDurationSeconds"] == 1200


def test_a_cohort_with_no_coding_sessions_is_all_zeroes_not_a_crash() -> None:
    stats = _stats([{"id": "x", "track": "chat", "status": "completed"}])

    assert stats["sessions"] == 0
    assert stats["averagePercent"] == 0
    assert stats["testPassRate"] == 0
    assert stats["slowestCaseMs"] is None
    assert stats["byLanguage"] == []
    assert len(stats["scoreDistribution"]) == len(analytics.BUCKETS)


def test_the_summary_carries_the_block_and_keeps_it_out_of_the_model_average() -> None:
    """Both halves matter: present, and NOT mixed into `averageOverall`."""
    summary = analytics.compute([SOLID, PARTIAL], {}, {}, owner_id="uid-recruiter")

    assert summary["coding"]["problemsAttempted"] == 3
    # No report documents exist, so nothing is model-scored — and the judge's
    # percentages must not have leaked in to fill the gap.
    assert summary["totals"]["scored"] == 0
    assert summary["averageOverall"] == 0

"""The recruiter analytics dashboard — a port of `server/services/analytics.ts`.

Aggregates stored reports, joined with their sessions and templates, into the dashboard
summary.

**Everything here is real.** No matches produces zeros and empty arrays, never fabricated
or sampled data — a hiring dashboard that invented a trend line would be worse than an
empty one. The two populations are kept distinct throughout: the *cohort* is every
session passing the filters (that is what the funnel counts), while *score* statistics
only ever include sessions that actually have a report.

Pure. The Express version read a module-global store; this takes its data as arguments,
so the aggregation is testable without a database and the caller decides how to batch the
reads.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.web.services.timing import answer_time_used, to_ms

# Always all five, always in this order: a chart whose buckets appear and disappear as
# the filters change is unreadable.
BUCKETS = ("0-20", "21-40", "41-60", "61-80", "81-100")

# Tracks that record real per-question answer timing. The conversational ones stamp turns
# at finalise time, so their per-question figure is derived from the total instead.
TIMED_TRACKS = ("chat", "video")

TOP_CANDIDATE_LIMIT = 10

UNSPECIFIED_ROLE = "(unspecified)"
DELETED_TEMPLATE = "(deleted template)"


def _mean(values: list[float]) -> int:
    return round(sum(values) / len(values)) if values else 0


def _bucket_of(score: float) -> str:
    if score <= 20:
        return BUCKETS[0]
    if score <= 40:
        return BUCKETS[1]
    if score <= 60:
        return BUCKETS[2]
    if score <= 80:
        return BUCKETS[3]
    return BUCKETS[4]


def in_range(iso: str | None, date_from: str | None, date_to: str | None) -> bool:
    """Inclusive date-range test.

    A date-only bound expands to the whole day, so `dateTo=2027-03-01` includes
    everything that happened on the 1st rather than only the midnight instant.

    A record with no timestamp passes unless a LOWER bound is set: "everything up to
    March" can reasonably include an undated row, but "everything since March" cannot.
    """
    if not iso:
        return not date_from

    moment = to_ms(iso)
    if moment is None:
        return not date_from

    if date_from:
        start = to_ms(
            f"{date_from}T00:00:00+00:00" if len(date_from) <= 10 else date_from
        )
        if start is not None and moment < start:
            return False

    if date_to:
        end = to_ms(f"{date_to}T23:59:59.999+00:00" if len(date_to) <= 10 else date_to)
        if end is not None and moment > end:
            return False

    return True


def _role_of(template: dict | None) -> str:
    return (template or {}).get("role", "").strip() or UNSPECIFIED_ROLE


def average_time_per_question(session: dict, report: dict) -> float | None:
    """Mean seconds per question for one session.

    Two derivations, because only the timed tracks record it honestly. For those, the
    real per-question spans are averaged. For a conversation, the total duration is
    divided by the number of scored questions — an approximation, and the only one
    available, since those turns are all stamped at finalise time.

    None when neither is available, so it can be excluded from the average rather than
    counted as zero.
    """
    if session.get("track") in TIMED_TRACKS:
        spans = [
            used
            for question in session.get("questions") or []
            if (used := answer_time_used(question)) is not None
        ]
        if spans:
            return sum(spans) / len(spans)

    started = to_ms(session.get("startedAt"))
    completed = to_ms(session.get("completedAt"))
    question_count = len(report.get("perQuestion") or [])
    if started is None or completed is None or question_count == 0:
        return None

    duration = (completed - started) / 1000
    return duration / question_count if duration > 0 else None


def compute(
    sessions: list[dict],
    templates_by_id: dict[str, dict],
    reports_by_session: dict[str, dict],
    *,
    filters: dict | None = None,
    generated_at: str | None = None,
    owner_id: str | None = None,
) -> dict:
    """The dashboard summary.

    `owner_id` restricts the cohort to one recruiter's sessions — tenant isolation for
    aggregate metrics, so a company-wide average never includes another recruiter's
    candidates.
    """
    filters = filters or {}
    generated_at = generated_at or datetime.now(timezone.utc).isoformat()
    role_filter = (filters.get("role") or "").strip()

    cohort = [
        session
        for session in sessions
        if _passes(session, templates_by_id, filters, role_filter, owner_id)
    ]

    created = len(cohort)
    # "Started" is deliberately loose: a session that has moved past `created` has been
    # opened even if its start timestamp was never written.
    started = sum(
        1 for s in cohort if s.get("startedAt") or s.get("status") != "created"
    )
    completed = sum(1 for s in cohort if s.get("status") == "completed")

    rows = [
        {
            "session": session,
            "template": templates_by_id.get(session.get("templateId") or ""),
            "report": reports_by_session[session["id"]],
        }
        for session in cohort
        if session.get("id") in reports_by_session
    ]
    scored = len(rows)
    overalls = [row["report"].get("overallScore") or 0 for row in rows]

    return {
        "totals": {
            "created": created,
            "started": started,
            "completed": completed,
            "scored": scored,
        },
        "completionRate": completed / created if created else 0,
        "averageOverall": _mean(overalls),
        "scoreDistribution": _distribution(overalls),
        "kpiAverages": _kpi_averages(rows, scored),
        "byTrack": _by_track(cohort, rows),
        "byRole": _by_role(cohort, templates_by_id, reports_by_session),
        "byTemplate": _by_template(cohort, templates_by_id, reports_by_session),
        "trend": _trend(rows),
        "timeStats": _time_stats(rows),
        "recommendationDistribution": _recommendations(rows),
        "integrityFlagRate": _integrity_rate(rows, scored),
        "topCandidates": _top_candidates(rows),
        # Judge-scored, so outside every report-derived metric above. See the
        # function's own note for why it is not folded into `averageOverall`.
        "coding": coding_stats(cohort),
        "generatedAt": generated_at,
    }


def coding_stats(cohort: list[dict]) -> dict:
    """Aggregate metrics for the CODING track, computed from the sessions themselves.

    Every other metric in this file is derived from `reports/{id}`, and a coding
    assessment does not have one: its result is arithmetic on the judge's verdicts,
    written onto the session by `coding_scoring.durable_result`. So a coding session
    reached `totals` and `byTrack` and then vanished from every average, and a
    recruiter running coding assessments saw a dashboard with nothing on it.

    Kept SEPARATE from `averageOverall` rather than folded into it, deliberately. A
    model's 0-100 rubric score and a judge's percentage of test points are different
    measurements of different things, and averaging them would produce a number that
    means nothing while looking authoritative.

    Denominators are named in the keys because each answers a different question:
    `problemsAssigned` is what recruiters set, `problemsAttempted` is what candidates
    reached, and `problemsSolved` is what they got fully right. A single "pass rate"
    over one of those would silently be a different statistic from the one a reader
    assumed.
    """
    sessions = [s for s in cohort if s.get("track") == "coding"]

    percents: list[float] = []
    durations: list[float] = []
    case_times: list[float] = []
    assigned = attempted = solved = 0
    cases_run = cases_passed = 0
    by_language: dict[str, dict] = {}

    for session in sessions:
        results = session.get("codingResults") or {}
        assigned += len(session.get("codingProblems") or [])

        score = max_score = 0
        for result in results.values():
            attempted += 1
            score += int(result.get("score") or 0)
            max_score += int(result.get("maxScore") or 0)
            if result.get("total") and result.get("passed") == result.get("total"):
                solved += 1

            for case in result.get("cases") or []:
                # `not_run` cases count in the denominator for the same reason
                # `score_submission` counts them: a run that died half way should
                # not report a flattering percentage of a smaller total.
                cases_run += 1
                if case.get("passed"):
                    cases_passed += 1
                if case.get("timeMs") is not None:
                    case_times.append(float(case["timeMs"]))

            language = str(result.get("language") or "")
            if language:
                entry = by_language.setdefault(
                    language, {"language": language, "submissions": 0, "_percents": []}
                )
                entry["submissions"] += 1
                if result.get("percent") is not None:
                    entry["_percents"].append(float(result["percent"]))

        if max_score:
            percents.append(100.0 * score / max_score)

        started = to_ms(session.get("startedAt"))
        completed = to_ms(session.get("completedAt"))
        if started is not None and completed is not None and completed > started:
            durations.append((completed - started) / 1000)

    languages = sorted(
        (
            {
                "language": entry["language"],
                "submissions": entry["submissions"],
                "averagePercent": _mean(entry["_percents"]),
            }
            for entry in by_language.values()
        ),
        key=lambda item: (-item["submissions"], item["language"]),
    )

    return {
        "sessions": len(sessions),
        # Sessions with at least one graded submission. The rest are invitations
        # nobody has sat yet, and including them would drag every average down
        # towards zero as a recruiter sends more invites.
        "scored": len(percents),
        "averagePercent": _mean(percents),
        "scoreDistribution": _distribution(percents),
        "problemsAssigned": assigned,
        "problemsAttempted": attempted,
        "problemsSolved": solved,
        "testsRun": cases_run,
        "testsPassed": cases_passed,
        "testPassRate": cases_passed / cases_run if cases_run else 0,
        "avgCaseMs": _mean(case_times),
        "slowestCaseMs": max(case_times) if case_times else None,
        "avgDurationSeconds": _mean(durations),
        "byLanguage": languages,
    }


def _passes(
    session: dict,
    templates_by_id: dict[str, dict],
    filters: dict,
    role_filter: str,
    owner_id: str | None,
) -> bool:
    # Ownership first: a session another recruiter owns must not reach any later filter,
    # let alone any aggregate.
    if owner_id and session.get("recruiterId") != owner_id:
        return False
    if filters.get("track") and session.get("track") != filters["track"]:
        return False
    if filters.get("templateId") and session.get("templateId") != filters["templateId"]:
        return False
    if role_filter:
        template = templates_by_id.get(session.get("templateId") or "")
        if _role_of(template) != role_filter:
            return False
    return in_range(session.get("createdAt"), filters.get("dateFrom"), filters.get("dateTo"))


def _distribution(overalls: list[float]) -> list[dict]:
    counts = {bucket: 0 for bucket in BUCKETS}
    for score in overalls:
        counts[_bucket_of(score)] += 1
    return [{"bucket": bucket, "count": counts[bucket]} for bucket in BUCKETS]


def _kpi_averages(rows: list[dict], scored: int) -> list[dict]:
    """Per-KPI averages by id, across templates that may use different rubrics.

    `coverage` is what makes that honest: a KPI only two of fifty sessions scored would
    otherwise sit in the chart looking as authoritative as one every session used.
    """
    aggregate: dict[str, dict] = {}

    for row in rows:
        rubric = (row["template"] or {}).get("rubric") or {}
        labels = {kpi.get("id"): kpi.get("label") for kpi in rubric.get("kpis") or []}

        for kpi_id, value in (row["report"].get("kpiAverages") or {}).items():
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue
            entry = aggregate.setdefault(kpi_id, {"sum": 0, "count": 0, "label": kpi_id})
            entry["sum"] += value
            entry["count"] += 1
            # A real label from any template that has one beats the raw id.
            if entry["label"] == kpi_id and labels.get(kpi_id):
                entry["label"] = labels[kpi_id]

    return sorted(
        (
            {
                "kpiId": kpi_id,
                "label": entry["label"],
                "average": round(entry["sum"] / entry["count"]),
                "coverage": entry["count"] / scored if scored else 0,
            }
            for kpi_id, entry in aggregate.items()
        ),
        key=lambda item: item["average"],
        reverse=True,
    )


def _by_track(cohort: list[dict], rows: list[dict]) -> list[dict]:
    """Counts and completion over the whole cohort; averages over scored only."""
    tracks = {session.get("track") for session in cohort}
    out = []
    for track in tracks:
        in_track = [s for s in cohort if s.get("track") == track]
        scored_in_track = [r for r in rows if r["session"].get("track") == track]
        completed = sum(1 for s in in_track if s.get("status") == "completed")
        out.append(
            {
                "track": track,
                "count": len(in_track),
                "averageOverall": _mean(
                    [r["report"].get("overallScore") or 0 for r in scored_in_track]
                ),
                "completionRate": completed / len(in_track) if in_track else 0,
            }
        )
    return sorted(out, key=lambda item: item["count"], reverse=True)


def _by_role(
    cohort: list[dict], templates_by_id: dict[str, dict], reports_by_session: dict[str, dict]
) -> list[dict]:
    grouped: dict[str, dict] = {}
    for session in cohort:
        role = _role_of(templates_by_id.get(session.get("templateId") or ""))
        entry = grouped.setdefault(role, {"count": 0, "scores": []})
        entry["count"] += 1
        report = reports_by_session.get(session.get("id") or "")
        if report:
            entry["scores"].append(report.get("overallScore") or 0)

    return sorted(
        (
            {"role": role, "count": entry["count"], "averageOverall": _mean(entry["scores"])}
            for role, entry in grouped.items()
        ),
        key=lambda item: item["count"],
        reverse=True,
    )


def _by_template(
    cohort: list[dict], templates_by_id: dict[str, dict], reports_by_session: dict[str, dict]
) -> list[dict]:
    grouped: dict[str, dict] = {}
    for session in cohort:
        template_id = session.get("templateId") or ""
        template = templates_by_id.get(template_id)
        entry = grouped.setdefault(
            template_id,
            # Named rather than blank: a deleted template's sessions still happened, and
            # an unlabelled row in the chart looks like a bug.
            {"name": (template or {}).get("name") or DELETED_TEMPLATE, "count": 0, "scores": []},
        )
        entry["count"] += 1
        report = reports_by_session.get(session.get("id") or "")
        if report:
            entry["scores"].append(report.get("overallScore") or 0)

    return sorted(
        (
            {
                "templateId": template_id,
                "name": entry["name"],
                "count": entry["count"],
                "averageOverall": _mean(entry["scores"]),
            }
            for template_id, entry in grouped.items()
        ),
        key=lambda item: item["count"],
        reverse=True,
    )


def _trend(rows: list[dict]) -> list[dict]:
    """Scores by completion day, in UTC.

    Keyed on the session's completion rather than its creation: the trend is about when
    interviews were finished, and an invite sent in March and taken in May belongs to
    May. Falls back to the report's generation time when a session never recorded one.
    """
    by_day: dict[str, list[float]] = {}
    for row in rows:
        done = row["session"].get("completedAt") or row["report"].get("generatedAt")
        moment = to_ms(done)
        if moment is None:
            continue
        day = datetime.fromtimestamp(moment / 1000, timezone.utc).date().isoformat()
        by_day.setdefault(day, []).append(row["report"].get("overallScore") or 0)

    return [
        {"date": day, "count": len(scores), "averageOverall": _mean(scores)}
        for day, scores in sorted(by_day.items())
    ]


def _time_stats(rows: list[dict]) -> dict:
    durations = []
    per_question = []

    for row in rows:
        started = to_ms(row["session"].get("startedAt"))
        completed = to_ms(row["session"].get("completedAt"))
        if started is not None and completed is not None:
            seconds = (completed - started) / 1000
            if seconds > 0:
                durations.append(seconds)

        average = average_time_per_question(row["session"], row["report"])
        if average is not None:
            per_question.append(average)

    return {
        "avgDurationSeconds": _mean(durations),
        "avgTimePerQuestionSeconds": _mean(per_question),
    }


def _recommendations(rows: list[dict]) -> list[dict]:
    counts: dict[str, int] = {}
    for row in rows:
        # "unknown" rather than dropping it: a not-evaluated report has no
        # recommendation, and omitting those would make the distribution add up to fewer
        # interviews than were run.
        recommendation = row["report"].get("recommendation") or "unknown"
        counts[recommendation] = counts.get(recommendation, 0) + 1
    return [
        {"recommendation": recommendation, "count": count}
        for recommendation, count in counts.items()
    ]


def _integrity_rate(rows: list[dict], scored: int) -> float:
    flagged = sum(1 for row in rows if row["session"].get("integrityEvents"))
    return flagged / scored if scored else 0


def _top_candidates(rows: list[dict]) -> list[dict]:
    ranked = sorted(
        rows, key=lambda row: row["report"].get("overallScore") or 0, reverse=True
    )
    return [
        {
            "sessionId": row["session"].get("id"),
            "name": (row["session"].get("candidate") or {}).get("name") or "Candidate",
            "role": (row["template"] or {}).get("role", "").strip() or None,
            "overallScore": row["report"].get("overallScore") or 0,
        }
        for row in ranked[:TOP_CANDIDATE_LIMIT]
    ]

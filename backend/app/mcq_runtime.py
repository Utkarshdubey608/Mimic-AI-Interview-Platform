"""Sitting an MCQ paper — the runtime both clients call.

Three operations, and everything else here exists to keep one promise: **the answer key
never leaves the server.**

    resolve   the paper as the candidate may see it, plus what they have answered
    save      autosave — a refresh must not cost somebody their answers
    submit    score against the stored key, write the result, finish

── How the key is kept in ────────────────────────────────────────────────────
The paper is read FRESH from `mcq_sets/{id}` on every call and projected through
`mcq_scoring.mcq_public_question` on the way out — an allow-list, so a field added to a
stored question next year is invisible until somebody names it there deliberately.

Nothing in this module writes a question into the attempt document. The web runtime did
the opposite: it resolved the paper into `web_sessions` at create time, key included,
and read it back from there. That is what welded MCQ to one surface, and it is why the
attempt here stores only what the candidate chose.

── Why submit writes the same two places as every other track ────────────────
`interviews.result` for the flat score the frozen Dart model reads, and
`reports/{interviewId}` for the per-question breakdown. MCQ's score is exact rather than
a model's opinion, but a recruiter reads it on the same screens as every other track's —
so it lands in the same shape rather than a special one.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from app import interviews, mcq, mcq_scoring, reports
from app.config import Settings

logger = logging.getLogger("mcq.runtime")


class PaperUnavailable(RuntimeError):
    """The interview names a paper that cannot be served."""


class AlreadySubmitted(RuntimeError):
    """The candidate has handed this paper in. Answered once, scored once."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def total_seconds_for(config: dict, interview_data: dict) -> int | None:
    """How long the candidate has for the whole paper, or None for untimed.

    Falls back to the interview's own `durationMinutes` when the paper carries no
    `totalSeconds`. That fallback is the point rather than a nicety: the candidate
    has already been shown "15 min" on their interviews screen, and until this the
    MCQ runtime had no clock at all — so the one number they were given was the
    one number nothing enforced or displayed.
    """
    configured = config.get("totalSeconds")
    if isinstance(configured, (int, float)) and configured > 0:
        return int(configured)
    minutes = interview_data.get("durationMinutes")
    if isinstance(minutes, (int, float)) and minutes > 0:
        return int(minutes * 60)
    return None


def remaining_seconds_for(total_seconds: int | None, started_at: object) -> int | None:
    """Seconds left on the attempt, computed HERE rather than on the device.

    The client shows a ticking clock, but it must not decide what the clock says: a
    phone's clock is the one input a candidate can trivially change, and
    `startedAt` + a device "now" would hand them the deadline. So the device is
    told how much is left at load and ticks down from there.

    None when the paper is untimed or the attempt has no usable start stamp — the
    caller renders no clock rather than a wrong one. Never negative: 0 means "time
    is up", which is a state the client acts on.
    """
    if total_seconds is None or total_seconds <= 0:
        return None
    if not isinstance(started_at, str) or not started_at.strip():
        return None
    try:
        started = datetime.fromisoformat(started_at.strip())
    except ValueError:
        return None
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    return max(0, int(total_seconds - elapsed))


def set_id_for(interview_data: dict) -> str:
    """Which paper this interview assigns, or "".

    Under `screening`, where `interview_invite.build_document` puts it, with a
    top-level fallback for a document written by hand or by another client.
    """
    screening = interview_data.get("screening")
    screening = screening if isinstance(screening, dict) else {}
    return str(screening.get("mcqSetId") or interview_data.get("mcqSetId") or "")


def _config_for(interview_data: dict, paper: dict) -> dict:
    """Scoring rules, from the interview's config over the paper's own."""
    screening = interview_data.get("screening")
    screening = screening if isinstance(screening, dict) else {}
    config = screening.get("mcqConfig") or interview_data.get("mcqConfig") or {}
    if not isinstance(config, dict):
        config = {}
    return {**(paper.get("config") or {}), **config}


async def _read_paper(settings: Settings, mcq_set_id: str) -> dict:
    def _read() -> dict | None:
        snapshot = mcq.sets_collection(settings).document(mcq_set_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    paper = await asyncio.to_thread(_read)
    if not paper:
        # The recruiter deleted the set after sending it. A candidate cannot be shown a
        # paper that no longer exists, and inventing an empty one would score them zero.
        raise PaperUnavailable("This assessment is no longer available.")
    return paper


async def _read_attempt(settings: Settings, interview_id: str) -> dict | None:
    def _read() -> dict | None:
        snapshot = mcq.attempts_collection(settings).document(interview_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    return await asyncio.to_thread(_read)


async def _write_attempt(settings: Settings, interview_id: str, attempt: dict) -> None:
    def _write() -> None:
        mcq.attempts_collection(settings).document(interview_id).set(attempt)

    await asyncio.to_thread(_write)


async def resolve(
    settings: Settings, *, interview_id: str, interview_data: dict, candidate_email: str
) -> dict:
    """The paper a candidate may see, plus their progress. Starts the attempt if new.

    Idempotent: opening the paper twice, on two devices, or after a refresh returns the
    same attempt rather than starting a second one — the attempt is keyed by the
    interview, so there is nowhere for a second one to live.
    """
    mcq_set_id = set_id_for(interview_data)
    if not mcq_set_id:
        raise PaperUnavailable("This interview has no assessment attached.")

    paper = await _read_paper(settings, mcq_set_id)
    attempt = await _read_attempt(settings, interview_id)

    if attempt is None:
        attempt = mcq.new_attempt(
            interview_id=interview_id,
            candidate_email=candidate_email,
            mcq_set_id=mcq_set_id,
        )
        await _write_attempt(settings, interview_id, attempt)

    config = _config_for(interview_data, paper)
    questions = mcq.public_paper(
        paper, seed=mcq.shuffle_seed_for(config, attempt_key=interview_id)
    )
    answers = attempt.get("answers") or {}
    total_seconds = total_seconds_for(config, interview_data)

    return {
        "interviewId": interview_id,
        "status": attempt.get("status") or mcq.STATUS_IN_PROGRESS,
        "name": paper.get("name") or "",
        "questions": questions,
        # Absent rather than empty for an unsectioned paper, so a client can ask "is
        # this divided?" and get an answer instead of rendering a blank heading.
        "sections": mcq.public_sections(paper) or None,
        "answers": answers,
        "answered": mcq.answered_count(answers),
        "total": len(questions),
        "totalSeconds": total_seconds,
        "perQuestionSeconds": config.get("perQuestionSeconds"),
        "startedAt": attempt.get("startedAt"),
        # What the clock on the device counts down from. Sent alongside
        # `startedAt` rather than instead of it: the stamp is the record of when
        # they began, this is the only number a client may trust.
        "remainingSeconds": remaining_seconds_for(
            total_seconds, attempt.get("startedAt")
        ),
        "submittedAt": attempt.get("submittedAt"),
    }


async def save(
    settings: Settings, *, interview_id: str, interview_data: dict, answers: object
) -> dict:
    """Autosave. Merges into what is already stored rather than replacing.

    A merge because a client may send only what changed, and because two tabs on the
    same paper should not erase each other's work — the later write wins per question,
    not per paper.

    Refuses once submitted: the score is written, and a further answer would leave the
    stored attempt disagreeing with the result derived from it.
    """
    attempt = await _read_attempt(settings, interview_id)
    if attempt is None:
        raise PaperUnavailable("This assessment has not been started.")
    if mcq.is_submitted(attempt):
        raise AlreadySubmitted("This assessment is already submitted.")

    paper = await _read_paper(settings, str(attempt.get("mcqSetId") or ""))
    questions = mcq.questions_of(paper)
    merged = {
        **(attempt.get("answers") or {}),
        **mcq.clean_answers(answers, questions),
    }
    await _write_attempt(
        settings, interview_id, {**attempt, "answers": merged, "updatedAt": _now()}
    )
    return {"ok": True, "saved": mcq.answered_count(merged), "total": len(questions)}


async def submit(
    settings: Settings,
    *,
    interview_id: str,
    interview_data: dict,
    answers: object = None,
) -> dict:
    """Score the paper and finish.

    `answers` may carry a final batch — whatever was chosen since the last autosave — so
    a candidate who answers and submits in one go is not scored without it.

    Submitting twice is REFUSED rather than rescored. The score is deterministic, so a
    second run would produce the same number; the point is that the first submission is
    the one the candidate stood behind, and the result must not depend on how many times
    a button was pressed.
    """
    attempt = await _read_attempt(settings, interview_id)
    if attempt is None:
        raise PaperUnavailable("This assessment has not been started.")
    if mcq.is_submitted(attempt):
        raise AlreadySubmitted("This assessment is already submitted.")

    paper = await _read_paper(settings, str(attempt.get("mcqSetId") or ""))
    questions = mcq.questions_of(paper)
    final = {**(attempt.get("answers") or {}), **mcq.clean_answers(answers, questions)}

    scored = score(questions, final, config=_config_for(interview_data, paper), paper=paper)

    submitted_at = _now()
    await _write_attempt(
        settings,
        interview_id,
        {
            **attempt,
            "answers": final,
            "status": mcq.STATUS_SUBMITTED,
            "submittedAt": submitted_at,
            "updatedAt": submitted_at,
        },
    )
    await _store_result(settings, interview_id, interview_data, scored, paper)

    logger.info(
        "mcq submitted interview=%s correct=%s/%s percent=%s",
        interview_id,
        scored.get("correctCount"),
        scored.get("questionCount"),
        scored.get("percent"),
    )
    return {
        "submitted": True,
        "submittedAt": submitted_at,
        "answered": mcq.answered_count(final),
        "total": len(questions),
        # What the candidate is entitled to see of their own result, and no more —
        # `showScoreToCandidate` gates even that. See `candidate_result`.
        "result": candidate_result(scored)
        if _config_for(interview_data, paper).get("showScoreToCandidate")
        else None,
    }


def score(questions: list[dict], answers: dict, *, config: dict, paper: dict) -> dict:
    """One paper, scored — the shape BOTH runtimes store.

    Pure, and separate from `submit` so the web route can call the identical scorer
    without going through the shared attempt document. That is the whole of 11b.5: one
    scorer, so the same paper sat on either surface cannot produce two numbers.
    """
    result = mcq_scoring.score_submission(
        questions,
        answers,
        multi_rule=config.get("multiRule") or mcq_scoring.ALL_OR_NOTHING,
        match_rule=config.get("matchRule") or mcq_scoring.PARTIAL,
        pass_threshold=config.get("passThreshold"),
    )
    result["topics"] = mcq_scoring.topic_breakdown(questions, result["questions"])
    # Only present for a paper that HAS sections — see `mcq.public_sections`.
    if sections := mcq_scoring.section_breakdown(
        questions, result["questions"], sections=mcq.sections_of(paper)
    ):
        result["sections"] = sections
    return result


def candidate_result(scored: dict | None) -> dict | None:
    """The score, WITHOUT the answers that produced it.

    Showing a candidate their score is not the same as publishing the key, and the
    stored result carries both: every per-question record holds `correctOptionIds`,
    because that is what makes the RECRUITER's report reviewable. Returning it verbatim
    would hand the whole key to anyone whose recruiter enabled `showScoreToCandidate` —
    the exact leak the paper route is careful to prevent, arriving through the back door.

    So this is an allow-list too, and per question it names only what the candidate is
    entitled to: whether they got it right, and what it was worth.
    """
    if not scored:
        return None
    return {
        "kind": "mcq",
        "correctCount": scored.get("correctCount"),
        "questionCount": scored.get("questionCount"),
        "points": scored.get("points"),
        "pointsAvailable": scored.get("pointsAvailable"),
        "percent": scored.get("percent"),
        "passThreshold": scored.get("passThreshold"),
        "passed": scored.get("passed"),
        "questions": [
            {
                "questionId": record.get("questionId"),
                "correct": record.get("correct"),
                "points": record.get("points"),
                "pointsAvailable": record.get("pointsAvailable"),
            }
            for record in scored.get("questions") or []
        ],
    }


def result_summary(scored: dict, *, paper: dict) -> dict:
    """The flat `interviews.result` block for a scored paper.

    Same shape `reports.build_result_summary` produces for an AI-scored interview,
    because a recruiter reads MCQ results on the same screens as every other track's and
    the frozen Dart model reads these field names directly.

    Two deliberate differences:

    * `evaluatedBy: "mcq"`. Nothing generated this — it was compared. A recruiter
      looking at a re-score list should not be offered a retry for a number that cannot
      change.
    * `overallScore` is 0 for a paper with nothing scoreable in it, where `percent` is
      None. The field is required by the Dart reader and has no absent state; the
      summary line says so in words.

    `resultPublished` is absent, as everywhere else: releasing a result to the candidate
    is a recruiter action.
    """
    percent = scored.get("percent")
    correct = scored.get("correctCount") or 0
    total = scored.get("questionCount") or 0
    passed = scored.get("passed")

    if percent is None:
        summary = (
            f"{paper.get('name') or 'Assessment'} submitted. "
            "Nothing on this paper could be scored."
        )
    else:
        # `88.0%` reads as a measurement with a tolerance; `88%` reads as a count of
        # marks, which is what it is. The decimal is kept only when it says something.
        shown = f"{percent:g}"
        summary = (
            f"Scored {correct}/{total} ({shown}%) on "
            f"{paper.get('name') or 'the assessment'}."
        )

    if passed is True:
        recommendation = "yes"
    elif passed is False:
        recommendation = "no"
    else:
        # No threshold was set, so the paper takes no view on pass or fail and neither
        # does this. "maybe" is the same default `build_result_summary` uses.
        recommendation = "maybe"

    return {
        "overallScore": round(percent) if percent is not None else 0,
        "summary": summary,
        "recommendation": recommendation,
        "strengths": [],
        "improvements": [],
        "evaluatedBy": "mcq",
    }


async def _store_result(
    settings: Settings,
    interview_id: str,
    interview_data: dict,
    scored: dict,
    paper: dict,
) -> None:
    """Write the result the same two places every other track writes it.

    `interviews.result` for the flat summary the frozen Dart model reads, and
    `reports/{interviewId}` for the detail. `reports.py` owns that split; MCQ does not
    get a third place just because its score is exact rather than a model's opinion.

    A failure here is logged and swallowed. The candidate has finished and their answers
    are stored — losing the write delays the recruiter seeing a score, and re-running
    submit would recover it, whereas raising would tell somebody who just handed in a
    complete paper that it failed.
    """
    now = _now()
    report = reports.stamp_ids(
        {
            "recruiterId": interview_data.get("recruiterId") or "",
            "track": "mcq",
            # `role` is the web surface's additive key; `title` is the frozen one every
            # assignment carries. Either names the paper on a report listing.
            "role": interview_data.get("role") or interview_data.get("title") or "",
            "candidateName": interview_data.get("candidateName") or "",
            "candidateEmail": interview_data.get("candidateEmail") or "",
            # The rich per-question detail, keyed under `mcq` exactly as the web
            # surface has always written it, so existing readers need no change.
            "mcq": scored,
            # And the flat fields every OTHER report carries, so a reader that knows
            # nothing about MCQ still has a score and a sentence to show.
            **result_summary(scored, paper=paper),
            "createdAt": now,
            "generatedAt": now,
        },
        interview_id,
    )

    def _write() -> None:
        from firebase_admin import firestore as admin_firestore

        interviews.collection(settings).document(interview_id).set(
            {
                "result": result_summary(scored, paper=paper),
                "status": "completed",
                "completedAt": admin_firestore.SERVER_TIMESTAMP,
                "updatedAt": admin_firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )
        reports.collection(settings).document(interview_id).set(report)

    try:
        await asyncio.to_thread(_write)
    except Exception as exc:  # noqa: BLE001 - the attempt is safe either way
        logger.error("could not store the MCQ result for %s: %s", interview_id, exc)

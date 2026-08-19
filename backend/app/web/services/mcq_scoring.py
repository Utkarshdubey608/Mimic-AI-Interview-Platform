"""Deterministic scoring for the MCQ track.

MCQ is the one mode whose answers are CLOSED. The correct answer is known before
the candidate arrives, so scoring is a comparison, not a judgement: exact,
instant, reproducible, and free. Nothing in this module calls a model, and
nothing in it should ever start to — the moment an MCQ score depends on an LLM it
stops being reproducible, and a candidate who appeals a result deserves an answer
better than "the model said so".

That is the difference from every other track. `app/evaluation.py` builds a
scoring prompt and asks Gemini, because there is no key to compare an open answer
against. Here there is.

── The two rules for multi-select ────────────────────────────────────────────
ALL_OR_NOTHING is the default, and deliberately. Partial credit needs a
defensible penalty for wrong selections; without one, selecting every option
scores full marks on every multi-select question in the paper. Recruiters who
want partial credit opt into it explicitly and get a penalty applied.

── What this module never sees ───────────────────────────────────────────────
The candidate's client. The key lives in the session document and is compared
here, server-side, on submit. See `mcq_public_question` for the allow-list that
decides what a candidate is actually shown.
"""

from __future__ import annotations

from collections.abc import Callable

# The scoring rules for a multi-select question.
ALL_OR_NOTHING = "all_or_nothing"
PARTIAL = "partial"
MULTI_RULES = (ALL_OR_NOTHING, PARTIAL)

DEFAULT_POINTS = 1.0


def _ids(value: object) -> set[str]:
    """A set of option ids from whatever the caller had.

    Tolerant on purpose: this reads a stored document and a client submission,
    and neither is worth a 500 over a stray null or a non-string id.
    """
    if not isinstance(value, (list, tuple, set)):
        return set()
    return {str(v) for v in value if isinstance(v, (str, int)) and str(v).strip()}


def _points_of(question: dict) -> float:
    raw = question.get("points")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return DEFAULT_POINTS
    # A zero-point question is legitimate (an ungraded survey item); a negative
    # one is a typo that would let a wrong answer raise the total.
    return float(raw) if raw >= 0 else DEFAULT_POINTS


def score_question(question: dict, selected: object, *, multi_rule: str = ALL_OR_NOTHING) -> dict:
    """One question, scored.

    Returns the per-question record the report shows: what was selected, what was
    correct, whether it was right, and the points earned out of the points
    available. The key is included in THIS record because it is recruiter-facing —
    it is what makes a result reviewable — and never in the candidate's view.
    """
    key = _ids(question.get("correctOptionIds"))
    picked = _ids(selected)
    available = _points_of(question)
    is_multi = question.get("type") == "multi" or len(key) > 1

    if not key:
        # A question with no key cannot be scored, and guessing one would invent a
        # result. It is reported as unscored and contributes nothing either way,
        # which keeps one malformed question from skewing a whole paper.
        return {
            "questionId": question.get("id"),
            "selectedOptionIds": sorted(picked),
            "correctOptionIds": [],
            "correct": False,
            "unscored": True,
            "points": 0.0,
            "pointsAvailable": 0.0,
        }

    if not is_multi or multi_rule == ALL_OR_NOTHING:
        correct = picked == key
        earned = available if correct else 0.0
    else:
        # Partial credit. Right selections earn their share, wrong ones give it
        # back, and the floor is zero: a question cannot take points off the rest
        # of the paper.
        hits = len(picked & key)
        misfires = len(picked - key)
        share = available / len(key)
        earned = max(0.0, (hits - misfires) * share)
        correct = picked == key

    return {
        "questionId": question.get("id"),
        "selectedOptionIds": sorted(picked),
        "correctOptionIds": sorted(key),
        "correct": correct,
        "points": round(earned, 4),
        "pointsAvailable": available,
    }


def score_submission(
    questions: list[dict],
    answers: dict,
    *,
    multi_rule: str = ALL_OR_NOTHING,
    pass_threshold: float | None = None,
) -> dict:
    """A whole MCQ paper, scored.

    `answers` maps question id → selected option ids. A question the candidate
    never reached is scored as wrong rather than skipped: an unanswered question
    is not a neutral event in an assessment, and dropping it from the denominator
    would let someone improve their percentage by answering less.

    The percentage is over points AVAILABLE, not question count, so a weighted
    paper reports honestly.
    """
    rule = multi_rule if multi_rule in MULTI_RULES else ALL_OR_NOTHING
    per_question = [
        score_question(q, (answers or {}).get(str(q.get("id"))), multi_rule=rule)
        for q in questions or []
    ]

    earned = sum(r["points"] for r in per_question)
    available = sum(r["pointsAvailable"] for r in per_question)
    # None, not 0: a paper with nothing scoreable in it has no percentage, and a
    # zero would read as a candidate who got everything wrong.
    percent = round(earned / available * 100, 1) if available > 0 else None

    result: dict = {
        "kind": "mcq",
        "multiRule": rule,
        "questions": per_question,
        "correctCount": sum(1 for r in per_question if r["correct"]),
        "questionCount": len(per_question),
        "points": round(earned, 4),
        "pointsAvailable": round(available, 4),
        "percent": percent,
    }

    if pass_threshold is not None and percent is not None:
        result["passThreshold"] = pass_threshold
        result["passed"] = percent >= pass_threshold

    return result


def _breakdown(
    questions: list[dict], scored: list[dict], *, label: str, of: "Callable[[dict], str]"
) -> list[dict]:
    """Totals grouped by whatever `of` names a question, for the report.

    Built from the QUESTIONS rather than the answers, so a group every candidate
    got wrong still appears — the parts nobody can answer are the interesting
    ones, and a breakdown that silently omits them is misleading.

    Generalised over the grouping key because topics and sections need identical
    arithmetic and differ only in what they read off the question. Two copies of
    a scoring loop is two places for the rounding to drift apart.
    """
    by_id = {str(q.get("id")): q for q in questions or []}
    buckets: dict[str, dict] = {}

    for record in scored or []:
        question = by_id.get(str(record.get("questionId"))) or {}
        name = of(question)
        bucket = buckets.setdefault(
            name, {label: name, "correct": 0, "count": 0, "points": 0.0, "pointsAvailable": 0.0}
        )
        bucket["count"] += 1
        bucket["correct"] += 1 if record.get("correct") else 0
        bucket["points"] += record.get("points") or 0.0
        bucket["pointsAvailable"] += record.get("pointsAvailable") or 0.0

    for bucket in buckets.values():
        bucket["points"] = round(bucket["points"], 4)
        bucket["pointsAvailable"] = round(bucket["pointsAvailable"], 4)

    return sorted(buckets.values(), key=lambda b: b[label].lower())


def topic_breakdown(questions: list[dict], scored: list[dict]) -> list[dict]:
    """Per-topic totals, for the report."""
    return _breakdown(
        questions,
        scored,
        label="topic",
        of=lambda q: (q.get("topic") or q.get("category") or "Uncategorised").strip(),
    )


def section_breakdown(questions: list[dict], scored: list[dict]) -> list[dict]:
    """Per-section totals — how the candidate did on each half of the paper.

    This is the point of dividing a paper. A recruiter who splits ten questions
    into six technical and four judgement-based did it to see those two numbers
    separately; a single overall percentage throws away exactly the distinction
    they set up.

    Papers written before sections existed have no labels, so this returns [] for
    them rather than one meaningless "Unsectioned" row covering everything.
    """
    if not any(q.get("section") for q in questions or []):
        return []
    return _breakdown(
        questions,
        scored,
        label="section",
        of=lambda q: str(q.get("section") or "unsectioned"),
    )


def mcq_public_question(question: dict, *, shuffle_seed: str | None = None) -> dict:
    """What a candidate is allowed to see of an MCQ question.

    An ALLOW-LIST, not a strip, and that distinction is the whole security
    property. Stripping means listing what to remove, so a field added to the
    stored question later — a second key, an ideal-answer note — ships to the
    browser until somebody remembers to exclude it. Naming what may leave means a
    new field is invisible by default and has to be added here on purpose.

    `correctOptionIds` therefore cannot appear in this dict, no matter what the
    stored question grows.

    Option order is shuffled per candidate when a seed is given, so a leaked
    "the answer is the third one" is worth nothing to the next candidate. The
    shuffle is deterministic in the seed, so a refresh mid-assessment shows the
    same order rather than reshuffling under someone mid-decision.
    """
    options = [
        {"id": str(o.get("id")), "text": str(o.get("text") or "")}
        for o in question.get("options") or []
        if isinstance(o, dict) and o.get("id") is not None
    ]

    if shuffle_seed:
        # Hash-ordered rather than random.shuffle: no global RNG state, and the
        # same (seed, question) pair always yields the same order on any worker.
        import hashlib

        def rank(option: dict) -> str:
            digest = hashlib.sha256(f"{shuffle_seed}:{option['id']}".encode()).hexdigest()
            return digest

        options = sorted(options, key=rank)

    return {
        "id": question.get("id"),
        "text": question.get("text"),
        "type": "multi" if question.get("type") == "multi" else "single",
        "options": options,
        "points": _points_of(question),
    }

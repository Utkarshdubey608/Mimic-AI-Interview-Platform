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


── Why this is in the kernel ─────────────────────────────────────────────────
MCQ is the only track whose QUESTIONS CONTAIN THE ANSWERS. Every other track stores
questions as plain strings, so putting one on a second client is a matter of pointing
it at a shared record. Here the paper carries `correctOptionIds`, and the property that
keeps it safe — `mcq_public_question` being an ALLOW-LIST rather than a strip — has to
be inherited by every client rather than reimplemented per client.

Moved from `app/web/services/`, unchanged. It was always pure: nothing in this file
imports anything but the standard library, which is why the move cost nothing and why
one scorer can serve both surfaces.
"""

from __future__ import annotations

from collections.abc import Callable

# The scoring rules for a multi-select question.
ALL_OR_NOTHING = "all_or_nothing"
PARTIAL = "partial"
MULTI_RULES = (ALL_OR_NOTHING, PARTIAL)

DEFAULT_POINTS = 1.0

# Every question type this module can score. All of them are CLOSED - the answer
# is known before the candidate arrives - which is what keeps scoring a comparison
# rather than a judgement. Coding and debugging questions are code-reading
# questions of these same types with a snippet attached, deliberately: the moment a
# score depends on running code or on a model, it stops being reproducible and a
# candidate who appeals deserves better than "the model said so".
SINGLE = "single"
MULTI = "multi"
MATCH = "match"
QUESTION_TYPES = (SINGLE, MULTI, MATCH)


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


def _pairing(value: object) -> dict[str, str]:
    """A prompt-to-match mapping from whatever the caller had.

    Same tolerance as `_ids`, and for the same reason: this reads both a stored
    document and a client submission, and neither is worth a 500 over a stray null.
    """
    if not isinstance(value, dict):
        return {}
    out: dict[str, str] = {}
    for prompt, match in value.items():
        if isinstance(prompt, (str, int)) and isinstance(match, (str, int)):
            key, target = str(prompt).strip(), str(match).strip()
            if key and target:
                out[key] = target
    return out


def _score_match(question: dict, submitted: object, *, rule: str) -> dict:
    """A match-the-following question, scored.

    PARTIAL is the default here, where ALL_OR_NOTHING is the default for
    multi-select, and the asymmetry is deliberate rather than an oversight.

    Partial credit on multi-select is unsafe because a candidate can select every
    option and collect full marks, so it needs a penalty to be defensible. That
    attack does not exist here: each prompt takes exactly one match, so there is no
    way to over-answer and nothing to penalise. Partial credit is therefore simply
    the fairer reading of a half-right pairing, and it is what a recruiter means by
    "they got three of the five".
    """
    key = _pairing(question.get("correctPairs"))
    picked = _pairing(submitted)
    available = _points_of(question)

    if not key:
        return {
            "questionId": question.get("id"),
            "type": MATCH,
            "selectedPairs": picked,
            "correctPairs": {},
            "correct": False,
            "unscored": True,
            "points": 0.0,
            "pointsAvailable": 0.0,
        }

    # Only prompts the question actually asks about count. A submission naming a
    # prompt that is not in the paper is ignored rather than credited.
    hits = sum(1 for prompt, target in key.items() if picked.get(prompt) == target)
    correct = hits == len(key)
    if rule == ALL_OR_NOTHING:
        earned = available if correct else 0.0
    else:
        earned = available * hits / len(key)

    return {
        "questionId": question.get("id"),
        "type": MATCH,
        "selectedPairs": picked,
        "correctPairs": key,
        "matchedCount": hits,
        "pairCount": len(key),
        "correct": correct,
        "points": round(earned, 4),
        "pointsAvailable": available,
    }


def score_question(
    question: dict,
    selected: object,
    *,
    multi_rule: str = ALL_OR_NOTHING,
    match_rule: str = PARTIAL,
) -> dict:
    """One question, scored.

    Returns the per-question record the report shows: what was selected, what was
    correct, whether it was right, and the points earned out of the points
    available. The key is included in THIS record because it is recruiter-facing —
    it is what makes a result reviewable — and never in the candidate's view.
    """
    if question.get("type") == MATCH:
        return _score_match(
            question, selected, rule=match_rule if match_rule in MULTI_RULES else PARTIAL
        )

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
    match_rule: str = PARTIAL,
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
    pairing_rule = match_rule if match_rule in MULTI_RULES else PARTIAL
    per_question = [
        score_question(
            q,
            (answers or {}).get(str(q.get("id"))),
            multi_rule=rule,
            match_rule=pairing_rule,
        )
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
        "matchRule": pairing_rule,
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


def section_id_of(question: dict) -> str:
    """Which section a question belongs to, or "".

    Reads `sectionId` and falls back to the legacy `section` tag, which held
    "technical" / "non_technical" before sections became first-class. The fallback
    needs no special case anywhere else because those two names are entries in the
    prebuilt library: an old tag simply IS a section id.
    """
    return str(question.get("sectionId") or question.get("section") or "").strip()


def section_breakdown(
    questions: list[dict], scored: list[dict], *, sections: list[dict] | None = None
) -> list[dict]:
    """Per-section totals — how the candidate did on each part of the paper.

    This is the point of dividing a paper. A recruiter who built an aptitude
    section and a role-based section did it to see those two results separately; a
    single overall percentage discards exactly the distinction they set up.

    Rows come back in the PAPER'S OWN ORDER when a manifest is given, not
    alphabetically. A report that lists section three before section one is harder
    to read against the assessment the recruiter actually built.

    Papers with no sections return [] rather than one meaningless row covering
    everything.
    """
    names = {
        str(section.get("id")): str(section.get("name") or "").strip()
        for section in sections or []
        if section.get("id")
    }
    order = {section_id: index for index, section_id in enumerate(names)}

    if not any(section_id_of(q) for q in questions or []):
        return []

    rows = _breakdown(
        questions,
        scored,
        label="sectionId",
        of=lambda q: section_id_of(q) or "unsectioned",
    )
    for row in rows:
        section_id = row["sectionId"]
        # A legacy tag has no manifest entry, so its id is title-cased into a label
        # rather than shown raw: "non_technical" reads badly in a report.
        row["name"] = names.get(section_id) or section_id.replace("_", " ").title()

    # Manifest order first, then anything the manifest does not mention — a section
    # deleted after the assessment was sat still has to appear in the report.
    return sorted(rows, key=lambda row: (order.get(row["sectionId"], len(order)), row["name"]))


def _shuffled(items: list[dict], *, seed: str) -> list[dict]:
    """`items` in a per-candidate order that is stable across reloads.

    Hash-ordered rather than `random.shuffle`: no global RNG state to worry about,
    and the same (seed, id) pair yields the same position on any worker. A refresh
    mid-assessment therefore shows the same order rather than reshuffling the
    options under somebody who was halfway through deciding.
    """
    import hashlib

    return sorted(
        items, key=lambda item: hashlib.sha256(f"{seed}:{item['id']}".encode()).hexdigest()
    )


def _unaligned(
    matches: list[dict], prompts: list[dict], pairs: dict[str, str]
) -> list[dict]:
    """`matches`, guaranteed not to be sitting in the answer's own order.

    A match question is authored a row at a time — "Binary search" next to
    "O(log n)" — so the stored order of column B IS the pairing. Publishing both
    columns as authored hands over the whole answer with no key ever leaving the
    server: the candidate pairs row one with row one and scores full marks.

    Shuffling usually breaks that, but "usually" is not a security property, and
    with three pairs a hash order lands back on the paired arrangement one time in
    six. So the alignment is checked and broken by rotating one position, which
    makes this a guarantee rather than a likelihood.

    Two pairs are the minimum for this to mean anything; a one-pair question is
    degenerate and authoring rejects it.
    """
    if len(matches) < 2 or not pairs:
        return matches
    paired_order = [pairs.get(str(prompt["id"])) for prompt in prompts]
    if [match["id"] for match in matches] == paired_order:
        return matches[1:] + matches[:1]
    return matches


def _public_match(question: dict, seed: str | None) -> dict:
    """A match question as the candidate may see it: two columns, no pairing.

    The pairing IS the answer key, so `correctPairs` cannot appear here. The
    subtler leak is ORDER, and `_unaligned` is what closes it.

    Note that column B is reordered even when option shuffling is switched OFF.
    That setting is about denying a candidate the tip "it's the third one", which
    is a nice-to-have; here the authored order is the answer itself, so leaving it
    alone is not a weaker choice but a broken one.
    """
    prompts = [
        {"id": str(p.get("id")), "text": str(p.get("text") or "")}
        for p in question.get("prompts") or []
        if isinstance(p, dict) and p.get("id") is not None
    ]
    matches = [
        {"id": str(m.get("id")), "text": str(m.get("text") or "")}
        for m in question.get("matches") or []
        if isinstance(m, dict) and m.get("id") is not None
    ]

    if seed:
        prompts = _shuffled(prompts, seed=f"{seed}:prompts")
    # Falls back to the question id so the order is still fixed per question and
    # stable across reloads when no per-candidate seed was given.
    order_seed = seed or str(question.get("id") or "")
    if order_seed:
        matches = _shuffled(matches, seed=f"{order_seed}:matches")
    matches = _unaligned(matches, prompts, _pairing(question.get("correctPairs")))

    public: dict = {
        "id": str(question.get("id")),
        "type": MATCH,
        "text": str(question.get("text") or ""),
        "prompts": prompts,
        "matches": matches,
        "points": _points_of(question),
    }
    if code := question.get("code"):
        public["code"] = str(code)
    return public


def mcq_public_question(question: dict, *, shuffle_seed: str | None = None) -> dict:
    """What a candidate is allowed to see of a question.

    An ALLOW-LIST, not a strip, and that distinction is the whole security
    property. Stripping means listing what to remove, so a field added to the
    stored question later — a second key, an ideal-answer note — ships to the
    browser until somebody remembers to exclude it. Naming what may leave means a
    new field is invisible by default and has to be added here on purpose.

    That property is what makes new question types safe to add: each type gets its
    own branch naming its own visible fields, so neither `correctOptionIds` nor
    `correctPairs` can appear no matter what the stored question grows.

    `sectionId` is deliberately NOT published. The runtime learns about sections
    from the paper's manifest, which carries no keys; repeating the id on every
    question would be a second place to keep honest for no gain.
    """
    if question.get("type") == MATCH:
        return _public_match(question, shuffle_seed)

    options = [
        {"id": str(o.get("id")), "text": str(o.get("text") or "")}
        for o in question.get("options") or []
        if isinstance(o, dict) and o.get("id") is not None
    ]
    if shuffle_seed:
        options = _shuffled(options, seed=shuffle_seed)

    public: dict = {
        "id": question.get("id"),
        "text": question.get("text"),
        "type": MULTI if question.get("type") == MULTI else SINGLE,
        "options": options,
        "points": _points_of(question),
    }
    # The snippet a code-reading question is ABOUT. Visible by necessity — the
    # question is unanswerable without it — and it carries no key.
    if code := question.get("code"):
        public["code"] = str(code)
    return public

"""Essay mode: counting, limits, band presentation and readiness.

Pure functions. The scoring itself reuses `scoring.py` unchanged — essay mode is
another rubric-scored track, not a second scoring engine, and the weighting and
the server-side overall it already computes are exactly what a rubric of
long-form KPIs needs.

THREE THINGS HERE DECIDE WHETHER A CANDIDATE IS TREATED FAIRLY.

Counting must agree with the editor. A candidate who watched the counter read 249
and was then rejected for "under 250" was failed by two implementations
disagreeing, not by their writing. So the rule is deliberately the simplest one a
person would apply — runs of non-whitespace — and the client is expected to match
it rather than the other way round.

Limits are policy, not truth. `limit_state` reports; whether being under is a
warning or a refusal is the recruiter's configured decision, made once, visibly.

Bands are PRESENTATION ONLY. Scores are stored 0-100 like every other track's
`kpiScores`, because `analytics._kpi_averages` aggregates on that scale and the
frozen Dart reader on `interviews.result` expects it. An IELTS band is computed
for display and never persisted as the score — storing 0-9 instead would silently
break both, for a cosmetic gain.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Runs of non-whitespace. "well-argued" is one word, which is the commonest
# disagreement between two counters and decides whether someone is over a limit.
_WORD = re.compile(r"\S+")

# A token that is only punctuation is not a word: "Yes, indeed -- truly." is
# three, which is what a person counting would say.
_HAS_ALNUM = re.compile(r"\w", re.UNICODE)

BAND_SCALES = ("ielts",)


def count_words(text: str) -> int:
    """Words as a person reading the editor would count them."""
    return sum(1 for token in _WORD.findall(str(text or "")) if _HAS_ALNUM.search(token))


def count_chars(text: str) -> int:
    """Characters as typed, with line endings normalised first.

    CRLF is one character to somebody looking at their screen. Counting it as two
    makes a Windows candidate hit a character limit sooner than a Mac one, for
    writing the identical essay.
    """
    return len(str(text or "").replace("\r\n", "\n").replace("\r", "\n"))


@dataclass(frozen=True)
class LimitState:
    """Where a count sits against its configured range."""

    state: str  # "ok" | "under" | "over"
    delta: int  # how far outside; 0 when ok


def limit_state(*, count: int, minimum: int | None, maximum: int | None) -> LimitState:
    """Report only. Enforcing or warning is the recruiter's configured choice."""
    if minimum and count < minimum:
        return LimitState("under", minimum - count)
    if maximum and count > maximum:
        return LimitState("over", count - maximum)
    return LimitState("ok", 0)


def band_for(score: float, *, scale: str) -> float | None:
    """A stored 0-100 score rendered on a reporting band. Display only.

    IELTS reports on 0-9 in half bands, so the mapping rounds to the nearest 0.5
    rather than producing a figure no examiner would ever write. An unknown scale
    returns None rather than inventing a scheme nobody uses.
    """
    if scale not in BAND_SCALES:
        return None
    clamped = 100.0 if score > 100 else 0.0 if score < 0 else float(score)
    return round(clamped / 100.0 * 9.0 * 2.0) / 2.0


def essay_faults(prompt: dict) -> list[str]:
    """What stops this prompt being SET, as opposed to stored.

    The same line `coding_problems.problem_faults` draws, for the same reason: a
    recruiter mid-draft should not be told their work is invalid, but a prompt
    that no candidate can satisfy must not reach one.
    """
    faults: list[str] = []
    if not str(prompt.get("title") or "").strip():
        faults.append("The essay needs a title.")
    if not str(prompt.get("promptMd") or "").strip():
        faults.append("The essay needs a prompt for the candidate to respond to.")

    minimum = prompt.get("minWords") or 0
    maximum = prompt.get("maxWords") or 0
    if minimum and maximum and minimum > maximum:
        # Nobody can write more than the maximum and fewer than the minimum. Left
        # unflagged, every candidate fails the limit check whatever they write.
        faults.append(
            f"The minimum word count ({minimum}) is above the maximum ({maximum}), "
            "so no essay could satisfy both."
        )

    if not prompt.get("timeLimitSeconds"):
        faults.append("The essay needs a time limit.")
    return faults

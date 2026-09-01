"""The stored essay prompt, and what a candidate is allowed to see of it.

An essay prompt holds no hidden answer the way a coding problem or an MCQ paper
does, so the projection is simpler — but it is not absent. The rubric is the
recruiter's marking scheme, and whether a candidate sees it is a configured
decision; leaking it by default would tell every candidate exactly which words to
use to score well, which is not the same as telling them what a good essay is.
"""

from __future__ import annotations

import pytest

from app.web.services.essay_prompts import (
    InvalidEssayPrompt,
    PUBLIC_PROMPT_FIELDS,
    clean_prompt,
    public_prompt,
)

NOW = "2026-09-01T09:00:00+00:00"
RECRUITER_ONLY = "GUIDANCE-4f21ac"


def _prompt(**over) -> dict:
    body = {
        "title": "Automation and employment",
        "promptMd": "Discuss the effect of automation on employment.",
        "promptType": "discursive",
        "language": "en",
        "minWords": 250,
        "maxWords": 500,
        "timeLimitSeconds": 2400,
        "sourcePassageMd": "",
        "guidanceMd": RECRUITER_ONLY,
    }
    body.update(over)
    return clean_prompt(body, recruiter_id="rec-1", prompt_id="ep-1", now=NOW)


# ── storing ───────────────────────────────────────────────────────────────────


def test_a_prompt_stores_its_fields() -> None:
    stored = _prompt()
    assert stored["id"] == "ep-1"
    assert stored["recruiterId"] == "rec-1"
    assert stored["title"] == "Automation and employment"
    assert stored["minWords"] == 250


def test_storing_is_an_allow_list() -> None:
    assert "secretBackdoor" not in _prompt(secretBackdoor="nope")


def test_an_unknown_prompt_type_falls_back_rather_than_raising() -> None:
    """A recruiter mid-draft is not told their work is invalid."""
    assert _prompt(promptType="interpretive-dance")["promptType"] == "argumentative"


def test_a_blank_language_defaults_to_english() -> None:
    assert _prompt(language="")["language"] == "en"


def test_word_limits_are_clamped_to_something_writable() -> None:
    assert _prompt(minWords=-5)["minWords"] == 0
    assert _prompt(maxWords=10_000_000)["maxWords"] <= 50_000


def test_a_nonsense_limit_falls_back_rather_than_raising() -> None:
    assert _prompt(maxWords="loads")["maxWords"] == 0


def test_a_body_that_is_not_an_object_is_refused() -> None:
    with pytest.raises(InvalidEssayPrompt):
        clean_prompt("not a prompt", recruiter_id="r", prompt_id="p", now=NOW)


def test_the_time_limit_is_clamped_to_a_sane_range() -> None:
    assert _prompt(timeLimitSeconds=1)["timeLimitSeconds"] >= 60
    assert _prompt(timeLimitSeconds=999_999)["timeLimitSeconds"] <= 4 * 60 * 60


# ── what the candidate sees ───────────────────────────────────────────────────


def test_the_candidate_sees_the_question_and_its_limits() -> None:
    view = public_prompt(_prompt())
    assert view["promptMd"].startswith("Discuss")
    assert view["minWords"] == 250
    assert view["timeLimitSeconds"] == 2400


def test_the_candidate_never_sees_recruiter_guidance() -> None:
    """Guidance is the recruiter's note to themselves about what they are looking
    for. Shown to a candidate it is a list of the words that score."""
    import json

    payload = json.dumps(public_prompt(_prompt()))
    assert RECRUITER_ONLY not in payload
    assert "guidanceMd" not in payload


def test_the_public_projection_is_a_named_contract() -> None:
    assert set(public_prompt(_prompt())) <= set(PUBLIC_PROMPT_FIELDS)


def test_a_source_passage_is_shown_because_it_is_the_task() -> None:
    view = public_prompt(_prompt(sourcePassageMd="Read the following extract..."))
    assert view["sourcePassageMd"].startswith("Read")

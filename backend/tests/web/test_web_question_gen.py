"""Generating questions from a résumé.

The text cleaner matters more than it looks: these questions are read aloud by the
voice and avatar tracks, where an asterisk becomes the spoken word "asterisk".
"""

from __future__ import annotations

import pytest

from app.web.services import gemini
from app.web.services.question_gen import (
    MAX_QUESTIONS,
    build_prompt,
    clamp_int,
    clean_question_text,
    enforce_split,
    friendly_error,
    normalise,
    total_for,
)


# ── text cleaning ─────────────────────────────────────────────────────────────


def test_markdown_is_stripped() -> None:
    assert clean_question_text("**Bold** and `code`") == "Bold and code"
    assert clean_question_text("* a bullet") == "a bullet"
    assert clean_question_text("# A heading") == "A heading"


def test_em_and_en_dashes_become_commas() -> None:
    """A dash reads as machine-written when spoken aloud."""
    assert clean_question_text("Tell me — briefly — about Kafka.") == "Tell me, briefly, about Kafka."
    assert clean_question_text("A – B") == "A, B"


def test_word_hyphens_survive() -> None:
    """"back-end" is a word, not a dash."""
    assert clean_question_text("Describe your back-end work.") == "Describe your back-end work."


def test_a_comma_stranded_before_a_full_stop_is_removed() -> None:
    """The dash substitution can leave one behind."""
    assert clean_question_text("You shipped it —.") == "You shipped it."


def test_doubled_commas_collapse() -> None:
    assert clean_question_text("A —, B") == "A, B"


def test_whitespace_is_normalised() -> None:
    assert clean_question_text("  too   many\n\nspaces  ") == "too many spaces"


def test_empty_input_is_safe() -> None:
    assert clean_question_text(None) == ""
    assert clean_question_text("") == ""


# ── counts ────────────────────────────────────────────────────────────────────


def test_clamp_int_bounds_and_falls_back() -> None:
    assert clamp_int("5", 0, 25, 8) == 5
    assert clamp_int(99, 0, 25, 8) == 25
    assert clamp_int(-3, 0, 25, 8) == 0
    assert clamp_int("eight", 0, 25, 8) == 8
    assert clamp_int(None, 0, 25, 8) == 8
    assert clamp_int(4.6, 0, 25, 8) == 5  # rounds


def test_total_depends_on_the_style() -> None:
    assert total_for("mix", 3, 2) == 5
    assert total_for("technical", 3, 2) == 3
    assert total_for("non_technical", 3, 2) == 2


# ── the split ─────────────────────────────────────────────────────────────────


def _q(kind: str, n: int) -> list[dict]:
    return [{"text": f"{kind}{i}", "type": kind} for i in range(n)]


def test_mix_enforces_the_split_per_type() -> None:
    """The model front-loads technical questions, so a plain slice would quietly
    return a technical-only screen when a balanced one was asked for."""
    questions = _q("technical", 10) + _q("non_technical", 10)
    result = enforce_split(questions, style="mix", technical=2, non_technical=3)

    assert [q["type"] for q in result] == ["technical"] * 2 + ["non_technical"] * 3


def test_mix_tolerates_the_model_returning_too_few_of_one_type() -> None:
    questions = _q("technical", 1) + _q("non_technical", 5)
    result = enforce_split(questions, style="mix", technical=3, non_technical=2)
    assert len([q for q in result if q["type"] == "technical"]) == 1
    assert len([q for q in result if q["type"] == "non_technical"]) == 2


def test_a_single_style_just_takes_the_first_n() -> None:
    result = enforce_split(_q("technical", 10), style="technical", technical=4, non_technical=9)
    assert len(result) == 4


# ── normalisation ─────────────────────────────────────────────────────────────


def test_normalise_cleans_text_and_rationale() -> None:
    result = normalise(
        {"questions": [{"text": "**Q**", "rationale": "`why`", "type": "technical"}]}
    )
    assert result[0]["text"] == "Q"
    assert result[0]["rationale"] == "why"
    assert result[0]["type"] == "technical"


def test_normalise_drops_questions_with_no_text() -> None:
    result = normalise({"questions": [{"text": "  "}, {"text": "***"}, {"text": "Real"}]})
    assert [q["text"] for q in result] == ["Real"]


def test_normalise_survives_malformed_payloads() -> None:
    for payload in ({}, {"questions": None}, {"questions": "x"}, {"questions": [None, 1]}):
        assert normalise(payload) == []


# ── prompt ────────────────────────────────────────────────────────────────────


def test_the_prompt_states_the_exact_counts_for_mix() -> None:
    prompt = build_prompt(
        style="mix", technical=3, non_technical=2, difficulty="mixed", role="Backend"
    )
    assert "exactly 5 interview questions for a Backend role" in prompt
    assert "EXACTLY 3 technical and 2 non-technical" in prompt
    assert "balanced mix of easy, medium, and hard" in prompt


def test_a_single_style_prompt_says_every_question_must_be_that_kind() -> None:
    assert "Every question must be TECHNICAL" in build_prompt(
        style="technical", technical=4, non_technical=0, difficulty="hard", role=None
    )
    assert "Every question must be NON-TECHNICAL" in build_prompt(
        style="non_technical", technical=0, non_technical=4, difficulty="easy", role=None
    )


def test_a_fixed_difficulty_is_named() -> None:
    assert "should be hard difficulty" in build_prompt(
        style="mix", technical=1, non_technical=1, difficulty="hard", role=None
    )


def test_the_prompt_bans_what_cannot_be_spoken() -> None:
    """These questions are read aloud, so markdown and dashes are excluded by the
    prompt as well as cleaned afterwards."""
    prompt = build_prompt(style="mix", technical=1, non_technical=1, difficulty="mixed", role=None)
    assert "PLAIN TEXT only" in prompt
    assert "no asterisks" in prompt
    assert "em dashes" in prompt


def test_a_missing_role_omits_the_role_clause() -> None:
    prompt = build_prompt(style="mix", technical=1, non_technical=1, difficulty="mixed", role=None)
    assert "for a  role" not in prompt
    assert "interview questions." in prompt


# ── error translation ─────────────────────────────────────────────────────────


def test_a_credential_failure_names_the_key() -> None:
    message = friendly_error(gemini.GeminiAuthError("bad key"))
    assert "AIza" in message


def test_a_quota_failure_says_to_wait() -> None:
    assert "Wait a moment" in friendly_error(RuntimeError("Gemini returned 429."))
    assert "Wait a moment" in friendly_error(RuntimeError("quota exceeded"))


def test_a_safety_block_suggests_another_resume() -> None:
    assert "different résumé" in friendly_error(RuntimeError("blocked for safety"))


def test_anything_else_is_generic_and_never_leaks_the_raw_error() -> None:
    raw = "Traceback: internal at 10.0.0.4:8080 with token sk-abc"
    message = friendly_error(RuntimeError(raw))
    assert message == "Gemini request failed. Please try again."
    assert "10.0.0.4" not in message
    assert "sk-abc" not in message


def test_the_question_cap_is_sane() -> None:
    assert MAX_QUESTIONS == 25


# ── latency on the candidate's path ───────────────────────────────────────────


async def _fixed_model(_settings) -> str:
    return "gemini-2.5-flash"


@pytest.mark.asyncio
async def test_resume_questions_are_generated_without_thinking(monkeypatch) -> None:
    """A candidate is waiting on this call, so it must not pay for reasoning tokens.

    Measured over five runs of this exact prompt: default (dynamic) thinking
    averaged 11.1s, `thinkingBudget: 0` averaged 3.6s, for output of the same
    length. The assertion is on the request body because that is the contract with
    the API — anything softer would pass while the flag silently regressed.
    """
    import json as _json

    from app.web.services import question_gen

    sent: dict = {}

    async def _capture(settings, *, model: str, request_body: dict):
        sent.update(request_body)
        questions = _json.dumps(
            {"questions": [{"text": "Tell me about Kafka.", "category": "Experience", "idealAnswerNotes": "n"}]}
        )
        payload = {"candidates": [{"content": {"parts": [{"text": questions}]}}]}
        return 200, _json.dumps(payload).encode(), "application/json"

    monkeypatch.setattr(gemini, "generate_content_raw", _capture)
    monkeypatch.setattr(gemini, "resolve_model", _fixed_model)

    questions = await question_gen.generate_from_resume_text(
        None, resume_text="Ada Lovelace. Kafka, Python.", role="Backend", count=1
    )

    assert questions, "the stubbed reply should still parse into questions"
    assert sent["generationConfig"]["thinkingConfig"] == {"thinkingBudget": 0}

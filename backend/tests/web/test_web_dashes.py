"""Dash-style punctuation in text a candidate reads or hears.

A heavy dash style is the clearest tell that a machine wrote something, and these
questions are read aloud by the voice and avatar tracks. Three normalisers handle
it — question_gen (timed + video), conversation (chatbot), shared.speech (voice,
avatar, guide TTS) — and they must agree, because text reaches candidates through
all three.

The hyphens that must SURVIVE are the point of this file. A previous sweep of
hyphens through this repo's marketing prose silently rewrote route slugs
(`plat('ai-video-avatar', …)` became `plat('ai-video avatar', …)`), publishing a
URL with a space in it that nothing caught. Real words and identifiers keep their
hyphens; only dash-style punctuation goes.
"""

from __future__ import annotations

import pytest

from app.web.services.conversation import humanize_punctuation
from app.web.services.question_gen import clean_question_text
from app.web.shared.speech import strip_for_speech

# Every normaliser that touches candidate-facing text.
NORMALISERS = (
    ("question_gen.clean_question_text", clean_question_text),
    ("conversation.humanize_punctuation", humanize_punctuation),
    ("speech.strip_for_speech", strip_for_speech),
)

MUST_SURVIVE = (
    "back-end",
    "e-commerce",
    "full-stack",
    "Anne-Marie",
    "ai-video-avatar",
    "real-time",
    "co-founder",
    "CI/CD build-and-deploy",
)


@pytest.mark.parametrize("name,fn", NORMALISERS)
def test_em_and_en_dashes_become_commas(name, fn) -> None:
    assert fn("Tell me — briefly — about Kafka.") == "Tell me, briefly, about Kafka."
    assert fn("A – B") == "A, B"


@pytest.mark.parametrize("name,fn", NORMALISERS)
def test_a_spaced_hyphen_used_as_a_dash_also_goes(name, fn) -> None:
    """The gap this file was written for: " - " read as a dash by every model."""
    assert fn("Tell me - briefly - about Kafka.") == "Tell me, briefly, about Kafka."


@pytest.mark.parametrize("name,fn", NORMALISERS)
@pytest.mark.parametrize("word", MUST_SURVIVE)
def test_real_hyphens_survive(name, fn, word) -> None:
    """No spaces around it means it is a word, not punctuation."""
    assert word in fn(f"Describe your {word} experience.")


@pytest.mark.parametrize("name,fn", NORMALISERS)
def test_a_hyphen_between_words_is_never_touched(name, fn) -> None:
    sentence = "Our back-end is real-time and the co-founder is Anne-Marie."
    assert fn(sentence) == sentence


@pytest.mark.parametrize("name,fn", NORMALISERS)
def test_ranges_and_negatives_are_left_alone(name, fn) -> None:
    """"3-5 years" and "-40" are not dashes being used as punctuation."""
    assert "3-5" in fn("You have 3-5 years of experience?")


@pytest.mark.parametrize("name,fn", NORMALISERS)
def test_empty_input_is_safe(name, fn) -> None:
    assert fn("") == ""

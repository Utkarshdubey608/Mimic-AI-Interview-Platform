"""Mode A: topic suggestion and paper generation.

The group that matters is `TestNothingTheModelReturnsIsTrusted`. A generated
question that reaches a candidate malformed is worse than a shorter paper: a
question with no correct answer scores EVERY candidate zero, and one with every
option correct scores every candidate full marks. Neither is visible to the
recruiter until the results come back uniform and nobody can explain why.

So generation rebuilds each question from its parts and drops what cannot assess
anybody, rather than forwarding whatever came back.
"""

from __future__ import annotations

import pytest

from app.web.services import mcq_gen


def _option(text: str, correct: bool = False) -> dict:
    return {"text": text, "correct": correct}


def _question(**over) -> dict:
    base = {
        "text": "What does EC2 stand for?",
        "topic": "AWS",
        "difficulty": "medium",
        "explanation": "Elastic Compute Cloud.",
        "options": [
            _option("Elastic Compute Cloud", True),
            _option("Elastic Container Cloud"),
            _option("Encrypted Compute Cluster"),
            _option("Elastic Cache Cluster"),
        ],
    }
    base.update(over)
    return base


class TestNothingTheModelReturnsIsTrusted:
    def test_a_question_with_no_correct_option_is_dropped(self):
        """It would score every candidate zero, invisibly."""
        bad = _question(options=[_option("A"), _option("B")])
        assert mcq_gen.normalise_generated({"questions": [bad]}) == []

    def test_a_question_with_every_option_correct_is_dropped(self):
        """It separates nobody, so it is not an assessment question."""
        bad = _question(options=[_option("A", True), _option("B", True)])
        assert mcq_gen.normalise_generated({"questions": [bad]}) == []

    def test_a_question_with_one_option_is_dropped(self):
        bad = _question(options=[_option("Only", True)])
        assert mcq_gen.normalise_generated({"questions": [bad]}) == []

    def test_a_question_with_no_text_is_dropped(self):
        assert mcq_gen.normalise_generated({"questions": [_question(text="   ")]}) == []

    def test_blank_options_do_not_count_toward_the_minimum(self):
        bad = _question(options=[_option("Real", True), _option("   "), _option("")])
        assert mcq_gen.normalise_generated({"questions": [bad]}) == []

    def test_one_bad_question_does_not_discard_the_good_ones(self):
        good, bad = _question(), _question(options=[_option("A"), _option("B")])
        out = mcq_gen.normalise_generated({"questions": [good, bad, good]})
        assert len(out) == 2

    @pytest.mark.parametrize("junk", [None, "text", 42, {"questions": "no"}, {}, {"questions": [1, "x"]}])
    def test_malformed_payloads_never_raise(self, junk):
        assert mcq_gen.normalise_generated(junk if isinstance(junk, dict) else {}) == []


class TestTheShapeWeStore:
    def test_ids_are_ours_not_the_models(self):
        """The model never supplies an id, so it cannot collide or repeat."""
        out = mcq_gen.normalise_generated({"questions": [_question()]})[0]
        assert out["id"] and len(out["options"]) == 4
        assert len({o["id"] for o in out["options"]}) == 4

    def test_the_key_references_real_option_ids(self):
        out = mcq_gen.normalise_generated({"questions": [_question()]})[0]
        ids = {o["id"] for o in out["options"]}
        assert out["correctOptionIds"] and set(out["correctOptionIds"]) <= ids

    def test_the_correct_option_is_the_one_the_model_marked(self):
        out = mcq_gen.normalise_generated({"questions": [_question()]})[0]
        chosen = [o for o in out["options"] if o["id"] in out["correctOptionIds"]]
        assert [o["text"] for o in chosen] == ["Elastic Compute Cloud"]

    def test_two_correct_options_make_it_multi(self):
        q = _question(options=[_option("A", True), _option("B", True), _option("C")])
        assert mcq_gen.normalise_generated({"questions": [q]})[0]["type"] == "multi"

    def test_one_correct_option_makes_it_single(self):
        assert mcq_gen.normalise_generated({"questions": [_question()]})[0]["type"] == "single"

    def test_topic_difficulty_and_explanation_survive(self):
        out = mcq_gen.normalise_generated({"questions": [_question()]})[0]
        assert out["topic"] == "AWS"
        assert out["difficulty"] == "medium"
        assert out["explanation"] == "Elastic Compute Cloud."

    def test_a_nonsense_difficulty_is_dropped_rather_than_stored(self):
        out = mcq_gen.normalise_generated({"questions": [_question(difficulty="spicy")]})[0]
        assert "difficulty" not in out

    def test_the_paper_is_bounded(self):
        many = {"questions": [_question() for _ in range(200)]}
        assert len(mcq_gen.normalise_generated(many)) == mcq_gen.MAX_QUESTIONS


class TestTopics:
    def test_duplicates_are_removed_case_insensitively(self):
        payload = {"topics": ["Networking", "networking", "  NETWORKING  ", "IAM"]}
        assert mcq_gen.normalise_topics(payload) == ["Networking", "IAM"]

    def test_blank_topics_are_dropped(self):
        assert mcq_gen.normalise_topics({"topics": ["", "   ", "IAM"]}) == ["IAM"]

    def test_the_list_is_bounded(self):
        payload = {"topics": [f"Topic {i}" for i in range(100)]}
        assert len(mcq_gen.normalise_topics(payload)) == mcq_gen.MAX_TOPICS

    @pytest.mark.parametrize("junk", [{}, {"topics": "no"}, {"topics": None}])
    def test_malformed_payloads_give_nothing(self, junk):
        assert mcq_gen.normalise_topics(junk) == []


class TestThePromptSaysTheThingsThatMatter:
    """The prompt is the product here — a paper of obvious answers assesses nobody."""

    def test_it_asks_for_plausible_wrong_answers(self):
        prompt = mcq_gen.build_paper_prompt(
            role="Backend Engineer", topics=["Caching"], count=5, difficulty="mixed", allow_multi=False
        )
        assert "partial or outdated understanding" in prompt

    def test_it_forbids_the_usual_giveaways(self):
        prompt = mcq_gen.build_paper_prompt(
            role="Backend Engineer", topics=["Caching"], count=5, difficulty="mixed", allow_multi=False
        )
        assert "all of the above" in prompt.lower()
        # The length tell: a candidate who spots it passes without knowing anything.
        assert "longer" in prompt

    def test_single_answer_is_stated_when_multi_is_off(self):
        prompt = mcq_gen.build_paper_prompt(
            role="X", topics=["Y"], count=3, difficulty="easy", allow_multi=False
        )
        assert "exactly ONE correct option" in prompt

    def test_the_topics_and_count_reach_the_prompt(self):
        prompt = mcq_gen.build_paper_prompt(
            role="Data Engineer", topics=["Kafka", "Partitioning"], count=12,
            difficulty="hard", allow_multi=True,
        )
        assert "12 multiple-choice questions" in prompt
        assert "Data Engineer" in prompt
        assert "- Kafka" in prompt and "- Partitioning" in prompt
        assert "hard" in prompt

    def test_the_topic_prompt_asks_for_testable_topics(self):
        assert "multiple-choice" in mcq_gen.build_topic_prompt("SRE")

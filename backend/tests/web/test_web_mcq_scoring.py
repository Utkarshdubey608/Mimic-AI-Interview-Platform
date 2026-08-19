"""Deterministic MCQ scoring, and the allow-list that hides the answer key.

The tests that matter most here are not the arithmetic ones — they are
`TestTheKeyNeverReachesTheCandidate`. An MCQ assessment whose key ships to the
browser is not a weaker assessment, it is not an assessment at all: anyone who
opens devtools reads every answer. So that property is asserted directly, and
asserted against the whole serialised payload rather than field by field.
"""

from __future__ import annotations

import json

import pytest

from app.web.services import mcq_scoring as m


def q(qid: str, *, key: list[str], type_: str = "single", points=None, topic=None) -> dict:
    question = {
        "id": qid,
        "text": f"Question {qid}",
        "type": type_,
        "options": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}, {"id": "c", "text": "C"}],
        "correctOptionIds": key,
    }
    if points is not None:
        question["points"] = points
    if topic is not None:
        question["topic"] = topic
    return question


class TestSingleAnswer:
    def test_the_right_option_earns_the_points(self):
        r = m.score_question(q("1", key=["b"]), ["b"])
        assert r["correct"] is True
        assert r["points"] == 1.0

    def test_the_wrong_option_earns_nothing(self):
        r = m.score_question(q("1", key=["b"]), ["a"])
        assert r["correct"] is False
        assert r["points"] == 0.0

    def test_no_answer_is_wrong_not_skipped(self):
        """An unanswered question is not a neutral event in an assessment."""
        r = m.score_question(q("1", key=["b"]), None)
        assert r["correct"] is False
        assert r["points"] == 0.0

    def test_weighted_questions_carry_their_own_points(self):
        assert m.score_question(q("1", key=["b"], points=5), ["b"])["points"] == 5.0

    def test_a_negative_weight_cannot_reward_a_wrong_answer(self):
        """A typo'd -5 would otherwise let a wrong answer raise the total."""
        assert m.score_question(q("1", key=["b"], points=-5), ["b"])["points"] == 1.0


class TestMultiSelectAllOrNothing:
    """The default rule, and why it is the default."""

    def test_the_exact_set_is_required(self):
        question = q("1", key=["a", "c"], type_="multi")
        assert m.score_question(question, ["a", "c"])["points"] == 1.0

    def test_a_partial_answer_earns_nothing(self):
        question = q("1", key=["a", "c"], type_="multi")
        assert m.score_question(question, ["a"])["points"] == 0.0

    def test_selecting_everything_earns_nothing(self):
        """The whole reason all-or-nothing is the default.

        Under a naive partial rule this is full marks on every multi-select
        question in the paper, which makes the paper worthless.
        """
        question = q("1", key=["a", "c"], type_="multi")
        assert m.score_question(question, ["a", "b", "c"])["points"] == 0.0

    def test_order_of_selection_is_irrelevant(self):
        question = q("1", key=["a", "c"], type_="multi")
        assert m.score_question(question, ["c", "a"])["correct"] is True


class TestMultiSelectPartial:
    def test_each_right_option_earns_its_share(self):
        question = q("1", key=["a", "c"], type_="multi", points=2)
        r = m.score_question(question, ["a"], multi_rule=m.PARTIAL)
        assert r["points"] == 1.0
        assert r["correct"] is False  # partial credit is not a correct answer

    def test_a_wrong_option_gives_the_share_back(self):
        question = q("1", key=["a", "c"], type_="multi", points=2)
        # one right (+1), one wrong (-1)
        assert m.score_question(question, ["a", "b"], multi_rule=m.PARTIAL)["points"] == 0.0

    def test_selecting_everything_does_not_pay(self):
        question = q("1", key=["a", "c"], type_="multi", points=2)
        # two right (+2), one wrong (-1)
        assert m.score_question(question, ["a", "b", "c"], multi_rule=m.PARTIAL)["points"] == 1.0

    def test_a_question_can_never_go_negative(self):
        """A floor of zero: one question must not take points off the rest."""
        question = q("1", key=["a"], type_="multi", points=1)
        assert m.score_question(question, ["b", "c"], multi_rule=m.PARTIAL)["points"] == 0.0


class TestWholePaper:
    def test_percent_is_over_points_available_not_question_count(self):
        questions = [q("1", key=["a"], points=1), q("2", key=["a"], points=9)]
        result = m.score_submission(questions, {"2": ["a"]})
        # 9 of 10 points, not "1 of 2 questions"
        assert result["percent"] == 90.0
        assert result["correctCount"] == 1

    def test_unanswered_questions_stay_in_the_denominator(self):
        """Otherwise answering less would improve the percentage."""
        questions = [q("1", key=["a"]), q("2", key=["a"])]
        assert m.score_submission(questions, {"1": ["a"]})["percent"] == 50.0

    def test_a_paper_with_nothing_scoreable_has_no_percentage(self):
        """None, not 0 — a zero reads as a candidate who got everything wrong."""
        assert m.score_submission([], {})["percent"] is None

    def test_a_keyless_question_is_unscored_rather_than_wrong(self):
        questions = [q("1", key=["a"]), q("2", key=[])]
        result = m.score_submission(questions, {"1": ["a"]})
        assert result["questions"][1]["unscored"] is True
        # It contributes to neither side, so one malformed item cannot skew a paper.
        assert result["percent"] == 100.0

    def test_an_unknown_rule_falls_back_to_the_safe_default(self):
        questions = [q("1", key=["a", "c"], type_="multi")]
        result = m.score_submission(questions, {"1": ["a"]}, multi_rule="nonsense")
        assert result["multiRule"] == m.ALL_OR_NOTHING
        assert result["points"] == 0.0

    def test_pass_threshold_is_reported_when_configured(self):
        questions = [q("1", key=["a"]), q("2", key=["a"])]
        result = m.score_submission(questions, {"1": ["a"]}, pass_threshold=50)
        assert result["passed"] is True
        assert m.score_submission(questions, {}, pass_threshold=50)["passed"] is False

    def test_no_verdict_is_invented_without_a_threshold(self):
        assert "passed" not in m.score_submission([q("1", key=["a"])], {})


class TestTheKeyNeverReachesTheCandidate:
    """The property the whole mode depends on."""

    def test_the_public_question_has_no_key(self):
        public = m.mcq_public_question(q("1", key=["b"]))
        assert "correctOptionIds" not in public

    def test_the_key_is_absent_from_the_serialised_payload(self):
        """Asserted against the wire form, not field by field.

        A nested field is still readable in devtools, so the check that matters is
        that the option id does not appear ANYWHERE in what gets sent.
        """
        question = q("1", key=["b"])
        question["idealAnswerNotes"] = "the answer is b"
        payload = json.dumps(m.mcq_public_question(question))
        assert "correctOptionIds" not in payload
        assert "idealAnswerNotes" not in payload
        assert "the answer is b" not in payload

    def test_a_field_added_to_the_stored_question_does_not_leak(self):
        """The allow-list property: new fields are invisible until named here.

        This is why the public view enumerates its fields instead of deleting the
        ones it knows about. A deny-list would ship this to the browser.
        """
        question = q("1", key=["b"])
        question["answerRationale"] = "b, because..."
        question["secondKey"] = ["b"]
        payload = json.dumps(m.mcq_public_question(question))
        assert "answerRationale" not in payload
        assert "secondKey" not in payload

    def test_options_and_their_text_do_travel(self):
        """The candidate must still be able to answer the question."""
        public = m.mcq_public_question(q("1", key=["b"]))
        assert [o["id"] for o in public["options"]] == ["a", "b", "c"]
        assert public["type"] == "single"

    def test_the_recruiter_facing_record_DOES_carry_the_key(self):
        """It is what makes a result reviewable — and it never goes to the client."""
        assert m.score_question(q("1", key=["b"]), ["b"])["correctOptionIds"] == ["b"]


class TestOptionShuffling:
    def test_a_seed_changes_the_order(self):
        question = q("1", key=["b"])
        plain = [o["id"] for o in m.mcq_public_question(question)["options"]]
        seeded = [o["id"] for o in m.mcq_public_question(question, shuffle_seed="cand-1")["options"]]
        assert sorted(seeded) == sorted(plain)  # same options
        # Not asserting inequality on one seed — a shuffle may coincide with the
        # original order. Determinism is the property worth asserting.

    def test_the_same_seed_always_gives_the_same_order(self):
        """A refresh mid-assessment must not reshuffle under someone mid-decision."""
        question = q("1", key=["b"])
        first = [o["id"] for o in m.mcq_public_question(question, shuffle_seed="cand-1")["options"]]
        again = [o["id"] for o in m.mcq_public_question(question, shuffle_seed="cand-1")["options"]]
        assert first == again

    def test_different_candidates_are_ordered_independently(self):
        question = q("1", key=["b"], type_="multi")
        question["options"] = [{"id": str(i), "text": str(i)} for i in range(8)]
        a = [o["id"] for o in m.mcq_public_question(question, shuffle_seed="cand-a")["options"]]
        b = [o["id"] for o in m.mcq_public_question(question, shuffle_seed="cand-b")["options"]]
        assert a != b  # with 8 options a collision is 1 in 40320


class TestTopicBreakdown:
    def test_topics_are_totalled(self):
        questions = [
            q("1", key=["a"], topic="SQL"),
            q("2", key=["a"], topic="SQL"),
            q("3", key=["a"], topic="AWS"),
        ]
        scored = m.score_submission(questions, {"1": ["a"], "3": ["b"]})["questions"]
        rows = {r["topic"]: r for r in m.topic_breakdown(questions, scored)}
        assert rows["SQL"]["correct"] == 1 and rows["SQL"]["count"] == 2
        assert rows["AWS"]["correct"] == 0 and rows["AWS"]["count"] == 1

    def test_a_topic_nobody_answered_still_appears(self):
        """The topics nobody can answer are the interesting ones."""
        questions = [q("1", key=["a"], topic="Kafka")]
        scored = m.score_submission(questions, {})["questions"]
        assert m.topic_breakdown(questions, scored)[0]["topic"] == "Kafka"

    def test_questions_without_a_topic_are_bucketed_not_dropped(self):
        questions = [q("1", key=["a"])]
        scored = m.score_submission(questions, {"1": ["a"]})["questions"]
        assert m.topic_breakdown(questions, scored)[0]["topic"] == "Uncategorised"


@pytest.mark.parametrize("junk", [None, "abc", 42, {"a": 1}, [None, ""], [{}]])
def test_malformed_selections_never_raise(junk):
    """This reads a client submission; a stray null is not worth a 500."""
    assert m.score_question(q("1", key=["a"]), junk)["correct"] is False

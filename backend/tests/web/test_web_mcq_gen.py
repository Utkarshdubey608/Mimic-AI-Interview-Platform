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
            role="Backend Engineer", topics=["Caching"], split={"technical": 5}, difficulty="mixed", allow_multi=False
        )
        assert "partial or outdated understanding" in prompt

    def test_it_forbids_the_usual_giveaways(self):
        prompt = mcq_gen.build_paper_prompt(
            role="Backend Engineer", topics=["Caching"], split={"technical": 5}, difficulty="mixed", allow_multi=False
        )
        assert "all of the above" in prompt.lower()
        # The length tell: a candidate who spots it passes without knowing anything.
        assert "longer" in prompt

    def test_single_answer_is_stated_when_multi_is_off(self):
        prompt = mcq_gen.build_paper_prompt(
            role="X", topics=["Y"], split={"technical": 3}, difficulty="easy", allow_multi=False
        )
        assert "exactly ONE correct option" in prompt

    def test_the_topics_and_count_reach_the_prompt(self):
        prompt = mcq_gen.build_paper_prompt(
            role="Data Engineer", topics=["Kafka", "Partitioning"], split={"technical": 12},
            difficulty="hard", allow_multi=True,
        )
        assert "12 multiple-choice questions" in prompt
        assert "Data Engineer" in prompt
        assert "- Kafka" in prompt and "- Partitioning" in prompt
        assert "hard" in prompt

    def test_the_topic_prompt_asks_for_testable_topics(self):
        assert "multiple-choice" in mcq_gen.build_topic_prompt("SRE")


class TestThePromptActuallyReachesTheModel:
    """The bug this class exists for.

    `suggest_topics` built its message as `{"role", "text"}`. `to_contents` reads
    `content` and DROPS any message without it, so the conversation came out empty
    and `generate_text` refused it before a request was ever sent. Gemini was never
    called at all — and it surfaced to the recruiter as the generic "Gemini request
    failed. Please try again."

    Every other test in this file passed throughout: they cover the prompt TEXT and
    the response PARSING, and the break was in the hand-off between them.
    """

    def test_the_topic_message_survives_to_contents(self):
        from app.web.services import gemini

        contents = gemini.to_contents(
            [{"role": "user", "content": mcq_gen.build_topic_prompt("SRE")}]
        )
        assert contents, "the conversation was empty — the prompt never reaches Gemini"
        assert contents[0]["role"] == "user"
        assert "SRE" in contents[0]["parts"][0]["text"]

    def test_the_paper_message_survives_to_contents(self):
        from app.web.services import gemini

        prompt = mcq_gen.build_paper_prompt(
            role="Backend Engineer", topics=["Caching"], split={"technical": 5},
            difficulty="mixed", allow_multi=False,
        )
        contents = gemini.to_contents([{"role": "user", "content": prompt}])
        assert contents
        assert "Backend Engineer" in contents[0]["parts"][0]["text"]

    def test_the_wrong_key_produces_nothing_which_is_how_this_broke(self):
        """Kept as the counter-example, so the failure mode stays legible."""
        from app.web.services import gemini

        assert gemini.to_contents([{"role": "user", "text": "hello"}]) == []


class TestADeniedProjectIsNotABadKey:
    """Both are 403, and the advice for each is the opposite of the other's.

    A key that worked a minute earlier can start answering
    "your project has been denied access" after a quota or billing action. Telling
    that person their key is malformed sends them to check the one thing that is
    fine.
    """

    def test_a_denied_project_says_so(self):
        from app.web.services import gemini, question_gen

        exc = gemini.GeminiAuthError(
            'Gemini rejected the credential (403). {"error": {"code": 403, '
            '"message": "Your project has been denied access. Please contact support.", '
            '"status": "PERMISSION_DENIED"}}'
        )
        message = question_gen.friendly_error(exc)
        assert "denied this project access" in message
        assert "AIza" not in message, "a denied project is not a malformed key"

    def test_a_genuinely_bad_key_still_says_so(self):
        from app.web.services import gemini, question_gen

        exc = gemini.GeminiAuthError(
            'Gemini rejected the credential (400). {"error": {"message": "API key not valid"}}'
        )
        assert "AIza" in question_gen.friendly_error(exc)


class TestTheMistakeHasNowhereToLive:
    """`gemini.user_turn` is the reason the `text`/`content` bug cannot recur.

    Building the message inline was the whole failure: a misspelled key produced an
    empty conversation, and the request failed before it was made. A caller with one
    prompt now has a single correct way to express it.
    """

    def test_user_turn_produces_a_real_conversation(self):
        from app.web.services import gemini

        contents = gemini.user_turn("Hello")
        assert len(contents) == 1
        assert contents[0]["role"] == "user"
        assert contents[0]["parts"][0]["text"] == "Hello"

    def test_both_generators_go_through_it(self):
        """Asserted on the source, because the point is that no caller hand-rolls
        the dict any more — a future one that did would reintroduce the bug."""
        from pathlib import Path

        source = Path("app/web/services/mcq_gen.py").read_text(encoding="utf-8")
        assert source.count("gemini.user_turn(") == 2
        assert "to_contents(" not in source


class TestSectionsDivideThePaper:
    """The paper is divided into named parts with their own counts.

    A recruiter who splits ten questions into six technical and four
    judgement-based did it to see those two results separately. Every step below
    is one place that intent could quietly evaporate between the modal and the
    report.
    """

    def test_a_mix_keeps_both_sections_and_their_counts(self):
        assert mcq_gen.normalise_split("mix", 6, 4) == {"technical": 6, "non_technical": 4}

    def test_a_single_style_ignores_the_other_count(self):
        assert mcq_gen.normalise_split("technical", 10, 7) == {"technical": 10}
        assert mcq_gen.normalise_split("non_technical", 10, 7) == {"non_technical": 7}

    def test_a_section_asked_for_nothing_is_dropped_not_kept_empty(self):
        """Otherwise the model is told to write a section of zero questions."""
        assert mcq_gen.normalise_split("mix", 6, 0) == {"technical": 6}

    def test_the_paper_is_bounded_as_a_whole_not_per_section(self):
        """Two sections of the maximum is not twice the maximum."""
        split = mcq_gen.normalise_split("mix", mcq_gen.MAX_QUESTIONS, mcq_gen.MAX_QUESTIONS)
        assert sum(split.values()) == mcq_gen.MAX_QUESTIONS
        assert all(n > 0 for n in split.values())

    def test_an_unknown_style_does_not_produce_an_empty_paper(self):
        assert sum(mcq_gen.normalise_split("nonsense", 0, 0).values()) >= 1

    def test_the_prompt_states_the_split_and_asks_for_the_tag(self):
        prompt = mcq_gen.build_paper_prompt(
            role="Backend Engineer",
            topics=["Caching"],
            split={"technical": 6, "non_technical": 4},
            difficulty="mixed",
            allow_multi=False,
        )
        assert "Technical: 6 questions" in prompt
        assert "Non-technical: 4 questions" in prompt
        # Without the tag instruction nothing that comes back can be attributed to
        # a section, and the whole division is decorative.
        assert "non_technical" in prompt
        assert "Write 10 multiple-choice questions" in prompt

    def test_the_non_technical_brief_appears_only_when_that_section_is_asked_for(self):
        """A model with no brief writes personality quizzes or trivia."""
        technical_only = mcq_gen.build_paper_prompt(
            role="X", topics=["Y"], split={"technical": 5}, difficulty="easy", allow_multi=False
        )
        assert "NON-TECHNICAL" not in technical_only

        mixed = mcq_gen.build_paper_prompt(
            role="X", topics=["Y"], split={"technical": 3, "non_technical": 2},
            difficulty="easy", allow_multi=False,
        )
        assert "NON-TECHNICAL" in mixed
        assert "judgement on the job" in mixed

    def test_a_single_section_paper_labels_by_construction(self):
        """The recruiter asked for a technical paper, so every question in it is
        technical whatever the model chose to call it."""
        payload = {"questions": [_question(section="non_technical")]}
        questions = mcq_gen.normalise_generated(payload, sections=("technical",))
        assert [q["section"] for q in questions] == ["technical"]

    def test_a_mixed_paper_trusts_the_models_label(self):
        payload = {"questions": [_question(section="non_technical"), _question(section="technical")]}
        questions = mcq_gen.normalise_generated(payload, sections=("technical", "non_technical"))
        assert [q["section"] for q in questions] == ["non_technical", "technical"]

    def test_an_unrecognised_label_is_left_blank_rather_than_guessed(self):
        """An invented section would make the delivered split report a balance the
        model never actually struck - which is the one thing that report is for."""
        payload = {"questions": [_question(section="vibes"), _question()]}
        questions = mcq_gen.normalise_generated(payload, sections=("technical", "non_technical"))
        assert all("section" not in q for q in questions)

    def test_labels_survive_normalisation_in_a_tolerant_form(self):
        """Models return "Non-Technical" and "non technical" as readily as the
        exact string they were given."""
        payload = {"questions": [_question(section="Non-Technical"), _question(section="non technical")]}
        questions = mcq_gen.normalise_generated(payload, sections=("technical", "non_technical"))
        assert [q["section"] for q in questions] == ["non_technical", "non_technical"]

    def test_the_delivered_split_counts_what_actually_arrived(self):
        questions = [{"section": "technical"}, {"section": "technical"}, {"section": "non_technical"}, {}]
        assert mcq_gen.section_counts(questions) == {"technical": 2, "non_technical": 1}

    def test_nothing_is_labelled_when_no_sections_were_requested(self):
        """Papers generated before sections existed stay exactly as they were."""
        questions = mcq_gen.normalise_generated({"questions": [_question()]}, sections=())
        assert "section" not in questions[0]

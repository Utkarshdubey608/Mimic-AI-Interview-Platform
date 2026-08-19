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


class TestSectionBreakdown:
    """How the candidate did on each half of the paper.

    This is the point of dividing a paper at all. A recruiter who split ten
    questions into six technical and four judgement-based did it to see those two
    numbers apart; one overall percentage discards exactly the distinction they
    set up.
    """

    def _paper(self):
        questions = [
            {"id": "t1", "sectionId": "technical"},
            {"id": "t2", "sectionId": "technical"},
            {"id": "n1", "sectionId": "non_technical"},
        ]
        scored = [
            {"questionId": "t1", "correct": True, "points": 1.0, "pointsAvailable": 1.0},
            {"questionId": "t2", "correct": False, "points": 0.0, "pointsAvailable": 1.0},
            {"questionId": "n1", "correct": True, "points": 1.0, "pointsAvailable": 1.0},
        ]
        return questions, scored

    def test_each_section_is_totalled_separately(self):
        questions, scored = self._paper()
        rows = {r["sectionId"]: r for r in m.section_breakdown(questions, scored)}
        assert rows["technical"]["correct"] == 1
        assert rows["technical"]["count"] == 2
        assert rows["non_technical"]["correct"] == 1
        assert rows["non_technical"]["count"] == 1

    def test_an_unsectioned_paper_gets_nothing_rather_than_one_meaningless_row(self):
        """Papers written before sections existed must not sprout an
        "unsectioned" heading covering every question in them."""
        questions = [{"id": "q1"}, {"id": "q2"}]
        scored = [{"questionId": "q1", "correct": True, "points": 1.0, "pointsAvailable": 1.0}]
        assert m.section_breakdown(questions, scored) == []

    def test_a_section_nobody_scored_still_appears(self):
        """The part everyone fails is the interesting part; omitting it misleads."""
        questions = [{"id": "t1", "sectionId": "technical"}, {"id": "n1", "sectionId": "non_technical"}]
        scored = [
            {"questionId": "t1", "correct": False, "points": 0.0, "pointsAvailable": 1.0},
            {"questionId": "n1", "correct": False, "points": 0.0, "pointsAvailable": 1.0},
        ]
        rows = m.section_breakdown(questions, scored)
        assert len(rows) == 2
        assert all(r["correct"] == 0 for r in rows)

    def test_rows_follow_the_papers_own_order_not_the_alphabet(self):
        """A report listing section three before section one is harder to read
        against the assessment the recruiter actually built."""
        sections = [
            {"id": "s1", "name": "Zebra aptitude"},
            {"id": "s2", "name": "Alpha reasoning"},
        ]
        questions = [{"id": "q1", "sectionId": "s2"}, {"id": "q2", "sectionId": "s1"}]
        scored = [
            {"questionId": "q1", "correct": True, "points": 1.0, "pointsAvailable": 1.0},
            {"questionId": "q2", "correct": True, "points": 1.0, "pointsAvailable": 1.0},
        ]
        rows = m.section_breakdown(questions, scored, sections=sections)
        assert [r["name"] for r in rows] == ["Zebra aptitude", "Alpha reasoning"]

    def test_a_section_deleted_after_the_paper_was_sat_still_appears(self):
        """Otherwise a candidate's answers vanish from their own report."""
        sections = [{"id": "s1", "name": "Aptitude"}]
        questions = [{"id": "q1", "sectionId": "s1"}, {"id": "q2", "sectionId": "gone"}]
        scored = [
            {"questionId": "q1", "correct": True, "points": 1.0, "pointsAvailable": 1.0},
            {"questionId": "q2", "correct": False, "points": 0.0, "pointsAvailable": 1.0},
        ]
        rows = m.section_breakdown(questions, scored, sections=sections)
        assert len(rows) == 2
        assert rows[0]["name"] == "Aptitude"

    def test_the_legacy_tag_is_read_as_a_section_id(self):
        """`section: "technical"` predates first-class sections. It needs no special
        case, because "technical" is an id in the prebuilt library."""
        questions = [{"id": "q1", "section": "non_technical"}]
        scored = [{"questionId": "q1", "correct": True, "points": 1.0, "pointsAvailable": 1.0}]
        rows = m.section_breakdown(questions, scored)
        assert rows[0]["sectionId"] == "non_technical"
        # And it is labelled readably rather than shown raw.
        assert rows[0]["name"] == "Non Technical"

    def test_topics_and_sections_agree_on_the_arithmetic(self):
        """Both breakdowns share one implementation, so a paper whose topic and
        section happen to partition it identically must total identically. If these
        ever diverge, the two grouping paths have drifted apart."""
        questions = [
            {"id": "a", "topic": "Alpha", "sectionId": "technical"},
            {"id": "b", "topic": "Alpha", "sectionId": "technical"},
        ]
        scored = [
            {"questionId": "a", "correct": True, "points": 1.0, "pointsAvailable": 1.0},
            {"questionId": "b", "correct": False, "points": 0.0, "pointsAvailable": 2.0},
        ]
        by_topic = m.topic_breakdown(questions, scored)[0]
        by_section = m.section_breakdown(questions, scored)[0]
        for field in ("correct", "count", "points", "pointsAvailable"):
            assert by_topic[field] == by_section[field]


def _match_question(**over) -> dict:
    q = {
        "id": "mq1",
        "type": "match",
        "text": "Match the algorithm to its complexity.",
        "prompts": [
            {"id": "p1", "text": "Binary search"},
            {"id": "p2", "text": "Bubble sort"},
            {"id": "p3", "text": "Hash lookup"},
        ],
        "matches": [
            {"id": "m9", "text": "O(log n)"},
            {"id": "m4", "text": "O(n^2)"},
            {"id": "m7", "text": "O(1)"},
        ],
        "correctPairs": {"p1": "m9", "p2": "m4", "p3": "m7"},
    }
    q.update(over)
    return q


class TestMatchTheFollowingScoring:
    """Pairing questions, scored without a model like everything else here."""

    def test_a_full_pairing_earns_full_marks(self):
        r = m.score_question(_match_question(), {"p1": "m9", "p2": "m4", "p3": "m7"})
        assert r["correct"] is True
        assert r["points"] == 1.0

    def test_partial_credit_is_the_default_and_the_asymmetry_is_deliberate(self):
        """All-or-nothing is right for multi-select because a candidate can tick
        every box. That attack does not exist here — each prompt takes exactly one
        match — so partial credit needs no penalty to be defensible."""
        r = m.score_question(_match_question(), {"p1": "m9", "p2": "m7", "p3": "m4"})
        assert r["correct"] is False
        assert r["matchedCount"] == 1
        assert r["points"] == round(1 / 3, 4)

    def test_all_or_nothing_is_available_when_asked_for(self):
        r = m.score_question(
            _match_question(), {"p1": "m9", "p2": "m4"}, match_rule=m.ALL_OR_NOTHING
        )
        assert r["points"] == 0.0

    def test_a_pairing_naming_a_prompt_not_in_the_paper_is_ignored(self):
        """Not credited, and not a crash: a stale client could send anything."""
        r = m.score_question(_match_question(), {"p1": "m9", "ghost": "m4"})
        assert r["matchedCount"] == 1
        assert r["correct"] is False

    def test_no_answer_scores_zero_rather_than_being_skipped(self):
        r = m.score_question(_match_question(), None)
        assert r["points"] == 0.0
        assert r.get("unscored") is not True

    def test_a_question_with_no_key_is_unscored_not_wrong(self):
        """One malformed question must not skew a whole paper."""
        r = m.score_question(_match_question(correctPairs={}), {"p1": "m9"})
        assert r["unscored"] is True
        assert r["pointsAvailable"] == 0.0

    def test_a_mixed_paper_scores_every_type_in_one_pass(self):
        single = {
            "id": "s1", "type": "single",
            "options": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}],
            "correctOptionIds": ["a"],
        }
        result = m.score_submission(
            [single, _match_question()],
            {"s1": ["a"], "mq1": {"p1": "m9", "p2": "m4", "p3": "m7"}},
        )
        assert result["correctCount"] == 2
        assert result["percent"] == 100.0


class TestAMatchQuestionCannotLeakItsPairing:
    """Two distinct leaks, and the second is the one that is easy to miss."""

    def test_the_pairing_is_not_in_the_candidates_copy(self):
        public = m.mcq_public_question(_match_question())
        assert "correctPairs" not in public
        assert "correctOptionIds" not in public
        assert json.dumps(public).count("m9") == 1  # present as an option, not as a key

    def test_column_B_never_arrives_in_the_answers_own_order(self):
        """THE SUBTLE ONE, and it caught a real leak.

        A match question is authored a row at a time, so the stored order of
        column B IS the pairing. If it is published as authored, the candidate
        pairs row one with row one and scores full marks — with no key ever
        leaving the server.

        Asserted with NO seed as well as with one, because the first version of
        this test passed a seed and therefore could not see the bug: with option
        shuffling switched off, both columns came back exactly as authored."""
        for seed in (None, "sess-1", "sess-2", "sess-3"):
            question = _match_question()
            public = m.mcq_public_question(question, shuffle_seed=seed)
            prompt_order = [p["id"] for p in public["prompts"]]
            match_order = [x["id"] for x in public["matches"]]
            paired_row_for_row = [question["correctPairs"][p] for p in prompt_order]
            assert match_order != paired_row_for_row, f"row-for-row leak at seed={seed!r}"

    def test_the_guarantee_holds_even_when_the_shuffle_lands_on_the_pairing(self):
        """A hash order coincides with the paired arrangement one time in six for
        three pairs. "Usually shuffled" is not a security property, so the
        alignment is checked and broken rather than hoped about."""
        question = _match_question()
        pairs = question["correctPairs"]
        for seed in [f"s{n}" for n in range(60)]:
            public = m.mcq_public_question(question, shuffle_seed=seed)
            prompt_order = [p["id"] for p in public["prompts"]]
            assert [x["id"] for x in public["matches"]] != [pairs[p] for p in prompt_order]

    def test_a_match_id_says_nothing_about_the_prompt_it_belongs_to(self):
        """Ids are opaque. If they were "p1"/"m1" the pairing would be guessable
        from the naming alone, whatever the order."""
        question = _match_question()
        for prompt_id, match_id in question["correctPairs"].items():
            assert prompt_id.lstrip("p") != match_id.lstrip("m")

    def test_the_order_is_stable_across_reloads_for_one_candidate(self):
        """A paper that reshuffles under somebody mid-decision is its own bug."""
        first = m.mcq_public_question(_match_question(), shuffle_seed="sess-1")
        again = m.mcq_public_question(_match_question(), shuffle_seed="sess-1")
        assert first == again

    def test_a_code_snippet_is_published_because_the_question_needs_it(self):
        """Code-reading questions are how coding and debugging are assessed here,
        so the snippet is visible by necessity. It carries no key."""
        public = m.mcq_public_question(
            {"id": "q", "type": "single", "text": "What does this print?",
             "code": "print(1 // 2)",
             "options": [{"id": "a", "text": "0"}], "correctOptionIds": ["a"]}
        )
        assert public["code"] == "print(1 // 2)"
        assert "correctOptionIds" not in public

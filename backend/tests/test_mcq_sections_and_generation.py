"""The MCQ Assessment Template Builder's new pure logic: typed sections with a
target count, question provenance, the remaining-count/exclusion generation
math, and the spreadsheet import classifier.

WHY THIS FILE EXISTS. `mcq_authoring.clean_section`/`with_question_extras`
gained `sectionType`/`targetQuestionCount`/`source` — additive fields that
must survive a save/load round trip AND must backfill sensibly for a
document saved before they existed, or every MCQ set predating this feature
breaks the moment it's next opened. `mcq_gen.remaining_count` and
`drop_duplicate_questions` are the two guarantees the whole "generate only
what's missing, never duplicate what's there" feature depends on — if either
is wrong, a recruiter either burns API cost regenerating a full batch or
ends up with two copies of the same question. None of this touches
Firestore or Gemini, so it is tested here directly, the same way
`mcq_authoring`'s existing validation is.
"""

from __future__ import annotations

from app import mcq_authoring, mcq_gen
from app.web.services import mcq_import


# ── section schema additions ──────────────────────────────────────────────────


class TestSectionType:
    def test_a_recognised_type_is_kept(self) -> None:
        section = mcq_authoring.clean_section({"name": "Aptitude", "sectionType": "aptitude"}, 0)
        assert section["sectionType"] == "aptitude"

    def test_an_unrecognised_type_becomes_custom(self) -> None:
        section = mcq_authoring.clean_section({"name": "Bespoke", "sectionType": "not-a-real-type"}, 0)
        assert section["sectionType"] == "custom"

    def test_a_section_saved_before_this_field_existed_backfills_to_custom(self) -> None:
        """No `sectionType` key at all in the input — the exact shape of every
        section saved before this round of work."""
        section = mcq_authoring.clean_section({"name": "Diagram", "id": "diagram-questions"}, 0)
        assert section["sectionType"] == "custom"

    def test_every_predefined_type_round_trips(self) -> None:
        for type_id in mcq_authoring.SECTION_TYPES:
            section = mcq_authoring.clean_section({"name": "x", "sectionType": type_id}, 0)
            assert section["sectionType"] == type_id


class TestTargetQuestionCount:
    def test_a_target_is_kept(self) -> None:
        assert mcq_authoring.clean_section({"name": "x", "targetQuestionCount": 10}, 0)["targetQuestionCount"] == 10

    def test_missing_target_defaults_to_zero_meaning_no_target_set(self) -> None:
        assert mcq_authoring.clean_section({"name": "x"}, 0)["targetQuestionCount"] == 0

    def test_a_negative_target_is_clamped_to_zero(self) -> None:
        assert mcq_authoring.clean_section({"name": "x", "targetQuestionCount": -5}, 0)["targetQuestionCount"] == 0

    def test_a_target_above_the_max_is_clamped(self) -> None:
        section = mcq_authoring.clean_section({"name": "x", "targetQuestionCount": 99999}, 0)
        assert section["targetQuestionCount"] == mcq_authoring.MAX_QUESTIONS


class TestQuestionSource:
    def test_a_recognised_source_is_kept(self) -> None:
        question = mcq_authoring.clean_question(
            {"text": "q", "options": [{"text": "a"}, {"text": "b"}], "correctOptionIds": [], "source": "ai_generated"},
            0,
        )
        assert question["source"] == "ai_generated"

    def test_a_question_with_no_source_backfills_to_manual(self) -> None:
        """Every question saved before this field existed — the one source
        that was always true of every question until now."""
        question = mcq_authoring.clean_question(
            {"text": "q", "options": [{"text": "a"}, {"text": "b"}], "correctOptionIds": []}, 0
        )
        assert question["source"] == "manual"

    def test_an_unrecognised_source_backfills_to_manual(self) -> None:
        question = mcq_authoring.clean_question(
            {"text": "q", "options": [{"text": "a"}, {"text": "b"}], "correctOptionIds": [], "source": "made-up"},
            0,
        )
        assert question["source"] == "manual"

    def test_a_match_type_question_also_carries_a_source(self) -> None:
        """`with_question_extras` is shared by both the option-based and
        match-the-following branches of `clean_question` — this pins that
        the match branch didn't lose the new field."""
        question = mcq_authoring.clean_question(
            {"text": "q", "type": "match", "pairs": [
                {"left": "a", "right": "1"}, {"left": "b", "right": "2"},
            ], "source": "imported"},
            0,
        )
        assert question["source"] == "imported"


class TestNewFieldsNeverReachTheCandidate:
    def test_the_public_projection_carries_none_of_the_new_fields(self) -> None:
        from app import mcq_scoring

        question = mcq_authoring.clean_question(
            {
                "text": "q",
                "options": [{"text": "a"}, {"text": "b"}],
                "correctOptionIds": [],
                "source": "ai_generated",
            },
            0,
        )
        question["correctOptionIds"] = [question["options"][0]["id"]]
        public = mcq_scoring.mcq_public_question(question)
        assert "source" not in public
        assert "sectionId" not in public

    def test_the_section_manifest_carries_neither_new_field(self) -> None:
        from app import mcq

        paper = {
            "sections": [
                {"id": "s1", "name": "Aptitude", "sectionType": "aptitude", "targetQuestionCount": 10}
            ],
            "questions": [],
        }
        manifest = mcq.public_sections(paper)
        assert manifest == [{"id": "s1", "name": "Aptitude", "questionIds": []}]


# ── remaining-count generation math ───────────────────────────────────────────


class TestRemainingCount:
    def test_the_exact_case_from_the_spec(self) -> None:
        """Target 10, existing 4 -> exactly 6. Never 10."""
        assert mcq_gen.remaining_count(10, 4) == 6

    def test_a_section_already_at_target_needs_none(self) -> None:
        assert mcq_gen.remaining_count(10, 10) == 0

    def test_a_section_over_target_needs_none_not_a_negative_count(self) -> None:
        assert mcq_gen.remaining_count(10, 15) == 0

    def test_no_target_set_means_nothing_is_owed(self) -> None:
        assert mcq_gen.remaining_count(0, 0) == 0


class TestDuplicateExclusion:
    def test_an_exact_duplicate_of_an_existing_question_is_dropped(self) -> None:
        kept, dropped = mcq_gen.drop_duplicate_questions(
            [{"text": "What is the capital of France?"}], ["What is the capital of France?"]
        )
        assert kept == []
        assert dropped == 1

    def test_a_whitespace_and_case_variant_is_still_caught(self) -> None:
        kept, dropped = mcq_gen.drop_duplicate_questions(
            [{"text": "  WHAT is the   capital of France?  "}], ["What is the capital of france?"]
        )
        assert kept == []
        assert dropped == 1

    def test_a_genuinely_different_question_is_kept(self) -> None:
        kept, dropped = mcq_gen.drop_duplicate_questions(
            [{"text": "What is the capital of Germany?"}], ["What is the capital of France?"]
        )
        assert len(kept) == 1
        assert dropped == 0

    def test_a_duplicate_WITHIN_the_new_batch_is_also_caught(self) -> None:
        """Not just against the existing set — two generated questions that
        duplicate EACH OTHER must not both survive."""
        kept, dropped = mcq_gen.drop_duplicate_questions(
            [{"text": "What is 2+2?"}, {"text": "what is 2+2?"}, {"text": "What is 3+3?"}], []
        )
        assert [q["text"] for q in kept] == ["What is 2+2?", "What is 3+3?"]
        assert dropped == 1


class TestSectionPromptBraiding:
    def test_each_predefined_type_gets_its_own_brief(self) -> None:
        """Not the same generic text relabelled — genuinely different
        instructions per type, or every section reads identically."""
        prompts = {
            t: mcq_gen.build_section_prompt(
                section_type=t, section_name="x", role="Engineer", count=3,
                difficulty="mixed", exclude_texts=[], existing_passage=None,
            )
            for t in ("aptitude", "quantitative", "reading_comprehension", "verbal_reasoning")
        }
        assert len({p for p in prompts.values()}) == 4

    def test_reading_comprehension_with_no_passage_asks_for_one(self) -> None:
        prompt = mcq_gen.build_section_prompt(
            section_type="reading_comprehension", section_name="RC", role="x", count=3,
            difficulty="medium", exclude_texts=[], existing_passage=None,
        )
        assert '"passage"' in prompt

    def test_reading_comprehension_with_an_existing_passage_reuses_it_not_a_new_one(self) -> None:
        prompt = mcq_gen.build_section_prompt(
            section_type="reading_comprehension", section_name="RC", role="x", count=3,
            difficulty="medium", exclude_texts=[], existing_passage="Once upon a time...",
        )
        assert "Once upon a time..." in prompt
        assert "do not invent a new one" in prompt

    def test_existing_questions_are_listed_as_do_not_repeat_context(self) -> None:
        prompt = mcq_gen.build_section_prompt(
            section_type="aptitude", section_name="Apt", role="x", count=2,
            difficulty="medium", exclude_texts=["What is 2+2?"], existing_passage=None,
        )
        assert "What is 2+2?" in prompt
        assert "already has these questions" in prompt.lower()


# ── the CSV/XLSX import classifier ────────────────────────────────────────────


class TestSpreadsheetImport:
    def _csv(self, text: str) -> bytes:
        return text.encode()

    def test_a_well_formed_row_is_valid(self) -> None:
        result = mcq_import.import_from_spreadsheet(
            self._csv(
                "question,option_a,option_b,option_c,option_d,correct_answer\n"
                "What is 2+2?,3,4,5,6,B\n"
            ),
            filename="q.csv",
            existing_texts=[],
        )
        assert len(result["valid"]) == 1
        question = result["valid"][0]["question"]
        assert question["text"] == "What is 2+2?"
        assert question["source"] == "imported"
        correct_text = next(o["text"] for o in question["options"] if o["id"] in question["correctOptionIds"])
        assert correct_text == "4"

    def test_a_row_missing_a_correct_answer_needs_review_not_a_guess(self) -> None:
        result = mcq_import.import_from_spreadsheet(
            self._csv("question,option_a,option_b\nWhat is 2+2?,3,4\n"),
            filename="q.csv",
            existing_texts=[],
        )
        assert result["valid"] == []
        assert len(result["needsReview"]) == 1
        assert result["needsReview"][0]["question"]["correctOptionIds"] == []
        assert "not confidently detected" in result["needsReview"][0]["reason"]

    def test_a_row_with_no_question_text_is_rejected(self) -> None:
        result = mcq_import.import_from_spreadsheet(
            self._csv("question,option_a,option_b,correct_answer\n,3,4,A\n"),
            filename="q.csv",
            existing_texts=[],
        )
        assert result["rejected"] and result["rejected"][0]["reason"] == "No question text found."

    def test_a_row_with_one_option_is_rejected(self) -> None:
        result = mcq_import.import_from_spreadsheet(
            self._csv("question,option_a,correct_answer\nOnly one option?,solo,A\n"),
            filename="q.csv",
            existing_texts=[],
        )
        assert result["rejected"] and "two answer options" in result["rejected"][0]["reason"]

    def test_a_row_duplicating_an_existing_section_question_is_flagged_not_silently_imported(self) -> None:
        result = mcq_import.import_from_spreadsheet(
            self._csv("question,option_a,option_b,correct_answer\nWhat is 2+2?,3,4,B\n"),
            filename="q.csv",
            existing_texts=["What is 2+2?"],
        )
        assert result["valid"] == []
        assert "duplicate" in result["needsReview"][0]["reason"].lower()

    def test_a_row_duplicating_another_row_in_the_SAME_import_is_flagged(self) -> None:
        result = mcq_import.import_from_spreadsheet(
            self._csv(
                "question,option_a,option_b,correct_answer\n"
                "What is 2+2?,3,4,B\n"
                "what is 2+2?,3,4,B\n"
            ),
            filename="q.csv",
            existing_texts=[],
        )
        assert len(result["valid"]) == 1
        assert len(result["needsReview"]) == 1

    def test_a_missing_question_column_is_reported_clearly(self) -> None:
        result = mcq_import.import_from_spreadsheet(
            self._csv("foo,bar\n1,2\n"), filename="q.csv", existing_texts=[]
        )
        assert result["valid"] == result["needsReview"] == result["rejected"] == []
        assert "question" in result["error"].lower()

    def test_the_legacy_xls_format_is_refused_with_guidance_not_a_crash(self) -> None:
        result = mcq_import.import_from_spreadsheet(b"not really xls", filename="q.xls", existing_texts=[])
        assert ".xlsx or .csv" in result["error"]

    def test_letter_number_and_text_answer_formats_all_resolve(self) -> None:
        for answer_cell in ("B", "b", "2", "1", "4"):
            result = mcq_import.import_from_spreadsheet(
                self._csv(f"question,option_a,option_b,correct_answer\nQ?,3,4,{answer_cell}\n"),
                filename="q.csv",
                existing_texts=[],
            )
            assert result["valid"], f"answer cell {answer_cell!r} did not resolve"

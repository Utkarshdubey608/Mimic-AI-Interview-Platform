"""The web voice track's Gemini Live setup.

These cover the transcription constraints the FastAPI port dropped when it replaced the
Express relay: without them the recogniser chose its own language (returning Devanagari
for English-only interviews) and had no reason to prefer a technical term over a common
word that sounds like it ("Redis" -> "reduce").
"""

from __future__ import annotations

from app.web.services import voice_setup
from app.web.shared import speech


def _session(questions: list[str]) -> dict:
    return {"questions": [{"text": q} for q in questions]}


class TestTranscriptionLanguages:
    def test_english_expands_to_every_variant(self):
        # An accent is not a different language: en-IN must be offered, or an
        # Indian-accented answer can be recognised as Hindi.
        assert speech.transcription_languages("en-US") == [
            "en-IN",
            "en-US",
            "en-GB",
            "en-AU",
        ]

    def test_the_word_english_is_accepted_too(self):
        # store/defaults.py writes "English" in one place and "en-US" in another.
        assert speech.transcription_languages("English") == list(speech.ENGLISH_VARIANTS)

    def test_blank_defaults_to_english(self):
        assert speech.transcription_languages(None) == list(speech.ENGLISH_VARIANTS)
        assert speech.transcription_languages("  ") == list(speech.ENGLISH_VARIANTS)

    def test_other_languages_pass_through_untouched(self):
        assert speech.transcription_languages("fr-FR") == ["fr-FR"]


class TestAdaptationPhrases:
    def test_single_capitalised_product_names_are_captured(self):
        # The reported failures. Neither is an acronym or a multi-word phrase, so the
        # Express heuristic missed both.
        phrases = speech.adaptation_phrases(
            None, ["Have you used Redis or Grafana in production?"]
        )
        assert "Redis" in phrases
        assert "Grafana" in phrases

    def test_dotted_and_acronym_terms_are_captured(self):
        phrases = speech.adaptation_phrases(None, ["Describe an Express.js and CI/CD setup."])
        assert "Express.js" in phrases
        assert "CI" in phrases

    def test_camel_case_is_captured(self):
        assert "PostgreSQL" in speech.adaptation_phrases(None, ["Do you know PostgreSQL well?"])

    def test_sentence_openers_are_not_hints(self):
        # Capitalised by grammar, not because they name anything.
        phrases = speech.adaptation_phrases(None, ["How do you test? Describe your approach."])
        assert "How" not in phrases
        assert "Describe" not in phrases

    def test_role_is_included(self):
        assert "Senior Backend Engineer" in speech.adaptation_phrases(
            "Senior Backend Engineer", ["Tell me about yourself."]
        )

    def test_bounded(self):
        many = [f"Deploy ServiceAlpha{i} to production." for i in range(200)]
        assert len(speech.adaptation_phrases("Role", many)) <= speech.MAX_ADAPTATION_PHRASES

    def test_no_duplicates(self):
        phrases = speech.adaptation_phrases(None, ["Redis and Redis and more Redis."])
        assert phrases.count("Redis") == 1


class TestBuildLiveSetup:
    def test_input_transcription_pins_english(self):
        setup = voice_setup.build_live_setup(
            _session(["Tell me about caching."]), {"voice": {}}, model="models/x"
        )
        hints = setup["inputAudioTranscription"]["languageHints"]["languageCodes"]
        assert hints == list(speech.ENGLISH_VARIANTS)

    def test_recruiter_language_choice_is_honoured(self):
        # template.voice.language is written by the editor and, before this, read by nothing.
        setup = voice_setup.build_live_setup(
            _session(["Bonjour."]), {"voice": {"language": "fr-FR"}}, model="models/x"
        )
        assert setup["inputAudioTranscription"]["languageHints"]["languageCodes"] == ["fr-FR"]

    def test_question_vocabulary_becomes_adaptation_phrases(self):
        setup = voice_setup.build_live_setup(
            _session(["How have you used Redis?"]), {"voice": {}}, model="models/x"
        )
        assert "Redis" in setup["inputAudioTranscription"]["adaptationPhrases"]

    def test_output_transcription_stays_on(self):
        setup = voice_setup.build_live_setup(
            _session(["Anything."]), {"voice": {}}, model="models/x"
        )
        assert setup["outputAudioTranscription"] == {}

    def test_adaptation_phrases_omitted_when_there_is_no_vocabulary(self):
        # An empty list would be a meaningless field on the wire.
        setup = voice_setup.build_live_setup(
            _session(["tell me more"]), {"voice": {}}, model="models/x"
        )
        assert "adaptationPhrases" not in setup["inputAudioTranscription"]


class TestConfirmBeforeAdvancing:
    """A pause is not the end of an answer, and voice has nothing but silence to go on."""

    def _voice_instruction(self) -> str:
        setup = voice_setup.build_live_setup(
            _session(["Tell me about caching."]), {"voice": {}}, model="models/x"
        )
        return setup["systemInstruction"]["parts"][0]["text"]

    def test_the_voice_interviewer_checks_before_moving_on(self):
        assert speech.CONFIRM_BEFORE_ADVANCING_RULE in self._voice_instruction()

    def test_the_check_is_exempted_from_the_no_follow_ups_rule(self):
        # Without the carve-out the two instructions contradict each other and the model
        # is free to resolve it either way.
        assert "one exception" in self._voice_instruction()

    def test_it_applies_to_the_final_question_too(self):
        assert "including the last one" in self._voice_instruction()

    def test_the_avatar_track_is_unchanged(self):
        # Same builder, different track: the avatar was verified without this and opts out.
        instruction = speech.avatar_interview_context(questions=["Tell me about caching."])
        assert speech.CONFIRM_BEFORE_ADVANCING_RULE not in instruction
        assert "one exception" not in instruction

    def test_the_strict_script_survives_the_carve_out(self):
        # The carve-out must not weaken the rule it is carved out of.
        instruction = self._voice_instruction()
        assert "Do NOT invent, add, skip, reorder, or rephrase" in instruction
        assert "never add questions of your own" in instruction


class TestSessionMinutes:
    """The credential must outlast the interview, not the other way round."""

    TIMING = {"timing": {"numberOfQuestions": 5, "prepSeconds": 30, "answerSeconds": 120}}

    def test_the_actual_question_count_wins_over_the_template_intent(self):
        # 8 real questions against a template that still says 5: sizing from 5 expires the
        # token three questions early, and the browser's capTimer ends the interview there.
        five = voice_setup.session_minutes(self.TIMING, 0, question_count=5)
        eight = voice_setup.session_minutes(self.TIMING, 0, question_count=8)
        assert eight > five

    def test_it_falls_back_to_the_template_when_the_count_is_unknown(self):
        assert voice_setup.session_minutes(self.TIMING, 0, question_count=0) == (
            voice_setup.session_minutes(self.TIMING, 0, question_count=5)
        )

    def test_the_grace_period_is_added(self):
        base = voice_setup.session_minutes(self.TIMING, 0, question_count=5)
        assert voice_setup.session_minutes(self.TIMING, 10, question_count=5) == base + 10

    def test_a_template_with_no_per_question_timing_still_gets_a_workable_window(self):
        assert voice_setup.session_minutes({}, 0, question_count=5) >= 15

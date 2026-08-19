"""The voice interview's Gemini Live session, assembled server-side.

The web equivalent of `app.voice`, built from a SESSION and its template rather than an
interview document.

**Why a token rather than a relay.** The Express server stood between the candidate's
microphone and Google, forwarding audio in both directions. This does not: the setup is
minted into a short-lived token and the browser connects to Google directly, exactly as
the Flutter app does. One mechanism instead of two, no long-lived socket to keep alive,
and the audio never transits this service.

**The lock is what makes that safe.** The token carries the entire
`BidiGenerateContentSetup` with no `fieldMask`, so whatever setup a tampered client sends
on connect is ignored in favour of this one. The interviewer's instructions, the question
script, the voice and the model are all fixed here and cannot be rewritten from the
browser.

Anything omitted here is unrecoverable — the client has no way to supply it.

Pure functions: no HTTP, no storage.
"""

from __future__ import annotations

from app.web.shared import speech

DEFAULT_VOICE = "Aoede"

# How long a candidate may go quiet mid-answer before Google commits end-of-turn.
#
# Chosen against the two failures it sits between: at 500ms a normal thinking pause
# ended the answer; much beyond this and the gap before the next question starts to read
# as the system having missed the answer. 1.5s clears a breath and a "let me think"
# without being perceptible at the true end of a turn.
THINKING_PAUSE_MS = 1500

# Enough résumé for the interviewer to sound informed. It rides in every session's
# instruction, so it is bounded.
MAX_RESUME_CHARS = 6000


def resolve_voice(template: dict) -> str:
    """The configured voice, or the product default.

    Validated against nothing here on purpose: the catalog check belongs at the point a
    recruiter chooses one, and a stale id should fall back rather than fail a launch the
    candidate is waiting on.
    """
    voice = ((template.get("voice") or {}).get("voiceId") or "").strip()
    return voice or DEFAULT_VOICE


def build_system_instruction(session: dict, template: dict) -> str:
    """The interviewer's full instructions for one voice interview.

    The strict-script rules are the same as the avatar track's and for the same reason:
    an interviewer that improvises asks different questions of different candidates,
    which makes the scores incomparable.
    """
    questions = [
        question.get("text") or "" for question in session.get("questions") or []
    ]
    candidate = ((session.get("candidate") or {}).get("name") or "").strip()
    name = candidate if candidate and candidate != "Candidate" else None

    persona = (template.get("voice") or {}).get("stylePrompt") or None

    instruction = speech.avatar_interview_context(
        persona_text=persona,
        candidate_name=name,
        ai_name=None,
        questions=questions,
        time_of_day=session.get("greetingTimeOfDay"),
        resume_text=(session.get("resumeText") or "")[:MAX_RESUME_CHARS] or None,
        # Voice has nothing but silence to judge turn-taking by — no camera, no typing
        # indicator — so it must ask rather than assume. Opt-in so the avatar track,
        # which shares this builder, keeps the behaviour it was verified with.
        confirm_before_advancing=True,
        # The voice client auto-closes shortly after the goodbye finishes playing, so the
        # interviewer must SAY that — a session that vanishes unannounced reads as a
        # crash to the candidate. Also voice-only: the avatar track closes differently.
        closing_can_leave=True,
    )

    # A token minted for a session that is already under way is a RECONNECT: the previous
    # Live session is gone and the replacement has no memory of it. Detected from the
    # record rather than trusted from the client, which cannot be allowed to decide that
    # an interview has already covered its questions.
    already_asked = questions_already_asked(session)
    if already_asked:
        instruction = f"{instruction}\n\n{speech.resume_addendum(already_asked)}"
    return instruction


def questions_already_asked(session: dict) -> list[str]:
    """The planned questions this session has on record as asked, in plan order."""
    indices = {
        turn.get("questionIndex")
        for turn in session.get("transcript") or []
        if turn.get("turnType") == "question"
    }
    return [
        question.get("text") or ""
        for index, question in enumerate(session.get("questions") or [])
        if index in indices
    ]


def _input_transcription(session: dict, template: dict) -> dict:
    """Transcription config for the candidate's microphone.

    EMPTY, and deliberately so. This used to send `languageHints.languageCodes` and
    `adaptationPhrases`, and neither did anything: the Live API's
    `AudioTranscriptionConfig` is documented as "This type has no fields", so the socket
    accepted both and discarded them.

    That inert config is why the protections it claimed never materialised — Devanagari
    in an English interview, "Redis" heard as "reduce", "token reduction" as "token
    addiction", "EC2" as the Spanish "mierda". The language is now pinned where the API
    actually reads it: `generationConfig.speechConfig.languageCode`, in
    `build_live_setup` below.

    Vocabulary biasing has no equivalent — the Live API exposes no phrase-hint field at
    all — so `speech.adaptation_phrases` is not called from here. It is kept because it
    is correct and tested, and is what to wire up if Google adds the field. Sending it
    into a void was worse than not sending it, because in the code it read as a solved
    problem.
    """
    return {}


def build_live_setup(session: dict, template: dict, *, model: str) -> dict:
    """The full `BidiGenerateContentSetup` the token will carry.

    Mirrors `app.voice.build_live_setup` field for field — the two tracks are the same
    Google API and should not drift. Every value here is one the client cannot override.
    """
    return {
        "model": model,
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": resolve_voice(template)}
                },
                # THE field that pins the language, and the only one that does.
                # Without it Gemini picks the language from context, and an answer
                # dense with acronyms is enough context to send it elsewhere: a
                # candidate saying "EC2" was transcribed as the Spanish "mierda".
                # Supported on the non-native-audio Live models, which is what the web
                # track runs (`settings.web_live_model_name`). Native-audio models
                # choose their own language and ignore this.
                "languageCode": speech.speech_language_code(
                    (template.get("voice") or {}).get("language")
                ),
            },
            # No thinking budget. An interviewer reads the next scripted question and
            # gives a one-line acknowledgment — there is nothing here worth deliberating
            # over, and every millisecond spent doing so is silence the candidate hears
            # as the system having missed their answer. Measured against the real
            # interview setup: 2.56s to first audio with thinking on, 1.20s with it off.
            # The Express relay set the same budget (server/services/voice.ts:441).
            "thinkingConfig": {"thinkingBudget": 0},
        },
        "systemInstruction": {
            "parts": [{"text": build_system_instruction(session, template)}]
        },
        # Input is what becomes the transcript the interview is scored from, so without
        # it there is nothing to evaluate; output is the interviewer's own speech, for
        # the transcript panel.
        #
        # The hints are not optional decoration. Left bare (`{}`), the recogniser picks
        # the language itself and has been returning Devanagari for English interviews,
        # and hearing "Redis" as "reduce". Both protections existed in the Express relay
        # this was ported from (server/services/voice.ts:434-439) and were lost in the
        # port; this restores them.
        "inputAudioTranscription": _input_transcription(session, template),
        "outputAudioTranscription": {},
        # Server-side voice activity detection, so the candidate can interrupt naturally.
        # 20ms of padding was found to clip word onsets and cost recognition accuracy,
        # hence 150.
        #
        # The sensitivities are Gemini Live's own documented defaults (the SDK states
        # both in @google/genai StartSensitivity / EndSensitivity) and are spelled out
        # only so the intent is legible.
        #
        # silenceDurationMs is the one value that is a real choice, and it is the whole
        # of the "it skipped my question" complaint: it is how long the candidate may go
        # quiet before Google commits end-of-turn. At 500ms an ordinary mid-answer pause
        # — drawing breath, thinking of the next example — ended the answer and moved the
        # interview on. An interview is not a chat: candidates are recalling specifics
        # under pressure and pause far longer than a conversational user would.
        #
        # Google's own note on this field: "The larger this value, the longer speech gaps
        # can be without interrupting the user's activity but this will increase the
        # model's latency." That cost is bounded and one-sided — it delays the next
        # question by the extra silence, and only at the true end of an answer — whereas
        # cutting a candidate off loses the answer entirely.
        "realtimeInputConfig": {
            "automaticActivityDetection": {
                "startOfSpeechSensitivity": "START_SENSITIVITY_HIGH",
                "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH",
                "prefixPaddingMs": 150,
                "silenceDurationMs": THINKING_PAUSE_MS,
            }
        },
        # A dropped connection can resume without burning another `uses` — Google
        # documents resumption as not counting against the limit, which matters because
        # a candidate on a train will reconnect.
        "sessionResumption": {},
    }


def session_minutes(template: dict, buffer_minutes: int, question_count: int = 0) -> int:
    """How long the session may run: the interview's own length plus a grace period.

    The grace matters — a token that expired exactly at the interview's nominal duration
    would cut a candidate off mid-answer, and the interview's own cap is what should end
    it, not the credential.

    `question_count` is the session's ACTUAL number of questions and wins when given.
    `timing.numberOfQuestions` is only a template-level intent: the recruiter's editor
    exposes that field on one branch and not others, and generated or résumé-derived sets
    routinely differ from it. Sizing the credential from the smaller of the two is how a
    long interview gets cut off by its own token — the expiry arms `capTimer` in the
    browser, which ends the interview wherever the candidate happens to be.
    """
    timing = template.get("timing") or {}
    questions = question_count or timing.get("numberOfQuestions") or 5
    per_question = (timing.get("prepSeconds") or 0) + (timing.get("answerSeconds") or 0)

    # Ceiling-divide to whole minutes, with a floor so a short interview still gets a
    # workable window.
    estimated = max(1, -(-(questions * per_question) // 60)) if per_question else 15
    return estimated + max(0, buffer_minutes)

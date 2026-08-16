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

    return speech.avatar_interview_context(
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
    )


def _input_transcription(session: dict, template: dict) -> dict:
    """Transcription config for the candidate's microphone.

    `language` is already stored on the template by the recruiter's editor
    (`store/defaults.py:179`) and until now was read by nothing.
    """
    voice = template.get("voice") or {}
    config: dict = {
        "languageHints": {
            "languageCodes": speech.transcription_languages(voice.get("language"))
        }
    }

    phrases = speech.adaptation_phrases(
        template.get("role"),
        [question.get("text") or "" for question in session.get("questions") or []],
    )
    if phrases:
        config["adaptationPhrases"] = phrases
    return config


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
                }
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


def session_minutes(template: dict, buffer_minutes: int) -> int:
    """How long the session may run: the interview's own length plus a grace period.

    The grace matters — a token that expired exactly at the interview's nominal duration
    would cut a candidate off mid-answer, and the interview's own cap is what should end
    it, not the credential.
    """
    timing = template.get("timing") or {}
    questions = timing.get("numberOfQuestions") or 5
    per_question = (timing.get("prepSeconds") or 0) + (timing.get("answerSeconds") or 0)

    # Ceiling-divide to whole minutes, with a floor so a short interview still gets a
    # workable window.
    estimated = max(1, -(-(questions * per_question) // 60)) if per_question else 15
    return estimated + max(0, buffer_minutes)

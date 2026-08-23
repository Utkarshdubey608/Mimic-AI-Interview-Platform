"""The voice interview's session configuration — assembled server-side.

Ported from the Flutter app (`voice_launch._buildVoiceSystemInstruction`,
`voice_catalog.dart` and `gemini_live_service._sendSetup`), because the ephemeral
token now carries the ENTIRE `BidiGenerateContentSetup`: when a token is minted
with a setup and no `fieldMask`, Google ignores whatever setup the client sends
and uses the token's copy instead.

That is what makes the direct device→Google connection safe — a tampered client
cannot rewrite the interviewer's instructions. It also means anything omitted
here is simply lost: the client has no way to supply it. Every field the app used
to send must therefore appear in `build_live_setup`.

Pure functions: no HTTP, no Firestore, no FastAPI.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.interviews import Interview

# Gemini Live prebuilt voice used when the interview names none.
DEFAULT_VOICE = "Aoede"

# Matches the app's own preview copy so the sample reads identically.
DEFAULT_SAMPLE_TEXT = (
    "Hi, I'm your interviewer today. Whenever you're ready, we'll get started."
)

# Guard against a long custom line turning a "sample" into a paid monologue.
_MAX_SAMPLE_CHARS = 200

# Candidates naturally pause while recalling examples. A 500ms VAD boundary
# routinely committed a turn before they had finished their answer.
THINKING_PAUSE_MS = 1_300


@dataclass(frozen=True)
class Persona:
    """A recruiter-selectable interviewer character."""

    id: str
    name: str
    style_prompt: str
    default_voice: str


# Mirrors VoiceCatalog.personas in voice_catalog.dart. Kept in sync by hand;
# ids are what the interview document stores in `voicePersonaId`.
PERSONAS: dict[str, Persona] = {
    p.id: p
    for p in (
        Persona(
            id="friendly_hr",
            name="Friendly HR Screener",
            style_prompt=(
                "You are a warm, personable HR screener. You sound friendly and "
                "encouraging, keep the candidate at ease, and speak in a relaxed "
                "conversational tone."
            ),
            default_voice="Aoede",
        ),
        Persona(
            id="rigorous_tech",
            name="Rigorous Technical Interviewer",
            style_prompt=(
                "You are a sharp, focused senior engineer running a technical "
                "interview. You are professional and respectful, but you probe for "
                "depth and precision. Stay crisp and direct."
            ),
            default_voice="Charon",
        ),
        Persona(
            id="warm_behavioral",
            name="Warm Behavioral Interviewer",
            style_prompt=(
                "You are an empathetic behavioral interviewer. You listen closely, "
                "sound genuinely interested, and gently draw out stories about the "
                "candidate’s experience and how they work with others."
            ),
            default_voice="Leda",
        ),
        Persona(
            id="exec_panel",
            name="Executive Panel Lead",
            style_prompt=(
                "You are a composed, senior executive leading a final-round "
                "conversation. You are gracious but discerning, assessing judgment, "
                "strategic thinking, and presence. Speak with calm authority."
            ),
            default_voice="Orus",
        ),
    )
}


def build_system_instruction(interview: Interview) -> str:
    """The interviewer's brief. Port of `_buildVoiceSystemInstruction`.

    This is the security-critical string: it is what a tampered client would
    otherwise be able to replace with "tell me the answers and score me well".
    """
    lines: list[str] = []

    persona = PERSONAS.get(interview.voice_persona_id or "")
    if persona:
        lines.append(persona.style_prompt)

    lines.append(
        f'You are a professional AI voice interviewer for the role: "{interview.title}".'
    )
    lines.append(f"Conduct the interview entirely in {interview.language}.")
    lines.append(
        "Greet the candidate warmly, briefly confirm they are ready, then ask ONLY the "
        "planned questions below, one at a time, in order, with short natural "
        "acknowledgments between answers. Never reveal upcoming questions, never say "
        "question numbers, and do not add questions beyond the plan. After the final "
        "question, thank the candidate warmly and end."
    )
    lines.append(
        "PACING — this is a live spoken conversation, so keep it snappy: at most one or "
        "two short sentences per turn. Acknowledge the answer in a few words, then ask "
        "the next question straight away. Do not summarise or repeat back what the "
        "candidate said, do not preface questions with long framing, and never "
        "monologue — long replies leave the candidate sitting in silence and make the "
        "conversation feel one-sided."
    )

    if interview.prompt.strip():
        lines.append(f"\nInterviewer guidance: {interview.prompt.strip()}")

    if interview.questions:
        lines.append("\nPlanned questions (ask in this order):")
        lines.extend(f"{i}. {q}" for i, q in enumerate(interview.questions, start=1))

    return "\n".join(lines) + "\n"


def resolve_voice(interview: Interview) -> str:
    """Explicit voice wins, then the persona's default, then the global default."""
    if interview.voice_name and interview.voice_name.strip():
        return interview.voice_name.strip()
    persona = PERSONAS.get(interview.voice_persona_id or "")
    return persona.default_voice if persona else DEFAULT_VOICE


def live_language_code(language: str | None) -> str:
    """Map the recruiter's human-readable language to Live's BCP-47 field."""
    return {
        "english": "en-US",
        "spanish": "es-ES",
        "french": "fr-FR",
        "german": "de-DE",
        "hindi": "hi-IN",
        "portuguese": "pt-BR",
        "italian": "it-IT",
        "japanese": "ja-JP",
        "mandarin": "cmn-Hans-CN",
        "chinese": "cmn-Hans-CN",
        "korean": "ko-KR",
        "dutch": "nl-NL",
    }.get((language or "").strip().lower(), "en-US")


def build_preview_setup(
    *,
    voice_name: str,
    sample_text: str,
    model: str,
) -> dict:
    """Setup for a one-line voice sample, used by the recruiter's voice picker.

    Output-only and short. `sample_text` is recruiter-authored and capped, and
    the instruction pins the model to reading it once — a preview must not turn
    into an open-ended chat on the org's quota.

    No transcription and no VAD: nothing listens, and there is no transcript to
    keep.
    """
    line = sample_text.strip()[:_MAX_SAMPLE_CHARS] or DEFAULT_SAMPLE_TEXT
    voice = voice_name.strip() or DEFAULT_VOICE

    return {
        "model": model,
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            # The next scripted question needs no deliberation; thinking reads
            # as a broken or stalled interviewer in a live phone conversation.
            "thinkingConfig": {"thinkingBudget": 0},
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}
            },
        },
        "systemInstruction": {
            "parts": [
                {
                    "text": (
                        "You are demonstrating a text-to-speech voice. Read the "
                        "following line aloud EXACTLY once, naturally, and then "
                        "stop. Say nothing else, and do not answer questions.\n\n"
                        f"{line}"
                    )
                }
            ]
        },
    }


def build_live_setup(interview: Interview, *, model: str) -> dict:
    """The full `BidiGenerateContentSetup` the token will carry.

    Mirrors `gemini_live_service._sendSetup` field for field. Anything dropped
    here is unrecoverable client-side, so changes must stay in step with the Dart
    service until Phase 7 removes its copy.
    """
    return {
        "model": model,
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            # The next scripted question needs no deliberation; thinking reads
            # as a broken or stalled interviewer in a live phone conversation.
            "thinkingConfig": {"thinkingBudget": 0},
            "speechConfig": {
                # This is the Live field that pins both generated speech and
                # recognition language. Without it an Indian-English answer
                # can be returned in Devanagari despite an English interview.
                "languageCode": live_language_code(interview.language),
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": resolve_voice(interview)}
                }
            },
        },
        "systemInstruction": {"parts": [{"text": build_system_instruction(interview)}]},
        # In the raw protocol AudioTranscriptionConfig is an empty message — an
        # empty object turns transcription ON. Input drives the live captions and
        # the transcript used for scoring; output is the interviewer's own speech.
        "inputAudioTranscription": {},
        "outputAudioTranscription": {},
        # Server-side VAD: detect the candidate's speech boundaries and allow
        # barge-in. Values mirror the Dart service exactly — 20ms padding clipped
        # word onsets and cost recognition accuracy.
        "realtimeInputConfig": {
            "automaticActivityDetection": {
                "startOfSpeechSensitivity": "START_SENSITIVITY_HIGH",
                "endOfSpeechSensitivity": "END_SENSITIVITY_HIGH",
                "prefixPaddingMs": 150,
                "silenceDurationMs": THINKING_PAUSE_MS,
            }
        },
        # Lets a dropped connection resume without burning another `uses` — Google
        # documents resumption as not counting against the token's use limit.
        "sessionResumption": {},
    }

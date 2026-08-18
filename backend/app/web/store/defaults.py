"""Seeded defaults — a port of `server/store/defaults.ts`.

These are the values a new interview template starts from, plus the browsable
voice and persona catalogs the recruiter picker reads. Pure data and pure
functions: no Firestore, no HTTP.

Field names are the web frontend's camelCase, because these objects are returned
to it verbatim and round-tripped back on save.

The rubric ids are stable slugs rather than generated ids on purpose: a score map
is keyed by them, so a regenerated id would orphan every historical score.
"""

from __future__ import annotations

from app.config import get_settings

# ── timing ────────────────────────────────────────────────────────────────────

DEFAULT_TIMING: dict = {
    "prepSeconds": 30,
    "answerSeconds": 120,
    "allowSkipPrep": True,
    "allowEarlySubmit": True,
    "warningThresholdSeconds": 15,
}

# Chatbot track — TIMED mode.
DEFAULT_CONVERSATION_TIMING: dict = {
    "thinkingSeconds": 30,
    "perQuestionSeconds": 120,
    "allowSkipThinking": True,
    "allowEarlySubmit": True,
    "warningThresholdSeconds": 15,
}

# Conversational track — per-question timer overlay. ON by default (product
# decision 2026-07): every new chatbot template shows the countdown, and a
# recruiter can disable it per template for a pure conversational flow.
DEFAULT_CHATBOT_TIMER: dict = {
    "enabled": True,
    "perQuestionSeconds": 120,
    "timeFollowUps": True,
    "followUpSeconds": 90,
    "includeThinkingPhase": False,
    "thinkingSeconds": 20,
    "warningThresholdSeconds": 15,
    "allowEarlySubmit": True,
    "autoSubmitOnExpiry": True,
}


def default_adaptive(role: str = "Software Engineer") -> dict:
    """Chatbot track — adaptive conversation defaults."""
    return {
        "role": role,
        "difficulty": "mixed",
        "style": "mix",
        "numberOfQuestions": 5,
        "technicalCount": 3,
        "nonTechnicalCount": 2,
        "focusTopics": [],
        # Default OFF: numberOfQuestions is the real total, so follow-ups are
        # opt-in rather than something that silently lengthens an interview.
        "allowFollowUps": False,
        "maxFollowUpsPerQuestion": 1,
        "interviewerTone": "friendly and professional",
        "language": "English",
    }


# ── voice track ───────────────────────────────────────────────────────────────


def default_live_model() -> str:
    """The Gemini Live model, from settings.

    Read through settings rather than captured at import time so a deployment can
    change it without a code change — the Express version read `process.env`
    directly at module load, which made it untestable.
    """
    return get_settings().gemini_live_model


# Browsable catalog of Gemini Live native-audio prebuilt voices. The ids ARE
# Google's `prebuiltVoiceConfig.voiceName` values — do not relabel them. All are
# multilingual timbres; the gender/description tags follow Google's published
# voice characteristics.
VOICE_CATALOG: list[dict] = [
    {"id": "Aoede", "label": "Aoede", "gender": "female", "description": "Breezy, natural"},
    {"id": "Kore", "label": "Kore", "gender": "female", "description": "Firm, composed"},
    {"id": "Leda", "label": "Leda", "gender": "female", "description": "Youthful, warm"},
    {"id": "Zephyr", "label": "Zephyr", "gender": "female", "description": "Bright, upbeat"},
    {"id": "Callirrhoe", "label": "Callirrhoe", "gender": "female", "description": "Easy-going"},
    {"id": "Erinome", "label": "Erinome", "gender": "female", "description": "Clear, measured"},
    {"id": "Despina", "label": "Despina", "gender": "female", "description": "Smooth, calm"},
    {"id": "Laomedeia", "label": "Laomedeia", "gender": "female", "description": "Upbeat, lively"},
    {"id": "Charon", "label": "Charon", "gender": "male", "description": "Informative, steady"},
    {"id": "Orus", "label": "Orus", "gender": "male", "description": "Firm, authoritative"},
    {"id": "Puck", "label": "Puck", "gender": "male", "description": "Upbeat, friendly"},
    {"id": "Fenrir", "label": "Fenrir", "gender": "male", "description": "Excitable, energetic"},
    {"id": "Iapetus", "label": "Iapetus", "gender": "male", "description": "Clear, articulate"},
    {"id": "Umbriel", "label": "Umbriel", "gender": "male", "description": "Easy-going"},
    {"id": "Enceladus", "label": "Enceladus", "gender": "male", "description": "Breathy, soft"},
    {"id": "Algieba", "label": "Algieba", "gender": "male", "description": "Smooth, warm"},
]

# The two constant fields every catalog entry carries. Kept out of the literals
# above so the table stays readable and the values cannot drift between rows.
_VOICE_DEFAULTS = {"language": "English (multilingual)", "engine": "gemini_live"}


def voice_catalog() -> list[dict]:
    """The catalog as the client expects it, with the shared fields filled in."""
    return [{**_VOICE_DEFAULTS, **voice} for voice in VOICE_CATALOG]


def find_voice(voice_id: str) -> dict | None:
    """One catalog entry by id, or None. Case-sensitive: these are Google's names."""
    return next((v for v in voice_catalog() if v["id"] == voice_id), None)


# Selectable interviewer personas: character + default voice. Fully editable by
# the recruiter — these are starting points, not a fixed list.
PERSONA_PRESETS: list[dict] = [
    {
        "id": "friendly_hr",
        "name": "Friendly HR Screener",
        "description": "Warm, encouraging first-round screener who puts candidates at ease.",
        "stylePrompt": (
            "You are a warm, personable HR screener. You sound friendly and "
            "encouraging, keep the candidate at ease, and speak in a relaxed "
            "conversational tone."
        ),
        "defaultVoiceId": "Aoede",
    },
    {
        "id": "rigorous_tech",
        "name": "Rigorous Technical Interviewer",
        "description": "Sharp, focused engineer probing depth and problem-solving.",
        "stylePrompt": (
            "You are a sharp, focused senior engineer running a technical "
            "interview. You are professional and respectful, but you probe for "
            "depth and precision. Stay crisp and direct."
        ),
        "defaultVoiceId": "Charon",
    },
    {
        "id": "warm_behavioral",
        "name": "Warm Behavioral Interviewer",
        "description": "Empathetic interviewer exploring experience and collaboration.",
        "stylePrompt": (
            "You are an empathetic behavioral interviewer. You listen closely, "
            "sound genuinely interested, and gently draw out stories about the "
            "candidate’s experience and how they work with others."
        ),
        "defaultVoiceId": "Leda",
    },
    {
        "id": "exec_panel",
        "name": "Executive Panel Lead",
        "description": "Composed, senior leader assessing strategic thinking and presence.",
        "stylePrompt": (
            "You are a composed, senior executive leading a final-round "
            "conversation. You are gracious but discerning, assessing judgment, "
            "strategic thinking, and presence. Speak with calm authority."
        ),
        "defaultVoiceId": "Orus",
    },
]


def default_voice_config() -> dict:
    return {
        "engine": "gemini_live",
        "personaId": "friendly_hr",
        "voiceId": "Aoede",
        "allowBargeIn": True,
        "language": "en-US",
        "model": default_live_model(),
    }


# ── integrity, branding, rubric ───────────────────────────────────────────────

DEFAULT_INTEGRITY: dict = {
    "enforceFullscreen": False,
    "detectTabSwitch": True,
    "disablePasteInAnswers": True,
    "disableCopy": False,
    "maxTabSwitchWarnings": 3,
    "logEvents": True,
}

DEFAULT_BRANDING: dict = {
    # The PRODUCT's name, not the company's. A candidate opening an unbranded
    # interview is meeting Mimic; TalbotIQ is who builds it, which is a fact about
    # us and not one the candidate is there for. A recruiter who sets their own
    # companyName still overrides this, and that identity wins everywhere.
    #
    # Only NEW templates read this. Templates created before the rename carry
    # "TalbotIQ" persisted in Firestore, and the candidate UI treats that stored
    # value as unbranded so those interviews show the Mimic mark too — see
    # `isProductBranding` in web_version/talbotiq-platform/src/features/interview/branding.ts.
    "companyName": "Mimic",
    # Ink. The candidate-facing DEFAULT accent follows the identity, as it did each
    # time the identity moved — and the identity's own rule is that the primary
    # action is ink and colour is spent only on state. Recruiter-set
    # BrandingConfig.accentColor is untouched and still honoured — only the default
    # moves. This is also the default CTA colour in every invite, advance, selected
    # and rejection email, which is intended.
    "accentColor": "#0E1420",
    "welcomeMessage": (
        "Welcome to your interview. Find a quiet spot, take a breath, and answer "
        "naturally — there are no trick questions."
    ),
}


def default_rubric() -> dict:
    """The default KPI rubric.

    Ids are stable slugs, not generated: `ResultReport.kpiScores` is keyed by
    them, so a regenerated id would orphan every score already recorded against
    it. Custom KPIs added later must not reuse these six.
    """
    return {
        "scoreScale": 100,
        "kpis": [
            {
                "id": "communication",
                "label": "Communication Clarity",
                "description": "Clear, articulate, easy to follow.",
                "weight": 1,
                "enabled": True,
            },
            {
                "id": "relevance",
                "label": "Relevance to Question",
                "description": "Directly answers what was asked.",
                "weight": 1,
                "enabled": True,
            },
            {
                "id": "depth",
                "label": "Technical / Domain Depth",
                "description": "Demonstrates real expertise and substance.",
                "weight": 1,
                "enabled": True,
            },
            {
                "id": "structure",
                "label": "Structure & Conciseness",
                "description": "Well-organized (e.g. STAR); concise, no rambling.",
                "weight": 1,
                "enabled": True,
            },
            {
                "id": "problem_solving",
                "label": "Problem-Solving",
                "description": "Logical reasoning and a sound approach to problems.",
                "weight": 1,
                "enabled": True,
            },
            {
                "id": "professionalism",
                "label": "Professionalism / Confidence",
                "description": "Composed, confident, professional tone.",
                "weight": 1,
                "enabled": True,
            },
        ],
    }

"""The stored essay prompt, and the projection a candidate is allowed to see.

An essay prompt holds no hidden answer the way a coding problem or an MCQ paper
does, so there is less to protect here than in `coding_problems` — but not
nothing. `guidanceMd` is the recruiter's note about what they are actually
looking for. Shown to a candidate it stops being guidance and becomes a list of
the words that score, which is a different thing from telling someone what a good
essay looks like. It is recruiter-only, and the projection test asserts that on
serialised bytes rather than on the dict.

Saving is permissive, using is strict — the same line `coding_problems` and
`mcq_authoring` draw. A half-written prompt stores happily; `essay.essay_faults`
is what stops it reaching a candidate.
"""

from __future__ import annotations

from app.web.services.essay import essay_faults  # re-exported for the routes

__all__ = [
    "InvalidEssayPrompt",
    "PROMPT_TYPES",
    "PUBLIC_PROMPT_FIELDS",
    "clean_prompt",
    "essay_faults",
    "public_prompt",
]

MAX_TITLE = 200
MAX_PROMPT = 20_000
MAX_PASSAGE = 40_000
MAX_GUIDANCE = 10_000
MAX_WORDS = 50_000
MIN_TIME_SECONDS = 60
MAX_TIME_SECONDS = 4 * 60 * 60

# Not exam-specific. These describe the SHAPE of the task, and an IELTS or UPSC
# flavour is a rubric and a band scale the recruiter chooses on top.
PROMPT_TYPES = (
    "argumentative",
    "descriptive",
    "analytical",
    "source_based",
    "opinion",
    "report",
    "discursive",
)
DEFAULT_PROMPT_TYPE = "argumentative"


class InvalidEssayPrompt(ValueError):
    """The body is not a prompt at all. Distinct from a prompt that is merely
    incomplete, which stores and is reported by `essay_faults`."""


def _text(value: object, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _clamp(value: object, *, low: int, high: int, default: int) -> int:
    """A nonsense number falls back rather than raising: a recruiter typing into
    a field should not be met with an exception."""
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default
    return high if number > high else low if number < low else number


def clean_prompt(body: dict, *, recruiter_id: str, prompt_id: str, now: str) -> dict:
    """The stored record. Pure, so it is testable directly.

    An allow-list, for the same reason as everywhere else in this package: a field
    a client invents is dropped rather than stored, so nothing reaches Firestore
    that this file has not named.
    """
    if not isinstance(body, dict):
        raise InvalidEssayPrompt("essay prompt is not an object")

    prompt_type = _text(body.get("promptType"), 32).lower()
    return {
        "id": prompt_id,
        "recruiterId": recruiter_id,
        "title": _text(body.get("title"), MAX_TITLE),
        "promptMd": _text(body.get("promptMd"), MAX_PROMPT),
        "promptType": prompt_type if prompt_type in PROMPT_TYPES else DEFAULT_PROMPT_TYPE,
        # BCP-47. Blank means English rather than "unknown", because an unknown
        # language cannot be evaluated and a blank field is what an untouched form
        # sends.
        "language": _text(body.get("language"), 16) or "en",
        # Shown beside the editor for source-based tasks. It IS the task, so it is
        # public.
        "sourcePassageMd": _text(body.get("sourcePassageMd"), MAX_PASSAGE),
        # The recruiter's own note. Never projected.
        "guidanceMd": _text(body.get("guidanceMd"), MAX_GUIDANCE),
        "minWords": _clamp(body.get("minWords"), low=0, high=MAX_WORDS, default=0),
        "maxWords": _clamp(body.get("maxWords"), low=0, high=MAX_WORDS, default=0),
        "maxChars": _clamp(body.get("maxChars"), low=0, high=MAX_WORDS * 10, default=0),
        "timeLimitSeconds": _clamp(
            body.get("timeLimitSeconds"),
            low=MIN_TIME_SECONDS,
            high=MAX_TIME_SECONDS,
            default=1_800,
        ),
        "createdAt": now,
    }


# Named here rather than inline so the projection test asserts the shape of the
# contract itself, not just one prompt's output.
PUBLIC_PROMPT_FIELDS = (
    "id",
    "title",
    "promptMd",
    "promptType",
    "language",
    "sourcePassageMd",
    "minWords",
    "maxWords",
    "maxChars",
    "timeLimitSeconds",
)


def public_prompt(prompt: dict) -> dict:
    """The prompt as a candidate receives it.

    Built by naming what goes IN rather than deleting what must stay out. A
    projection written as a series of deletions leaks every field added later.
    """
    return {field: prompt.get(field) for field in PUBLIC_PROMPT_FIELDS}

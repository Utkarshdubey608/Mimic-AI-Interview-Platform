"""Drafting essay prompts from a topic. Returned for review, never saved.

The same line `question_sets/generate` and `mcq_gen` draw, for the same reason: a
model's first attempt at a question is a suggestion. A recruiter reads it, edits
it, and decides — before any candidate is asked to spend forty minutes answering
it. An essay prompt in particular is worth a human eye, because an ambiguous one
does not fail loudly; it produces forty minutes of writing that answers a
different question, and the candidate is then marked down for it.

Thinking is left ON. This is an authoring-time call a recruiter makes once and
waits a few seconds for, and the reasoning-heavy part of an essay prompt is
making it arguable — a question with only one defensible answer is a
comprehension exercise, not an essay.
"""

from __future__ import annotations

import json
import logging

from app.config import Settings
from app.web.services import essay_prompts, gemini

logger = logging.getLogger("web.essay.generate")

MAX_DRAFTS = 5

PROMPTS_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "prompts": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "title": {"type": "STRING"},
                    "promptMd": {"type": "STRING"},
                    "guidanceMd": {"type": "STRING"},
                    "suggestedMinWords": {"type": "INTEGER"},
                    "suggestedMaxWords": {"type": "INTEGER"},
                },
                "required": ["title", "promptMd", "guidanceMd"],
            },
        }
    },
    "required": ["prompts"],
}

_SHAPE = {
    "argumentative": "asks the writer to take a position and defend it",
    "descriptive": "asks the writer to describe something precisely",
    "analytical": "asks the writer to break something down and explain how it works",
    "source_based": "asks the writer to respond to a supplied passage or data",
    "opinion": "asks for a personal view, reasoned rather than asserted",
    "report": "asks for a factual summary written for a stated reader",
    "discursive": "asks the writer to weigh competing views before concluding",
}


def build_prompt(
    *, topic: str, role: str, difficulty: str, prompt_type: str, language: str, count: int
) -> str:
    shape = _SHAPE.get(prompt_type, _SHAPE["argumentative"])
    audience = f" The candidates are applying for: {role}." if role.strip() else ""
    return (
        f"Draft {count} essay prompt(s) on the topic: {topic}.{audience}\n\n"
        f"Each prompt {shape}. Difficulty: {difficulty}. Write them in the language "
        f"with code {language}.\n\n"
        "Rules:\n"
        "- A good prompt is ARGUABLE. If there is only one defensible answer it is "
        "a comprehension exercise, not an essay.\n"
        "- Be specific enough that two writers would produce different essays, and "
        "open enough that neither is wrong for trying.\n"
        "- Assume no specialist knowledge beyond the topic itself. A prompt that "
        "tests whether someone happens to know a fact is not testing writing.\n"
        "- Avoid prompts that require the writer to disclose personal "
        "circumstances — health, politics, religion, family or finances. A "
        "candidate should never have to choose between a good essay and their "
        "privacy.\n"
        "- `guidanceMd` is a note to the RECRUITER about what a strong answer "
        "would contain. It is never shown to the candidate.\n"
        "- `title` is a short label, not the question itself.\n"
        "Return ONLY the JSON object described by the response schema."
    )


def normalise_drafts(payload: object, *, count: int) -> list[dict]:
    """Whatever came back, reduced to prompts that could actually be saved.

    A draft missing its question is dropped rather than repaired: an essay prompt
    with no prompt is not a partial result, it is nothing.
    """
    if not isinstance(payload, dict):
        return []
    items = payload.get("prompts")
    if not isinstance(items, list):
        return []

    out: list[dict] = []
    for item in items[:count]:
        if not isinstance(item, dict):
            continue
        question = str(item.get("promptMd") or "").strip()
        if not question:
            continue
        out.append(
            {
                "title": str(item.get("title") or "").strip()[: essay_prompts.MAX_TITLE],
                "promptMd": question[: essay_prompts.MAX_PROMPT],
                "guidanceMd": str(item.get("guidanceMd") or "").strip()[
                    : essay_prompts.MAX_GUIDANCE
                ],
                "suggestedMinWords": _int(item.get("suggestedMinWords")),
                "suggestedMaxWords": _int(item.get("suggestedMaxWords")),
            }
        )
    return out


def _int(value: object) -> int:
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0
    return number if 0 <= number <= essay_prompts.MAX_WORDS else 0


async def generate_prompts(
    settings: Settings,
    *,
    topic: str,
    role: str = "",
    difficulty: str = "medium",
    prompt_type: str = "argumentative",
    language: str = "en",
    count: int = 3,
) -> list[dict]:
    """Drafts for review. Saving is the recruiter's decision, made afterwards."""
    wanted = max(1, min(int(count or 1), MAX_DRAFTS))
    text = await gemini.generate_text(
        settings,
        contents=gemini.user_turn(
            build_prompt(
                topic=topic,
                role=role,
                difficulty=difficulty,
                prompt_type=prompt_type,
                language=language,
                count=wanted,
            )
        ),
        response_schema=PROMPTS_SCHEMA,
        response_mime_type="application/json",
        # Thinking ON: authoring-time, waited on once, and making a prompt
        # genuinely arguable is the reasoning-heavy part of the whole task.
    )
    try:
        payload = json.loads(text)
    except ValueError:
        logger.warning("essay_generation: response was not JSON")
        return []
    return normalise_drafts(payload, count=wanted)

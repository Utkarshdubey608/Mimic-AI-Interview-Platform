"""Mode A generation, over the WEB surface's Gemini client.

The prompts, the schemas and the normalisation are in `app/mcq_gen.py` — shared, so the
same request produces the same paper whichever surface asked. What is left here is the
call itself, because the two surfaces authenticate and configure Gemini differently:
this one resolves the recruiter's saved key and the deployment's model through
`app_settings`, while the common surface uses `providers.GeminiClient` and the
environment.

That difference is real and predates MCQ. Sharing the transport would mean promoting
`app_settings` and the web settings document into the kernel, which is a much larger
change than "both clients can generate a paper" needs.
"""

from __future__ import annotations

import json
import logging

from app import mcq_gen
from app.config import Settings
from app.web.services import gemini

logger = logging.getLogger("web.mcq_gen")

# Re-exported so existing callers keep working unchanged. The definitions live in the
# kernel; these names are the seam that stopped this module being the only way in.
MAX_TOPICS = mcq_gen.MAX_TOPICS
MAX_QUESTIONS = mcq_gen.MAX_QUESTIONS
DIFFICULTIES = mcq_gen.DIFFICULTIES
SECTIONS = mcq_gen.SECTIONS
STYLES = mcq_gen.STYLES
SECTION_LABELS = mcq_gen.SECTION_LABELS
normalise_split = mcq_gen.normalise_split
section_counts = mcq_gen.section_counts
normalise_topics = mcq_gen.normalise_topics
normalise_generated = mcq_gen.normalise_generated
build_topic_prompt = mcq_gen.build_topic_prompt
build_paper_prompt = mcq_gen.build_paper_prompt
SECTION_TYPE_BRIEFS = mcq_gen.SECTION_TYPE_BRIEFS
remaining_count = mcq_gen.remaining_count
normalised_for_dedup = mcq_gen.normalised_for_dedup
drop_duplicate_questions = mcq_gen.drop_duplicate_questions
build_section_prompt = mcq_gen.build_section_prompt


async def suggest_topics(settings: Settings, *, role: str) -> list[str]:
    """Topics worth testing for a role. One call, at authoring time."""
    text = await gemini.generate_text(
        settings,
        contents=gemini.user_turn(build_topic_prompt(role)),
        response_schema=mcq_gen.TOPIC_SCHEMA,
        response_mime_type="application/json",
        # A recruiter is watching this one, and it is a list of nouns rather than
        # a reasoning problem.
        thinking_budget=0,
    )
    try:
        payload = json.loads(text)
    except ValueError:
        logger.warning("mcq_gen: topic response was not JSON")
        return []
    return normalise_topics(payload)


async def generate_paper(
    settings: Settings,
    *,
    role: str,
    topics: list[str],
    split: dict[str, int],
    difficulty: str,
    allow_multi: bool,
) -> list[dict]:
    """A paper, returned for review. Never saved here.

    Takes the split rather than a bare total, so the sections the recruiter chose
    reach both the prompt AND the labelling of what comes back. Passing only a
    count would let the model be asked for a balance nobody could afterwards
    check was honoured.
    """
    prompt = build_paper_prompt(
        role=role, topics=topics, split=split, difficulty=difficulty, allow_multi=allow_multi
    )
    text = await gemini.generate_text(
        settings,
        contents=gemini.user_turn(prompt),
        response_schema=mcq_gen.PAPER_SCHEMA,
        response_mime_type="application/json",
        # Thinking left ON here, unlike the topic call: writing distractors that
        # are plausible but wrong is the reasoning-heavy part of this whole mode,
        # and a recruiter waiting a few extra seconds once, at authoring time, is
        # a far better trade than a paper of obvious answers.
    )
    try:
        payload = json.loads(text)
    except ValueError:
        logger.warning("mcq_gen: paper response was not JSON")
        return []
    return normalise_generated(payload, sections=tuple(split))


async def _call_section_batch(
    settings: Settings,
    *,
    role: str,
    section_type: str,
    section_name: str,
    count: int,
    difficulty: str,
    exclude_texts: list[str],
    existing_passage: str | None,
) -> tuple[list[dict], str | None]:
    """One Gemini call for Mode B. Raises on transport failure; the caller
    decides how many top-up attempts that is worth."""
    prompt = mcq_gen.build_section_prompt(
        section_type=section_type,
        section_name=section_name,
        role=role,
        count=count,
        difficulty=difficulty,
        exclude_texts=exclude_texts,
        existing_passage=existing_passage,
    )
    text = await gemini.generate_text(
        settings,
        contents=gemini.user_turn(prompt),
        response_schema=mcq_gen.SECTION_SCHEMA,
        response_mime_type="application/json",
    )
    try:
        payload = json.loads(text)
    except ValueError:
        logger.warning("mcq_gen: section response was not JSON")
        return [], None
    passage = None
    if isinstance(payload, dict):
        # Line breaks matter for a passage's paragraphing, so this trims
        # rather than word-joins — the same distinction `mcq_authoring`
        # draws between `text_of` and `multiline_of`.
        cleaned = str(payload.get("passage") or "").strip()[:8000]
        passage = cleaned or None
    return normalise_generated(payload, sections=()), passage


async def generate_for_section(
    settings: Settings,
    *,
    role: str,
    section_type: str,
    section_name: str,
    count: int,
    difficulty: str,
    exclude_texts: list[str],
    existing_passage: str | None = None,
) -> dict:
    """Exactly `count` NEW questions for ONE section, excluding duplicates of
    `exclude_texts`. One bounded top-up attempt covers the realistic case
    where the first batch's duplicate check drops a question — this
    regenerates only the shortfall, never restarts the whole batch.
    """
    collected: list[dict] = []
    exclude = list(exclude_texts)
    passage = existing_passage
    attempts_left = 2  # the initial batch, plus one top-up for any shortfall
    remaining = count

    while remaining > 0 and attempts_left > 0:
        attempts_left -= 1
        batch, batch_passage = await _call_section_batch(
            settings,
            role=role,
            section_type=section_type,
            section_name=section_name,
            count=remaining,
            difficulty=difficulty,
            exclude_texts=exclude,
            existing_passage=passage,
        )
        passage = passage or batch_passage
        kept, _dropped = mcq_gen.drop_duplicate_questions(batch, exclude)
        for question in kept[:remaining]:
            question["source"] = "ai_generated"
            collected.append(question)
            exclude.append(question.get("text") or "")
        remaining = count - len(collected)

    return {
        "questions": collected,
        "passage": passage,
        "requested": count,
        "delivered": len(collected),
    }

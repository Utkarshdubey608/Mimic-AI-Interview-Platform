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

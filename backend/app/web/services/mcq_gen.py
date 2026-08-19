"""Mode A — suggesting topics for a role, and generating a paper from them.

Two calls, both one-time at authoring. Neither runs per candidate: an MCQ paper is
written once and sat by everyone, which is exactly why this mode costs almost
nothing to operate compared with the six open-ended ones.

── Generation returns; it does not save ─────────────────────────────────────
Same split `question_sets.generate` uses, and for the same reason: generation
costs a model call, and a recruiter who dislikes the result should not have to
delete a set they never wanted. The questions come back for review, the recruiter
edits them, and saving is a separate act.

── The model is told to make WRONG answers plausible ────────────────────────
The hard part of an MCQ is not the correct option, it is the other three. A
question whose distractors are obviously wrong measures nothing — every candidate
scores it, and the paper cannot separate anyone. So the prompt asks for
distractors that a candidate with a partial understanding would actually pick, and
forbids the giveaways models reach for by default: "all of the above", joke
options, and a correct answer noticeably longer than the rest.

── Nothing here is trusted ──────────────────────────────────────────────────
Everything the model returns passes through `normalise_generated`, which rebuilds
each question from scratch rather than forwarding it. A model that returns four
correct answers, a key naming an option that does not exist, or an empty option
list produces a question that is DROPPED, not one that reaches a candidate and
scores everybody zero.
"""

from __future__ import annotations

import logging
import uuid

from app.config import Settings
from app.web.services import gemini

logger = logging.getLogger("web.mcq_gen")

MAX_TOPICS = 24
MAX_QUESTIONS = 40
DIFFICULTIES = ("easy", "medium", "hard", "mixed")

_TOPIC_SCHEMA = {
    "type": "object",
    "properties": {
        "topics": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["topics"],
}

_PAPER_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "topic": {"type": "string"},
                    "difficulty": {"type": "string"},
                    "explanation": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string"},
                                "correct": {"type": "boolean"},
                            },
                            "required": ["text", "correct"],
                        },
                    },
                },
                "required": ["text", "options"],
            },
        }
    },
    "required": ["questions"],
}


def _clean(text: object, limit: int) -> str:
    return " ".join(str(text or "").split())[:limit]


def normalise_topics(payload: dict) -> list[str]:
    """Model output → a de-duplicated topic list, case-insensitively unique."""
    raw = payload.get("topics") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []

    out: list[str] = []
    seen: set[str] = set()
    for item in raw:
        topic = _clean(item, 60)
        key = topic.lower()
        if topic and key not in seen:
            seen.add(key)
            out.append(topic)
    return out[:MAX_TOPICS]


def normalise_generated(payload: dict) -> list[dict]:
    """Model output → questions in OUR shape, rebuilt rather than forwarded.

    A generated question is not trusted to be usable. Each is reconstructed from
    its parts and dropped entirely unless it can actually assess somebody:

      · at least two options, or it asks nothing;
      · at least one correct, or every candidate scores zero;
      · not ALL correct, or it separates nobody.

    Dropping is the right failure. A malformed question that reaches a candidate
    is worse than a shorter paper, because the recruiter cannot see the difference
    until the scores come back uniform.
    """
    raw = payload.get("questions") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []

    questions: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = _clean(item.get("text"), 2000)
        if not text:
            continue

        options: list[dict] = []
        key: list[str] = []
        for raw_option in item.get("options") or []:
            if not isinstance(raw_option, dict):
                continue
            option_text = _clean(raw_option.get("text"), 500)
            if not option_text:
                continue
            option_id = uuid.uuid4().hex[:8]
            options.append({"id": option_id, "text": option_text})
            if raw_option.get("correct") is True:
                key.append(option_id)

        if len(options) < 2 or not key or len(key) == len(options):
            logger.info("mcq_gen: dropped an unusable generated question")
            continue

        question: dict = {
            "id": uuid.uuid4().hex,
            "text": text,
            "options": options,
            "correctOptionIds": key,
            "type": "multi" if len(key) > 1 else "single",
        }
        if topic := _clean(item.get("topic"), 120):
            question["topic"] = topic
        if (difficulty := _clean(item.get("difficulty"), 12).lower()) in ("easy", "medium", "hard"):
            question["difficulty"] = difficulty
        if explanation := _clean(item.get("explanation"), 2000):
            question["explanation"] = explanation
        questions.append(question)

    return questions[:MAX_QUESTIONS]


def build_topic_prompt(role: str) -> str:
    return (
        f"List the skill areas a multiple-choice screening test for a {role} should cover.\n\n"
        "Rules:\n"
        "- Between 8 and 16 topics.\n"
        "- Each is a short noun phrase a recruiter would recognise, not a sentence.\n"
        "- Concrete and testable by a multiple-choice question. 'Indexing strategy' "
        "is a topic; 'being a good communicator' is not.\n"
        "- Order them roughly by how central they are to the role.\n"
        "- No duplicates and no near-duplicates."
    )


def build_paper_prompt(
    *, role: str, topics: list[str], count: int, difficulty: str, allow_multi: bool
) -> str:
    spread = (
        "Mix easy, medium and hard across the paper."
        if difficulty == "mixed"
        else f"Every question should be {difficulty} for this role."
    )
    multi = (
        "Most questions have exactly one correct option. A few may have two, where "
        "the subject genuinely has more than one right answer — never to make a "
        "question harder."
        if allow_multi
        else "Every question has exactly ONE correct option."
    )
    topic_list = "\n".join(f"- {topic}" for topic in topics)

    return (
        f"Write {count} multiple-choice questions to screen a {role}.\n\n"
        f"Cover these topics, spread evenly:\n{topic_list}\n\n"
        f"{spread}\n{multi}\n\n"
        "What makes these questions good, and what usually makes them bad:\n"
        "- The WRONG options are the hard part. Each should be something a "
        "candidate with a partial or outdated understanding would actually choose. "
        "An obviously wrong option is wasted — every candidate rules it out, and "
        "the question stops separating anyone.\n"
        "- Four options each.\n"
        "- Never 'all of the above', 'none of the above', or joke options.\n"
        "- Do not make the correct option noticeably longer or more detailed than "
        "the others. That is the single most common tell in a generated paper, and "
        "a candidate who spots it can pass without knowing the subject.\n"
        "- Test understanding, not recall of syntax or version numbers.\n"
        "- Each question stands alone and never refers to another.\n"
        "- Give a one-sentence explanation of why the correct answer is correct.\n"
        "- Mark exactly which options are correct."
    )


async def suggest_topics(settings: Settings, *, role: str) -> list[str]:
    """Topics worth testing for a role. One call, at authoring time."""
    text = await gemini.generate_text(
        settings,
        # `content`, not `text`. `to_contents` reads `content` and DROPS any
        # message without it, so a `text` key produced an empty conversation
        # and Gemini was never called — the request failed before it left the
        # server, reported only as "Gemini request failed".
        contents=gemini.to_contents([{"role": "user", "content": build_topic_prompt(role)}]),
        response_schema=_TOPIC_SCHEMA,
        response_mime_type="application/json",
        # A recruiter is watching this one, and it is a list of nouns rather than
        # a reasoning problem.
        thinking_budget=0,
    )
    import json

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
    count: int,
    difficulty: str,
    allow_multi: bool,
) -> list[dict]:
    """A paper, returned for review. Never saved here."""
    prompt = build_paper_prompt(
        role=role, topics=topics, count=count, difficulty=difficulty, allow_multi=allow_multi
    )
    text = await gemini.generate_text(
        settings,
        contents=gemini.to_contents([{"role": "user", "content": prompt}]),
        response_schema=_PAPER_SCHEMA,
        response_mime_type="application/json",
        # Thinking left ON here, unlike the topic call: writing distractors that
        # are plausible but wrong is the reasoning-heavy part of this whole mode,
        # and a recruiter waiting a few extra seconds once, at authoring time, is
        # a far better trade than a paper of obvious answers.
    )
    import json

    try:
        payload = json.loads(text)
    except ValueError:
        logger.warning("mcq_gen: paper response was not JSON")
        return []
    return normalise_generated(payload)

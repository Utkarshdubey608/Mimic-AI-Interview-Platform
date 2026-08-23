"""Writing an MCQ paper — the prompts, the schemas, and the distrust.

Everything here is PURE: it builds prompts and rebuilds what comes back. No I/O, no
transport, no provider. That is what let it be shared, and it is why the two surfaces
can call two different Gemini clients without producing two different papers.

The two functions that actually make the call live next to their transport —
`app/web/services/mcq_gen.py` for the web's Gemini client, `app/routers/mcq_sets.py`
for the common surface's. Both hand the response back through `normalise_generated`
here, so "what counts as a usable question" is decided once.

Two calls, both one-time at authoring. Neither runs per candidate: an MCQ paper is
written once and sat by everyone, which is exactly why this mode costs almost nothing
to operate compared with the six open-ended ones.

── Generation returns; it does not save ─────────────────────────────────────
Same split `question_sets.generate` uses, and for the same reason: generation costs a
model call, and a recruiter who dislikes the result should not have to delete a set
they never wanted. The questions come back for review, the recruiter edits them, and
saving is a separate act.

── The model is told to make WRONG answers plausible ────────────────────────
The hard part of an MCQ is not the correct option, it is the other three. A question
whose distractors are obviously wrong measures nothing — every candidate scores it, and
the paper cannot separate anyone. So the prompt asks for distractors that a candidate
with a partial understanding would actually pick, and forbids the giveaways models
reach for by default: "all of the above", joke options, and a correct answer noticeably
longer than the rest.

── Nothing here is trusted ──────────────────────────────────────────────────
Everything the model returns passes through `normalise_generated`, which rebuilds each
question from scratch rather than forwarding it. A model that returns four correct
answers, a key naming an option that does not exist, or an empty option list produces a
question that is DROPPED, not one that reaches a candidate and scores everybody zero.
"""

from __future__ import annotations

import json
import logging
import uuid

logger = logging.getLogger("mcq_gen")

MAX_TOPICS = 24
MAX_QUESTIONS = 40
DIFFICULTIES = ("easy", "medium", "hard", "mixed")

# A paper is divided into sections, the same two the rest of the platform has
# always used. `style` is what the recruiter picks; SECTIONS is what a question
# can be tagged with. Deliberately the same vocabulary as the invite wizard, the
# template editor and resume generation (`style` / `technicalCount` /
# `nonTechnicalCount`), so "Mix, 6 and 4" means one thing everywhere a recruiter
# meets it rather than one thing per screen.
SECTIONS = ("technical", "non_technical")
STYLES = ("technical", "non_technical", "mix")
SECTION_LABELS = {"technical": "Technical", "non_technical": "Non-technical"}


def normalise_split(style: str, technical: int, non_technical: int) -> dict[str, int]:
    """The requested paper as {section: how many}, clamped and never empty.

    One function decides this so the route, the prompt and the tests cannot
    disagree about what a given choice means. Two rules worth stating:

    * **A section asked for zero questions is dropped, not kept at zero.** A "mix"
      with one side empty is a single-section paper, and prompting for it as one
      stops the model being told to write a section of nothing.
    * **The total is bounded, not each side.** Two sections of the maximum is not
      twice the maximum; the wider section gives up questions until the whole
      paper fits.
    """
    if style not in STYLES:
        style = "technical"
    technical = max(0, min(MAX_QUESTIONS, technical))
    non_technical = max(0, min(MAX_QUESTIONS, non_technical))

    if style == "technical":
        split = {"technical": technical or 1}
    elif style == "non_technical":
        split = {"non_technical": non_technical or 1}
    else:
        split = {
            section: n
            for section, n in (("technical", technical), ("non_technical", non_technical))
            if n > 0
        }
        if not split:
            split = {"technical": 1}

    while sum(split.values()) > MAX_QUESTIONS:
        widest = max(split, key=lambda section: split[section])
        split[widest] -= 1
    return split


def section_counts(questions: list[dict]) -> dict[str, int]:
    """The split that actually ARRIVED, counting only labelled questions.

    Reported next to the split that was requested. A model told "6 technical and 4
    non-technical" can return 7 and 3, and a recruiter about to screen people on
    this paper should see that before they save it rather than discover it by
    reading all ten questions.
    """
    counts: dict[str, int] = {}
    for question in questions:
        section = question.get("section")
        if section:
            counts[section] = counts.get(section, 0) + 1
    return counts

TOPIC_SCHEMA = {
    "type": "object",
    "properties": {
        "topics": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["topics"],
}

PAPER_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "topic": {"type": "string"},
                    "section": {"type": "string"},
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


def _section_of(item: dict, sections: tuple[str, ...]) -> str | None:
    """Which section a generated question belongs to, or None.

    A SINGLE-section paper labels by construction: the recruiter asked for a
    technical paper, so every question in it is technical whatever the model chose
    to call it. Trusting the label there would let a mislabelled question make the
    delivered split look wrong when it is not.

    A MIXED paper has to trust the label, and when it is missing or unrecognised
    the question is left UNLABELLED rather than guessed. An invented section would
    make the delivered split report a balance the model never actually struck,
    which is the one thing that report exists to catch.
    """
    if len(sections) == 1:
        return sections[0]
    claimed = _clean(item.get("section"), 20).lower().replace("-", "_").replace(" ", "_")
    return claimed if claimed in sections else None


def normalise_generated(
    payload: dict, *, sections: tuple[str, ...] = ()
) -> list[dict]:
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
        if section := _section_of(item, sections):
            question["section"] = section
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


def _section_brief(section: str, role: str) -> str:
    """What this section is actually testing, spelled out for the model.

    Without this, a request for "non-technical questions" produces personality
    quizzes or general-knowledge trivia, because the model has no idea what a
    non-technical question is meant to MEASURE in a hiring context.
    """
    if section == "technical":
        return (
            "TECHNICAL questions test the craft: how something works, which "
            "approach is right and why, what a given design or piece of code "
            "actually does. Draw these from the topics listed above."
        )
    return (
        "NON-TECHNICAL questions test judgement on the job. Not personality, and "
        "not general knowledge: prioritising when everything is urgent, what to do "
        "with a requirement nobody can pin down, how to raise a risk to someone who "
        "does not want to hear it, how to explain a trade-off to a person without "
        "the background. Each still has one defensibly correct answer and wrong "
        f"options a reasonable person might pick. These are about working as a {role} "
        "and need NOT come from the topic list above. If competent people would "
        "genuinely disagree about the answer, the question does not belong in a "
        "paper that is scored."
    )


def build_paper_prompt(
    *,
    role: str,
    topics: list[str],
    split: dict[str, int],
    difficulty: str,
    allow_multi: bool,
) -> str:
    total = sum(split.values())
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

    if len(split) > 1:
        wanted = "\n".join(
            f"- {SECTION_LABELS[section]}: {n} question{'' if n == 1 else 's'}"
            for section, n in split.items()
        )
        shape = (
            f"The paper is divided into sections:\n{wanted}\n\n"
            "Write the sections in that order and do not exceed either count. Tag "
            'every question with its section, using exactly "technical" or '
            '"non_technical".'
        )
    else:
        only = next(iter(split))
        shape = (
            f"Every question in this paper is {SECTION_LABELS[only].lower()}. Tag "
            f'each one "{only}".'
        )

    briefs = "\n\n".join(_section_brief(section, role) for section in split)

    return (
        f"Write {total} multiple-choice questions to screen a {role}.\n\n"
        f"Cover these topics, spread evenly:\n{topic_list}\n\n"
        f"{shape}\n\n{briefs}\n\n"
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

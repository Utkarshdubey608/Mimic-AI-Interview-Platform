"""Generate interview questions from a résumé PDF.

Ports `generateQuestionsFromPdf` and `cleanQuestionText` from
`server/services/gemini.ts`.

The prompt is doing specific work worth preserving. It insists on questions that
reference real technologies and projects from the résumé, caps each at about thirty
words and one idea, and bans markdown and em dashes — because these questions are
often **read aloud** by the voice and avatar tracks, where an asterisk becomes a
spoken "asterisk" and an em dash reads as a machine wrote it.

One deliberate change from the Express version: the per-request `apiKeyOverride` is
gone. That route accepted a Gemini key typed into a browser dialog, which is the
opposite of the model everywhere else here — the server holds the credential and the
client holds none. A deployment with no key configured now says so instead of asking
the recruiter to supply one.
"""

from __future__ import annotations

import base64
import json
import logging
import re

from app.config import Settings
from app.web.services import gemini

logger = logging.getLogger("web.question_gen")

# Résumés are a couple of pages; this bounds what a single request can cost.
MAX_PDF_BYTES = 10 * 1024 * 1024

# A screen is a handful of questions, not a question bank.
MAX_QUESTIONS = 25

STYLES = ("mix", "technical", "non_technical")
DIFFICULTIES = ("mixed", "easy", "medium", "hard")

SYSTEM_INSTRUCTION = (
    "You are an expert technical interviewer. You read a candidate résumé and "
    "produce sharp, specific interview questions tailored to that exact person. "
    "You never produce generic, copy-paste questions, and you never repeat yourself."
)

QUESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "type": {"type": "string", "enum": ["technical", "non_technical"]},
                    "category": {"type": "string"},
                    "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
                    "skillTag": {"type": "string"},
                    "rationale": {"type": "string"},
                },
                "required": ["text", "type", "category", "difficulty", "skillTag", "rationale"],
                "propertyOrdering": [
                    "text", "type", "category", "difficulty", "skillTag", "rationale",
                ],
            },
        }
    },
    "required": ["questions"],
}


def clean_question_text(text: str | None) -> str:
    """Strip anything that would be read aloud as punctuation or markup.

    These questions are spoken by the voice and avatar tracks, so an asterisk
    becomes the word "asterisk" and an em dash reads as machine-written. Word
    hyphens are deliberately kept — "back-end" is a word, not a dash.
    """
    value = text or ""
    value = re.sub(r"\*+", "", value)              # **bold** and * bullets
    value = re.sub(r"`+", "", value)               # `code`
    value = re.sub(r"^\s*#+\s*", "", value, flags=re.MULTILINE)  # # headings
    value = re.sub(r"\s*[—–]\s*|\s+-\s+", ", ", value)     # em/en dashes → commas
    value = re.sub(r",\s*,", ",", value)           # doubled commas from the above
    value = re.sub(r",\s*([.!?])", r"\1", value)   # a comma stranded before a stop
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def clamp_int(value: object, low: int, high: int, fallback: int) -> int:
    """A bounded integer from untrusted input."""
    try:
        number = round(float(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback
    return max(low, min(high, int(number)))


def total_for(style: str, technical: int, non_technical: int) -> int:
    """How many questions a style asks for."""
    if style == "technical":
        return technical
    if style == "non_technical":
        return non_technical
    return technical + non_technical


def build_prompt(
    *, style: str, technical: int, non_technical: int, difficulty: str, role: str | None
) -> str:
    total = total_for(style, technical, non_technical)

    if style == "technical":
        style_line = (
            "Every question must be TECHNICAL — grounded in the specific "
            "technologies, tools, projects, and seniority shown in the resume."
        )
    elif style == "non_technical":
        style_line = (
            "Every question must be NON-TECHNICAL (behavioral, situational, "
            "culture-fit) — grounded in the candidate’s actual roles and experience."
        )
    else:
        style_line = (
            f"Produce EXACTLY {technical} technical and {non_technical} "
            "non-technical questions."
        )

    difficulty_line = (
        "Use a balanced mix of easy, medium, and hard difficulty."
        if difficulty == "mixed"
        else f"All questions should be {difficulty} difficulty."
    )

    role_clause = f" for a {role} role" if role else ""

    return f"""Read the attached candidate résumé and generate exactly {total} interview questions{role_clause}.
{style_line}
{difficulty_line}
Each question MUST be specific to THIS résumé. Reference real technologies, projects, or experiences from it. Avoid duplicates and generic filler.
Keep each question SHORT and conversational: ONE or two sentences, at most ~30 words, single-focus. Never bundle multiple questions together (no "and how... and why..."). Ask one clear thing.
Write the question text as PLAIN TEXT only: no markdown, no asterisks (*), no bullets, no bold, no backticks, no headings. Do NOT use em dashes or en dashes ("—" or "–"). Use commas or periods instead (they read as AI-written).
For each question provide: the question text, its type ("technical" or "non_technical"), a category (e.g. coding, system_design, behavioral, situational, culture_fit), a difficulty (easy|medium|hard), a skillTag (the résumé skill/topic it targets, e.g. React, Kafka, leadership), and a one-sentence rationale for why it fits this candidate.
Return ONLY JSON matching the provided schema."""


def enforce_split(
    questions: list[dict], *, style: str, technical: int, non_technical: int
) -> list[dict]:
    """Trim the model's output to exactly what was asked for.

    For `mix` the split is enforced per type rather than by taking the first N: the
    model tends to front-load technical questions, so a plain slice would quietly
    return a technical-only screen when a balanced one was requested.
    """
    if style != "mix":
        return questions[: total_for(style, technical, non_technical)]

    tech = [q for q in questions if q.get("type") == "technical"][:technical]
    non_tech = [q for q in questions if q.get("type") == "non_technical"][:non_technical]
    return tech + non_tech


def normalise(payload: dict) -> list[dict]:
    """Model output → question dicts with their text cleaned."""
    raw = payload.get("questions") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []

    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = clean_question_text(item.get("text"))
        if not text:
            continue
        out.append(
            {
                **item,
                "text": text,
                "rationale": clean_question_text(item.get("rationale")),
            }
        )
    return out


async def generate_from_pdf(
    settings: Settings,
    *,
    pdf_bytes: bytes,
    style: str,
    technical: int,
    non_technical: int,
    difficulty: str,
    role: str | None,
) -> list[dict]:
    """Questions tailored to one résumé. Raises on a Gemini failure."""
    prompt = build_prompt(
        style=style,
        technical=technical,
        non_technical=non_technical,
        difficulty=difficulty,
        role=role,
    )

    text = await gemini.generate_text(
        settings,
        contents=[
            {
                "role": "user",
                "parts": [
                    {
                        "inlineData": {
                            "mimeType": "application/pdf",
                            "data": base64.b64encode(pdf_bytes).decode(),
                        }
                    },
                    {"text": prompt},
                ],
            }
        ],
        system_instruction=SYSTEM_INSTRUCTION,
        response_mime_type="application/json",
        response_schema=QUESTION_SCHEMA,
    )

    try:
        payload = json.loads(text or '{"questions":[]}')
    except (TypeError, ValueError) as exc:
        raise gemini.GeminiUnavailable("Gemini returned unparseable questions.") from exc

    return enforce_split(
        normalise(payload), style=style, technical=technical, non_technical=non_technical
    )


def friendly_error(exc: Exception) -> str:
    """A message a recruiter can act on, from a vendor failure they cannot see.

    The raw error is logged; this is what reaches the dialog. Each branch names the
    next step rather than the symptom.
    """
    message = str(exc).lower()
    # A DENIED PROJECT is not a bad key, and saying so sends people to check the
    # one thing that is fine. Google answers 403 PERMISSION_DENIED — "your project
    # has been denied access" — for a key that is perfectly well-formed and was
    # working minutes earlier, typically after a quota or billing action. Checked
    # before the key branch, because that branch also matches a 403.
    if "denied access" in message or "permission_denied" in message:
        return (
            "Google has denied this project access to Gemini. The key itself is "
            "likely fine — check the project's quota and billing in Google AI "
            "Studio, or use a different key."
        )
    if isinstance(exc, gemini.GeminiAuthError) or "api key" in message or "api_key" in message:
        return (
            "Gemini rejected the API key. Make sure it’s a valid Google AI Studio "
            'key (they start with "AIza").'
        )
    if any(token in message for token in ("429", "quota", "rate")):
        return "Gemini rate limit / quota exceeded. Wait a moment and try again."
    if any(token in message for token in ("safety", "blocked")):
        return "Gemini blocked this request for safety reasons. Try a different résumé."
    return "Gemini request failed. Please try again."


# ── from résumé TEXT (the adaptive interview's own questions) ─────────────────
#
# Distinct from `generate_from_pdf`, which the recruiter uses to build a question set
# ahead of time. This runs at the moment the candidate presses Begin, from text already
# extracted at upload, so it is one call on the critical path of someone waiting.

RESUME_QUESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "category": {"type": "string"},
                    "idealAnswerNotes": {"type": "string"},
                },
                "required": ["text", "category", "idealAnswerNotes"],
                "propertyOrdering": ["text", "category", "idealAnswerNotes"],
            },
        }
    },
    "required": ["questions"],
}

# Enough of a résumé to characterise a candidate. Beyond this the tail is usually
# education and references, and the whole thing rides in a prompt on a waiting path.
MAX_RESUME_CHARS = 20_000


def build_resume_prompt(
    *,
    resume_text: str,
    role: str,
    seniority: str | None,
    count: int,
    style: str | None = None,
    technical: int | None = None,
    non_technical: int | None = None,
    difficulty: str | None = None,
    focus_topics: list[str] | None = None,
) -> str:
    """The prompt for questions tailored to one candidate.

    The tailoring parameters come from the recruiter's invite configuration, so a batch
    invited as "mostly technical, hard" produces that for every candidate while still
    being grounded in each individual résumé.
    """
    if style == "technical":
        style_line = (
            "Every question must be TECHNICAL, grounded in the specific technologies, "
            "tools, and projects shown in the résumé."
        )
    elif style == "non_technical":
        style_line = (
            "Every question must be NON-TECHNICAL (behavioral, situational, "
            "culture-fit), grounded in the candidate's actual roles and experience."
        )
    elif style == "mix" and (technical or 0) + (non_technical or 0) > 0:
        style_line = (
            f"Write exactly {technical or 0} TECHNICAL questions and "
            f"{non_technical or 0} NON-TECHNICAL (behavioral/situational) questions."
        )
    else:
        style_line = (
            "Mix behavioral and role-specific/technical questions, grounded in the "
            "candidate's actual experience."
        )

    difficulty_line = (
        f"Difficulty: every question should be {difficulty.upper()} for this seniority."
        if difficulty and difficulty != "mixed"
        else "Difficulty: vary from easy warm-ups to genuinely challenging questions."
    )

    topics_line = (
        "Focus areas, weave these domains into the questions wherever the résumé "
        f"supports them: {', '.join(focus_topics)}."
        if focus_topics
        else ""
    )

    return f"""You are an expert interviewer. Based on the candidate's résumé below, write exactly {count} interview questions tailored to a {seniority or ''} {role} role.
{style_line}
{difficulty_line}
{topics_line}
Each question MUST be specific to THIS résumé. Reference real technologies, projects, or experiences from it. Avoid duplicates and generic filler.
Keep each question SHORT and conversational: ONE or two sentences, at most ~30 words, single-focus. Never bundle multiple questions together.
Write the question text as PLAIN TEXT only: no markdown, no asterisks, no bullets, no backticks. Do NOT use em dashes or en dashes — use commas or periods instead.
For each question also give a short category (e.g. Experience, Problem-Solving, Collaboration) and one sentence of ideal-answer notes describing what a strong answer covers.
Return ONLY JSON matching the provided schema.

RÉSUMÉ:
\"\"\"
{resume_text[:MAX_RESUME_CHARS]}
\"\"\""""


async def generate_from_resume_text(
    settings: Settings,
    *,
    resume_text: str,
    role: str,
    seniority: str | None = None,
    count: int = 5,
    style: str | None = None,
    technical: int | None = None,
    non_technical: int | None = None,
    difficulty: str | None = None,
    focus_topics: list[str] | None = None,
) -> list[dict]:
    """Questions for one candidate's adaptive interview. Raises on failure."""
    if not (resume_text or "").strip():
        return []

    text = await gemini.generate_text(
        settings,
        contents=[
            {
                "role": "user",
                "parts": [
                    {
                        "text": build_resume_prompt(
                            resume_text=resume_text,
                            role=role,
                            seniority=seniority,
                            count=count,
                            style=style,
                            technical=technical,
                            non_technical=non_technical,
                            difficulty=difficulty,
                            focus_topics=focus_topics,
                        )
                    }
                ],
            }
        ],
        response_mime_type="application/json",
        response_schema=RESUME_QUESTION_SCHEMA,
        # A candidate is waiting on this call. Thinking triples the latency here
        # without lengthening the output — see generate_text's docstring for the
        # measurements. The prompt is prescriptive enough not to need it.
        thinking_budget=0,
    )

    try:
        payload = json.loads(text or '{"questions":[]}')
    except (TypeError, ValueError) as exc:
        raise gemini.GeminiUnavailable("Gemini returned unparseable questions.") from exc

    return normalise(payload)[:count]


# Generic questions, used when generation is unavailable or returns nothing. Ordinary
# interview openers rather than placeholders: a candidate who has uploaded their résumé
# and pressed Begin should be interviewed, and these produce a real, scoreable
# conversation even though they are not tailored.
FALLBACK_POOL = (
    {
        "text": "Tell me about your background and what draws you to this {role} role.",
        "category": "Intro",
        "idealAnswerNotes": "Relevant narrative tying experience to the role.",
    },
    {
        "text": "Walk me through a project you’re most proud of and your specific contribution.",
        "category": "Experience",
        "idealAnswerNotes": "Ownership, impact, and concrete detail.",
    },
    {
        "text": "Describe a difficult technical or professional problem you solved recently.",
        "category": "Problem-Solving",
        "idealAnswerNotes": "STAR; clear approach and measurable result.",
    },
    {
        "text": "How do you handle feedback and disagreement with teammates?",
        "category": "Collaboration",
        "idealAnswerNotes": "Empathy, openness, constructive resolution.",
    },
    {
        "text": "How do you prioritise when everything feels urgent?",
        "category": "Behavioral",
        "idealAnswerNotes": "Frameworks, trade-offs, communication.",
    },
    {
        "text": "Where do you want to grow over the next couple of years?",
        "category": "Motivation",
        "idealAnswerNotes": "Self-awareness and alignment with the role.",
    },
)


def fallback_questions(role: str, count: int) -> list[dict]:
    """`count` generic questions, cycling the pool if more are asked for than exist."""
    safe_count = max(1, min(count or 1, MAX_QUESTIONS))
    return [
        {**FALLBACK_POOL[index % len(FALLBACK_POOL)]}
        | {"text": FALLBACK_POOL[index % len(FALLBACK_POOL)]["text"].format(role=role or "this")}
        for index in range(safe_count)
    ]

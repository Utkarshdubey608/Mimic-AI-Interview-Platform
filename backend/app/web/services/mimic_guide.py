"""Mimic Guide — the in-app help assistant. Ports `server/services/mimicGuide.ts`.

Markdown answers from the curated knowledge in `mimic_guide_prompt`, with no tools
and no retrieval. Full history is passed for multi-turn context, and the caller's
role decides which pages the answer links to.

The interesting part is what happens when the model is unavailable. There are three
degraded paths, and they are deliberately different:

* **No key configured at all** — answer from the built-in FAQ. The assistant stays
  useful on a deployment that never had Gemini.
* **The key is broken** — say so plainly. A bad credential is not transient, and
  serving canned answers would make a broken key look like working software while
  it is also silently breaking scoring and question generation.
* **Outage or depleted quota** — answer from the FAQ. This one really is transient.
"""

from __future__ import annotations

import logging
import random
import re

from app.config import Settings
from app.web.services import gemini
from app.web.services.mimic_guide_prompt import (
    CANDIDATE,
    OUT_OF_SCOPE_REFUSAL,
    RECRUITER,
    build_prompt,
)

logger = logging.getLogger("web.mimic_guide")

BROKEN_KEY_REPLY = (
    "I can't reach the AI model right now — the Gemini API key looks invalid, "
    "expired, or missing. Add a valid Gemini API key in **Settings → Gemini** (or "
    "set `GEMINI_API_KEY` on the server), then ask me again. Until then I'll answer "
    "from my built-in notes only."
)

# Keyword-matched fallback answers. Several phrasings per topic so a repeated
# question does not return identical text, which reads as a broken bot.
GUIDE_FAQ: list[tuple[str, list[str]]] = [
    (
        r"session|invite|assign|link",
        [
            "**Creating an interview session:**\n\n1. Go to **Sessions** (your recruiter home).\n2. Create a session from an existing **Template**.\n3. Share the generated **invite link** with your candidate.\n4. When they finish, open the session's **report** to see the score and recommendation.\n\n[Go to Sessions](/sessions)",
            "Interviews are run as **sessions**. From **Sessions**, create one from a template, send the candidate their invite link, then review the report once they're done.\n\n[Go to Sessions](/sessions)",
        ],
    ),
    (
        r"template",
        [
            "**Templates** define how an interview runs — the **track**, the question source (adaptive AI or a fixed **question set**), the rubric KPIs, timing, and voice. Create or duplicate one, then use it when you create a session.\n\n[Manage Templates](/templates)",
        ],
    ),
    (
        r"question set|question-set|questions|rubric|resume|résumé",
        [
            "**Question Sets** are reusable fixed question lists. Build one, drag to reorder, or **generate questions from a résumé**. A template can use a question set or use adaptive AI questions instead.\n\n[Manage Question Sets](/question-sets)",
        ],
    ),
    (
        r"track|chat|chatbot|voice|avatar|timed|type of interview|interview type",
        [
            'Mimic supports four interview **tracks**:\n\n- **Timed Q&A** — typed answers with a per-question countdown.\n- **Chatbot / Conversational** — a typed conversation with adaptive follow-ups.\n- **Voice** — a real-time spoken interview.\n- **Video Avatar** — an AI avatar speaks each question on screen.\n\nPick the track in a **Template**.\n\n[Manage Templates](/templates)',
        ],
    ),
    (
        r"avatar screening|screening|tavus|replica|persona|setup|deepgram|hume|rekognition",
        [
            "**AI Avatar Screening** runs a live AI-avatar video interview and then analyses it. Configure it in **Setup** (pick a replica + persona), run it in the **Interview** room, and review speech, emotion, and facial analytics in **Results**.\n\n[Set up Avatar Screening](/avatar-studio)",
        ],
    ),
    (
        r"result|report|score|analytics|recommendation",
        [
            "**Results:** open a session's **report** from the Sessions list for the recommendation, a KPI/rubric radar, per-question feedback, and PDF export. For trends across all interviews, use **Analytics**.\n\n[View Analytics](/analytics)",
        ],
    ),
    (
        r"face|framing|camera|system check|system-check|mic|microphone",
        [
            "Before a video or avatar interview, the **system check** verifies your microphone and camera. For video/avatar it includes a **face-fit** framing aid that runs in your browser and asks you to centre your face and hold still — it only helps you frame yourself and is not used for scoring.",
        ],
    ),
    (
        r"login|sign in|role|recruiter|candidate|access|permission|iam",
        [
            "**Roles:** sign in at the login page. Your role is set on the server from your verified email — allowed domains/addresses become **recruiters**; everyone else is a **candidate**. Recruiters see the full app; candidates see only their assigned interviews.",
        ],
    ),
    (
        r"key|api key|gemini|setting",
        [
            "**Settings** is where a recruiter enters the **Tavus** key and manages the **Gemini** key (kept server-side), and sees whether Deepgram, Hume, and Rekognition are configured.\n\n[Open Settings](/settings)",
        ],
    ),
]

_GENERAL_ANSWERS = [
    "I can help you navigate Mimic. Ask me how to **create a session**, build a **template** or **question set**, run **AI Avatar Screening**, or read your **results**.",
    'Happy to help! Try: *"How do I create an interview session?"*, *"What interview tracks are there?"*, or *"Where do I see a candidate\'s score?"*',
    "Mimic is an AI Interview Platform. I can walk you through templates, question sets, sessions, the interview tracks, AI Avatar Screening, and results & analytics — what would you like to do?",
]


def canned_answer(question: str, *, pick=random.choice) -> str:
    """The best built-in answer for a question, else a general overview.

    `pick` is injectable so tests can make the choice deterministic without
    monkeypatching the random module.
    """
    lowered = (question or "").lower()
    for pattern, answers in GUIDE_FAQ:
        if re.search(pattern, lowered):
            return pick(answers)
    return pick(_GENERAL_ANSWERS)


def last_user_message(messages: list[dict]) -> str:
    """The most recent user turn — what a fallback answer should address."""
    for message in reversed(messages):
        if message.get("role") == "user":
            return message.get("content") or ""
    return ""


def guide_role(role: str | None) -> str:
    """Map a resolved account role onto the guide's link audience.

    Anything that is not recruiter becomes candidate, matching the Express
    behaviour: the guide should never offer recruiter-only links to someone whose
    role could not be confirmed.
    """
    return RECRUITER if role == RECRUITER else CANDIDATE


async def run(settings: Settings, messages: list[dict], role: str) -> str:
    """Answer one turn. Never raises — the chat must stay usable."""
    question = last_user_message(messages)

    if not await gemini.is_enabled(settings):
        return canned_answer(question)

    contents = gemini.to_contents(messages)
    if not contents:
        return canned_answer(question)

    try:
        text = await gemini.generate_text(
            settings,
            contents=contents,
            system_instruction=build_prompt(guide_role(role)),
        )
    except gemini.GeminiAuthError as exc:
        # Not transient. Saying so beats masking a broken key behind canned answers.
        logger.error("mimic guide: credential failure — %s", exc)
        return BROKEN_KEY_REPLY
    except gemini.GeminiUnavailable as exc:
        logger.warning("mimic guide degraded: %s", exc)
        return canned_answer(question)

    # An empty generation is indistinguishable from a refusal to the user, and the
    # refusal is the safer of the two to show.
    return text or OUT_OF_SCOPE_REFUSAL

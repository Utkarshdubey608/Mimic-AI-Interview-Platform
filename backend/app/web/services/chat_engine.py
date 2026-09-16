"""Driving the conversational interview — the turn generation half of `conversation.ts`.

The chatbot track is a real conversation: the interviewer greets, waits for the
candidate to say they are ready, asks questions one at a time, may probe with a
follow-up, and closes. Gemini decides what to say; **this module decides what is
allowed**, and the difference is the point.

Four server-side clamps, none of which the model can talk its way past:

* It cannot end the interview while primary questions remain.
* It cannot exceed the follow-up budget for a question.
* Its questions are held to one idea and about forty words.
* A closing line offered while questions remain is replaced with a real question.

Everything degrades rather than failing. With no Gemini key, or on any error, the
interview still runs on a fixed script — a candidate who has turned up should be
interviewed.

The other half of the track — timing, state and grouping — is in `conversation.py`.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from app.config import Settings
from app.web.services import conversation, gemini

logger = logging.getLogger("web.chat_engine")

# How much résumé rides in the prompt. Enough to characterise a candidate; the tail is
# usually education and references.
MAX_RESUME_CHARS = 14_000
# Enough to personalise a hello. The full document rides in later turns,
# where the interviewer is actually reasoning about their experience.
GREETING_RESUME_CHARS = 1_500

ANSWER_QUALITIES = ("sufficient", "partial", "weak", "incorrect", "irrelevant", "no_answer")

TURN_SCHEMA = {
    "type": "object",
    "properties": {
        # Ordered BEFORE `action` on purpose: a structured-output model commits to
        # whatever field it fills in first, so asking it to name the quality of the
        # answer before it picks next_question/follow_up is what makes the picking
        # answer a REASON rather than a guess — the same "judge, then decide" shape
        # every real interviewer uses, not a second label bolted onto an unrelated
        # choice. Never sent to the candidate — see `answer_quality` on the stored
        # turn in `_advance_adaptive`, and its absence from `ChatbotTurnView`.
        "answerQuality": {"type": "string", "enum": list(ANSWER_QUALITIES)},
        "acknowledgment": {"type": "string"},
        "message": {"type": "string"},
        "action": {
            "type": "string",
            "enum": ["next_question", "follow_up", "end_interview"],
        },
    },
    "required": ["answerQuality", "message", "action"],
    "propertyOrdering": ["answerQuality", "acknowledgment", "message", "action"],
}

# Questions used when generation is unavailable. Ordinary interview openers, so a
# degraded interview is still a real, scoreable one.
GENERIC_QUESTIONS = (
    "Tell me about a project you’re especially proud of and your specific contribution.",
    "Describe a difficult technical problem you solved recently. How did you approach it?",
    "How do you handle disagreement with a teammate about a technical decision?",
    "What part of your experience is most relevant to this role, and why?",
    "Where do you want to grow over the next couple of years?",
    "Tell me about a time you had to learn something new quickly.",
)

# Always-positive openers, rotated so they do not repeat. Every answer earns one — a
# candidate who gets silence after speaking assumes something broke.
MOTIVATIONS = (
    "Excellent answer!",
    "Great, that's really well explained!",
    "Love that, thank you for sharing!",
    "Nice, that's a strong response!",
    "Awesome, I really appreciate the detail!",
    "Perfect, that paints a clear picture!",
    "Brilliant, thank you for that!",
    "Wonderful, that's really helpful!",
)

TIME_GREETINGS = {
    "morning": "Good morning",
    "afternoon": "Good afternoon",
    "evening": "Good evening",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def greeting_word(time_of_day: str | None) -> str:
    return TIME_GREETINGS.get(time_of_day or "", "Hello")


def readiness_message(time_of_day: str | None, name: str | None) -> str:
    """The opening turn: a welcome that ENDS by asking if they are ready.

    Deliberately not a question — it carries no `questionIndex`, so it is never scored
    and never arms a clock. A candidate should not be answering against a timer before
    they have said they are ready.
    """
    who = f", {name}" if name else ""
    return (
        f"{greeting_word(time_of_day)}{who}! Thanks so much for joining. I'm really "
        "looking forward to our chat. We'll keep this relaxed. I'll ask a few questions, "
        "one at a time, so take your time with each one. Whenever you're set, just let me "
        "know. Are you ready to begin?"
    )


def fallback_first_question(role: str | None) -> str:
    return (
        "Great, let's dive in. To start, tell me a bit about your background and what "
        f"drew you to the {role or 'this'} role."
    )


def generic_question(index: int) -> str:
    return GENERIC_QUESTIONS[index % len(GENERIC_QUESTIONS)]


def fallback_ack(seed: int) -> str:
    return MOTIVATIONS[abs(seed) % len(MOTIVATIONS)]


def clean_ack(text: str) -> str:
    """Tidy an acknowledgment so it joins cleanly to the question after it.

    Strips wrapping quotes and stray markdown, and guarantees terminal punctuation —
    without it the two bubbles read as one run-on sentence.
    """
    stripped = (text or "").replace("*", "").replace("`", "").strip("\"' \n\t")
    cleaned = conversation.humanize_punctuation(stripped)
    if not cleaned:
        return ""
    return cleaned if cleaned[-1] in ".!?" else f"{cleaned}."


def candidate_name(session: dict) -> str | None:
    """The candidate's name, if it is a real one.

    "Candidate" is the placeholder written at creation, and an interviewer greeting
    someone as "Candidate" is worse than not using a name at all.
    """
    name = ((session.get("candidate") or {}).get("name") or "").strip()
    return name if name and name != "Candidate" else None


# ── transcript building ───────────────────────────────────────────────────────


def append_interviewer(
    session: dict,
    content: str,
    turn_type: str,
    question_index: int | None = None,
    is_follow_up: bool = False,
    *,
    answer_quality: str | None = None,
) -> dict:
    """Add an interviewer turn.

    The clock is deliberately NOT armed here. It starts when the client reports the
    question presented, so the "Thinking…" beat and any acknowledgment bubble do not
    come out of the candidate's answer time.

    `answer_quality` — the model's judgment of the answer THIS turn is responding
    to (see `ANSWER_QUALITIES`) — is stored on the turn but deliberately has no
    entry in `ChatbotTurnView`/`compute_chatbot_state`'s allow-list, so it never
    reaches the candidate. It exists for future recruiter-facing debugging/scoring,
    not for anything shown live.
    """
    turn = {
        "id": str(uuid.uuid4()),
        "role": "interviewer",
        "content": content,
        "turnType": turn_type,
        "questionIndex": question_index,
        "isFollowUp": is_follow_up,
        "createdAt": _now(),
    }
    if answer_quality is not None:
        turn["answerQuality"] = answer_quality
    session.setdefault("transcript", []).append(turn)
    return turn


def append_ack_then_question(
    session: dict,
    ack: str,
    question: str,
    question_index: int,
    is_follow_up: bool,
    *,
    answer_quality: str | None = None,
) -> None:
    """The acknowledgment as its own bubble, then the question.

    Two turns rather than one string so the client reveals them separately, each behind
    its own beat — which reads like a person responding and then thinking, instead of a
    wall of text appearing at once. The acknowledgment carries no `questionIndex`, so it
    is never scored and never times anything.
    """
    if (ack or "").strip():
        append_interviewer(session, ack.strip(), "acknowledgment", answer_quality=answer_quality)
    append_interviewer(
        session,
        question,
        "follow_up" if is_follow_up else "question",
        question_index,
        is_follow_up,
        answer_quality=answer_quality,
    )


def end_conversation(session: dict, closing: str | None = None) -> None:
    if (closing or "").strip():
        session.setdefault("transcript", []).append(
            {
                "id": str(uuid.uuid4()),
                "role": "interviewer",
                "content": closing.strip(),
                "turnType": "wrap_up",
                "createdAt": _now(),
            }
        )
    session["status"] = "completed"
    session["completedAt"] = _now()


# ── the model turn ────────────────────────────────────────────────────────────


def build_system_instruction(session: dict, template: dict, *, phase: str) -> str:
    """The interviewer's instructions for this turn.

    `phase` is one of `greeting`, `first_question` or `normal`, and it changes the
    instruction substantially — the opening must NOT ask an interview question, and the
    turn after the readiness reply must not treat "yes I'm ready" as an answer worth
    acknowledging.
    """
    adaptive = template.get("adaptive") or {}
    role = adaptive.get("role") or template.get("role") or "this"
    seniority = f"{adaptive['seniority']} " if adaptive.get("seniority") else ""
    language = f", conducted in {adaptive['language']}" if adaptive.get("language") else ""
    tone = adaptive.get("interviewerTone") or "a warm, personable senior"

    style = adaptive.get("style") or "mix"
    planned = adaptive.get("numberOfQuestions") or 5
    technical = adaptive.get("technicalCount")
    non_technical = adaptive.get("nonTechnicalCount")
    if style == "technical":
        style_line = (
            "Ask ONLY technical questions, grounded in the specific technologies, tools, "
            "and projects in the résumé."
        )
    elif style == "non_technical":
        style_line = (
            "Ask ONLY non-technical questions (behavioral, situational, culture-fit), "
            "grounded in the candidate’s experience."
        )
    else:
        style_line = (
            f"Ask a MIX of technical and non-technical questions (about "
            f"{technical if technical is not None else -(-planned // 2)} technical and "
            f"{non_technical if non_technical is not None else planned // 2} "
            "non-technical across the whole interview)."
        )

    lines = [
        f"You are {tone} interviewer running a live {adaptive.get('difficulty', 'mixed')} "
        f"interview for a {seniority}{role} role{language}.",
        "Speak naturally, the way a friendly human would: use contractions, vary your "
        "phrasing, and sound genuinely engaged and encouraging. Never sound robotic, "
        "templated, corporate, or repetitive. Keep a natural human rhythm; don't "
        "over-explain or lecture.",
        # These turns are often read aloud by the voice and avatar tracks.
        'Write with plain punctuation only. Do NOT use em dashes or en dashes ("—" or '
        '"–") anywhere; use commas, periods, or the word "and" instead. Dash-heavy '
        "writing reads as AI-generated.",
        "You have the candidate's résumé and the conversation so far.",
        style_line,
    ]

    if adaptive.get("focusTopics"):
        lines.append(
            f"Emphasize these topics when relevant: {', '.join(adaptive['focusTopics'])}."
        )

    lines += [
        "Ask EXACTLY ONE question per message — never compound or multi-part. Keep each "
        "question SHORT: at most 3 lines (~40 words), conversational, and grounded in the "
        "résumé and role.",
        # A candidate who knows what is coming prepares for it instead of answering.
        "Never reveal upcoming questions, the plan, or how many remain.",
    ]

    name = candidate_name(session)
    if phase == "greeting":
        lines.append(
            "This is your OPENING message — do NOT ask any interview question yet. Give a "
            f'short "{greeting_word(session.get("greetingTimeOfDay"))}" greeting, warmly '
            f"welcome the candidate{f' by name ({name})' if name else ''}, add a one-line "
            "note to put them at ease about how this will go, and then ASK WHETHER THEY'RE "
            'READY TO BEGIN. Put all of that in "message" and leave "acknowledgment" '
            'empty. End with that readiness question. Use action "next_question".'
        )
    elif phase == "first_question":
        lines.append(
            "The candidate has just confirmed they're ready. Do NOT treat their reply as an "
            'interview answer and do NOT acknowledge it like one, so leave "acknowledgment" '
            "empty. If they seemed hesitant, reassure them warmly in one short line. Then "
            'ask your FIRST interview question (in "message"), grounded in the résumé and '
            'role. Use action "next_question".'
        )
    else:
        lines += [
            "First judge the candidate's last answer AGAINST THE QUESTION THAT WAS JUST "
            'ASKED and put your judgment in "answerQuality":\n'
            '  "sufficient" — correctly and adequately addresses the question. A SHORT '
            'answer can be sufficient ("Resource not found" fully answers "what does '
            'HTTP 404 mean?") — judge substance, not length or keyword matches. A LONG '
            "answer with little real content is NOT sufficient just because it is long.\n"
            '  "partial" — shows real understanding but misses a significant piece of '
            "what the question asked for.\n"
            '  "weak" — vague, generic, or too thin to tell whether the candidate '
            "actually understands the concept.\n"
            '  "incorrect" — confidently states something factually wrong.\n'
            '  "irrelevant" — does not address the question at all (off-topic, or '
            "answers a different question than the one asked).\n"
            '  "no_answer" — empty, "I don\'t know", or equivalent.\n'
            "Base this ONLY on what the candidate actually wrote — never assume, infer, "
            "or invent content they did not say, and never treat their résumé as if it "
            "were part of their answer.",
            'Then fill "acknowledgment" with ONE short, genuine sentence reacting to '
            "what they said (specific to their answer, not generic), and put ONLY the "
            'next question in "message". Let the TONE of the acknowledgment follow '
            "your judgment honestly, the way a real interviewer sounds, not a scripted "
            'cheerleader: warm for "sufficient", measured/encouraging for "partial" or '
            '"weak", and calm and neutral for "incorrect"/"irrelevant"/"no_answer" — '
            'never enthusiastic praise for an answer that was not sufficient, and never '
            'critical, dismissive, or a flat "that\'s wrong" either (see the CASES '
            "below). Vary the phrasing every time; never reuse the same sentence twice. "
            'Never leave the acknowledgment empty on an answer, and never put it inside '
            '"message".',
            "Then decide the action:\n"
            '  If "answerQuality" is "sufficient" — normally move straight to the next '
            "planned question. Do not manufacture a follow-up just because one is "
            "allowed; probing an answer that already showed understanding wastes the "
            "candidate's time and reads as suspicious of a correct answer.\n"
            '  If "partial" or "weak" — a follow-up is usually the right call. Make it '
            "a SPECIFIC probe into the exact piece that was missing or vague (not a "
            'generic "can you elaborate?"), and keep it anchored to the CURRENT '
            "question's topic — it is a deeper look at the same thing, never a new, "
            "unrelated question.\n"
            '  If "incorrect" — give ONE gentle opening to reconsider (e.g. ask them to '
            "look at it from another angle) rather than stating they are wrong. If they "
            "were already given that chance on this same question, move on.\n"
            '  If "irrelevant" — redirect back to the actual question once. If the '
            "redirect is ALSO not answered, move on rather than repeating it again.\n"
            '  If "no_answer" — do not press. Move on straight away.',
            _budget_line(session, template),
        ]
        if not adaptive.get("allowFollowUps"):
            lines.append(
                'Follow-ups are DISABLED — always use "next_question" or "end_interview".'
            )

    return "\n".join(line for line in lines if line)


def _budget_line(session: dict, template: dict) -> str:
    """What the model is told about its remaining budget.

    Stated explicitly because a model that does not know how many questions remain either
    rushes to a close or never stops. The clamps below enforce it regardless.
    """
    adaptive = template.get("adaptive") or {}
    follow_ups_left = max(
        0,
        (adaptive.get("maxFollowUpsPerQuestion") or 0)
        - (session.get("followUpsThisQuestion") or 0),
    )
    planned = session.get("plannedQuestionCount") or adaptive.get("numberOfQuestions") or 5
    primaries_left = max(0, planned - ((session.get("currentIndex") or 0) + 1))

    return (
        f"Budget — follow-ups left for the current question: {follow_ups_left}; primary "
        f"questions left after this one: {primaries_left}. If follow-ups left is 0, do not "
        'follow up. You MUST NOT use "end_interview" while any primary questions remain — '
        "keep going until primary questions left reaches 0, then close warmly with "
        '"end_interview".'
    )


def build_contents(session: dict, *, phase: str) -> list[dict]:
    """The conversation as Gemini sees it.

    The full transcript is replayed rather than summarised, so the interviewer can
    reference what the candidate actually said — which is the difference between a
    follow-up that probes and one that repeats the question.
    """
    resume = (session.get("resumeText") or "")[:MAX_RESUME_CHARS]

    if phase == "greeting":
        # A greeting says hello, uses their name, and asks if they are ready. It
        # does not need the whole document, and this is the call a candidate
        # waits on with NOTHING on screen yet — the worst place in the product to
        # spend input tokens. The avatar path already uses ~1500 characters of
        # background for the same "sound informed" job.
        return [
            {
                "role": "user",
                "parts": [
                    {
                        "text": f'CANDIDATE RÉSUMÉ (brief context):\n"""{resume[:GREETING_RESUME_CHARS]}"""'
                        "\n\nGreet the candidate and ask if they're ready to begin."
                    }
                ],
            }
        ]

    contents = [
        {"role": "user", "parts": [{"text": f'CANDIDATE RÉSUMÉ (context):\n"""{resume}"""'}]}
    ]
    for turn in session.get("transcript") or []:
        contents.append(
            {
                "role": "model" if turn.get("role") == "interviewer" else "user",
                "parts": [{"text": turn.get("content") or ""}],
            }
        )
    return contents


def phase_of(session: dict) -> str:
    transcript = session.get("transcript") or []
    if not transcript:
        return "greeting"
    asked = any(
        turn.get("role") == "interviewer"
        and isinstance(turn.get("questionIndex"), int)
        and not isinstance(turn.get("questionIndex"), bool)
        for turn in transcript
    )
    return "normal" if asked else "first_question"


def normalise_decision(raw: object) -> dict:
    """The model's turn, coerced into something safe to act on."""
    data = raw if isinstance(raw, dict) else {}
    message = (data.get("message") or "").strip()
    action = data.get("action")
    answer_quality = data.get("answerQuality")

    return {
        # Unknown/missing degrades to "partial" rather than crashing or silently
        # dropping the field — a middling default is the safest wrong guess: it
        # neither forces a needless follow-up (as "weak" would bias toward) nor
        # skips one a genuinely thin answer needed (as "sufficient" would).
        "answerQuality": answer_quality if answer_quality in ANSWER_QUALITIES else "partial",
        "acknowledgment": clean_ack(data.get("acknowledgment") or ""),
        # A blank message would appear as an empty bubble the candidate cannot answer.
        "message": conversation.humanize_punctuation(
            message or "Thanks, could you tell me a little more about that?"
        ),
        "action": action
        if action in ("next_question", "follow_up", "end_interview")
        else "next_question",
    }


async def generate_turn(settings: Settings, session: dict, template: dict) -> dict:
    """One interviewer turn from the model. Raises if it cannot be produced.

    The brevity guard runs here: an over-long or compound question is regenerated once
    with an explicit instruction, then trimmed as a last resort. Only actual questions
    are policed — a greeting legitimately carries a welcome plus a readiness prompt, and
    a closing needs no brevity.
    """
    phase = phase_of(session)
    instruction = build_system_instruction(session, template, phase=phase)
    contents = build_contents(session, phase=phase)

    async def call(extra: str | None = None) -> dict:
        text = await gemini.generate_text(
            settings,
            contents=contents,
            system_instruction=f"{instruction}\n{extra}" if extra else instruction,
            response_mime_type="application/json",
            response_schema=TURN_SCHEMA,
            # The candidate is watching this one happen. Question generation was
            # given the same treatment; this call was missed, and it runs on
            # EVERY turn.
            #
            # The tail matters more than the mean: a measured chat/begin took
            # 19.5s while the same shape of call averages ~1.5s. Gemini's latency
            # is variable and thinking widens the spread — on the résumé prompt,
            # default thinking ran 7.5-12.9s against 2.9-4.4s at budget zero.
            # Cutting the tail is what stops a candidate staring at a dead screen.
            thinking_budget=0,
        )
        return normalise_decision(json.loads(text or "{}"))

    decision = await call()

    if phase != "greeting" and decision["action"] != "end_interview" and conversation.too_long(
        decision["message"]
    ):
        try:
            decision = await call(
                'IMPORTANT: your previous "message" was too long or multi-part. Reply again '
                'with the acknowledgment in "acknowledgment" and EXACTLY ONE single-focus '
                'question of at most 40 words in "message". No compound questions.'
            )
        except Exception as exc:  # noqa: BLE001 - keep the first decision and trim it
            logger.info("brevity regeneration failed: %s", exc)
        if conversation.too_long(decision["message"]):
            decision["message"] = conversation.trim_to_single_question(decision["message"])

    return decision


# ── the public engine ─────────────────────────────────────────────────────────


async def begin_conversation(
    settings: Settings,
    session: dict,
    template: dict,
    *,
    time_of_day: str | None = None,
    fixed_questions: list[dict] | None = None,
) -> None:
    """Start a conversational interview and produce its opening turn.

    The first turn is a greeting that ENDS by asking if the candidate is ready — not the
    first question. It carries no `questionIndex`, so it is never scored and never arms a
    clock, and the real Q&A begins only once they reply.
    """
    session["transcript"] = []
    session["currentIndex"] = 0
    session["followUpsThisQuestion"] = 0
    session["mode"] = template.get("mode") or "conversational"
    session["plannedQuestionCount"] = conversation.planned_count_for(
        template, fixed_question_count=len(fixed_questions or [])
    )
    if time_of_day:
        session["greetingTimeOfDay"] = time_of_day
    session["status"] = "in_progress"
    session["startedAt"] = _now()

    name = candidate_name(session)
    adaptive = template.get("questionSource") == "adaptive"
    fixed = template.get("questionSource") == "fixed"

    if adaptive and not session.get("resumeText"):
        raise ValueError("A résumé is required before starting this interview")
    # Caught before the greeting is ever shown, not after the candidate says "ready" —
    # a fixed-source template with no question set attached used to greet the
    # candidate and then end the interview the instant they replied, which read as
    # the interview auto-submitting itself. `TemplateEditorPage` already warns a
    # recruiter "sessions can't start until you pick one"; this is what makes that
    # promise true.
    if fixed and not fixed_questions:
        raise ValueError("This interview has no questions configured. Contact your recruiter.")

    message = readiness_message(session.get("greetingTimeOfDay"), name)
    if adaptive and await gemini.is_enabled(settings):
        try:
            message = (await generate_turn(settings, session, template))["message"]
        except Exception as exc:  # noqa: BLE001 - the static greeting is a fine opening
            logger.warning("adaptive greeting failed, using the static one: %s", exc)

    append_interviewer(session, message, "greeting")


async def submit_chat_answer(
    settings: Settings,
    session: dict,
    template: dict,
    answer_text: str,
    *,
    auto_advanced: bool = False,
    fixed_questions: list[dict] | None = None,
) -> None:
    """Record the candidate's answer and produce the next turn."""
    transcript = session.setdefault("transcript", [])
    last_interviewer = next(
        (t for t in reversed(transcript) if t.get("role") == "interviewer"), None
    )

    # The readiness gate: the current turn is the opening greeting, which has no
    # question index. The candidate's "yes, ready" is not a scored answer, so it is
    # recorded without one — otherwise it would be graded as their answer to question 0.
    is_readiness_reply = last_interviewer is not None and not isinstance(
        last_interviewer.get("questionIndex"), int
    )

    transcript.append(
        {
            "id": str(uuid.uuid4()),
            "role": "candidate",
            "content": (answer_text or "").strip(),
            "questionIndex": None
            if is_readiness_reply
            else (last_interviewer or {}).get("questionIndex", session.get("currentIndex")),
            "isFollowUp": None if is_readiness_reply else (last_interviewer or {}).get("isFollowUp"),
            "autoAdvanced": True if auto_advanced else None,
            "createdAt": _now(),
        }
    )

    if last_interviewer is not None:
        last_interviewer["submittedAt"] = _now()
        if auto_advanced:
            last_interviewer["autoAdvanced"] = True

    if is_readiness_reply:
        await _ask_first_question(settings, session, template, fixed_questions)
        return

    planned = session.get("plannedQuestionCount") or conversation.planned_count_for(
        template, fixed_question_count=len(fixed_questions or [])
    )
    at_last_primary = (session.get("currentIndex") or 0) >= planned - 1

    if template.get("questionSource") == "fixed":
        await _advance_fixed(
            settings, session, template, fixed_questions or [], answer_text, last_interviewer
        )
        return

    await _advance_adaptive(settings, session, template, at_last_primary)


async def _ask_first_question(
    settings: Settings, session: dict, template: dict, fixed_questions: list[dict] | None
) -> None:
    """The first real question, asked once the candidate confirms they are ready."""
    session["currentIndex"] = 0
    session["followUpsThisQuestion"] = 0

    if template.get("questionSource") == "fixed":
        questions = fixed_questions or []
        if not questions:
            end_conversation(session, "Thanks for your time. We’ll be in touch!")
            return
        append_interviewer(session, questions[0].get("text") or "", "question", 0)
        return

    message = fallback_first_question(template.get("role"))
    if await gemini.is_enabled(settings):
        try:
            message = (await generate_turn(settings, session, template))["message"]
        except Exception as exc:  # noqa: BLE001 - a generic opener still starts the interview
            logger.warning("first question generation failed: %s", exc)

    append_interviewer(session, message, "question", 0)


async def _advance_fixed(
    settings: Settings,
    session: dict,
    template: dict,
    questions: list[dict],
    answer_text: str,
    last_interviewer: dict | None,
) -> None:
    """Walk a fixed question list. Deterministic, with no follow-ups."""
    next_index = (session.get("currentIndex") or 0) + 1
    ack = fallback_ack(len(session.get("transcript") or []))

    if next_index >= len(questions):
        # The "all done" screen replaces the transcript, so a separate acknowledgment
        # bubble would never be seen. Fold it into the closing line instead.
        end_conversation(session, f"{ack} That’s all the questions I had. Thank you for your time!")
        return

    session["currentIndex"] = next_index
    session["followUpsThisQuestion"] = 0
    append_ack_then_question(
        session, ack, questions[next_index].get("text") or "", next_index, False
    )


async def _advance_adaptive(
    settings: Settings, session: dict, template: dict, at_last_primary: bool
) -> None:
    """Let the model choose the next move, then clamp it to what is allowed."""
    adaptive = template.get("adaptive") or {}
    transcript_length = len(session.get("transcript") or [])

    fallback = {
        # Gemini being unreachable says nothing about the answer's quality — this
        # is a transport fallback, not a judgment, so it stays "partial": the
        # neutral non-signal, never stored as if the model actually looked.
        "answerQuality": "partial",
        "acknowledgment": "" if at_last_primary else fallback_ack(transcript_length),
        "message": "" if at_last_primary else generic_question((session.get("currentIndex") or 0) + 1),
        "action": "end_interview" if at_last_primary else "next_question",
    }

    decision = fallback
    if await gemini.is_enabled(settings):
        try:
            decision = await generate_turn(settings, session, template)
        except Exception as exc:  # noqa: BLE001 - the interview continues on the script
            logger.warning("adaptive turn failed, using the fallback: %s", exc)

    action = decision["action"]

    # ── the clamps ────────────────────────────────────────────────────────────
    # A model that decides to wrap up early would cut an interview short and score the
    # candidate on fewer questions than everyone else in the batch.
    if action == "end_interview" and not at_last_primary:
        action = "next_question"

    budget_left = bool(adaptive.get("allowFollowUps")) and (
        session.get("followUpsThisQuestion") or 0
    ) < (adaptive.get("maxFollowUpsPerQuestion") or 0)
    if action == "follow_up" and not budget_left:
        action = "next_question"

    if action == "end_interview":
        end_conversation(session, decision["message"] or "Thank you, that concludes our interview.")
        return

    ack = (decision["acknowledgment"] or "").strip() or fallback_ack(transcript_length)

    if action == "follow_up":
        session["followUpsThisQuestion"] = (session.get("followUpsThisQuestion") or 0) + 1
        append_ack_then_question(
            session,
            ack,
            decision["message"] or "Could you go a little deeper on that?",
            session.get("currentIndex") or 0,
            True,
            answer_quality=decision["answerQuality"],
        )
        return

    if at_last_primary:
        end_conversation(session, "Thank you, that concludes our interview.")
        return

    next_index = (session.get("currentIndex") or 0) + 1
    session["currentIndex"] = next_index
    session["followUpsThisQuestion"] = 0

    # A model that offers a closing line while questions remain has misread the budget.
    # Substituting a real question keeps the interview the length the candidate was told.
    message = decision["message"]
    if not message or looks_like_closing(message):
        message = generic_question(next_index)

    append_ack_then_question(
        session, ack, message, next_index, False, answer_quality=decision["answerQuality"]
    )


CLOSING_MARKERS = ("thank you", "concludes", "all the questions", "that's all", "that’s all")


def looks_like_closing(message: str) -> bool:
    lowered = (message or "").lower()
    return any(marker in lowered for marker in CLOSING_MARKERS)

"""The conversational track — a port of `server/services/conversation.ts`.

Everything here is pure: transcript grouping, the per-turn timing engine, and the
client-safe state view. The Gemini-driven turn GENERATION (`beginConversation`,
`submitChatAnswer`, `generateAdaptiveTurn`) lands with the chat routes that call it.

The timing model differs from the fixed-slot one in `timing.py` in a way that matters.
There, every question has the same prep and answer window, known before the interview
starts. Here the interview is a conversation: turns arrive one at a time, some are
questions and some are not, and **the clock is armed when the CLIENT presents the
question**, not when the server appends it. That is what stops a "Thinking…" indicator
and a spoken acknowledgment from eating into a candidate's answer time.

Untimed turns — the greeting, the readiness check, the wrap-up — carry no clock at all.
Running one would put a countdown on "Are you ready to begin?".
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from app.web.services.timing import to_iso, to_ms


def primary_question_groups(session: dict) -> list[dict]:
    """The interview's primary questions, each with everything the candidate said to it.

    Grouped by `questionIndex`, sorted by it, with every answer for a question joined in
    the order it was given — a follow-up's answer belongs to the question that prompted
    it, so it is folded in rather than counted separately.

    Two details that matter:

    * A candidate turn with no `questionIndex` is attributed to the LAST question the
      interviewer asked. Voice transcripts arrive that way (the client stamps turns at
      finalise time, without indices), and dropping those turns would silently score a
      spoken interview as unanswered.
    * A question the candidate never answered still appears, with an empty answer. Its
      absence would make the report look shorter than the interview was, hiding the fact
      that a question went unanswered.
    """
    groups: dict[int, dict] = {}
    last_index: int | None = None

    for turn in session.get("transcript") or []:
        role = turn.get("role")
        index = turn.get("questionIndex")
        has_index = isinstance(index, int) and not isinstance(index, bool)

        if role == "interviewer":
            if not has_index:
                # An interviewer turn with no index is a greeting, an acknowledgment or a
                # wrap-up. It is not a question, so it starts no group and does not
                # become the target for the answers that follow.
                continue
            last_index = index
            if index not in groups:
                groups[index] = {"question": turn.get("content") or "", "answers": [], "autoAdvanced": False}

        elif role == "candidate":
            target = index if has_index else last_index
            if target is None:
                # Nothing has been asked yet. A candidate turn here has no question to
                # belong to, and inventing one would misattribute it.
                continue
            group = groups.setdefault(
                target, {"question": "", "answers": [], "autoAdvanced": False}
            )
            content = (turn.get("content") or "").strip()
            if content:
                group["answers"].append(content)
            if turn.get("autoAdvanced"):
                # Records that the candidate ran out of time here rather than choosing to
                # stop, which the recruiter's view distinguishes.
                group["autoAdvanced"] = True

    return [
        {
            "index": index,
            "question": group["question"],
            # Blank-line joined: the parts were separate utterances, and running them
            # together would read as one rambling sentence to a scorer.
            "answer": "\n\n".join(group["answers"]),
            "autoAdvanced": group["autoAdvanced"],
        }
        for index, group in sorted(groups.items())
    ]


def has_any_answer(session: dict) -> bool:
    """Did the candidate say anything at all?

    Checked two ways because the two tracks record differently: the grouped view covers
    a conversation with indices, and the raw scan catches a transcript whose turns carry
    none. A false negative here would produce a "not evaluated" report for an interview
    that really happened.
    """
    if any(group["answer"].strip() for group in primary_question_groups(session)):
        return True
    return any(
        (turn.get("content") or "").strip()
        for turn in session.get("transcript") or []
        if turn.get("role") == "candidate"
    )


# ── the brevity guard ─────────────────────────────────────────────────────────
#
# An adaptive interviewer left unconstrained produces long, multi-part questions —
# "Tell me about X, and how did you Y, and why Z?" — which a candidate cannot answer
# well and which are unbearable when read aloud by the voice and avatar tracks.

# The whole message: a short acknowledgment plus one question of about forty words.
QUESTION_WORD_CAP = 55


def count_words(text: str) -> int:
    return len((text or "").split())


def is_multi_part(text: str) -> bool:
    """More than one question mark reads as a compound question."""
    return (text or "").count("?") > 1


def too_long(text: str) -> bool:
    return count_words(text) > QUESTION_WORD_CAP or is_multi_part(text)


def trim_to_single_question(message: str) -> str:
    """Last-resort trim when regeneration still over-runs.

    Cuts at the first question mark, so what survives is one askable question rather
    than a truncated ramble. With no question mark at all, forty words and an ellipsis —
    visibly incomplete, which is better than a sentence that stops mid-clause and reads
    as a bug.
    """
    clean = (message or "").strip()
    mark = clean.find("?")
    if mark != -1:
        return clean[: mark + 1].strip()

    words = clean.split()
    if len(words) > 40:
        return re.sub(r"[,;:]$", "", " ".join(words[:40])) + "…"
    return clean


def humanize_punctuation(text: str) -> str:
    """Replace em/en dashes with commas.

    A heavy dash style is the clearest tell that a machine wrote something, and these
    questions are read aloud. Ordinary hyphens inside words (follow-up, real-time) are
    left alone.
    """
    value = re.sub(r"\s*[—–]\s*|\s+-\s+", ", ", text or "")
    value = re.sub(r",\s*,", ",", value)
    value = re.sub(r",\s*([.!?])", r"\1", value)
    return re.sub(r"\s{2,}", " ", value).strip()


# ── timing configuration ──────────────────────────────────────────────────────


def is_timed(template: dict) -> bool:
    """The legacy timed mode: fixed thinking and answer windows per question."""
    return template.get("mode") == "timed" and bool(template.get("conversationTiming"))


def effective_chatbot_timer(template: dict) -> dict | None:
    """The per-question timer overlay for a template, if it has one.

    An explicit config always wins. Failing that, a CHAT-track template taken AS a
    chatbot session inherits the fixed-slot timing — the candidate can switch tracks on
    the entry screen, and without this the recruiter's per-question answer limit would
    silently stop applying the moment they did.
    """
    if template.get("chatbotTimer"):
        return template["chatbotTimer"]
    if template.get("track") != "chat":
        return None

    timing = template.get("timing") or {}
    return {
        "enabled": True,
        "perQuestionSeconds": timing.get("answerSeconds"),
        "timeFollowUps": True,
        "includeThinkingPhase": False,
        "warningThresholdSeconds": timing.get("warningThresholdSeconds"),
        "allowEarlySubmit": timing.get("allowEarlySubmit"),
        "autoSubmitOnExpiry": True,
    }


def timer_enabled(template: dict) -> bool:
    """Does this interview time any turn at all? Drives the client's timer machinery."""
    timer = effective_chatbot_timer(template)
    return bool(timer and timer.get("enabled")) or is_timed(template)


def is_question_turn(turn: dict) -> bool:
    """Only questions and follow-ups are timed.

    The fallback reads `questionIndex` for turns written before `turnType` existed: any
    turn tied to a primary question was a question.
    """
    turn_type = turn.get("turnType")
    if turn_type:
        return turn_type in ("question", "follow_up")
    index = turn.get("questionIndex")
    return isinstance(index, int) and not isinstance(index, bool)


def _is_follow_up(turn: dict) -> bool:
    if turn.get("turnType"):
        return turn["turnType"] == "follow_up"
    return bool(turn.get("isFollowUp"))


def turn_timing(
    template: dict, turn: dict, *, fixed_question_ids: list[str] | None = None
) -> dict | None:
    """The answering window for one interviewer turn, or None when it is untimed.

    None for a greeting, a readiness check or a wrap-up — putting a countdown on "Are
    you ready to begin?" would rush a candidate before the interview has started.

    `fixed_question_ids` is injected rather than looked up so this stays pure; it is only
    needed for the per-question overrides a recruiter can set on a fixed question set.
    """
    if not timer_enabled(template) or not is_question_turn(turn):
        return None

    follow_up = _is_follow_up(turn)
    timer = effective_chatbot_timer(template)

    if timer and timer.get("enabled"):
        # A recruiter who timed the questions but not the follow-ups meant the probing
        # to be unhurried.
        if follow_up and not timer.get("timeFollowUps"):
            return None

        override = None
        index = turn.get("questionIndex")
        if (
            template.get("questionSource") == "fixed"
            and isinstance(index, int)
            and not isinstance(index, bool)
            and fixed_question_ids
            and 0 <= index < len(fixed_question_ids)
        ):
            override = (timer.get("perQuestionOverrides") or {}).get(
                fixed_question_ids[index]
            )

        answer_seconds = override
        if answer_seconds is None:
            answer_seconds = (
                timer.get("followUpSeconds") or timer.get("perQuestionSeconds")
                if follow_up
                else timer.get("perQuestionSeconds")
            )

        return {
            "thinkingSeconds": timer.get("thinkingSeconds") or 0
            if timer.get("includeThinkingPhase")
            else 0,
            "answerSeconds": answer_seconds or 0,
            "warningThresholdSeconds": timer.get("warningThresholdSeconds") or 0,
            "allowSkipThinking": bool(timer.get("includeThinkingPhase")),
            "allowEarlySubmit": timer.get("allowEarlySubmit", True),
            "autoSubmitOnExpiry": bool(timer.get("autoSubmitOnExpiry")),
        }

    # Legacy timed mode.
    legacy = template.get("conversationTiming") or {}
    return {
        "thinkingSeconds": legacy.get("thinkingSeconds") or 0,
        "answerSeconds": legacy.get("perQuestionSeconds") or 0,
        "warningThresholdSeconds": legacy.get("warningThresholdSeconds") or 0,
        "allowSkipThinking": bool(legacy.get("allowSkipThinking")),
        "allowEarlySubmit": legacy.get("allowEarlySubmit", True),
        # Always true here: the legacy mode has no opt-out, and a window that expired
        # without submitting would strand the interview.
        "autoSubmitOnExpiry": True,
    }


def planned_count_for(template: dict, *, fixed_question_count: int | None = None) -> int:
    """How many questions this interview intends to ask.

    Shown as the progress denominator from the first turn, so the candidate knows the
    length of what they have agreed to before it starts.
    """
    if template.get("questionSource") == "fixed":
        return fixed_question_count or 0
    adaptive = template.get("adaptive") or {}
    timing = template.get("timing") or {}
    return adaptive.get("numberOfQuestions") or timing.get("numberOfQuestions") or 5


# ── the turn clock ────────────────────────────────────────────────────────────


def current_interviewer_turn(session: dict) -> dict | None:
    """The interviewer turn awaiting an answer — the last one not yet submitted."""
    for turn in reversed(session.get("transcript") or []):
        if turn.get("role") == "interviewer" and not turn.get("submittedAt"):
            return turn
    return None


def reveal_timed_turn(
    session: dict,
    template: dict,
    at_ms: int | None = None,
    *,
    fixed_question_ids: list[str] | None = None,
) -> bool:
    """Arm the clock for the current turn, when the client says it has presented it.

    This is the piece that makes conversational timing fair. The server appends a turn
    the moment it is generated, but the client shows a "Thinking…" indicator and may
    speak an acknowledgment first — so the clock starts on the `question_presented`
    event instead, and none of that preamble comes out of the candidate's answer time.

    Idempotent: only the first call arms anything, so a client that reports the event
    twice cannot restart a running clock.
    """
    if session.get("status") != "in_progress":
        return False

    turn = current_interviewer_turn(session)
    if turn is None:
        return False

    timing = turn_timing(template, turn, fixed_question_ids=fixed_question_ids)
    if timing is None:
        return False
    if turn.get("thinkingStartedAt") or turn.get("answerStartedAt"):
        return False

    stamp = to_iso(at_ms if at_ms is not None else _now_ms())
    if timing["thinkingSeconds"] > 0:
        turn["thinkingStartedAt"] = stamp
    else:
        turn["answerStartedAt"] = stamp
    return True


def advance_chatbot_timing(
    session: dict,
    template: dict,
    at_ms: int | None = None,
    *,
    fixed_question_ids: list[str] | None = None,
) -> str:
    """Progress elapsed phases. Returns `answer_expired` when the caller must submit.

    The thinking→answer transition happens here and is stamped at the DEADLINE, so a
    session that went unread does not charge the wait against the answer window.

    Returning a signal rather than submitting directly keeps this pure: auto-submitting
    means writing the draft as an answer and generating the next turn, which is the
    route's job.
    """
    if session.get("status") != "in_progress":
        return "none"

    turn = current_interviewer_turn(session)
    if turn is None:
        return "none"

    timing = turn_timing(template, turn, fixed_question_ids=fixed_question_ids)
    if timing is None:
        return "none"

    at_ms = at_ms if at_ms is not None else _now_ms()

    thinking_started = to_ms(turn.get("thinkingStartedAt"))
    if thinking_started is not None and not turn.get("answerStartedAt"):
        deadline = thinking_started + timing["thinkingSeconds"] * 1000
        if at_ms >= deadline:
            turn["answerStartedAt"] = to_iso(deadline)
        else:
            return "none"

    answer_started = to_ms(turn.get("answerStartedAt"))
    if answer_started is not None:
        deadline = answer_started + timing["answerSeconds"] * 1000
        if at_ms >= deadline:
            return "answer_expired" if timing["autoSubmitOnExpiry"] else "none"

    return "none"


def skip_thinking(
    session: dict, template: dict, *, fixed_question_ids: list[str] | None = None
) -> bool:
    """End the thinking phase early and start answering now.

    Refused unless the turn is genuinely in its thinking phase: a candidate who has
    already started answering must not be able to restart their own clock.
    """
    turn = current_interviewer_turn(session)
    if turn is None:
        return False

    timing = turn_timing(template, turn, fixed_question_ids=fixed_question_ids)
    if timing is None or not timing["allowSkipThinking"]:
        return False
    if turn.get("submittedAt") or turn.get("answerStartedAt") or not turn.get("thinkingStartedAt"):
        return False

    turn["answerStartedAt"] = to_iso(_now_ms())
    return True


# ── the client-safe state ─────────────────────────────────────────────────────


def compute_chatbot_state(
    session: dict,
    template: dict,
    at_ms: int | None = None,
    *,
    fixed_question_count: int | None = None,
    fixed_question_ids: list[str] | None = None,
) -> dict:
    """What the candidate's client is allowed to see.

    The transcript is projected field by field rather than passed through: stored turns
    carry `draft`, `thinkingStartedAt`, `answerStartedAt` and `submittedAt`, and handing
    a candidate the raw timing of every past turn would let a client reconstruct exactly
    how long they took on each one — and, worse, edit and replay it.
    """
    import math

    at_ms = at_ms if at_ms is not None else _now_ms()
    transcript = session.get("transcript") or []

    awaiting = (
        current_interviewer_turn(session)
        if session.get("status") == "in_progress"
        else None
    )
    timing = (
        turn_timing(template, awaiting, fixed_question_ids=fixed_question_ids)
        if awaiting
        else None
    )

    phase: str | None = None
    remaining = 0.0
    phase_total = 0

    if timing and awaiting:
        answer_started = to_ms(awaiting.get("answerStartedAt"))
        thinking_started = to_ms(awaiting.get("thinkingStartedAt"))
        if answer_started is not None:
            phase = "answer"
            phase_total = timing["answerSeconds"]
            remaining = phase_total - (at_ms - answer_started) / 1000
        elif thinking_started is not None:
            phase = "thinking"
            phase_total = timing["thinkingSeconds"]
            remaining = phase_total - (at_ms - thinking_started) / 1000
        # Otherwise the turn is timed but not yet presented: no phase, but
        # `currentTurnTimed` tells the client a clock is coming.

    total_questions = session.get("plannedQuestionCount") or planned_count_for(
        template, fixed_question_count=fixed_question_count
    )

    return {
        "sessionId": session.get("id"),
        "status": session.get("status"),
        "track": session.get("track"),
        "transcript": [
            {
                "id": turn.get("id"),
                "role": turn.get("role"),
                "content": turn.get("content"),
                "turnType": turn.get("turnType"),
                "questionIndex": turn.get("questionIndex"),
                "isFollowUp": turn.get("isFollowUp"),
            }
            for turn in transcript
        ],
        "awaitingInterviewer": False,
        "finished": session.get("status") in ("completed", "expired"),
        "phase": phase,
        "remainingSeconds": max(0, math.ceil(remaining)),
        "totalPhaseSeconds": phase_total,
        "currentTurnTimed": timing is not None,
        "currentTurnId": awaiting.get("id") if awaiting else None,
        "progress": {
            "current": min((session.get("currentIndex") or 0) + 1, total_questions or 1),
            "total": total_questions,
        },
        "draft": (awaiting or {}).get("draft") or "",
        "timing": {
            "mode": session.get("mode") or template.get("mode") or "conversational",
            "enabled": timer_enabled(template),
            "thinkingSeconds": (timing or {}).get("thinkingSeconds") or 0,
            "perQuestionSeconds": (timing or {}).get("answerSeconds") or 0,
            "allowSkipThinking": (timing or {}).get("allowSkipThinking") or False,
            "allowEarlySubmit": (timing or {}).get("allowEarlySubmit", True),
            "warningThresholdSeconds": (timing or {}).get("warningThresholdSeconds") or 15,
        },
        "branding": template.get("branding"),
        "integrity": template.get("integrity"),
        "tabSwitchWarnings": session.get("tabSwitchCount") or 0,
        "awaitingResume": template.get("questionSource") == "adaptive"
        and not session.get("resumeText"),
    }


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)

"""Text destined to be spoken aloud — a port of `web_version/talbotiq-platform/shared/speech.ts`.

Everything here exists because a written question and a spoken one are not the same
artefact. Markdown becomes noise ("asterisk asterisk bold"), a numbered list gets its
numbers read out, and an em dash reads as a machine wrote it.

Like `invite_email.py`, this module is imported by the React client as well as the
Express server, so the port introduces a second implementation of shared logic. Unlike
the email renderer, nothing here is byte-compared between the two: the output is a
prompt, not a document, and a small divergence changes phrasing rather than correctness.
Worth knowing rather than guarding.
"""

from __future__ import annotations

import re

TIME_GREETINGS = {
    "morning": "Good morning",
    "afternoon": "Good afternoon",
    "evening": "Good evening",
}

# How much résumé the avatar is given as background. Enough to sound informed, bounded
# because it rides in every conversation's context.
MAX_BACKGROUND_CHARS = 1500

_MARKDOWN = re.compile(r"[*_`#>]+")
_LIST_PREFIX = re.compile(r"^\s*(?:\d+[.)]|[-–—•])\s+", re.MULTILINE)
_DASHES = re.compile(r"\s*[—–]\s*|\s+-\s+")
_WHITESPACE = re.compile(r"\s+")

# Every English variant the recogniser may settle on. Naming them all — rather than a
# single "en-US" — is what stops an Indian-accented answer being scored as a different
# language entirely: with no hint at all the recogniser is free to decide the audio is
# Hindi and transcribe Devanagari into an English-only interview.
ENGLISH_VARIANTS = ("en-IN", "en-US", "en-GB", "en-AU")

# Ported from the Express implementation (server/services/voice.ts:108-121), which these
# were dropped from in the FastAPI port.
_ADAPTATION_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9+#.]*[A-Za-z0-9+#]")
_ADAPTATION_ACRONYM = re.compile(r"^[A-Z]{2,}[0-9+#]*$")
_ADAPTATION_CAMEL = re.compile(r"[a-z][A-Z]")
_ADAPTATION_DIGIT = re.compile(r"[0-9+#]")
_ADAPTATION_DOTTED = re.compile(r"\w\.\w")
_ADAPTATION_PROPER = re.compile(r"[A-Z][a-z0-9]+(?:[ -][A-Z][a-z0-9]+)+")
# A single capitalised word MID-SENTENCE: "Redis", "Grafana", "Kafka". The Express
# heuristic missed exactly these — they are neither acronyms nor multi-word — which is
# why candidates heard "Redis" come back as "reduce". Sentence-initial words are skipped
# so ordinary openers ("How", "Describe") never become hints.
_ADAPTATION_SENTENCE = re.compile(r"(?<=[.!?\n])\s*|^\s*")
_ADAPTATION_PROPER_WORD = re.compile(r"^[A-Z][a-z0-9]{2,}$")

# Google caps the hint list; 32 is what the Express relay sent.
MAX_ADAPTATION_PHRASES = 32


def greeting_word(time_of_day: str | None) -> str:
    return TIME_GREETINGS.get(time_of_day or "", "Hello")


def transcription_languages(language: str | None) -> list[str]:
    """The language hints for the recogniser.

    An English interview is hinted with every English variant, because a candidate's
    accent is not a different language. Anything else is passed through untouched.
    """
    value = (language or "").strip().lower()
    if not value or value.startswith("en") or value.startswith("english"):
        return list(ENGLISH_VARIANTS)
    return [language.strip()]


def adaptation_phrases(role: str | None, questions: list[str]) -> list[str]:
    """Domain terms to bias the recogniser towards.

    Without these, "Redis" comes back as "reduce" and "Grafana" as "nature" — the
    recogniser has no reason to prefer a technical term over a common English word that
    sounds like it. The question script is the best available source of the vocabulary a
    given interview will actually contain.
    """
    out: list[str] = []
    seen: set[str] = set()

    def add(phrase: str) -> None:
        if phrase and phrase not in seen:
            seen.add(phrase)
            out.append(phrase)

    if (role or "").strip():
        add(role.strip()[:60])

    text = "\n".join(questions)
    for match in _ADAPTATION_TOKEN.finditer(text):
        word = match.group(0)
        if not 2 <= len(word) <= 40:
            continue
        if (
            _ADAPTATION_ACRONYM.match(word)
            or _ADAPTATION_CAMEL.search(word)
            or _ADAPTATION_DIGIT.search(word)
            or _ADAPTATION_DOTTED.search(word)
        ):
            add(word)

    for match in _ADAPTATION_PROPER.finditer(text):
        add(match.group(0)[:60])

    for sentence in _ADAPTATION_SENTENCE.split(text):
        if not sentence:
            continue
        # Skip the first word: it is capitalised by grammar, not because it is a name.
        for word in sentence.split()[1:]:
            stripped = word.strip(".,;:!?()[]\"'")
            if _ADAPTATION_PROPER_WORD.match(stripped):
                add(stripped)

    return out[:MAX_ADAPTATION_PHRASES]


def strip_for_speech(text: str) -> str:
    """Reduce written text to something that reads naturally aloud.

    Markdown, list markers and dashes all have visual meaning and no spoken one — a
    text-to-speech engine either voices them literally or pauses oddly around them.
    """
    value = _LIST_PREFIX.sub("", text or "")
    value = _MARKDOWN.sub("", value)
    value = _DASHES.sub(", ", value)
    value = re.sub(r",\s*,", ",", value)
    return _WHITESPACE.sub(" ", value).strip()


SPOKEN_STYLE_RULES = (
    "SPEAKING STYLE: You are speaking out loud, not writing. Use contractions and short, "
    "natural sentences. Never read out formatting, numbers of questions, or lists. Never "
    "use em dashes. Sound warm and genuinely interested, never templated or corporate."
)

VARIED_THANKS_RULE = (
    "After each answer, give ONE short, varied, genuine acknowledgment before the next "
    "question — never the same phrase twice, and never a critical one."
)

# Turn-taking is guessed from silence, and silence is ambiguous: a candidate gathering
# their next point looks exactly like a candidate who has finished. Guessing wrong in the
# "finished" direction silently costs them the rest of their answer, and they cannot get
# it back — the interview has already moved on. Asking costs one short line.
#
# The check is phrased as a question so it is never mistaken for a wrap-up, and the added
# detail lands under the same question for scoring: a confirmation does not match any
# planned question, so the server records it as an acknowledgment and leaves the question
# cursor where it is (app/web/services/avatar_transcript.py).
CONFIRM_BEFORE_ADVANCING_RULE = (
    "BEFORE MOVING ON — never assume an answer is finished just because they paused, but "
    "use this check SPARINGLY: when they give a complete, substantial answer, do NOT ask "
    "anything — acknowledge briefly and go straight to the next question. ONLY when their "
    "answer is very short (a sentence or two), cut off mid-thought, or clearly unfinished, "
    "ask ONE short check such as \"Is that everything, or is there anything you'd like to "
    "add?\" and WAIT. Vary the wording, and never use the check twice on the same "
    "question. Anything they add is part of that same answer, so let them finish it. This "
    "applies to EVERY question, including the last one."
)


def resume_addendum(asked: list[str]) -> str:
    """Instructions for a session that is picking up after a dropped connection.

    A fresh Live session has no memory of the call it is replacing, so without this the
    interviewer greets the candidate a second time and works through the script from the
    top — asking questions they have already answered. Naming what was covered is what
    makes the continuation seamless; the Express relay carried the same clause
    (server/services/voice.ts:424-426) and the port dropped it.
    """
    covered = "\n".join(f"- {strip_for_speech(question)}" for question in asked)
    already = (
        f"\n\nYou have ALREADY asked and received answers to these, so do NOT ask them "
        f"again:\n{covered}"
        if asked
        else ""
    )
    return (
        "RESUMING: the connection dropped briefly and has just been restored. This is the "
        "SAME interview continuing, not a new one. Do NOT greet the candidate again, do "
        "NOT introduce yourself again, and do NOT start over. Say one short line to the "
        "effect that you are back and briefly apologise for the interruption, then "
        "continue with the next planned question you had not yet covered."
        f"{already}"
    )


def default_interviewer_persona(
    candidate_name: str | None = None, ai_name: str | None = None
) -> str:
    who = (candidate_name or "").strip() or "the candidate"
    me = (ai_name or "").strip() or "Alex"
    return (
        f"You are {me}, a Senior Talent Specialist at TalbotIQ conducting a screening "
        f"interview with {who}. You are warm, personable and encouraging. You put people "
        "at ease and sound genuinely interested in their answers."
    )


def avatar_interview_context(
    *,
    persona_text: str | None = None,
    candidate_name: str | None = None,
    ai_name: str | None = None,
    questions: list[str],
    time_of_day: str | None = None,
    resume_text: str | None = None,
    confirm_before_advancing: bool = False,
    closing_can_leave: bool = False,
) -> str:
    """The avatar's full instructions for one interview.

    The strict-script rules are the load-bearing part. An avatar left to improvise asks
    different questions of different candidates, which makes the scores incomparable and
    the screen indefensible — so it is told, explicitly and more than once, to ask exactly
    these questions in exactly this order and invent nothing.

    The résumé is included as BACKGROUND only, with the same prohibition attached: it is
    there so the avatar sounds informed when it acknowledges an answer, not so it can
    think of new questions.
    """
    who = (candidate_name or "").strip() or "the candidate"
    named = bool((candidate_name or "").strip())
    persona = (persona_text or "").strip() or default_interviewer_persona(
        candidate_name, ai_name
    )
    numbered = "\n".join(
        f"{index + 1}. {strip_for_speech(question)}"
        for index, question in enumerate(questions)
    )

    sections = [persona]

    if (resume_text or "").strip():
        sections.append(
            f"CANDIDATE BACKGROUND, from {who}'s résumé. Use it to sound informed and to "
            "personalise your brief acknowledgments naturally (e.g. referencing their "
            "experience), but NEVER to add, change, or skip scripted questions:\n"
            f"{resume_text.strip()[:MAX_BACKGROUND_CHARS]}"
        )

    sections += [
        SPOKEN_STYLE_RULES,
        f"""FLOW:
1. Open with a brief "{greeting_word(time_of_day)}" greeting and warmly welcome {who}{' by name' if named else ''}. Add one short reassuring line about how this will go, then ask if they're ready to begin, and wait.
2. If they clearly say yes, begin. If they're unsure or nervous, reassure them in one short line and ask again; only start on a clear yes.
3. Ask the questions below IN ORDER, one at a time, phrased exactly as written. Wait for {who} to completely finish each answer — never interrupt. {VARIED_THANKS_RULE}
4. Only AFTER the final question is answered, close warmly: thank them sincerely, tell them that's everything and they're all done, that the team will be in touch about next steps, and wish them a great rest of their day.{" Finally, tell them they're free to leave now and that the session will close by itself shortly." if closing_can_leave else ""}""",
        *([CONFIRM_BEFORE_ADVANCING_RULE] if confirm_before_advancing else []),
        "THE QUESTIONS, IN ORDER. Ask every one, exactly as written; never say their "
        f"numbers aloud:\n{numbered}",
        f"STRICT RULES: Ask ONLY these questions. Do NOT invent, add, skip, reorder, or "
        f"rephrase any question, and never ask follow-ups that are not in the list"
        + (
            " — the one exception is the short \"anything to add?\" check above, which is "
            "not a new question and does not replace or count as one of the planned "
            "questions"
            if confirm_before_advancing
            else ""
        )
        + f". No small talk beyond the opening. If {who} goes off-topic or asks you "
        "questions, politely acknowledge in one short line and steer straight back to the "
        "next planned question. Cover ALL the questions, then close — never finish early "
        "and never add questions of your own.",
    ]

    return "\n\n".join(sections)


def avatar_greeting_text(
    *,
    custom: str | None = None,
    candidate_name: str | None = None,
    ai_name: str | None = None,
    time_of_day: str | None = None,
) -> str:
    """The avatar's first words. A recruiter's own greeting wins."""
    if (custom or "").strip():
        return strip_for_speech(custom)

    hello = greeting_word(time_of_day)
    name = (candidate_name or "").strip()
    me = (ai_name or "").strip()
    intro = (
        f"I'm {me}, and I'm really looking forward to our chat"
        if me
        else "I'm really looking forward to our chat"
    )
    who = f" {name}," if name else ","

    return (
        f"{hello}{who} welcome, and thanks so much for making the time today. {intro}, so "
        "just relax and answer naturally. Are you ready to begin?"
    )

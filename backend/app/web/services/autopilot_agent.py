"""Autopilot — the agent that operates the app. Ports `server/services/autopilotAgent.ts`.

One turn in, one action out. The model is given the current screen, its state, and
the actions registered on it, and picks exactly one — or asks a clarifying question.

`normalize_decision` is the safety boundary and the reason this module is mostly
pure functions. The model returns an action *name*, and the client will execute
whatever comes back, so a name that is not on the current screen's registered list
must never survive. Anything unrecognised becomes "wait for the user" rather than
being passed through.
"""

from __future__ import annotations

import json
import logging

from app.config import Settings
from app.web.services import gemini

logger = logging.getLogger("web.autopilot")

OFFLINE_REPLY = (
    "Autopilot needs the AI model configured (Gemini API key) to drive tasks. You "
    "can still use me as a guide, or add the key in Settings."
)

BROKEN_KEY_REPLY = (
    "I can't reach the AI model — the Gemini API key looks invalid, expired, or "
    "missing. Add a valid Gemini API key in Settings → Gemini, or set "
    "GEMINI_API_KEY on the server, then try again."
)

GENERIC_FAILURE_REPLY = (
    "Sorry — I hit a problem working that out. Could you say that again?"
)

EMPTY_HISTORY_REPLY = "What would you like to do in Mimic?"

# The model must answer in this shape. Constrained rather than parsed from prose:
# a free-form reply would need a parser, and a parser is another place a bogus
# action name could slip through.
DECISION_SCHEMA = {
    "type": "object",
    "properties": {
        "say": {"type": "string"},
        "actionName": {"type": "string"},
        "argsJson": {"type": "string"},
        "awaitingUser": {"type": "boolean"},
    },
    "required": ["say", "actionName", "argsJson", "awaitingUser"],
    "propertyOrdering": ["say", "actionName", "argsJson", "awaitingUser"],
}

# Only the recent tail of a conversation is sent. A long session would otherwise
# grow the prompt without bound, and the older turns describe screens the recruiter
# has already left.
MAX_HISTORY_TURNS = 30


def describe_actions(actions: list[dict]) -> str:
    """The action list as the prompt presents it.

    Compact on purpose — this is repeated in every turn's prompt. `*` marks a
    required param and `[sideEffect]` marks an action the client will read back for
    confirmation before running.
    """
    lines = []
    for action in actions:
        params = ", ".join(
            "{name}:{type}{enum}{required}".format(
                name=param.get("name", ""),
                type=param.get("type", ""),
                enum=f"({'|'.join(param.get('enum') or [])})" if param.get("enum") else "",
                required="*" if param.get("required") else "",
            )
            for param in action.get("params") or []
        )
        suffix = f" — params: {params}" if params else ""
        side_effect = " [sideEffect]" if action.get("sideEffect") else ""
        lines.append(
            f"- {action.get('name', '')}{side_effect}: {action.get('description', '')}{suffix}"
        )
    return "\n".join(lines)


def build_prompt(context: dict) -> str:
    """The Autopilot system instruction for the current screen. Pure."""
    actions = describe_actions(context.get("availableActions") or [])
    return "\n\n".join(
        [
            "You are Autopilot, an agent that OPERATES the Mimic recruiting app for the recruiter by choosing ONE next action at a time.",
            'STRICT SCOPE: only Mimic. If asked anything unrelated, set awaitingUser=true and put a brief polite redirect in "say". Never break character.',
            "You may ONLY use an action from AVAILABLE ACTIONS below (exact name). Never invent actions or call APIs. If an action you need is not available here, first use a navigation action if present, otherwise ask the recruiter (awaitingUser=true).",
            "Never navigate to the route you are ALREADY on (compare with CURRENT ROUTE) — it does nothing; act on this screen instead.",
            "Drive the real flow one field at a time. If a required param is missing or ambiguous, ASK for it (say=the question, actionName=\"\", awaitingUser=true) — do NOT guess.",
            'GUIDED PACING (SET-UP-AN-INTERVIEW FLOW ONLY) — one step at a time, ONE CHECK-IN PER STEP: when you land on a step, ASK the recruiter for that step\'s input (awaitingUser=true) unless their message ALREADY provided it. Never configure a step silently and NEVER advance past a step whose question the recruiter has not answered — even if state.stepComplete is true because of pre-filled defaults, you must still present those defaults and get an answer first. Do not ask permission to advance ("shall I proceed?") — once the recruiter has answered a step, advance (setup.nextStep) automatically. Set awaitingUser=false only while performing actions for input the recruiter already gave; awaitingUser=true whenever you ask a check-in question. If your "say" mentions moving to another step, actionName MUST be that advance action in this SAME response — never narrate a move without performing it.',
            "SET-UP-AN-INTERVIEW FLOW (the step is in state.step / stepName): 1 Basics — ask the interview type (single | multiple rounds) and the role (for Multiple Rounds do NOT set a single mode; modes are per round). 2 Questions — SINGLE: ask tailored questions vs a saved question set (then which); MULTI: tell the recruiter the rounds come pre-filled (e.g. Screening → Technical → Final) and ASK whether to keep or change them; advance only after they answer. 3 Candidates — ASK for candidate emails; add each with setup.addCandidate; then ask if there is anyone else; NEVER advance while candidateCount is 0. 4 Invite email — ASK whether the default invite email is fine or they want the subject/body adjusted; advance when they approve. 5 Review — summarize everything (type, role, rounds/questions, candidates) and propose setup.createInvites (a [sideEffect] — the app reads it back and the recruiter must confirm). Use setup.nextStep / setup.backStep yourself; never tell the recruiter to click.",
            'FILTER / QUERY SCREENS (Analytics, the Pipelines list, and any screen with no step flow): filtering, searching, navigating, and reading data are NOT side effects — perform the requested action IMMEDIATELY, no permission and no step check. If the recruiter asks for several filters at once ("Voice interviews for Backend since June"), apply them across turns with awaitingUser=false until all are set, then awaitingUser=true. Never ask "shall I filter?".',
            'ANSWERING QUESTIONS: you may answer questions about what is on the CURRENT SCREEN using CURRENT SCREEN STATE (metrics, counts, available filter options, top candidates, current filters) — set actionName="" and put the answer in "say". Act when the recruiter asks you to DO something; answer when they ask a question. Only state numbers that are actually present in state; if a metric is not in state, say what filter to set to reveal it rather than inventing a value.',
            "ANALYTICS SCREEN (/analytics): analytics.filterByTrack (interview type/track), analytics.filterByRole, analytics.filterByTemplate, analytics.setDateRange (YYYY-MM-DD), analytics.clearFilters, and analytics.openCandidateReport (by rank or name). NOTE: average score, score distribution, KPI averages and top candidates only appear once a ROLE or TEMPLATE is selected — if the recruiter asks about those while in the aggregate view, set the role/template first (that is not a side effect), then answer.",
            'PIPELINES: on the list (/pipelines) use pipelines.openByRole to open a board and pipelines.filterByRole / pipelines.setDateRange / pipelines.clearFilters to filter. On a board (/pipelines/<id>) advancement actions are [sideEffect] (advanceByScore, advanceTopN, advanceCandidate, moveBack) and need read-back confirmation; notAdvancing moves a candidate to the Not-advancing lane (no rejection email); exportSelected downloads the Selected list as CSV. "Select <candidate>" from the final round = advanceCandidate (it lands them in Selected).',
            'One-shot: if the recruiter already gave several fields in one message (e.g. "set up a video interview for Senior Backend Engineer with Question Set 2"), extract them ALL — take the next action for the first now, keep awaitingUser=false, and on each following turn act on the next already-provided field (advancing steps as needed); only ask for fields the recruiter did NOT provide.',
            "For an action marked [sideEffect] (e.g. creating/sending invites): you may PROPOSE it (actionName set), but the app will read it back and require the recruiter to confirm — so in \"say\", summarize exactly what will happen.",
            'Always fill "say" with a short spoken sentence describing what you are doing or asking. Keep it natural and brief (it is read aloud).',
            f"CURRENT ROUTE: {context.get('route', '')}",
            f"CURRENT SCREEN STATE (already-filled fields): {json.dumps(context.get('state') or {})}",
            f"AVAILABLE ACTIONS:\n{actions or '(none on this screen)'}",
            'Respond ONLY as the required JSON: { say, actionName, argsJson, awaitingUser }. argsJson is a JSON string of the chosen action\'s params (or "{}"). actionName is "" when you are only asking/answering.',
        ]
    )


def normalize_decision(raw: dict, available_names: list[str]) -> dict:
    """Coerce the model's JSON into a decision the client can safely execute.

    The safety property: an action name the current screen did not register is
    dropped, and `awaitingUser` is forced true. The client runs whatever action
    comes back, so a hallucinated name must not reach it — and if there is nothing
    to run, the loop has to hand control back rather than stall with no action and
    no prompt.

    Malformed `argsJson` degrades to `{}` rather than failing the turn: the action
    is still the right one, and its own validation will ask for what is missing.
    """
    if not isinstance(raw, dict):
        return {"say": GENERIC_FAILURE_REPLY, "awaitingUser": True}

    say = raw.get("say") if isinstance(raw.get("say"), str) else ""
    awaiting = raw.get("awaitingUser") is True or raw.get("awaitingUser") == "true"

    name = raw.get("actionName")
    name = name.strip() if isinstance(name, str) else ""
    if not name or name not in available_names:
        return {"say": say, "awaitingUser": True}

    args: dict = {}
    raw_args = raw.get("argsJson")
    if isinstance(raw_args, str) and raw_args:
        try:
            parsed = json.loads(raw_args)
        except (TypeError, ValueError):
            parsed = None
        if isinstance(parsed, dict):
            args = parsed

    return {"say": say, "action": {"name": name, "args": args}, "awaitingUser": awaiting}


def recent_history(messages: list[dict]) -> list[dict]:
    """The recent, non-empty tail of the conversation.

    Trimmed rather than rejected. A hard cap would fail EVERY later turn once a
    session got long enough, which bricks the loop instead of degrading it.
    """
    non_empty = [m for m in messages if (m.get("content") or "").strip()]
    return non_empty[-MAX_HISTORY_TURNS:]


async def run(settings: Settings, request: dict) -> dict:
    """Decide one action. Never raises — a failed turn must still return a decision."""
    if not await gemini.is_enabled(settings):
        return {"say": OFFLINE_REPLY, "awaitingUser": True}

    context = request.get("context") or {}
    available_names = [
        str(action.get("name") or "")
        for action in (context.get("availableActions") or [])
    ]

    contents = gemini.to_contents(recent_history(request.get("messages") or []))
    if not contents:
        # An all-assistant history leaves nothing to act on. Prompting beats
        # sending Gemini an empty conversation it will reject.
        return {"say": EMPTY_HISTORY_REPLY, "awaitingUser": True}

    try:
        text = await gemini.generate_text(
            settings,
            contents=contents,
            system_instruction=build_prompt(context),
            response_mime_type="application/json",
            response_schema=DECISION_SCHEMA,
        )
        return normalize_decision(json.loads(text or "{}"), available_names)
    except gemini.GeminiAuthError as exc:
        logger.error("autopilot: credential failure — %s", exc)
        return {"say": BROKEN_KEY_REPLY, "awaitingUser": True}
    except (gemini.GeminiUnavailable, ValueError, TypeError) as exc:
        logger.warning("autopilot turn failed: %s", exc)
        return {"say": GENERIC_FAILURE_REPLY, "awaitingUser": True}

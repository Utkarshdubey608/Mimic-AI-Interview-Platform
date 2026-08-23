"""Mimic Guide and Autopilot.

`normalize_decision` is the one that matters most: the client executes whatever
action name comes back, so a name the current screen did not register must never
survive. The rest pins the three deliberately-different degraded paths.
"""

from __future__ import annotations

import asyncio

import pytest

from app.config import Settings
from app.web.services import autopilot_agent, gemini, mimic_guide
from app.web.services.mimic_guide_prompt import (
    CANDIDATE,
    GUEST,
    OUT_OF_SCOPE_REFUSAL,
    RECRUITER,
    build_prompt,
)

FIRST = lambda options: options[0]  # noqa: E731 - deterministic `pick` for tests


# ── Autopilot: the safety boundary ────────────────────────────────────────────


def test_a_registered_action_survives() -> None:
    decision = autopilot_agent.normalize_decision(
        {"say": "Filtering.", "actionName": "analytics.filterByRole",
         "argsJson": '{"role": "Backend"}', "awaitingUser": False},
        ["analytics.filterByRole"],
    )
    assert decision == {
        "say": "Filtering.",
        "action": {"name": "analytics.filterByRole", "args": {"role": "Backend"}},
        "awaitingUser": False,
    }


def test_an_unregistered_action_name_is_dropped() -> None:
    """A hallucinated action must never reach the client, which would try to run it."""
    decision = autopilot_agent.normalize_decision(
        {"say": "Deleting everything.", "actionName": "danger.dropDatabase",
         "argsJson": "{}", "awaitingUser": False},
        ["analytics.filterByRole"],
    )
    assert "action" not in decision
    # Forced true: with nothing to run, the loop must hand control back rather than
    # stall with no action and no prompt.
    assert decision["awaitingUser"] is True
    assert decision["say"] == "Deleting everything."


def test_an_empty_action_name_means_asking() -> None:
    decision = autopilot_agent.normalize_decision(
        {"say": "Which role?", "actionName": "", "argsJson": "{}", "awaitingUser": True},
        ["analytics.filterByRole"],
    )
    assert "action" not in decision
    assert decision["awaitingUser"] is True


def test_action_names_are_matched_exactly() -> None:
    """No trimming-to-fuzzy or case folding: a near-miss is a hallucination."""
    for name in ["Analytics.FilterByRole", "analytics.filterbyrole", "analytics.filter"]:
        decision = autopilot_agent.normalize_decision(
            {"say": "", "actionName": name, "argsJson": "{}", "awaitingUser": False},
            ["analytics.filterByRole"],
        )
        assert "action" not in decision, name


def test_surrounding_whitespace_in_a_name_is_tolerated() -> None:
    decision = autopilot_agent.normalize_decision(
        {"say": "", "actionName": "  analytics.filterByRole  ", "argsJson": "{}",
         "awaitingUser": False},
        ["analytics.filterByRole"],
    )
    assert decision["action"]["name"] == "analytics.filterByRole"


@pytest.mark.parametrize(
    "args_json",
    [
        pytest.param("{not json", id="malformed"),
        pytest.param("[1, 2]", id="array, not an object"),
        pytest.param('"a string"', id="scalar"),
        pytest.param("", id="empty"),
        pytest.param(None, id="missing"),
    ],
)
def test_unusable_args_degrade_to_empty_rather_than_failing(args_json) -> None:
    """The action is still the right one; its own validation asks for what's missing."""
    decision = autopilot_agent.normalize_decision(
        {"say": "", "actionName": "a", "argsJson": args_json, "awaitingUser": False},
        ["a"],
    )
    assert decision["action"] == {"name": "a", "args": {}}


def test_awaiting_user_accepts_the_string_true() -> None:
    """The model sometimes returns "true" rather than a boolean."""
    for value, expected in [(True, True), ("true", True), (False, False), ("no", False)]:
        decision = autopilot_agent.normalize_decision(
            {"say": "", "actionName": "a", "argsJson": "{}", "awaitingUser": value}, ["a"]
        )
        assert decision["awaitingUser"] is expected, value


def test_garbage_input_yields_a_safe_decision() -> None:
    for raw in [None, "text", 42, []]:
        decision = autopilot_agent.normalize_decision(raw, ["a"])
        assert decision["awaitingUser"] is True
        assert "action" not in decision


def test_non_string_say_becomes_empty() -> None:
    decision = autopilot_agent.normalize_decision(
        {"say": {"nested": 1}, "actionName": "", "argsJson": "{}", "awaitingUser": True}, []
    )
    assert decision["say"] == ""


# ── Autopilot: prompt and history ─────────────────────────────────────────────


def test_the_prompt_lists_actions_with_their_markers() -> None:
    prompt = autopilot_agent.build_prompt(
        {
            "route": "/analytics",
            "state": {"role": "Backend"},
            "availableActions": [
                {
                    "name": "analytics.filterByRole",
                    "description": "Filter by role",
                    "screen": "analytics",
                    "sideEffect": False,
                    "params": [{"name": "role", "type": "string", "required": True}],
                },
                {
                    "name": "setup.createInvites",
                    "description": "Send invites",
                    "screen": "setup",
                    "sideEffect": True,
                    "params": [],
                },
            ],
        }
    )
    assert "CURRENT ROUTE: /analytics" in prompt
    assert '"role": "Backend"' in prompt
    assert "- analytics.filterByRole: Filter by role — params: role:string*" in prompt
    assert "- setup.createInvites [sideEffect]: Send invites" in prompt


def test_enum_params_show_their_options() -> None:
    described = autopilot_agent.describe_actions(
        [
            {
                "name": "a",
                "description": "d",
                "params": [{"name": "mode", "type": "enum", "enum": ["voice", "chat"]}],
            }
        ]
    )
    assert "mode:enum(voice|chat)" in described


def test_a_screen_with_no_actions_says_so() -> None:
    """An empty list must not render as a blank section the model reads as truncated."""
    prompt = autopilot_agent.build_prompt({"route": "/x", "state": {}, "availableActions": []})
    assert "(none on this screen)" in prompt


def test_history_is_trimmed_not_rejected() -> None:
    """A hard cap would fail EVERY later turn once a session got long, bricking the
    loop instead of degrading it."""
    messages = [{"role": "user", "content": f"m{i}"} for i in range(100)]
    trimmed = autopilot_agent.recent_history(messages)
    assert len(trimmed) == autopilot_agent.MAX_HISTORY_TURNS
    assert trimmed[-1]["content"] == "m99"


def test_empty_turns_are_dropped_from_history() -> None:
    trimmed = autopilot_agent.recent_history(
        [{"role": "user", "content": "  "}, {"role": "user", "content": "hi"}]
    )
    assert trimmed == [{"role": "user", "content": "hi"}]


def test_autopilot_is_offline_without_a_key() -> None:
    settings = Settings(gemini_api_key="")
    decision = asyncio.run(
        autopilot_agent.run(settings, {"messages": [{"role": "user", "content": "hi"}],
                                       "context": {"route": "/x", "availableActions": [], "state": {}}})
    )
    assert decision == {"say": autopilot_agent.OFFLINE_REPLY, "awaitingUser": True}


# ── Gemini contents mapping ───────────────────────────────────────────────────


def test_assistant_turns_become_model_turns() -> None:
    contents = gemini.to_contents(
        [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]
    )
    assert [c["role"] for c in contents] == ["user", "model"]
    assert contents[0]["parts"] == [{"text": "hi"}]


def test_leading_model_turns_are_dropped() -> None:
    """History is trimmed to a fixed number of turns before it gets here, which can
    leave a model turn first — and Gemini rejects a conversation that does not open
    with a user turn."""
    contents = gemini.to_contents(
        [
            {"role": "assistant", "content": "a"},
            {"role": "assistant", "content": "b"},
            {"role": "user", "content": "c"},
        ]
    )
    assert [c["role"] for c in contents] == ["user"]


def test_an_all_assistant_history_yields_nothing() -> None:
    assert gemini.to_contents([{"role": "assistant", "content": "a"}]) == []


def test_blank_messages_are_filtered() -> None:
    assert gemini.to_contents([{"role": "user", "content": "   "}]) == []


# ── auth-failure detection ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "status_code,body",
    [
        (401, ""),
        (403, ""),
        (400, "API key not valid. Please pass a valid API key."),
        (400, "UNAUTHENTICATED"),
        (400, "PERMISSION_DENIED"),
        (500, "ACCESS_TOKEN_TYPE_UNSUPPORTED"),
    ],
)
def test_credential_failures_are_recognised(status_code: int, body: str) -> None:
    """The status alone is not enough — Gemini returns 400 with "API key not valid"
    for a malformed key, which would otherwise read as the caller's mistake."""
    assert gemini.is_auth_failure(status_code, body)


@pytest.mark.parametrize(
    "status_code,body",
    [(429, "Quota exceeded"), (503, "The model is overloaded"), (500, "Internal error")],
)
def test_transient_failures_are_not_credential_failures(status_code: int, body: str) -> None:
    assert not gemini.is_auth_failure(status_code, body)


# ── Mimic Guide degraded paths ────────────────────────────────────────────────


def test_no_key_answers_from_the_built_in_notes() -> None:
    """The assistant stays useful on a deployment that never had Gemini."""
    reply = asyncio.run(
        mimic_guide.run(Settings(gemini_api_key=""), [{"role": "user", "content": "how do I make a template?"}], RECRUITER)
    )
    assert "**Templates**" in reply


def test_a_broken_key_says_so_instead_of_pretending(monkeypatch: pytest.MonkeyPatch) -> None:
    """Canned answers would make a broken key look like working software while it is
    also silently breaking scoring and question generation."""
    async def _auth_error(*args, **kwargs):
        raise gemini.GeminiAuthError("bad key")

    monkeypatch.setattr(gemini, "is_enabled", _true)
    monkeypatch.setattr(gemini, "generate_text", _auth_error)
    reply = asyncio.run(mimic_guide.run(Settings(), [{"role": "user", "content": "hi"}], RECRUITER))
    assert reply == mimic_guide.BROKEN_KEY_REPLY


def test_an_outage_falls_back_to_the_notes(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _unavailable(*args, **kwargs):
        raise gemini.GeminiUnavailable("overloaded")

    monkeypatch.setattr(gemini, "is_enabled", _true)
    monkeypatch.setattr(gemini, "generate_text", _unavailable)
    reply = asyncio.run(
        mimic_guide.run(Settings(), [{"role": "user", "content": "where are my results?"}], RECRUITER)
    )
    assert "**Results:**" in reply


def test_an_empty_generation_becomes_the_refusal(monkeypatch: pytest.MonkeyPatch) -> None:
    """An empty reply and an out-of-scope question look the same to the user, and the
    refusal is the safer of the two to show."""
    async def _empty(*args, **kwargs):
        return ""

    monkeypatch.setattr(gemini, "is_enabled", _true)
    monkeypatch.setattr(gemini, "generate_text", _empty)
    reply = asyncio.run(mimic_guide.run(Settings(), [{"role": "user", "content": "hi"}], RECRUITER))
    assert reply == OUT_OF_SCOPE_REFUSAL


async def _true(*args, **kwargs) -> bool:
    return True


# ── canned answers + prompt roles ─────────────────────────────────────────────


def test_canned_answers_match_by_keyword() -> None:
    assert "[Go to Sessions]" in mimic_guide.canned_answer("how do I send an invite?", pick=FIRST)
    assert "[Manage Question Sets]" in mimic_guide.canned_answer("add questions", pick=FIRST)
    assert "[Open Settings]" in mimic_guide.canned_answer("where is the gemini api key", pick=FIRST)


def test_an_unmatched_question_gets_a_general_overview() -> None:
    assert "navigate Mimic" in mimic_guide.canned_answer("qwertyuiop", pick=FIRST)


def test_every_canned_answer_is_non_empty() -> None:
    for pattern, answers in mimic_guide.GUIDE_FAQ:
        assert answers, pattern
        assert all(a.strip() for a in answers), pattern


def test_last_user_message_ignores_assistant_turns() -> None:
    assert mimic_guide.last_user_message(
        [{"role": "user", "content": "first"}, {"role": "assistant", "content": "reply"}]
    ) == "first"
    assert mimic_guide.last_user_message([{"role": "assistant", "content": "x"}]) == ""


def test_only_a_confirmed_recruiter_gets_recruiter_links() -> None:
    """The guide must never offer recruiter-only links to someone whose role could
    not be confirmed — those pages show an access-denied screen."""
    assert mimic_guide.guide_role(RECRUITER) == RECRUITER
    assert mimic_guide.guide_role(CANDIDATE) == CANDIDATE
    assert mimic_guide.guide_role(None) == CANDIDATE
    assert mimic_guide.guide_role("admin") == CANDIDATE


def test_the_role_note_changes_the_prompt() -> None:
    assert "talking to a RECRUITER" in build_prompt(RECRUITER)
    assert "talking to a CANDIDATE" in build_prompt(CANDIDATE)
    assert "role is not known yet" in build_prompt(GUEST)


def test_an_unknown_role_falls_back_to_guest() -> None:
    """Least privilege of the three, and correct for a role that could not resolve."""
    assert build_prompt("wizard") == build_prompt(GUEST)


def test_the_refusal_sentence_is_embedded_in_the_prompt() -> None:
    """The prompt tells the model to reply with this string verbatim, so the two
    copies must be the same string."""
    assert OUT_OF_SCOPE_REFUSAL in build_prompt(RECRUITER)

"""Invite-email rendering: the golden contract, plus the properties behind it.

`shared/inviteEmail.ts` exists so the recruiter's preview is byte-identical to the
delivered mail — the frontend and the Express server ran the same code. The Python
port breaks that, and nothing in either language notices.

So `contracts/invite_email.fixtures.json` is the contract. This suite asserts the
Python side reproduces it; the web repo's suite asserts the TypeScript does too. To
change rendering deliberately:

    REGENERATE_INVITE_FIXTURES=1 .venv/bin/python -m pytest tests/web/test_web_invite_email.py

then update the TypeScript and its assertion in the same commit. Without that, a
recruiter approves one email and the candidate receives another.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app.web.services.invite_email_render import (
    filter_style,
    sanitize_body_html,
)
from app.web.shared import invite_email
from tests.web.invite_email_cases import CASES, render_case

# Deliberately outside both projects: it is a contract between them, not an artefact
# of either. `backend/` and `web_version/` are siblings under the repo root.
FIXTURES = (
    Path(__file__).resolve().parents[3] / "contracts" / "invite_email.fixtures.json"
)


def _rendered() -> dict:
    return {case["name"]: render_case(case) for case in CASES}


@pytest.fixture(scope="module")
def fixtures() -> dict:
    """The committed golden file, regenerating it only when explicitly asked."""
    if os.environ.get("REGENERATE_INVITE_FIXTURES"):
        FIXTURES.parent.mkdir(parents=True, exist_ok=True)
        rendered = _rendered()
        payload = {
            "_readme": (
                "Golden contract for invite-email rendering. Generated from "
                "backend/app/web/shared/invite_email.py; asserted by BOTH "
                "backend/tests/web/test_web_invite_email.py and "
                "web_version/talbotiq-platform/shared/inviteEmail.parity.test.ts. "
                "Regenerate with REGENERATE_INVITE_FIXTURES=1 and update both sides "
                "in the same commit."
            ),
            # The INPUTS live here too, so the TypeScript side needs no duplicated
            # case definitions — a second copy would be free to drift, which is the
            # exact failure this file exists to prevent.
            "inputs": [
                {
                    "name": case["name"],
                    "why": case["why"],
                    "call": case["call"],
                    "kind": case.get("kind"),
                    "template": case["template"],
                    "vars": case["vars"],
                    "link": case["link"],
                    "email": case["email"],
                }
                for case in CASES
            ],
            "cases": rendered,
        }
        # encoding pinned: the payload is deliberately non-ASCII (ensure_ascii=False),
        # and write_text/read_text otherwise use the platform's preferred encoding —
        # cp1252 on Windows, which mangles every em dash and fails the contract.
        FIXTURES.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    assert FIXTURES.exists(), (
        f"{FIXTURES} is missing. Generate it with "
        "REGENERATE_INVITE_FIXTURES=1 python -m pytest tests/web/test_web_invite_email.py"
    )
    return json.loads(FIXTURES.read_text(encoding="utf-8"))["cases"]


# ── the contract ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_rendering_matches_the_golden_contract(case: dict, fixtures: dict) -> None:
    """Every case, exactly. `case["why"]` records what each one pins."""
    expected = fixtures.get(case["name"])
    assert expected is not None, (
        f"{case['name']} has no fixture — regenerate the golden file."
    )
    assert render_case(case) == expected, case["why"]


def test_the_fixture_file_covers_every_case(fixtures: dict) -> None:
    """A case with no fixture would silently not be checked on the TypeScript side."""
    assert set(fixtures) == {case["name"] for case in CASES}


# ── escaping ──────────────────────────────────────────────────────────────────


def test_escape_matches_the_typescript_character_for_character() -> None:
    """`html.escape` emits `&#x27;` for an apostrophe; the shared renderer emits
    `&#39;`. Matching here means the two never diverge in the first place."""
    assert invite_email.escape_html("<a href=\"x\">&'</a>") == (
        "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;"
    )


def test_ampersands_are_escaped_before_the_other_entities() -> None:
    """Escaping `<` first would turn `&lt;` into `&amp;lt;` on the next pass."""
    assert invite_email.escape_html("<") == "&lt;"
    assert invite_email.escape_html("&lt;") == "&amp;lt;"


def test_none_escapes_to_empty() -> None:
    assert invite_email.escape_html(None) == ""


# ── token substitution ────────────────────────────────────────────────────────


def test_spacing_inside_braces_is_tolerated() -> None:
    assert invite_email.render_template("{{ role }}", {"role": "Dev"}) == "Dev"
    assert invite_email.render_template("{{role}}", {"role": "Dev"}) == "Dev"


def test_an_unknown_token_stays_literal() -> None:
    """A typo must be visible in the preview, not silently vanish from the sent mail."""
    assert invite_email.render_template("{{rold}}", {"role": "Dev"}) == "{{rold}}"


def test_a_known_token_with_no_value_renders_empty() -> None:
    assert invite_email.render_template("{{role}}!", {"role": None}) == "!"


def test_render_template_is_safe_on_empty_input() -> None:
    assert invite_email.render_template("", {}) == ""
    assert invite_email.render_template(None, {}) == ""


def test_substitution_does_not_rescan_its_own_output() -> None:
    """A value containing a token must not itself be substituted."""
    assert invite_email.render_template("{{role}}", {"role": "{{company}}", "company": "X"}) == "{{company}}"


# ── locked tokens ─────────────────────────────────────────────────────────────


def test_invite_and_advance_require_the_link() -> None:
    assert invite_email.required_tokens_for("invite") == ["{{interview_link}}"]
    assert invite_email.required_tokens_for("advance") == ["{{interview_link}}"]


def test_terminal_kinds_require_nothing() -> None:
    """There is no next round to link to."""
    assert invite_email.required_tokens_for("selected") == []
    assert invite_email.required_tokens_for("rejection") == []


def test_validation_finds_the_link_in_either_field() -> None:
    assert invite_email.validate_locked_tokens("{{interview_link}}", "")["ok"]
    assert invite_email.validate_locked_tokens("", "{{interview_link}}")["ok"]

    result = invite_email.validate_locked_tokens("Hi", "<p>no link</p>")
    assert result["ok"] is False
    assert result["missing"] == ["{{interview_link}}"]


def test_kind_of_defaults_to_invite() -> None:
    """Templates saved before kinds existed have no `kind` field."""
    assert invite_email.kind_of({}) == "invite"
    assert invite_email.kind_of({"kind": "advance"}) == "advance"
    assert invite_email.kind_of({"kind": "nonsense"}) == "invite"


def test_unknown_tokens_are_reported_once_each() -> None:
    found = invite_email.unknown_tokens("{{role}} {{typo}} {{ typo }} {{other}}")
    assert found == ["{{typo}}", "{{other}}"]


def test_advance_only_variables_are_not_unknown() -> None:
    """`round_name` is valid on an advance template, so flagging it would send a
    recruiter chasing a non-problem."""
    assert invite_email.unknown_tokens("{{round_name}} {{score}}") == []


# ── the shell ─────────────────────────────────────────────────────────────────


def _render(template_overrides=None, **kwargs) -> dict:
    template = {
        "subject": "S",
        "bodyHtml": "<p>B</p>",
        "cta": {"text": "Go", "color": "#6B2BE0"},
        "branding": {"companyName": "Acme", "accentColor": "#6B2BE0"},
        **(template_overrides or {}),
    }
    return invite_email.render_invite_email(
        template,
        {"candidate_name": "A", "role": "R", "recruiter_name": "N", "company": "C", "deadline": "D"},
        interview_link=kwargs.get("link", "https://x.test/t/1"),
        candidate_email=kwargs.get("email", "a@x.test"),
    )


def test_a_body_without_the_link_gets_a_fallback_cta() -> None:
    html = _render({"bodyHtml": "<p>No link here</p>"})["html"]
    assert html.count("<a href=") == 1


def test_a_body_with_the_link_gets_exactly_one_cta() -> None:
    """Both would mean two buttons in the delivered mail."""
    html = _render({"bodyHtml": "<p>{{interview_link}}</p>"})["html"]
    assert html.count("<a href=") == 1


def test_the_exact_email_note_is_always_present_on_an_invite() -> None:
    """Not removable by the recruiter: a candidate signing in with another address
    cannot open the interview and has no way to find out why."""
    assert "this invitation is linked to" in _render()["html"]
    assert "a@x.test" in _render()["html"]


def test_an_invalid_colour_cannot_break_out_of_the_style_attribute() -> None:
    html = _render({"cta": {"text": "Go", "color": '#fff;"><script>bad()</script>'}})["html"]
    assert "<script>" not in html
    assert "background:#6B2BE0" in html   # fell back


def test_an_invalid_accent_falls_back() -> None:
    html = _render({"branding": {"companyName": "Acme", "accentColor": "javascript:x"}})["html"]
    assert "javascript:" not in html


def test_the_paste_this_link_line_escapes_the_url() -> None:
    html = _render(link="https://x.test/t?a=1&b=2")["html"]
    assert "a=1&amp;b=2" in html


def test_a_terminal_email_carries_neither_link_nor_note() -> None:
    result = invite_email.render_transition_email(
        {"subject": "S", "bodyHtml": "<p>B</p>", "cta": {}, "branding": {}},
        "selected",
        {"candidate_name": "A", "role": "R", "recruiter_name": "N", "company": "C"},
    )
    assert "<a href=" not in result["html"]
    assert "this invitation is linked to" not in result["html"]
    assert "paste this link" not in result["html"]


# ── sanitiser ─────────────────────────────────────────────────────────────────


def test_scripts_and_handlers_are_removed() -> None:
    dirty = '<p onclick="steal()">Hi</p><script>bad()</script><img src=x onerror=y>'
    clean = sanitize_body_html(dirty)
    assert "script" not in clean.lower()
    assert "onclick" not in clean.lower()
    assert "onerror" not in clean.lower()
    assert "Hi" in clean


def test_allowed_formatting_survives() -> None:
    clean = sanitize_body_html("<p><strong>Bold</strong> and <em>italic</em></p><ul><li>x</li></ul>")
    for fragment in ("<strong>", "<em>", "<ul>", "<li>"):
        assert fragment in clean


def test_a_javascript_link_is_stripped() -> None:
    clean = sanitize_body_html('<a href="javascript:alert(1)">click</a>')
    assert "javascript:" not in clean


def test_http_https_and_mailto_links_survive() -> None:
    for url in ("https://x.test", "http://x.test", "mailto:a@x.test"):
        assert url in sanitize_body_html(f'<a href="{url}">link</a>')


def test_disallowed_tags_are_discarded_not_escaped() -> None:
    """The recruiter sees formatting drop out, never markup appear in the email."""
    clean = sanitize_body_html("<table><tr><td>cell</td></tr></table>")
    assert "&lt;table&gt;" not in clean
    assert "cell" in clean


def test_only_the_allowed_style_properties_survive() -> None:
    """`nh3` allows an attribute wholesale, so per-property filtering happens in
    `filter_style` — otherwise allowing `style` would allow all of CSS."""
    assert filter_style("color:#fff;position:fixed;top:0") == "color:#fff"
    assert filter_style("text-align:center") == "text-align:center"
    assert filter_style("background-image:url(https://evil.test/x)") == ""
    assert filter_style("font-weight:bold") == "font-weight:bold"
    assert filter_style("color:red") == ""          # not hex or rgb()
    assert filter_style("") == ""
    assert filter_style("nonsense") == ""


def test_a_style_attribute_reduced_to_nothing_is_dropped() -> None:
    clean = sanitize_body_html('<p style="position:absolute">Hi</p>')
    assert "style" not in clean
    assert "Hi" in clean


def test_an_empty_body_is_safe() -> None:
    assert sanitize_body_html("") == ""
    assert sanitize_body_html(None) == ""


# ── seeds ─────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("kind", ["invite", "advance", "selected", "rejection"])
def test_every_default_template_passes_its_own_validation(kind: str) -> None:
    """A default that failed validation would block the first send a new recruiter
    attempts."""
    seed = invite_email.default_template_for(kind)
    result = invite_email.validate_locked_tokens(seed["subject"], seed["bodyHtml"], kind)
    assert result["ok"], result["missing"]


@pytest.mark.parametrize("kind", ["invite", "advance", "selected", "rejection"])
def test_every_default_template_is_complete(kind: str) -> None:
    seed = invite_email.default_template_for(kind)
    assert seed["kind"] == kind
    for field in ("name", "sender", "subject", "bodyHtml", "cta", "branding"):
        assert field in seed, field
    assert seed["isDefault"] is True


def test_the_invite_default_carries_the_link() -> None:
    seed = invite_email.default_template_for("invite")
    assert "{{interview_link}}" in seed["bodyHtml"]


def test_terminal_defaults_carry_no_link() -> None:
    for kind in ("selected", "rejection"):
        assert "{{interview_link}}" not in invite_email.default_template_for(kind)["bodyHtml"]

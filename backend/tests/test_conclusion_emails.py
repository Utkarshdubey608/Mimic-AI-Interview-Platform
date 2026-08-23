"""The two FINAL-result templates: cleared every round, and not selected.

The round-outcome pair next door (tests/test_round_outcome_emails.py) tells a
candidate they moved along. These two end the process, and they carry something
none of the other built-ins do: `recruiter_message`, the recruiter's own words,
the same text the candidate reads in the app.

That is what is checked here — not "does it render", but the ways these
specifically do harm:

  1. A leftover `{{ placeholder }}` in a rejection email.
  2. A dropped message. The recruiter typed the one paragraph that is actually
     personal; a template that renders around it sends a form letter instead.
  3. Line breaks the recruiter typed silently collapsing into one paragraph.
  4. A call-to-action back into a process that is over.

The delivery path itself is covered by tests/test_app.py.
"""

from __future__ import annotations

import os

os.environ.setdefault("DRY_RUN", "true")
os.environ.setdefault("API_KEY", "")

import re  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import mailer  # noqa: E402
from app.main import create_app  # noqa: E402
from app.templating import (  # noqa: E402
    BUILTIN_BY_ID,
    SUPPORTED_VARIABLES,
    render,
)

CLEARED = "builtin:test_cleared"
NOT_SELECTED = "builtin:test_not_selected"
BOTH = [CLEARED, NOT_SELECTED]

client = TestClient(create_app())

# Exactly what test_conclusion_page.dart sends, plus the two the backend fills
# per recipient. Kept literal rather than imported so a variable quietly
# disappearing from the Flutter side fails here.
SENDER_CONTEXT = {
    "interview_title": "Backend Engineer",
    "recruiter_name": "Sam",
    "company": "Acme",
    "recruiter_message": "We'd like you to meet the team on Tuesday.",
    "candidate_name": "Asha",
    "candidate_email": "asha@example.com",
}

_PLACEHOLDER = re.compile(r"{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}")


@pytest.mark.parametrize("template_id", BOTH)
def test_every_variable_used_is_one_the_sender_supplies(template_id):
    template = BUILTIN_BY_ID[template_id]
    used = set(_PLACEHOLDER.findall(template["subject"] + template["body"]))
    missing = used - SENDER_CONTEXT.keys()
    assert not missing, f"{template_id} uses variables nobody supplies: {missing}"


@pytest.mark.parametrize("template_id", BOTH)
def test_nothing_unfilled_survives_rendering(template_id):
    template = BUILTIN_BY_ID[template_id]
    for part in ("subject", "body"):
        rendered = render(template[part], SENDER_CONTEXT)
        assert "{{" not in rendered, f"{template_id} {part} left a placeholder"
        assert rendered.strip()


@pytest.mark.parametrize("template_id", BOTH)
def test_the_recruiters_own_message_reaches_the_candidate(template_id):
    """The whole reason these templates exist. A body that renders without it is
    a form letter, which is what recruiters were leaving the app to avoid."""
    body = render(BUILTIN_BY_ID[template_id]["body"], SENDER_CONTEXT)
    assert SENDER_CONTEXT["recruiter_message"] in body


@pytest.mark.parametrize("template_id", BOTH)
def test_a_multi_line_message_keeps_its_line_breaks(template_id):
    """The message comes from a multi-line text field. Without pre-wrap every
    break the recruiter typed collapses into one run-on paragraph."""
    body = BUILTIN_BY_ID[template_id]["body"]
    para = next(
        line for line in body.splitlines() if "recruiter_message" in line
    )
    assert "pre-wrap" in para, "the message paragraph must preserve newlines"


@pytest.mark.parametrize("template_id", BOTH)
def test_an_empty_message_still_sends_a_coherent_email(template_id):
    """Publishing the outcome alone is allowed, so the mail has to stand up with
    the message blank — an unknown key renders as ''."""
    context = {**SENDER_CONTEXT, "recruiter_message": ""}
    body = render(BUILTIN_BY_ID[template_id]["body"], context)
    assert "{{" not in body
    assert SENDER_CONTEXT["interview_title"] in body
    assert SENDER_CONTEXT["recruiter_name"] in body


@pytest.mark.parametrize("template_id", BOTH)
def test_no_call_to_action_back_into_a_finished_process(template_id):
    body = BUILTIN_BY_ID[template_id]["body"]
    assert "interview_link" not in body
    assert "href" not in body, "a final-result email must not link into the test"


@pytest.mark.parametrize("template_id", BOTH)
def test_every_variable_is_advertised_to_the_template_editor(template_id):
    """A recruiter copying one of these into a custom template needs the
    variables listed, or they will edit around a placeholder they cannot fill."""
    template = BUILTIN_BY_ID[template_id]
    used = set(_PLACEHOLDER.findall(template["subject"] + template["body"]))
    assert used <= SUPPORTED_VARIABLES.keys()


def test_not_selected_does_not_congratulate_anybody():
    """One shell, two outcomes: the wrong half of a copy-paste is how a rejection
    ends up opening with 'Congratulations'."""
    body = render(BUILTIN_BY_ID[NOT_SELECTED]["body"], SENDER_CONTEXT).lower()
    for word in ("congratulations", "well done", "delighted"):
        assert word not in body


def test_cleared_does_not_promise_a_job():
    """Clearing every round is not an offer, and the app's own wording is careful
    about that — the email must not undo it."""
    body = render(BUILTIN_BY_ID[CLEARED]["body"], SENDER_CONTEXT).lower()
    for phrase in ("offer", "hired", "you got the job", "welcome to the team"):
        assert phrase not in body


@pytest.mark.parametrize("template_id", BOTH)
def test_send_delivers_one_mail_per_candidate(template_id):
    sent: list[dict] = []

    def _capture(settings, **kwargs):
        sent.append(kwargs)

    original, mailer.send = mailer.send, _capture
    try:
        r = client.post(
            "/api/emails/send",
            json={
                "template_id": template_id,
                "shared_context": {
                    k: v
                    for k, v in SENDER_CONTEXT.items()
                    if k not in ("candidate_name", "candidate_email")
                },
                "recipients": [
                    {"email": "asha@example.com", "name": "Asha"},
                    {"email": "bo@example.com", "name": "Bo"},
                ],
            },
        )
    finally:
        mailer.send = original

    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["total"], body["sent"], body["failed"]) == (2, 2, 0)
    assert body["template_id"] == template_id

    by_email = {m["to_email"]: m for m in sent}
    assert "Asha" in by_email["asha@example.com"]["body"]
    assert "Bo" in by_email["bo@example.com"]["body"]
    # The shared message goes to both; the name does not cross over.
    for mail in sent:
        assert SENDER_CONTEXT["recruiter_message"] in mail["body"]
        assert "{{" not in mail["body"]
        assert "{{" not in mail["subject"]

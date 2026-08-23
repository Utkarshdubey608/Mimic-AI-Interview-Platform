"""Tiny, safe template rendering + the built-in starter templates.

Recruiter-authored templates use `{{ variable }}` placeholders. We deliberately
do NOT use a full template engine (e.g. Jinja): recruiter input is only
semi-trusted and a full engine invites server-side template injection. This
renderer only substitutes known string values and never evaluates code.
"""

from __future__ import annotations

import re

# Variables the editor advertises and render() knows how to fill. Keep in sync
# with the "supported variables" list surfaced in the Flutter editor.
SUPPORTED_VARIABLES: dict[str, str] = {
    "candidate_name": "The candidate's name (falls back to their email).",
    "candidate_email": "The candidate's email address.",
    "interview_title": "Title of the interview / exam.",
    "interview_link": "Deep link that opens the assigned interview.",
    "recruiter_name": "Name of the recruiter sending the invite.",
    "company": "Company / organisation name.",
    "deadline": "When the interview must be completed by.",
    # Multi-round tests (see the app's InterviewRound): the round that just
    # closed, and what comes next.
    "round_title": "Name of the round this message is about.",
    "next_round": "Name of the round the candidate is moving on to.",
    # The end of a candidate's whole run at a test (see the app's
    # TestConclusion): the recruiter's own words, shown in the app AND mailed, so
    # the two cannot disagree.
    "recruiter_message": "The recruiter's message about the final result.",
}

_PLACEHOLDER = re.compile(r"{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}")


def render(template: str, context: dict[str, str]) -> str:
    """Replace every `{{ key }}` with context[key]; unknown keys become ''."""

    def _sub(match: re.Match[str]) -> str:
        value = context.get(match.group(1), "")
        return "" if value is None else str(value)

    return _PLACEHOLDER.sub(_sub, template)


def _shell(title_line: str, inner: str, cta_label: str | None = "Open your interview") -> str:
    """Wrap body content in the shared card layout so built-ins look alike."""
    cta = (
        f"""
      <p style="margin:24px 0;">
        <a href="{{{{ interview_link }}}}"
           style="background:#10B981;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:bold;">
          {cta_label}
        </a>
      </p>
      <p style="font-size:12px;color:#888;">
        Or paste this link into your browser:<br>{{{{ interview_link }}}}
      </p>"""
        if cta_label
        else ""
    )
    return f"""\
<!DOCTYPE html>
<html>
  <body style="font-family: Arial, sans-serif; color:#111;">
    <div style="max-width:600px;margin:auto;padding:24px;border:1px solid #e2e2e2;border-radius:10px;">
      <div style="font-size:20px;font-weight:bold;">{title_line}</div>
{inner}{cta}
      <div style="font-size:12px;margin-top:20px;color:#888;">
        You're receiving this because {{{{ recruiter_name }}}} assigned you an interview on {{{{ company }}}}.
      </div>
    </div>
  </body>
</html>
"""


# Ready-to-use templates every recruiter can pick without saving anything.
# Their ids are prefixed "builtin:" so /api/emails/send can tell them apart from
# Firestore document ids.
BUILTIN_TEMPLATES: list[dict] = [
    {
        "id": "builtin:interview_invite",
        "name": "Interview invite",
        "description": "First invitation with the interview link.",
        "is_html": True,
        "subject": "You've been invited to an interview: {{ interview_title }}",
        "body": _shell(
            "Hi {{ candidate_name }},",
            """
      <p style="line-height:1.6;margin-top:12px;">
        {{ recruiter_name }} has invited you to complete the
        <b>"{{ interview_title }}"</b> interview on {{ company }}.
      </p>""",
        ),
    },
    {
        "id": "builtin:interview_reminder",
        "name": "Interview reminder",
        "description": "Nudge for candidates who haven't started yet.",
        "is_html": True,
        "subject": "Reminder: your {{ interview_title }} interview is waiting",
        "body": _shell(
            "Hi {{ candidate_name }},",
            """
      <p style="line-height:1.6;margin-top:12px;">
        A quick reminder that your <b>"{{ interview_title }}"</b> interview with
        {{ company }} is still pending. It only takes a few minutes.
      </p>
      <p style="line-height:1.6;">Please complete it by <b>{{ deadline }}</b>.</p>""",
            cta_label="Start now",
        ),
    },
    {
        "id": "builtin:result_published",
        "name": "Results published",
        "description": "Tells a candidate their result is available.",
        "is_html": True,
        "subject": "Your {{ interview_title }} result is available",
        "body": _shell(
            "Hi {{ candidate_name }},",
            """
      <p style="line-height:1.6;margin-top:12px;">
        Thanks for completing the <b>"{{ interview_title }}"</b> interview.
        {{ recruiter_name }} has published your result — you can view it in the
        {{ company }} app.
      </p>""",
            cta_label="View my result",
        ),
    },
    # --- Round outcomes (multi-round tests) ---------------------------------
    # Both deliberately carry NO call-to-action button. `_shell`'s CTA points at
    # `interview_link`, which for these means the round the candidate has just
    # FINISHED — sending someone who advanced back to a closed round, and sending
    # someone who did not a link to reopen it, are both worse than no button. The
    # next round is invited separately, once it exists.
    {
        "id": "builtin:round_shortlist",
        "name": "Moving to the next round",
        "description": "Tells a shortlisted candidate they advanced past a round.",
        "is_html": True,
        "subject": "Good news about your {{ interview_title }} application",
        "body": _shell(
            "Hi {{ candidate_name }},",
            """
      <p style="line-height:1.6;margin-top:12px;">
        Thanks for completing <b>"{{ round_title }}"</b> for
        <b>{{ interview_title }}</b> at {{ company }}.
      </p>
      <p style="line-height:1.6;">
        We're pleased to let you know you've been shortlisted to continue to
        <b>{{ next_round }}</b>. {{ recruiter_name }} will be in touch shortly
        with the details and everything you need to prepare.
      </p>
      <p style="line-height:1.6;">Congratulations, and well done.</p>""",
            cta_label=None,
        ),
    },
    {
        "id": "builtin:round_not_advancing",
        "name": "Not advancing past a round",
        "description": "Tells a candidate they will not continue past a round.",
        "is_html": True,
        "subject": "Update on your {{ interview_title }} application",
        "body": _shell(
            "Hi {{ candidate_name }},",
            """
      <p style="line-height:1.6;margin-top:12px;">
        Thank you for taking the time to complete <b>"{{ round_title }}"</b> for
        <b>{{ interview_title }}</b> at {{ company }}.
      </p>
      <p style="line-height:1.6;">
        After careful review we've decided not to move your application forward
        to the next round on this occasion. This was a competitive process and
        the decision was a difficult one.
      </p>
      <p style="line-height:1.6;">
        We're genuinely grateful for your interest, and we'd welcome an
        application from you for future roles.
      </p>
      <p style="line-height:1.6;">Best wishes,<br>{{ recruiter_name }}</p>""",
            cta_label=None,
        ),
    },
    # --- The FINAL result (a whole test, not one round) ---------------------
    # A round outcome moves someone along; these two end the process. Both carry
    # `recruiter_message` — the same text the candidate reads in the app — because
    # this is the mail recruiters were previously writing by hand, and the reason
    # they were writing it by hand is that a fixed paragraph cannot say "we'd like
    # you to meet the team on Tuesday".
    #
    # `white-space:pre-wrap` is not cosmetic: the message comes from a multi-line
    # text field, and without it every line break the recruiter typed collapses.
    #
    # No call to action, for the same reason as the round-outcome pair above:
    # `interview_link` points at a round that is finished either way.
    {
        "id": "builtin:test_cleared",
        "name": "Final result — cleared every round",
        "description": "Tells a candidate they have finished the whole process.",
        "is_html": True,
        "subject": "Your {{ interview_title }} result",
        "body": _shell(
            "Hi {{ candidate_name }},",
            """
      <p style="line-height:1.6;margin-top:12px;">
        You've completed every round of <b>"{{ interview_title }}"</b> at
        {{ company }}. Congratulations, and thank you for the time you gave it.
      </p>
      <p style="line-height:1.6;white-space:pre-wrap;">{{ recruiter_message }}</p>
      <p style="line-height:1.6;">Best wishes,<br>{{ recruiter_name }}</p>""",
            cta_label=None,
        ),
    },
    {
        "id": "builtin:test_not_selected",
        "name": "Final result — not selected",
        "description": "Closes the process for a candidate who is not going further.",
        "is_html": True,
        "subject": "Update on your {{ interview_title }} application",
        "body": _shell(
            "Hi {{ candidate_name }},",
            """
      <p style="line-height:1.6;margin-top:12px;">
        Thank you for completing <b>"{{ interview_title }}"</b> at {{ company }}.
      </p>
      <p style="line-height:1.6;white-space:pre-wrap;">{{ recruiter_message }}</p>
      <p style="line-height:1.6;">
        We're genuinely grateful for your interest, and we'd welcome an
        application from you for future roles.
      </p>
      <p style="line-height:1.6;">Best wishes,<br>{{ recruiter_name }}</p>""",
            cta_label=None,
        ),
    },
    {
        "id": "builtin:plain_invite",
        "name": "Plain-text invite",
        "description": "No HTML — useful for strict inbox filters.",
        "is_html": False,
        "subject": "Interview invite: {{ interview_title }}",
        "body": """\
Hi {{ candidate_name }},

{{ recruiter_name }} has invited you to complete the "{{ interview_title }}"
interview on {{ company }}.

Open your interview: {{ interview_link }}

— {{ recruiter_name }}, {{ company }}
""",
    },
]

BUILTIN_BY_ID: dict[str, dict] = {t["id"]: t for t in BUILTIN_TEMPLATES}

# Used when a send request names no template (and supplies no inline content).
DEFAULT_TEMPLATE_ID = "builtin:interview_invite"
DEFAULT_TEMPLATE = BUILTIN_BY_ID[DEFAULT_TEMPLATE_ID]

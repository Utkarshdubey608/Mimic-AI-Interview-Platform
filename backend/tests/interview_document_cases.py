"""The input half of the interview-document golden contract.

Kept as code rather than JSON so each case can carry a comment explaining what it
pins. The OUTPUTS live in `contracts/interview_document.fixtures.json`, which is
asserted by BOTH this suite and `mobile_desktop_app_version/test/interview_contract_test.dart`
— that file is the contract between the Python writer and the Dart reader.

**Why this exists.** `interviews/{id}` is the one record both clients read and write.
Its field names are frozen because `interview.dart` reads them, but "frozen" was only
a convention written in a docstring, and a convention did not stop the web surface
from growing its own second copy of the schema. This file makes a rename fail a test
on both sides of the codebase instead of failing silently in production, where the
symptom is a candidate's interview not loading.

Adding a case is safe. Changing one means regenerating the fixtures
(`REGENERATE_INTERVIEW_FIXTURES=1 pytest tests/test_interview_contract.py`) and
updating the Dart side in the same commit.
"""

from __future__ import annotations

# Stand-in for Firestore's SERVER_TIMESTAMP, which is what production passes — the
# reason `build_assignment` takes the stamp as an argument instead of reading a clock.
#
# Deliberately an obvious marker rather than a plausible ISO date. A real-looking
# "2027-03-01T09:00:00+00:00" in the golden file reads as the document's true wire
# type, and it is not: these fields come back from Firestore as `Timestamp`, which is
# what `interview.dart` casts them to. A fixture that quietly implied otherwise sent
# the Dart contract test straight into a failed cast — so the marker says what it is,
# and the Dart side swaps in a real Timestamp with a comment pointing here.
STAMP = "<serverTimestamp>"

BASE = {
    "test_id": "test-1",
    "recruiter_id": "uid-recruiter",
    "recruiter_email": "grace@acme.test",
    "recruiter_name": "Grace Hopper",
    "candidate_email": "Ada@Example.test",
    "title": "Backend Engineer — Timed Q&A interview",
    "mode": "chat",
    "server_timestamp": STAMP,
}


def _assignment(**overrides) -> dict:
    return {**BASE, **overrides}


# ── assignment documents ──────────────────────────────────────────────────────
#
# Each case: a name (the key in the fixtures file), why it is pinned, and the kwargs
# handed to `interviews.build_assignment`.
ASSIGNMENT_CASES: list[dict] = [
    {
        "name": "assignment/chat",
        "why": "The ordinary path. Pins every frozen field name Dart reads.",
        "kwargs": _assignment(),
    },
    {
        "name": "assignment/email-is-lowercased",
        "why": (
            "`candidateEmailLower` is derived, never passed. Assignment is matched on "
            "it — the app stores no candidate uid, because the invite exists before "
            "the candidate has an account — so a stray capital would orphan the "
            "invite: the link works, the portal says they have none."
        ),
        "kwargs": _assignment(candidate_email="  MiXeD@Example.TEST  "),
    },
    {
        "name": "assignment/video-mode-maps-to-video-type",
        "why": (
            "`type` is DERIVED from `mode` and the two cannot be set independently. A "
            "document whose type disagrees with its mode runs one track in the browser "
            "and a different one on the phone."
        ),
        "kwargs": _assignment(mode="video", title="Backend Engineer — Video Interview interview"),
    },
    {
        "name": "assignment/avatar-is-a-video-type",
        "why": "video_avatar is in the video bucket, not the chat one.",
        "kwargs": _assignment(mode="video_avatar"),
    },
    {
        "name": "assignment/two-way-is-a-video-type",
        "why": "A live call is video to the Dart model, which has no richer bucket.",
        "kwargs": _assignment(mode="two_way"),
    },
    {
        "name": "assignment/voice-is-a-chat-type",
        "why": "Voice has no camera, so it falls in the chat bucket despite being live.",
        "kwargs": _assignment(mode="voice"),
    },
    {
        "name": "assignment/mcq-is-a-chat-type",
        "why": (
            "MCQ is web-only until the mobile runtime ships, and it reaches the Dart "
            "model as `type: chat`. Pinned so the interim gate on the mobile candidate "
            "home has a defined shape to recognise — it keys off `mode`, not `type`."
        ),
        "kwargs": _assignment(mode="mcq"),
    },
    {
        "name": "assignment/with-questions",
        "why": "A fixed question set embeds its questions as plain strings.",
        "kwargs": _assignment(questions=["Tell me about a hard bug.", "Why this role?"]),
    },
    {
        "name": "assignment/restricted-to-the-browser",
        "why": (
            "A recruiter can require a particular client — a coding-heavy screen that "
            "needs a keyboard. Written ONLY when restricted, so the common case adds "
            "nothing to the document."
        ),
        "kwargs": _assignment(allowed_devices=["web"]),
    },
    {
        "name": "assignment/restricted-to-the-apps",
        "why": "Order is canonical, so two equivalent selections store identically.",
        "kwargs": _assignment(allowed_devices=["desktop", "mobile"]),
    },
    {
        "name": "assignment/every-device-is-no-restriction",
        "why": (
            "Selecting all three IS unrestricted, so the field is absent. One "
            "representation means nothing downstream compares lists to answer "
            "\"is this restricted?\"."
        ),
        "kwargs": _assignment(allowed_devices=["web", "mobile", "desktop"]),
    },
    {
        "name": "assignment/named-candidate",
        "why": "A known candidate name is carried through rather than nulled.",
        "kwargs": _assignment(candidate_name="Ada Lovelace"),
    },
]


# ── test summary documents ────────────────────────────────────────────────────
TEST_SUMMARY_CASES: list[dict] = [
    {
        "name": "test-summary/chat",
        "why": (
            "The `tests/{testId}` metadata doc the mobile recruiter dashboard pages "
            "over. A batch created without one is invisible there — which is exactly "
            "what web-created batches were."
        ),
        "kwargs": {
            "recruiter_id": "uid-recruiter",
            "title": "Backend Engineer — Timed Q&A interview",
            "mode": "chat",
            "server_timestamp": STAMP,
        },
    },
    {
        "name": "test-summary/video",
        "why": "`type` derives from mode here too, via the same function.",
        "kwargs": {
            "recruiter_id": "uid-recruiter",
            "title": "Backend Engineer — Video Interview interview",
            "mode": "video",
            "server_timestamp": STAMP,
        },
    },
]


# ── the candidate disclosure allowlist ────────────────────────────────────────
#
# The most safety-critical cases in this file. Each supplies a whole interview
# document; the fixture records exactly what `candidate_result_view` returns.

# Everything the AI and the recruiter recorded. Deliberately mirrors
# `_recruiterResult` in the mobile suite's candidate_outcome_test.dart, so the two
# languages are refusing to disclose the same specific values.
FULL_RECRUITER_RESULT = {
    "overallScore": 87,
    "recommendation": "Strong Hire",
    "summary": "Excellent systems depth, hire immediately.",
    "strengths": ["Deep Flutter knowledge"],
    "improvements": ["Rambles under pressure"],
    "evaluatedBy": "ai",
    "evaluationError": "",
    "responses": [{"question": "Q1", "answer": "A1"}],
    "detail": {"perQuestion": [{"score": 9}], "kpiAverages": {"clarity": 8.1}},
    "twoWayReview": {"stars": 4, "notes": "Privately: a bit arrogant."},
    "outcome": "selected",
    "rank": 3,
    "rankOf": 40,
    "candidateNote": "We will be in touch to schedule the next round.",
}

DISCLOSURE_CASES: list[dict] = [
    {
        "name": "disclosure/published-selected",
        "why": (
            "The full recruiter evaluation is stored; the candidate gets three fields. "
            "If this fixture ever grows a key, something leaked."
        ),
        "document": {"resultPublished": True, "result": FULL_RECRUITER_RESULT},
    },
    {
        "name": "disclosure/published-rejected",
        "why": "A rejection says so plainly and still carries no score.",
        "document": {
            "resultPublished": True,
            "result": {
                **FULL_RECRUITER_RESULT,
                "outcome": "not_selected",
                "candidateNote": "Thank you for your time.",
            },
        },
    },
    {
        "name": "disclosure/unpublished-shows-nothing",
        "why": (
            "`resultPublished` is the only gate. A scored but unreleased result is "
            "invisible — releasing it stays a recruiter action."
        ),
        "document": {"resultPublished": False, "result": FULL_RECRUITER_RESULT},
    },
    {
        "name": "disclosure/legacy-result-reads-as-pending",
        "why": (
            "Published before outcomes existed, so there is no `outcome` key. It must "
            "read as under review — NOT fall back to the raw score it does have. That "
            "fallback is the exact leak this design closes."
        ),
        "document": {
            "resultPublished": True,
            "result": {
                "overallScore": 87,
                "summary": "Excellent systems depth.",
                "recommendation": "Strong Hire",
            },
        },
    },
    {
        "name": "disclosure/unknown-outcome-is-pending",
        "why": "An unrecognised wire value degrades to pending rather than passing through.",
        "document": {"resultPublished": True, "result": {"outcome": "probably?"}},
    },
    {
        "name": "disclosure/rank-without-total-is-dropped",
        "why": "A position with no total reads as a bare number out of nowhere.",
        "document": {
            "resultPublished": True,
            "result": {"outcome": "selected", "rank": 3},
        },
    },
    {
        "name": "disclosure/blank-note-is-dropped",
        "why": "An empty note must not render an empty card.",
        "document": {
            "resultPublished": True,
            "result": {"outcome": "selected", "candidateNote": "   "},
        },
    },
    {
        "name": "disclosure/no-result-at-all",
        "why": "Published with nothing stored is still nothing to show, not a crash.",
        "document": {"resultPublished": True},
    },
    {
        "name": "disclosure/a-future-field-is-not-disclosed",
        "why": (
            "THE allowlist test. A field nobody has considered yet is invisible by "
            "default. If this case ever starts returning `psychometricProfile`, the "
            "projection has become a filter and the safety property is gone."
        ),
        "document": {
            "resultPublished": True,
            "result": {
                "outcome": "selected",
                "psychometricProfile": "high neuroticism",
                "salaryRecommendation": 82000,
            },
        },
    },
]

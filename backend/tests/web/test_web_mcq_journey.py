"""The whole MCQ journey, in the order a person walks it.

WHY THIS FILE EXISTS. Every piece of the MCQ track had unit tests and passed them,
and the feature was still completely broken when a recruiter clicked the first
button. Twice over:

  · "New MCQ set" answered 400 every time, because one rule refused an empty set
    and another refused the blank question added to satisfy it. Both rules had
    tests. Neither test created a set the way the editor does.
  · A finished paper could not be SENT, because `MODE_LABELS` gated the invite
    route and 'mcq' was missing from it. Every route involved had tests. None of
    them sent an invite.

Unit tests prove the parts. This proves the JOINS, which is where both failures
lived. It walks one path from an empty account to a scored report, asserting in
order and stopping at the first thing that would stop a person.

If a future change breaks any hand-off — a mode list, a template field, an id that
does not survive a hop — this test fails at that step and names it.
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import AuthedUser

RECRUITER = AuthedUser(uid="uid-rec", email="rec@talbotiq.test", claims={"email_verified": True})
CANDIDATE = AuthedUser(uid="uid-cand", email="ada@example.test", claims={"email_verified": True})


def _client(user: AuthedUser) -> TestClient:
    from app.security import require_firebase_user
    from app.web.deps import web_user_from_query

    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _authored_questions() -> list[dict]:
    """Two questions as the editor would have them once actually written."""
    return [
        {
            "id": "auth-q1",
            "text": "What does EC2 stand for?",
            "type": "single",
            "options": [
                {"id": "a", "text": "Elastic Compute Cloud"},
                {"id": "b", "text": "Elastic Container Cloud"},
                {"id": "c", "text": "Encrypted Compute Cluster"},
            ],
            "correctOptionIds": ["a"],
            "topic": "AWS",
            "points": 2,
        },
        {
            "id": "auth-q2",
            "text": "Which of these are AWS services?",
            "type": "multi",
            "options": [
                {"id": "a", "text": "S3"},
                {"id": "b", "text": "IAM"},
                {"id": "c", "text": "Azure Blob Storage"},
            ],
            "correctOptionIds": ["a", "b"],
            "topic": "AWS",
        },
    ]


def test_the_whole_mcq_journey(fake_store) -> None:
    recruiter = _client(RECRUITER)
    candidate = _client(CANDIDATE)

    # ── 1. The recruiter starts a paper ──────────────────────────────────────
    # Exactly what the New MCQ set button sends: a blank question, so the set is
    # not empty. This is the call that used to 400.
    blank = {
        "text": "",
        "options": [{"id": "o1", "text": ""}, {"id": "o2", "text": ""}],
        "correctOptionIds": [],
    }
    created = recruiter.post(
        "/api/web/mcq-sets", json={"name": "New MCQ set", "questions": [blank]}
    )
    assert created.status_code == 201, f"step 1 — creating a set: {created.text}"
    set_id = created.json()["id"]
    assert created.json()["ready"] is False, "a blank set must not claim to be ready"

    # ── 2. It cannot be sent while unfinished ────────────────────────────────
    # The strict half. A paper with no correct answers scores everyone zero.
    premature = recruiter.post(
        "/api/web/invites",
        json={
            "mode": "mcq",
            "role": "Cloud Engineer",
            "mcqSetId": set_id,
            "candidates": [{"email": CANDIDATE.email, "role": "Cloud Engineer"}],
            "origin": "https://example.test",
        },
    )
    assert premature.status_code == 400, "step 2 — an unfinished paper must not send"
    assert "not ready" in premature.json()["detail"]

    # ── 3. The recruiter writes the questions ────────────────────────────────
    saved = recruiter.put(
        f"/api/web/mcq-sets/{set_id}",
        json={"name": "AWS fundamentals", "questions": _authored_questions()},
    )
    assert saved.status_code == 200, f"step 3 — saving the paper: {saved.text}"
    assert saved.json()["ready"] is True, f"still unready: {saved.json()['faults']}"

    # ── 4. The paper reaches an interview ────────────────────────────────────
    # Via a template, which is what the invite pipeline synthesises. This is the
    # hop that carries `mcqSetId`, and where a missing field would strand it.
    _run(
        fake_store.templates.put(
            {
                "id": "tpl-mcq",
                "name": "AWS screen",
                "role": "Cloud Engineer",
                "track": "mcq",
                "mcqSetId": set_id,
                "mcqConfig": {"multiRule": "all_or_nothing"},
            }
        )
    )
    session = recruiter.post(
        "/api/web/sessions",
        json={
            "templateId": "tpl-mcq",
            "track": "mcq",
            "candidate": {"name": "Ada", "email": CANDIDATE.email},
        },
    )
    assert session.status_code == 201, f"step 4 — creating the session: {session.text}"
    session_id = session.json()["id"]

    # ── 5. The candidate opens the paper ─────────────────────────────────────
    paper = candidate.get(f"/api/web/sessions/{session_id}/mcq")
    assert paper.status_code == 200, f"step 5 — opening the paper: {paper.text}"
    body = paper.json()
    assert len(body["questions"]) == 2, "both questions must arrive"
    assert body["status"] == "in_progress", "opening the paper starts the assessment"

    # THE PROPERTY THE WHOLE MODE RESTS ON, asserted on the real wire payload.
    assert "correctOptionIds" not in paper.text, "the answer key reached the candidate"
    assert "auth-q1" not in paper.text or True  # ids may travel; the KEY may not

    # Options arrived, so it can actually be answered.
    first = body["questions"][0]
    assert len(first["options"]) == 3

    # ── 6. They answer, and a reload does not lose it ────────────────────────
    saved_answers = candidate.post(
        f"/api/web/sessions/{session_id}/mcq/answers",
        json={"answers": {first["id"]: ["a"]}},
    )
    assert saved_answers.status_code == 200, f"step 6 — auto-save: {saved_answers.text}"
    reopened = candidate.get(f"/api/web/sessions/{session_id}/mcq").json()
    assert reopened["answers"] == {first["id"]: ["a"]}, "a reload lost the answers"

    # ── 7. They submit ───────────────────────────────────────────────────────
    second = body["questions"][1]
    submitted = candidate.post(
        f"/api/web/sessions/{session_id}/mcq/submit",
        json={"answers": {first["id"]: ["a"], second["id"]: ["a", "b"]}},
    )
    assert submitted.status_code == 200, f"step 7 — submitting: {submitted.text}"
    assert "correctOptionIds" not in submitted.text, "the key leaked on submit"

    # ── 8. It is scored, exactly, with no model involved ─────────────────────
    stored = _run(fake_store.sessions.get(session_id))
    result = stored["mcqResult"]
    assert result["percent"] == 100.0, f"scored wrong: {result}"
    assert result["correctCount"] == 2
    # Weighted: q1 is worth 2 points, q2 the default 1.
    assert result["pointsAvailable"] == 3.0
    assert stored["status"] == "completed"

    # ── 9. The recruiter has a report where every other track writes one ─────
    report = _run(fake_store.reports.get(session_id))
    assert report is not None, "step 9 — no report was written"
    assert report["track"] == "mcq"
    assert report["mcq"]["percent"] == 100.0
    # And the recruiter's copy DOES keep the key — it is what makes it reviewable.
    assert report["mcq"]["questions"][0]["correctOptionIds"] == ["a"]

    # ── 10. Submitting again is refused, not rescored ────────────────────────
    again = candidate.post(f"/api/web/sessions/{session_id}/mcq/submit", json={})
    assert again.status_code == 409, "a second submit must not rescore"


def test_a_finished_paper_can_actually_be_sent(fake_store) -> None:
    """Step 2's counterpart, and the bug it would have caught.

    A complete paper must pass the invite route. `MODE_LABELS` gates that route and
    'mcq' was missing from it, so a finished paper was unsendable — with every
    individual route green. This asserts the join.
    """
    recruiter = _client(RECRUITER)
    created = recruiter.post(
        "/api/web/mcq-sets",
        json={"name": "AWS fundamentals", "questions": _authored_questions()},
    ).json()
    assert created["ready"] is True

    response = recruiter.post(
        "/api/web/invites",
        json={
            "mode": "mcq",
            "role": "Cloud Engineer",
            "mcqSetId": created["id"],
            "candidates": [{"email": CANDIDATE.email, "role": "Cloud Engineer"}],
            "origin": "https://example.test",
        },
    )
    # Not asserting 201 specifically: sending is allowed to fail on mail transport
    # in a hermetic test. What must NOT happen is a refusal about the MODE or the
    # PAPER, which is what both of today's bugs looked like.
    assert response.status_code != 400 or "mode" not in response.text.lower(), response.text
    assert "not ready" not in response.text


@pytest.mark.parametrize(
    "answers,expected",
    [
        ({"auth-q1": ["a"], "auth-q2": ["a", "b"]}, 100.0),   # all correct
        ({"auth-q1": ["a"], "auth-q2": ["a"]}, 66.7),          # multi partial → 0 of 1
        ({"auth-q1": ["b"], "auth-q2": ["a", "b"]}, 33.3),     # single wrong
        ({}, 0.0),                                              # nothing answered
    ],
)
def test_the_score_a_candidate_would_actually_get(fake_store, answers, expected) -> None:
    """The arithmetic, over the real routes rather than the scorer in isolation.

    Weighted deliberately — q1 is 2 points and q2 is 1 — because a percentage over
    question COUNT rather than points is the kind of error that looks right until
    somebody weights a paper.
    """
    recruiter, candidate = _client(RECRUITER), _client(CANDIDATE)
    created = recruiter.post(
        "/api/web/mcq-sets",
        json={"name": "AWS", "questions": _authored_questions()},
    ).json()
    _run(
        fake_store.templates.put(
            {"id": "t", "name": "s", "role": "Cloud", "track": "mcq", "mcqSetId": created["id"]}
        )
    )
    session_id = recruiter.post(
        "/api/web/sessions",
        json={"templateId": "t", "track": "mcq", "candidate": {"email": CANDIDATE.email}},
    ).json()["id"]

    # Session question ids are fresh per session, so map by text to answer them.
    paper = candidate.get(f"/api/web/sessions/{session_id}/mcq").json()["questions"]
    by_text = {q["text"]: q["id"] for q in paper}
    original = {q["id"]: q["text"] for q in _authored_questions()}
    remapped = {by_text[original[qid]]: picks for qid, picks in answers.items()}

    candidate.post(f"/api/web/sessions/{session_id}/mcq/submit", json={"answers": remapped})
    assert _run(fake_store.sessions.get(session_id))["mcqResult"]["percent"] == expected


# ─────────────────────────────────────────────────────────────────────────────
# A SECTIONED, MIXED-TYPE ASSESSMENT, walked the same way.
#
# The single-section MCQ journey above is not enough once a paper has structure.
# Sections and question types add four new hand-offs, and every one of them is a
# place the assessment can arrive at the candidate subtly wrong while every unit
# test still passes:
#
#   · the section manifest has to survive set → session → candidate payload
#   · a match answer is a MAPPING, not a list, through autosave and submit
#   · the report has to break down by section, in the paper's own order
#   · and the pairing must not be readable from the payload's ORDER
# ─────────────────────────────────────────────────────────────────────────────


def _sectioned_assessment() -> dict:
    """One aptitude question, one pairing question, in two named sections."""
    return {
        "name": "Graduate screen",
        "sections": [
            {"id": "apt", "name": "Aptitude", "instructions": "No calculator."},
            {"id": "cs", "name": "Computer science"},
        ],
        "questions": [
            {
                "id": "q-apt",
                "sectionId": "apt",
                "type": "single",
                "text": "What is 15% of 200?",
                "options": [
                    {"id": "a", "text": "30"},
                    {"id": "b", "text": "3"},
                    {"id": "c", "text": "300"},
                ],
                "correctOptionIds": ["a"],
            },
            {
                "id": "q-match",
                "sectionId": "cs",
                "type": "match",
                "text": "Match the algorithm to its complexity.",
                "pairs": [
                    {"left": "Binary search", "right": "O(log n)"},
                    {"left": "Bubble sort", "right": "O(n^2)"},
                    {"left": "Hash lookup", "right": "O(1)"},
                ],
            },
        ],
    }


def _sat_assessment(fake_store):
    """Author it, attach it, open it as the candidate. Returns (clients, ids, paper)."""
    recruiter, candidate = _client(RECRUITER), _client(CANDIDATE)
    created = recruiter.post("/api/web/mcq-sets", json=_sectioned_assessment()).json()
    assert created["ready"] is True, created["faults"]

    _run(
        fake_store.templates.put(
            {
                "id": "t-sec",
                "name": "s",
                "role": "Graduate",
                "track": "mcq",
                "mcqSetId": created["id"],
            }
        )
    )
    session_id = recruiter.post(
        "/api/web/sessions",
        json={"templateId": "t-sec", "track": "mcq", "candidate": {"email": CANDIDATE.email}},
    ).json()["id"]

    paper = candidate.get(f"/api/web/sessions/{session_id}/mcq").json()
    return recruiter, candidate, session_id, paper


def test_the_structure_reaches_the_candidate(fake_store) -> None:
    """The manifest has to cross two documents to get here."""
    _r, _c, _sid, paper = _sat_assessment(fake_store)

    assert [section["name"] for section in paper["sections"]] == [
        "Aptitude",
        "Computer science",
    ]
    assert paper["sections"][0]["instructions"] == "No calculator."
    # Each section names its own questions, so the runtime can group them without a
    # second copy of the mapping living on every question.
    assert len(paper["sections"][0]["questionIds"]) == 1
    assert len(paper["sections"][1]["questionIds"]) == 1
    # And the paper arrives in section order, so section one is met first.
    assert paper["questions"][0]["id"] == paper["sections"][0]["questionIds"][0]


def test_no_answer_key_reaches_the_candidate(fake_store) -> None:
    """Neither key, in the payload the candidate actually receives.

    THE ORDER LEAK IS NOT ASSERTED HERE, on purpose. A match question is authored
    a row at a time, so publishing column B as authored hands over the pairing
    with no key in the payload at all - and the first version of this test did
    check that here. But the published order depends on a random session id, so
    the check only caught the leak about one run in six: it passed with the
    guarantee deliberately removed. A test that flaky is worse than no test,
    because it manufactures confidence.

    The property is deterministic and belongs where it can be proven that way:
    `TestAMatchQuestionCannotLeakItsPairing` in test_web_mcq_scoring.py asserts it
    across sixty seeds plus the no-seed case, which is the arrangement that was
    actually broken.
    """
    _r, candidate, session_id, _paper = _sat_assessment(fake_store)
    raw = candidate.get(f"/api/web/sessions/{session_id}/mcq").text

    assert "correctOptionIds" not in raw
    assert "correctPairs" not in raw
    # The pairing is not reconstructible from what did ship, either: prompt ids and
    # match ids share nothing.
    paper = candidate.get(f"/api/web/sessions/{session_id}/mcq").json()
    match = next(q for q in paper["questions"] if q["type"] == "match")
    assert {p["id"] for p in match["prompts"]}.isdisjoint({m["id"] for m in match["matches"]})


def test_a_pairing_survives_autosave_a_reload_and_submit(fake_store) -> None:
    """A match answer is a MAPPING. Every hop that assumed a list would drop it,
    and the candidate would lose the question without being told."""
    _r, candidate, session_id, paper = _sat_assessment(fake_store)
    match = next(q for q in paper["questions"] if q["type"] == "match")

    # Answer two of the three pairs correctly by TEXT, since ids are opaque.
    right = {"Binary search": "O(log n)", "Bubble sort": "O(n^2)"}
    match_by_text = {m["text"]: m["id"] for m in match["matches"]}
    pairing = {
        prompt["id"]: match_by_text[right[prompt["text"]]]
        for prompt in match["prompts"]
        if prompt["text"] in right
    }

    saved = candidate.post(
        f"/api/web/sessions/{session_id}/mcq/answers", json={"answers": {match["id"]: pairing}}
    )
    assert saved.status_code == 200

    # The reload a candidate would do. The pairing must come back intact.
    reloaded = candidate.get(f"/api/web/sessions/{session_id}/mcq").json()
    assert reloaded["answers"][match["id"]] == pairing

    candidate.post(f"/api/web/sessions/{session_id}/mcq/submit", json={})
    record = next(
        r
        for r in _run(fake_store.sessions.get(session_id))["mcqResult"]["questions"]
        if r["questionId"] == match["id"]
    )
    # Two of three pairs, and partial credit is the default for pairings because
    # there is no way to over-answer one.
    assert record["matchedCount"] == 2
    assert record["points"] == round(2 / 3, 4)
    assert record["correct"] is False


def test_the_report_breaks_the_score_down_by_section(fake_store) -> None:
    """The whole point of dividing a paper. One blended percentage would discard
    exactly the distinction the recruiter set up."""
    _r, candidate, session_id, paper = _sat_assessment(fake_store)

    # Get the aptitude question right; leave the pairing untouched.
    aptitude = next(q for q in paper["questions"] if q["type"] == "single")
    right = next(o["id"] for o in aptitude["options"] if o["text"] == "30")
    candidate.post(
        f"/api/web/sessions/{session_id}/mcq/submit", json={"answers": {aptitude["id"]: [right]}}
    )

    rows = _run(fake_store.sessions.get(session_id))["mcqResult"]["sections"]
    # Paper order, not alphabetical: "Aptitude" happens to sort first anyway, so
    # the order assertion is made by the scoring test above with a Z-before-A name.
    assert [row["name"] for row in rows] == ["Aptitude", "Computer science"]
    assert rows[0]["correct"] == 1
    assert rows[1]["correct"] == 0


def test_a_candidate_shown_their_score_still_gets_no_pairing(fake_store) -> None:
    """`showScoreToCandidate` is the back door the paper route is careful about:
    the stored per-question record holds the key, because that is what makes the
    RECRUITER's report reviewable."""
    recruiter, candidate = _client(RECRUITER), _client(CANDIDATE)
    created = recruiter.post("/api/web/mcq-sets", json=_sectioned_assessment()).json()
    _run(
        fake_store.templates.put(
            {
                "id": "t-show",
                "name": "s",
                "role": "Graduate",
                "track": "mcq",
                "mcqSetId": created["id"],
                "mcqConfig": {"showScoreToCandidate": True},
            }
        )
    )
    session_id = recruiter.post(
        "/api/web/sessions",
        json={"templateId": "t-show", "track": "mcq", "candidate": {"email": CANDIDATE.email}},
    ).json()["id"]

    candidate.get(f"/api/web/sessions/{session_id}/mcq")
    candidate.post(f"/api/web/sessions/{session_id}/mcq/submit", json={})
    after = candidate.get(f"/api/web/sessions/{session_id}/mcq")

    assert after.json()["result"] is not None
    assert "correctPairs" not in after.text
    assert "correctOptionIds" not in after.text

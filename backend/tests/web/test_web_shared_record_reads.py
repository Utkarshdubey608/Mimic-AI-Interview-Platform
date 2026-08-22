"""What the web shows for an interview it did not run.

Two defects with one cause. The web surface read scores from its own report store,
keyed by session id — and an interview a candidate took in the FLUTTER app has no web
session, so:

  * the recruiter's sessions list showed it "completed" with an empty score column,
    while the score sat on the interview document the row was built from; and
  * opening its report 404'd, because the engine that never ran had left no session to
    load.

Both are now served from the records the two clients share: `interviews/{id}` for the
assignment, `reports/{interviewId}` for the breakdown.
"""

from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from app import interviews, reports


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _mobile_interview(fake_firestore, **overrides) -> str:
    """An interview created and completed entirely on the phone.

    No `mode` (the mobile client does not write one yet) and no web session — the two
    things that made it invisible here.
    """
    document = {
        "recruiterId": "uid-recruiter",
        "candidateEmail": "Ada@Example.test",
        "candidateEmailLower": "ada@example.test",
        "candidateName": "Ada Lovelace",
        "title": "Backend Engineer — interview",
        "type": "chat",
        "questions": ["Tell me about a hard bug."],
        "status": "completed",
        "resultPublished": False,
        "result": {
            "overallScore": 74,
            "summary": "Solid fundamentals.",
            "recommendation": "yes",
            "strengths": ["Clear communicator"],
            "improvements": ["Shallow on concurrency"],
            "evaluatedBy": "ai",
        },
        **overrides,
    }
    collection = fake_firestore.collection(interviews.INTERVIEWS_COLLECTION)
    collection.docs["mob-1"] = document
    return "mob-1"


# ── the sessions list ─────────────────────────────────────────────────────────


def test_a_mobile_run_interview_shows_its_score(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """The defect: this column was hardcoded to None."""
    _mobile_interview(fake_firestore)

    rows = authed_client.get("/api/web/sessions").json()
    row = next(r for r in rows if r["id"] == "mob-1")

    assert row["status"] == "completed"
    assert row["overallScore"] == 74, (
        "the score is on the interview document this row was built from, and the list "
        "reported nothing"
    )


def test_an_unscored_interview_still_shows_no_score(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """Absent stays absent — a 0 would read as a real result, and would rank."""
    _mobile_interview(fake_firestore, result={"evaluatedBy": ""}, status="assigned")

    row = next(
        r for r in authed_client.get("/api/web/sessions").json() if r["id"] == "mob-1"
    )
    assert row["overallScore"] is None


# ── the report ────────────────────────────────────────────────────────────────


def test_the_report_opens_for_an_interview_taken_on_the_phone(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """It used to 404: no web session, so nothing to load."""
    _mobile_interview(fake_firestore)
    fake_firestore.collection(reports.REPORTS_COLLECTION).docs["mob-1"] = {
        "sessionId": "mob-1",
        "interviewId": "mob-1",
        "overallScore": 74,
        "summary": "Solid fundamentals.",
        "perQuestion": [{"question": "Tell me about a hard bug.", "score": 7}],
        "model": "gemini-2.5-flash",
    }

    response = authed_client.get("/api/web/sessions/mob-1/report")
    assert response.status_code == 200, response.text

    body = response.json()
    assert body["report"]["overallScore"] == 74
    assert body["report"]["perQuestion"], "the breakdown is the point of the report"
    assert body["session"]["candidate"]["email"] == "Ada@Example.test"
    assert body["session"]["templateName"] == "Backend Engineer — interview"


def test_the_report_falls_back_to_the_flat_result_when_there_is_no_report_doc(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """Scored before reports were shared, or the detail write failed.

    The score is the part that must never be missing, so it is rendered from
    `interviews.result` with an empty breakdown rather than 404ing.
    """
    _mobile_interview(fake_firestore)

    body = authed_client.get("/api/web/sessions/mob-1/report").json()
    assert body["report"]["overallScore"] == 74
    assert body["report"]["perQuestion"] == []


def test_integrity_is_reported_as_unmeasured_not_clean(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """Integrity monitoring is a web-runtime feature the phone does not have.

    The rubric is null for the same reason — inventing a default would make the report
    look scored against criteria nobody set.
    """
    _mobile_interview(fake_firestore)

    body = authed_client.get("/api/web/sessions/mob-1/report").json()
    assert body["session"]["integrityEvents"] == []
    assert body["session"]["tabSwitchCount"] == 0
    assert body["rubric"] is None


def test_another_recruiters_interview_is_a_404(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """404 not 403, matching the rest of this surface: a response never confirms that
    a record the caller cannot see exists."""
    _mobile_interview(fake_firestore, recruiterId="someone-else")

    assert authed_client.get("/api/web/sessions/mob-1/report").status_code == 404


def test_a_missing_interview_is_still_a_404(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    assert authed_client.get("/api/web/sessions/nope/report").status_code == 404


# ── device restrictions ───────────────────────────────────────────────────────


def test_a_browser_is_refused_an_interview_restricted_to_the_apps(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """Enforced at the CLAIM, before a session or template is written.

    Materialising first and refusing after would leave a session nobody can run.

    Note what is NOT needed here: a header. Reaching `/api/web/*` at all is being the
    browser, so `web` cannot be spoofed on this surface — unlike the Flutter side,
    where the client names its own platform.
    """
    _mobile_interview(
        fake_firestore,
        status="assigned",
        candidateEmailLower="recruiter@talbotiq.com",
        allowedDevices=["mobile", "desktop"],
    )

    response = authed_client.post("/api/web/sessions/mob-1/claim")
    assert response.status_code == 409, response.text
    assert "the mobile app or the desktop app" in response.json()["detail"]
    # Nothing materialised: no session for a candidate who cannot run it.
    assert _run(fake_store.sessions.get("mob-1")) is None


def test_a_browser_may_claim_an_interview_that_allows_the_web(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    _mobile_interview(
        fake_firestore,
        status="assigned",
        candidateEmailLower="recruiter@talbotiq.com",
        allowedDevices=["web"],
    )

    assert authed_client.post("/api/web/sessions/mob-1/claim").status_code in (200, 201)


def test_an_unrestricted_interview_is_claimable_as_before(
    authed_client: TestClient, fake_store, fake_firestore
) -> None:
    """Every document written before this feature existed has no field at all."""
    _mobile_interview(
        fake_firestore, status="assigned", candidateEmailLower="recruiter@talbotiq.com"
    )

    assert authed_client.post("/api/web/sessions/mob-1/claim").status_code in (200, 201)

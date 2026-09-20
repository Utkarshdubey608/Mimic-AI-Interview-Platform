"""The question-set wizard's importer.

These fixtures are deliberately the SAME ones as in
`web_version/talbotiq-platform/shared/questionParse.test.ts`. The browser parses a
paste with the TypeScript version and this parses the text pulled out of an
uploaded file; if they drift, the same list of questions imports differently
depending on whether the recruiter used the clipboard or attached a .docx, which
is the kind of difference nobody thinks to look for.

Nothing here calls Gemini. The one path that needs it — a photo or a scan — is
covered by asserting the REFUSAL when no key is configured, which is the branch a
recruiter actually hits.
"""

from __future__ import annotations

import asyncio
import io

import pytest

from app.web.services import question_import


def _extract(data: bytes, *, filename: str, content_type: str = "", settings=None) -> dict:
    return asyncio.run(
        question_import.extract_questions(
            settings or _NoKeySettings(), data, content_type=content_type, filename=filename
        )
    )


class _NoKeySettings:
    """A deployment with no Gemini key — the state every local-parse path must survive."""

    gemini_api_key = ""
    firestore_enabled = False


def _xlsx(rows: list[list[object]]) -> bytes:
    from openpyxl import Workbook

    workbook = Workbook()
    for row in rows:
        workbook.active.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


# ── the parser, shared with the browser ──────────────────────────────────────


def test_a_numbered_chatgpt_reply_loses_its_chatter() -> None:
    questions = question_import.parse_questions_from_text(
        "Here are 3 interview questions for a backend engineer:\n"
        "\n"
        "1. Walk me through how you'd design a rate limiter.\n"
        "2. What trade-offs did you hit with Kafka at your last job?\n"
        "3. Tell me about a production incident you owned.\n"
        "\n"
        "Hope this helps!"
    )

    assert [q["text"] for q in questions] == [
        "Walk me through how you'd design a rate limiter.",
        "What trade-offs did you hit with Kafka at your last job?",
        "Tell me about a production incident you owned.",
    ]


@pytest.mark.parametrize(
    "line",
    [
        "1) First question here?",
        "(2) Second question here?",
        "3 - Third question here?",
        "Q4. Fourth question here?",
        "Q: Fifth question here?",
        "Question 6 — Sixth question here?",
    ],
)
def test_every_numbering_dialect_is_stripped(line: str) -> None:
    questions = question_import.parse_questions_from_text(line)
    assert len(questions) == 1
    assert questions[0]["text"].startswith(("First", "Second", "Third", "Fourth", "Fifth", "Sixth"))


def test_section_headings_become_categories() -> None:
    questions = question_import.parse_questions_from_text(
        "## Technical Questions\n"
        "- How does a database index work?\n"
        "- When would you denormalise?\n"
        "\n"
        "**Behavioural questions:**\n"
        "* Tell me about a disagreement with a manager."
    )

    assert [q["category"] for q in questions] == ["Technical", "Technical", "Behavioural"]
    assert questions[2]["text"] == "Tell me about a disagreement with a manager."


def test_metadata_lines_attach_to_the_question_above() -> None:
    questions = question_import.parse_questions_from_text(
        "1. How would you shard this table?\n"
        "Category: Databases\n"
        "Ideal answer: names a shard key, mentions hot partitions.\n"
        "\n"
        "2. Why did you leave your last role?\n"
        "A: looks for a concrete, non-blaming reason."
    )

    assert len(questions) == 2
    assert questions[0]["category"] == "Databases"
    assert questions[0]["idealAnswerNotes"] == "names a shard key, mentions hot partitions."
    # "A:" is an answer, not the third question.
    assert questions[1]["idealAnswerNotes"] == "looks for a concrete, non-blaming reason."


def test_a_wrapped_question_is_one_question() -> None:
    questions = question_import.parse_questions_from_text(
        "What is the difference between\noptimistic and pessimistic locking?"
    )
    assert len(questions) == 1
    assert questions[0]["text"] == (
        "What is the difference between optimistic and pessimistic locking?"
    )


def test_finished_lines_stay_separate() -> None:
    questions = question_import.parse_questions_from_text(
        "What is your greatest strength?\nWhat is your greatest weakness?\nWhy this company?"
    )
    assert len(questions) == 3


@pytest.mark.parametrize("junk", ["", "   \n\n ", "N/A\n---\n42"])
def test_junk_yields_nothing(junk: str) -> None:
    assert question_import.parse_questions_from_text(junk) == []


def test_duplicates_are_dropped() -> None:
    questions = question_import.parse_questions_from_text(
        "1. Why SQL over NoSQL here?\n2. Why SQL over NoSQL here?"
    )
    assert len(questions) == 1


# ── spreadsheets ─────────────────────────────────────────────────────────────


def test_a_headered_sheet_maps_columns_by_name_in_any_order() -> None:
    result = _extract(
        _xlsx(
            [
                ["Ideal answer", "Question", "Topic"],
                ["mentions idempotency", "How do you make a webhook safe to retry?", "APIs"],
                ["", "  2. What is a dead letter queue?  ", "Queues"],
            ]
        ),
        filename="bank.xlsx",
    )

    assert result["source"] == "spreadsheet"
    assert result["warnings"] == []
    assert [q["text"] for q in result["questions"]] == [
        "How do you make a webhook safe to retry?",
        "What is a dead letter queue?",
    ]
    assert result["questions"][0]["idealAnswerNotes"] == "mentions idempotency"
    assert result["questions"][1]["category"] == "Queues"


def test_a_csv_with_no_header_says_which_column_it_guessed() -> None:
    csv = (
        b"Tell me about a system you designed end to end.,Design\n"
        b"How do you decide what to test?,Quality\n"
    )
    result = _extract(csv, filename="questions.csv")

    assert len(result["questions"]) == 2
    assert result["questions"][0]["category"] == "Design"
    assert any("No “Question” header" in w for w in result["warnings"])


def test_the_legacy_xls_format_says_what_to_do_instead() -> None:
    with pytest.raises(question_import.ImportUnsupported) as exc:
        _extract(b"\xd0\xcf\x11\xe0", filename="old.xls")
    assert "save it as .xlsx" in str(exc.value)


# ── documents ────────────────────────────────────────────────────────────────


def test_a_text_file_is_parsed_exactly_like_a_paste() -> None:
    body = b"Technical:\n1. What is a race condition?\n2. When would you use a queue?\n"
    result = _extract(body, filename="questions.txt", content_type="text/plain")

    assert result["source"] == "document"
    assert [q["text"] for q in result["questions"]] == [
        "What is a race condition?",
        "When would you use a queue?",
    ]
    assert all(q["category"] == "Technical" for q in result["questions"])


def test_a_document_with_nothing_readable_says_so_rather_than_failing() -> None:
    result = _extract(b"---\n42\nN/A\n", filename="notes.txt", content_type="text/plain")
    assert result["questions"] == []
    assert any("No questions were found" in w for w in result["warnings"])


def test_prose_comes_through_as_a_row_for_the_recruiter_to_delete() -> None:
    """Permissive on purpose — the wizard's review step is the gate.

    A sentence is not distinguishable from a question stated as one ("Tell me
    about a failure."), so a stray line from a document arrives as an editable
    row rather than being silently dropped. Dropping it would be the worse
    failure: a recruiter counting eleven questions into an import and finding
    ten has no way to know which one went.
    """
    result = _extract(
        b"Quarterly revenue was up.", filename="notes.txt", content_type="text/plain"
    )
    assert [q["text"] for q in result["questions"]] == ["Quarterly revenue was up."]


def test_an_unknown_file_type_is_refused_with_the_list_of_ones_that_work() -> None:
    with pytest.raises(question_import.ImportUnsupported) as exc:
        _extract(b"\x00\x01", filename="archive.zip", content_type="application/zip")
    assert "Excel/CSV" in str(exc.value)


# ── the one model path, from the side a recruiter without a key sees ─────────


def test_a_photo_without_a_gemini_key_explains_the_alternatives() -> None:
    with pytest.raises(question_import.ImportUnsupported) as exc:
        _extract(b"\x89PNG\r\n", filename="sheet.png", content_type="image/png")

    message = str(exc.value)
    assert "Gemini API key" in message
    # It must name what DOES work without one, or the recruiter is simply stuck.
    assert "spreadsheet" in message


# ── the prompt behind "write the remaining N" ────────────────────────────────


def test_the_generate_prompt_sends_the_draft_so_the_model_writes_around_it() -> None:
    prompt = question_import.build_generate_prompt(
        count=3,
        existing=["Why SQL over NoSQL here?", "How do you decide what to test?"],
        role="Backend Engineer",
        set_name="First round",
        topic="Kafka",
        difficulty="hard",
        style="technical",
    )

    assert "Write exactly 3 more interview questions" in prompt
    assert "Role: Backend Engineer." in prompt
    assert "Subject areas to cover: Kafka." in prompt
    assert "Pitch every question at hard difficulty." in prompt
    assert "1. Why SQL over NoSQL here?" in prompt
    assert "Do not repeat them" in prompt


def test_the_generate_prompt_handles_an_empty_draft() -> None:
    prompt = question_import.build_generate_prompt(
        count=1, existing=[], role=None, set_name=None, topic=None, difficulty="mixed", style="mix"
    )
    assert "Write exactly 1 more interview question to finish" in prompt
    assert "The set is empty so far" in prompt
    assert "Vary the difficulty" in prompt


# ── the routes ───────────────────────────────────────────────────────────────
#
# Thin by design, so only what the service cannot decide on its own is asserted
# here: that a file actually reaches the importer, that the importer's own
# recruiter-facing refusal survives as a 400 rather than being flattened into a
# generic 502, and that "write the rest" refuses up front on a deployment with
# no key instead of failing at the vendor.


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app
    from app.security import AuthedUser, require_firebase_user
    from app.web.deps import web_user_from_query

    user = AuthedUser(uid="uid-recruiter", email="recruiter@talbotiq.com", claims={})
    app = create_app()
    app.dependency_overrides[require_firebase_user] = lambda: user
    app.dependency_overrides[web_user_from_query] = lambda: user
    return TestClient(app)


def test_the_extract_route_imports_a_spreadsheet(fake_store) -> None:
    client = _client()
    csv = b"Question,Category\nHow do you test a queue consumer?,Quality\n"

    response = client.post(
        "/api/web/question-sets/extract",
        files={"file": ("bank.csv", csv, "text/csv")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "spreadsheet"
    assert body["questions"][0]["text"] == "How do you test a queue consumer?"
    assert body["questions"][0]["category"] == "Quality"


def test_the_extract_route_keeps_the_importers_own_message(fake_store) -> None:
    client = _client()

    response = client.post(
        "/api/web/question-sets/extract",
        files={"file": ("sheet.png", b"\x89PNG\r\n", "image/png")},
    )

    assert response.status_code == 400
    # The recruiter is told what to do instead, not "import failed".
    assert "Gemini API key" in response.json()["detail"]


def test_generate_more_refuses_before_calling_a_vendor_with_no_key(fake_store) -> None:
    client = _client()

    response = client.post(
        "/api/web/question-sets/generate-more",
        json={"count": 3, "existing": ["Why SQL over NoSQL here?"]},
    )

    assert response.status_code == 400
    assert "Settings" in response.json()["detail"]

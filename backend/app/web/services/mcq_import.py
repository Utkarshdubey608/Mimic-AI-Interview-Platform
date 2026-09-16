"""Importing MCQ questions from an uploaded spreadsheet or document.

Two extraction paths — a CSV/XLSX row schema (deterministic, no model call)
and a PDF/DOCX/TXT free-text extraction (via `resume_text.extract` then one
Gemini call) — converge on ONE review shape:

    {"valid": [...], "needsReview": [...], "rejected": [...]}

so the recruiter reviews an import the same way regardless of what kind of
file it came from. Every item that has enough to be worth looking at (i.e.
everything but a genuinely empty/optionless row) carries a full question
draft in `mcq_authoring`'s shape, tagged `source: "imported"`.

── Never auto-saved ──────────────────────────────────────────────────────────
Same "parse, then let a human decide" contract as
`invite_extract.extract_candidates` and MCQ's own AI-generation modes
(`mcq_gen.generate_for_section`). Nothing here writes to a set — the route
only returns these buckets; the recruiter confirms in the review UI, and the
accepted rows ride the ordinary `PUT /mcq-sets/{id}` save like any manually
typed question.

── Never invents a correct answer ────────────────────────────────────────────
A row/question whose correct answer cannot be confidently resolved keeps
`correctOptionIds: []` and lands in `needsReview` with a reason saying so —
never a guessed answer that would silently score every candidate on it
wrong (or, worse, right for the wrong reason).
"""

from __future__ import annotations

import json
import logging
import re
import uuid

from app import mcq_authoring, mcq_gen
from app.config import Settings
from app.web.services import gemini, invite_extract, resume_text

logger = logging.getLogger("web.mcq_import")

DOCUMENT_SUFFIXES = (".pdf", ".docx", ".txt", ".md")
SPREADSHEET_SUFFIXES = invite_extract.CSV_SUFFIXES + invite_extract.XLSX_SUFFIXES

# A generated batch is capped at MAX_QUESTIONS (40); an IMPORTED file is
# someone else's question bank and may legitimately be much larger — bounded
# here mainly to keep one upload from producing an unusable review table.
MAX_ROWS = 300
# How much of a document's extracted text reaches the extraction prompt.
# Bounds cost on an oversized upload; a real question paper is nowhere near
# this long as plain text.
MAX_EXTRACT_CHARS = 40_000

_QUESTION_HEADER = re.compile(r"\bquestion\b|\bprompt\b", re.IGNORECASE)
_OPTION_HEADERS = {
    letter: re.compile(rf"option[_ ]?{letter}\b|choice[_ ]?{letter}\b|^{letter}$", re.IGNORECASE)
    for letter in "abcde"
}
_ANSWER_HEADER = re.compile(r"correct[_ ]?answer|^answer$|^correct$", re.IGNORECASE)
_EXPLANATION_HEADER = re.compile(r"explanation|rationale", re.IGNORECASE)
_DIFFICULTY_HEADER = re.compile(r"difficulty|\blevel\b", re.IGNORECASE)
_TOPIC_HEADER = re.compile(r"\btopic\b|\bcategory\b|\bskill\b", re.IGNORECASE)

EXPECTED_COLUMNS_HINT = (
    "question, option_a, option_b, option_c, option_d, correct_answer, "
    "explanation, difficulty, topic"
)

EXTRACT_SYSTEM_INSTRUCTION = (
    "You extract already-written multiple-choice questions from a document — "
    "you do not invent new ones, and you do not solve anything the document "
    "does not already answer. The document may number questions and options "
    "in any style (\"QUESTION: / A. / B. / Answer: B\" or \"1. / a) / b) / "
    "Correct Answer: b\" or something else entirely), may put an answer key "
    "at the end rather than after each question, and may span a question or "
    "its options across several lines. Extract what is actually there."
)

EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}},
                    "correctAnswerConfident": {"type": "boolean"},
                    "correctOptionIndex": {"type": "integer"},
                    "explanation": {"type": "string"},
                },
                "required": ["text", "options", "correctAnswerConfident"],
            },
        }
    },
    "required": ["questions"],
}


def build_extract_prompt(text: str) -> str:
    return (
        "Extract every multiple-choice question from this document. For each one:\n"
        '- "text": the question itself, exactly as asked.\n'
        '- "options": every answer option offered, in the order given.\n'
        "- If, and only if, the document clearly marks or states the correct "
        'option (inline, or in an answer key elsewhere in the document), set '
        '"correctAnswerConfident": true and "correctOptionIndex" to its 0-based '
        'position in "options". If the correct answer is not clearly stated '
        'anywhere in the document, set "correctAnswerConfident": false and OMIT '
        '"correctOptionIndex" entirely — never guess.\n'
        '- Copy an explanation into "explanation" only if the document actually '
        "gives one; leave it out otherwise.\n"
        "- Skip anything that is not itself a real multiple-choice question "
        "(section headers, instructions, page numbers, an answer key's own "
        "listing).\n\n"
        f'DOCUMENT:\n"""{text[:MAX_EXTRACT_CHARS]}"""'
    )


def _cell(value: object) -> str:
    return "" if value is None else str(value).strip()


def _column_map(header: list[str]) -> dict[str, int] | None:
    """Header cells → {field: column index}. `None` when no question column
    is found at all — the one field every other one is meaningless without.
    """
    mapping: dict[str, int] = {}
    for index, raw_cell in enumerate(header):
        cell = _cell(raw_cell)
        if not cell:
            continue
        if "question" not in mapping and _QUESTION_HEADER.search(cell):
            mapping["question"] = index
            continue
        option_letter = next(
            (letter for letter, pattern in _OPTION_HEADERS.items() if pattern.search(cell)), None
        )
        if option_letter and f"option_{option_letter}" not in mapping:
            mapping[f"option_{option_letter}"] = index
            continue
        if "answer" not in mapping and _ANSWER_HEADER.search(cell):
            mapping["answer"] = index
            continue
        if "explanation" not in mapping and _EXPLANATION_HEADER.search(cell):
            mapping["explanation"] = index
            continue
        if "difficulty" not in mapping and _DIFFICULTY_HEADER.search(cell):
            mapping["difficulty"] = index
            continue
        if "topic" not in mapping and _TOPIC_HEADER.search(cell):
            mapping["topic"] = index
    return mapping if "question" in mapping else None


def _resolve_answer_index(answer: str, usable_options: list[str]) -> int | None:
    """A CSV's correct-answer cell as an index into the OPTIONS ACTUALLY KEPT
    (blank option cells already dropped) — a letter (A-E), a 0- or 1-based
    number, or the option's own text, matched in that order.
    """
    answer = (answer or "").strip()
    if not answer or not usable_options:
        return None

    # Letter and numeric forms fall through to a text match rather than
    # returning None outright — an option list that is itself numeric (e.g.
    # "3" / "4") means a numeric-looking answer cell like "4" is meant to
    # match an option's TEXT, not be read as a 0/1-based position that
    # happens not to resolve.
    if len(answer) == 1 and answer.upper() in "ABCDE":
        index = "ABCDE".index(answer.upper())
        if index < len(usable_options):
            return index
    elif answer.lstrip("-").isdigit():
        n = int(answer)
        if 0 <= n < len(usable_options):
            return n
        if 1 <= n <= len(usable_options):
            return n - 1

    lowered = answer.lower()
    for index, option in enumerate(usable_options):
        if option.strip().lower() == lowered:
            return index
    return None


def _classify(
    *,
    text: str,
    option_texts: list[str],
    correct_index: int | None,
    explanation: str | None,
    difficulty: str | None,
    topic: str | None,
    row_number: int,
    seen_normalised: set[str],
) -> dict:
    """One row/extracted-item → a review entry, in ONE of three buckets.

    Builds the fullest question draft the input supports even when it is
    heading for `needsReview` — the recruiter fixes it in place rather than
    retyping it from scratch just because the answer key was ambiguous.
    """
    text = (text or "").strip()
    if not text:
        return {"row": row_number, "bucket": "rejected", "reason": "No question text found."}

    options = [o.strip() for o in option_texts if (o or "").strip()]
    if len(options) < 2:
        return {
            "row": row_number,
            "bucket": "rejected",
            "reason": "Fewer than two answer options.",
            "text": text,
        }

    option_dicts = [{"id": uuid.uuid4().hex[:8], "text": o} for o in options]
    correct_ids: list[str] = []
    if correct_index is not None and 0 <= correct_index < len(option_dicts):
        correct_ids = [option_dicts[correct_index]["id"]]

    question: dict = {
        "id": uuid.uuid4().hex,
        "text": text,
        "options": option_dicts,
        "correctOptionIds": correct_ids,
        "type": "single",
        "source": "imported",
    }
    if explanation and explanation.strip():
        question["explanation"] = explanation.strip()[:2000]
    if difficulty and difficulty.strip().lower() in mcq_authoring.DIFFICULTIES:
        question["difficulty"] = difficulty.strip().lower()
    if topic and topic.strip():
        question["topic"] = topic.strip()[:120]

    key = mcq_gen.normalised_for_dedup(text)
    if key in seen_normalised:
        return {
            "row": row_number,
            "bucket": "needsReview",
            "question": question,
            "reason": "Possible duplicate of another question already in this import or section.",
        }
    seen_normalised.add(key)

    if not correct_ids:
        return {
            "row": row_number,
            "bucket": "needsReview",
            "question": question,
            "reason": "Correct answer needs review — not confidently detected.",
        }

    return {"row": row_number, "bucket": "valid", "question": question}


def _empty_buckets(error: str | None = None) -> dict:
    out: dict = {"valid": [], "needsReview": [], "rejected": []}
    if error:
        out["error"] = error
    return out


def import_from_spreadsheet(
    data: bytes, *, filename: str, existing_texts: list[str]
) -> dict:
    """CSV/XLSX rows → review buckets. Deterministic — no model call."""
    lowered = (filename or "").lower()
    if lowered.endswith(invite_extract.LEGACY_EXCEL_SUFFIXES):
        return _empty_buckets(
            "The old .xls format is not supported. Open the file and save it "
            "as .xlsx or .csv, then upload it again."
        )
    try:
        if lowered.endswith(invite_extract.XLSX_SUFFIXES):
            rows = invite_extract.rows_from_xlsx(data)
        else:
            rows = invite_extract.rows_from_csv(data)
    except Exception as exc:  # noqa: BLE001 - a corrupt upload is the recruiter's problem to see
        logger.info("mcq_import: could not read spreadsheet %r: %s", filename, type(exc).__name__)
        return _empty_buckets("That spreadsheet could not be read. Try re-saving it as .csv.")

    non_empty = [row for row in rows if any(_cell(c) for c in row)]
    if not non_empty:
        return _empty_buckets("The file is empty.")

    header = [_cell(c) for c in non_empty[0]]
    columns = _column_map(header)
    if columns is None:
        return _empty_buckets(
            f'No "question" column found. Expected headers like: {EXPECTED_COLUMNS_HINT}.'
        )

    seen = {mcq_gen.normalised_for_dedup(t) for t in existing_texts}
    buckets = _empty_buckets()
    data_rows = non_empty[1:][:MAX_ROWS]
    for offset, row in enumerate(data_rows):
        row_number = offset + 2  # 1 = header, so the first data row is row 2
        cells = [_cell(c) for c in row]

        def field(name: str) -> str:
            index = columns.get(name)
            return cells[index] if index is not None and index < len(cells) else ""

        options = [field(f"option_{letter}") for letter in "abcde"]
        usable_options = [o.strip() for o in options if o.strip()]
        correct_index = _resolve_answer_index(field("answer"), usable_options)

        item = _classify(
            text=field("question"),
            option_texts=options,
            correct_index=correct_index,
            explanation=field("explanation"),
            difficulty=field("difficulty"),
            topic=field("topic"),
            row_number=row_number,
            seen_normalised=seen,
        )
        buckets[item.pop("bucket")].append(item)

    return buckets


def _normalise_extracted(payload: dict) -> list[dict]:
    raw = payload.get("questions") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return []

    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = " ".join(str(item.get("text") or "").split())[:2000]
        if not text:
            continue
        options = [
            cleaned
            for opt in (item.get("options") or [])
            if (cleaned := " ".join(str(opt or "").split())[:500])
        ]
        confident = item.get("correctAnswerConfident") is True
        index = item.get("correctOptionIndex")
        correct_index = (
            index if confident and isinstance(index, int) and not isinstance(index, bool) else None
        )
        explanation = " ".join(str(item.get("explanation") or "").split())[:2000]
        out.append(
            {"text": text, "options": options, "correctIndex": correct_index, "explanation": explanation}
        )
    return out[:MAX_ROWS]


async def import_from_document(
    settings: Settings,
    data: bytes,
    *,
    content_type: str,
    filename: str,
    existing_texts: list[str],
) -> dict:
    """PDF/DOCX/TXT → review buckets, via `resume_text.extract` then one
    Gemini structured-extraction call. Raises on transport failure — the
    caller maps that onto a friendly error, same as MCQ's other Gemini call.
    """
    text = await resume_text.extract(data, content_type=content_type, filename=filename)
    if not text.strip():
        return _empty_buckets("Could not read any text from that file.")

    raw = await gemini.generate_text(
        settings,
        contents=gemini.user_turn(build_extract_prompt(text)),
        system_instruction=EXTRACT_SYSTEM_INSTRUCTION,
        response_schema=EXTRACT_SCHEMA,
        response_mime_type="application/json",
    )
    try:
        payload = json.loads(raw)
    except ValueError:
        logger.warning("mcq_import: extraction response was not JSON")
        return _empty_buckets("Nothing usable came back from extraction. Try again.")

    extracted = _normalise_extracted(payload)
    if not extracted:
        return _empty_buckets("No multiple-choice questions were found in that document.")

    seen = {mcq_gen.normalised_for_dedup(t) for t in existing_texts}
    buckets = _empty_buckets()
    for row_number, item in enumerate(extracted, start=1):
        classified = _classify(
            text=item["text"],
            option_texts=item["options"],
            correct_index=item["correctIndex"],
            explanation=item["explanation"],
            difficulty=None,
            topic=None,
            row_number=row_number,
            seen_normalised=seen,
        )
        buckets[classified.pop("bucket")].append(classified)

    return buckets


def is_spreadsheet(filename: str, content_type: str) -> bool:
    lowered = (filename or "").lower()
    mime = (content_type or "").lower()
    return (
        lowered.endswith(SPREADSHEET_SUFFIXES + invite_extract.LEGACY_EXCEL_SUFFIXES)
        or "spreadsheet" in mime
        or "excel" in mime
        or "csv" in mime
        or mime == "text/tab-separated-values"
    )

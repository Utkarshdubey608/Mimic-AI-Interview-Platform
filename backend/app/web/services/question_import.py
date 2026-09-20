"""Questions out of whatever a recruiter already has — the creation wizard's importer.

Ports `web_version/talbotiq-platform/shared/questionParse.ts` and
`server/services/questionExtract.ts`, and it is a port in the strict sense: the
browser runs the TypeScript parser over a PASTE so the recruiter sees the result
as they type, and this runs over the text pulled out of an uploaded file. The two
must agree, or the same list of questions would import differently depending on
whether it arrived through the clipboard or as a .docx. The fixtures in
`tests/web/test_web_question_import.py` are the same ones as in
`shared/questionParse.test.ts` for exactly that reason.

Three routes through `extract_questions`, and which one a file takes is the design:

  · SPREADSHEET (xlsx/csv/tsv) — read column-wise, locally. A question bank kept
    in Excel is the commonest thing a recruiter has, and importing it must not
    depend on a Gemini key or on a model reading a table correctly.
  · TEXT DOCUMENT (pdf/docx/txt) — text extracted locally, then parsed exactly
    as a paste is.
  · IMAGE, or a PDF with no text layer — a photo of a printed sheet, a scan, a
    screenshot. There is nothing to read locally, so it is transcribed by Gemini.
    The only path that needs a key, and the only one whose output is flagged
    back to the recruiter as "check this against the original".

Nothing here saves anything. It returns rows for the wizard's review step, which
is the only gate that matters on an imported question.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re

from app.config import Settings
from app.web.services import gemini, invite_extract, question_gen, resume_text

logger = logging.getLogger("web.question_import")

MAX_QUESTIONS = 200
#: Ceiling on one "write the rest for me" call. Matches `question_gen.MAX_QUESTIONS`.
MAX_GENERATE = 25

# ── Line shapes. Kept character-for-character in step with the TS regexes. ────

#: ``1.`` ``1)`` ``(1)`` ``1:`` ``1 -`` — the numbered list, in every dialect.
NUMBERED = re.compile(r"^\s*\(?\d{1,3}\)?\s*[.)\]:\-–—]\s+")
#: ``Q:`` ``Q1.`` ``Q 2)`` ``Question 3 -``
Q_PREFIX = re.compile(r"^\s*Q(?:uestion)?\s*\.?\s*\d{0,3}\s*[.)\]:\-–—]\s*", re.IGNORECASE)
#: ``-`` ``*`` ``•`` ``‣`` ``▪``
BULLET = re.compile(r"^\s*[-*•‣▪]\s+")
#: ``Category: Kafka`` — a tag for the question it follows.
META_CATEGORY = re.compile(
    r"^\s*(?:category|topic|area|skill|skills|tag|theme)\s*[:\-–]\s*(.+)$", re.IGNORECASE
)
#: ``Ideal answer: …`` ``Look for: …`` — scoring notes for the question above.
META_NOTES = re.compile(
    r"^\s*(?:ideal answer(?:\s*notes?)?|ideal|expected answer|model answer|sample answer"
    r"|answer|notes?|look for|what to look for|scoring notes|rubric)\s*[:\-–]\s*(.+)$",
    re.IGNORECASE,
)
#: ``A: …`` — the shorthand an LLM pairs with ``Q:``. Colon or full stop only, so
#: "A candidate calls you at 2am. What do you do?" is still a question.
SHORT_ANSWER = re.compile(r"^\s*A\s*\d{0,3}\s*[:.]\s+(.+)$")
MD_HEADING = re.compile(r"^\s*#{1,6}\s*(.+?)\s*$")
BOLD_LINE = re.compile(r"^\s*\*\*(.+?)\*\*\s*:?\s*$")
#: The model's own chatter around the list — never a question, never a category.
PREAMBLE = re.compile(
    r"\b(?:here (?:are|is)|below (?:are|is)|sure[,!]|certainly|of course"
    r"|i(?:'ve| have) (?:written|prepared|created)|hope (?:this|these) help"
    r"|let me know|feel free)",
    re.IGNORECASE,
)
#: Trailing noise on a heading: "Technical Questions:" → "Technical".
HEADING_TAIL = re.compile(r"\s*(?:interview\s+)?(?:questions?|section|round|part)\s*:?\s*$", re.IGNORECASE)
#: A rule, a row of dashes, a decorative separator — never content.
NOISE = re.compile(r"^[\W_]+$")

_ZERO_WIDTH = re.compile("[\u200b-\u200d\ufeff]")
_FENCE = re.compile(r"```[a-z]*\n?", re.IGNORECASE)
_ENDS_SENTENCE = re.compile(r"[?.!][\"”’)]?$")


def clean_text(raw: str | None) -> str:
    """Strip the formatting a model emits and a spreadsheet drags along."""
    text = raw or ""
    text = text.replace("**", "")
    text = re.sub(r"(^|\s)\*(?=\S)", r"\1", text)
    text = text.replace("*", "")
    text = text.replace("`", "")
    text = re.sub(r"^\s*#+\s*", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip().strip("\"“”'‘’").strip()


def _heading_to_category(line: str) -> str | None:
    match = MD_HEADING.match(line) or BOLD_LINE.match(line)
    text = clean_text(match.group(1) if match else line).rstrip(":")
    if not text or PREAMBLE.search(text):
        return None
    trimmed = HEADING_TAIL.sub("", text).strip()
    return (trimmed or text)[:60]


def _is_heading(line: str) -> bool:
    """A heading names a section; a question asks something. '?' settles it."""
    bare = line.strip()
    if not bare or "?" in bare:
        return False
    if MD_HEADING.match(bare) or BOLD_LINE.match(bare):
        return True
    return bare.endswith(":") and len(bare) <= 60 and len(bare.split()) <= 8


def _looks_like_question(text: str) -> bool:
    """Eight characters and three words, or a question mark. Rejects "N/A" and "42"."""
    stripped = text.strip()
    return len(stripped) >= 8 and ("?" in stripped or len(stripped.split()) >= 3)


def parse_questions_from_text(raw: str) -> list[dict]:
    """A block of text → questions. Never raises; unparseable input gives ``[]``.

    The rule that lets a wrapped question survive without merging an unmarked
    list into one: a line continues the previous question only while that
    question does not yet end in sentence punctuation.
    """
    if not raw or not raw.strip():
        return []

    text = raw.replace("\r\n", "\n").replace("\r", "\n")
    text = _FENCE.sub("", text)
    text = _ZERO_WIDTH.sub("", text)

    out: list[dict] = []
    category: str | None = None
    open_q: dict | None = None
    blank_before = True

    def push() -> None:
        nonlocal open_q
        if open_q and _looks_like_question(open_q["text"]):
            out.append(open_q)
        open_q = None

    for line in text.split("\n"):
        if not line.strip():
            blank_before = True
            continue

        if NOISE.match(line):
            push()
            blank_before = True
            continue

        # Metadata attaches to the question above it, so it is tested first —
        # "Answer: …" and "Category: …" would otherwise read as bulleted content.
        notes = META_NOTES.match(line) or SHORT_ANSWER.match(line)
        if notes and open_q:
            value = clean_text(notes.group(1))
            existing = open_q.get("idealAnswerNotes")
            open_q["idealAnswerNotes"] = f"{existing} {value}" if existing else value
            blank_before = False
            continue

        cat = META_CATEGORY.match(line)
        if cat:
            value = clean_text(cat.group(1))
            if open_q:
                open_q["category"] = value
            else:
                category = value  # a tag before the list applies to what follows
            blank_before = False
            continue

        if _is_heading(line):
            push()
            heading = _heading_to_category(line)
            if heading:
                category = heading
            blank_before = True
            continue

        marked = bool(NUMBERED.match(line) or Q_PREFIX.match(line) or BULLET.match(line))
        body = clean_text(BULLET.sub("", NUMBERED.sub("", Q_PREFIX.sub("", line))))
        if not body:
            blank_before = True
            continue

        if not marked and open_q and not blank_before and not _ENDS_SENTENCE.search(open_q["text"].strip()):
            open_q["text"] = f"{open_q['text']} {body}".strip()
            blank_before = False
            continue

        push()
        if not marked and PREAMBLE.search(body) and "?" not in body:
            blank_before = False
            continue
        open_q = {"text": body, "category": category, "idealAnswerNotes": None}
        blank_before = False

    push()
    return _deduplicate(out)


def _key(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _deduplicate(questions: list[dict]) -> list[dict]:
    """An LLM asked twice, or a file appended to itself, repeats."""
    seen: set[str] = set()
    out: list[dict] = []
    for question in questions:
        key = _key(question["text"])
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(question)
    return out


# ── Spreadsheets ──────────────────────────────────────────────────────────────

HEADER_QUESTION = re.compile(r"\b(question|prompt|ask|text)\b", re.IGNORECASE)
HEADER_CATEGORY = re.compile(r"\b(categor|topic|section|skill|area|tag|theme)", re.IGNORECASE)
HEADER_NOTES = re.compile(r"\b(ideal|expected|model|answer|notes?|look for|rubric|guidance)", re.IGNORECASE)


def questions_from_rows(rows: list[list[str]]) -> tuple[list[dict], bool, list[str]]:
    """Rows from a sheet → ``(questions, headered, warnings)``.

    With a header row the columns are mapped BY NAME in any order, so the
    template the wizard offers is a convention rather than a requirement.
    Without one the widest column is read as the questions and the recruiter is
    told so — a silent guess about which column held the question is how a set
    of categories ends up saved as the questions.
    """
    cell = invite_extract._cell  # noqa: SLF001 - the same "None → '' and strip" rule
    body_rows = [row for row in rows if any(cell(c) for c in row)]
    if not body_rows:
        return [], False, ["That sheet was empty."]

    warnings: list[str] = []
    first = [cell(c) for c in body_rows[0]]
    # A header cell NAMES a column; a question in the first row is not a header,
    # and the question mark is what tells them apart.
    headered = any(HEADER_QUESTION.search(c) and "?" not in c for c in first)

    notes_col = -1
    if headered:
        question_col = next(i for i, c in enumerate(first) if HEADER_QUESTION.search(c) and "?" not in c)
        category_col = next(
            (i for i, c in enumerate(first) if i != question_col and HEADER_CATEGORY.search(c)), -1
        )
        notes_col = next(
            (
                i
                for i, c in enumerate(first)
                if i not in (question_col, category_col) and HEADER_NOTES.search(c)
            ),
            -1,
        )
        body_rows = body_rows[1:]
    else:
        widths = [
            max((len(cell(row[i])) if i < len(row) else 0) for row in body_rows)
            for i in range(max(len(row) for row in body_rows))
        ]
        question_col = widths.index(max(widths)) if widths else 0
        category_col = 1 if question_col == 0 and len(widths) > 1 and 0 < widths[1] <= 40 else -1
        notes_col = 2 if category_col == 1 and len(widths) > 2 and widths[2] > 0 else -1
        warnings.append(
            f"No “Question” header was found, so column {chr(65 + question_col)} was read "
            "as the questions. Check them below before saving."
        )

    def at(row: list[str], index: int) -> str:
        return cell(row[index]) if 0 <= index < len(row) else ""

    questions: list[dict] = []
    seen: set[str] = set()
    skipped = 0
    for row in body_rows:
        raw = at(row, question_col)
        text = clean_text(BULLET.sub("", NUMBERED.sub("", Q_PREFIX.sub("", raw))))
        if not text:
            continue
        if not _looks_like_question(text) or _key(text) in seen:
            skipped += 1
            continue
        seen.add(_key(text))
        questions.append(
            {
                "text": text,
                "category": at(row, category_col) or None,
                "idealAnswerNotes": at(row, notes_col) or None,
            }
        )

    if skipped:
        warnings.append(
            f"{skipped} row{'' if skipped == 1 else 's'} skipped — empty, duplicated, or "
            "too short to be a question."
        )
    if not questions:
        warnings.append("No questions were found in that sheet.")
    return questions, headered, warnings


# ── Files ─────────────────────────────────────────────────────────────────────

IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".heic", ".heif")
DOC_SUFFIXES = (".pdf", ".docx", ".txt", ".md", ".rtf")

TRANSCRIBE_SYSTEM_INSTRUCTION = (
    "You are a careful transcriber of interview question sheets. You reproduce exactly "
    "what is on the page and never author new questions."
)

TRANSCRIBE_PROMPT = (
    "Transcribe every interview question visible in this file, in the order they appear.\n"
    "Transcribe ONLY what is written — never invent, complete or improve a question, and "
    "never add one that is not there. If a question is cut off or unreadable, transcribe "
    "the part you can read.\n"
    "Ignore page numbers, headers, footers, logos and answer choices.\n"
    'If a section heading groups some questions (e.g. "Technical", "Behavioural"), use it '
    "as their category; otherwise give each question a one or two word category of your own.\n"
    "If the page also states an expected or model answer for a question, put it in "
    "idealAnswerNotes; otherwise leave idealAnswerNotes empty.\n"
    "Return ONLY JSON matching the provided schema. If the file contains no interview "
    "questions at all, return an empty list."
)

QUESTION_LIST_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "category": {"type": "string"},
                    "idealAnswerNotes": {"type": "string"},
                },
                "required": ["text", "category", "idealAnswerNotes"],
            },
        }
    },
    "required": ["questions"],
}


class ImportUnsupported(ValueError):
    """The file cannot be read here, and the message says what to do instead.

    Carried as an exception rather than an empty result because every case is
    actionable by the recruiter — a different file, or a key in Settings — and a
    silent empty list reads as "your file had no questions in it".
    """


def _is_image(filename: str, content_type: str) -> bool:
    return (content_type or "").lower().startswith("image/") or (filename or "").lower().endswith(
        IMAGE_SUFFIXES
    )


def _normalise_model_questions(payload: object) -> list[dict]:
    """Model output → questions, through the SAME cleaner generated questions use.

    `question_gen.clean_question_text`, not the local `clean_text`: a question the
    model wrote here is read aloud by the voice and avatar tracks exactly as one
    from the résumé generator is, and the dash-style normalisation those tracks
    depend on lives there (see tests/web/test_web_dashes.py). Text the RECRUITER
    wrote keeps the local cleaner — their punctuation is theirs to choose.
    """
    raw = payload.get("questions") if isinstance(payload, dict) else None
    out: list[dict] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        text = question_gen.clean_question_text(str(item.get("text") or ""))
        if not text:
            continue
        out.append(
            {
                "text": text,
                "category": (str(item.get("category") or "").strip() or None),
                "idealAnswerNotes": (str(item.get("idealAnswerNotes") or "").strip() or None),
            }
        )
    return _deduplicate(out)


async def transcribe_with_model(settings: Settings, *, data: bytes, mime_type: str) -> list[dict]:
    """Read questions off an image or a scanned PDF. Raises on a Gemini failure."""
    text = await gemini.generate_text(
        settings,
        contents=[
            {
                "role": "user",
                "parts": [
                    {"inlineData": {"mimeType": mime_type, "data": base64.b64encode(data).decode()}},
                    {"text": TRANSCRIBE_PROMPT},
                ],
            }
        ],
        system_instruction=TRANSCRIBE_SYSTEM_INSTRUCTION,
        response_mime_type="application/json",
        response_schema=QUESTION_LIST_SCHEMA,
    )
    try:
        payload = json.loads(text or '{"questions":[]}')
    except (TypeError, ValueError) as exc:
        raise gemini.GeminiUnavailable("Gemini returned unreadable questions.") from exc
    return _normalise_model_questions(payload)


async def extract_questions(
    settings: Settings, data: bytes, *, content_type: str, filename: str
) -> dict:
    """``{questions, warnings, source}`` for the wizard's review step."""
    warnings: list[str] = []
    content_type = content_type or ""
    filename = filename or ""

    async def via_model(mime_type: str) -> dict:
        if not await gemini.is_enabled(settings):
            raise ImportUnsupported(
                "Reading questions out of a photo or a scan needs a Gemini API key. Add "
                "one in Settings, or upload a PDF, Word file, spreadsheet or text file "
                "instead — those are read without one."
            )
        questions = await transcribe_with_model(settings, data=data, mime_type=mime_type)
        warnings.append(
            "This file was read by AI, so check every question against the original "
            "before you save."
        )
        if not questions:
            warnings.append("No interview questions were found in that image.")
        return {"questions": questions[:MAX_QUESTIONS], "warnings": warnings, "source": "image"}

    # ── Spreadsheets ──
    if invite_extract._is_spreadsheet(filename, content_type):  # noqa: SLF001 - one rule, one place
        lowered = filename.lower()
        if lowered.endswith(invite_extract.LEGACY_EXCEL_SUFFIXES):
            raise ImportUnsupported(
                "That is the old .xls format, which cannot be read here. Open it in Excel "
                "and save it as .xlsx or .csv."
            )
        try:
            if lowered.endswith(invite_extract.XLSX_SUFFIXES) or "spreadsheetml" in content_type:
                rows = await asyncio.to_thread(invite_extract.rows_from_xlsx, data)
            else:
                rows = await asyncio.to_thread(invite_extract.rows_from_csv, data)
        except Exception as exc:  # noqa: BLE001 - a corrupt upload is the recruiter's to fix
            logger.info("could not read spreadsheet %r: %s", filename, type(exc).__name__)
            raise ImportUnsupported(
                "That spreadsheet could not be opened. Re-save it as .xlsx or .csv and try again."
            ) from exc
        questions, _headered, sheet_warnings = questions_from_rows(rows)
        return {
            "questions": questions[:MAX_QUESTIONS],
            "warnings": warnings + sheet_warnings,
            "source": "spreadsheet",
        }

    # ── Images ──
    if _is_image(filename, content_type):
        return await via_model(content_type or "image/jpeg")

    # ── PDFs: the text layer first, the model only when there isn't one ──
    if content_type == resume_text.PDF_MIME or filename.lower().endswith(".pdf"):
        text = await resume_text.extract(data, content_type=content_type, filename=filename)
        questions = parse_questions_from_text(text)
        if questions:
            return {"questions": questions[:MAX_QUESTIONS], "warnings": warnings, "source": "document"}
        if not await gemini.is_enabled(settings):
            raise ImportUnsupported(
                "No questions could be picked out of that PDF. Check it holds a list of "
                "questions, or paste them in as text instead."
                if text.strip()
                else "That PDF has no readable text — it looks like a scan. Reading a scan "
                "needs a Gemini API key (add one in Settings), or you can paste the "
                "questions in as text."
            )
        warnings.append("That PDF had no text layer, so it was read as a scan.")
        return await via_model(resume_text.PDF_MIME)

    # ── Word / text ──
    if filename.lower().endswith(DOC_SUFFIXES) or content_type.startswith("text/") or content_type == resume_text.DOCX_MIME:
        text = await resume_text.extract(data, content_type=content_type, filename=filename)
        questions = parse_questions_from_text(text)
        if not questions:
            warnings.append(
                "No questions were found in that file. Each question should sit on its own "
                "line, numbered or bulleted."
            )
        return {"questions": questions[:MAX_QUESTIONS], "warnings": warnings, "source": "document"}

    raise ImportUnsupported(
        "Unsupported file type. Upload a photo, PDF, Word document, text file, or an "
        "Excel/CSV spreadsheet."
    )


# ── Filling the gap ───────────────────────────────────────────────────────────

GENERATE_SYSTEM_INSTRUCTION = (
    "You are an expert interviewer completing a colleague's draft question set. You never "
    "duplicate a question they have already written."
)


def build_generate_prompt(
    *,
    count: int,
    existing: list[str],
    role: str | None,
    set_name: str | None,
    topic: str | None,
    difficulty: str,
    style: str,
) -> str:
    """The prompt behind "write the remaining N". Pure, so it can be asserted on."""
    style_line = (
        "Every question must be TECHNICAL — about tools, systems, and how the candidate "
        "works with them."
        if style == "technical"
        else "Every question must be NON-TECHNICAL — behavioural, situational, or about "
        "ways of working."
        if style == "non_technical"
        else "Mix technical and behavioural questions."
    )
    difficulty_line = (
        "Vary the difficulty from warm-up to genuinely challenging."
        if difficulty in ("", "mixed")
        else f"Pitch every question at {difficulty} difficulty."
    )
    context = " ".join(
        part
        for part in (
            f"Role: {role}." if role else "",
            f'The set is called "{set_name}".' if set_name else "",
            f"Subject areas to cover: {topic}." if topic else "",
        )
        if part
    )
    already = [text for text in existing if text.strip()][:60]
    tail = (
        "These questions are ALREADY in the set. Do not repeat them, do not rephrase them, "
        "and do not ask about the same thing from a different angle. Cover what they leave "
        "out:\n" + "\n".join(f"{i + 1}. {text}" for i, text in enumerate(already))
        if already
        else "The set is empty so far, so cover the ground a first-round interview for this "
        "role should cover."
    )

    return (
        f"Write exactly {count} more interview question{'' if count == 1 else 's'} to finish a "
        "question set a recruiter is building.\n"
        f"{context}\n{style_line}\n{difficulty_line}\n"
        "Keep each question SHORT and conversational: one or two sentences, at most ~30 words, "
        "asking one clear thing. Plain text only, no markdown, no bullets, no numbering, and no "
        "em dashes.\n"
        "Give each one a one or two word category, and one sentence of ideal-answer notes a "
        "human scorer can use.\n"
        f"{tail}\n"
        "Return ONLY JSON matching the provided schema."
    )


async def generate_more(
    settings: Settings,
    *,
    count: int,
    existing: list[str],
    role: str | None = None,
    set_name: str | None = None,
    topic: str | None = None,
    difficulty: str = "mixed",
    style: str = "mix",
) -> list[dict]:
    """The questions a draft set is still missing. Raises on a Gemini failure.

    `existing` is the whole draft, sent verbatim so the model writes AROUND it.
    The duplicate filter afterwards is belt and braces: the recruiter asked for a
    gap to be filled, and being handed a question they already wrote is the one
    failure that makes the feature not worth pressing again.
    """
    prompt = build_generate_prompt(
        count=count,
        existing=existing,
        role=role,
        set_name=set_name,
        topic=topic,
        difficulty=difficulty,
        style=style,
    )

    text = await gemini.generate_text(
        settings,
        contents=gemini.user_turn(prompt),
        system_instruction=GENERATE_SYSTEM_INSTRUCTION,
        response_mime_type="application/json",
        response_schema=QUESTION_LIST_SCHEMA,
    )
    try:
        payload = json.loads(text or '{"questions":[]}')
    except (TypeError, ValueError) as exc:
        raise gemini.GeminiUnavailable("Gemini returned unparseable questions.") from exc

    seen = {_key(text) for text in existing if text.strip()}
    out: list[dict] = []
    for question in _normalise_model_questions(payload):
        key = _key(question["text"])
        if key in seen:
            continue
        seen.add(key)
        out.append(question)
        if len(out) == count:
            break
    return out

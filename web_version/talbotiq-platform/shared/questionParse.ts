/**
 * Turning what a recruiter already has into interview questions.
 *
 * A recruiter arrives at the question-set wizard holding one of three things:
 * a block of text an LLM wrote for them, a file somebody sent them, or nothing
 * but their own head. The first two are the same problem — SOMEONE ELSE'S
 * FORMATTING — and this module is the answer to it.
 *
 * Everything here is pure and shared: the wizard parses a paste in the browser
 * (instant, no round-trip, works with no API key), and the server runs the same
 * functions over the text it pulls out of a PDF, a DOCX or a spreadsheet, so a
 * question imported by file lands in exactly the shape a pasted one does.
 *
 * The formats this has to survive, all of them real output from real tools:
 *
 *   1. What is your…            ← numbered, the ChatGPT default
 *   1) / (1) / 1 - / Q1. / Q:   ← the same list, five other ways
 *   - / * / •                   ← bulleted
 *   **Technical Questions**     ← a section heading, which becomes a CATEGORY
 *   Category: Kafka             ← an explicit tag on the question above it
 *   Ideal answer: mentions…     ← scoring notes on the question above it
 *   A wrapped question that
 *   continues on the next line  ← ONE question, not two
 *
 * The rule that makes wrapped lines work without breaking unmarked lists: a
 * line continues the previous question only when that question does not yet end
 * in sentence punctuation. "What is X?" followed by "What is Y?" is two
 * questions; "What is the difference" followed by "between X and Y?" is one.
 */

export interface ParsedQuestion {
  text: string
  category?: string
  idealAnswerNotes?: string
}

/* ── Line shapes ─────────────────────────────────────────────────────────── */

/** `1.` `1)` `(1)` `1:` `1 -` — the numbered list, in every dialect. */
const NUMBERED = /^\s*\(?\d{1,3}\)?\s*[.)\]:\-–—]\s+/
/** `Q:` `Q1.` `Q 2)` `Question 3 -` */
const Q_PREFIX = /^\s*Q(?:uestion)?\s*\.?\s*\d{0,3}\s*[.)\]:\-–—]\s*/i
/** `-` `*` `•` `‣` `▪` */
const BULLET = /^\s*[-*•‣▪]\s+/
/** `Category: Kafka` — a tag for the question it follows. */
const META_CATEGORY = /^\s*(?:category|topic|area|skill|skills|tag|theme)\s*[:\-–]\s*(.+)$/i
/** `Ideal answer: …` `Look for: …` — scoring notes for the question above. */
const META_NOTES =
  /^\s*(?:ideal answer(?:\s*notes?)?|ideal|expected answer|model answer|sample answer|answer|notes?|look for|what to look for|scoring notes|rubric)\s*[:\-–]\s*(.+)$/i
/** `A: …` — the shorthand an LLM pairs with `Q:`. Colon or full stop only, so
 *  "A candidate calls you at 2am — what do you do?" is still a question. */
const SHORT_ANSWER = /^\s*A\s*\d{0,3}\s*[:.]\s+(.+)$/
/** `## Technical` or `**Behavioural questions**` or `Behavioural questions:` */
const MD_HEADING = /^\s*#{1,6}\s*(.+?)\s*$/
const BOLD_LINE = /^\s*\*\*(.+?)\*\*\s*:?\s*$/
/** The model's own chatter around the list — never a question, never a category. */
const PREAMBLE =
  /\b(?:here (?:are|is)|below (?:are|is)|sure[,!]|certainly|of course|i(?:'ve| have) (?:written|prepared|created)|hope (?:this|these) help|let me know|feel free)/i
/** Trailing noise on a heading: "Technical Questions:" → "Technical". */
const HEADING_TAIL = /\s*(?:interview\s+)?(?:questions?|section|round|part)\s*:?\s*$/i

/**
 * Strip the formatting a model emits and a spreadsheet drags along, so what is
 * stored is plain prose. Mirrors `cleanQuestionText` on the server (which does
 * the same job for Gemini's output) rather than importing it — that one lives
 * in a server-only module that pulls in the Gemini SDK.
 */
export function cleanText(raw: string): string {
  return (raw ?? '')
    .replace(/\*\*/g, '')          // **bold**
    .replace(/(^|\s)\*(?=\S)/g, '$1') // *emphasis* openers (not a bare bullet)
    .replace(/\*/g, '')
    .replace(/`+/g, '')            // `code`
    .replace(/^\s*#+\s*/, '')      // # heading
    .replace(/\s+/g, ' ')
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
    .trim()
}

/** `**Technical Questions:**` → `Technical`. Empty when the line is just chatter. */
function headingToCategory(line: string): string | undefined {
  const heading = MD_HEADING.exec(line)?.[1] ?? BOLD_LINE.exec(line)?.[1] ?? line
  const text = cleanText(heading).replace(/:$/, '')
  if (!text || PREAMBLE.test(text)) return undefined
  const trimmed = text.replace(HEADING_TAIL, '').trim()
  return (trimmed || text).slice(0, 60)
}

/**
 * Is this line a heading rather than a question? Only three shapes qualify, and
 * a line with a question mark never does — "Ready for the hard ones:" is a
 * heading, "Can you walk me through it:" is somebody's punctuation slip.
 */
function isHeading(line: string): boolean {
  const bare = line.trim()
  if (!bare || bare.includes('?')) return false
  if (MD_HEADING.test(bare) && !/\?/.test(bare)) return true
  if (BOLD_LINE.test(bare)) return true
  // A short line ending in a colon, with no sentence before it.
  return bare.endsWith(':') && bare.length <= 60 && bare.split(/\s+/).length <= 8
}

/** Does this text read as finished? Decides continuation vs. a new question. */
const ENDS_SENTENCE = (s: string) => /[?.!]["”’)]?$/.test(s.trim())

/**
 * Is this worth keeping as a question? Eight characters and three words rejects
 * "N/A", page numbers, column letters and stray table cells — with a question
 * mark standing in for the word count, so "Why SQL?" survives.
 */
function LOOKS_LIKE_QUESTION(s: string): boolean {
  const t = s.trim()
  return t.length >= 8 && (t.includes('?') || t.split(/\s+/).length >= 3)
}

/** A rule, a row of dashes, a decorative separator — never content. */
const NOISE = /^[\W_]+$/

/**
 * Parse a block of text — pasted from an LLM, or extracted from a document —
 * into questions. Never throws: unparseable input returns an empty array, which
 * the wizard shows as "we couldn't find any questions in that".
 */
export function parseQuestionsFromText(raw: string): ParsedQuestion[] {
  if (!raw || !raw.trim()) return []

  const lines = raw
    .replace(/\r\n?/g, '\n')
    .replace(/```[a-z]*\n?/gi, '')  // fenced code blocks an LLM wrapped the list in
    .replace(/[\u200B-\u200D\uFEFF]/g, '')  // zero-width junk from a web paste
    .split('\n')

  const out: ParsedQuestion[] = []
  let category: string | undefined
  let open: ParsedQuestion | null = null
  let blankBefore = true

  const push = () => {
    if (open && LOOKS_LIKE_QUESTION(open.text)) out.push(open)
    open = null
  }

  for (const line of lines) {
    if (!line.trim()) { blankBefore = true; continue }

    if (NOISE.test(line)) { push(); blankBefore = true; continue }

    // Metadata attaches to the question above it, so it is tested first — both
    // `Answer: …` and `Category: …` would otherwise read as bulleted content.
    const notes = META_NOTES.exec(line) ?? SHORT_ANSWER.exec(line)
    if (notes && open) {
      const value = cleanText(notes[1])
      open.idealAnswerNotes = open.idealAnswerNotes ? `${open.idealAnswerNotes} ${value}` : value
      blankBefore = false
      continue
    }
    const cat = META_CATEGORY.exec(line)
    if (cat) {
      const value = cleanText(cat[1])
      if (open) open.category = value
      else category = value       // a tag before the list applies to what follows
      blankBefore = false
      continue
    }

    if (isHeading(line)) {
      push()
      const next = headingToCategory(line)
      if (next) category = next
      blankBefore = true
      continue
    }

    const marked = NUMBERED.test(line) || Q_PREFIX.test(line) || BULLET.test(line)
    const body = cleanText(line.replace(Q_PREFIX, '').replace(NUMBERED, '').replace(BULLET, ''))
    if (!body) { blankBefore = true; continue }

    // A marker always starts a question. Without one, the line continues the
    // question above only when that question is unfinished AND no blank line
    // separated them — otherwise it is the next question in an unmarked list.
    if (!marked && open && !blankBefore && !ENDS_SENTENCE(open.text)) {
      open.text = `${open.text} ${body}`.trim()
      blankBefore = false
      continue
    }

    push()
    if (!marked && PREAMBLE.test(body) && !body.includes('?')) { blankBefore = false; continue }
    open = { text: body, category }
    blankBefore = false
  }
  push()

  // De-duplicate — an LLM asked twice, or a file appended to itself, repeats.
  const seen = new Set<string>()
  return out.filter((q) => {
    const key = q.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* ── Spreadsheets ────────────────────────────────────────────────────────── */

export interface SheetParseResult {
  questions: ParsedQuestion[]
  /** A header row was found and its columns were mapped by name. */
  headered: boolean
  warnings: string[]
}

const HEADER_QUESTION = /\b(question|prompt|ask|text)\b/i
const HEADER_CATEGORY = /\b(categor|topic|section|skill|area|tag|theme)/i
const HEADER_NOTES = /\b(ideal|expected|model|answer|notes?|look for|rubric|guidance)/i

/**
 * Rows from an Excel / CSV sheet → questions.
 *
 * With a header row the columns are mapped by name, in any order, so the
 * template this ships ("Question, Category, Ideal answer") is a convention and
 * not a requirement. Without one, the first column is the question and the next
 * two are guessed — reported as a warning, because a silent guess about which
 * column held the question is how a set of categories ends up as the questions.
 */
export function questionsFromRows(aoa: unknown[][]): SheetParseResult {
  const cell = (v: unknown) => (v == null ? '' : String(v).trim())
  const rows = (aoa ?? []).filter((r) => Array.isArray(r) && r.some((c) => cell(c) !== ''))
  if (rows.length === 0) return { questions: [], headered: false, warnings: ['That sheet was empty.'] }

  const warnings: string[] = []
  const first = rows[0].map(cell)
  // A header cell NAMES a column; a question in the first row is not a header,
  // and the question mark is what tells them apart.
  const headered = first.some((c) => HEADER_QUESTION.test(c) && !c.includes('?'))

  let qCol = 0
  let cCol = -1
  let nCol = -1
  let body = rows

  if (headered) {
    qCol = first.findIndex((c) => HEADER_QUESTION.test(c) && !c.includes('?'))
    cCol = first.findIndex((c, i) => i !== qCol && HEADER_CATEGORY.test(c))
    nCol = first.findIndex((c, i) => i !== qCol && i !== cCol && HEADER_NOTES.test(c))
    body = rows.slice(1)
  } else {
    // Take the first column that actually holds sentences; a sheet exported
    // from a tracker often opens with an id or a row number.
    const widths = first.map((_, i) => rows.reduce((max, r) => Math.max(max, cell(r[i]).length), 0))
    qCol = Math.max(0, widths.indexOf(Math.max(...widths)))
    cCol = qCol === 0 ? (widths[1] > 0 && widths[1] <= 40 ? 1 : -1) : -1
    nCol = cCol === 1 && widths[2] > 0 ? 2 : -1
    warnings.push(
      'No “Question” header was found, so column ' +
      String.fromCharCode(65 + qCol) +
      ' was read as the questions. Check them below before saving.',
    )
  }

  const questions: ParsedQuestion[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const r of body) {
    // Strip list numbering that survived into the cell ("1. What is…").
    const text = cleanText(cell(r[qCol]).replace(Q_PREFIX, '').replace(NUMBERED, '').replace(BULLET, ''))
    if (!text) continue
    if (!LOOKS_LIKE_QUESTION(text)) { skipped++; continue }
    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (seen.has(key)) { skipped++; continue }
    seen.add(key)
    questions.push({
      text,
      category: cCol >= 0 ? cleanText(cell(r[cCol])) || undefined : undefined,
      idealAnswerNotes: nCol >= 0 ? cleanText(cell(r[nCol])) || undefined : undefined,
    })
  }
  if (skipped > 0) warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} skipped — empty, duplicated, or too short to be a question.`)
  if (questions.length === 0) warnings.push('No questions were found in that sheet.')

  return { questions, headered, warnings }
}

/* ── The prompt the wizard hands to the recruiter's own LLM ──────────────── */

/**
 * The text behind "Copy a prompt for ChatGPT". It asks for the exact shape
 * `parseQuestionsFromText` reads best — numbered, one per line, with the two
 * metadata lines — so the round-trip through somebody else's chat window comes
 * back as categories and scoring notes instead of as bare text.
 */
export function llmPromptFor(opts: { count: number; role?: string; topic?: string; difficulty?: string }): string {
  const { count, role, topic, difficulty } = opts
  const forRole = role?.trim() ? ` for a ${role.trim()} role` : ''
  const about = topic?.trim() ? ` Focus on: ${topic.trim()}.` : ''
  const level = difficulty && difficulty !== 'mixed' ? ` Pitch every question at ${difficulty} difficulty.` : ' Mix easy, medium and hard.'
  return [
    `Write ${count} interview questions${forRole}.${about}${level}`,
    '',
    'Format your answer EXACTLY like this, with no preamble and no extra commentary:',
    '',
    '1. <the question, one or two sentences, max 30 words>',
    'Category: <one or two words>',
    'Ideal answer: <what a strong answer covers, one sentence>',
    '',
    '2. <the next question>',
    'Category: …',
    'Ideal answer: …',
    '',
    'Plain text only — no markdown, no bold, no bullet characters.',
  ].join('\n')
}

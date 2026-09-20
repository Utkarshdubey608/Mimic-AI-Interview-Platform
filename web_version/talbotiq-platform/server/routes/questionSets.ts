import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import multer from 'multer'
import { db } from '../store/db'
import { ah, HttpError } from '../util/ah'
import { generateQuestionsFromPdf, generateMoreQuestions, geminiEnabled } from '../services/gemini'
import { extractQuestions } from '../services/questionExtract'
import type { QuestionSet, FixedQuestion, QuestionStyle, DifficultyChoice } from '../../shared/types'

export const questionSetsRouter = Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

function friendlyGeminiError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (msg.includes('api key') || msg.includes('api_key') || msg.includes('unauthor') || msg.includes('permission'))
    return 'Gemini rejected the API key. Make sure it’s a valid Google AI Studio key (they start with "AIza").'
  if (msg.includes('429') || msg.includes('quota') || msg.includes('rate'))
    return 'Gemini rate limit / quota exceeded. Wait a moment and try again.'
  if (msg.includes('safety') || msg.includes('blocked'))
    return 'Gemini blocked this request for safety reasons. Try a different résumé.'
  return 'Gemini request failed. Please try again.'
}

const normalizeQuestions = (input: unknown): FixedQuestion[] => {
  if (!Array.isArray(input)) return []
  return input.map((q): FixedQuestion => ({
    id: q?.id ?? randomUUID(),
    text: String(q?.text ?? '').trim(),
    category: q?.category || undefined,
    idealAnswerNotes: q?.idealAnswerNotes || undefined,
  }))
}

questionSetsRouter.get('/', (_req, res) => {
  res.json([...db.questionSets.values()].sort((a, b) => a.name.localeCompare(b.name)))
})

questionSetsRouter.get('/:id', (req, res) => {
  const s = db.questionSets.get(req.params.id)
  if (!s) throw new HttpError(404, 'Question set not found')
  res.json(s)
})

// Generate questions from an uploaded résumé PDF via Gemini (server-side).
// Returns questions for review — does NOT persist (the client saves via POST /).
questionSetsRouter.post('/generate', upload.single('resume'), ah(async (req, res) => {
  const file = (req as typeof req & { file?: { buffer: Buffer; mimetype: string } }).file
  if (!file) throw new HttpError(400, 'No résumé PDF uploaded')
  if (file.mimetype !== 'application/pdf') throw new HttpError(400, 'Only PDF résumés are supported')

  const style = (req.body?.style ?? 'mix') as QuestionStyle
  const difficulty = (req.body?.difficulty ?? 'mixed') as DifficultyChoice
  const role = typeof req.body?.role === 'string' ? req.body.role.trim() : undefined
  const apiKeyOverride = typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined
  const model = typeof req.body?.model === 'string' ? req.body.model : undefined

  const technicalCount = clampInt(req.body?.technicalCount, 0, 25, 8)
  const nonTechnicalCount = clampInt(req.body?.nonTechnicalCount, 0, 25, 8)
  const total =
    style === 'mix' ? technicalCount + nonTechnicalCount : style === 'technical' ? technicalCount : nonTechnicalCount
  if (total < 1 || total > 25) throw new HttpError(400, 'Total questions must be between 1 and 25')

  if (!geminiEnabled(apiKeyOverride))
    throw new HttpError(400, 'No Gemini API key configured. Add one in Settings or enter it in this dialog.')

  let questions
  try {
    questions = await generateQuestionsFromPdf({
      pdfBase64: file.buffer.toString('base64'),
      style, technicalCount, nonTechnicalCount, difficulty, role, model, apiKeyOverride,
    })
  } catch (err) {
    console.error('[generate] gemini error:', err)
    throw new HttpError(502, friendlyGeminiError(err))
  }
  if (!questions.length)
    throw new HttpError(502, 'Gemini returned no questions. The résumé may be empty/scanned — try another file.')

  const suggestedName =
    (typeof req.body?.name === 'string' && req.body.name.trim()) || `${role || 'Candidate'} — Résumé Screen`
  res.json({ questions, suggestedName })
}))

/**
 * Read questions OUT of a file the recruiter uploaded — the wizard's
 * "Upload photo / PDF / spreadsheet" path. Returns rows to review; persists
 * nothing (the wizard saves through POST / like every other path).
 *
 * The file-type routing, and which formats need a Gemini key, live in
 * services/questionExtract.ts.
 */
questionSetsRouter.post('/extract', upload.single('file'), ah(async (req, res) => {
  const file = (req as typeof req & { file?: { buffer: Buffer; mimetype: string; originalname: string } }).file
  if (!file) throw new HttpError(400, 'No file uploaded')

  const apiKeyOverride = typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined
  const model = typeof req.body?.model === 'string' ? req.body.model : undefined

  try {
    const result = await extractQuestions({
      buffer: file.buffer, mimetype: file.mimetype, filename: file.originalname, model, apiKeyOverride,
    })
    res.json(result)
  } catch (err) {
    // A 400 from the extractor is a message written FOR the recruiter ("that
    // PDF is a scan", "unsupported file type") — pass it through untouched.
    if (err instanceof HttpError) throw err
    console.error('[question-sets/extract] failed:', err)
    throw new HttpError(502, friendlyGeminiError(err))
  }
}))

/**
 * Write the questions a draft set is still missing.
 *
 * The recruiter named a target count in Step 1 and got fewer — a paste that ran
 * short, a photo of one page of two, or they simply stopped typing. `existing`
 * is the whole draft, sent so the model writes around it instead of over it.
 */
questionSetsRouter.post('/generate-more', ah(async (req, res) => {
  const count = clampInt(req.body?.count, 1, 25, 5)
  const existing = Array.isArray(req.body?.existing)
    ? (req.body.existing as unknown[]).map((t) => String(t ?? '').trim()).filter(Boolean)
    : []
  const apiKeyOverride = typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined
  const model = typeof req.body?.model === 'string' ? req.body.model : undefined
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

  if (!geminiEnabled(apiKeyOverride))
    throw new HttpError(400, 'No Gemini API key configured. Add one in Settings to have questions written for you.')

  let questions
  try {
    questions = await generateMoreQuestions({
      count,
      existing,
      role: str(req.body?.role),
      setName: str(req.body?.setName),
      topic: str(req.body?.topic),
      difficulty: req.body?.difficulty as DifficultyChoice | undefined,
      style: req.body?.style as QuestionStyle | undefined,
      model,
      apiKeyOverride,
    })
  } catch (err) {
    console.error('[question-sets/generate-more] gemini error:', err)
    throw new HttpError(502, friendlyGeminiError(err))
  }
  if (!questions.length)
    throw new HttpError(502, 'Gemini returned no new questions. Try again, or add the rest yourself.')

  res.json({ questions })
}))

questionSetsRouter.post('/', ah((req, res) => {
  const now = new Date().toISOString()
  const set: QuestionSet = {
    id: randomUUID(),
    name: req.body?.name?.trim() || 'Untitled set',
    questions: normalizeQuestions(req.body?.questions),
    createdAt: now,
    updatedAt: now,
  }
  db.questionSets.set(set.id, set)
  db.scheduleSave()
  res.status(201).json(set)
}))

questionSetsRouter.put('/:id', ah((req, res) => {
  const existing = db.questionSets.get(req.params.id)
  if (!existing) throw new HttpError(404, 'Question set not found')
  const updated: QuestionSet = {
    ...existing,
    name: req.body?.name?.trim() || existing.name,
    // Order of the incoming array IS the saved order (drag-to-reorder).
    questions: req.body?.questions ? normalizeQuestions(req.body.questions) : existing.questions,
    updatedAt: new Date().toISOString(),
  }
  db.questionSets.set(updated.id, updated)
  db.scheduleSave()
  res.json(updated)
}))

questionSetsRouter.post('/:id/duplicate', ah((req, res) => {
  const src = db.questionSets.get(req.params.id)
  if (!src) throw new HttpError(404, 'Question set not found')
  const now = new Date().toISOString()
  const copy: QuestionSet = {
    id: randomUUID(),
    name: `${src.name} (copy)`,
    questions: src.questions.map((q) => ({ ...q, id: randomUUID() })),
    createdAt: now,
    updatedAt: now,
  }
  db.questionSets.set(copy.id, copy)
  db.scheduleSave()
  res.status(201).json(copy)
}))

questionSetsRouter.delete('/:id', (req, res) => {
  db.questionSets.delete(req.params.id)
  db.scheduleSave()
  res.status(204).end()
})

import * as XLSX from 'xlsx'
import { extractResumeText } from './resume'
import { extractQuestionsFromMedia, geminiEnabled } from './gemini'
import { parseQuestionsFromText, questionsFromRows } from '../../shared/questionParse'
import { HttpError } from '../util/ah'
import type { ExtractQuestionsResult, ImportedQuestionSource } from '../../shared/types'

/**
 * A file a recruiter already has → interview questions, for the question-set
 * wizard's "Upload photo / PDF / spreadsheet" path.
 *
 * Three routes in, and which one a file takes is the whole design:
 *
 *   · SPREADSHEET (xlsx/xls/csv/tsv) — read column-wise, locally. A recruiter
 *     keeping their question bank in Excel is the most common case there is,
 *     and it must not depend on an API key or on a model reading a table right.
 *   · TEXT DOCUMENT (pdf/docx/txt) — the text is extracted locally and run
 *     through the SAME parser the browser runs over a paste, so a numbered list
 *     in a Word document imports exactly as it would if it were pasted.
 *   · IMAGE, or a PDF with no text layer — a photo of a printed sheet, a
 *     screenshot, a scan. Nothing local can read those, so they go to Gemini
 *     for transcription. This is the only path that needs a key, and it says so
 *     rather than failing obscurely.
 *
 * Nothing here persists anything: it returns rows for the recruiter to review
 * and edit in the wizard, which is the only gate that matters on an import.
 */

const MAX_QUESTIONS = 200

const isSpreadsheet = (name: string, mime: string) => {
  const l = (name || '').toLowerCase()
  return (
    l.endsWith('.csv') || l.endsWith('.tsv') || l.endsWith('.xlsx') || l.endsWith('.xls') ||
    mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv') ||
    mime === 'text/tab-separated-values'
  )
}
const isImage = (name: string, mime: string) =>
  mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(name || '')
const isPdf = (name: string, mime: string) => mime.includes('pdf') || /\.pdf$/i.test(name || '')
const isDoc = (name: string, mime: string) =>
  mime.includes('wordprocessingml') || mime.startsWith('text/') || /\.(docx|txt|md|rtf)$/i.test(name || '')

/** A photo Gemini could not be asked about — say which of the two reasons it is. */
const noKey = () =>
  new HttpError(
    400,
    'Reading questions out of a photo or a scan needs a Gemini API key. Add one in Settings, or upload a PDF, Word file, spreadsheet or text file instead — those are read without one.',
  )

export async function extractQuestions(opts: {
  buffer: Buffer
  mimetype: string
  filename: string
  model?: string
  apiKeyOverride?: string
}): Promise<ExtractQuestionsResult> {
  const { buffer, mimetype = '', filename = '', model, apiKeyOverride } = opts
  const warnings: string[] = []

  const viaModel = async (mimeType: string, source: ImportedQuestionSource): Promise<ExtractQuestionsResult> => {
    if (!geminiEnabled(apiKeyOverride)) throw noKey()
    const questions = await extractQuestionsFromMedia({
      base64: buffer.toString('base64'), mimeType, model, apiKeyOverride,
    })
    warnings.push('This file was read by AI, so check every question against the original before you save.')
    if (questions.length === 0) warnings.push('No interview questions were found in that image.')
    return { questions: questions.slice(0, MAX_QUESTIONS), warnings, source }
  }

  /* ── Spreadsheets ── */
  if (isSpreadsheet(filename, mimetype)) {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const sheetName = wb.SheetNames[0]
    const sheet = sheetName ? wb.Sheets[sheetName] : undefined
    if (!sheet) return { questions: [], warnings: ['That spreadsheet had no sheets in it.'], source: 'spreadsheet' }
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' })
    const parsed = questionsFromRows(aoa)
    if (wb.SheetNames.length > 1) {
      warnings.push(`Only the first sheet (“${sheetName}”) was read — this workbook has ${wb.SheetNames.length}.`)
    }
    return {
      questions: parsed.questions.slice(0, MAX_QUESTIONS),
      warnings: [...warnings, ...parsed.warnings],
      source: 'spreadsheet',
    }
  }

  /* ── Images ── */
  if (isImage(filename, mimetype)) {
    return viaModel(mimetype || 'image/jpeg', 'image')
  }

  /* ── PDFs: text layer first, model only if there isn't one ── */
  if (isPdf(filename, mimetype)) {
    let text = ''
    try {
      text = await extractResumeText(buffer, mimetype, filename)
    } catch {
      text = ''   // an encrypted or malformed PDF — try the model instead
    }
    const questions = parseQuestionsFromText(text)
    if (questions.length > 0) {
      return { questions: questions.slice(0, MAX_QUESTIONS), warnings, source: 'document' }
    }
    // No text layer, or text that held nothing question-shaped: this is a scan.
    if (!geminiEnabled(apiKeyOverride)) {
      throw new HttpError(
        400,
        text.trim()
          ? 'No questions could be picked out of that PDF. Check it holds a list of questions, or paste them in as text instead.'
          : 'That PDF has no readable text — it looks like a scan. Reading a scan needs a Gemini API key (add one in Settings), or you can paste the questions in as text.',
      )
    }
    warnings.push('That PDF had no text layer, so it was read as a scan.')
    return viaModel('application/pdf', 'image')
  }

  /* ── Word / text ── */
  if (isDoc(filename, mimetype)) {
    const text = await extractResumeText(buffer, mimetype, filename)
    const questions = parseQuestionsFromText(text)
    if (questions.length === 0) {
      warnings.push('No questions were found in that file. Each question should sit on its own line, numbered or bulleted.')
    }
    return { questions: questions.slice(0, MAX_QUESTIONS), warnings, source: 'document' }
  }

  throw new HttpError(
    400,
    'Unsupported file type. Upload a photo, PDF, Word document, text file, or an Excel/CSV spreadsheet.',
  )
}

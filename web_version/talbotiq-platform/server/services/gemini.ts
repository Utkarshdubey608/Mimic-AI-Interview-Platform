import { GoogleGenAI, Type } from '@google/genai'
import type {
  InterviewSession,
  InterviewTemplate,
  GeneratedInterviewQuestion,
  QuestionStyle,
  DifficultyChoice,
} from '../../shared/types'
import { db } from '../store/db'

/**
 * Resolve the active Gemini key at call time, in priority order:
 *   1. a per-request override (entered in the modal)
 *   2. a key saved in Settings (server store)
 *   3. the GEMINI_API_KEY environment variable
 */
function resolveKey(override?: string): string | undefined {
  const o = override?.trim()
  return o || db.settings.geminiApiKey || process.env.GEMINI_API_KEY || undefined
}

const clients = new Map<string, GoogleGenAI>()
function ai(override?: string): GoogleGenAI {
  const key = resolveKey(override)
  if (!key) throw new Error('No Gemini API key configured')
  let c = clients.get(key)
  if (!c) {
    c = new GoogleGenAI({ apiKey: key })
    clients.set(key, c)
  }
  return c
}

export function modelName(override?: string): string {
  return override || db.settings.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash'
}

/** Shared client accessor for other services (e.g. the conversation engine). */
export function geminiClient(override?: string): GoogleGenAI {
  return ai(override)
}

export const geminiEnabled = (override?: string) => Boolean(resolveKey(override))

/** Masked hint + source for the Settings UI (never returns the full key). */
export function keyStatus() {
  const saved = db.settings.geminiApiKey?.trim()
  const env = process.env.GEMINI_API_KEY?.trim()
  const active = saved || env
  return {
    geminiKeySet: Boolean(active),
    geminiKeyMasked: active
      ? `${active.slice(0, 4)}…${active.slice(-4)}`
      : undefined,
    source: (saved ? 'saved' : env ? 'env' : 'none') as 'saved' | 'env' | 'none',
    model: modelName(),
  }
}

/**
 * Strip markdown/formatting the model sometimes emits (asterisks for bold/bullets,
 * backticks, heading hashes) and collapse whitespace — question text must be
 * clean, plain prose. Leaves underscores alone (used in category/skill slugs).
 */
export function cleanQuestionText(s: string | undefined): string {
  return (s ?? '')
    .replace(/\*+/g, '')        // **bold** / * bullets
    .replace(/`+/g, '')         // `code`
    .replace(/^\s*#+\s*/gm, '') // # headings
    .replace(/\s*[—–]\s*/g, ', ') // em/en dashes read as AI — use commas (keep word hyphens)
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
  throw lastErr
}

/* ─── Adaptive question generation ──────────────────────────────────────── */

export interface GeneratedQuestion {
  text: string
  category: string
  idealAnswerNotes: string
}

export async function generateQuestions(opts: {
  resumeText: string
  role: string
  seniority?: string
  count: number
  // Recruiter's tailoring parameters (bulk-invite "tailor to each résumé" config).
  style?: QuestionStyle
  technicalCount?: number
  nonTechnicalCount?: number
  difficulty?: DifficultyChoice
  focusTopics?: string[]
}): Promise<GeneratedQuestion[]> {
  const { resumeText, role, seniority, count, style, technicalCount, nonTechnicalCount, difficulty, focusTopics } = opts

  const styleLine =
    style === 'technical'
      ? 'Every question must be TECHNICAL, grounded in the specific technologies, tools, and projects shown in the résumé.'
      : style === 'non_technical'
        ? 'Every question must be NON-TECHNICAL (behavioral, situational, culture-fit), grounded in the candidate\'s actual roles and experience.'
        : style === 'mix' && (technicalCount ?? 0) + (nonTechnicalCount ?? 0) > 0
          ? `Write exactly ${technicalCount ?? 0} TECHNICAL questions and ${nonTechnicalCount ?? 0} NON-TECHNICAL (behavioral/situational) questions.`
          : 'Mix behavioral and role-specific/technical questions, grounded in the candidate\'s actual experience.'
  const difficultyLine =
    difficulty && difficulty !== 'mixed'
      ? `Difficulty: every question should be ${difficulty.toUpperCase()} for this seniority.`
      : 'Difficulty: vary from easy warm-ups to genuinely challenging questions.'
  const topicsLine = focusTopics?.length
    ? `Focus areas, weave these domains into the questions wherever the résumé supports them: ${focusTopics.join(', ')}.`
    : ''

  const prompt = `You are an expert interviewer. Based on the candidate's résumé below, write exactly ${count} interview questions tailored to a ${seniority ?? ''} ${role} role.
${styleLine}
${difficultyLine}
${topicsLine ? `${topicsLine}\n` : ''}For each question include a short category and concise ideal-answer notes a human scorer can use.
Keep each question SHORT and conversational: ONE or two sentences, at most ~30 words, single-focus, never compound or multi-part.
Write the question text as PLAIN TEXT only: no markdown, no asterisks (*), no bullets, no bold, no backticks. Do NOT use em dashes or en dashes ("—" or "–") — use commas or periods instead.

RÉSUMÉ:
"""
${resumeText.slice(0, 16000)}
"""`

  const res = await withRetry(() =>
    ai().models.generateContent({
      model: modelName(),
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              category: { type: Type.STRING },
              idealAnswerNotes: { type: Type.STRING },
            },
            required: ['text', 'category', 'idealAnswerNotes'],
          },
        },
      },
    }),
  )
  const parsed = JSON.parse(res.text ?? '[]') as GeneratedQuestion[]
  return parsed.slice(0, count).map((q) => ({ ...q, text: cleanQuestionText(q.text) }))
}

/* ─── Resume PDF → Question Set generation ──────────────────────────────── */

export interface GenerateFromPdfOpts {
  pdfBase64: string
  style: QuestionStyle
  technicalCount: number
  nonTechnicalCount: number
  difficulty: DifficultyChoice
  role?: string
  model?: string
  apiKeyOverride?: string
}

export async function generateQuestionsFromPdf(
  opts: GenerateFromPdfOpts,
): Promise<GeneratedInterviewQuestion[]> {
  const { pdfBase64, style, technicalCount, nonTechnicalCount, difficulty, role, model, apiKeyOverride } = opts
  const total = style === 'mix' ? technicalCount + nonTechnicalCount : style === 'technical' ? technicalCount : nonTechnicalCount

  const styleLine =
    style === 'technical'
      ? 'Every question must be TECHNICAL — grounded in the specific technologies, tools, projects, and seniority shown in the resume.'
      : style === 'non_technical'
        ? 'Every question must be NON-TECHNICAL (behavioral, situational, culture-fit) — grounded in the candidate’s actual roles and experience.'
        : `Produce EXACTLY ${technicalCount} technical and ${nonTechnicalCount} non-technical questions.`
  const difficultyLine =
    difficulty === 'mixed'
      ? 'Use a balanced mix of easy, medium, and hard difficulty.'
      : `All questions should be ${difficulty} difficulty.`

  const systemInstruction =
    'You are an expert technical interviewer. You read a candidate résumé and produce sharp, specific interview questions tailored to that exact person. You never produce generic, copy-paste questions, and you never repeat yourself.'

  const prompt = `Read the attached candidate résumé and generate exactly ${total} interview questions${role ? ` for a ${role} role` : ''}.
${styleLine}
${difficultyLine}
Each question MUST be specific to THIS résumé — reference real technologies, projects, or experiences from it. Avoid duplicates and generic filler.
Keep each question SHORT and conversational: ONE or two sentences, at most ~30 words, single-focus. Never bundle multiple questions together (no "and how... and why..."). Ask one clear thing.
Write the question text as PLAIN TEXT only: no markdown, no asterisks (*), no bullets, no bold, no backticks, no headings. Do NOT use em dashes or en dashes ("—" or "–") — use commas or periods instead (they read as AI-written).
For each question provide: the question text, its type ("technical" or "non_technical"), a category (e.g. coding, system_design, behavioral, situational, culture_fit), a difficulty (easy|medium|hard), a skillTag (the résumé skill/topic it targets, e.g. React, Kafka, leadership), and a one-sentence rationale for why it fits this candidate.
Return ONLY JSON matching the provided schema.`

  const res = await withRetry(() =>
    ai(apiKeyOverride).models.generateContent({
      model: modelName(model),
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
            { text: prompt },
          ],
        },
      ],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  type: { type: Type.STRING, enum: ['technical', 'non_technical'] },
                  category: { type: Type.STRING },
                  difficulty: { type: Type.STRING, enum: ['easy', 'medium', 'hard'] },
                  skillTag: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                },
                required: ['text', 'type', 'category', 'difficulty', 'skillTag', 'rationale'],
              },
            },
          },
          required: ['questions'],
        },
      },
    }),
  )

  const parsed = JSON.parse(res.text ?? '{"questions":[]}') as { questions: GeneratedInterviewQuestion[] }
  const all = (Array.isArray(parsed.questions) ? parsed.questions : []).map((q) => ({
    ...q,
    text: cleanQuestionText(q.text),
    rationale: cleanQuestionText(q.rationale),
  }))
  if (style !== 'mix') return all.slice(0, total)

  // Enforce the exact technical / non-technical split for "mix".
  const tech = all.filter((q) => q.type === 'technical').slice(0, technicalCount)
  const nonTech = all.filter((q) => q.type === 'non_technical').slice(0, nonTechnicalCount)
  return [...tech, ...nonTech]
}

/* ─── Question-set wizard: reading a photo, and filling the gap ─────────── */

/** The JSON shape both wizard helpers below ask Gemini for. */
const QUESTION_LIST_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          category: { type: Type.STRING },
          idealAnswerNotes: { type: Type.STRING },
        },
        required: ['text', 'category', 'idealAnswerNotes'],
      },
    },
  },
  required: ['questions'],
} as const

const readQuestionList = (raw: string | undefined): GeneratedQuestion[] => {
  const parsed = JSON.parse(raw ?? '{"questions":[]}') as { questions?: GeneratedQuestion[] }
  return (Array.isArray(parsed.questions) ? parsed.questions : [])
    .map((q) => ({
      text: cleanQuestionText(q?.text),
      category: (q?.category ?? '').trim(),
      idealAnswerNotes: (q?.idealAnswerNotes ?? '').trim(),
    }))
    .filter((q) => q.text.length > 0)
}

/**
 * Read interview questions off an IMAGE or a scanned PDF — a photo of a printed
 * question sheet, a whiteboard, a screenshot of somebody's doc.
 *
 * This is the only import path that must go through a model: a born-digital PDF
 * or a spreadsheet is parsed locally by `shared/questionParse`, which is instant
 * and needs no key. Transcription only — the instruction forbids inventing a
 * question that is not in the picture, because a recruiter checking an import
 * reads for typos, not for questions that were never on the page.
 */
export async function extractQuestionsFromMedia(opts: {
  base64: string
  mimeType: string
  model?: string
  apiKeyOverride?: string
}): Promise<GeneratedQuestion[]> {
  const { base64, mimeType, model, apiKeyOverride } = opts

  const res = await withRetry(() =>
    ai(apiKeyOverride).models.generateContent({
      model: modelName(model),
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          {
            text:
              'Transcribe every interview question visible in this file, in the order they appear.\n' +
              'Transcribe ONLY what is written — never invent, complete or improve a question, and never add one that is not there. If a question is cut off or unreadable, transcribe the part you can read.\n' +
              'Ignore page numbers, headers, footers, logos and answer choices.\n' +
              'If a section heading groups some questions (e.g. "Technical", "Behavioural"), use it as their category; otherwise give each question a one or two word category of your own.\n' +
              'If the page also states an expected or model answer for a question, put it in idealAnswerNotes; otherwise leave idealAnswerNotes empty.\n' +
              'Return ONLY JSON matching the provided schema. If the file contains no interview questions at all, return an empty list.',
          },
        ],
      }],
      config: {
        systemInstruction:
          'You are a careful transcriber of interview question sheets. You reproduce exactly what is on the page and never author new questions.',
        responseMimeType: 'application/json',
        responseSchema: QUESTION_LIST_SCHEMA,
      },
    }),
  )
  return readQuestionList(res.text)
}

/**
 * Write the questions a half-finished set is still missing.
 *
 * The recruiter said how many they wanted in Step 1 and got fewer — from a
 * paste, a photo, or from stopping halfway through typing. `existing` is every
 * question already in the draft, sent verbatim so the model can avoid repeating
 * them; that is the whole reason this is a separate call from the résumé
 * generator, which has no draft to look at.
 */
export async function generateMoreQuestions(opts: {
  count: number
  existing: string[]
  role?: string
  setName?: string
  topic?: string
  difficulty?: DifficultyChoice
  style?: QuestionStyle
  model?: string
  apiKeyOverride?: string
}): Promise<GeneratedQuestion[]> {
  const { count, existing, role, setName, topic, difficulty, style, model, apiKeyOverride } = opts

  const styleLine =
    style === 'technical' ? 'Every question must be TECHNICAL — about tools, systems, and how the candidate works with them.'
    : style === 'non_technical' ? 'Every question must be NON-TECHNICAL — behavioural, situational, or about ways of working.'
    : 'Mix technical and behavioural questions.'
  const difficultyLine =
    !difficulty || difficulty === 'mixed'
      ? 'Vary the difficulty from warm-up to genuinely challenging.'
      : `Pitch every question at ${difficulty} difficulty.`
  const already = existing.filter((t) => t.trim()).slice(0, 60)
  const context = [
    role?.trim() ? `Role: ${role.trim()}.` : '',
    setName?.trim() ? `The set is called "${setName.trim()}".` : '',
    topic?.trim() ? `Subject areas to cover: ${topic.trim()}.` : '',
  ].filter(Boolean).join(' ')

  const prompt = `Write exactly ${count} more interview question${count === 1 ? '' : 's'} to finish a question set a recruiter is building.
${context}
${styleLine}
${difficultyLine}
Keep each question SHORT and conversational: one or two sentences, at most ~30 words, asking one clear thing. Plain text only, no markdown, no bullets, no numbering, and no em dashes.
Give each one a one or two word category, and one sentence of ideal-answer notes a human scorer can use.
${already.length
    ? `These questions are ALREADY in the set. Do not repeat them, do not rephrase them, and do not ask about the same thing from a different angle. Cover what they leave out:\n${already.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
    : 'The set is empty so far, so cover the ground a first-round interview for this role should cover.'}
Return ONLY JSON matching the provided schema.`

  const res = await withRetry(() =>
    ai(apiKeyOverride).models.generateContent({
      model: modelName(model),
      contents: prompt,
      config: {
        systemInstruction:
          'You are an expert interviewer completing a colleague\'s draft question set. You never duplicate a question they have already written.',
        responseMimeType: 'application/json',
        responseSchema: QUESTION_LIST_SCHEMA,
      },
    }),
  )

  // Belt and braces on the "no duplicates" instruction: the model is good at it,
  // but a repeat that reaches the draft is the recruiter's job to spot, and they
  // asked us to fill a gap, not to hand them the same question twice.
  const seen = new Set(already.map((t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()))
  const out: GeneratedQuestion[] = []
  for (const q of readQuestionList(res.text)) {
    const key = q.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
    if (out.length === count) break
  }
  return out
}

/* ─── Scoring ───────────────────────────────────────────────────────────── */

export interface RawScore {
  perQuestion: { questionId: string; scores: { kpiId: string; score: number }[]; feedback: string }[]
  summary: string
  recommendation: string
}

export async function scoreWithGemini(
  session: InterviewSession,
  template: InterviewTemplate,
): Promise<RawScore> {
  const kpis = template.rubric.kpis.filter((k) => k.enabled)
  const rubricText = kpis.map((k) => `- ${k.id} (${k.label}): ${k.description}`).join('\n')
  const transcript = session.questions
    .map((q, i) =>
      `Q${i + 1} [id:${q.id}] (${q.category ?? 'general'}): ${q.text}\n` +
      `Ideal-answer notes: ${q.idealAnswerNotes ?? '—'}\n` +
      `Candidate answer: ${q.answerText?.trim() || '(no answer given)'}\n`,
    )
    .join('\n')

  const prompt = `You are a fair but rigorous interview scorer. Score each answer against the rubric KPIs on a 0–100 scale, judging only what the candidate actually said.
Use ONLY these KPI ids: ${kpis.map((k) => k.id).join(', ')}.

RUBRIC:
${rubricText}

TRANSCRIPT:
${transcript}

For each question return its exact questionId, a score (0–100) for every KPI id listed above, and one or two sentences of specific feedback. Then provide an overall summary covering strengths and improvement areas, and a recommendation that is exactly one of: strong_yes, yes, maybe, no.`

  const res = await withRetry(() =>
    ai().models.generateContent({
      model: modelName(),
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            perQuestion: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionId: { type: Type.STRING },
                  scores: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        kpiId: { type: Type.STRING },
                        score: { type: Type.NUMBER },
                      },
                      required: ['kpiId', 'score'],
                    },
                  },
                  feedback: { type: Type.STRING },
                },
                required: ['questionId', 'scores', 'feedback'],
              },
            },
            summary: { type: Type.STRING },
            recommendation: { type: Type.STRING },
          },
          required: ['perQuestion', 'summary', 'recommendation'],
        },
      },
    }),
  )
  return JSON.parse(res.text ?? '{}') as RawScore
}

/* ─── Conversational (chatbot) transcript scoring ───────────────────────── */

export interface RawConversationScore {
  perQuestion: { questionIndex: number; scores: { kpiId: string; score: number }[]; feedback: string }[]
  summary: string
  strengths: string[]
  improvements: string[]
  recommendation: string
}

export async function scoreConversationWithGemini(
  session: InterviewSession,
  template: InterviewTemplate,
): Promise<RawConversationScore> {
  const kpis = template.rubric.kpis.filter((k) => k.enabled)
  const rubricText = kpis.map((k) => `- ${k.id} (${k.label}): ${k.description}`).join('\n')
  const transcript = (session.transcript ?? [])
    .map((t) =>
      `${t.role === 'interviewer' ? 'INTERVIEWER' : 'CANDIDATE'}` +
      `${typeof t.questionIndex === 'number' ? ` [q${t.questionIndex}${t.isFollowUp ? ' · follow-up' : ''}]` : ''}: ${t.content}`,
    )
    .join('\n')

  const prompt = `You are a fair but rigorous interview scorer. Below is a conversational interview transcript. Score each PRIMARY question (identified by its q-index) on a 0–100 scale against the rubric KPIs, judging only what the candidate actually said (fold any follow-ups into that question's score).
Use ONLY these KPI ids: ${kpis.map((k) => k.id).join(', ')}.

RUBRIC:
${rubricText}

TRANSCRIPT:
${transcript}

For each primary question return its questionIndex, a score (0–100) for every KPI id, and one or two sentences of specific feedback. Then give an overall summary, 2–4 concise strengths, 2–4 concise improvement areas, and a recommendation that is exactly one of: strong_yes, yes, maybe, no.`

  const res = await withRetry(() =>
    ai().models.generateContent({
      model: modelName(),
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            perQuestion: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionIndex: { type: Type.NUMBER },
                  scores: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: { kpiId: { type: Type.STRING }, score: { type: Type.NUMBER } },
                      required: ['kpiId', 'score'],
                    },
                  },
                  feedback: { type: Type.STRING },
                },
                required: ['questionIndex', 'scores', 'feedback'],
              },
            },
            summary: { type: Type.STRING },
            strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
            improvements: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendation: { type: Type.STRING },
          },
          required: ['perQuestion', 'summary', 'strengths', 'improvements', 'recommendation'],
        },
      },
    }),
  )
  return JSON.parse(res.text ?? '{}') as RawConversationScore
}

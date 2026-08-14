// src/services/geminiAnalysis.ts
// Gemini-powered ATS analysis of the Deepgram transcript + Hume emotion data.
// ACCURACY FIRST — every output must be evidence-based.
//
// NOTE: this is the reasoning layer only. Gemini never receives audio and never
// re-transcribes. It receives clean structured data (already verified by Deepgram
// Nova-3 and Hume prosody) and returns a structured assessment.

import type { FacialSessionSummary } from '@/types/rekognition.types'
import { httpBase } from '@/lib/apiOrigin'

// ─── Input Types (built from this app's real store data) ─────────────────────

export interface QuestionAnswerInput {
  questionIdx: number
  questionText: string
  answerTranscript: string            // full text the candidate spoke for this question
  wordCount: number
  fillerCount: number
  fillerWords: string[]
  durationSeconds: number             // real span of THIS answer's transcript entries (0 = unknown)
  // Hume per-question prosody (optional — may be absent if Hume didn't run)
  topEmotions: Array<{ name: string; score: number }>   // top emotions during this answer
  dominantEmotion?: string
  hasEmotionData: boolean
}

export interface GeminiAnalysisInput {
  candidateName: string
  jobRole: string
  interviewDurationSeconds: number
  questions: QuestionAnswerInput[]
  overallTranscript: string
  overallWPM: number
  overallFillers: number
  overallFillerRate: number            // fillers per minute
  humeTopEmotions: Array<{ name: string; score: number }>  // session-average top emotions
  humeCompositeScore: number | null    // Hume's 0-100 composite, if available
  hasHumeData: boolean
  facialSummary?: FacialSessionSummary | null  // optional AWS Rekognition facial signal
}

// ─── Output Types ─────────────────────────────────────────────────────────────

export type EvidenceLevel = 'strong' | 'moderate' | 'weak' | 'insufficient'

export interface ScoredDimension {
  score: number              // 1–10
  evidenceLevel: EvidenceLevel
  evidenceSummary: string
  quotes: string[]
  flags: string[]
  cannotAssess: boolean
  cannotAssessReason?: string
}

export interface PerQuestionAnalysis {
  questionIdx: number
  questionText: string
  answerSummary: string
  relevanceScore: ScoredDimension
  clarityScore: ScoredDimension
  depthScore: ScoredDimension
  dominantEmotions: Array<{ name: string; score: number; interpretation: string }>
  emotionalConsistency: string
  redFlags: string[]
  strengths: string[]
  transcriptQuality: 'high' | 'medium' | 'low'
  transcriptQualityNote: string
}

export interface CommunicationProfile {
  overallClarity: ScoredDimension
  vocabularyRichness: ScoredDimension
  fillerWordImpact: ScoredDimension
  pacingAssessment: string
  structuredThinking: ScoredDimension
  note: string
}

export interface EmotionalIntelligenceProfile {
  engagementLevel: ScoredDimension
  stressResponse: ScoredDimension
  authenticitySignals: string
  emotionalVariability: string
  concernFlags: string[]
  dataQualityNote: string
}

export interface ATSScorecard {
  overallFitScore: number | null
  overallFitLabel: string
  overallConfidenceLevel: EvidenceLevel

  communicationScore: ScoredDimension
  technicalDepthScore: ScoredDimension
  problemSolvingScore: ScoredDimension
  engagementScore: ScoredDimension
  consistencyScore: ScoredDimension

  communicationProfile: CommunicationProfile
  emotionalIntelligenceProfile: EmotionalIntelligenceProfile
  perQuestionAnalysis: PerQuestionAnalysis[]

  topStrengths: string[]
  topConcerns: string[]
  recommendedFollowUpQuestions: string[]
  hiringRecommendation: 'Advance' | 'Hold' | 'Decline' | 'Insufficient Data'
  hiringRecommendationRationale: string

  dataLimitations: string[]
  transcriptReliabilityNote: string
  biasWarnings: string[]

  analysisTimestamp: number
  geminiModel: string
  inputDataQuality: 'high' | 'medium' | 'low' | 'insufficient'
}

// ─── Prompt Builder ──────────────────────────────────────────────────────────

function buildAnalysisPrompt(input: GeminiAnalysisInput): string {
  const questionSections = input.questions.map((q, i) => {
    // Per-answer WPM from the answer's OWN duration — the old even split of the
    // whole interview across all configured questions inflated unanswered ones.
    const wpm = q.wordCount > 0 && q.durationSeconds >= 5
      ? Math.min(350, Math.round((q.wordCount / q.durationSeconds) * 60))
      : 0
    const emo = q.hasEmotionData && q.topEmotions.length
      ? q.topEmotions.slice(0, 8).map(e => `    ${e.name}: ${(e.score * 100).toFixed(1)}%`).join('\n')
      : '    No Hume emotion data available for this answer'
    return `
--- QUESTION ${i + 1} ---
Question asked: "${q.questionText}"
Answer transcript: ${q.answerTranscript ? `"${q.answerTranscript}"` : '(no spoken answer captured)'}
Answer word count: ${q.wordCount}
Filler words detected: ${q.fillerCount} (${q.fillerWords.join(', ') || 'none'})
Approx words/minute: ${wpm || 'N/A'}
Dominant emotion (Hume prosody): ${q.dominantEmotion ?? 'N/A'}
Hume emotion signals during this answer:
${emo}
`
  }).join('\n')

  const topEmotionsText = input.hasHumeData && input.humeTopEmotions.length
    ? input.humeTopEmotions.slice(0, 15).map(e => `  ${e.name}: ${(e.score * 100).toFixed(1)}%`).join('\n')
    : '  No Hume prosody data available for this session'

  const f = input.facialSummary
  const facialSection = f && f.dataQuality !== 'insufficient'
    ? `
---
FACIAL ANALYSIS DATA (AWS Rekognition — ${f.dataQuality} quality):
Data quality note: ${f.dataQualityNote}
Frames: ${f.usableFrames} usable of ${f.totalFrames} captured

IMPORTANT: Facial data is SUPPLEMENTARY only. Never override voice/transcript findings with facial
data alone. If facial data quality is "low", reduce its weight accordingly.

Session facial overview:
- Average camera attention: ${(f.sessionAvgAttention * 100).toFixed(1)}%
- Looking away from camera: ${f.overallLookingAwayPercent.toFixed(1)}% of frames
- Dominant facial emotions: ${f.sessionDominantEmotions.slice(0, 5).map(e => `${e.type} (${e.avgConfidence.toFixed(1)}%)`).join(', ') || 'none'}

Per-question facial signals:
${f.perQuestion.map(q => `  Q${q.questionIdx + 1}: ${q.usableFrameCount} usable frames — attention ${(q.avgAttentionScore * 100).toFixed(0)}%, looking away ${q.lookingAwayPercent.toFixed(0)}%, top emotion ${q.dominantEmotions[0] ? `${q.dominantEmotions[0].type} (${q.dominantEmotions[0].avgConfidence.toFixed(0)}%)` : 'insufficient'}, head variance ${q.headPoseVariance.toFixed(0)} (>200 notable)${q.qualityNote ? ` [${q.qualityNote}]` : ''}`).join('\n')}

Facial integrity flags: ${f.integrityFlags.length ? f.integrityFlags.map(x => `⚑ ${x}`).join('; ') : 'none'}
Facial engagement signals: ${f.engagementFlags.length ? f.engagementFlags.join('; ') : 'none'}
Facial concern signals: ${f.concernFlags.length ? f.concernFlags.join('; ') : 'none'}

CROSS-VALIDATION RULES:
- If voice emotion (Hume) AND facial emotion (Rekognition) AGREE → higher-confidence signal.
- If they DISAGREE → flag as conflicting, reduce confidence, note for human review.
- Camera attention is an engagement proxy, NOT a measure of honesty.
- Multiple faces in frame is an integrity flag, NOT proof of cheating.
`
    : `
---
FACIAL ANALYSIS: Not available for this session (no camera, permission denied, proxy not configured, or insufficient usable frames). Do not factor facial signals into scoring.
`

  return `You are an expert ATS (Applicant Tracking System) analyst. You are analyzing a job interview for the role of "${input.jobRole}".

CRITICAL INSTRUCTIONS — READ BEFORE ANALYZING:

1. ACCURACY OVER COMPLETENESS: If you do not have sufficient evidence to score a dimension, set cannotAssess=true and explain why. Never fabricate scores.

2. TRANSCRIPT IS ASR OUTPUT: The transcript comes from Deepgram Nova-3 speech recognition. It is accurate but not infallible — treat oddly-worded fragments as possible transcription artifacts, not as the candidate misspeaking. Do not quote a garbled fragment as if it were a deliberate statement.

3. EMOTION DATA LIMITATIONS: Hume AI measures vocal prosody only — not facial expression, not intent, not personality. A high "Anxiety" score means the voice SOUNDED anxious; it does NOT prove the candidate IS anxious. Always interpret with appropriate uncertainty. If no Hume data is present, set the emotional dimensions' cannotAssess=true.

4. NO BIAS: Do not factor in name, perceived gender, accent, or any demographic signals. Score only communication quality, answer substance, and observable engagement signals.

5. EVIDENCE CITATIONS: Every score must cite specific evidence — "The candidate said X" or "Hume registered Y during question Z" — not vague impressions.

6. CONSERVATIVE SCORING: When in doubt, score lower and flag for human review rather than inflating. A false positive (advancing a poor candidate) and a false negative (rejecting a good one) are both serious errors.

7. RESPECT UNCERTAINTY: An interview transcript captures one moment in time. Do not make sweeping personality judgments from limited data.

---

CANDIDATE: ${input.candidateName}
ROLE: ${input.jobRole}
INTERVIEW DURATION: ${input.interviewDurationSeconds > 0 ? `${Math.floor(input.interviewDurationSeconds / 60)}m ${Math.round(input.interviewDurationSeconds % 60)}s` : 'unknown (too little speech to measure)'}
OVERALL WPM: ${input.overallWPM > 0 ? input.overallWPM : 'N/A (insufficient speech span to measure — do not treat as slow speech)'}
OVERALL FILLERS: ${input.overallFillers} (${input.overallFillerRate.toFixed(2)}/min)
HUME COMPOSITE SCORE: ${input.humeCompositeScore ?? 'N/A'}

TOP EMOTION SIGNALS (full session average via Hume AI prosody):
${topEmotionsText}

---
INTERVIEW Q&A:
${questionSections}

---

FULL TRANSCRIPT (for context):
${input.overallTranscript ? `"${input.overallTranscript}"` : '(no transcript captured)'}
${facialSection}
---

Now produce a complete ATS analysis. Respond ONLY with a valid JSON object matching this exact structure. No preamble, no markdown, no text outside the JSON.

Each ScoredDimension has: { "score": <1-10 integer>, "evidenceLevel": "strong"|"moderate"|"weak"|"insufficient", "evidenceSummary": "<string>", "quotes": ["<string>"], "flags": ["<string>"], "cannotAssess": <boolean>, "cannotAssessReason": "<string, only if cannotAssess true>" }.

{
  "overallFitScore": <number 1-100 or null if insufficient>,
  "overallFitLabel": "Strong Fit" | "Potential Fit" | "Needs Review" | "Insufficient Data",
  "overallConfidenceLevel": "strong" | "moderate" | "weak" | "insufficient",
  "communicationScore": <ScoredDimension>,
  "technicalDepthScore": <ScoredDimension>,
  "problemSolvingScore": <ScoredDimension>,
  "engagementScore": <ScoredDimension>,
  "consistencyScore": <ScoredDimension>,
  "communicationProfile": {
    "overallClarity": <ScoredDimension>,
    "vocabularyRichness": <ScoredDimension>,
    "fillerWordImpact": <ScoredDimension>,
    "pacingAssessment": "<string>",
    "structuredThinking": <ScoredDimension>,
    "note": "<string>"
  },
  "emotionalIntelligenceProfile": {
    "engagementLevel": <ScoredDimension>,
    "stressResponse": <ScoredDimension>,
    "authenticitySignals": "<string>",
    "emotionalVariability": "<string>",
    "concernFlags": ["<string>"],
    "dataQualityNote": "<string>"
  },
  "perQuestionAnalysis": [
    {
      "questionIdx": <number>,
      "questionText": "<string>",
      "answerSummary": "<1-2 sentence neutral summary>",
      "relevanceScore": <ScoredDimension>,
      "clarityScore": <ScoredDimension>,
      "depthScore": <ScoredDimension>,
      "dominantEmotions": [{ "name": "<string>", "score": <0-1>, "interpretation": "<cautious interpretation>" }],
      "emotionalConsistency": "<string>",
      "redFlags": ["<string>"],
      "strengths": ["<string>"],
      "transcriptQuality": "high" | "medium" | "low",
      "transcriptQualityNote": "<string>"
    }
  ],
  "topStrengths": ["<string>"],
  "topConcerns": ["<string>"],
  "recommendedFollowUpQuestions": ["<string>"],
  "hiringRecommendation": "Advance" | "Hold" | "Decline" | "Insufficient Data",
  "hiringRecommendationRationale": "<2-3 sentences, evidence-based>",
  "dataLimitations": ["<string>"],
  "transcriptReliabilityNote": "<string>",
  "biasWarnings": ["<string>"],
  "analysisTimestamp": ${Date.now()},
  "geminiModel": "gemini-2.5-flash",
  "inputDataQuality": "high" | "medium" | "low" | "insufficient"
}
`
}

// ─── Main Service ─────────────────────────────────────────────────────────────

export class GeminiAnalysisService {
  private apiKey: string
  // gemini-1.5-pro is retired. gemini-2.5-pro needs PAID billing (free tier = limit 0),
  // so we default to gemini-2.5-flash, which is available on the free tier and is a strong
  // model for this structured reasoning task. Override via the constructor for paid keys.
  private model = 'gemini-2.5-flash'
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models'

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey
    if (model) this.model = model
  }

  async analyze(input: GeminiAnalysisInput): Promise<ATSScorecard> {
    // Hybrid: the Gemini key lives on the SERVER. Prompt-building, retries and
    // parsing stay here (exactly as the source wrote them); only the HTTP call is
    // routed through /api/avatar/gemini-generate, which injects the key.
    if (!input.overallTranscript || input.overallTranscript.trim().length < 30) {
      throw new Error('Transcript too short for reliable analysis. The candidate must speak enough for a meaningful assessment.')
    }

    const prompt = buildAnalysisPrompt(input)

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,          // low = consistent, factual
        topK: 1,
        topP: 0.8,
        maxOutputTokens: 32768,    // generous — 2.5 models spend tokens on internal reasoning
        responseMimeType: 'application/json',
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }

    const url = `${httpBase()}/avatar/gemini-generate`
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    // Retry transient failures: 503 (model overloaded) and 429 rate-limit. A 429 that is
    // a HARD quota wall (free-tier "limit: 0" or "prepayment depleted") is NOT retried —
    // retrying can't fix it, so we surface it immediately.
    const maxAttempts = 4
    let response: Response | null = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.model, requestBody }),
        })
      } catch (networkError) {
        if (attempt < maxAttempts) { await sleep(800 * attempt); continue }
        throw new Error(`Network error reaching Gemini API: ${networkError}`)
      }

      if (response.ok) break

      const errorText = await response.text().catch(() => '')
      const status = response.status
      const hardQuota = /limit:\s*0|prepayment|credits are depleted/i.test(errorText)
      const transient = status === 503 || (status === 429 && !hardQuota)

      if (transient && attempt < maxAttempts) {
        await sleep((status === 503 ? 1500 : 2500) * attempt)
        continue
      }

      // Non-retryable, or out of attempts — surface a friendly error.
      let friendly = `Gemini API error ${status}`
      try {
        const msg = (JSON.parse(errorText) as any)?.error?.message
        if (msg) friendly += `: ${msg}`
      } catch { if (errorText) friendly += `: ${errorText.slice(0, 300)}` }
      if (status === 429 && hardQuota) {
        friendly += ' — this Gemini project is out of quota/credits. Add credits at ai.studio/projects, or use a free-tier key, then retry.'
      } else if (status === 503) {
        friendly += ' — the model is temporarily overloaded. Click "Retry analysis" in a moment.'
      }
      throw new Error(friendly)
    }

    if (!response) throw new Error('Gemini request failed — no response after retries')

    const data = await response.json()
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text
    const finishReason = data?.candidates?.[0]?.finishReason
    if (!rawText) {
      if (finishReason === 'MAX_TOKENS') {
        throw new Error('Gemini hit the output token limit before finishing. Try fewer questions or a shorter transcript.')
      }
      throw new Error('Gemini returned an empty response. Check the API key, model access, and quota.')
    }

    let scorecard: ATSScorecard
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim()
      scorecard = JSON.parse(cleaned)
    } catch (parseError) {
      throw new Error(`Failed to parse Gemini response as JSON: ${parseError}. Raw: ${String(rawText).slice(0, 200)}`)
    }

    this._validateScorecard(scorecard)
    scorecard.geminiModel = this.model
    return scorecard
  }

  private _validateScorecard(scorecard: ATSScorecard): void {
    scorecard.biasWarnings = scorecard.biasWarnings ?? []
    const dimensionKeys = [
      'communicationScore', 'technicalDepthScore',
      'problemSolvingScore', 'engagementScore', 'consistencyScore',
    ] as const

    for (const key of dimensionKeys) {
      const dim = scorecard[key] as ScoredDimension | undefined
      if (dim && !dim.cannotAssess && typeof dim.score === 'number') {
        if (dim.score < 1 || dim.score > 10) {
          dim.score = Math.max(1, Math.min(10, dim.score))
          dim.flags = dim.flags ?? []
          dim.flags.push('Score was out of range and was clamped — review manually')
        }
      }
    }

    if (scorecard.overallFitScore !== null && typeof scorecard.overallFitScore === 'number') {
      if (scorecard.overallFitScore < 1 || scorecard.overallFitScore > 100) {
        scorecard.overallFitScore = Math.max(1, Math.min(100, scorecard.overallFitScore))
        scorecard.biasWarnings.push('Overall score was out of range — review manually')
      }
    }

    const validRecommendations = ['Advance', 'Hold', 'Decline', 'Insufficient Data']
    if (!validRecommendations.includes(scorecard.hiringRecommendation)) {
      scorecard.hiringRecommendation = 'Insufficient Data'
      scorecard.biasWarnings.push('Invalid recommendation was replaced with Insufficient Data')
    }
  }
}

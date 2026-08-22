import type {
  HumeEmotion,
  EmotionCategory,
  EmotionSnapshot,
  QuestionEmotionSummary,
  HumeSessionResult,
  BatchJob,
  BatchJobStatus,
  BatchPrediction,
} from '@/types/hume.types'
import { categorizeEmotion } from '@/types/hume.types'
import { httpBase } from '@/lib/apiOrigin'

// ── Category aggregation helpers ──────────────────────────────────────────────

function emptyCategoryScores(): Record<EmotionCategory, number> {
  return {
    positive_high: 0,
    positive_calm: 0,
    cognitive: 0,
    social: 0,
    negative: 0,
    disengagement: 0,
  }
}

export function buildCategoryScores(emotions: HumeEmotion[]): Record<EmotionCategory, number> {
  const sums = emptyCategoryScores()
  const counts = emptyCategoryScores()
  for (const { name, score } of emotions) {
    const cat = categorizeEmotion(name)
    sums[cat] += score
    counts[cat] += 1
  }
  const out = emptyCategoryScores()
  for (const k of Object.keys(sums) as EmotionCategory[]) {
    out[k] = counts[k] > 0 ? sums[k] / counts[k] : 0
  }
  return out
}

function dominant(emotions: HumeEmotion[]): string {
  if (!emotions.length) return 'Neutral'
  return emotions.reduce((a, b) => (a.score > b.score ? a : b)).name
}

function topN(emotions: HumeEmotion[], n = 5): HumeEmotion[] {
  return [...emotions].sort((a, b) => b.score - a.score).slice(0, n)
}

function avgCategoryScores(snapshots: EmotionSnapshot[]): Record<EmotionCategory, number> {
  if (!snapshots.length) return emptyCategoryScores()
  const sums = emptyCategoryScores()
  for (const s of snapshots) {
    for (const k of Object.keys(s.categoryScores) as EmotionCategory[]) {
      sums[k] += s.categoryScores[k]
    }
  }
  const out = emptyCategoryScores()
  for (const k of Object.keys(sums) as EmotionCategory[]) {
    out[k] = sums[k] / snapshots.length
  }
  return out
}

// composite: weighted score favouring positive_high + positive_calm, penalising negative + disengagement
function computeCompositeScore(overall: Record<EmotionCategory, number>): number {
  const weights: Record<EmotionCategory, number> = {
    positive_high: 0.30,
    positive_calm: 0.25,
    cognitive: 0.20,
    social: 0.10,
    negative: -0.15,
    disengagement: -0.20,
  }
  let score = 0
  for (const k of Object.keys(weights) as EmotionCategory[]) {
    score += overall[k] * weights[k]
  }
  // Normalise 0..100
  return Math.round(Math.max(0, Math.min(100, (score + 0.35) * (100 / 0.7))))
}

// ── HumeService class ─────────────────────────────────────────────────────────

class HumeService {
  private key = ''

  setKey(k: string) { this.key = k }
  getKey() { return this.key }

  private headers(extra?: Record<string, string>) {
    return {
      'X-Hume-Api-Key': this.key,
      'Content-Type': 'application/json',
      ...extra,
    }
  }

  // ── Batch API ───────────────────────────────────────────────────────────────

  async submitBatchJob(audioBlob: Blob, filename = 'interview.webm'): Promise<string> {
    const form = new FormData()
    form.append('file', audioBlob, filename)
    form.append('json', JSON.stringify({ models: { prosody: {} } }))
    // Hybrid: audio is relayed through our server, which injects the Hume key.
    const res = await fetch(`${httpBase()}/avatar/hume/jobs`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      let msg = `HTTP ${res.status}`
      try { msg = (JSON.parse(body) as any)?.message ?? msg } catch { /* use status */ }
      throw new Error(`Hume batch submit failed (${msg}) — blob size: ${audioBlob.size}B`)
    }
    const data = await res.json()
    const jobId = data.job_id ?? data.id
    if (!jobId) throw new Error('Hume response missing job_id')
    return jobId as string
  }

  async pollBatchJob(jobId: string): Promise<BatchJob> {
    const res = await fetch(`${httpBase()}/avatar/hume/jobs/${jobId}`)
    if (!res.ok) throw new Error(`Poll failed: HTTP ${res.status}`)
    const data = await res.json()
    // Hume API nests status under `state.status`; normalise to a flat shape
    const status: BatchJobStatus = data.status ?? data.state?.status ?? 'IN_PROGRESS'
    return { ...data, status }
  }

  async fetchBatchPredictions(jobId: string): Promise<BatchPrediction[]> {
    const res = await fetch(`${httpBase()}/avatar/hume/jobs/${jobId}/predictions`)
    if (!res.ok) throw new Error(`Predictions fetch failed: HTTP ${res.status}`)
    const data = await res.json()
    // Response can be a raw array or wrapped in { results: [...] }
    return Array.isArray(data) ? data : (data.results ?? data.predictions ?? [])
  }

  // ── Analysis helpers ────────────────────────────────────────────────────────

  buildSessionResult(
    jobId: string,
    predictions: BatchPrediction[],
    questionTimestamps: number[],
    questions: string[],
  ): HumeSessionResult {
    // Flatten all prosody predictions into a single timeline
    const allPredictions: Array<{ begin: number; end: number; emotions: HumeEmotion[] }> = []
    for (const pred of predictions) {
      const groups = pred.results.predictions[0]?.models?.prosody?.grouped_predictions ?? []
      for (const grp of groups) {
        for (const p of grp.predictions) {
          allPredictions.push({
            begin: p.time.begin,
            end: p.time.end,
            emotions: p.emotions,
          })
        }
      }
    }
    allPredictions.sort((a, b) => a.begin - b.begin)

    // Build global timeline snapshots
    const timeline: EmotionSnapshot[] = allPredictions.map(p => ({
      timestamp: p.begin,
      emotions: p.emotions,
      categoryScores: buildCategoryScores(p.emotions),
      dominant: dominant(p.emotions),
    }))

    // Partition by question timestamps (in seconds, relative to recording start)
    const qTimestampsSec = questionTimestamps.map((ts, i) => {
      return i === 0 ? 0 : (ts - questionTimestamps[0]) / 1000
    })

    const perQuestion: QuestionEmotionSummary[] = questions
      .map((qText, idx) => {
        // Only questions that actually STARTED (have a recorded timestamp) get a
        // window. Without this, every unasked question received the [0, Infinity)
        // full-session slice — duplicated, fabricated emotion data that leaked
        // into the heatmap and the Gemini ATS input.
        const started = idx < qTimestampsSec.length
        const start = started ? qTimestampsSec[idx] : Infinity
        const end = qTimestampsSec[idx + 1] ?? Infinity
        const slice = timeline.filter(s => s.timestamp >= start && s.timestamp < end)
        const avg = avgCategoryScores(slice)
        const allEmotions = slice.flatMap(s => s.emotions)
        return {
          questionIdx: idx,
          questionText: qText,
          avgCategoryScores: avg,
          dominant: dominant(topN(allEmotions, 1)),
          timeline: slice,
          topEmotions: topN(allEmotions),
        }
      })
      // Drop question windows with zero prosody predictions — these are unanswered questions
      // or questions where the audio was too short for Hume to generate a prediction.
      .filter(q => q.timeline.length > 0)

    const overallCat = avgCategoryScores(timeline)
    const allTop = topN(allPredictions.flatMap(p => p.emotions))

    return {
      jobId,
      status: 'COMPLETED',
      overallCategoryScores: overallCat,
      overallTopEmotions: allTop,
      perQuestion,
      timeline,
      compositeScore: computeCompositeScore(overallCat),
    }
  }

  // ── EVI WebSocket helper ────────────────────────────────────────────────────

  buildEviUrl(): string {
    return `wss://api.hume.ai/v0/evi/chat?api_key=${this.key}`
  }
}

export const humeService = new HumeService()
export type { HumeService }

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAppStore } from '@/store/useAppStore'
import { Card, Button, StatCard, PageHeader, SectionTitle, Skeleton, EmptyState } from '@/components/ui'
import { cn } from '@/components/ui'
import {
  Check, AlertTriangle, Mic, TrendingUp, Radio, CalendarPlus, Download, Share2,
  FileText, RotateCcw, Waves, Quote,
} from 'lucide-react'
import { useHumePoll } from '@/hooks/useHumeBatch'
import { palette } from '@/design/tokens'
import { useWorkspaceGround } from '@/lib/workspaceGround'
import { useGeminiAnalysis } from '@/hooks/useGeminiAnalysis'
import { buildGeminiInput } from '@/services/analysisDataBuilder'
import { ATSScorecardPanel } from '@/components/ats/ATSScorecardPanel'
import { FacialAnalysisPanel } from '@/components/ats/FacialAnalysisPanel'
import { facialDataStore } from '@/services/facialDataStore'
import { aggregateFacialData } from '@/services/rekognitionService'
import type { FacialSessionSummary } from '@/types/rekognition.types'
import { countWords, calcWpm, countFillers } from '@/services/deepgram'
import { SentimentArc } from '@/components/hume/SentimentArc'
import { EmotionRadar } from '@/components/hume/EmotionRadar'
import { EmotionTimeline } from '@/components/hume/EmotionTimeline'
import { EmotionCategoryPanel } from '@/components/hume/EmotionCategoryPanel'
import { EmotionHeatmap } from '@/components/hume/EmotionHeatmap'
import { PerQuestionCard } from '@/components/hume/PerQuestionCard'

// ── Brand score bands ───────────────────────────────────────────────────────
// 85+ reads as the accent, 75–84 as neutral ink, below 75 as the warn tone.
// Used by every score surface on the page so one number always carries the
// same colour. Hexes come from the typed token mirror so charts and inline
// styles follow the workspace ground.
type Pal = ReturnType<typeof palette>

function scoreColor(s: number, pal: Pal) {
  if (s >= 85) return { text: pal.ink, bg: pal.accentSoft, bar: pal.accent }
  if (s >= 75) return { text: pal.inkBody, bg: pal.surfaceSunk, bar: pal.inkFaint }
  return { text: pal.warn, bg: pal.surfaceSunk, bar: pal.warn }
}

/** Badge token for the headline verdict — never a flat "success" for a weak report. */
function verdictBadge(score: number, noSignal: boolean) {
  if (noSignal) return 'badge-neutral'
  if (score >= 85) return 'badge-info'
  if (score >= 75) return 'badge-neutral'
  return 'badge-warning'
}

export default function ResultsPage() {
  // Score-band + chart hexes resolved against the current workspace ground —
  // SVG strokes and inline styles can't read the CSS variables.
  const ground = useWorkspaceGround()
  const pal = palette(ground)
  const BAND = { strong: pal.ink, moderate: pal.inkFaint, low: pal.warn } as const

  const store = useAppStore()
  const navigate = useNavigate()
  const conv = store.currentConversation
  const humeResult = store.humeResult
  const m = store.metrics

  // Continue polling if a Hume job is pending
  useHumePoll()

  // Gemini ATS analysis (reasoning layer over Deepgram + Hume + facial)
  const gemini = useGeminiAnalysis()

  // Aggregate AWS Rekognition facial frames captured during the interview. Runs once,
  // synchronously (facialDataStore is a module singleton), so it is ready before the
  // Gemini trigger fires and can be folded into that analysis. Always built (even from
  // zero frames) so the Results page can surface a "not captured" diagnostic.
  const [facialSummary] = useState<FacialSessionSummary>(() => {
    const frames = facialDataStore.getFrames()
    const summary = aggregateFacialData(frames, useAppStore.getState().questions.filter(Boolean).length)
    facialDataStore.setSummary(summary)
    return summary
  })

  // ── Real Deepgram transcript analytics ───────────────────────────────────
  const transcript = store.sessionTranscript
  const hasTranscript = transcript.length > 0
  const realWordCount = countWords(transcript)
  // calcWpm needs >= 2 entries with timestamps; fallback to stored m.wpm when available
  const calcedWpm    = hasTranscript ? calcWpm(transcript) : 0
  const realWpm      = hasTranscript ? (calcedWpm > 0 ? calcedWpm : m.wpm > 0 ? m.wpm : null) : null
  const realFillers  = hasTranscript ? transcript.reduce((a, e) => a + countFillers(e.text), 0) : null
  const totalText    = transcript.map(e => e.text).join(' ')
  const sentenceCount = hasTranscript ? totalText.split(/[.!?]+/).filter(s => s.trim().length > 3).length : 0

  // Display helpers — show '—' when data is absent
  const fmtWpm     = realWpm     !== null ? `${realWpm}`     : '—'
  const fmtFillers = realFillers !== null ? `${realFillers}` : '—'

  // ── Dynamic scores derived from Hume AI + Deepgram ───────────────────────
  const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

  // Deepgram-derived values
  const wpmForScore     = realWpm     !== null ? realWpm     : 130
  const fillersForScore = realFillers !== null ? realFillers : 0

  // Hume emotion category scores (0..1 range per category)
  const hc = humeResult?.overallCategoryScores

  // Normalise a weighted emotion sum → 0-100 (same formula as computeCompositeScore)
  // Neutral baseline → ~50; strong positive → 70-90; strong negative → 20-40
  const humeScore = (w: Partial<Record<string, number>>): number | null => {
    if (!hc) return null
    let raw = 0
    for (const [k, weight] of Object.entries(w)) raw += (hc[k as keyof typeof hc] ?? 0) * (weight ?? 0)
    return clamp(Math.round((raw + 0.35) * (100 / 0.7)))
  }

  // Deepgram-only proxy when Hume is absent — uses WPM pace + filler penalty
  const wpmProxy = realWpm !== null ? clamp(Math.round(50 + (realWpm - 130) * 0.5)) : null
  const dgScore  = (base: number | null) => base !== null ? clamp(base - fillersForScore * 5) : 0

  // ── Per-dimension calculation ─────────────────────────────────────────────
  // Confidence: positive_high (excitement/joy/pride) vs negative (anxiety/fear)
  const confScore = humeScore({ positive_high: 0.50, positive_calm: 0.15, negative: -0.40, disengagement: -0.25 })
                 ?? dgScore(wpmProxy !== null ? wpmProxy + 10 : null)

  // Engagement: interest + focus, penalised by boredom
  const engageScore = humeScore({ positive_high: 0.40, cognitive: 0.40, disengagement: -0.50, negative: -0.20 })
                   ?? dgScore(wpmProxy !== null ? wpmProxy + 5 : null)

  // Communication: calm positivity + social expressiveness
  const commScore = humeScore({ positive_calm: 0.30, social: 0.25, positive_high: 0.25, negative: -0.15, disengagement: -0.15 })
                 ?? dgScore(wpmProxy !== null ? wpmProxy + 5 : null)

  // No transcript AND no voice-emotion data → there is no signal to score from.
  // Never fabricate numbers (the old defaults minted Stress 100 / Articulation
  // 100 / Vocabulary 81 for empty sessions, yielding bogus 47-56/100 overalls).
  const noSignal = !hasTranscript && !humeResult

  // Stress Mgmt: calmness vs negative/disengagement
  const stressScore = humeScore({ positive_calm: 0.35, negative: -0.45, disengagement: -0.20 })
                   ?? (hasTranscript ? clamp(100 - fillersForScore * 4) : 0)

  // Vocabulary: pure Deepgram WPM — 82+ WPM scores linearly, capped at 100
  const vocabScore = hasTranscript ? clamp(wpmForScore > 100 ? 75 + Math.round((wpmForScore - 100) / 5) : Math.round(wpmForScore / 2)) : 0

  // Articulation: pure Deepgram fillers — 0 fillers = 100, each filler costs 10 pts
  const articScore = hasTranscript ? clamp(100 - fillersForScore * 10) : 0

  const dims = [
    { name: 'Communication',   score: commScore },
    { name: 'Confidence',      score: confScore },
    { name: 'Engagement',      score: engageScore },
    { name: 'Vocabulary',      score: vocabScore },
    { name: 'Stress Mgmt',     score: stressScore },
    { name: 'Articulation',    score: articScore },
  ]

  const overall = humeResult
    ? humeResult.compositeScore
    : Math.round(dims.reduce((a, b) => a + b.score, 0) / dims.length)

  const offset = 301.6 - (overall / 100) * 301.6
  const verdict =
    noSignal ? 'Insufficient data — no speech captured' :
    overall >= 85 ? 'Excellent Candidate' :
    overall >= 75 ? 'Good Candidate' :
    overall >= 65 ? 'Potential Candidate' :
    'Needs Further Review'

  const hiringConf = clamp(Math.round(overall * 0.9 + engageScore * 0.1))

  const strengths: string[] = []
  const watchPoints: string[] = []

  // Use derived scores (not m.* which are always 0 with no live EVI)
  if (confScore >= 70)   strengths.push('Strong confidence signals')
  if (engageScore >= 70) strengths.push('High engagement level')
  if (stressScore >= 70) strengths.push('Composed under pressure')
  if (hasTranscript && realWpm !== null && realWpm >= 110 && realWpm <= 160) strengths.push('Clear speaking pace')
  if (articScore >= 90 && hasTranscript) strengths.push('No filler words detected')
  else if (articScore >= 70 && hasTranscript) strengths.push('Minimal filler words')
  if (humeResult?.overallTopEmotions[0]) strengths.push(`Dominant: ${humeResult.overallTopEmotions[0].name}`)

  if (confScore > 0 && confScore < 55)    watchPoints.push('Low confidence signals')
  if (stressScore > 0 && stressScore < 45) watchPoints.push('Elevated stress detected')
  if (hasTranscript && (realFillers ?? 0) >= 5) watchPoints.push(`High filler words: ${realFillers}`)
  if (hasTranscript && realWpm !== null && realWpm < 100) watchPoints.push('Speaking pace below normal')
  if (hasTranscript && realWpm !== null && realWpm > 170) watchPoints.push('Speaking pace too fast')
  if (engageScore > 0 && engageScore < 50) watchPoints.push('Low engagement level')

  if (strengths.length === 0) strengths.push('Completed all questions', 'Responsive to prompts')
  if (watchPoints.length === 0) watchPoints.push('No significant issues detected')

  // Questions ACTUALLY answered (distinct questions with candidate speech) —
  // not the configured question count, which mislabeled every report.
  const questionsAnswered = new Set(transcript.filter(e => e.role === 'candidate').map(e => e.questionIdx)).size

  // ── Filter per-question Hume data to only questions the candidate answered ──
  // Primary: use Deepgram transcript to know which questions got a response.
  // Fallback: if no transcript, require at least 2 prosody predictions (avoids noise).
  const answeredQuestionIndices = new Set(transcript.map(e => e.questionIdx))
  const perQuestionFiltered = (humeResult?.perQuestion ?? []).filter(q =>
    answeredQuestionIndices.size > 0
      ? answeredQuestionIndices.has(q.questionIdx)
      : q.timeline.length >= 2
  )

  // ── Hume section state ────────────────────────────────────────────────────
  // Show spinner when a real jobId exists AND status is not yet terminal.
  // null status means job was just submitted (submitBatchJob resolved but first poll hasn't run).
  const humeIsProcessing =
    !!store.humeJobId &&
    !humeResult &&
    store.humeJobStatus !== 'COMPLETED' &&
    store.humeJobStatus !== 'FAILED'

  // ── Gemini ATS analysis trigger ───────────────────────────────────────────
  // Candidate name is embedded in the Tavus conversation_name ("Mimic — Name").
  // Split on the dash, not the prefix, so older "TalbotIQ — " records still work.
  const candidateName = (conv?.conversation_name ?? '').split('—').pop()?.trim() || 'Candidate'
  const jobRole = 'the interviewed role'

  function runAtsAnalysis() {
    const geminiInput = buildGeminiInput({
      candidateName,
      jobRole,
      questions: store.questions.filter(Boolean),
      transcript,
      humeResult,
      // Feed the ATS the same derived numbers the page displays — never the raw
      // live-metric fields, which are 0 for short sessions and stale otherwise.
      wpm: realWpm ?? m.wpm,
      totalFillers: realFillers ?? m.fillers,
      facialSummary,
    })
    gemini.analyze(geminiInput)
  }

  // Auto-run once a transcript exists and a Gemini key is present. Waits for the Hume
  // batch to finish first (so emotion data enriches the analysis) but proceeds without
  // it if Hume produced nothing, so the transcript is still analysed.
  useEffect(() => {
    if (
      gemini.status === 'idle' &&
      hasTranscript &&
      store.geminiKey &&
      !humeIsProcessing
    ) {
      runAtsAnalysis()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTranscript, humeIsProcessing, gemini.status, store.geminiKey])

  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [offerOpen, setOfferOpen] = useState(false)

  function downloadReport() {
    const rows = dims.map(d => `<tr><td>${d.name}</td><td style="font-weight:600">${d.score}/100</td><td>${d.score >= 85 ? 'Excellent' : d.score >= 75 ? 'Good' : 'Moderate'}</td></tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TalbotIQ Report</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Archivo,system-ui,sans-serif;color:#0E1420;background:#EEF0F4;padding:48px}h1{font-size:28px;font-weight:800;letter-spacing:-0.03em;color:#0E1420;margin-bottom:4px}.meta{font-size:13px;color:#5C6879;margin-bottom:32px}table{width:100%;border-collapse:collapse;font-size:13px;background:#ffffff}td,th{padding:10px 14px;border:1px solid #E3E6ED;text-align:left}th{font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#5C6879;background:#F8F9FB}.score{font-size:48px;font-weight:800;letter-spacing:-0.03em;color:#0E1420;font-variant-numeric:tabular-nums}</style></head><body><h1>TalbotIQ AI Interview Report</h1><p class="meta">Session: ${conv?.conversation_id ?? 'demo'} · Generated: ${new Date().toLocaleString()}</p><p class="score">${overall}<span style="font-size:20px;color:#5C6879">/100</span></p><p style="margin:12px 0 32px;display:inline-block;background:#E2E8F6;color:#152E76;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:600;border:1px solid #C6D2ED">${verdict}</p><table><tr><th>Dimension</th><th>Score</th><th>Grade</th></tr>${rows}</table></body></html>`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    a.download = `Mimic-Report-${conv?.conversation_id ?? 'demo'}.html`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    toast.success('Report downloaded')
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <PageHeader
        kicker="Interview Complete"
        title={conv?.conversation_name ?? 'Interview assessment'}
        description="Comprehensive candidate intelligence powered by conversational AI and behavioral analytics."
        action={
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Session ID</p>
            <p className="font-mono text-xs font-semibold text-ink-body mt-1">{conv?.conversation_id ?? 'TIQ-demo'}</p>
          </div>
        }
      />

      {/* Hume batch processing status banner */}
      {humeIsProcessing && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-rule bg-surface-hover text-sm text-ink">
          <span className="w-2 h-2 rounded-full bg-action animate-pulse flex-shrink-0" />
          <span className="text-xs font-medium">Analysing voice prosody — emotion results will appear below as soon as they land.</span>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Overall Score"     value={noSignal ? '—' : `${overall}/100`}    sub={verdict}                      trend={noSignal ? undefined : 'up'}  color={BAND.strong} />
        <StatCard label="Hiring Confidence" value={noSignal ? '—' : `${hiringConf}%`}    sub={noSignal ? 'Awaiting interview data' : 'Based on all signals'}         trend={noSignal ? undefined : 'up'}  color={BAND.strong} />
        <StatCard label="Words / Min"  value={fmtWpm}   sub={hasTranscript ? 'From Deepgram' : 'No transcript yet'} color={realWpm !== null && realWpm >= 110 && realWpm <= 170 ? BAND.strong : BAND.low} />
        <StatCard label="Total Words"  value={hasTranscript ? `${realWordCount}` : '—'} sub={hasTranscript ? `${sentenceCount} sentences` : 'Deepgram required'} trend={hasTranscript ? 'up' : undefined} color={BAND.strong} />
      </div>

      {/* Score ring + dimensions */}
      <div className="grid grid-cols-1 md:grid-cols-[248px_1fr] gap-5">
        <Card className="p-6 flex flex-col items-center">
          <div className="relative w-32 h-32 mb-5">
            <svg width="128" height="128" viewBox="0 0 110 110" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
              <circle cx="55" cy="55" r="48" strokeWidth="7" stroke={pal.rule} fill="none" />
              <circle cx="55" cy="55" r="48" strokeWidth="7" stroke={pal.accent} fill="none" strokeLinecap="round"
                strokeDasharray="301.6" strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 1.5s ease' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-display text-[34px] leading-none font-extrabold tracking-[-0.03em] tabular-nums text-ink">{noSignal ? '—' : overall}</span>
              <span className="text-xs text-ink-faint font-semibold mt-1">/100</span>
            </div>
          </div>
          <p className="section-label mb-2.5">Overall Score</p>
          <span className={cn('badge', verdictBadge(overall, noSignal), 'px-3 py-1 text-xs text-center')}>{verdict}</span>
          <div className="mt-6 w-full p-4 bg-surface-sunk rounded-xl border border-border">
            <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wide mb-2">AI Summary</p>
            <p className="text-xs text-ink-body leading-relaxed">
              {humeResult
                ? `Dominant emotion: ${humeResult.overallTopEmotions[0]?.name ?? 'Engagement'}. Composite score from ${humeResult.timeline.length} prosody predictions across ${questionsAnswered} questions.`
                : `Candidate completed ${questionsAnswered} question${questionsAnswered !== 1 ? 's' : ''}. ${confScore >= 70 ? 'Strong confidence signals throughout.' : 'Some confidence fluctuation observed.'} Engagement: ${engageScore}%.`}
            </p>
          </div>
        </Card>

        <Card className="p-6">
          <SectionTitle>Dimension Scores</SectionTitle>
          <div className="space-y-3.5">
            {dims.map(d => {
              const c = scoreColor(d.score, pal)
              return (
                <div key={d.name} className="flex items-center gap-3">
                  <span className="text-sm font-medium text-ink-body w-32 flex-shrink-0">{d.name}</span>
                  <div className="flex-1 h-2 bg-surface-hover rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${d.score}%`, background: c.bar }} />
                  </div>
                  <span className="text-sm font-bold w-9 text-right tabular-nums" style={{ color: c.text }}>{d.score}</span>
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 mt-6 pt-4 border-t border-border">
            {[[BAND.strong, '85+ Excellent'], [BAND.moderate, '75–84 Good'], [BAND.low, 'Below 75 Moderate']].map(([c, l]) => (
              <span key={l} className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c }} />{l}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* ── Hume AI Emotion Dashboard ─────────────────────────────────────────── */}
      <div className="rounded-3xl bg-surface border border-border p-6 space-y-7 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <span className="pill mb-2.5 inline-flex">
              <Waves size={12} strokeWidth={2} aria-hidden="true" /> Hume AI · Prosody
            </span>
            <h2 className="font-display text-xl font-extrabold tracking-[-0.03em] text-ink">Emotional Intelligence Report</h2>
            <p className="text-xs text-ink-muted mt-1.5">Voice-only signals. Not a measure of intent, ability, or personality.</p>
          </div>
          {humeResult && <SentimentArc score={humeResult.compositeScore} label="Emotion Score" size={120} />}
        </div>

        {humeResult ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-3">Overall Emotion Profile</p>
                <EmotionRadar categoryScores={humeResult.overallCategoryScores} />
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-3">Category Breakdown</p>
                <EmotionCategoryPanel categoryScores={humeResult.overallCategoryScores} />
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-3">Emotion Timeline</p>
              <EmotionTimeline timeline={humeResult.timeline} questionTimestamps={store.questionTimestamps} />
            </div>
            {perQuestionFiltered.length > 0 && (
              <>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-3">Per-Question Heatmap</p>
                  <EmotionHeatmap perQuestion={perQuestionFiltered} />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-3">Question-by-Question Analysis</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {perQuestionFiltered.map((q, i) => (
                      <PerQuestionCard key={i} summary={q} index={i} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        ) : humeIsProcessing ? (
          /* Loading — skeletons shaped like the dashboard that's coming. */
          <div className="rounded-2xl bg-surface-sunk border border-border p-6 space-y-6">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-action animate-pulse flex-shrink-0" />
              <p className="text-sm font-semibold text-ink">Processing prosody analysis</p>
              <span className="text-xs text-ink-faint">results appear automatically</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Skeleton className="h-56 rounded-2xl" />
              <div className="grid grid-cols-2 gap-3">
                {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-[86px] rounded-xl" />)}
              </div>
            </div>
            <Skeleton className="h-40 rounded-2xl" />
            <div className="flex items-center justify-between gap-4 flex-wrap pt-1 border-t border-border">
              <p className="text-xs text-ink-faint pt-4">Job ID <span className="font-mono text-ink-muted">{store.humeJobId}</span></p>
              <button
                className="text-xs font-semibold text-ink-muted underline underline-offset-4 hover:text-ink transition-colors duration-150 pt-4"
                onClick={() => {
                  store.setHumeJobId(null)
                  store.setHumeJobStatus(null)
                }}
              >
                Skip the wait — show results without emotion data
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-surface-sunk border border-border">
            <EmptyState
              icon={<Mic strokeWidth={1.75} />}
              title="No voice-emotion data for this session"
              description="Emotion analysis runs on the interview audio after the interview ends. Grant microphone access during the session and finish with End Interview so the recording is submitted. Speaking pace, filler words, the transcript, facial analysis and the Gemini assessment are computed independently."
            />
          </div>
        )}
      </div>

      {/* Raw signals — real Deepgram data when available */}
      <Card className="p-6">
        <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
          <SectionTitle className="mb-0 flex-1 min-w-[200px]">Voice & Signal Analytics</SectionTitle>
          {hasTranscript ? (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ok bg-ok-bg border border-ok-rule px-2.5 py-1 rounded-full flex-shrink-0">
              <span className="live-dot" />
              Deepgram Nova-3
            </span>
          ) : (
            <span className="text-[11px] font-medium text-ink-faint flex-shrink-0">Transcription not captured</span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Words / Min',  value: fmtWpm,    color: realWpm !== null && realWpm >= 110 && realWpm <= 170 ? BAND.strong : BAND.low, badge: realWpm !== null && realWpm > 170 ? 'Fast' : realWpm !== null && realWpm < 80 ? 'Slow' : undefined },
            { label: 'Filler Words', value: fmtFillers, color: realFillers !== null && realFillers <= 3 ? BAND.strong : BAND.low, badge: realFillers !== null && realFillers >= 7 ? 'High' : undefined },
            { label: 'Total Words',  value: hasTranscript ? `${realWordCount}` : '—', color: BAND.strong, badge: undefined },
            { label: 'Sentences',    value: hasTranscript ? `${sentenceCount}` : '—', color: BAND.strong, badge: undefined },
            { label: 'Confidence',     value: confScore > 0 ? `${confScore}%` : hc ? `${confScore}%` : '—',    color: confScore >= 70 ? BAND.strong : BAND.low, badge: confScore > 0 && confScore < 50 ? 'Low' : undefined },
            { label: 'Questions Done', value: `${questionsAnswered}`, color: BAND.strong,                                                 badge: undefined },
          ].map(s => (
            <div key={s.label} className="relative bg-surface-sunk rounded-xl border border-border p-4">
              {s.badge && (
                <span className="badge badge-warning absolute top-2.5 right-2.5">{s.badge}</span>
              )}
              <p className="text-2xl font-bold tabular-nums tracking-[-0.02em]" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs font-medium text-ink-muted mt-1.5">{s.label}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* Strengths / Watch — dynamic */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card className="p-6">
          <p className="text-[11px] font-bold text-ink uppercase tracking-wide mb-4 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-surface-hover border border-rule flex items-center justify-center flex-shrink-0">
              <Check size={11} strokeWidth={3} aria-hidden="true" />
            </span>
            Strengths
          </p>
          <div className="flex flex-wrap gap-2">
            {strengths.map(s => <span key={s} className="badge badge-info px-2.5 py-1">{s}</span>)}
          </div>
        </Card>
        <Card className="p-6">
          <p className="text-[11px] font-bold text-warn uppercase tracking-wide mb-4 flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-warn-bg border border-warn-rule flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={11} strokeWidth={2.5} aria-hidden="true" />
            </span>
            Watch Points
          </p>
          <div className="flex flex-wrap gap-2">
            {watchPoints.map(s => <span key={s} className="badge badge-warning px-2.5 py-1">{s}</span>)}
          </div>
        </Card>
      </div>

      {/* Interview timeline — per question */}
      {questionsAnswered > 0 && (
        <Card className="p-6">
          <SectionTitle>Interview Timeline</SectionTitle>
          <div className="relative flex items-start px-4">
            <div className="absolute top-[21px] left-8 right-8 h-px bg-border" />
            {store.questions.filter(Boolean).map((q, i) => {
              const done = i < store.currentQuestionIdx
              const active = i === store.currentQuestionIdx
              return (
                <div key={i} className="flex-1 flex flex-col items-center text-center relative z-10 px-1">
                  <div className={cn('w-11 h-11 rounded-full border-2 flex items-center justify-center text-xs font-bold tabular-nums bg-surface mb-3 shadow-xs',
                    done ? 'border-action text-ink' : active ? 'border-warn text-warn' : 'border-rule-strong text-ink-faint')}>
                    {done ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : i + 1}
                  </div>
                  <span className={cn('badge mb-1.5 whitespace-nowrap',
                    done ? 'badge-info' : active ? 'badge-warning' : 'badge-neutral')}>
                    {done ? 'Answered' : active ? 'In Progress' : 'Pending'}
                  </span>
                  <p className="text-[11px] text-ink-muted leading-tight line-clamp-2">{q.slice(0, 40)}{q.length > 40 ? '…' : ''}</p>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* AI Recommendation — the report's one full-bleed brand moment */}
      <div className="bg-brand-field rounded-3xl p-7 shadow-md">
        <div className="flex items-start gap-4 mb-6 flex-wrap sm:flex-nowrap">
          <div className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center flex-shrink-0">
            <TrendingUp size={19} strokeWidth={2} className="text-white" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-[240px]">
            <p className="text-[11px] font-bold text-white/60 uppercase tracking-[0.1em] mb-1.5">AI Recommendation</p>
            <p className="font-display text-xl font-extrabold tracking-[-0.03em] text-white">
              {overall >= 80 ? 'Proceed to Technical Round' : overall >= 65 ? 'Consider for Second Interview' : 'Further Evaluation Recommended'}
            </p>
            <p className="text-sm text-white/75 mt-2.5 leading-relaxed max-w-2xl">
              {overall >= 80
                ? `Strong across ${dims.filter(d => d.score >= 75).length} of ${dims.length} dimensions. Engagement at ${engageScore}% exceeds benchmark. Recommended for next stage.`
                : overall >= 65
                  ? `Moderate performance with room to grow. ${strengths[0] ?? 'Completed all questions'}. Consider a follow-up interview to assess potential.`
                  : `Score below threshold. Key concerns: ${watchPoints.slice(0, 2).join(', ')}. Additional screening recommended.`}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="font-display text-3xl font-extrabold tracking-[-0.03em] tabular-nums text-white">{hiringConf}%</p>
            <p className="text-[11px] font-medium text-white/60 mt-0.5">Hiring Confidence</p>
          </div>
        </div>
        <div className="border-t border-white/15 pt-5">
          <div className="flex justify-between text-xs mb-2">
            <span className="text-white/60 font-medium">Hiring Recommendation Confidence</span>
            <span className="text-white font-bold tabular-nums">{hiringConf}%</span>
          </div>
          <div className="h-1.5 bg-white/15 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full transition-all duration-700" style={{ width: `${hiringConf}%` }} />
          </div>
        </div>
      </div>

      {/* ── Full Transcript ───────────────────────────────────────────────────── */}
      <Card className="p-6">
        <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
          <SectionTitle className="mb-0 flex-1 min-w-[200px]">Interview Transcript</SectionTitle>
          {hasTranscript ? (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ok bg-ok-bg border border-ok-rule px-2.5 py-1 rounded-full flex-shrink-0 tabular-nums">
              <span className="live-dot" />
              {realWordCount} words · {sentenceCount} sentences
            </span>
          ) : (
            <span className="text-[11px] font-medium text-ink-faint flex-shrink-0">Deepgram Nova-3 · not captured</span>
          )}
        </div>

        {hasTranscript ? (
          <div className="divide-y divide-border">
            {/* Group by question */}
            {store.questions.filter(Boolean).map((q, qi) => {
              const entries = transcript.filter(e => e.questionIdx === qi)
              if (entries.length === 0) return null
              const qWords = countWords(entries)
              const qFillers = entries.reduce((a, e) => a + countFillers(e.text), 0)
              return (
                <div key={qi} className="py-5 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-action text-action-ink text-[10px] font-bold tabular-nums flex items-center justify-center mt-px">
                      {qi + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-body mb-2.5 flex gap-1.5">
                        <Quote size={13} strokeWidth={2} className="text-ink-disabled mt-1 flex-shrink-0" aria-hidden="true" />
                        <span className="italic">{q}</span>
                      </p>
                      <div className="space-y-1.5">
                        {entries.map((e, i) => (
                          <div key={i} className="bg-surface-sunk rounded-xl border border-border px-3.5 py-2.5">
                            <p className="text-sm text-ink-body leading-relaxed">{e.text}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-[11px] text-ink-faint">
                        <span className="tabular-nums">{qWords} words</span>
                        {qFillers > 0 && <span className="text-warn font-medium tabular-nums">{qFillers} filler{qFillers !== 1 ? 's' : ''}</span>}
                        <span className="tabular-nums">{new Date(entries[0].timestamp).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState
            icon={<FileText strokeWidth={1.75} />}
            title="No transcript recorded"
            description={store.deepgramKey
              ? 'Live transcription is configured but captured nothing. Make sure microphone access is granted when the interview starts.'
              : 'Live transcription is not configured — set DEEPGRAM_API_KEY in the server environment, then run the interview again.'}
          />
        )}
      </Card>

      {/* ── AI-Powered ATS Assessment (Gemini) ──────────────────────────────── */}
      {/* Visible diagnostic when the analysis can't run (no transcript) — a hidden
          section with no explanation looked like a silent failure. */}
      {gemini.status === 'idle' && !gemini.scorecard && !hasTranscript && (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-extrabold tracking-[-0.03em] text-ink">AI-Powered ATS Assessment</h2>
          <Card className="p-6">
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 rounded-full bg-surface-hover border border-border text-ink-muted flex items-center justify-center flex-shrink-0">
                <Radio size={17} strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">Waiting on a transcript</p>
                <p className="mt-1 text-xs text-ink-muted max-w-lg leading-relaxed">
                  The Gemini assessment reasons over the Deepgram transcript, so it can't run for a
                  session with no captured speech. Voice-emotion and facial analysis above are independent.
                </p>
              </div>
            </div>
          </Card>
        </section>
      )}
      {(gemini.status !== 'idle' || gemini.scorecard) && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display text-xl font-extrabold tracking-[-0.03em] text-ink">AI-Powered ATS Assessment</h2>
            {gemini.status === 'complete' && (
              <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={runAtsAnalysis}>
                Re-run analysis
              </Button>
            )}
          </div>
          <ATSScorecardPanel
            scorecard={gemini.scorecard}
            status={gemini.status}
            error={gemini.error}
            onRetry={runAtsAnalysis}
          />
        </section>
      )}

      {/* ── Facial Analysis (AWS Rekognition) — always shown, with capture diagnostics ── */}
      <section className="space-y-4">
        <h2 className="font-display text-xl font-extrabold tracking-[-0.03em] text-ink">Facial Analysis</h2>
        <FacialAnalysisPanel
          summary={facialSummary}
          questionCount={store.questions.filter(Boolean).length}
          proxyUrl={store.awsProxyUrl}
        />
      </section>

      <Card className="p-6">
        <SectionTitle>Recruiter Actions</SectionTitle>
        <div className="flex flex-wrap gap-3">
          <Button icon={<CalendarPlus size={15} />} onClick={() => setScheduleOpen(true)}>Schedule Technical Interview</Button>
          <Button variant="secondary" icon={<Download size={15} />} onClick={downloadReport}>Download AI Report</Button>
          <Button variant="secondary" icon={<Share2 size={15} />} onClick={() => {
            navigator.clipboard.writeText(`TalbotIQ Report — ${overall}/100 — ${verdict} — Session: ${conv?.conversation_id ?? 'demo'}`)
              .then(() => toast.success('Copied to clipboard'))
          }}>Share Profile</Button>
          <Button variant="secondary" icon={<FileText size={15} />} onClick={() => setOfferOpen(true)}>Generate Offer Rec.</Button>
          <Button variant="ghost" onClick={() => navigate('/setup')}>New Interview</Button>
        </div>
      </Card>

      {/* Schedule modal */}
      {scheduleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--scrim)] backdrop-blur-[2px]" onClick={() => setScheduleOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Schedule technical interview" className="bg-surface rounded-2xl shadow-xl border border-border p-8 w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
            <h3 className="font-display text-xl font-extrabold tracking-[-0.03em] text-ink mb-1">Schedule Technical Interview</h3>
            <p className="text-sm text-ink-muted mb-6">Book the next round for this candidate.</p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="field-label">Date</label><input type="date" className="input-base" /></div>
                <div><label className="field-label">Time</label><input type="time" defaultValue="10:00" className="input-base" /></div>
              </div>
              <div><label className="field-label">Interviewer</label><input type="text" placeholder="Interviewer name" className="input-base" /></div>
              <div><label className="field-label">Notes</label><textarea placeholder="Areas to probe further…" className="textarea-base" rows={3} /></div>
            </div>
            <div className="flex gap-3 justify-end mt-7">
              <Button variant="secondary" onClick={() => setScheduleOpen(false)}>Cancel</Button>
              <Button onClick={() => { toast.success('Interview scheduled'); setScheduleOpen(false) }}>Confirm Schedule</Button>
            </div>
          </div>
        </div>
      )}

      {/* Offer modal */}
      {offerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--scrim)] backdrop-blur-[2px]" onClick={() => setOfferOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="AI offer recommendation" className="bg-surface rounded-2xl shadow-xl border border-border p-8 w-full max-w-lg animate-slide-up" onClick={e => e.stopPropagation()}>
            <h3 className="font-display text-xl font-extrabold tracking-[-0.03em] text-ink mb-4">AI Offer Recommendation</h3>
            <pre className="bg-surface-sunk border border-border rounded-xl p-4 text-xs text-ink-body font-mono leading-relaxed whitespace-pre-wrap">
{`OFFER RECOMMENDATION — MIMIC AI
Session: ${conv?.conversation_id ?? 'demo'}
Score: ${overall}/100  |  Confidence: ${hiringConf}%

RECOMMENDATION: ${overall >= 80 ? 'Proceed with Offer' : overall >= 65 ? 'Consider — Second Interview' : 'Do Not Proceed at This Time'}

Top Strengths: ${strengths.slice(0, 3).join(', ')}
Watch Points: ${watchPoints.slice(0, 2).join(', ')}

Generated: ${new Date().toLocaleDateString()}`}
            </pre>
            <div className="flex gap-3 justify-end mt-5">
              <Button variant="secondary" onClick={() => setOfferOpen(false)}>Close</Button>
              <Button onClick={() => { toast.success('Copied to clipboard'); setOfferOpen(false) }}>Copy to Clipboard</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

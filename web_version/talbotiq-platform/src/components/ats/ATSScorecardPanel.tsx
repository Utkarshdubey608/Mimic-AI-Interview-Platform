// src/components/ats/ATSScorecardPanel.tsx
// Displays the Gemini ATS scorecard on ground-aware surfaces — semantic
// ok/warn/risk status colours resolved for the current workspace ground.

import { AlertTriangle, Check, Flag, RotateCcw, Sparkles } from 'lucide-react'
import { Card, SectionTitle, Skeleton, Button, cn } from '@/components/ui'
import { palette } from '@/design/tokens'
import { useWorkspaceGround } from '@/lib/workspaceGround'
import type { ATSScorecard, ScoredDimension, EvidenceLevel } from '@/services/geminiAnalysis'

interface Props {
  scorecard: ATSScorecard | null
  status: 'idle' | 'analyzing' | 'complete' | 'error'
  error: string | null
  onRetry?: () => void
}

/** Evidence strength → shared badge token. */
const EVIDENCE_BADGE: Record<EvidenceLevel, string> = {
  strong:       'badge-info',
  moderate:     'badge-neutral',
  weak:         'badge-warning',
  insufficient: 'badge-danger',
}

/** Hiring call → shared badge token. */
const REC_BADGE: Record<string, string> = {
  'Advance':           'badge-info',
  'Hold':              'badge-warning',
  'Decline':           'badge-danger',
  'Insufficient Data': 'badge-neutral',
}

function EvidenceBadge({ level, children }: { level: EvidenceLevel; children: React.ReactNode }) {
  return (
    <span className={cn('badge', EVIDENCE_BADGE[level] ?? 'badge-neutral', 'capitalize')}>
      {children}
    </span>
  )
}

type Pal = ReturnType<typeof palette>

function barColor(score: number, pal: Pal) {
  return score >= 7 ? pal.ok : score >= 4 ? pal.warn : pal.risk
}

function DimensionRow({ label, dim }: { label: string; dim: ScoredDimension }) {
  const pal = palette(useWorkspaceGround())
  if (!dim) return null
  if (dim.cannotAssess) {
    return (
      <div className="flex items-start gap-3 py-3.5 border-b border-border last:border-0">
        <div className="w-32 flex-shrink-0 text-sm text-ink-muted">{label}</div>
        <div className="flex-1">
          <EvidenceBadge level="insufficient">Cannot assess</EvidenceBadge>
          {dim.cannotAssessReason && <p className="text-xs text-ink-muted mt-1.5 leading-relaxed">{dim.cannotAssessReason}</p>}
        </div>
      </div>
    )
  }
  return (
    <div className="py-3.5 border-b border-border last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-32 flex-shrink-0 text-sm font-medium text-ink-body">{label}</div>
        <div className="flex-1 h-2 bg-surface-hover rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${(dim.score / 10) * 100}%`, background: barColor(dim.score, pal) }} />
        </div>
        <div className="w-12 text-right text-sm font-bold tabular-nums" style={{ color: barColor(dim.score, pal) }}>
          {dim.score}<span className="text-ink-faint font-semibold">/10</span>
        </div>
        <EvidenceBadge level={dim.evidenceLevel}>{dim.evidenceLevel}</EvidenceBadge>
      </div>
      {(dim.evidenceSummary || dim.quotes?.length > 0 || dim.flags?.length > 0) && (
        <div className="ml-32 pl-3 mt-2 space-y-1.5">
          {dim.evidenceSummary && <p className="text-xs text-ink-muted leading-relaxed">{dim.evidenceSummary}</p>}
          {dim.quotes?.length > 0 && (
            <div className="space-y-1 border-l-2 border-rule pl-3">
              {dim.quotes.map((q, i) => <p key={i} className="text-xs text-ink-faint italic leading-relaxed">"{q}"</p>)}
            </div>
          )}
          {dim.flags?.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {dim.flags.map((f, i) => (
                <span key={i} className="text-2xs font-medium px-2 py-0.5 rounded-full bg-surface-hover text-ink-muted border border-border">{f}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ATSScorecardPanel({ scorecard, status, error, onRetry }: Props) {
  const pal = palette(useWorkspaceGround())
  if (status === 'idle') return null

  // Loading — skeleton shaped like the scorecard that's coming, not a bare spinner.
  if (status === 'analyzing') {
    return (
      <Card className="p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-action animate-pulse flex-shrink-0" />
          <h3 className="text-sm font-semibold text-ink">Analysing the interview…</h3>
          <span className="text-xs text-ink-faint">10–25 seconds</span>
        </div>
        <div className="flex items-center gap-6">
          <Skeleton className="w-20 h-14 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
        <div className="space-y-3 pt-1">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-3 w-28 flex-shrink-0" />
              <Skeleton className="h-2 flex-1 rounded-full" />
              <Skeleton className="h-3 w-10 flex-shrink-0" />
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-faint leading-relaxed">
          Reasoning over the transcript, emotion signals, and communication quality.
        </p>
      </Card>
    )
  }

  if (status === 'error' || (error && !scorecard)) {
    return (
      <Card className="p-6 border-risk-rule">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-full bg-risk-bg border border-risk-rule text-risk flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={17} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">The ATS analysis didn't complete</h3>
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">{error ?? 'The analysis service returned no result.'}</p>
            {onRetry && (
              <Button variant="secondary" size="sm" className="mt-3" icon={<RotateCcw size={13} />} onClick={onRetry}>
                Run the analysis again
              </Button>
            )}
          </div>
        </div>
      </Card>
    )
  }

  if (!scorecard) return null

  const recBadge = REC_BADGE[scorecard.hiringRecommendation] ?? 'badge-neutral'

  return (
    <div className="space-y-5">
      {/* Overall */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div className="min-w-0">
            <SectionTitle>ATS Analysis Report</SectionTitle>
            <p className="text-xs text-ink-faint -mt-3">Gemini · Deepgram Nova-3 · Hume AI</p>
          </div>
          <span className={cn('badge', recBadge, 'px-3.5 py-1.5 text-sm')}>
            {scorecard.hiringRecommendation}
          </span>
        </div>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="text-center flex-shrink-0">
            <div className="font-display text-5xl font-extrabold tracking-[-0.03em] tabular-nums text-ink">
              {scorecard.overallFitScore ?? '—'}
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mt-1">Overall fit</div>
          </div>
          <div className="flex-1 min-w-[240px]">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-sm font-semibold text-ink">{scorecard.overallFitLabel}</span>
              <EvidenceBadge level={scorecard.overallConfidenceLevel}>{scorecard.overallConfidenceLevel} confidence</EvidenceBadge>
            </div>
            <p className="text-sm text-ink-muted leading-relaxed">{scorecard.hiringRecommendationRationale}</p>
          </div>
        </div>
        {scorecard.inputDataQuality !== 'high' && (
          <div className="mt-5 p-3.5 rounded-xl bg-warn-bg border border-warn-rule flex items-start gap-2.5">
            <AlertTriangle size={15} strokeWidth={1.75} className="text-warn mt-px flex-shrink-0" />
            <p className="text-xs text-warn leading-relaxed">
              Input data quality: <strong className="font-semibold">{scorecard.inputDataQuality}</strong> — {scorecard.transcriptReliabilityNote}
            </p>
          </div>
        )}
      </Card>

      {/* Dimension scores */}
      <Card className="p-6">
        <SectionTitle>Gemini Dimension Scores</SectionTitle>
        <div>
          <DimensionRow label="Communication" dim={scorecard.communicationScore} />
          <DimensionRow label="Technical Depth" dim={scorecard.technicalDepthScore} />
          <DimensionRow label="Problem Solving" dim={scorecard.problemSolvingScore} />
          <DimensionRow label="Engagement" dim={scorecard.engagementScore} />
          <DimensionRow label="Consistency" dim={scorecard.consistencyScore} />
        </div>
      </Card>

      {/* Per-question */}
      {scorecard.perQuestionAnalysis?.length > 0 && (
        <Card className="p-6">
          <SectionTitle>Per-Question Analysis</SectionTitle>
          <div className="space-y-3">
            {scorecard.perQuestionAnalysis.map(qa => {
              const tq: EvidenceLevel = qa.transcriptQuality === 'high' ? 'strong' : qa.transcriptQuality === 'medium' ? 'moderate' : 'weak'
              return (
                <div key={qa.questionIdx} className="p-4 rounded-xl bg-surface-sunk border border-border">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-sm font-semibold text-ink leading-snug">
                      <span className="text-ink-faint font-bold mr-1.5">Q{qa.questionIdx + 1}</span>
                      {qa.questionText}
                    </p>
                    <span className="flex-shrink-0"><EvidenceBadge level={tq}>transcript: {qa.transcriptQuality}</EvidenceBadge></span>
                  </div>
                  <p className="text-xs text-ink-muted mb-3.5 leading-relaxed">{qa.answerSummary}</p>
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { label: 'Relevance', dim: qa.relevanceScore },
                      { label: 'Clarity', dim: qa.clarityScore },
                      { label: 'Depth', dim: qa.depthScore },
                    ].map(({ label, dim }) => (
                      <div key={label} className="text-center p-2.5 rounded-lg bg-surface border border-border">
                        <div className="text-lg font-bold tabular-nums" style={{ color: dim?.cannotAssess ? pal.inkFaint : barColor(dim?.score ?? 0, pal) }}>
                          {dim?.cannotAssess ? '—' : dim?.score}
                        </div>
                        <div className="text-[11px] font-medium text-ink-muted mt-0.5">{label}</div>
                      </div>
                    ))}
                  </div>
                  {qa.dominantEmotions?.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {qa.dominantEmotions.slice(0, 3).map(e => (
                        <span key={e.name} className="badge badge-info">
                          {e.name} <span className="tabular-nums">{(e.score * 100).toFixed(0)}%</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {(qa.redFlags?.length > 0 || qa.strengths?.length > 0) && (
                    <div className="space-y-1 pt-1">
                      {qa.redFlags?.map((f, i) => (
                        <p key={i} className="text-xs text-risk flex items-start gap-1.5 leading-relaxed">
                          <Flag size={12} strokeWidth={2} className="mt-0.5 flex-shrink-0" />{f}
                        </p>
                      ))}
                      {qa.strengths?.map((s, i) => (
                        <p key={i} className="text-xs text-ink flex items-start gap-1.5 leading-relaxed">
                          <Check size={12} strokeWidth={2.5} className="mt-0.5 flex-shrink-0" />{s}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Strengths & concerns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card className="p-6">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink mb-3.5 flex items-center gap-2">
            <Check size={13} strokeWidth={2.5} /> Top Strengths
          </h3>
          <ul className="space-y-2.5">
            {scorecard.topStrengths?.length > 0
              ? scorecard.topStrengths.map((s, i) => (
                  <li key={i} className="text-sm text-ink-body flex gap-2.5 leading-relaxed">
                    <Check size={14} strokeWidth={2.5} className="text-ink mt-1 flex-shrink-0" />{s}
                  </li>
                ))
              : <li className="text-sm text-ink-faint">Insufficient data to identify strengths</li>}
          </ul>
        </Card>
        <Card className="p-6">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-warn mb-3.5 flex items-center gap-2">
            <Flag size={13} strokeWidth={2.5} /> Top Concerns
          </h3>
          <ul className="space-y-2.5">
            {scorecard.topConcerns?.length > 0
              ? scorecard.topConcerns.map((c, i) => (
                  <li key={i} className="text-sm text-ink-body flex gap-2.5 leading-relaxed">
                    <Flag size={14} strokeWidth={2} className="text-warn mt-1 flex-shrink-0" />{c}
                  </li>
                ))
              : <li className="text-sm text-ink-faint">No significant concerns identified</li>}
          </ul>
        </Card>
      </div>

      {/* Follow-up questions */}
      {scorecard.recommendedFollowUpQuestions?.length > 0 && (
        <Card className="p-6">
          <SectionTitle>Recommended Follow-up Questions</SectionTitle>
          <ul className="space-y-2.5">
            {scorecard.recommendedFollowUpQuestions.map((q, i) => (
              <li key={i} className="text-sm text-ink-body flex gap-3 leading-relaxed">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-surface-hover border border-rule text-ink text-[10px] font-bold flex items-center justify-center mt-0.5 tabular-nums">
                  {i + 1}
                </span>
                {q}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Limitations — always shown for transparency */}
      <Card className="p-6 border-warn-rule">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-warn mb-3.5 flex items-center gap-2">
          <Sparkles size={13} strokeWidth={2} /> Analysis Limitations & Caveats
        </h3>
        <ul className="space-y-1.5">
          {scorecard.dataLimitations?.map((l, i) => (
            <li key={i} className="text-xs text-ink-muted flex gap-2 leading-relaxed">
              <span className="text-ink-disabled flex-shrink-0" aria-hidden="true">—</span>{l}
            </li>
          ))}
          {scorecard.biasWarnings?.map((w, i) => (
            <li key={`b${i}`} className="text-xs text-warn flex gap-2 leading-relaxed">
              <AlertTriangle size={12} strokeWidth={2} className="mt-0.5 flex-shrink-0" />{w}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-ink-faint mt-4 leading-relaxed">
          This analysis is one data point. Human judgment must be applied before any hiring decision.
          Emotion data reflects vocal prosody only, not facial expression, intent, or personality.
        </p>
      </Card>
    </div>
  )
}

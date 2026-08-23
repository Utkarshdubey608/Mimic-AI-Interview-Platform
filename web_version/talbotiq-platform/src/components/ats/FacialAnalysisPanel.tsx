// src/components/ats/FacialAnalysisPanel.tsx
// Displays AWS Rekognition facial analysis on ground-aware surfaces.

import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Flag, ScanFace } from 'lucide-react'
import { Card, SectionTitle, cn } from '@/components/ui'
import { palette, exhibit, diverging, type Ground } from '@/design/tokens'
import { useWorkspaceGround } from '@/lib/workspaceGround'
import type { FacialSessionSummary, RekognitionEmotionType, FacialFrame } from '@/types/rekognition.types'

type Pal = ReturnType<typeof palette>

// Emotion accents, all drawn from the exhibit ramp so eight distinct signals
// still read as one system on either ground.
function emotionColor(type: RekognitionEmotionType, ground: Ground): string {
  const map: Record<RekognitionEmotionType, string> = {
    CALM:      exhibit.chatbot[ground],
    HAPPY:     exhibit.video[ground],
    CONFUSED:  exhibit.chat[ground],
    SURPRISED: exhibit.voice[ground],
    FEAR:      exhibit.video_avatar[ground],
    SAD:       exhibit.two_way[ground],
    ANGRY:     palette(ground).risk,
    DISGUSTED: ground === 'room' ? diverging.room[4] : '#064428',
  }
  return map[type] ?? palette(ground).inkFaint
}

function emotionChipStyle(type: RekognitionEmotionType, ground: Ground) {
  const c = emotionColor(type, ground)
  return { color: c, background: `${c}14`, borderColor: `${c}33` } // 14/33 = ~8%/20% alpha hex
}

function barColor(pct: number, pal: Pal) {
  return pct >= 80 ? pal.ok : pct >= 60 ? pal.warn : pal.risk
}

function AttentionBar({ score, label }: { score: number; label: string }) {
  const pal = palette(useWorkspaceGround())
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100)
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 flex-shrink-0 text-xs font-medium text-ink-body">{label}</span>
      <div className="flex-1 h-1.5 bg-surface-hover rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: barColor(pct, pal) }} />
      </div>
      <span className="w-10 text-right text-xs font-bold tabular-nums" style={{ color: barColor(pct, pal) }}>{pct}%</span>
    </div>
  )
}

function EmotionChip({ type, conf }: { type: RekognitionEmotionType; conf: number }) {
  const ground = useWorkspaceGround()
  return (
    <span className="text-2xs font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full border" style={emotionChipStyle(type, ground)}>
      {type} <span className="opacity-60 tabular-nums">{conf.toFixed(0)}%</span>
    </span>
  )
}

/** Capture quality → shared badge token. */
const QUALITY_BADGE: Record<string, string> = {
  high:         'badge-info',
  medium:       'badge-warning',
  low:          'badge-danger',
  insufficient: 'badge-danger',
}

// Human-readable outcome for one captured frame — the key debugging signal.
function outcomeLabel(f: FacialFrame): string {
  if (f.frameQuality === 'good') return 'Good (face + quality OK)'
  if (f.frameQuality === 'multiple_faces') return 'Multiple faces detected'
  if (f.frameQuality === 'low_confidence') return 'Low face-detection confidence'
  if (f.frameQuality === 'low_brightness') return 'Too dark'
  if (f.frameQuality === 'low_sharpness') return 'Too blurry'
  if (f.frameQuality === 'no_face') {
    return f.frameQualityNote?.toLowerCase().includes('capture failed')
      ? 'Capture failed (proxy / network)'
      : 'No face detected'
  }
  return f.frameQuality
}

function frameOutcomes(frames: FacialFrame[]) {
  const map = new Map<string, { count: number; note: string }>()
  for (const f of frames) {
    const label = outcomeLabel(f)
    const cur = map.get(label)
    if (cur) cur.count++
    else map.set(label, { count: 1, note: f.frameQualityNote })
  }
  return Array.from(map.entries())
    .map(([label, v]) => ({ label, count: v.count, note: v.note }))
    .sort((a, b) => b.count - a.count)
}

function DiagRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 h-7 border-b border-border last:border-0">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-xs font-medium text-ink-body truncate">{value}</span>
    </div>
  )
}

function CaptureDiagnostics({ summary, proxyUrl }: { summary: FacialSessionSummary; proxyUrl?: string }) {
  const outcomes = frameOutcomes(summary.frames)
  return (
    <div className="mt-4 rounded-xl bg-surface-sunk border border-border p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-2">Capture diagnostics</p>
      <div>
        <DiagRow label="Proxy URL" value={<span className="font-mono">{proxyUrl || 'not set'}</span>} />
        <DiagRow label="Frames attempted" value={<span className="tabular-nums">{summary.totalFrames}</span>} />
        <DiagRow label="Usable frames" value={<span className="tabular-nums">{summary.usableFrames}</span>} />
      </div>
      {outcomes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-1">Per-frame outcomes</p>
          {outcomes.map(o => (
            <DiagRow key={o.label} label={o.label} value={<span className="tabular-nums">{o.count}</span>} />
          ))}
          <p className="text-2xs text-ink-faint mt-2 italic leading-relaxed">Latest note: "{outcomes[0].note}"</p>
        </div>
      )}
    </div>
  )
}

interface Props {
  summary: FacialSessionSummary | null
  questionCount: number
  proxyUrl?: string
}

export function FacialAnalysisPanel({ summary, proxyUrl }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null)

  if (!summary) return null

  // Nothing captured at all — tell the user clearly + why, so they can debug.
  if (summary.totalFrames === 0) {
    return (
      <Card className="p-6 border-warn-rule">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-full bg-warn-bg border border-warn-rule text-warn flex items-center justify-center flex-shrink-0">
            <ScanFace size={17} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="text-sm font-semibold text-ink">No facial frames were captured</h3>
              <span className="badge badge-warning">Not captured</span>
            </div>
            <p className="text-sm text-ink-muted mt-1.5 leading-relaxed">
              Facial analysis has nothing to report for this interview. The most common causes:
            </p>
            <ul className="text-xs text-ink-muted mt-2.5 space-y-1.5">
              <li className="flex gap-2 leading-relaxed">
                <span className="text-ink-disabled flex-shrink-0" aria-hidden="true">—</span>
                {proxyUrl
                  ? <>Proxy URL is set — confirm the proxy is actually running at <span className="font-mono text-ink-body">{proxyUrl}</span>.</>
                  : <>No proxy URL configured — set it in Settings → AWS Rekognition Proxy URL.</>}
              </li>
              <li className="flex gap-2 leading-relaxed">
                <span className="text-ink-disabled flex-shrink-0" aria-hidden="true">—</span>
                Camera permission must be granted when the interview starts.
              </li>
              <li className="flex gap-2 leading-relaxed">
                <span className="text-ink-disabled flex-shrink-0" aria-hidden="true">—</span>
                Facial capture only runs while the interview is active (≈1 frame / 8s).
              </li>
            </ul>
          </div>
        </div>
        <CaptureDiagnostics summary={summary} proxyUrl={proxyUrl} />
      </Card>
    )
  }

  // Frames were captured but too few were usable — show the breakdown so the cause is visible.
  if (summary.dataQuality === 'insufficient') {
    return (
      <Card className="p-6 border-warn-rule">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-full bg-warn-bg border border-warn-rule text-warn flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={17} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="text-sm font-semibold text-ink">Too few usable frames to score</h3>
              <span className="badge badge-warning">Insufficient data</span>
            </div>
            <p className="text-sm text-ink-muted mt-1.5 leading-relaxed">{summary.dataQualityNote}</p>
            <p className="text-xs text-ink-faint mt-2 leading-relaxed">
              Captured <span className="tabular-nums font-semibold text-ink-muted">{summary.totalFrames}</span> frame(s),{' '}
              <span className="tabular-nums font-semibold text-ink-muted">{summary.usableFrames}</span> usable. The breakdown below shows why frames were dropped.
            </p>
          </div>
        </div>
        <CaptureDiagnostics summary={summary} proxyUrl={proxyUrl} />
      </Card>
    )
  }

  const qualityBadge = QUALITY_BADGE[summary.dataQuality] ?? 'badge-danger'

  return (
    <div className="space-y-5">
      {/* Session overview */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div className="min-w-0">
            <SectionTitle>Session Overview</SectionTitle>
            <span className={cn('badge', qualityBadge, '-mt-3')}>
              {summary.dataQuality} quality · <span className="tabular-nums">{summary.usableFrames}</span> frames
            </span>
          </div>
          <span className="text-xs font-medium text-ink-faint flex-shrink-0">AWS Rekognition</span>
        </div>

        <div className="space-y-2.5">
          <AttentionBar score={summary.sessionAvgAttention} label="Camera attention" />
          <AttentionBar score={1 - summary.overallLookingAwayPercent / 100} label="On-camera focus" />
          <AttentionBar score={summary.sessionAvgSmile} label="Positive expression" />
        </div>

        {summary.sessionDominantEmotions.length > 0 && (
          <div className="mt-6">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted mb-2.5">Dominant facial emotions (session average)</p>
            <div className="flex flex-wrap gap-1.5">
              {summary.sessionDominantEmotions.slice(0, 5).map(e => (
                <EmotionChip key={e.type} type={e.type} conf={e.avgConfidence} />
              ))}
            </div>
          </div>
        )}

        {summary.dataQuality !== 'high' && (
          <div className="mt-5 p-3.5 rounded-xl bg-warn-bg border border-warn-rule flex items-start gap-2.5">
            <AlertTriangle size={15} strokeWidth={1.75} className="text-warn mt-px flex-shrink-0" />
            <p className="text-xs text-warn leading-relaxed">{summary.dataQualityNote}</p>
          </div>
        )}
      </Card>

      {/* Flags requiring human review */}
      {(summary.integrityFlags.length > 0 || summary.concernFlags.length > 0) && (
        <Card className="p-6 border-risk-rule">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-risk mb-3.5 flex items-center gap-2">
            <Flag size={13} strokeWidth={2.5} /> Flags Requiring Human Review
          </h3>
          <div className="space-y-1.5">
            {summary.integrityFlags.map((f, i) => (
              <p key={`i${i}`} className="text-xs text-risk flex gap-2 leading-relaxed">
                <Flag size={12} strokeWidth={2} className="mt-0.5 flex-shrink-0" />{f}
              </p>
            ))}
            {summary.concernFlags.map((f, i) => (
              <p key={`c${i}`} className="text-xs text-warn flex gap-2 leading-relaxed">
                <AlertTriangle size={12} strokeWidth={2} className="mt-0.5 flex-shrink-0" />{f}
              </p>
            ))}
          </div>
          <p className="text-2xs text-ink-faint mt-3.5 leading-relaxed">These are signals only — human judgment must determine their significance.</p>
        </Card>
      )}

      {/* Engagement signals */}
      {summary.engagementFlags.length > 0 && (
        <Card className="p-6">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-ink mb-3 flex items-center gap-2">
            <Check size={13} strokeWidth={2.5} /> Engagement Signals
          </h3>
          <div className="space-y-1.5">
            {summary.engagementFlags.map((f, i) => (
              <p key={i} className="text-xs text-ink-body flex gap-2 leading-relaxed">
                <Check size={12} strokeWidth={2.5} className="text-ink mt-0.5 flex-shrink-0" />{f}
              </p>
            ))}
          </div>
        </Card>
      )}

      {/* Per-question breakdown */}
      <Card className="p-6">
        <SectionTitle>Per-Question Facial Breakdown</SectionTitle>
        <div className="space-y-2">
          {summary.perQuestion.map(qa => {
            const open = expanded === qa.questionIdx
            return (
              <div key={qa.questionIdx} className="border border-border rounded-xl overflow-hidden">
                <button
                  aria-expanded={open}
                  className="w-full flex items-center justify-between gap-3 h-14 px-4 text-left hover:bg-surface-hover transition-colors duration-fast ease-out"
                  onClick={() => setExpanded(expanded === qa.questionIdx ? null : qa.questionIdx)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-semibold text-ink tabular-nums">Q{qa.questionIdx + 1}</span>
                    {qa.usableFrameCount > 0 && qa.dominantEmotions[0]
                      ? <EmotionChip type={qa.dominantEmotions[0].type} conf={qa.dominantEmotions[0].avgConfidence} />
                      : <span className="text-xs text-ink-faint">No usable frames</span>}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-ink-muted">
                      <span className="font-bold tabular-nums text-ink-body">{(qa.avgAttentionScore * 100).toFixed(0)}%</span> attention
                    </span>
                    <ChevronDown
                      size={15}
                      strokeWidth={2}
                      aria-hidden="true"
                      className={cn('text-ink-faint transition-transform duration-fast ease-out', open && 'rotate-180')}
                    />
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-4 pt-3 space-y-3 border-t border-border bg-surface-sunk">
                    <div className="space-y-2">
                      <AttentionBar score={qa.avgAttentionScore} label="Attention score" />
                      <AttentionBar score={1 - qa.lookingAwayPercent / 100} label="On-camera" />
                      <AttentionBar score={qa.avgSmileScore} label="Positive expression" />
                    </div>
                    {qa.dominantEmotions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {qa.dominantEmotions.slice(0, 4).map(e => <EmotionChip key={e.type} type={e.type} conf={e.avgConfidence} />)}
                      </div>
                    )}
                    {qa.qualityNote && (
                      <p className="text-xs text-warn flex gap-2 leading-relaxed">
                        <AlertTriangle size={12} strokeWidth={2} className="mt-0.5 flex-shrink-0" />{qa.qualityNote}
                      </p>
                    )}
                    <p className="text-2xs text-ink-faint">
                      <span className="tabular-nums">{qa.usableFrameCount}</span> of <span className="tabular-nums">{qa.frameCount}</span> frames usable ·
                      Head variance: <span className="tabular-nums">{qa.headPoseVariance.toFixed(1)}</span>
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Mandatory disclaimer */}
      <div className="p-4 rounded-xl bg-surface-sunk border border-border">
        <p className="text-xs text-ink-muted leading-relaxed">
          Facial analysis is a supplementary signal only. AWS Rekognition detects facial expressions —
          it does not measure honesty, intelligence, or character. All facial signals must be reviewed by a
          human recruiter before influencing any hiring decision. Camera angle, lighting, and individual
          expression patterns significantly affect results.
        </p>
      </div>
    </div>
  )
}

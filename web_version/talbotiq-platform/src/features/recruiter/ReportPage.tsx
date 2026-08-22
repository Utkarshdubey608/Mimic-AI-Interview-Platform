import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer,
} from 'recharts'
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BarChart3, Check, ChevronDown, ClipboardCheck,
  Clock, Download, Inbox, Info, Keyboard, KeyRound, ListChecks, MessageSquare, Mic, ShieldAlert,
  Sparkles, Star, Target, Video, Zap,
} from 'lucide-react'
import { Card, Button, Textarea, Badge, Skeleton, cn } from '@/components/ui'
import { AIInsight, AIObservation } from '@/components/ai/AIInsight'
import { palette } from '@/design/tokens'
import { useWorkspaceGround } from '@/lib/workspaceGround'
import { sessionsApi } from '@/lib/api'
import { exportElementToPdf } from '@/lib/pdf'
import { FacialAnalysisPanel } from '@/components/ats/FacialAnalysisPanel'
import type { Recommendation, SessionReportView, SpeechMetrics, SentimentSignals } from '@shared/types'
import type { FacialSessionSummary } from '@/types/rekognition.types'

const REC: Record<Recommendation, { label: string; cls: string }> = {
  strong_yes: { label: 'Strong Yes', cls: 'bg-brand-field text-white border-transparent shadow-primary-sm' },
  yes:        { label: 'Yes',        cls: 'bg-ok-bg text-ok border-ok-rule' },
  maybe:      { label: 'Maybe',      cls: 'bg-warn-bg text-warn border-warn-rule' },
  no:         { label: 'No',         cls: 'bg-risk-bg text-risk border-risk-rule' },
}

const TRACK_LABEL: Record<string, string> = {
  chat: 'Timed Q&A',
  chatbot: 'Chatbot',
  voice: 'Voice',
  video_avatar: 'Video Avatar',
  video: 'Video Interview',
  two_way: 'Two-way Interview',
}

/* Score-band hexes come from the typed token mirror so SVG/inline styles follow
   the workspace ground — CSS variables can't cross into chart props. */
type Pal = ReturnType<typeof palette>
const scoreColor = (s: number, pal: Pal) => (s >= 75 ? pal.ok : s >= 55 ? pal.warn : pal.risk)

/** Locale-aware timestamp — readable in the UI and in the exported PDF. */
const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/* ─── Presentational helpers ─────────────────────────────────────────────── */

/** Icon plate + uppercase micro-header — the rhythm every report panel shares. */
function PanelHead({ icon, title, meta, className }: { icon: ReactNode; title: string; meta?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-rule bg-surface-hover text-ink"
        aria-hidden="true"
      >
        {icon}
      </span>
      <h3 className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{title}</h3>
      {meta && <span className="ml-auto flex-shrink-0 text-[11px] font-medium tabular-nums text-ink-faint">{meta}</span>}
    </div>
  )
}

/** Small header used inside an expanded panel or a column of a card. */
function MicroLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted', className)}>
      {children}
    </p>
  )
}

/** In-card note for data that legitimately isn't available — calm, never alarming. */
function PanelNote({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-surface-sunk p-3.5">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-ink-faint" aria-hidden="true">
        {icon}
      </span>
      <p className="pt-1 text-sm leading-relaxed text-ink-muted">{children}</p>
    </div>
  )
}

/** Designed empty state for a full-width panel body. */
function PanelEmpty({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-3.5 px-8 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-surface-sunk text-ink-faint" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="font-display text-sm font-bold tracking-[-0.01em] text-ink">{title}</p>
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-ink-muted">{description}</p>
      </div>
    </div>
  )
}

/** Candidate identity block shared by the masthead and the scoring state. */
function ReportIdentity({ session, children }: { session: SessionReportView['session']; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="pill">Candidate Report</span>
      <h1 className="mt-3 font-display text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-ink">
        {session.candidate.name}
      </h1>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-muted">
        <span className="font-semibold text-ink-body">{session.templateName}</span>
        <span className="text-ink-disabled" aria-hidden="true">·</span>
        <span>{TRACK_LABEL[session.track] ?? session.track}</span>
        <span className="text-ink-disabled" aria-hidden="true">·</span>
        <span>{session.completedAt ? stamp(session.completedAt) : 'in progress'}</span>
      </p>
      <p className="mt-1 truncate text-xs text-ink-faint">{session.candidate.email}</p>
      {children}
    </div>
  )
}

/** Calm trust message — icon plate + title + explanation, never a raw alert. */
function TrustNote({ tone, icon, title, children }: { tone: 'info' | 'warning'; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className={cn(
      'flex items-start gap-3.5 rounded-2xl border p-4',
      tone === 'info' ? 'border-rule bg-surface-hover' : 'border-warn-rule bg-warn-bg',
    )}>
      <div className={cn(
        'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border bg-surface',
        tone === 'info' ? 'border-rule text-ink' : 'border-warn-rule text-warn',
      )}>
        {icon}
      </div>
      <div className="min-w-0 pt-px">
        <p className={cn('text-sm font-bold', tone === 'info' ? 'text-ink' : 'text-warn')}>{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-ink-body">{children}</p>
      </div>
    </div>
  )
}

/** Masthead skeleton — the header card's exact composition, greyed out. */
function MastheadSkeleton() {
  return (
    <Card className="overflow-hidden p-0" aria-hidden="true">
      <div className="h-1 w-full bg-brand-field" />
      <div className="grid gap-7 p-6 md:grid-cols-[1fr_auto] md:items-center md:gap-8 md:p-7">
        <div className="min-w-0">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="mt-4 h-8 w-64 max-w-full" />
          <Skeleton className="mt-3 h-4 w-80 max-w-full" />
          <Skeleton className="mt-2 h-3 w-44 max-w-full" />
          <Skeleton className="mt-5 h-10 w-36" />
        </div>
        <div className="flex flex-col items-center gap-4 border-t border-border pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
          <Skeleton className="h-[160px] w-[160px] rounded-full" />
          <Skeleton className="h-7 w-28" />
        </div>
      </div>
    </Card>
  )
}

/** Skeleton mirroring the report's shape — charts row + question list. */
function ReportSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Card className="p-5 md:p-6">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-7 w-7 rounded-lg" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-3/4" />
      </Card>
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-7 rounded-lg" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="mt-5 h-52 w-full" />
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-7 rounded-lg" />
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="mt-6 space-y-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2 flex-1" />
                <Skeleton className="h-3 w-8" />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
          <Skeleton className="h-7 w-7 rounded-lg" />
          <Skeleton className="h-3 w-44" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border px-5 py-4 last:border-0">
            <Skeleton className="h-7 w-7 rounded-lg" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </Card>
    </div>
  )
}

/**
 * Two-way Interview is recruiter-scored (in addition to the Gemini scorecard,
 * which reuses the conversation-scoring path over the transcribed recording).
 * This card lets the interviewer leave a 0–5 star rating + private notes,
 * persisted via POST /sessions/:id/twoway/review (server mirrors it onto both
 * session.manualReview — the source of truth — and report.manualReview, so a
 * refetch of this same report query shows it back immediately).
 */
function ManualReviewCard({
  sessionId,
  manualReview,
}: {
  sessionId: string
  manualReview?: { rating: number; notes: string; by?: string; at: string }
}) {
  const qc = useQueryClient()
  const [rating, setRating] = useState(manualReview?.rating ?? 0)
  const [notes, setNotes] = useState(manualReview?.notes ?? '')

  // Re-sync local draft if the server copy changes underneath us (e.g. another
  // recruiter saved a review, or our own save round-trips through a refetch).
  useEffect(() => {
    setRating(manualReview?.rating ?? 0)
    setNotes(manualReview?.notes ?? '')
  }, [manualReview?.rating, manualReview?.notes])

  const save = useMutation({
    mutationFn: () => sessionsApi.twowayReview(sessionId, { rating, notes }),
    onSuccess: () => {
      toast.success('Review saved')
      qc.invalidateQueries({ queryKey: ['report', sessionId] })
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not save the review'),
  })

  return (
    <Card className="p-5 md:p-6">
      <PanelHead icon={<ClipboardCheck size={14} strokeWidth={2} />} title="Interviewer review" />
      <p className="mt-3 text-sm leading-relaxed text-ink-muted">
        Your own read of the live call, kept alongside the AI scorecard.
      </p>
      {manualReview?.at && (
        <p className="mt-1 text-xs text-ink-faint">
          Last saved {stamp(manualReview.at)}{manualReview.by ? ` by ${manualReview.by}` : ''}
        </p>
      )}
      <div className="mt-4 flex items-center gap-3">
        <div className="flex items-center gap-0.5" role="group" aria-label="Overall rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n === rating ? 0 : n)}
              aria-label={`Rate ${n} star${n === 1 ? '' : 's'}`}
              className="rounded-full p-0.5 text-ink-disabled transition-colors duration-150 hover:text-warn"
            >
              <Star size={20} className={n <= rating ? 'fill-warn text-warn' : ''} />
            </button>
          ))}
        </div>
        <span className="text-xs font-semibold tabular-nums text-ink-muted">
          {rating > 0 ? `${rating}/5` : 'Not rated yet'}
        </span>
      </div>
      <Textarea
        className="mt-4"
        aria-label="Private interviewer notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Private notes for your hiring team — not shown to the candidate."
        rows={4}
        charLimit={4000}
      />
      <div className="mt-4 flex justify-end">
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>Save review</Button>
      </div>
    </Card>
  )
}

function Gauge({ score }: { score: number }) {
  const pal = palette(useWorkspaceGround())
  const R = 64
  const C = 2 * Math.PI * R
  const color = scoreColor(score, pal)
  return (
    <div className="relative flex items-center justify-center" style={{ width: 160, height: 160 }}>
      <svg width="160" height="160" viewBox="0 0 160 160" className="-rotate-90" aria-hidden="true">
        <circle cx="80" cy="80" r={R} fill="none" stroke={pal.rule} strokeWidth="12" />
        <circle cx="80" cy="80" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl font-extrabold tabular-nums tracking-tight" style={{ color }}>{score}</span>
        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Overall</span>
      </div>
    </div>
  )
}

/** Stand-in for the gauge when nothing was actually evaluated. */
function GaugePlaceholder() {
  const pal = palette(useWorkspaceGround())
  return (
    <div className="relative flex items-center justify-center" style={{ width: 160, height: 160 }}>
      <svg width="160" height="160" viewBox="0 0 160 160" aria-hidden="true">
        <circle cx="80" cy="80" r="64" fill="none" stroke={pal.rule} strokeWidth="12" strokeLinecap="round" strokeDasharray="4 14" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-4xl font-extrabold text-ink-disabled">—</span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-ink-faint">Not evaluated</span>
      </div>
    </div>
  )
}

/** Gauge column of the masthead — score, then the recommendation chip. */
function ScoreColumn({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 border-t border-border pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
      {children}
    </div>
  )
}

export default function ReportPage() {
  // Chart/SVG chrome resolved against the current workspace ground.
  const pal = palette(useWorkspaceGround())
  const { id = '' } = useParams()
  const reportRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const q = useQuery({
    queryKey: ['report', id],
    queryFn: () => sessionsApi.report(id),
    // Transient blips (token refresh, network) must not kill the page —
    // especially while polling. Retry before surfacing an error.
    retry: 2,
    // Poll while scoring is still in flight — but STOP once the query has
    // failed. The condition used to be "no report yet → keep polling", which on
    // a permanent failure (a 404 on an unowned session, say) polled every 2.5s
    // forever: the recruiter sat on skeletons indefinitely instead of reaching
    // the error branch below, and the API took a request every 2.5s for as long
    // as the tab stayed open.
    refetchInterval: (query) =>
      query.state.status === 'error'
        ? false
        : ((query.state.data as SessionReportView | undefined)?.report ? false : 2500),
  })

  if (q.isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] px-6 py-8" aria-busy="true">
        <Skeleton className="h-4 w-24" />
        <div className="mt-4 space-y-6">
          <MastheadSkeleton />
          <ReportSkeleton />
        </div>
      </div>
    )
  }
  // Only a hard failure with NO data at all blocks the page — a failed
  // background refetch keeps showing the last good data instead of erroring.
  if (!q.data) {
    const reason = q.error instanceof Error ? q.error.message : 'Something went wrong while fetching it.'
    return (
      <div className="mx-auto max-w-[1100px] px-6 py-8">
        <Card className="p-0">
          <div className="flex flex-col items-center gap-5 px-10 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-risk-rule bg-risk-bg text-risk">
              <AlertTriangle size={24} strokeWidth={1.75} />
            </div>
            <div>
              <p className="font-display text-lg font-bold tracking-[-0.02em] text-ink">Couldn’t load this report</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">{reason}</p>
            </div>
            <div className="flex items-center gap-4">
              <Button onClick={() => void q.refetch()}>Try again</Button>
              <Link to="/sessions" className="text-sm font-semibold text-ink transition-colors hover:text-ink-body">Back to sessions</Link>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  const { session, rubric, report, speech, facial } = q.data
  const kpiLabel = (kid: string) => rubric.kpis.find((k) => k.id === kid)?.label ?? kid

  const exportPdf = async () => {
    if (!reportRef.current) return
    setExporting(true)
    try {
      await exportElementToPdf(reportRef.current, `TalbotIQ-${session.candidate.name.replace(/\s+/g, '-')}-report.pdf`)
    } catch {
      toast.error('PDF export failed')
    } finally {
      setExporting(false)
    }
  }

  const kpiRows = report ? Object.entries(report.kpiAverages).sort((a, b) => b[1] - a[1]) : []

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-8">
      <Link
        to="/sessions"
        className="group mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft size={15} className="transition-transform duration-150 group-hover:-translate-x-0.5" aria-hidden="true" /> Sessions
      </Link>

      {!report ? (
        <div className="mt-2 space-y-6">
          {/* masthead — scoring still in flight */}
          <Card className="overflow-hidden p-0">
            <div className="h-1 w-full bg-brand-field" aria-hidden="true" />
            <div className="grid gap-7 p-6 md:grid-cols-[1fr_auto] md:items-center md:gap-8 md:p-7">
              <ReportIdentity session={session}>
                <div className="mt-5 inline-flex items-center gap-2.5 rounded-full border border-rule bg-surface-hover px-4 py-2">
                  <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse-soft rounded-full bg-action" aria-hidden="true" />
                  <span className="text-xs font-semibold text-ink">
                    Scoring in progress — this page updates automatically when the analysis is ready.
                  </span>
                </div>
              </ReportIdentity>
              <ScoreColumn>
                <div aria-hidden="true" className="flex flex-col items-center gap-4">
                  <Skeleton className="h-[160px] w-[160px] rounded-full" />
                  <Skeleton className="h-7 w-28" />
                </div>
              </ScoreColumn>
            </div>
          </Card>
          <ReportSkeleton />
          {/* Two-way Interview is recruiter-scored — the recruiter can rate the
              call before the AI scorecard finishes (or even if it never does);
              session.manualReview is the source of truth, independent of report. */}
          {session.track === 'two_way' && (
            <ManualReviewCard sessionId={session.id} manualReview={session.manualReview} />
          )}
        </div>
      ) : (
        <div ref={reportRef} className="mt-2 space-y-6 bg-background">
          {/* masthead — identity, score gauge, recommendation, export */}
          <Card className="overflow-hidden p-0">
            <div className="h-1 w-full bg-brand-field" aria-hidden="true" />
            <div className="grid gap-7 p-6 md:grid-cols-[1fr_auto] md:items-center md:gap-8 md:p-7">
              <ReportIdentity session={session}>
                <div className="mt-5" data-html2canvas-ignore="true">
                  <Button icon={<Download size={16} />} loading={exporting} onClick={exportPdf}>Export PDF</Button>
                </div>
              </ReportIdentity>
              <ScoreColumn>
                {report.notEvaluated ? <GaugePlaceholder /> : <Gauge score={report.overallScore} />}
                {report.recommendation && (
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-faint">Recommendation</span>
                    <span className={cn('rounded-full border px-4 py-1.5 text-sm font-bold tracking-[-0.01em]', REC[report.recommendation].cls)}>
                      {REC[report.recommendation].label}
                    </span>
                  </div>
                )}
              </ScoreColumn>
            </div>
          </Card>

          {report.notEvaluated && (
            <TrustNote tone="info" icon={<Info size={18} strokeWidth={1.75} />} title="Not evaluated">
              No candidate answers were captured for this interview, so there are no real scores —
              the values below are placeholders, not a judgment of the candidate. The interview may
              need to be retaken.
            </TrustNote>
          )}
          {report.degraded && (
            <TrustNote tone="warning" icon={<AlertTriangle size={18} strokeWidth={1.75} />} title="Heuristic scoring">
              No <code className="rounded border border-warn-rule bg-surface px-1.5 py-0.5 font-mono text-[11px] text-warn">GEMINI_API_KEY</code> is
              configured, so these scores come from transcript heuristics. Add a key in Settings to enable content-aware analysis.
            </TrustNote>
          )}

          {/* AI summary — strengths / areas to improve.

              This was a plain Card with a Sparkles icon, which made the one
              piece of MODEL-WRITTEN prose on the page look exactly like the
              measured panels around it. It is now the product's insight
              surface: signal mark, signal edge, tinted ground, and the source
              stated in words underneath. A recruiter can tell at a glance which
              claims on this page are inferences. */}
          <AIInsight
            provenance={
              report.degraded
                ? 'Written from transcript heuristics — no scoring model was configured for this interview.'
                : 'Written by the scoring model from this interview’s transcript. The overall score is calculated by the platform from your rubric weights, not by the model.'
            }
          >
            <p>{report.summary}</p>
            {(report.strengths?.length || report.improvements?.length) ? (
              <div className="mt-5 grid gap-x-10 gap-y-5 border-t border-ai-rule pt-4 sm:grid-cols-2">
                {report.strengths?.length ? (
                  <div>
                    <MicroLabel className="text-ok">Strengths</MicroLabel>
                    <ul className="mt-2.5 space-y-2">
                      {report.strengths.map((str, i) => (
                        <AIObservation key={i} tone="strength">{str}</AIObservation>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {report.improvements?.length ? (
                  <div>
                    <MicroLabel className="text-warn">Areas to improve</MicroLabel>
                    <ul className="mt-2.5 space-y-2">
                      {report.improvements.map((str, i) => (
                        <AIObservation key={i} tone="concern">{str}</AIObservation>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </AIInsight>

          {/* radar + bars */}
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="p-5">
              <PanelHead icon={<Target size={14} strokeWidth={2} />} title="KPI profile" className="mb-1" />
              <ResponsiveContainer width="100%" height={260}>
                <RadarChart data={rubric.kpis.filter((k) => k.enabled).map((k) => ({ kpi: k.label, score: report.kpiAverages[k.id] ?? 0 }))}>
                  <PolarGrid stroke={pal.rule} />
                  <PolarAngleAxis dataKey="kpi" tick={{ fontSize: 11, fill: pal.inkMuted }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar dataKey="score" stroke={pal.accent} strokeWidth={2} fill={pal.accent} fillOpacity={0.22} />
                </RadarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-5">
              <PanelHead icon={<BarChart3 size={14} strokeWidth={2} />} title="KPI scores" />
              {kpiRows.length > 0 ? (
                <>
                  <div className="mt-5 flex items-center gap-3 border-b border-border pb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    <span className="flex-1">Competency</span>
                    <span className="w-8 text-right">Score</span>
                  </div>
                  <div className="mt-3.5 space-y-3.5">
                    {kpiRows.map(([kid, score]) => (
                      <div key={kid} className="flex items-center gap-3">
                        <span className="w-36 truncate text-xs font-medium text-ink-body">{kpiLabel(kid)}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-hover">
                          <div className="h-full rounded-full" style={{ width: `${score}%`, background: scoreColor(score, pal) }} />
                        </div>
                        <span className="w-8 text-right text-sm font-bold tabular-nums" style={{ color: scoreColor(score, pal) }}>{score}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <PanelNote icon={<BarChart3 size={16} strokeWidth={1.75} />}>
                  No KPI averages were produced for this interview.
                </PanelNote>
              )}
            </Card>
          </div>

          {/* integrity */}
          {(session.integrityEvents.length > 0 || session.tabSwitchCount > 0) && (
            <Card className="p-5">
              <PanelHead icon={<ShieldAlert size={14} strokeWidth={2} />} title="Integrity" />
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant={session.tabSwitchCount > 0 ? 'warning' : 'neutral'}>{session.tabSwitchCount} tab switches</Badge>
                {session.integrityEvents.length > 0 && <Badge variant="neutral">{session.integrityEvents.length} events logged</Badge>}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-ink-faint">
                Captured automatically while the candidate was in the interview window.
              </p>
            </Card>
          )}

          {/* per-question accordion */}
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-5 py-4">
              <PanelHead
                icon={<ListChecks size={14} strokeWidth={2} />}
                title="Per-question breakdown"
                meta={session.questions.length > 0 ? `${session.questions.length} question${session.questions.length === 1 ? '' : 's'}` : undefined}
              />
            </div>
            <div>
              {session.questions.map((qq, i) => {
                const pq = report.perQuestion.find((p) => p.questionId === qq.id)
                const isOpen = open === qq.id
                return (
                  <div key={qq.id} className="border-b border-border last:border-0">
                    <button
                      onClick={() => setOpen(isOpen ? null : qq.id)}
                      aria-expanded={isOpen}
                      className={cn(
                        'flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-surface-sunk',
                        isOpen && 'bg-surface-sunk',
                      )}
                    >
                      <span className={cn(
                        'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border text-[11px] font-bold tabular-nums transition-colors duration-150',
                        isOpen ? 'border-rule bg-surface-hover text-ink' : 'border-border bg-surface-hover text-ink-muted',
                      )}>
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{qq.text}</span>
                      <span className="flex flex-shrink-0 items-center gap-1.5">
                        {qq.category && <Badge variant="neutral">{qq.category}</Badge>}
                        {qq.autoSubmitted && (
                          <Badge variant="warning"><Zap size={11} aria-hidden="true" /> Auto</Badge>
                        )}
                        {typeof qq.timeUsedSeconds === 'number' && (
                          <span className="hidden items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink-muted sm:inline-flex">
                            <Clock size={11} aria-hidden="true" /> {qq.timeUsedSeconds}s
                          </span>
                        )}
                        <ChevronDown size={16} className={cn('text-ink-faint transition-transform duration-200', isOpen && 'rotate-180')} aria-hidden="true" />
                      </span>
                    </button>
                    {isOpen && (
                      <div className="space-y-5 border-t border-border bg-surface-sunk px-5 py-5">
                        <div>
                          <MicroLabel>{qq.videoUrl ? 'Recorded answer' : 'Answer'}</MicroLabel>
                          {qq.videoUrl && (
                            <video
                              controls
                              src={qq.videoUrl}
                              className="mt-2.5 aspect-video w-full max-w-lg overflow-hidden rounded-xl border border-border bg-brand-black"
                            />
                          )}
                          <div className="mt-2.5 rounded-xl border border-border bg-surface p-4">
                            {qq.answerText?.trim() ? (
                              <>
                                {qq.videoUrl && (
                                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">Transcript</p>
                                )}
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-body">{qq.answerText}</p>
                              </>
                            ) : (
                              <p className="text-sm italic leading-relaxed text-ink-faint">
                                {qq.videoUrl ? 'No speech was transcribed for this clip.' : 'No answer was provided.'}
                              </p>
                            )}
                          </div>
                        </div>
                        {pq && (
                          <>
                            <div>
                              <MicroLabel>KPI scores</MicroLabel>
                              <div className="mt-2.5 flex flex-wrap gap-2">
                                {Object.entries(pq.kpiScores).map(([kid, score]) => (
                                  <span key={kid} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs shadow-xs">
                                    <span className="text-ink-muted">{kpiLabel(kid)}</span>
                                    <span className="font-bold tabular-nums" style={{ color: scoreColor(score, pal) }}>{score}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div>
                              <MicroLabel>Feedback</MicroLabel>
                              <p className="mt-1.5 text-sm leading-relaxed text-ink-body">{pq.feedback}</p>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {session.questions.length === 0 && (
                <PanelEmpty
                  icon={<Inbox size={22} strokeWidth={1.75} />}
                  title="No questions recorded"
                  description="This interview finished without any questions attached, so there is nothing to break down."
                />
              )}
            </div>
          </Card>

          {/* call recording (Two-way Interview) */}
          {session.recordingUrl && (
            <Card className="p-5">
              <PanelHead icon={<Video size={14} strokeWidth={2} />} title="Call recording" className="mb-4" />
              <video
                controls
                src={session.recordingUrl}
                className="aspect-video w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-brand-black"
              />
            </Card>
          )}

          {/* interviewer manual review (Two-way Interview — recruiter-scored) */}
          {session.track === 'two_way' && (
            <ManualReviewCard sessionId={session.id} manualReview={report.manualReview} />
          )}

          {/* full transcript (conversation tracks) */}
          {session.transcript && (
            <Card className="overflow-hidden p-0">
              <div className="border-b border-border px-5 py-4">
                <PanelHead
                  icon={<MessageSquare size={14} strokeWidth={2} />}
                  title="Interview transcript"
                  meta={session.transcript.length > 0 ? `${session.transcript.length} turns` : undefined}
                />
              </div>
              {session.transcript.length === 0 ? (
                <PanelEmpty
                  icon={<MessageSquare size={22} strokeWidth={1.75} />}
                  title="No transcript captured"
                  description="Nothing was transcribed for this interview, so there is no conversation to review here."
                />
              ) : (
                <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
                  {session.transcript.map((t, i) => (
                    <div key={i} className="grid grid-cols-[96px_1fr] gap-3 px-5 py-3.5">
                      <span className={cn(
                        'pt-0.5 text-[11px] font-bold uppercase tracking-wide',
                        t.role === 'interviewer' ? 'text-ink' : 'text-ink-muted',
                      )}>
                        {t.role === 'interviewer' ? 'Interviewer' : 'Candidate'}
                      </span>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-body">{t.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* facial analysis (video track, AWS Rekognition) */}
          {session.track === 'video' && facial && (
            <FacialAnalysisPanel summary={facial as unknown as FacialSessionSummary} questionCount={session.questions.length} />
          )}

          {/* signal analytics — real transcript-derived metrics + text sentiment */}
          <SignalAnalytics track={session.track} speech={speech} sentiment={report.sentiment} />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-surface-sunk px-3 py-2.5">
      <div className="text-lg font-bold leading-tight tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
    </div>
  )
}

function SignalBar({ label, value }: { label: string; value: number }) {
  const pal = palette(useWorkspaceGround())
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-xs font-medium text-ink-body">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-hover">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: scoreColor(value, pal) }} />
      </div>
      <span className="w-8 text-right text-sm font-bold tabular-nums" style={{ color: scoreColor(value, pal) }}>{value}</span>
    </div>
  )
}

const SENTIMENT_STYLE: Record<SentimentSignals['overall'], string> = {
  positive: 'bg-ok-bg text-ok border-ok-rule',
  mixed: 'bg-warn-bg text-warn border-warn-rule',
  neutral: 'bg-surface-hover text-ink-body border-border',
  negative: 'bg-risk-bg text-risk border-risk-rule',
}

/**
 * Real signal analytics for conversation tracks: delivery metrics computed from
 * the stored transcript, and a text-based communication/sentiment read. Acoustic
 * pitch/energy prosody and facial analysis genuinely need the raw audio/video
 * (only captured in the live recruiter room), so those stay honest empty states.
 */
function SignalAnalytics({
  track,
  speech,
  sentiment,
}: {
  track: string
  speech?: SpeechMetrics
  sentiment?: SentimentSignals
}) {
  const spoken = speech?.spoken ?? (track === 'voice' || track === 'video_avatar')

  if (!speech && !sentiment) {
    return (
      <Card className="p-5">
        <PanelHead icon={<Activity size={14} strokeWidth={2} />} title="Signal analytics" />
        <PanelNote icon={<Info size={16} strokeWidth={1.75} />}>
          Delivery metrics and sentiment are available for voice and conversational interviews with a
          transcript. This interview type doesn’t produce one.
        </PanelNote>
      </Card>
    )
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Delivery metrics (from the transcript) */}
      <Card className="p-5">
        <PanelHead
          icon={spoken ? <Mic size={14} strokeWidth={2} /> : <Keyboard size={14} strokeWidth={2} />}
          title={spoken ? 'Speech metrics' : 'Response metrics'}
        />
        {speech ? (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Stat label="Words" value={speech.words} />
              <Stat label="Answers" value={speech.answers} />
              <Stat label="Avg words" value={speech.avgWordsPerAnswer} />
              {spoken && <Stat label="Fillers" value={speech.fillerCount} />}
              {spoken && <Stat label="Fillers /100" value={speech.fillerPer100} />}
              <Stat label="Vocabulary" value={`${speech.vocabularyPct}%`} />
              {typeof speech.avgResponseSeconds === 'number' && (
                <Stat label="Avg reply" value={`${speech.avgResponseSeconds}s`} />
              )}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              Computed from the interview transcript.
              {spoken
                ? ' Fillers depend on how the transcription captured speech; acoustic pace/pitch needs the live room.'
                : ''}
            </p>
          </>
        ) : (
          <PanelNote icon={<MessageSquare size={16} strokeWidth={1.75} />}>
            No transcript was captured for this interview.
          </PanelNote>
        )}
      </Card>

      {/* Communication & sentiment (text-based) */}
      <Card className="p-5">
        <PanelHead icon={<Activity size={14} strokeWidth={2} />} title="Communication & sentiment" />
        {sentiment ? (
          <>
            <div className="mt-4 flex items-center gap-2">
              <span className={cn('rounded-full border px-3 py-0.5 text-xs font-bold capitalize', SENTIMENT_STYLE[sentiment.overall])}>
                {sentiment.overall}
              </span>
              <span className="text-xs text-ink-faint">overall tone</span>
            </div>
            <div className="mt-4 space-y-3">
              <SignalBar label="Confidence" value={sentiment.confidence} />
              <SignalBar label="Clarity" value={sentiment.clarity} />
              <SignalBar label="Positivity" value={sentiment.positivity} />
            </div>
            <p className="mt-4 text-sm leading-relaxed text-ink-body">{sentiment.summary}</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-faint">
              From the transcript — reflects what the words convey, not audio tone.
            </p>
          </>
        ) : (
          <PanelNote icon={<KeyRound size={16} strokeWidth={1.75} />}>
            Sentiment analysis needs a Gemini API key. Add one in Settings to enable it.
          </PanelNote>
        )}
      </Card>
    </div>
  )
}

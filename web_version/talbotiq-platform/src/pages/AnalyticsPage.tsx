import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Cell,
} from 'recharts'
import { AlertTriangle, BarChart3, Inbox, Info, LineChart as LineChartIcon, RotateCcw } from 'lucide-react'
import { Button, Card, PageHeader, Select, Skeleton, EmptyState, SectionTitle, cn } from '@/components/ui'
import { analyticsApi, templatesApi } from '@/lib/api'
import { useAutopilotActions } from '@/features/guide/autopilot/registry'
import { matchOption, normalizeTrack } from '@/features/guide/autopilot/filterMatch'
import type { AnalyticsFilters, AnalyticsSummary, InterviewTemplate, TrackType } from '@shared/types'

/* ── Chart chrome — one visual contract for every series on this page ─────── */
const TOOLTIP = { background: '#fff', border: '1px solid #E3E6ED', borderRadius: 10, color: '#0E1420', fontSize: 12, padding: '8px 10px', boxShadow: '0 4px 12px -2px rgba(27,11,59,0.10)' }
const TOOLTIP_LABEL = { color: '#0E1420', fontWeight: 600, marginBottom: 2 }
const TOOLTIP_ITEM = { color: '#3A4454' }
const ACCENT = '#1D3FA0'
const GRID = '#E3E6ED'
const AXIS_TICK = { fill: '#5C6879', fontSize: 11 }

const TRACK_LABEL: Record<TrackType, string> = {
  chat: 'Timed Q&A', chatbot: 'Chatbot', voice: 'Voice', video_avatar: 'Video Avatar', video: 'Video Interview', two_way: 'Two-way Interview',
}
const REC_LABEL: Record<string, string> = {
  strong_yes: 'Strong Yes', yes: 'Yes', maybe: 'Maybe', no: 'No', unknown: 'Unscored',
}
const REC_COLOR: Record<string, string> = {
  strong_yes: '#1D3FA0', yes: '#15803D', maybe: '#B45309', no: '#dc2626', unknown: '#626B79',
}

/* ── Score bands — the single colour language for every score on the page,
      aligned to the five distribution buckets the API returns. ───────────── */
const bucketColor = (b: string) => (b === '81-100' ? '#1D3FA0' : b === '61-80' ? '#15803D' : b === '41-60' ? '#B45309' : '#dc2626')
const scoreColor = (n: number) => (n >= 81 ? '#1D3FA0' : n >= 61 ? '#15803D' : n >= 41 ? '#B45309' : '#dc2626')
const scoreInk = (n: number) => (n >= 81 ? 'text-primary-700' : n >= 61 ? 'text-success' : n >= 41 ? 'text-warning' : 'text-danger')
const BAND_LEGEND = [
  { label: '0–40', hex: '#dc2626' },
  { label: '41–60', hex: '#B45309' },
  { label: '61–80', hex: '#15803D' },
  { label: '81–100', hex: '#1D3FA0' },
]

const pct = (n: number) => `${Math.round(n * 100)}%`
const mmss = (s: number) => (s > 0 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : '—')

/* ── Local presentational pieces ──────────────────────────────────────────── */

/** Headline stat — 11px uppercase label, extrabold display value, muted sub line. */
function Stat({ label, value, sub, tone = 'ink' }: { label: string; value: string | number; sub?: string; tone?: 'ink' | 'primary' }) {
  return (
    <Card className="flex flex-col gap-1.5 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={cn('font-display text-3xl font-extrabold tracking-[-0.03em] tabular-nums', tone === 'primary' ? 'text-primary-700' : 'text-neutral-900')}>{value}</p>
      {sub && <p className="text-xs font-medium text-neutral-500">{sub}</p>}
    </Card>
  )
}

/** Panel heading — the DS section rule plus an optional muted context line. */
function PanelHead({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-4">
      <SectionTitle className={meta ? 'mb-1.5' : 'mb-0'}>{title}</SectionTitle>
      {meta && <p className="text-xs leading-relaxed text-neutral-500">{meta}</p>}
    </div>
  )
}

/** In-panel empty — a designed well rather than a bare sentence. */
function MiniEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-neutral-50 px-4 py-6 text-sm text-neutral-500">
      <Inbox className="h-5 w-5 flex-shrink-0 text-neutral-400" strokeWidth={1.75} aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

/** Column header — 11px uppercase, hairline rule, numeric columns right-aligned. */
function Th({ children, align = 'left', className }: { children: ReactNode; align?: 'left' | 'right'; className?: string }) {
  return <th scope="col" className={cn('pb-2 font-semibold', align === 'right' ? 'text-right' : 'text-left', className)}>{children}</th>
}

/** Score cell — right-aligned, bold, tabular, inked by band. Zero reads as “no score yet”. */
function ScoreCell({ value }: { value: number }) {
  return value
    ? <span className={cn('text-sm font-bold tabular-nums', scoreInk(value))}>{value}</span>
    : <span className="text-sm text-neutral-400">—</span>
}

/** Proportional bar — neutral well, rounded-full fill. */
function MeterBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
      <div className="h-full rounded-full transition-[width] duration-200 ease-out" style={{ width: `${value}%`, background: color }} />
    </div>
  )
}

const BAR_SKELETON_HEIGHTS = ['h-[38%]', 'h-[62%]', 'h-[92%]', 'h-[70%]', 'h-[46%]']

function ChartSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-2.5 w-32 rounded-full" />
      <div className="mt-7 flex h-[200px] items-end gap-3">
        {BAR_SKELETON_HEIGHTS.map((h, i) => <Skeleton key={i} className={cn('flex-1 rounded-b-none', h)} />)}
      </div>
    </Card>
  )
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <Card className="p-5">
      <Skeleton className="h-2.5 w-28 rounded-full" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-28 flex-shrink-0 rounded-full" />
            <Skeleton className="h-2 flex-1 rounded-full" />
            <Skeleton className="h-3 w-8 flex-shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function AnalyticsPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>({})
  const set = <K extends keyof AnalyticsFilters>(k: K, v: AnalyticsFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: v || undefined }))

  const templates = useQuery({ queryKey: ['templates'], queryFn: templatesApi.list })
  const analytics = useQuery({ queryKey: ['analytics', filters], queryFn: () => analyticsApi.summary(filters) })

  const roles = useMemo(() => {
    const s = new Set<string>()
    for (const t of templates.data ?? []) if (t.role?.trim()) s.add(t.role.trim())
    return [...s].sort()
  }, [templates.data])

  const a = analytics.data
  const hasFilters = Object.values(filters).some(Boolean)
  // Score distribution, average score, and top candidates only make sense WITHIN a
  // single position — averaging/ranking them across every role at once is misleading.
  // Reveal them only once the recruiter narrows to a specific role or template.
  const positionSelected = !!filters.role || !!filters.templateId
  const positionLabel =
    filters.role ??
    (filters.templateId ? templates.data?.find((t) => t.id === filters.templateId)?.name : undefined) ??
    'this position'

  // ── Autopilot: drive the dashboard filters by voice/typed exactly like the
  // controls above. Filtering is read-only (NOT a side effect), so these run
  // immediately without a confirm. They read live data/setters through a ref so
  // the memoized action defs never go stale. getState also exposes the current
  // filters, the available options, and the headline metrics so Autopilot can
  // ANSWER questions about the dashboard ("what's the completion rate?"). ──────
  const navigate = useNavigate()
  const apRef = useRef<{
    filters: AnalyticsFilters
    set: <K extends keyof AnalyticsFilters>(k: K, v: AnalyticsFilters[K]) => void
    clear: () => void
    roles: string[]
    templates: InterviewTemplate[]
    data: AnalyticsSummary | undefined
    positionSelected: boolean
  }>({ filters: {}, set: () => {}, clear: () => {}, roles: [], templates: [], data: undefined, positionSelected: false })

  const apActions = useMemo(() => ({
    filterByTrack: {
      description: 'Filter the dashboard by interview type / track: Chatbot, Voice, Video Avatar, Video Interview, Two-way Interview, or Timed Q&A. Say "all" to clear the track filter.',
      params: [{ name: 'track', type: 'string' as const, required: true, description: 'the interview type/track name, or "all" to clear' }],
      run: (args: Record<string, unknown>) => {
        const t = normalizeTrack(String(args.track ?? ''))
        if (t === null) { toast.error(`Unknown interview type "${String(args.track)}"`); return }
        apRef.current.set('track', t === 'all' ? undefined : t)
      },
    },
    filterByRole: {
      description: 'Filter the dashboard by candidate role/position (matches an existing role). Say "all" to clear the role filter.',
      params: [{ name: 'role', type: 'string' as const, required: true, description: 'the role name, or "all" to clear' }],
      run: (args: Record<string, unknown>) => {
        const want = String(args.role ?? '').trim()
        if (!want || /^(all|any)$/i.test(want)) { apRef.current.set('role', undefined); return }
        const match = matchOption(want, apRef.current.roles)
        if (!match) { toast.error(`No role matching "${want}"`); return }
        apRef.current.set('role', match)
      },
    },
    filterByTemplate: {
      description: 'Filter the dashboard by interview template (matches a template name). Say "all" to clear the template filter.',
      params: [{ name: 'template', type: 'string' as const, required: true, description: 'the template name, or "all" to clear' }],
      run: (args: Record<string, unknown>) => {
        const want = String(args.template ?? '').trim()
        if (!want || /^(all|any)$/i.test(want)) { apRef.current.set('templateId', undefined); return }
        const names = apRef.current.templates.map((t) => t.name)
        const match = matchOption(want, names)
        const tpl = match ? apRef.current.templates.find((t) => t.name === match) : undefined
        if (!tpl) { toast.error(`No template matching "${want}"`); return }
        apRef.current.set('templateId', tpl.id)
      },
    },
    setDateRange: {
      description: 'Set the completion date range. Dates are YYYY-MM-DD. Omit a bound to leave it open (e.g. only "from" = that date onward). Use clearFilters to remove dates entirely.',
      params: [
        { name: 'from', type: 'string' as const, required: false, description: 'start date YYYY-MM-DD' },
        { name: 'to', type: 'string' as const, required: false, description: 'end date YYYY-MM-DD' },
      ],
      run: (args: Record<string, unknown>) => {
        apRef.current.set('dateFrom', (args.from ? String(args.from) : undefined) as AnalyticsFilters['dateFrom'])
        apRef.current.set('dateTo', (args.to ? String(args.to) : undefined) as AnalyticsFilters['dateTo'])
      },
    },
    clearFilters: {
      description: 'Clear ALL dashboard filters (track, template, role, and dates) back to the aggregate view.',
      params: [],
      run: () => apRef.current.clear(),
    },
    openCandidateReport: {
      description: 'Open a top candidate\'s full report. Identify them by 1-based rank in the Top Candidates list, or by name. Only available once a role or template is selected (that is when Top Candidates appears).',
      params: [
        { name: 'rank', type: 'number' as const, required: false, description: '1-based position in Top Candidates' },
        { name: 'name', type: 'string' as const, required: false, description: 'candidate name' },
      ],
      run: (args: Record<string, unknown>) => {
        const top = apRef.current.data?.topCandidates ?? []
        if (top.length === 0) { toast.error('No top candidates — pick a role or template first'); return }
        let hit = top[0]
        if (args.rank !== undefined && args.rank !== null && String(args.rank) !== '') {
          const idx = Number(args.rank) - 1
          if (idx < 0 || idx >= top.length) { toast.error(`There are only ${top.length} top candidates`); return }
          hit = top[idx]
        } else if (args.name) {
          const match = matchOption(String(args.name), top.map((c) => c.name))
          const found = match ? top.find((c) => c.name === match) : undefined
          if (!found) { toast.error(`No top candidate named "${String(args.name)}"`); return }
          hit = found
        }
        navigate(`/sessions/${hit.sessionId}/report`)
      },
    },
  }), [navigate])

  const apGetState = useCallback(() => {
    const { filters: f, roles: rs, templates: tpls, data, positionSelected: ps } = apRef.current
    const tplName = f.templateId ? tpls.find((t) => t.id === f.templateId)?.name ?? f.templateId : null
    return {
      screen: 'analytics',
      filters: {
        track: f.track ? TRACK_LABEL[f.track] : 'All tracks',
        role: f.role ?? 'All roles',
        template: tplName ?? 'All templates',
        dateFrom: f.dateFrom ?? null,
        dateTo: f.dateTo ?? null,
      },
      availableTracks: (Object.keys(TRACK_LABEL) as TrackType[]).map((t) => TRACK_LABEL[t]),
      availableRoles: rs,
      availableTemplates: tpls.map((t) => t.name),
      positionSelected: ps,
      metrics: data && data.totals.scored > 0 ? {
        created: data.totals.created,
        started: data.totals.started,
        completed: data.totals.completed,
        completionRate: pct(data.completionRate),
        averageScore: ps ? data.averageOverall : null,
        avgDuration: mmss(data.timeStats.avgDurationSeconds),
      } : null,
      topCandidates: ps ? (data?.topCandidates ?? []).map((c, i) => ({ rank: i + 1, name: c.name, score: c.overallScore })) : [],
    }
  }, [])
  const apOpts = useMemo(() => ({ getState: apGetState }), [apGetState])
  useAutopilotActions('analytics', apActions, apOpts)
  // Publish live data + setters every render so the actions above act on current state.
  apRef.current = { filters, set, clear: () => setFilters({}), roles, templates: templates.data ?? [], data: a, positionSelected }

  const filterBar = (
    <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-3 xl:grid-cols-[10rem_13rem_12rem_9.5rem_9.5rem_1fr]">
      <Select label="Track" value={filters.track ?? ''} onChange={(e) => set('track', (e.target.value || undefined) as TrackType | undefined)}
        options={[{ value: '', label: 'All tracks' }, ...(Object.keys(TRACK_LABEL) as TrackType[]).map((t) => ({ value: t, label: TRACK_LABEL[t] }))]} />
      <Select label="Template" value={filters.templateId ?? ''} onChange={(e) => set('templateId', e.target.value || undefined)}
        options={[{ value: '', label: 'All templates' }, ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
      <Select label="Role" value={filters.role ?? ''} onChange={(e) => set('role', e.target.value || undefined)}
        options={[{ value: '', label: 'All roles' }, ...roles.map((r) => ({ value: r, label: r }))]} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="analytics-date-from" className="field-label">From</label>
        <input id="analytics-date-from" type="date" value={filters.dateFrom ?? ''} onChange={(e) => set('dateFrom', e.target.value || undefined)} className="input-base" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="analytics-date-to" className="field-label">To</label>
        <input id="analytics-date-to" type="date" value={filters.dateTo ?? ''} onChange={(e) => set('dateTo', e.target.value || undefined)} className="input-base" />
      </div>
      {hasFilters && (
        <div className="flex justify-end">
          <Button variant="ghost" size="md" className="h-11" onClick={() => setFilters({})} icon={<RotateCcw size={14} strokeWidth={2} aria-hidden="true" />}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      <PageHeader
        kicker="Platform Analytics"
        title="AI Interview Dashboard"
        description="Real metrics aggregated from scored interviews across every interview track."
      />

      <Card className="p-4 mb-6">{filterBar}</Card>

      {analytics.isLoading ? (
        <div>
          <p className="sr-only" role="status">Loading analytics…</p>
          <div aria-hidden="true" className="space-y-6">
            <div className={cn('grid grid-cols-2 gap-4', positionSelected ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
              {(positionSelected ? [0, 1, 2, 3] : [0, 1, 2]).map((i) => (
                <Card key={i} className="flex flex-col gap-2.5 p-5">
                  <Skeleton className="h-2.5 w-24 rounded-full" />
                  <Skeleton className="h-7 w-20 rounded-lg" />
                  <Skeleton className="h-2.5 w-32 rounded-full" />
                </Card>
              ))}
            </div>
            {positionSelected && (
              <>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <ChartSkeleton />
                  <ChartSkeleton />
                </div>
                <ListSkeleton rows={4} />
              </>
            )}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <ListSkeleton rows={5} />
              <ListSkeleton rows={5} />
            </div>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <ListSkeleton rows={4} />
              <ListSkeleton rows={4} />
            </div>
          </div>
        </div>
      ) : analytics.isError ? (
        <Card className="p-0">
          <EmptyState
            icon={<AlertTriangle strokeWidth={1.75} />}
            title="Couldn’t load analytics"
            description="The analytics service returned an error. Your filters are still applied — try again in a moment."
            action={<Button variant="secondary" onClick={() => analytics.refetch()}>Try again</Button>}
          />
        </Card>
      ) : !a || a.totals.scored === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={<BarChart3 strokeWidth={1.75} />}
            title={hasFilters ? 'No scored interviews match these filters' : 'No scored interviews yet'}
            description={
              hasFilters
                ? 'Adjust or clear the filters above. Metrics appear once matching interviews are completed and scored.'
                : `${a?.totals.created ?? 0} session(s) created, ${a?.totals.completed ?? 0} completed. Numbers populate here as interviews finish and scoring completes.`
            }
            action={hasFilters ? <Button variant="secondary" onClick={() => setFilters({})}>Clear filters</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* Funnel / headline stats — all real. Average Score is position-specific. */}
          <div className={cn('grid grid-cols-2 gap-4', positionSelected ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
            <Stat label="Interviews Created" value={a.totals.created} sub={`${a.totals.started} started · ${a.totals.completed} completed`} />
            <Stat label="Completion Rate" value={pct(a.completionRate)} sub={`${a.totals.completed} of ${a.totals.created}`} />
            {positionSelected && (
              <Stat label="Average Score" value={a.averageOverall} sub={`across ${a.totals.scored} scored`} tone="primary" />
            )}
            <Stat label="Avg Duration" value={mmss(a.timeStats.avgDurationSeconds)} sub={`~${mmss(a.timeStats.avgTimePerQuestionSeconds)}/question`} />
          </div>

          {/* In the aggregate (all-positions) view, position-specific insights are hidden. */}
          {!positionSelected && (
            <Card className="border-primary-200 bg-primary-50/70 p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                  <Info className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-neutral-900">Position-level insights are hidden</p>
                  <p className="mt-1 text-sm leading-relaxed text-neutral-700">
                    Select a <span className="font-semibold text-neutral-900">Role</span> or <span className="font-semibold text-neutral-900">Template</span> above to see the
                    {' '}average score, score distribution, KPI averages, and top candidates for that position.
                    These are only meaningful within a single position.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Score distribution + trend — position-specific (hidden in the aggregate view) */}
          {positionSelected && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card className="p-5">
              <PanelHead title="Score Distribution" meta={`Scored interviews · ${positionLabel}`} />
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={a.scoreDistribution} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
                  <XAxis dataKey="bucket" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_ITEM} cursor={{ fill: '#F1F3F7' }} />
                  <Bar dataKey="count" name="Interviews" radius={[6, 6, 0, 0]} maxBarSize={54}>
                    {a.scoreDistribution.map((d) => <Cell key={d.bucket} fill={bucketColor(d.bucket)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3">
                {BAND_LEGEND.map((b) => (
                  <span key={b.label} className="flex items-center gap-1.5 text-[11px] font-medium tabular-nums text-neutral-500">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: b.hex }} />
                    {b.label}
                  </span>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <PanelHead title="Average Score Trend" meta="By completion day" />
              {a.trend.length === 0 ? (
                <div className="flex h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-neutral-50 text-center">
                  <LineChartIcon className="h-5 w-5 text-neutral-400" strokeWidth={1.75} aria-hidden="true" />
                  <p className="text-sm text-neutral-500">Not enough history yet</p>
                  <p className="max-w-[16rem] text-xs text-neutral-400">A trend line appears once interviews are completed on two or more days.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={a.trend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <defs><linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={ACCENT} stopOpacity={0.16} /><stop offset="95%" stopColor={ACCENT} stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
                    <XAxis dataKey="date" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis domain={[0, 100]} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={TOOLTIP} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_ITEM} cursor={{ stroke: '#CBD1DC' }} />
                    <Area type="monotone" dataKey="averageOverall" name="Avg score" stroke={ACCENT} strokeWidth={2} fill="url(#scoreGrad)" dot={{ fill: ACCENT, r: 3, strokeWidth: 0 }} activeDot={{ fill: ACCENT, r: 4, strokeWidth: 0 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>
          )}

          {/* Per-KPI averages — position-specific (hidden in the aggregate view) */}
          {positionSelected && (
          <Card className="p-5">
            <PanelHead title={`KPI Averages · ${positionLabel}`} meta="Mean score per KPI, with the share of scored interviews whose rubric included it." />
            {a.kpiAverages.length === 0 ? (
              <MiniEmpty>No KPI data for this position yet.</MiniEmpty>
            ) : (
              <div className="divide-y divide-border">
                {a.kpiAverages.map((k) => (
                  <div key={k.kpiId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="w-24 flex-shrink-0 truncate text-sm text-neutral-700 sm:w-44" title={k.label}>{k.label}</span>
                    <MeterBar value={k.average} color={scoreColor(k.average)} />
                    <span className="w-9 flex-shrink-0 text-right text-sm font-bold tabular-nums text-neutral-800">{k.average}</span>
                    <span className="w-20 flex-shrink-0 text-right text-[11px] tabular-nums text-neutral-400 sm:w-24" title="Share of scored interviews whose rubric included this KPI">{pct(k.coverage)} coverage</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          )}

          {/* Track comparison + recommendation distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card className="p-5">
              <PanelHead title="By Track" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[26rem] table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wide text-neutral-500">
                      <Th>Track</Th>
                      <Th align="right" className="w-24">Sessions</Th>
                      <Th align="right" className="w-24">Avg score</Th>
                      <Th align="right" className="w-24">Completion</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.byTrack.map((t) => (
                      <tr key={t.track} className="border-b border-border last:border-0">
                        <td className="truncate py-3 pr-3 font-semibold text-neutral-900" title={TRACK_LABEL[t.track]}>{TRACK_LABEL[t.track]}</td>
                        <td className="py-3 pl-3 text-right tabular-nums text-neutral-500">{t.count}</td>
                        <td className="py-3 pl-3 text-right"><ScoreCell value={t.averageOverall} /></td>
                        <td className="py-3 pl-3 text-right font-semibold tabular-nums text-neutral-800">{pct(t.completionRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="p-5">
              <PanelHead title="Recommendations" />
              <div className="space-y-2.5">
                {a.recommendationDistribution.length === 0 ? (
                  <MiniEmpty>No recommendations recorded yet.</MiniEmpty>
                ) : (
                  a.recommendationDistribution.map((r) => {
                    const total = a.recommendationDistribution.reduce((s, x) => s + x.count, 0)
                    const share = total ? r.count / total : 0
                    const color = REC_COLOR[r.recommendation] ?? '#626B79'
                    return (
                      <div key={r.recommendation} className="flex items-center gap-3">
                        <span className="flex w-24 flex-shrink-0 items-center gap-2 text-sm text-neutral-700">
                          <span aria-hidden="true" className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
                          <span className="truncate">{REC_LABEL[r.recommendation] ?? r.recommendation}</span>
                        </span>
                        <MeterBar value={Math.round(share * 100)} color={color} />
                        <span className="w-8 flex-shrink-0 text-right text-sm font-bold tabular-nums text-neutral-800">{r.count}</span>
                        <span className="w-10 flex-shrink-0 text-right text-[11px] tabular-nums text-neutral-400">{pct(share)}</span>
                      </div>
                    )
                  })
                )}
                <div className="mt-1 border-t border-border pt-3 text-xs text-neutral-500">
                  Integrity flags on {pct(a.integrityFlagRate)} of scored interviews.
                </div>
              </div>
            </Card>
          </div>

          {/* By role + by template */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card className="p-5">
              <PanelHead title="By Role" />
              {a.byRole.length === 0 ? <MiniEmpty>No role data yet.</MiniEmpty> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[22rem] table-fixed text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase tracking-wide text-neutral-500">
                        <Th>Role</Th>
                        <Th align="right" className="w-24">Sessions</Th>
                        <Th align="right" className="w-24">Avg score</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.byRole.map((r) => (
                        <tr key={r.role} className="border-b border-border last:border-0">
                          <td className="truncate py-3 pr-3 text-neutral-700" title={r.role}>{r.role}</td>
                          <td className="py-3 pl-3 text-right tabular-nums text-neutral-500">{r.count}</td>
                          <td className="py-3 pl-3 text-right"><ScoreCell value={r.averageOverall} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="p-5">
              <PanelHead title="By Template" />
              {a.byTemplate.length === 0 ? <MiniEmpty>No template data yet.</MiniEmpty> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[22rem] table-fixed text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase tracking-wide text-neutral-500">
                        <Th>Template</Th>
                        <Th align="right" className="w-24">Sessions</Th>
                        <Th align="right" className="w-24">Avg score</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.byTemplate.map((t) => (
                        <tr key={t.templateId} className="border-b border-border last:border-0">
                          <td className="truncate py-3 pr-3 text-neutral-700" title={t.name}>{t.name}</td>
                          <td className="py-3 pl-3 text-right tabular-nums text-neutral-500">{t.count}</td>
                          <td className="py-3 pl-3 text-right"><ScoreCell value={t.averageOverall} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Top candidates — position-specific (hidden in the aggregate view) */}
          {positionSelected && (
          <Card className="p-5">
            <PanelHead
              title={`Top Candidates · ${positionLabel}`}
              meta="Open a candidate for their full report — AI summary, strengths, areas to improve, per-question breakdown and KPI scores."
            />
            {a.topCandidates.length === 0 ? <MiniEmpty>No scored candidates for this position yet.</MiniEmpty> : (
              <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                {a.topCandidates.map((c, i) => (
                  <Link key={c.sessionId} to={`/sessions/${c.sessionId}/report`}
                    title={`Open ${c.name}'s full candidate report`}
                    className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors duration-150 hover:border-primary-100 hover:bg-primary-50/60">
                    {/* A rank is a numeral, so it is set in the mono and squared. It was a
                        gradient-filled circle, which made position 1 read as a
                        decorated badge rather than as the top of an ordered list. */}
                    <span className={cn('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm border font-mono text-[11px] nums', i === 0 ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-border bg-neutral-50 text-neutral-500')}>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-neutral-900">{c.name}</span>
                      {c.role && <span className="block truncate text-xs text-neutral-500">{c.role}</span>}
                    </span>
                    <span aria-hidden="true" className="hidden flex-shrink-0 text-xs font-semibold text-primary-700 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 sm:inline">View report →</span>
                    <span className={cn('flex-shrink-0 text-sm font-bold tabular-nums', scoreInk(c.overallScore))}>{c.overallScore}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          )}

          <p className="text-center text-[11px] text-neutral-400">Aggregated {new Date(a.generatedAt).toLocaleString()} · scored interviews only</p>
        </div>
      )}
    </div>
  )
}

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Cell,
} from 'recharts'
import { AlertTriangle, BarChart3, Inbox, Info, LineChart as LineChartIcon, RotateCcw } from 'lucide-react'
import { Button, Card, PageHeader, Select, Skeleton, EmptyState, SectionTitle, cn } from '@/components/ui'
import { FeedbackPanel } from '@/features/recruiter/FeedbackPanel'
import { palette } from '@/design/tokens'
import { duration, staggerChild, staggerVariants, transition } from '@/design/motion'
import { useWorkspaceGround } from '@/lib/workspaceGround'
import { analyticsApi, templatesApi } from '@/lib/api'
import { useAutopilotActions } from '@/features/guide/autopilot/registry'
import { matchOption, normalizeTrack } from '@/features/guide/autopilot/filterMatch'
import type { AnalyticsFilters, AnalyticsSummary, InterviewTemplate, TrackType } from '@shared/types'

/* ── Chart chrome — one visual contract for every series on this page.
      Charts can't read CSS variables, so the hexes come from the typed token
      mirror, resolved against the current workspace ground. ───────────────── */
type Pal = ReturnType<typeof palette>

/* The tooltip is a panel ABOVE a panel, so it takes --surface-raised, not
   --surface: in a room the two are the same near-black and a tooltip drawn on
   --surface reads as a hole rather than as a card. Its lift follows the ground
   for the same reason elevation does — a drop shadow is invisible on near-black,
   so the room gets a deeper, tighter one. Radius is 6px (--radius-lg): the
   system is squared, and a 10px chip next to 8px cards read as a different kit. */
const tooltipStyle = (pal: Pal, dark: boolean) => ({
  background: pal.surfaceRaised,
  border: `1px solid ${dark ? pal.ruleStrong : pal.rule}`,
  borderRadius: 6,
  color: pal.ink,
  fontSize: 12,
  padding: '8px 10px',
  boxShadow: dark ? '0 8px 24px -8px rgba(0,0,0,0.62)' : '0 4px 12px -2px rgba(14,20,32,0.10)',
})
const tooltipLabelStyle = (pal: Pal) => ({ color: pal.ink, fontWeight: 600, marginBottom: 2 })
const tooltipItemStyle = (pal: Pal) => ({ color: pal.inkBody })

/* One chart-animation contract: long enough to be read as data arriving, short
   enough that nobody waits for it. Recharts owns this timing internally, so it
   cannot take a framer variant — the reduce branch is applied by the caller. */
const CHART_ANIM = { isAnimationActive: true, animationDuration: 620, animationEasing: 'ease-out' } as const

const TRACK_LABEL: Record<TrackType, string> = {
  chat: 'Timed Q&A', chatbot: 'Chatbot', voice: 'Voice', video_avatar: 'Video Avatar', video: 'Video Interview', two_way: 'Two-way Interview',
  mcq: 'MCQ Assessment',
}
const REC_LABEL: Record<string, string> = {
  strong_yes: 'Strong Yes', yes: 'Yes', maybe: 'Maybe', no: 'No', unknown: 'Unscored',
}
const recColor = (rec: string, pal: Pal) =>
  rec === 'strong_yes' ? pal.ink : rec === 'yes' ? pal.ok : rec === 'maybe' ? pal.warn : rec === 'no' ? pal.risk : pal.inkFaint

/* ── Score bands — the single colour language for every score on the page,
      aligned to the five distribution buckets the API returns. ───────────── */
const bucketColor = (b: string, pal: Pal) => (b === '81-100' ? pal.ink : b === '61-80' ? pal.ok : b === '41-60' ? pal.warn : pal.risk)
const scoreColor = (n: number, pal: Pal) => (n >= 81 ? pal.ink : n >= 61 ? pal.ok : n >= 41 ? pal.warn : pal.risk)
const scoreInk = (n: number) => (n >= 81 ? 'text-ink' : n >= 61 ? 'text-ok' : n >= 41 ? 'text-warn' : 'text-risk')
const bandLegend = (pal: Pal) => [
  { label: '0–40', hex: pal.risk },
  { label: '41–60', hex: pal.warn },
  { label: '61–80', hex: pal.ok },
  { label: '81–100', hex: pal.ink },
]

const pct = (n: number) => `${Math.round(n * 100)}%`
const mmss = (s: number) => (s > 0 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : '—')

/* ── Local presentational pieces ──────────────────────────────────────────── */

/* ── The headline strip ───────────────────────────────────────────────────
   This was four identical tiles, which is the arrangement that tells a reader
   nothing: if every number is the same size, none of them is the answer. The
   strip now has ONE lead figure and a ruled row of supports, so the eye lands
   on the health of the funnel first and reads the rest as context.

   The cells are laid out as a 1px-gap grid over --rule with --surface cells,
   which draws exact hairlines between them at every breakpoint — including the
   wrap — without a first:/last: border dance. */

/** A supporting figure in the headline strip. Ruled cell, 2xl value, muted sub. */
function StatCell({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col justify-between gap-2 bg-surface p-5">
      <p className="section-label">{label}</p>
      <div>
        <p className="font-display text-2xl font-bold tracking-[-0.02em] tabular-nums text-ink">{value}</p>
        {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
      </div>
    </div>
  )
}

/**
 * The lead figure — completion rate, because it is the one number that says
 * whether the funnel is working, and it is the only headline metric that is
 * meaningful in the aggregate view as well as inside a position.
 *
 * The rail underneath is a SECOND ENCODING of the same value, not a new metric:
 * a proportion is read faster as a length than as two digits. It animates on
 * scaleX rather than width so it composites instead of triggering layout.
 */
function StatLead({ label, value, sub, ratio, reduce }: {
  label: string; value: string; sub?: string; ratio: number; reduce: boolean
}) {
  const r = Math.max(0, Math.min(1, ratio))
  return (
    <div className="flex flex-col justify-between gap-3 bg-surface p-5 sm:col-span-2 lg:col-span-1">
      <p className="section-label">{label}</p>
      <div>
        <p className="font-display text-4xl font-extrabold leading-none tracking-[-0.03em] tabular-nums text-ink">{value}</p>
        <div aria-hidden="true" className="mt-3.5 h-[3px] w-full overflow-hidden rounded-sm bg-surface-hover">
          <motion.div
            className="h-full w-full origin-left rounded-sm bg-action"
            initial={{ scaleX: reduce ? r : 0 }}
            animate={{ scaleX: r }}
            transition={reduce ? { duration: duration.fast } : transition.slow}
          />
        </div>
        {sub && <p className="mt-2 text-xs text-ink-muted">{sub}</p>}
      </div>
    </div>
  )
}

/** Panel heading — the DS section rule plus an optional muted context line. */
function PanelHead({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-4">
      <SectionTitle className={meta ? 'mb-1.5' : 'mb-0'}>{title}</SectionTitle>
      {meta && <p className="text-xs leading-relaxed text-ink-muted">{meta}</p>}
    </div>
  )
}

/**
 * In-panel empty — a designed well rather than a bare sentence.
 *
 * Centred over a faint key light so the well reads as a lit, deliberate space
 * instead of a failed region, and set as a section label so it matches the
 * ruled labels around it. The text is unchanged — `.section-label` uppercases
 * through CSS, so the accessible name and the DOM text still read as written.
 */
function MiniEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate-paint overflow-hidden rounded-lg border border-dashed border-rule bg-surface-sunk px-4 py-8">
      <div aria-hidden="true" className="keylight-accent pointer-events-none absolute inset-0 [--key-y:50%]" />
      <div className="relative flex flex-col items-center gap-2 text-center">
        <Inbox className="h-4 w-4 text-ink-faint" strokeWidth={1.75} aria-hidden="true" />
        <p className="section-label">{children}</p>
      </div>
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
    : <span className="text-sm text-ink-faint">—</span>
}

/**
 * Proportional bar — squared well, squared fill.
 *
 * `rounded-full` is reserved by the token layer for avatars, status dots and
 * the voice orb, so the meter is squared like every other measured thing here.
 * It grows on scaleX rather than width: a width transition animates layout on a
 * page that can render forty of these at once.
 */
function MeterBar({ value, color }: { value: number; color: string }) {
  const r = Math.max(0, Math.min(100, value)) / 100
  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-surface-hover">
      <div
        className="h-full w-full origin-left rounded-sm transition-transform duration-base ease-out"
        style={{ transform: `scaleX(${r})`, background: color }}
      />
    </div>
  )
}

const BAR_SKELETON_HEIGHTS = ['h-[38%]', 'h-[62%]', 'h-[92%]', 'h-[70%]', 'h-[46%]']

function ChartSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-2.5 w-32 rounded-sm" />
      <div className="mt-7 flex h-[200px] items-end justify-center gap-6">
        {BAR_SKELETON_HEIGHTS.map((h, i) => <Skeleton key={i} className={cn('w-9 rounded-b-none', h)} />)}
      </div>
    </Card>
  )
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <Card className="p-5">
      <Skeleton className="h-2.5 w-28 rounded-sm" />
      <div className="mt-6 space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-28 flex-shrink-0 rounded-sm" />
            <Skeleton className="h-1.5 flex-1 rounded-sm" />
            <Skeleton className="h-3 w-8 flex-shrink-0 rounded-sm" />
          </div>
        ))}
      </div>
    </Card>
  )
}

/** The headline strip's loading shape — same hairline grid, so nothing shifts. */
function StatStripSkeleton({ cells }: { cells: number }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className={cn('grid gap-px bg-rule sm:grid-cols-2', cells === 4 ? 'lg:grid-cols-[1.4fr_1fr_1fr_1fr]' : 'lg:grid-cols-[1.4fr_1fr_1fr]')}>
        {Array.from({ length: cells }).map((_, i) => (
          <div key={i} className={cn('flex flex-col gap-3 bg-surface p-5', i === 0 && 'sm:col-span-2 lg:col-span-1')}>
            <Skeleton className="h-2.5 w-24 rounded-sm" />
            <Skeleton className={cn('rounded-sm', i === 0 ? 'h-9 w-28' : 'h-6 w-20')} />
            {i === 0 && <Skeleton className="h-[3px] w-full rounded-sm" />}
            <Skeleton className="h-2.5 w-32 rounded-sm" />
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function AnalyticsPage() {
  // Chart chrome resolved against the current workspace ground — Recharts needs
  // literal hexes, so these come from the typed token mirror, not CSS variables.
  const ground = useWorkspaceGround()
  const dark = ground === 'room'
  const pal = palette(ground)
  const reduce = useReducedMotion() ?? false
  const stagger = staggerVariants(reduce, 0.04)
  const child = staggerChild(reduce)
  const TOOLTIP = tooltipStyle(pal, dark)
  const TOOLTIP_LABEL = tooltipLabelStyle(pal)
  const TOOLTIP_ITEM = tooltipItemStyle(pal)
  /* The trend's one series. `accent` is the registrar blue that the token layer
     reserves for links, focus and the PROGRESS RAIL — a score moving over time
     is exactly that, and it is the only accent-bearing element in its panel, so
     it stays inside the one-accent-per-region budget. It also keeps the trend
     visibly distinct from the score-band language (ink / ok / warn / risk) used
     by the distribution chart beside it. */
  const ACCENT = pal.accent
  const GRID = pal.rule
  /* No axis line, no tick line: the grid already establishes the plane, and a
     second set of rules around it is chart-junk. 11px muted, breathing room via
     tickMargin so the labels are not welded to the plot. */
  const AXIS_TICK = { fill: pal.inkMuted, fontSize: 11 }
  /* A cursor is a hover hint, not a highlight — it sits at 35% of a hairline so
     it reads on both grounds without repainting the bar underneath it. */
  const BAR_CURSOR = { fill: pal.rule, opacity: 0.35 }

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
      {/* The date fields are hand-rolled rather than kit fields because the kit
          has no date primitive — so they mirror FieldShell exactly: the same
          gap-1.5 column and `field-label mb-0`. Without the mb-0 the label's own
          5px bottom margin stacks on the gap and the two date inputs sit 5px
          lower than the three selects beside them, which is the kind of drift
          that makes a filter bar look assembled rather than designed. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="analytics-date-from" className="field-label mb-0">From</label>
        <input id="analytics-date-from" type="date" value={filters.dateFrom ?? ''} onChange={(e) => set('dateFrom', e.target.value || undefined)} className="input-base" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="analytics-date-to" className="field-label mb-0">To</label>
        <input id="analytics-date-to" type="date" value={filters.dateTo ?? ''} onChange={(e) => set('dateTo', e.target.value || undefined)} className="input-base" />
      </div>
      {hasFilters && (
        <div className="flex justify-end">
          {/* h-10 matches --input-base's 40px, so the button seats on the same
              baseline as the fields instead of hanging 4px below them. */}
          <Button variant="ghost" size="md" className="h-10" onClick={() => setFilters({})} icon={<RotateCcw size={14} strokeWidth={2} aria-hidden="true" />}>
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
            <StatStripSkeleton cells={positionSelected ? 4 : 3} />
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
        <motion.div className="space-y-6" variants={stagger} initial="initial" animate="animate">
          {/* Funnel / headline stats — all real. Average Score is position-specific.
              One lead figure, then supports: see StatLead. */}
          <motion.div variants={child}>
            <Card className="overflow-hidden p-0">
              <div className={cn('grid gap-px bg-rule sm:grid-cols-2', positionSelected ? 'lg:grid-cols-[1.4fr_1fr_1fr_1fr]' : 'lg:grid-cols-[1.4fr_1fr_1fr]')}>
                <StatLead
                  label="Completion Rate"
                  value={pct(a.completionRate)}
                  sub={`${a.totals.completed} of ${a.totals.created}`}
                  ratio={a.completionRate}
                  reduce={reduce}
                />
                <StatCell label="Interviews Created" value={a.totals.created} sub={`${a.totals.started} started · ${a.totals.completed} completed`} />
                {positionSelected && (
                  <StatCell label="Average Score" value={a.averageOverall} sub={`across ${a.totals.scored} scored`} />
                )}
                <StatCell label="Avg Duration" value={mmss(a.timeStats.avgDurationSeconds)} sub={`~${mmss(a.timeStats.avgTimePerQuestionSeconds)}/question`} />
              </div>
            </Card>
          </motion.div>

          {/* In the aggregate (all-positions) view, position-specific insights are hidden. */}
          {!positionSelected && (
            <motion.div variants={child}>
              <Card className="bg-surface-hover p-4">
                <div className="flex items-start gap-3">
                  {/* The plate was bg-surface-hover sitting on a bg-surface-hover
                      card — an invisible circle. It is now a ruled square on the
                      surface, squared because the token layer keeps rounded-full
                      for avatars, status dots and the voice orb. */}
                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-rule bg-surface text-ink-muted">
                    <Info className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">Position-level insights are hidden</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-body">
                      Select a <span className="font-semibold text-ink">Role</span> or <span className="font-semibold text-ink">Template</span> above to see the
                      {' '}average score, score distribution, KPI averages, and top candidates for that position.
                      These are only meaningful within a single position.
                    </p>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {/* Score distribution + trend — position-specific (hidden in the aggregate view) */}
          {positionSelected && (
          <motion.div variants={child} className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card className="p-5">
              <PanelHead title="Score Distribution" meta={`Scored interviews · ${positionLabel}`} />
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={a.scoreDistribution} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  {/* A solid hairline. The dashed grid was a second texture
                      competing with the bars for the reader's attention. */}
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="bucket" tick={AXIS_TICK} tickMargin={8} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} width={30} tick={AXIS_TICK} tickMargin={6} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_ITEM} cursor={BAR_CURSOR} />
                  {/* 36px max with a 3px cap: a bar is a measured quantity, and a
                      54px slab with a 6px dome reads as a widget instead. */}
                  <Bar dataKey="count" name="Interviews" radius={[3, 3, 0, 0]} maxBarSize={36} {...CHART_ANIM} isAnimationActive={!reduce}>
                    {a.scoreDistribution.map((d) => <Cell key={d.bucket} fill={bucketColor(d.bucket, pal)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule pt-3">
                {bandLegend(pal).map((b) => (
                  <span key={b.label} className="flex items-center gap-1.5 text-[11px] font-medium tabular-nums text-ink-muted">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: b.hex }} />
                    {b.label}
                  </span>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <PanelHead title="Average Score Trend" meta="By completion day" />
              {a.trend.length === 0 ? (
                <div className="relative isolate-paint flex h-[200px] flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed border-rule bg-surface-sunk text-center">
                  <div aria-hidden="true" className="keylight-accent pointer-events-none absolute inset-0 [--key-y:50%]" />
                  <LineChartIcon className="relative h-5 w-5 text-ink-faint" strokeWidth={1.75} aria-hidden="true" />
                  <p className="relative section-label">Not enough history yet</p>
                  <p className="relative max-w-[18rem] text-xs leading-relaxed text-ink-faint">A trend line appears once interviews are completed on two or more days.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={a.trend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    {/* 18% → 0. Enough to give the line a body on both grounds,
                        far short of a filled field. */}
                    <defs><linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ACCENT} stopOpacity={0.18} /><stop offset="100%" stopColor={ACCENT} stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="date" tick={AXIS_TICK} tickMargin={8} axisLine={false} tickLine={false} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis domain={[0, 100]} width={30} tick={AXIS_TICK} tickMargin={6} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={TOOLTIP} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_ITEM} cursor={{ stroke: pal.ruleStrong, strokeWidth: 1 }} />
                    {/* The active dot carries a surface-coloured ring so the
                        hovered day reads as lifted off the line rather than as a
                        fatter dot. */}
                    <Area
                      type="monotone" dataKey="averageOverall" name="Avg score"
                      stroke={ACCENT} strokeWidth={2} fill="url(#scoreGrad)"
                      dot={{ fill: ACCENT, r: 2.5, strokeWidth: 0 }}
                      activeDot={{ fill: ACCENT, r: 4, stroke: pal.surface, strokeWidth: 2 }}
                      {...CHART_ANIM}
                      isAnimationActive={!reduce}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </Card>
          </motion.div>
          )}

          {/* Per-KPI averages — position-specific (hidden in the aggregate view) */}
          {positionSelected && (
          <motion.div variants={child}>
          <Card className="p-5">
            <PanelHead title={`KPI Averages · ${positionLabel}`} meta="Mean score per KPI, with the share of scored interviews whose rubric included it." />
            {a.kpiAverages.length === 0 ? (
              <MiniEmpty>No KPI data for this position yet.</MiniEmpty>
            ) : (
              <div className="divide-y divide-rule">
                {a.kpiAverages.map((k) => (
                  <div key={k.kpiId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="w-24 flex-shrink-0 truncate text-sm text-ink-body sm:w-44" title={k.label}>{k.label}</span>
                    <MeterBar value={k.average} color={scoreColor(k.average, pal)} />
                    <span className="w-9 flex-shrink-0 text-right text-sm font-bold tabular-nums text-ink">{k.average}</span>
                    <span className="w-20 flex-shrink-0 text-right text-[11px] tabular-nums text-ink-faint sm:w-24" title="Share of scored interviews whose rubric included this KPI">{pct(k.coverage)} coverage</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          </motion.div>
          )}

          {/* Track comparison + recommendation distribution */}
          <motion.div variants={child} className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card className="p-5">
              <PanelHead title="By Track" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[26rem] table-fixed text-sm">
                  <thead>
                    <tr className="section-label border-b border-rule">
                      <Th>Track</Th>
                      <Th align="right" className="w-24">Sessions</Th>
                      <Th align="right" className="w-24">Avg score</Th>
                      <Th align="right" className="w-24">Completion</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.byTrack.map((t) => (
                      <tr key={t.track} className="border-b border-rule last:border-0">
                        <td className="truncate py-3 pr-3 font-semibold text-ink" title={TRACK_LABEL[t.track]}>{TRACK_LABEL[t.track]}</td>
                        <td className="py-3 pl-3 text-right tabular-nums text-ink-muted">{t.count}</td>
                        <td className="py-3 pl-3 text-right"><ScoreCell value={t.averageOverall} /></td>
                        <td className="py-3 pl-3 text-right font-semibold tabular-nums text-ink">{pct(t.completionRate)}</td>
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
                    const color = recColor(r.recommendation, pal)
                    return (
                      <div key={r.recommendation} className="flex items-center gap-3">
                        <span className="flex w-24 flex-shrink-0 items-center gap-2 text-sm text-ink-body">
                          <span aria-hidden="true" className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
                          <span className="truncate">{REC_LABEL[r.recommendation] ?? r.recommendation}</span>
                        </span>
                        <MeterBar value={Math.round(share * 100)} color={color} />
                        <span className="w-8 flex-shrink-0 text-right text-sm font-bold tabular-nums text-ink">{r.count}</span>
                        <span className="w-10 flex-shrink-0 text-right text-[11px] tabular-nums text-ink-faint">{pct(share)}</span>
                      </div>
                    )
                  })
                )}
                <div className="mt-1 border-t border-rule pt-3 text-xs text-ink-muted">
                  Integrity flags on {pct(a.integrityFlagRate)} of scored interviews.
                </div>
              </div>
            </Card>
          </motion.div>

          {/* By role + by template */}
          <motion.div variants={child} className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card className="p-5">
              <PanelHead title="By Role" />
              {a.byRole.length === 0 ? <MiniEmpty>No role data yet.</MiniEmpty> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[22rem] table-fixed text-sm">
                    <thead>
                      <tr className="section-label border-b border-rule">
                        <Th>Role</Th>
                        <Th align="right" className="w-24">Sessions</Th>
                        <Th align="right" className="w-24">Avg score</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.byRole.map((r) => (
                        <tr key={r.role} className="border-b border-rule last:border-0">
                          <td className="truncate py-3 pr-3 text-ink-body" title={r.role}>{r.role}</td>
                          <td className="py-3 pl-3 text-right tabular-nums text-ink-muted">{r.count}</td>
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
                      <tr className="section-label border-b border-rule">
                        <Th>Template</Th>
                        <Th align="right" className="w-24">Sessions</Th>
                        <Th align="right" className="w-24">Avg score</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.byTemplate.map((t) => (
                        <tr key={t.templateId} className="border-b border-rule last:border-0">
                          <td className="truncate py-3 pr-3 text-ink-body" title={t.name}>{t.name}</td>
                          <td className="py-3 pl-3 text-right tabular-nums text-ink-muted">{t.count}</td>
                          <td className="py-3 pl-3 text-right"><ScoreCell value={t.averageOverall} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </motion.div>

          {/* Top candidates — position-specific (hidden in the aggregate view) */}
          {positionSelected && (
          <motion.div variants={child}>
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
                    className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors duration-fast ease-out hover:border-rule hover:bg-surface-hover">
                    {/* A rank is a numeral, so it is set in the mono and squared. It was a
                        gradient-filled circle, which made position 1 read as a
                        decorated badge rather than as the top of an ordered list. */}
                    <span className={cn('flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm border font-mono text-[11px] nums', i === 0 ? 'border-action bg-action text-action-ink' : 'border-rule bg-surface-sunk text-ink-muted')}>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                      {c.role && <span className="block truncate text-xs text-ink-muted">{c.role}</span>}
                    </span>
                    <span aria-hidden="true" className="hidden flex-shrink-0 text-xs font-semibold text-ink opacity-0 transition-opacity duration-fast ease-out group-hover:opacity-100 group-focus-visible:opacity-100 sm:inline">View report →</span>
                    <span className={cn('flex-shrink-0 text-sm font-bold tabular-nums', scoreInk(c.overallScore))}>{c.overallScore}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          </motion.div>
          )}

          {/* Candidates' view of the experience. Sits below the scored analytics
              because it answers a different question: those charts measure the
              candidates, this measures us. */}
          <motion.div variants={child}><FeedbackPanel /></motion.div>

          <motion.p variants={child} className="text-center text-[11px] text-ink-faint">Aggregated {new Date(a.generatedAt).toLocaleString()} · scored interviews only</motion.p>
        </motion.div>
      )}
    </div>
  )
}

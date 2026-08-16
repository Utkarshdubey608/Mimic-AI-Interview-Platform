import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, ArrowRight, CalendarDays, ChevronRight, ListFilter, Plus, Workflow, X } from 'lucide-react'
import { pipelinesApi, describeFetchError } from '@/lib/api'
import { useAutopilotActions } from '@/features/guide/autopilot/registry'
import { matchOption } from '@/features/guide/autopilot/filterMatch'
import { Badge, Button, Card, Select, PageHeader, EmptyState, Skeleton } from '@/components/ui'
import type { Pipeline } from '@shared/types'

export default function PipelinesPage() {
  const { data: pipelines, isLoading, isError, error, refetch } = useQuery({ queryKey: ['pipelines'], queryFn: () => pipelinesApi.list() })
  const [role, setRole] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const navigate = useNavigate()

  const roles = useMemo(
    () => [...new Set((pipelines ?? []).map((p) => p.role).filter(Boolean))].sort(),
    [pipelines],
  )

  // ── Autopilot: open a board by role, and drive the list filters (role + date
  // range) exactly like the controls below. Filtering/navigation are read-only
  // (not side effects), so these run immediately. Live data is read through refs
  // so the memoized defs never go stale. ────────────────────────────────────
  const pipelinesRef = useRef<Pipeline[]>([])
  pipelinesRef.current = pipelines ?? []
  const filterRef = useRef({ role: '', from: '', to: '' })
  filterRef.current = { role, from, to }
  const apActions = useMemo(() => ({
    openByRole: {
      description: 'Open the progression board for a role by name (matches a pipeline role, most recent first)',
      params: [{ name: 'role', type: 'string' as const, required: true }],
      run: (args: Record<string, unknown>) => {
        const want = String(args.role ?? '').trim().toLowerCase()
        if (!want) return
        const match = pipelinesRef.current.find((p) => p.role.toLowerCase() === want)
          ?? pipelinesRef.current.find((p) => p.role.toLowerCase().includes(want))
        if (match) navigate(`/pipelines/${match.id}`)
      },
    },
    filterByRole: {
      description: 'Filter the pipelines list by role/position (matches an existing pipeline role). Say "all" to clear.',
      params: [{ name: 'role', type: 'string' as const, required: true, description: 'the role name, or "all" to clear' }],
      run: (args: Record<string, unknown>) => {
        const want = String(args.role ?? '').trim()
        if (!want || /^(all|any)$/i.test(want)) { setRole(''); return }
        const roleList = [...new Set(pipelinesRef.current.map((p) => p.role).filter(Boolean))]
        const match = matchOption(want, roleList)
        if (!match) { toast.error(`No pipeline for a role matching "${want}"`); return }
        setRole(match)
      },
    },
    setDateRange: {
      description: 'Filter the pipelines list by creation date range (YYYY-MM-DD). Omit a bound to leave it open; use clearFilters to remove dates.',
      params: [
        { name: 'from', type: 'string' as const, required: false, description: 'start date YYYY-MM-DD' },
        { name: 'to', type: 'string' as const, required: false, description: 'end date YYYY-MM-DD' },
      ],
      run: (args: Record<string, unknown>) => {
        setFrom(args.from ? String(args.from) : '')
        setTo(args.to ? String(args.to) : '')
      },
    },
    clearFilters: {
      description: 'Clear all pipelines-list filters (role and dates).',
      params: [],
      run: () => { setRole(''); setFrom(''); setTo('') },
    },
  }), [navigate])
  const apGetState = useCallback(() => {
    const all = pipelinesRef.current
    const f = filterRef.current
    const matching = all.filter((p) => {
      if (f.role && p.role !== f.role) return false
      if (f.from && (p.createdAt || '') < f.from) return false
      if (f.to && (p.createdAt || '') > `${f.to}T23:59:59.999Z`) return false
      return true
    })
    return {
      screen: 'pipelines',
      availableRoles: [...new Set(all.map((p) => p.role).filter(Boolean))].sort(),
      filters: { role: f.role || 'All roles', from: f.from || null, to: f.to || null },
      matchingCount: matching.length,
      totalCount: all.length,
    }
  }, [])
  const apOpts = useMemo(() => ({ getState: apGetState }), [apGetState])
  useAutopilotActions('pipelines', apActions, apOpts)
  const hasFilters = !!(role || from || to)
  const filtered = useMemo(() => (pipelines ?? []).filter((p) => {
    if (role && p.role !== role) return false
    if (from && (p.createdAt || '') < from) return false
    if (to && (p.createdAt || '') > `${to}T23:59:59.999Z`) return false
    return true
  }), [pipelines, role, from, to])

  const total = (pipelines ?? []).length

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      <PageHeader
        kicker="Hiring Pipelines"
        title="Pipelines"
        description="Multi-round hiring flows. Open one to see how candidates are progressing round by round."
      />

      {/* Filter bar — one card row: role, created-date window, result count. */}
      <Card className="mb-8 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <span className="hidden h-11 items-center gap-2 pr-1 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500 sm:inline-flex">
            <ListFilter size={14} className="text-primary-700" /> Filter
          </span>
          <div className="w-full sm:w-56">
            <Select
              label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              options={[{ value: '', label: 'All roles' }, ...roles.map((r) => ({ value: r, label: r }))]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="field-label" htmlFor="pipelines-from">Created from</label>
            <input id="pipelines-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-base w-40 text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="field-label" htmlFor="pipelines-to">Created to</label>
            <input id="pipelines-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-base w-40 text-sm" />
          </div>
          {hasFilters && (
            <Button
              variant="ghost"
              icon={<X size={14} />}
              className="h-11 px-4"
              onClick={() => { setRole(''); setFrom(''); setTo('') }}
            >
              Clear filters
            </Button>
          )}
          {!isLoading && !isError && total > 0 && (
            <span className="ml-auto flex h-11 items-center text-xs font-medium tabular-nums text-neutral-500">
              {filtered.length === total
                ? `${total} pipeline${total === 1 ? '' : 's'}`
                : `${filtered.length} of ${total} pipelines`}
            </span>
          )}
        </div>
      </Card>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <Skeleton className="mt-6 h-3.5 w-28" />
            </Card>
          ))}
        </div>
      ) : isError ? (
        <Card className="p-0">
          <EmptyState
            icon={<AlertTriangle />}
            title="Couldn’t load pipelines"
            description={describeFetchError(error, 'The pipelines list didn’t come back from the server. Check your connection, then try again.')}
            action={<Button variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>}
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={<Workflow />}
            title={hasFilters ? 'No pipelines match these filters' : 'No pipelines yet'}
            description={hasFilters
              ? 'Widen the created-date window or pick a different role to see more pipelines.'
              : 'A pipeline is created when you send an invite with multiple rounds. Start one to track candidates across rounds.'}
            action={hasFilters
              ? <Button variant="outline" size="sm" onClick={() => { setRole(''); setFrom(''); setTo('') }}>Clear filters</Button>
              : <Button size="sm" icon={<Plus size={14} />} onClick={() => navigate('/sessions/new')}>New multi-round invite</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p: Pipeline) => (
            <Link
              key={p.id}
              to={`/pipelines/${p.id}`}
              className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-700 focus-visible:ring-offset-2"
            >
              <Card hover className="flex h-full flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display text-[15px] font-bold leading-snug tracking-[-0.01em] text-neutral-900">{p.role}</h2>
                  <Badge variant="neutral" className="shrink-0 tabular-nums">{p.rounds.length} round{p.rounds.length === 1 ? '' : 's'}</Badge>
                </div>

                {/* Round sequence — chip → chip → chip */}
                <ol className="mt-4 flex flex-wrap items-center gap-y-2">
                  {p.rounds.map((r, i) => (
                    <li key={i} className="flex items-center">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-neutral-50 py-1 pl-1.5 pr-2.5 text-[11px] font-medium text-neutral-700">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary-100 text-[9px] font-bold tabular-nums text-primary-700">{i + 1}</span>
                        <span className="max-w-[9rem] truncate">{r.name}</span>
                      </span>
                      {i < p.rounds.length - 1 && <ChevronRight size={12} aria-hidden className="mx-1 shrink-0 text-neutral-300" />}
                    </li>
                  ))}
                </ol>

                <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                  <span className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
                    <CalendarDays size={12} aria-hidden /> Created {new Date(p.createdAt).toLocaleDateString()}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-400 transition-colors duration-150 group-hover:text-primary-700">
                    Open board <ArrowRight size={12} aria-hidden />
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

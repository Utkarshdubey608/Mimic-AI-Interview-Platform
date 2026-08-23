import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Copy, Pencil, Trash2, Plus, LayoutTemplate,
  AlertTriangle, RefreshCw, Timer, Clock, ListChecks,
} from 'lucide-react'
import { PageHeader, Card, Button, Badge, EmptyState, ExhibitTab, Skeleton, cn } from '@/components/ui'
import { templatesApi, describeFetchError } from '@/lib/api'
import type { InterviewTemplate } from '@shared/types'

/* A local TRACK_META map (one glyph and label per interview track) used to live
   here. REMOVED — `ExhibitTab` now owns the per-track plate, glyph and label, so
   the map was a second, drifting source for the same thing. See the note on the
   template card below; git history has the map. */

/** A single meta fact on a card — icon, label, and a tabular value. */
function MetaChip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-sunk px-2.5 py-1 text-[11px] font-medium text-ink-muted">
      <span className="flex-shrink-0 text-ink-faint">{icon}</span>
      {children}
    </span>
  )
}

function TemplateCardSkeleton() {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <Skeleton className="h-[22px] w-16 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-3 w-16" />
      <Skeleton className="mt-2.5 h-4 w-3/4" />
      <Skeleton className="mt-2 h-3 w-1/2" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>
      </div>
    </Card>
  )
}

export default function TemplatesPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const templates = useQuery({ queryKey: ['templates'], queryFn: templatesApi.list })

  const create = useMutation({
    mutationFn: () => templatesApi.create({ name: 'New template', role: 'Software Engineer' }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['templates'] })
      navigate(`/templates/${t.id}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const duplicate = useMutation({
    mutationFn: (t: InterviewTemplate) =>
      templatesApi.create({ ...t, name: `${t.name} (copy)`, id: undefined as never }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast.success('Template duplicated') },
  })

  const remove = useMutation({
    mutationFn: (id: string) => templatesApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['templates'] }); toast.success('Template deleted') },
  })

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      <PageHeader
        kicker="AI Interview"
        title="Interview Templates"
        description="Reusable configurations — questions, timing, scoring rubric, branding, and integrity rules."
        action={<Button icon={<Plus size={16} />} loading={create.isPending} onClick={() => create.mutate()}>New template</Button>}
      />

      {templates.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <TemplateCardSkeleton key={i} />)}</div>
      ) : templates.isError ? (
        <Card className="p-0">
          <EmptyState
            icon={<AlertTriangle strokeWidth={1.75} />}
            title="Couldn't load your templates"
            description={describeFetchError(templates.error, 'Something went wrong while fetching templates. Check your connection and try again.')}
            action={<Button size="sm" icon={<RefreshCw size={14} />} onClick={() => templates.refetch()}>Retry</Button>}
          />
        </Card>
      ) : !templates.data?.length ? (
        <Card className="p-0">
          <EmptyState
            icon={<LayoutTemplate strokeWidth={1.75} />}
            title="No templates yet"
            description="Create your first interview template to start inviting candidates."
            action={<Button icon={<Plus size={16} />} onClick={() => create.mutate()}>New template</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.data.map((t) => {
            const adaptive = t.questionSource === 'adaptive'
            return (
              <Card key={t.id} hover className="flex flex-col p-5">
                {/* The tinted plate, its glyph and the uppercase label below were
                    three ways of saying the same thing — all three derive from
                    the track. The exhibit tab says it once, in the colour the
                    whole product uses to encode interview format, so a grid of
                    templates is scannable by format the way the bundle index is. */}
                <div className="flex items-start justify-between gap-2">
                  <ExhibitTab track={t.track} />
                  <Badge variant={adaptive ? 'info' : 'neutral'}>{adaptive ? 'Adaptive' : 'Fixed'}</Badge>
                </div>

                <h3 className="mt-3.5 line-clamp-2 text-base font-bold leading-snug tracking-[-0.01em] text-ink">{t.name}</h3>
                <p className="mt-0.5 line-clamp-1 text-sm text-ink-muted">{t.role}{t.seniority ? ` · ${t.seniority}` : ''}</p>

                <div className="mt-4 mb-5 flex flex-wrap gap-1.5">
                  <MetaChip icon={<Timer size={12} strokeWidth={1.75} />}>
                    Prep <span className="font-bold tabular-nums text-ink-body">{t.timing.prepSeconds}s</span>
                  </MetaChip>
                  <MetaChip icon={<Clock size={12} strokeWidth={1.75} />}>
                    Answer <span className="font-bold tabular-nums text-ink-body">{t.timing.answerSeconds}s</span>
                  </MetaChip>
                  <MetaChip icon={<ListChecks size={12} strokeWidth={1.75} />}>
                    <span className="font-bold tabular-nums text-ink-body">{t.rubric.kpis.filter((k) => k.enabled).length}</span> KPIs
                  </MetaChip>
                </div>

                <div className="mt-auto flex items-center gap-1 border-t border-border pt-3">
                  <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => navigate(`/templates/${t.id}`)}>Edit</Button>
                  <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={() => duplicate.mutate(t)}>Duplicate</Button>
                  <button
                    onClick={() => { if (confirm(`Delete “${t.name}”?`)) remove.mutate(t.id) }}
                    className={cn(
                      'ml-auto flex h-8 w-8 items-center justify-center rounded-full text-ink-faint',
                      'transition-colors duration-150 hover:bg-danger-bg hover:text-danger',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2',
                    )}
                    aria-label={`Delete template ${t.name}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

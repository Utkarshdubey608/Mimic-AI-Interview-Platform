import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Copy, Pencil, Plus, Trash2, UserPlus, Workflow } from 'lucide-react'
import { Badge, Button, Card, PageHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { roleConfigsApi, describeFetchError } from '@/lib/api'
import type { RoleConfig } from '@shared/types'

/**
 * The list of reusable role pipelines (`RoleConfig` templates). Deliberately
 * separate from the older `web_pipelines` system's PipelinesPage — this reads
 * `roleConfigsApi`, not `pipelinesApi`.
 */
export default function RolePipelinesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [busyId, setBusyId] = useState<string | null>(null)

  const list = useQuery({ queryKey: ['role-configs'], queryFn: roleConfigsApi.list })
  const categories = useQuery({ queryKey: ['role-categories'], queryFn: roleConfigsApi.categories })

  const categoryLabel = (slug: string) => categories.data?.find((c) => c.slug === slug)?.displayName ?? slug
  const invalidate = () => qc.invalidateQueries({ queryKey: ['role-configs'] })

  const duplicate = async (rc: RoleConfig) => {
    setBusyId(rc.id)
    try {
      await roleConfigsApi.duplicate(rc.id)
      invalidate()
      toast.success('Pipeline duplicated')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not duplicate the pipeline')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (rc: RoleConfig) => {
    if (!confirm(`Delete "${rc.displayName}"? This cannot be undone.`)) return
    setBusyId(rc.id)
    try {
      await roleConfigsApi.remove(rc.id)
      invalidate()
      toast.success('Pipeline deleted')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the pipeline')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-8">
      <PageHeader
        title="Role pipelines"
        description="Reusable, ordered interview templates per role. Applying one to a batch of candidates materialises a real multi-round timeline and invites round 1."
        action={<Button icon={<Plus size={15} />} onClick={() => navigate('/candidates/role-pipelines/new')}>New pipeline</Button>}
      />

      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-5 h-8 w-40" />
            </Card>
          ))}
        </div>
      ) : list.isError ? (
        <Card className="p-0">
          <ErrorState
            title="Couldn't load role pipelines"
            detail={describeFetchError(list.error, "This view couldn't reach the server. Check your connection and try again.")}
            onRetry={() => void list.refetch()}
          />
        </Card>
      ) : !list.data?.length ? (
        <Card className="overflow-hidden p-0">
          <EmptyState
            icon={<Workflow strokeWidth={1.75} />}
            title="No role pipelines yet"
            description="Create one to define a reusable, ordered interview flow for a role — screening, technical, HR — and reuse it every time you hire for that role."
            action={<Button icon={<Plus size={15} />} onClick={() => navigate('/candidates/role-pipelines/new')}>New pipeline</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {list.data.map((rc) => (
            <Card key={rc.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-[15px] font-bold leading-snug tracking-[-0.01em] text-ink">{rc.displayName}</h2>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">{categoryLabel(rc.roleCategory)}</p>
                </div>
                <Badge variant="neutral" className="shrink-0 tabular-nums">
                  {rc.rounds.length} round{rc.rounds.length === 1 ? '' : 's'}
                </Badge>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-ink-body">
                {rc.rounds.length
                  ? rc.rounds.map((r) => r.title).join(' → ')
                  : <span className="text-ink-faint">No rounds configured</span>}
              </p>

              <div className="mt-auto flex items-center justify-end gap-1 pt-4">
                <Button
                  size="sm" variant="secondary" icon={<UserPlus size={13} />}
                  disabled={rc.rounds.length === 0 || rc.rounds[0]?.kind === 'two_way'}
                  title={
                    rc.rounds.length === 0
                      ? 'Add at least one round first'
                      : rc.rounds[0]?.kind === 'two_way'
                        ? "Round 1 can't be a live interview — edit the pipeline to start with a résumé, chat, video, or voice round"
                        : undefined
                  }
                  onClick={() => navigate(`/candidates/role-pipelines/${rc.id}/apply`)}
                  className="mr-auto"
                >
                  Apply to candidates
                </Button>
                <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => navigate(`/candidates/role-pipelines/${rc.id}`)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" icon={<Copy size={13} />} disabled={busyId === rc.id} onClick={() => void duplicate(rc)}>
                  Duplicate
                </Button>
                <Button
                  size="sm" variant="ghost" icon={<Trash2 size={13} />} disabled={busyId === rc.id}
                  onClick={() => void remove(rc)}
                  className="hover:bg-danger-bg hover:text-danger"
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle, ExternalLink, KeyRound, Plus, RefreshCw, ScanFace, Trash2 } from 'lucide-react'
import { useReplicas, useDeleteReplica, useUpdateReplica } from '@/hooks/useTavus'
import { useAppStore } from '@/store/useAppStore'
import { Button, Card, Badge, Modal, Input, EmptyState, PageHeader, InfoRow } from '@/components/ui'
import type { TavusReplica } from '@/types/tavus.types'
import { formatDistanceToNow } from 'date-fns'

function StatusBadge({ status }: { status: TavusReplica['status'] }) {
  const map = { ready: 'success', completed: 'success', training: 'warning', error: 'danger', deleted: 'neutral' } as const
  return <Badge variant={map[status]} className="capitalize">{status}</Badge>
}

/* ── Face placeholder for replicas without a preview video ──────────────────── */
function PlaceholderFace() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-100 text-neutral-300">
      <svg
        width="40" height="40" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    </div>
  )
}

/* ── Loading placeholder that mirrors the real card ─────────────────────────── */
function ReplicaCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="h-44 w-full animate-pulse bg-neutral-100" />
      <div className="p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-3/5 animate-pulse rounded bg-neutral-100" />
            <div className="h-2.5 w-2/5 animate-pulse rounded bg-neutral-100" />
          </div>
          <div className="h-5 w-16 flex-shrink-0 animate-pulse rounded-full bg-neutral-100" />
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <div className="h-2.5 w-24 animate-pulse rounded bg-neutral-100" />
          <div className="h-2.5 w-12 animate-pulse rounded bg-neutral-100" />
        </div>
      </div>
    </Card>
  )
}

function ReplicaCard({ r, onSelect }: { r: TavusReplica; onSelect: (r: TavusReplica) => void }) {
  const del = useDeleteReplica()
  const progress = Math.max(0, Math.min(100, r.training_progress ?? 0))

  return (
    <Card hover className="group flex flex-col overflow-hidden cursor-pointer" onClick={() => onSelect(r)}>
      <div className="relative h-44 w-full overflow-hidden rounded-t-2xl bg-neutral-100">
        {r.thumbnail_video_url
          ? <video src={r.thumbnail_video_url} className="h-full w-full object-cover" muted loop autoPlay playsInline />
          : <PlaceholderFace />
        }
        {r.replica_type === 'stock' && (
          <span className="absolute left-2.5 top-2.5 rounded-full border border-white/40 bg-neutral-900/55 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
            Stock
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-900">{r.replica_name}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-neutral-400">{r.replica_id}</p>
          </div>
          <StatusBadge status={r.status} />
        </div>

        {r.status === 'training' && (
          <div className="mb-3">
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="font-medium text-neutral-500">Training</span>
              <span className="font-bold tabular-nums text-neutral-700">{progress}%</span>
            </div>
            <div className="h-[5px] overflow-hidden rounded-sm bg-neutral-200">
              <div className="h-full rounded-sm bg-primary-700 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
          <span className="truncate text-xs text-neutral-400">
            {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
          </span>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); if (confirm(`Delete "${r.replica_name}"?`)) del.mutate(r.replica_id, { onSuccess: () => toast.success('Replica deleted'), onError: (e: any) => toast.error(e.message) }) }}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-neutral-400 transition-colors duration-150 hover:bg-danger-bg hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
            aria-label={`Delete replica ${r.replica_name}`}
          >
            <Trash2 size={13} strokeWidth={2} aria-hidden="true" />
            Delete
          </button>
        </div>
      </div>
    </Card>
  )
}

export default function ReplicasPage() {
  const { data: replicas, isLoading, isError, error, refetch, isFetching } = useReplicas()
  const { tavusKey } = useAppStore()
  const navigate = useNavigate()
  const update = useUpdateReplica()
  const [selected, setSelected] = useState<TavusReplica | null>(null)
  const [editName, setEditName] = useState('')

  const total = replicas?.length ?? 0
  const trainingCount = replicas?.filter(r => r.status === 'training').length ?? 0

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      <PageHeader
        kicker="Avatar management"
        title="Replicas"
        description="The AI faces available to your interviews. Select any card to view its details or rename it."
        action={
          <Button
            icon={<Plus size={15} strokeWidth={2.5} aria-hidden="true" />}
            onClick={() => toast('Create replicas at platform.tavus.io → Replicas → Create. They appear here automatically once training completes (~15 min).')}
          >
            New replica
          </Button>
        }
      />

      {/* Inventory line — only once there is something to count */}
      {!isLoading && !isError && total > 0 && (
        <div className="-mt-4 mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-neutral-500">
          <span className="font-semibold tabular-nums text-neutral-700">{total}</span>
          <span>replica{total !== 1 ? 's' : ''} available</span>
          {trainingCount > 0 && (
            <>
              <span className="h-3 w-px bg-border" />
              <span className="badge badge-warning tabular-nums">{trainingCount} training</span>
            </>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => <ReplicaCardSkeleton key={i} />)}
        </div>
      ) : isError ? (
        <EmptyState
          icon={<AlertTriangle strokeWidth={1.75} aria-hidden="true" />}
          title="Couldn't load your replicas"
          description={error instanceof Error && error.message ? error.message : 'The Tavus replica list did not load. Check your API key in Settings, then try again.'}
          action={
            <Button
              variant="outline"
              loading={isFetching}
              icon={<RefreshCw size={14} strokeWidth={2.25} aria-hidden="true" />}
              onClick={() => refetch()}
            >
              Try again
            </Button>
          }
        />
      ) : !replicas?.length && !tavusKey ? (
        /* Without a key, listReplicas resolves to an empty array rather than
           rejecting (it tolerates partial failure), so an unconfigured
           workspace would otherwise be told "no replicas yet" and sent to
           Tavus — advice that cannot work until the key is saved. Name the
           real blocker instead. */
        <EmptyState
          icon={<KeyRound strokeWidth={1.75} aria-hidden="true" />}
          title="Connect your Tavus API key"
          description="Replicas are the AI faces that conduct video-avatar interviews. Add your Tavus key in Settings and your replicas — including the stock faces — appear here automatically."
          action={
            <Button variant="primary" onClick={() => navigate('/settings')}>
              Go to Settings
            </Button>
          }
        />
      ) : !replicas?.length ? (
        <EmptyState
          icon={<ScanFace strokeWidth={1.75} aria-hidden="true" />}
          title="No replicas yet"
          description="Create a replica on the Tavus dashboard. Training takes about 15 minutes — it appears here automatically once it's ready."
          action={
            <Button
              variant="outline"
              icon={<ExternalLink size={14} strokeWidth={2.25} aria-hidden="true" />}
              onClick={() => window.open('https://platform.tavus.io', '_blank')}
            >
              Open Tavus dashboard
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {replicas.map(r => <ReplicaCard key={r.replica_id} r={r} onSelect={r => { setSelected(r); setEditName(r.replica_name) }} />)}
        </div>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Replica details" description="Review this replica's metadata, or give it a clearer name.">
        {selected && (
          <div className="space-y-6">
            {selected.thumbnail_video_url && (
              <video
                src={selected.thumbnail_video_url}
                controls
                playsInline
                className="max-h-52 w-full rounded-xl border border-border bg-neutral-100 object-contain"
              />
            )}

            <div className="overflow-hidden rounded-xl border border-border px-4">
              <InfoRow label="Replica ID" value={<span className="font-mono text-xs">{selected.replica_id}</span>} />
              <InfoRow label="Status" value={<StatusBadge status={selected.status} />} />
              <InfoRow label="Type" value={<span className="capitalize">{selected.replica_type ?? '—'}</span>} />
              {selected.status === 'training' && (
                <InfoRow label="Training" value={<span className="font-bold tabular-nums">{Math.max(0, Math.min(100, selected.training_progress ?? 0))}%</span>} />
              )}
              <InfoRow label="Created" value={new Date(selected.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
            </div>

            <Input
              label="Replica name"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              hint="Shown wherever recruiters pick a face."
            />

            <div className="flex justify-end gap-3 border-t border-border pt-5">
              <Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button>
              <Button
                loading={update.isPending}
                onClick={() => update.mutate({ id: selected.replica_id, data: { replica_name: editName } }, { onSuccess: () => { toast.success('Replica renamed'); setSelected(null) }, onError: (e: any) => toast.error(e.message) })}
              >
                Save changes
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

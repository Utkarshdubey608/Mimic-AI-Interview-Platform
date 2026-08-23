import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import toast from 'react-hot-toast'
import { AlertTriangle, ExternalLink, KeyRound, Plus, RefreshCw, ScanFace, Trash2 } from 'lucide-react'
import { useReplicas, useDeleteReplica, useUpdateReplica } from '@/hooks/useTavus'
import { useAppStore } from '@/store/useAppStore'
import { pageVariants } from '@/design/motion'
import { Button, Card, Badge, Modal, Input, EmptyState, PageHeader, InfoRow, Skeleton, cn } from '@/components/ui'
import type { TavusReplica } from '@/types/tavus.types'
import { formatDistanceToNow } from 'date-fns'

function StatusBadge({ status }: { status: TavusReplica['status'] }) {
  const map = { ready: 'success', completed: 'success', training: 'warning', error: 'danger', deleted: 'neutral' } as const
  return <Badge variant={map[status]} className="capitalize">{status}</Badge>
}

/* ── Face placeholder for replicas without a preview video ──────────────────── */
function PlaceholderFace() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-hover text-ink-disabled">
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

/* ── Loading placeholder that mirrors the real card ─────────────────────────
   Same media height, same paddings, same rule position and the same squared
   badge and button shapes as the loaded card, so nothing moves or changes
   silhouette when the list arrives. */
function ReplicaCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="h-44 w-full rounded-none" />
      <div className="p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-5 w-16 flex-shrink-0" />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-rule pt-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-16 rounded-md" />
        </div>
      </div>
    </Card>
  )
}

function ReplicaCard({ r, selected, onSelect }: {
  r: TavusReplica
  /** The card the details modal is currently about. */
  selected?: boolean
  onSelect: (r: TavusReplica) => void
}) {
  const del = useDeleteReplica()
  const progress = Math.max(0, Math.min(100, r.training_progress ?? 0))

  return (
    <Card
      hover
      onClick={() => onSelect(r)}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden',
        selected && 'border-action ring-1 ring-signal',
      )}
    >
      {/* The card already clips to its own 8px radius, so the media needs no
          radius of its own — it used to carry a 10px top radius that did not
          match the card and left a hairline of surface in each top corner. */}
      <div className="relative h-44 w-full overflow-hidden bg-surface-hover">
        {r.thumbnail_video_url
          ? (
            <video
              src={r.thumbnail_video_url}
              // The one animated thing on this card, and only the media moves:
              // transform, 240ms, and nothing at all under reduced motion.
              className="h-full w-full object-cover transition-transform duration-base ease-out motion-safe:group-hover:scale-[1.02]"
              muted loop autoPlay playsInline
            />
          )
          : (
            <div className="h-full w-full transition-transform duration-base ease-out motion-safe:group-hover:scale-[1.02]">
              <PlaceholderFace />
            </div>
          )
        }
        {r.replica_type === 'stock' && (
          // Ground-INDEPENDENT on purpose, like a toast: this chip floats over
          // a photographic frame that is dark on both grounds, so a chip that
          // followed the ground would turn white-on-white in the record.
          <span className="absolute left-2.5 top-2.5 rounded-sm border border-[color:var(--toast-rule)] bg-[color:color-mix(in_srgb,var(--toast-bg)_78%,transparent)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--toast-ink)] backdrop-blur-sm">
            Stock
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{r.replica_name}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-ink-faint">{r.replica_id}</p>
          </div>
          <StatusBadge status={r.status} />
        </div>

        {r.status === 'training' && (
          <div className="mb-3">
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="font-medium text-ink-muted">Training</span>
              <span className="font-bold tabular-nums text-ink-body">{progress}%</span>
            </div>
            <div className="h-[5px] overflow-hidden rounded-sm bg-surface-hover">
              {/* scaleX, not width: width is a layout property and this rail
                  updates while a training poll is in flight. */}
              <div
                className="h-full w-full origin-left rounded-sm bg-action transition-transform duration-base ease-out"
                style={{ transform: `scaleX(${progress / 100})` }}
              />
            </div>
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-rule pt-3">
          <span className="truncate text-xs text-ink-faint">
            {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
          </span>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); if (confirm(`Delete "${r.replica_name}"?`)) del.mutate(r.replica_id, { onSuccess: () => toast.success('Replica deleted'), onError: (e: any) => toast.error(e.message) }) }}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-ink-faint transition-colors duration-fast ease-out hover:bg-risk-bg hover:text-risk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
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
  const reduce = useReducedMotion() ?? false
  const { data: replicas, isLoading, isError, error, refetch, isFetching } = useReplicas()
  const { tavusConfigured } = useAppStore()
  const navigate = useNavigate()
  const update = useUpdateReplica()
  const [selected, setSelected] = useState<TavusReplica | null>(null)
  const [editName, setEditName] = useState('')

  const total = replicas?.length ?? 0
  const trainingCount = replicas?.filter(r => r.status === 'training').length ?? 0

  /* Inventory line — only once there is something to count. It belongs to the
     page head rather than under it: as a free-floating row it needed a -mt-4 to
     claw back the head's own bottom rhythm, which put it on no scale at all. */
  const inventory = !isLoading && !isError && total > 0
    ? (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-muted">
        <span className="font-semibold tabular-nums text-ink-body">{total}</span>
        <span>replica{total !== 1 ? 's' : ''} available</span>
        {trainingCount > 0 && (
          <>
            <span className="h-3 w-px bg-rule" aria-hidden="true" />
            <span className="badge badge-warning tabular-nums">{trainingCount} training</span>
          </>
        )}
      </div>
    )
    : undefined

  return (
    <motion.div
      variants={pageVariants(reduce)}
      initial="initial"
      animate="animate"
      className="max-w-[1440px] mx-auto px-6 py-8"
    >
      <PageHeader
        title="Replicas"
        description="The AI faces available to your interviews. Select any card to view its details or rename it."
        meta={inventory}
        action={
          <Button
            icon={<Plus size={15} strokeWidth={2.5} aria-hidden="true" />}
            onClick={() => toast('Create replicas at platform.tavus.io → Replicas → Create. They appear here automatically once training completes (~15 min).')}
          >
            New replica
          </Button>
        }
      />

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
      ) : !replicas?.length && !tavusConfigured ? (
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
          {replicas.map(r => (
            <ReplicaCard
              key={r.replica_id}
              r={r}
              selected={selected?.replica_id === r.replica_id}
              onSelect={r => { setSelected(r); setEditName(r.replica_name) }}
            />
          ))}
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
                className="max-h-52 w-full rounded-lg border border-rule bg-surface-hover object-contain"
              />
            )}

            <div className="overflow-hidden rounded-lg border border-rule px-4">
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

            <div className="flex justify-end gap-3 border-t border-rule pt-5">
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
    </motion.div>
  )
}

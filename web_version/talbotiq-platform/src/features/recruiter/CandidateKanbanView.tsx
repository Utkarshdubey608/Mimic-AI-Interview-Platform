import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, EmptyState, ErrorState, FilterBar, FilterSelect, SearchField, Skeleton } from '@/components/ui'
import { candidatesApi, roleConfigsApi, describeFetchError } from '@/lib/api'
import { CandidateKanbanCard } from './CandidateKanbanCard'
import { AdvanceCandidateModal } from './AdvanceCandidateModal'
import type { CandidateBoardCard, CandidateBoardParams } from '@shared/types'

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
]

/**
 * Read-only candidates board (Feature 2): one card per candidate, columns
 * grouped by `currentRoundOrder`. Filters are server-side — every change here
 * refetches `candidatesApi.board(params)` rather than filtering client-side.
 *
 * NOT draggable, by product spec: advancing a candidate goes through the
 * existing round-assign action, never a drop on this board.
 */
export function CandidateKanbanView() {
  const [roleCategory, setRoleCategory] = useState('')
  const [status, setStatus] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [actionTarget, setActionTarget] = useState<{ card: CandidateBoardCard; action: 'advance' | 'remove' } | null>(null)

  // Small local debounce — no shared hook for this exists elsewhere in the app.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const categories = useQuery({ queryKey: ['role-categories'], queryFn: roleConfigsApi.categories })
  const categoryLabel = useMemo(() => {
    const map: Record<string, string> = {}
    for (const c of categories.data ?? []) map[c.slug] = c.displayName
    return map
  }, [categories.data])

  const params: CandidateBoardParams = useMemo(() => ({
    roleCategory: roleCategory || undefined,
    status: status || undefined,
    search: search || undefined,
  }), [roleCategory, status, search])

  const board = useQuery({ queryKey: ['candidates-board', params], queryFn: () => candidatesApi.board(params) })

  const columns = useMemo(() => {
    const cards = board.data?.cards ?? []
    const byOrder = new Map<number, CandidateBoardCard[]>()
    for (const c of cards) {
      const arr = byOrder.get(c.currentRoundOrder) ?? []
      arr.push(c)
      byOrder.set(c.currentRoundOrder, arr)
    }
    return [...byOrder.entries()]
      .sort(([a], [b]) => a - b)
      .map(([order, colCards]) => ({
        order,
        // A role filter pins every card in the column to that role's own round
        // title. Without one, different roles can carry different round names
        // at the same order — a generic header, with each card showing its own
        // title in the body (see CandidateKanbanCard), avoids forcing one name
        // onto every card.
        title: roleCategory ? (colCards[0]?.currentRoundTitle ?? `Round ${order + 1}`) : `Round ${order + 1}`,
        cards: colCards,
      }))
  }, [board.data, roleCategory])

  const activeFilterCount = [roleCategory, status, search].filter(Boolean).length
  const totalCards = board.data?.cards.length ?? 0

  return (
    <div>
      <Card className="mb-5 p-3.5">
        <FilterBar
          resultCount={board.data ? totalCards : undefined}
          activeCount={activeFilterCount}
          onClearAll={() => { setRoleCategory(''); setStatus(''); setSearchInput(''); setSearch('') }}
        >
          <FilterSelect
            label="Role"
            value={roleCategory}
            onChange={setRoleCategory}
            options={[{ value: '', label: 'All roles' }, ...(categories.data ?? []).map((c) => ({ value: c.slug, label: c.displayName }))]}
          />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          <SearchField value={searchInput} onChange={setSearchInput} placeholder="Search name or email" className="w-56" />
        </FilterBar>
      </Card>

      {board.isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-72 flex-shrink-0 space-y-2">
              <Skeleton className="h-8 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
            </div>
          ))}
        </div>
      ) : board.isError ? (
        <Card className="p-0">
          <ErrorState
            title="Couldn't load candidates"
            detail={describeFetchError(board.error, "This view couldn't reach the server. Check your connection and try again.")}
            onRetry={() => void board.refetch()}
          />
        </Card>
      ) : columns.length === 0 ? (
        <Card className="overflow-hidden p-0">
          <EmptyState
            title={activeFilterCount > 0 ? 'No candidates match these filters' : 'No candidates yet'}
            description={
              activeFilterCount > 0
                ? 'Widen or clear the filters to see more candidates.'
                : 'Candidates appear here once they are invited into a round.'
            }
          />
        </Card>
      ) : (
        // The one container that scrolls horizontally — the page body never
        // does, and this also satisfies the narrow-viewport requirement without
        // a separate mobile layout.
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => (
            <div key={col.order} className="w-72 flex-shrink-0">
              <div className="mb-2.5 flex items-center justify-between gap-2 rounded-xl bg-surface/60 px-2.5 py-1.5">
                <span className="truncate text-[13px] font-bold tracking-[-0.01em] text-ink">{col.title}</span>
                <span className="badge badge-neutral shrink-0 tabular-nums">{col.cards.length}</span>
              </div>
              <div className="space-y-2">
                {col.cards.map((c) => (
                  <CandidateKanbanCard
                    key={c.email}
                    card={c}
                    roleLabel={c.roleCategory ? categoryLabel[c.roleCategory] ?? c.roleCategory : null}
                    onAdvance={(card) => setActionTarget({ card, action: 'advance' })}
                    onRemove={(card) => setActionTarget({ card, action: 'remove' })}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <AdvanceCandidateModal
        card={actionTarget?.card ?? null}
        action={actionTarget?.action ?? null}
        onClose={() => setActionTarget(null)}
      />
    </div>
  )
}
